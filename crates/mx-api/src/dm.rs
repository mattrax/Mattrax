use apple_dm::{
    mdm::{
        checkin::CheckinCommand,
        profiles::{CommonPayloadKey, MdmServerCapabilityServerCapabilitiesItem},
    },
    ota::DeviceAttributes,
    FlatProfile, Profile,
};
use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header, request::Parts, StatusCode},
    response::IntoResponse,
    routing::{get, post, put},
    Router,
};
use mx_apple::profiles::{mdm_profile, scep_profile};
use mx_crypto::cms::Pkcs7B;
use serde::Deserialize;
use tracing::warn;

use crate::Core;

pub mod device_ca;
mod windows;

pub(crate) fn mount() -> Router<Core> {
    Router::new()
        .route(
            "/EnrollmentServer/Discovery.svc",
            get(|| async { StatusCode::OK }),
        )
        .route(
            "/EnrollmentServer/Discovery.svc",
            post(|| async {
                // https://github.com/mattrax/Mattrax/blob/bf6ef7f5388f9f4524d6f83a13178e176d2ded07/crates/mx-manage/src/enrollment.rs
                todo!();
            }),
        )
        // https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/iPhoneOTAConfiguration/profile-service/profile-service.html
        .route(
            "/apple/connect",
            post(|State(core): State<Core>, req: Parts, body: Bytes| async move {
                (req.headers.get("Content-Type").map(|v| v.as_bytes())
                    == Some(b"application/pkcs7-signature"))
                .then_some(())
                // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                // but this specific status will be stored in the `mdmclient` logs.
                .ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;

                let trusted_signers = core.device_ca.get_trusted_signers(&core).await.unwrap();
                println!("{:?}", trusted_signers.len());
                let trusted_signers = trusted_signers.iter().collect::<Vec<_>>();
                if let Ok(p7) = Pkcs7B::parse_and_verify_pkcs7(&body, &trusted_signers[..]) {
                    let device_attributes = DeviceAttributes::from_plist(p7.signed_content()).map_err(|err| {
                        warn!("Failed to parse device attributes: {err:?}");

                        // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                        // but this specific status will be stored in the `mdmclient` logs.
                        StatusCode::BAD_REQUEST
                    })?;

                    println!("{:?}", device_attributes); // TODO

                    todo!("{:?} {:?}", req, body);

                    let tenant = "a_gRA3NNTIzt"; // TODO: Get from authentication

                    let tenant = sqlx::query!("SELECT id, name, apns_topic FROM tenant WHERE id = ?", tenant)
                        .fetch_one(&core.db)
                        .await
                        .unwrap(); // TODO: Error handling

                    let Some(topic) = tenant.apns_topic else {
                        // In practice this isn't possible as the API won't hand out an enrollment profile.
                        todo!(); // TODO: Error handling
                    };

                    let challenge = "todo".to_string();
                    let scep_url = "http://localhost:9000/apple/scep".to_string();
                    let server_url = "http://localhost:9000/apple/checkin".to_string();

                    return Ok::<_, StatusCode>((
                        [(header::CONTENT_TYPE, "application/x-apple-aspen-config")],
                        // TODO: Generate the plist
                        // TODO: Sign the plist
                        mdm_profile(tenant.name, topic, challenge, scep_url, server_url, None).to_bytes() // TODO: different checkin URL?
                    ))
                };

                let p7 = Pkcs7B::parse_and_verify_pkcs7(&body, &[&*apple_dm::APPLE_IPHONE_DEVICE_CA])
                    .map_err(|err| {
                        warn!("Error verifiying the PKCS7 request: {err:?}");

                        // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                        // but this specific status will be stored in the `mdmclient` logs.
                        StatusCode::FORBIDDEN
                    })?;

                let device_attributes = DeviceAttributes::from_plist(p7.signed_content()).map_err(|err| {
                    warn!("Failed to parse device attributes: {err:?}");

                    // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                    // but this specific status will be stored in the `mdmclient` logs.
                    StatusCode::BAD_REQUEST
                })?;

                println!("{:?}", device_attributes); // TODO

                // TODO: Verify the challenge token
                // if device_attributes.challenge {}
                // return StatusCode::UNAUTHORIZED;

                // TODO: Create device record

                // TODO: What if this is the certificate signed by us?

                // payload = general_payload()

                // payload['PayloadIdentifier'] = "com.acme.encrypted-profile-service"
                // payload['PayloadType'] = "Configuration" # do not modify

                // # strings that show up in UI, customisable
                // payload['PayloadDisplayName'] = "Profile Service Enroll"
                // payload['PayloadDescription'] = "Enrolls identity for the encrypted profile service"

                // payload['PayloadContent'] = [scep_cert_payload(request, "Profile Service", challenge)];
                // Plist::Emit.dump(payload)

                // TODO: https://scep-proxy-na1.jamfcloud.com/scep/43704D49-87C6-5B75-8631-A7367A5FDA1B

                let tenant_name = "todo".to_string();
                let challenge = "todo".to_string();
                let scep_url = "http://localhost:9000/apple/scep".to_string();

                Ok::<_, StatusCode>((
                    [(header::CONTENT_TYPE, "application/x-apple-aspen-config")],
                    // TODO: Generate the plist
                    // TODO: Sign the plist
                    scep_profile(tenant_name, challenge, scep_url).to_bytes()
                ))
            }),
        )
        .route(
            "/apple/checkin",
            put(|State(core): State<Core>, req: Parts, body: Bytes| async move {
                println!("GOT {req:?} {body:?}");

                // TODO: `application/x-apple-aspen-mdm-checkin`

                // TODO: Validate client identity

                let req = CheckinCommand::from_bytes(&body).unwrap();

                println!("CHECKIN {req:?}");

                match req {
                    CheckinCommand::GetToken(req) => todo!(),
                    CheckinCommand::Authenticate(req) => {
                        // TODO: Should we create the device record here?

                        // TODO: Link the certificate being used?

                        // TODO: Can the device already exist at this point?

                        let tenant = "todo"; // TODO: Hook this up to enrollment flow

                        let id = nanoid::nanoid!(12);
                        sqlx::query!("INSERT INTO device(id, tenant, name, model, serial, push_topic) VALUES (?, ?, ?, ?, ?, ?)", id, tenant, req.device_name, req.model_name, req.serial_number, req.topic)
                            .execute(&core.db)
                            .await
                            .unwrap();


                    }
                    CheckinCommand::TokenUpdate(req) => {
                        // TODO: We got to handle this
                        // assert_eq!(req.awaiting_configuration.unwrap_or(true), true);

                        // req.topic
                        // req.token
                        // req.push_magic
                        // req.unlock_token
                    }
                    CheckinCommand::DeclarativeManagement(req) => todo!(),
                    CheckinCommand::UserAuthenticate(req) => todo!(),
                    CheckinCommand::CheckOut(req) => todo!(),
                    CheckinCommand::SetBootstrapToken(req) => todo!(),
                    CheckinCommand::GetBootstrapToken(req) => {
                        // TODO: Handle this
                        // assert_eq!(req.awaiting_configuration.unwrap_or(true));
                    }

                };



                r#"<?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN"
                "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
                <plist version="1.0">
                <dict>
                </dict>
                </plist>"#
            }),
        )
        // TODO: move into device API
        .route(
            "/apple/ping",
            get(|State(core): State<Core>| async move {
                let tenants = sqlx::query!("SELECT * FROM tenant")
                    .fetch_all(&core.db)
                    .await
                    .unwrap();

                let devices = sqlx::query!("SELECT * FROM device")
                    .fetch_all(&core.db)
                    .await
                    .unwrap();

                // TODO: Reusing the client
                // let client = a2

                println!("{devices:?}");

                "ok"
            })
        )
        // TODO: Break this all out into `scep` crate and make it sans-io
        .route(
            "/apple/scep",
            get(|State(core): State<Core>, query: Query<ScepQuery>| async move {
                match &*query.operation {
                    "GetCACert" => {
                        let (cert, _) = core.device_ca.active_signer(&core).await.unwrap().unwrap(); // TODO: What if the active signer changes between SCEP requests?

                        (
                          [(header::CONTENT_TYPE, "application/x-x509-ca-cert")],
                          cert.encode_der().unwrap()
                        ).into_response()
                    }
                    "GetNextCACert" => todo!(),
                    "GetCACaps" => {
                        // TODO: Confirm we infact support these
                        let caps = [
                            "Renewal",
                            "SHA-1",
                            "SHA-256",
                            "AES",
                            "DES3",
                            "SCEPStandard",
                            "POSTPKIOperation",
                        ];

                        caps.join("\n").into_response()
                    }
                    "PKIOperation" => todo!(), // Technically this is allowed???
                    // TODO: Does the SCEP spec have something for errors?
                    _ => StatusCode::NOT_FOUND.into_response(),
                }
            }),
        )
        .route(
            "/apple/scep",
            post(|State(core): State<Core>, req: Parts, query: Query<ScepQuery>, body: Bytes| async move {
                // 4.3. > Note that when used with HTTP POST, the only OPERATION possible is "PKIOperation"
                match &*query.operation {
                    "PKIOperation" => {
                        let (cert, key) = core.device_ca.active_signer(&core).await.unwrap().unwrap(); // TODO: What if the active signer changes between SCEP requests?

                        // println!("{:?}", req.headers.get("Content-Type")); // application/x-pki-message

                       let scep = scep::Scep::new(());

                       let msg = scep.pki_operation(&body).unwrap();
                       println!("{:?}", msg);


                       let result = msg.decrypt_pki_envelope(&cert, &key).unwrap();

                       // // TODO: Can we cache this into `msg` cause `success` does it too.
                       // let csr = CertificateSigningRequest::from_der(&result).unwrap();
                       // let challenge = csr.get_oid(OID_SCEP_CHALLENGE);
                       // todo!("GOT CHALLENGE {challenge:?}");


                       let result = msg.success(&cert, &key, result).unwrap();

                       (
                         [(header::CONTENT_TYPE, "application/x-pki-message")],
                         result
                       ).into_response()
                    },
                    // TODO: Does the SCEP spec have something for errors?
                    _ => StatusCode::NOT_FOUND.into_response(),
                }
            }),
        )
}

#[derive(Deserialize)]
pub struct ScepQuery {
    operation: String,
    message: Option<String>,
}
