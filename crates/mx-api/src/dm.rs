use std::{ptr::write, str::FromStr, sync::atomic::AtomicBool};

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header, request::Parts, StatusCode},
    response::{Html, IntoResponse, Redirect},
    routing::{get, post, put},
    Router,
};
use base64::{prelude::BASE64_STANDARD, Engine};
use bcder::Oid;
use cryptographic_message_syntax::{asn1::rfc5652::EncryptedData, SignedData};
use mx_apple::{
    parse_and_verify_pkcs7, DeviceAttributes, EnrollMobileConfig, EnrollMobileConfigPayloadContent,
};
use openssl::{
    cipher::Cipher,
    pkcs7::{Pkcs7, Pkcs7Flags},
    stack::Stack,
    symm,
    x509::X509,
};
use rcgen::CertificateSigningRequestParams;
use rsa::{pkcs8::EncodePrivateKey, RsaPrivateKey};
use rustls_pki_types::CertificateSigningRequestDer;
use serde::{Deserialize, Serialize};
use tokio::{fs, runtime::Handle};
use tracing::{error, warn};
use x509_certificate::{
    rfc3280::{self, AttributeValue, Name, RdnSequence, RelativeDistinguishedName},
    rfc4519::OID_ORGANIZATION_NAME,
    rfc5280::{self, Certificate},
    rfc5652, InMemorySigningKeyPair, KeyAlgorithm, X509CertificateBuilder,
};
use x509_verify::{
    der::{oid::db::rfc5912::SHA_256_WITH_RSA_ENCRYPTION, Decode, DecodePem, Encode, EncodePem},
    x509_cert::{self, request::CertReq},
};

use crate::{
    utils::{include_static, Static},
    Core,
};

static MDM_HTML: Static = include_static!("mdm.html");

mod apple;
pub mod device_ca;
mod windows;

