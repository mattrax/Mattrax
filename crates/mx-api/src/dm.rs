use axum::{
    body::Bytes,
    http::{header, request::Parts, StatusCode},
    response::{Html, IntoResponse, Redirect},
    routing::{get, post},
    Router,
};
use mx_apple::{
    parse_and_verify_pkcs7, DeviceAttributes, EnrollMobileConfig, EnrollMobileConfigPayloadContent,
};
use tracing::{error, warn};

use crate::utils::{include_static, Static};

static MDM_HTML: Static = include_static!("mdm.html");

pub(crate) fn mount() -> Router {
    Router::new()
        .route("/mdm", get(|| async { Html(MDM_HTML) }))
        .route("/windows/enroll", get(|| async { todo!() }))
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
            "/apple/enroll",
            get(|| async {
                // TODO: Properly determine this
                let tenant_name = "Acme School Inc".to_string();
                // TODO: Proper auth
                let challenge = "83084c31-55c7-495b-9a6b-aec2094d2769".to_string();

                let config = EnrollMobileConfig {
                    payload_description: format!(
                        "Automatic configuration of your {tenant_name} device."
                    ),
                    payload_display_name: tenant_name.clone(),
                    // TODO: I think this should indicate the teanant
                    payload_identifier: "00000000-0000-0000-A000-4A414D460009".to_string(),
                    payload_organization: tenant_name.clone(),
                    // payload_removal_disallowed: false, // TODO
                    // payload_scope: "System".to_string(), // TODO
                    payload_type: "Profile Service".into(),
                    payload_uuid: Default::default(),
                    payload_version: 1,
                    payload_content: EnrollMobileConfigPayloadContent {
                        challenge,
                        // TODO: Work this out properly // TODO: I think this might be the SCEP endpoint?
                        url: "http://10.0.0.11:9000/apple/connect".to_string(),
                        device_attributes: vec![
                            "UDID".to_string(),
                            "PRODUCT".to_string(),
                            "SERIAL".to_string(),
                            "VERSION".to_string(),
                            "DEVICE_NAME".to_string(),
                            // TODO: `MEID`, `IMEI`?
                        ],
                    },
                };

                // TODO: Sign the profile
                // signed_profile = OpenSSL::PKCS7.sign(@@ssl_cert, @@ssl_key,
                //             configuration, [], OpenSSL::PKCS7::BINARY)
                //     res.body = signed_profile.to_der

                (
                    [
                        (header::CONTENT_TYPE, "application/x-apple-aspen-config"),
                        (
                            header::CONTENT_DISPOSITION,
                            "attachment; filename=\"enroll.mobileconfig\"",
                        ),
                    ],
                    config.serialize(),
                )
            }),
        )
        .route(
            "/apple/connect",
            post(|req: Parts, body: Bytes| async move {
                (req.headers.get("Content-Type").map(|v| v.as_bytes())
                    == Some(b"application/pkcs7-signature"))
                .then_some(())
                // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                // but this specific status will be stored in the `mdmclient` logs.
                .ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;

                let payload = parse_and_verify_pkcs7(&body, &[&*mx_apple::APPLE_IPHONE_DEVICE_CA])
                    .map_err(|err| {
                        warn!("Error verifiying the PKCS7 request: {err:?}");

                        // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                        // but this specific status will be stored in the `mdmclient` logs.
                        StatusCode::FORBIDDEN
                    })?;

                let device_attributes = DeviceAttributes::from_plist(&payload).map_err(|err| {
                    warn!("Failed to parse device attributes: {err:?}");

                    // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                    // but this specific status will be stored in the `mdmclient` logs.
                    StatusCode::BAD_REQUEST
                })?;

                println!("{:?}", device_attributes); // TODO

                // TODO: Verify the challenge token
                // if device_attributes.challenge {}
                // return StatusCode::UNAUTHORIZED;

                // TODO: What if this is the certificate signed by us?

                // payload = general_payload()

                // payload['PayloadIdentifier'] = "com.acme.encrypted-profile-service"
                // payload['PayloadType'] = "Configuration" # do not modify

                // # strings that show up in UI, customisable
                // payload['PayloadDisplayName'] = "Profile Service Enroll"
                // payload['PayloadDescription'] = "Enrolls identity for the encrypted profile service"

                // payload['PayloadContent'] = [scep_cert_payload(request, "Profile Service", challenge)];
                // Plist::Emit.dump(payload)

                Ok::<_, StatusCode>(
                    //     (
                    //     [(header::CONTENT_TYPE, "application/x-apple-aspen-config")],
                    //     "todo", // TODO: Return the plist
                    // )
                    StatusCode::BAD_REQUEST,
                )
            }),
        )
        .route(
            "/apple/checkin",
            post(|body: Bytes| async move {
                println!("GOT {body:?}");
                "todo"
            }),
        )
}
