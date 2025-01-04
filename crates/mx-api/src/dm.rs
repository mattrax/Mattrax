use axum::{
    body::Bytes,
    extract::Query,
    http::{header, request::Parts, StatusCode},
    response::{Html, IntoResponse, Redirect},
    routing::{get, post},
    Router,
};
use mx_apple::{
    parse_and_verify_pkcs7, DeviceAttributes, EnrollMobileConfig, EnrollMobileConfigPayloadContent,
};
use serde::Deserialize;
use tracing::{error, warn};
use x509_certificate::rfc3280::Name;

use crate::utils::{include_static, Static};

static MDM_HTML: Static = include_static!("mdm.html");

mod apple;
pub mod device_ca;
mod windows;

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
                // TODO: We should probally error out if their are not any valid certificates
                // TODO: Disable the cache when no valid certificates are found.

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
                        challenge: "73ede825-57f7-4cbc-bd08-97fb903e4bef".into(), // TODO
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
                // println!("GOT {body:?}\n\n\n");

                // println!("{:?}", req.headers);
                // std::fs::write("./body", &body).unwrap();

                // let resp = reqwest::Client::new()
                //     .post("https://mdm-na1.jamfcloud.com/mdm/enroll/fyc746/ota")
                //     .headers(req.headers.clone())
                //     .body(body)
                //     .send()
                //     .await
                //     .unwrap();

                // println!("{:?}", resp);

                // let headers = resp.headers().clone();
                // let body = resp.text().await.unwrap();
                // println!("{:?} {:?}", headers, body);

                // return (headers, bytes);

                // todo.text().await.unwrap();
                // println!("{todo:?}");

                // (req.headers.get("Content-Type").map(|v| v.as_bytes())
                //     == Some(b"application/pkcs7-signature"))
                // .then_some(())
                // // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                // // but this specific status will be stored in the `mdmclient` logs.
                // .ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;

                // let payload = parse_and_verify_pkcs7(&body, &[&*mx_apple::APPLE_IPHONE_DEVICE_CA])
                //     .map_err(|err| {
                //         warn!("Error verifiying the PKCS7 request: {err:?}");

                //         // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                //         // but this specific status will be stored in the `mdmclient` logs.
                //         StatusCode::FORBIDDEN
                //     })?;

                // let device_attributes = DeviceAttributes::from_plist(&payload).map_err(|err| {
                //     warn!("Failed to parse device attributes: {err:?}");

                //     // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                //     // but this specific status will be stored in the `mdmclient` logs.
                //     StatusCode::BAD_REQUEST
                // })?;

                // println!("{:?}", device_attributes); // TODO

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

                // TODO: https://scep-proxy-na1.jamfcloud.com/scep/43704D49-87C6-5B75-8631-A7367A5FDA1B

                Ok::<_, StatusCode>((
                    [(header::CONTENT_TYPE, "application/x-apple-aspen-config")],
                    // TODO: Generate the plist
                    // TODO: Sign the plist
r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE plist PUBLIC "-//Apple Inc//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
	<dict>
		<key>PayloadDisplayName</key>
		<string>Oscar Technologies Inc SCEP Profile</string>
		<key>PayloadIdentifier</key>
		<string>77b464d6-4f40-4c80-80ea-5ae81322f92e</string>
		<key>PayloadOrganization</key>
		<string>Oscar Technologies Inc</string>
		<key>PayloadRemovalDisallowed</key>
		<true/>
		<key>PayloadType</key>
		<string>Configuration</string>
		<key>PayloadUUID</key>
		<string>77b464d6-4f40-4c80-80ea-5ae81322f92e</string>
		<key>PayloadVersion</key>
		<integer>1</integer>
		<key>PayloadContent</key>
		<array>
			<dict>
				<key>PayloadDisplayName</key>
				<string>SCEP</string>
				<key>PayloadIdentifier</key>
				<string>2CCAF8CF-47C1-4E9E-B79F-68AB9A6FE4D8</string>
				<key>PayloadOrganization</key>
				<string>Oscar Technologies Inc</string>
				<key>PayloadType</key>
				<string>com.apple.security.scep</string>
				<key>PayloadUUID</key>
				<string>2CCAF8CF-47C1-4E9E-B79F-68AB9A6FE4D8</string>
				<key>PayloadVersion</key>
				<integer>1</integer>
				<key>PayloadContent</key>
				<dict>
					<key>Challenge</key>
					<string>46F4324845EAB13089FB7049A12769D6</string>
					<key>Key Usage</key>
					<integer>5</integer>
					<key>Keysize</key>
					<integer>2048</integer>
					<key>Name</key>
					<string>jamfnow</string>
					<key>URL</key>
					<string>http://10.0.0.11:9000/apple/scep</string>
					<key>Subject</key>
					<array>
						<array>
							<array>
								<string>CN</string>
								<string>jamfnow.com</string>
							</array>
						</array>
					</array>
				</dict>
			</dict>
		</array>
	</dict>
</plist>"#
                ))
            }),
        )
        .route(
            "/apple/checkin",
            post(|body: Bytes| async move {
                println!("GOT {body:?}");
                "todo"
            }),
        )
        // TODO: Break this all out into `scep` crate and make sans-io
        .route(
            "/apple/scep",
            get(|query: Query<ScepQuery>| async move {
                match &*query.operation {
                    "GetCACert" => {
                        (
                          [(header::CONTENT_TYPE, "application/x-x509-ca-cert")],
                         "todo"
                        ).into_response()
                    }
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
