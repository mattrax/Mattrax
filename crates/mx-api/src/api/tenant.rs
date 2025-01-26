use std::time::{Duration, SystemTime};

use crate::{
    token::Token,
    utils::{decrypt, encrypt},
    Core,
};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    routing::{delete, get, patch, post},
    Json, Router,
};
use base64::{prelude::BASE64_STANDARD, Engine};
use mx_crypto::x509::{self, Certificate, PrivateKey, Subject};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::error::ErrorKind;
use tower_cookies::Cookies;
use tracing::error;

use super::policy;

#[derive(Deserialize)]
pub struct CreateTenantRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct UpdateTenantRequest {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateApnsRequest {
    pub email: String,
    pub cert: String,
}

pub(crate) fn mount() -> Router<Core> {
    Router::new()
        .route(
            "/",
            post(
                |State(core): State<Core>, cookies: Cookies, body: Json<CreateTenantRequest>| async move {
                    let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                    let tenant_id = nanoid::nanoid!(12);
                    let apns_key = PrivateKey::generate_rsa(2048)
                            .map_err(|err| {
                                error!("Error generating APNS RSA key: {err:?}");
                                StatusCode::INTERNAL_SERVER_ERROR
                            })?;
                    let apns_key = encrypt(&core.secret, &apns_key.encode_pkcs8_der()
                            .map_err(|err| {
                                error!("Error encoding APNS RSA key as pkcs8 der: {err:?}");
                                StatusCode::INTERNAL_SERVER_ERROR
                            })?
                    ).map_err(|err| {
                        error!("Error encrypting APNS key: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                    let mut tx = core.db.begin().await.map_err(|err| {
                        error!("Error starting database transaction: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                    sqlx::query!(
                        "INSERT INTO tenant(id, name, apns_key) VALUES(?, ?, ?)",
                        tenant_id,
                        body.name,
                        apns_key,
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(|err| {
                        error!("Error inserting tenant into database: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                    sqlx::query!(
                        "INSERT INTO tenant_member(tenant, account) VALUES(?, ?)",
                        tenant_id,
                        token.account_id()
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(|err| {
                        error!("Error inserting tenant member into database: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                    tx.commit().await.map_err(|err| {
                        error!("Error committing database transaction: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                    Ok::<_, StatusCode>((axum::http::StatusCode::CREATED, Json(tenant_id)))
                },
            ),
        )
        .route(
            "/",
            get(
                |State(core): State<Core>, cookies: Cookies| async move {
                    let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                    let tenants = sqlx::query!(
                        "SELECT tenant.id, tenant.name, tenant.email, tenant.apns_cert, tenant.apns_email, tenant.created FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant WHERE tenant_member.account = ?",
                        token.account_id()
                    )
                    .fetch_all(&core.db)
                    .await
                    .map_err(|err| {
                        error!("Error fetching tenants from database: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                    Ok::<_, StatusCode>(Json(tenants.into_iter().map(|t| json!({
                        "id": t.id,
                        "name": t.name,
                        "email": t.email,
                        "created": t.created,
                        "apns": t.apns_cert.map(|c| {
                            json!({
                                "email": t.apns_email.unwrap(),
                                // TODO: Expiry
                            })
                        })
                    })).collect::<Vec<_>>()))
                },
            ),
        )
        .route(
            "/{tenant_id}",
            get(
                |State(core): State<Core>, Path(tenant_id): Path<String>, cookies: Cookies| async move {
                    let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                    let t = sqlx::query!(
                        "SELECT tenant.id, tenant.name, tenant.email, tenant.apns_cert, tenant.apns_email, tenant.created FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant WHERE tenant_member.account = ? AND tenant.id = ?",
                        token.account_id(),
                        tenant_id,
                    )
                    .fetch_optional(&core.db)
                    .await
                    .map_err(|err| {
                        error!("Error fetching tenant from database: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?
                    .ok_or(StatusCode::NOT_FOUND)?;

                    Ok::<_, StatusCode>(Json(json!({
                        "id": t.id,
                        "name": t.name,
                        "email": t.email,
                        "created": t.created,
                        "apns": t.apns_cert.map(|c| {
                            json!({
                                "email": t.apns_email.unwrap(),
                                // TODO: Expiry
                            })
                        })
                    })))
                }
            )
        )
    .route(
        "/{tenant_id}/apns",
        get(
            |State(core): State<Core>, cookies: Cookies, Path(tenant_id): Path<String>| async move {
                let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                let tenant = sqlx::query!(
                    "SELECT name, apns_key FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant WHERE tenant_member.account = ? AND tenant.id = ?",
                    token.account_id(),
                    tenant_id,
                )
                .fetch_optional(&core.db)
                .await
                .map_err(|err| {
                    error!("Error fetching tenant from database: {err:?}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
                .ok_or(StatusCode::NOT_FOUND)?;

                let apns_key = decrypt(&core.secret, &tenant.apns_key)
                    .map_err(|err| {
                        error!("Error decrypting APNS key: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                let keypair = PrivateKey::from_pkcs8_der(&apns_key).unwrap();
                let csr_pem = x509::Certificate::builder()
                        .subject(
                            Subject::builder()
                                .organization(&tenant.name)
                                // TODO: Don't hardcode my email
                                .email_address("oscar@otbeaumont.me")
                        )
                        .sign_csr(&keypair)
                        .map_err(|err| {
                            error!("Error signing APNS CSR: {err:?}");
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?
                        .encode_pem()
                        .map_err(|err| {
                            error!("Error encoding APNS CSR as pem: {err:?}");
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?;

                let resp = core.client
                    .post("https://fleetdm.com/api/v1/deliver-apple-csr?deliveryMethod=json")
                    .json(&GetSignedAPNSCSRRequest {
                        unsigned_csr_data: BASE64_STANDARD.encode(csr_pem),
                    })
                    .send()
                    .await
                    .map_err(|err| {
                        error!("Error sending APNS CSR to API: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                if !resp.status().is_success() {
                    // TODO: Between status 400 and 499 probally means the email is invalid
                    error!("Error response from APNS CSR API {:?} {:?}", resp.status().as_u16(), resp.text().await.unwrap_or_default());
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }

                let resp: WebsiteSignCSRResponse = resp.json().await
                    .map_err(|err| {
                        error!("Error decoding APNS CSR API response: {err:?}");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?;

                Ok::<_, StatusCode>((
                    [
                        (
                            header::CONTENT_TYPE,
                            "application/x-plist",
                        ),
                        (
                            header::CONTENT_DISPOSITION,
                            "attachment; filename=\"Certificate Signing Request.plist\"",
                        ),
                    ],
                    BASE64_STANDARD.decode(resp.csr.as_bytes())
                        .map_err(|err| {
                            error!("Error decoding APNS CSR from API: {err:?}");
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?
                ))
            },
        ),
    )
    .route(
        "/{tenant_id}/apns",
        post(
            |State(core): State<Core>, Path(tenant_id): Path<String>, cookies: Cookies, Json(req): Json<UpdateApnsRequest>| async move {
                let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                sqlx::query!(
                    "SELECT id FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant WHERE tenant_member.account = ? AND tenant.id = ?",
                    token.account_id(),
                    tenant_id,
                )
                .fetch_optional(&core.db)
                .await
                .map_err(|err| {
                    error!("Error fetching tenant from database: {err:?}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
                .ok_or(StatusCode::NOT_FOUND)?;

                let cert = Certificate::from_pem(req.cert.as_bytes()).unwrap();
                let Some(apns_topic) = cert.subject().user_id().next() else {
                    error!("Recieved APNS certificate that is missing subject '0.9.2342.19200300.100.1.1'");
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                };

                // TODO: Check this came from APNS cert
                // TODO: Check it's related to the `apns_private_key` in the database

                sqlx::query!(
                    "UPDATE tenant SET apns_cert = ?, apns_topic = ?, apns_email = ? WHERE id = ?",
                    cert.encode_der().unwrap(),
                    apns_topic,
                    req.email,
                    tenant_id,
                )
                .execute(&core.db)
                .await
                .map_err(|err| {
                    error!("Error updating tenant APNS cert: {err:?}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            Ok::<_, StatusCode>(StatusCode::ACCEPTED)
        }
        )
    )
    .route(
        "/{tenant_id}/enroll",
        get(
            // TODO: Configure how many devices, and the group they enroll into??
            |State(core): State<Core>, cookies: Cookies, Path(tenant_id): Path<String>| async move {
                let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

                let tenant = sqlx::query!(
                    "SELECT id, name, apns_cert FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant WHERE tenant_member.account = ? AND tenant.id = ?",
                    token.account_id(),
                    tenant_id,
                )
                .fetch_optional(&core.db)
                .await
                .map_err(|err| {
                    error!("Error fetching tenant from database: {err:?}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
                .ok_or(StatusCode::NOT_FOUND)?;

                if tenant.apns_cert.is_none() {
                    return Err(StatusCode::CONFLICT);
                }
                // TODO: Error out if device identity CA isn't registered yet

                let exp = SystemTime::now() + Duration::from_secs(15* 60); // 15m
                let exp = exp.duration_since(SystemTime::UNIX_EPOCH).map_err(|err| {
                    error!("System time is wrong: {err:?}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?.as_secs();

                // TODO: It might be better to move this to a database token so we can control how many times it's redeemed.
                let challenge = Token::Enrollment {
                    sub: tenant.id,
                    exp,
                }.encode(&core);

                let profile = mx_apple::profiles::enrollment_profile(
                    tenant.name,
                    challenge,
                    format!("{}/apple/connect", core.origin),
                );

                Ok::<_, StatusCode>((
                    [
                        (header::CONTENT_TYPE, "application/x-apple-aspen-config"),
                        (
                            header::CONTENT_DISPOSITION,
                            "attachment; filename=\"enroll.mobileconfig\"",
                        ),
                    ],
                    profile.to_bytes(),
                ))
            }
        )
    )
    .route(
        "/{tenant_id}",
        patch(
            |State(core): State<Core>, Path(tenant_id): Path<String>, cookies: Cookies, Json(req): Json<UpdateTenantRequest>| async move {
            let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

            sqlx::query!(
                "SELECT id FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant WHERE tenant_member.account = ? AND tenant.id = ?",
                token.account_id(),
                tenant_id,
            )
            .fetch_optional(&core.db)
            .await
            .map_err(|err| {
                error!("Error fetching tenant from database: {err:?}");
                StatusCode::INTERNAL_SERVER_ERROR
            })?
            .ok_or(StatusCode::NOT_FOUND)?;

            sqlx::query!(
                r#"
                UPDATE tenant
                SET
                    name = COALESCE(?, name),
                    email = COALESCE(?, email)
                WHERE id = ?
                "#,
                req.name,
                req.email,
                tenant_id,
            )
            .fetch_optional(&core.db)
            .await
            .map_err(|err| {
                if let sqlx::Error::Database(err) = &err {
                    if err.kind() == ErrorKind::UniqueViolation {
                        return StatusCode::CONFLICT;
                    }
                }

                error!("Error updating tenant in db: {err:?}");
                return StatusCode::INTERNAL_SERVER_ERROR;
            })?;

            Ok::<_, StatusCode>(StatusCode::NO_CONTENT)
        }
        )
    )
    .route(
        "/{tenant_id}",
        delete(
        |State(core): State<Core>, Path(tenant_id): Path<String>, cookies: Cookies| async move {
            let token = Token::from_cookies(&core, &cookies).ok_or(StatusCode::UNAUTHORIZED)?;

           // TODO: Implement it!
           Ok::<_, StatusCode>(StatusCode::NOT_IMPLEMENTED)
        }
        )
    )
    .nest("/{tenant_id}/policy", policy::mount())
}

#[derive(Serialize)]
pub struct GetSignedAPNSCSRRequest {
    #[serde(rename = "unsignedCsrData")]
    unsigned_csr_data: String,
}

#[derive(Deserialize)]
pub struct WebsiteSignCSRResponse {
    #[serde(rename = "csr")]
    csr: String,
}

#[derive(Debug)]
pub struct WebsiteError {
    status_code: u16,
    message: String,
}
