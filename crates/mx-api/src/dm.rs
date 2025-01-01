use axum::{
    body::Bytes,
    http::{header, request::Parts},
    response::Html,
    routing::{get, post},
    Router,
};
use cms::{cert::x509::der::Decode, content_info::ContentInfo, enveloped_data::EnvelopedData};
use mx_apple::{EnrollMobileConfig, EnrollMobileConfigPayloadContent};

use crate::utils::{include_static, Static};

static MDM_HTML: Static = include_static!("mdm.html");

pub(crate) fn mount() -> Router {
    Router::new()
        .route("/mdm", get(|| async { Html(MDM_HTML) }))
        .route("/windows/enroll", get(|| async { todo!() }))
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
                    payload_content: vec![EnrollMobileConfigPayloadContent {
                        challenge: challenge,
                        // TODO: Work this out properly // TODO: I think this might be the SCEP endpoint?
                        url: "http://localhost:9000/apple/enroll".to_string(),
                        device_attributes: vec![
                            "UDID".to_string(),
                            "PRODUCT".to_string(),
                            "SERIAL".to_string(),
                            "DEVICE_NAME".to_string(),
                        ],
                    }],
                };

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
                // application/pkcs7-signature
                println!("GOT {body:?}");

                let ci = EnvelopedData::from_der(&body).unwrap();
                println!("{ci:?}");

                "todo"
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
