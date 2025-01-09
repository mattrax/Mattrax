use crate::{
    utils::{decrypt, encrypt},
    Core,
};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, StatusCode},
    routing::{delete, get, patch, post},
    Json, Router,
};
use base64::{prelude::BASE64_STANDARD, Engine};
use mx_crypto::x509::{self, Certificate, PrivateKey, Subject};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CreateTenantRequest {
    pub name: String,
}

pub(crate) fn mount() -> Router<Core> {
    Router::new()
        .route(
            "/",
            post(
                |State(core): State<Core>, body: Json<CreateTenantRequest>| async move {
                    let account_id = "oscar"; // TODO: Auth

                    let tenant_id = nanoid::nanoid!(12);
                    let apns_key = PrivateKey::generate_rsa(2048).unwrap();
                    let apns_key = encrypt(&core.secret, &apns_key.encode_pkcs8_der().unwrap()).unwrap();

                    let mut tx = core.db.begin().await.unwrap();

                    sqlx::query!(
                        "INSERT INTO tenant(id, name, apns_key) VALUES(?, ?, ?)",
                        tenant_id,
                        body.name,
                        apns_key,
                    )
                    .execute(&mut *tx)
                    .await
                    .unwrap();

                    sqlx::query!(
                        "INSERT INTO tenant_member(tenant_id, account_id) VALUES(?, ?)",
                        tenant_id,
                        account_id
                    )
                    .execute(&mut *tx)
                    .await
                    .unwrap();

                    tx.commit().await.unwrap();

                    (axum::http::StatusCode::CREATED, Json(tenant_id))
                },
            ),
        )
        .route(
            "/",
            get(
                |State(core): State<Core>| async move {
                    let account_id = "oscar"; // TODO: Auth

                    #[derive(Serialize)]
                    pub struct TenantRow {
                        id: String,
                        name: String,
                        email: Option<String>,
                        // is_apns_enabled: bool, // TODO: Return expiry and if set
                    }

                    let tenants = sqlx::query_as!(
                        TenantRow,
                        "SELECT tenant.id, tenant.name, tenant.email FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant_id WHERE tenant_member.account_id = ?",
                        account_id
                    )
                    .fetch_all(&core.db)
                    .await
                    .unwrap();

                    (axum::http::StatusCode::OK, Json(tenants))
                },
            ),
        )
        .route(
            "/{tenant_id}",
            get(
            |State(core): State<Core>, Path(tenant_id): Path<String>| async move {
                todo!();
            }
            )
        )
    .route(
        "/{tenant_id}/apns",
        get(
            |State(core): State<Core>, Path(tenant_id): Path<String>| async move {
                let account_id = "oscar"; // TODO: Auth

                let tenant = sqlx::query!(
                    "SELECT name, apns_key FROM tenant INNER JOIN tenant_member ON tenant.id = tenant_member.tenant_id WHERE tenant_member.account_id = ? AND tenant.id = ?",
                    account_id,
                    tenant_id,
                )
                .fetch_optional(&core.db)
                .await
                .unwrap();
                let Some(tenant) = tenant else {
                    todo!();
                };

                let apns_key = decrypt(&core.secret, &tenant.apns_key).unwrap();

                let keypair = PrivateKey::from_pkcs8_der(&apns_key).unwrap();
                let csr_pem = x509::Certificate::builder()
                        .subject(
                            Subject::builder()
                                .organization(&tenant.name)
                                // TODO: Don't hardcode my email
                                .email_address("oscar@otbeaumont.me")
                        )
                        .sign_csr(&keypair)
                        .unwrap()
                        .encode_pem()
                        .unwrap();

                let resp = core.client
                    .post("https://fleetdm.com/api/v1/deliver-apple-csr?deliveryMethod=json")
                    .json(&GetSignedAPNSCSRRequest {
                        unsigned_csr_data: BASE64_STANDARD.encode(csr_pem),
                    })
                    .send()
                    .await
                    .unwrap();

                if !resp.status().is_success() {
                    // TODO: Between 400 and 499 probally means the email is invalid
                    //
                    let error = WebsiteError {
                        status_code: resp.status().as_u16(),
                        message: resp.text().await.unwrap_or_default(),
                    };
                    todo!("{:?}", error);
                }

                let resp: WebsiteSignCSRResponse = resp.json().await.unwrap();

                (
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
                    BASE64_STANDARD.decode(resp.csr.as_bytes()).unwrap()
                )
            },
        ),
    )
    .route(
        "/{tenant_id}/apns",
        post(
            |State(core): State<Core>, Path(tenant_id): Path<String>, body: Bytes| async move {
                // TODO: Check the user is authorized to this action.

                let cert = Certificate::from_pem(&body).unwrap();

                let Some(apns_topic) = cert.subject().user_id().next() else {
                    todo!();
                };

                // // cert.compare_issuer(other)
                // // cert.public_key_data()

                // // TODO: Check this came from APNS cert
                // // TODO: Check it's related to the `apns_private_key` in the database

                sqlx::query!(
                    "UPDATE tenant SET apns_cert = ?, apns_topic = ? WHERE id = ?",
                    cert.encode_der().unwrap(),
                    apns_topic,
                    tenant_id,
                )
                .execute(&core.db)
                .await
                .unwrap();

            StatusCode::ACCEPTED
        }
        )
    )
    .route(
        "/{tenant_id}/enroll",
        post(
        |State(core): State<Core>, Path(tenant_id): Path<String>| async move {
            // TODO: Configure how many devices, and the group they enroll into??

            todo!();
        }
        )
    )
    .route(
        "/{tenant_id}",
        patch(
        |State(core): State<Core>, Path(tenant_id): Path<String>| async move {
            todo!();
        }
        )
    )
    .route(
        "/{tenant_id}",
        delete(
        |State(core): State<Core>, Path(tenant_id): Path<String>| async move {
            todo!();
        }
        )
    )
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
