use std::str::FromStr;

use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    routing::{delete, get, patch, post},
    Json, Router,
};
use base64::{prelude::BASE64_STANDARD, Engine};
use bcder::Oid;
use bytes::Bytes;
use reqwest::StatusCode;
use rsa::{pkcs8::EncodePrivateKey, RsaPrivateKey};
use serde::{Deserialize, Serialize};
use x509_certificate::{
    rfc4519::OID_ORGANIZATION_NAME, InMemorySigningKeyPair, X509CertificateBuilder,
};
use x509_verify::der::oid::db::rfc4519::USER_ID;

use crate::{
    utils::{decrypt, encrypt},
    Core,
};

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
                    let apns_key = {
                        let mut rng = rand::thread_rng();
                        let apns_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
                        encrypt(&core.secret, apns_key.to_pkcs8_der().unwrap().as_bytes()).unwrap()
                    };

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

                let mut csr = X509CertificateBuilder::default();
                csr.subject().append_printable_string(Oid(OID_ORGANIZATION_NAME.as_ref().into()), &tenant.name).unwrap();
                csr.subject().append_utf8_string(
                    // TODO: Make constant
                    // emailAddressOID defined by https://oidref.com/1.2.840.113549.1.9.1
                    Oid::from_str("1.2.840.113549.1.9.1").unwrap(),
                    // TODO: Don't hardcode my email
                    "oscar@otbeaumont.me"
                ).unwrap();

                    let keypair = InMemorySigningKeyPair::from_pkcs8_der(apns_key).unwrap();
                    let csr = csr.create_certificate_signing_request(&keypair).unwrap();
                    let csr_pem = csr.encode_pem().unwrap();

                // TODO: Reuse client
                let resp = reqwest::Client::new()
                    .post("https://fleetdm.com/api/v1/deliver-apple-csr?deliveryMethod=json")
                    .json(&GetSignedAPNSCSRRequest {
                        unsigned_csr_data: BASE64_STANDARD.encode(csr_pem),
                    })
                    // .json(&todo)
                    .send().await.unwrap();

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

                let cert = x509_certificate::X509Certificate::from_pem(body).unwrap();

                let mut apns_topic = cert.subject_name()
                    .iter_by_oid(
                        // TODO: Make this a constant
                        Oid::from_str("0.9.2342.19200300.100.1.1").unwrap());
                let Some(apns_topc) = apns_topic.next() else {
                    todo!();
                };
                let apns_topic = apns_topc.value.to_string().unwrap();


                // TODO: Check this came from APNS cert
                // TODO: Check it's related to the `apns_private_key` in the database

                sqlx::query!(
                    "UPDATE tenant SET apns_cert = ?, apns_topic = ? WHERE id = ?",
                    cert.encode_der().unwrap(),
                    apns_topic,
                    tenant_id,
                )
                .execute(&core.db)
                .await
                .unwrap();

            StatusCode::NO_CONTENT
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