pub(crate) fn mount() -> Router<Core> {
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
            post(|State(core): State<Core>, req: Parts, body: Bytes| async move {
                // println!("GOT {body:?}\n\n\n");

                // println!("{:?}", req.headers);
                // std::fs::write("./body", &body).unwrap();

            // static TODO: AtomicBool = AtomicBool::new(false);

            // if TODO.swap(true, std::sync::atomic::Ordering::SeqCst) {
            //     // println!("PROXY");
            //     // let resp = reqwest::Client::new()
            //     //     .post("https://mdm-na1.jamfcloud.com/mdm/enroll/fyc746/ota")
            //     //     .headers(req.headers.clone())
            //     //     .body(body)
            //     //     .send()
            //     //     .await
            //     //     .unwrap();

            //     // println!("{:?}", resp);

            //     // let headers = resp.headers().clone();
            //     // let body = resp.text().await.unwrap();
            //     // println!("{:?} {:?}", headers, body);

            //     // return (headers, body).into_response();
            // } else {
            //     println!("DONT PROXY");
            // }

                // todo.text().await.unwrap();
                // println!("{todo:?}");

                (req.headers.get("Content-Type").map(|v| v.as_bytes())
                    == Some(b"application/pkcs7-signature"))
                .then_some(())
                // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                // but this specific status will be stored in the `mdmclient` logs.
                .ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;

                // TODO: This should verify again any of the trusted CAs
                let (cert, _) = core.device_ca.active_signer(&core).unwrap();
                let cert = x509_cert::Certificate::from_der(&cert.encode_der().unwrap()).unwrap();
                if let Ok((payload, p7)) = parse_and_verify_pkcs7(&body, &[&cert]) {
                    println!("THE DEVICE CERT IS PRESENT");

                    return Ok::<_, StatusCode>((
                        [(header::CONTENT_TYPE, "application/x-apple-aspen-config")],
                        // TODO: Generate the plist
                        // TODO: Sign the plist
    format!(r#"<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>IdentityCertificateUUID</key>
			<string>2CCAF8CF-47C1-4E9E-B79F-68AB9A6FE4D8</string>
			<key>PayloadDisplayName</key>
			<string>MDM</string>
			<key>PayloadIdentifier</key>
			<string>com.apple.mdm.03333ECE-42AB-4D19-B1A3-E4DA0CE19B17</string>
			<key>PayloadType</key>
			<string>com.apple.mdm</string>
			<key>PayloadUUID</key>
			<string>03333ECE-42AB-4D19-B1A3-E4DA0CE19B17</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>CheckInURL</key>
			<string>http://localhost:9000/apple/checkin</string>
			<key>ServerURL</key>
			<string>http://localhost:9000/apple/checkin</string>
			<key>Topic</key>
			<string>com.apple.mgmt.External.1f177712-f5de-4474-8ea6-3c87a33fa441</string>
			<key>AccessRights</key>
			<integer>8191</integer>
			<key>CheckOutWhenRemoved</key>
			<true/>
			<key>SignMessage</key>
			<false/>
			<key>ServerCapabilities</key>
			<array>
				<string>com.apple.mdm.bootstraptoken</string>
				<string>com.apple.mdm.per-user-connections</string>
			</array>
		</dict>
		<dict>
				<key>PayloadDisplayName</key>
				<string>SCEP</string>
				<key>PayloadIdentifier</key>
				<string>3ECD4D25-089A-48F4-9408-759674F35DE8</string>
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
					<string>http://localhost:9000/apple/scep</string>
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
	<key>PayloadDisplayName</key>
	<string>Untitled</string>
	<key>PayloadIdentifier</key>
	<string>Oscars-MacBook-Pro.85DC3617-10B4-4FFB-BFDE-DADD23E03EE5</string>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>85DC3617-10B4-4FFB-BFDE-DADD23E03EE5</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
        </dict>
    </plist>"#)
                    ))

//                     let payload = br#"<?xml version="1.0" encoding="UTF-8"?>
//                     <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
//                     <plist version="1.0">
//                     <dict>
// 	<key>PayloadContent</key>
// 	<array>
// 		<dict>
// 			<key>IdentityCertificateUUID</key>
// 			<string>3ECD4D25-089A-48F4-9408-759674F35DE8</string>
// 			<key>PayloadDisplayName</key>
// 			<string>MDM</string>
// 			<key>PayloadIdentifier</key>
// 			<string>com.apple.mdm.03333ECE-42AB-4D19-B1A3-E4DA0CE19B17</string>
// 			<key>PayloadType</key>
// 			<string>com.apple.mdm</string>
// 			<key>PayloadUUID</key>
// 			<string>03333ECE-42AB-4D19-B1A3-E4DA0CE19B17</string>
// 			<key>PayloadVersion</key>
// 			<integer>1</integer>
// 			<key>ServerURL</key>
// 			<string>https://example.com</string>
// 			<key>Topic</key>
// 			<string>com.apple.mgmt.External.1f177712-f5de-4474-8ea6-3c87a33fa441</string>
// 		</dict>
// 	</array>
// 	<key>PayloadDisplayName</key>
// 	<string>Untitled</string>
// 	<key>PayloadIdentifier</key>
// 	<string>Oscars-MacBook-Pro.85DC3617-10B4-4FFB-BFDE-DADD23E03EE5</string>
// 	<key>PayloadType</key>
// 	<string>Configuration</string>
// 	<key>PayloadUUID</key>
// 	<string>85DC3617-10B4-4FFB-BFDE-DADD23E03EE5</string>
// 	<key>PayloadVersion</key>
// 	<integer>1</integer>
//                     </dict>
//                     </plist>
// "#;

//                     let mut certs = Stack::new().unwrap();
//                     for cert in p7.certificates() {
//                         certs.push(X509::from_der(&cert.encode_ber().unwrap()).unwrap()).unwrap();
//                     }

//                   let encrypted_profile = Pkcs7::encrypt(
//                       &certs,
//                       &payload,
//                       symm::Cipher::aes_256_cbc(),
//                       Pkcs7Flags::BINARY,
//                   ).unwrap();


//                   let encrypted_payload_content = BASE64_STANDARD.encode(b"todo");

//   //               		<key>EncryptedPayloadContent</key>
// 		// <data>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</data>

//                   return Ok::<_, StatusCode>((
//                       [(header::CONTENT_TYPE, "application/x-apple-aspen-config")],
//                       // TODO: Generate the plist
//                       // TODO: Sign the plist
//   format!(r#"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>
//   <!DOCTYPE plist PUBLIC \"-//Apple Inc//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n
//   <plist version=\"1.0\">
// 	<dict>
// 	    <key>EncryptedPayloadContent</key>
// 		<data>{encrypted_payload_content}</data>
// 		<key>PayloadDisplayName</key>
// 		<string>Acme School Inc Enrollment</string>
// 		<key>PayloadIdentifier</key>
// 		<string>com.mattrax.encrypted-profile-service</string>
// 		<key>PayloadOrganization</key>
// 		<string>Oscar Technologies Inc</string>
// 		<key>PayloadRemovalDisallowed</key>
// 		<false/>
// 		<key>PayloadScope</key>
// 		<string>User</string>
// 		<key>PayloadType</key>
// 		<string>Configuration</string>
// 		<key>PayloadUUID</key>
// 		<string>ff424f60-b4cc-464c-b0c9-7e6a8188f97c</string>
// 		<key>PayloadVersion</key>
// 		<integer>1</integer>
// 	</dict>
//   </plist>"#)
//                   ))
                };

                let payload = parse_and_verify_pkcs7(&body, &[&*mx_apple::APPLE_IPHONE_DEVICE_CA])
                    .map_err(|err| {
                        warn!("Error verifiying the PKCS7 request: {err:?}");

                        // The user will see "Could not obtain the final profile using the Encrypted Profile Service."
                        // but this specific status will be stored in the `mdmclient` logs.
                        StatusCode::FORBIDDEN
                    })?;

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
		<string>3ECD4D25-089A-48F4-9408-759674F35DE8</string>
		<key>PayloadVersion</key>
		<integer>1</integer>
		<key>PayloadContent</key>
		<array>
			<dict>
				<key>PayloadDisplayName</key>
				<string>SCEP</string>
				<key>PayloadIdentifier</key>
				<string>3ECD4D25-089A-48F4-9408-759674F35DE8</string>
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
					<string>http://localhost:9000/apple/scep</string>
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
</plist>"#.to_string()
                ))
            }),
        )
        .route(
            "/apple/checkin",
            put(|State(core): State<Core>, req: Parts, body: Bytes| async move {
                println!("GOT {body:?}");

                r#"<?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN"
                "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
                <plist version="1.0">
                <dict>
                </dict>
                </plist>"#
            }),
        )
        // TODO: Break this all out into `scep` crate and make it sans-io
        .route(
            "/apple/scep",
            get(|State(core): State<Core>, query: Query<ScepQuery>| async move {
                match &*query.operation {
                    "GetCACert" => {
                        let (cert, _) = core.device_ca.active_signer(&core).unwrap(); // TODO: What if the active signer changes between SCEP requests?

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
                        let (cert, key) = core.device_ca.active_signer(&core).unwrap(); // TODO: What if the active signer changes between SCEP requests?

                       println!("{:?}",  req.headers.get("Content-Type")); // application/x-pki-message

                       let scep = scep::Scep::new(());

                       let msg = scep.pki_operation(&body).unwrap();
                       println!("{:?}", msg);

                       let result = msg.decrypt_pki_envelope(cert.encode_der().unwrap(), key.to_pkcs8_one_asymmetric_key_der().to_vec()).unwrap();

                       let result = msg.success(cert.encode_der().unwrap(), key.to_pkcs8_one_asymmetric_key_der().to_vec(), result).unwrap();

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
        .route(
            "/apple/todo",
            get(|State(core): State<Core>| async move {
                // TODO: Create CSR

                let mut todo = X509CertificateBuilder::default();
                todo.subject().append_printable_string(Oid(OID_ORGANIZATION_NAME.as_ref().into()), "Testing").unwrap(); // TODO: Configure org name
                todo.subject().append_utf8_string(
                    // TODO: Make constant
                    // emailAddressOID defined by https://oidref.com/1.2.840.113549.1.9.1
                    Oid::from_str("1.2.840.113549.1.9.1").unwrap(),
                    // TODO: Configurable
                    "oscar@otbeaumont.me").unwrap();

                // TODO: RSA is not supported by `x509-certificate`. Cringe
               let csr_pem = {
                   let mut rng = rand::thread_rng();
                   let bits = 2048;
                   let key = RsaPrivateKey::new(&mut rng, bits).unwrap();

                   let keypair = InMemorySigningKeyPair::from_pkcs8_der(key.to_pkcs8_der().unwrap().as_bytes()).unwrap();
                   let csr = todo.create_certificate_signing_request(&keypair).unwrap();
                   csr.encode_pem().unwrap()
               };

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
                println!("{:?}", resp.csr);

                // Save as
                BASE64_STANDARD.decode(resp.csr.as_bytes()).unwrap()
            })
        )
}

#[derive(Deserialize)]
pub struct ScepQuery {
    operation: String,
    message: Option<String>,
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
