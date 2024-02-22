use std::{ops::Add, sync::Arc};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{Html, Response},
    routing::{get, post},
    Router,
};
use base64::prelude::*;
use mysql_common::time::OffsetDateTime;
use rcgen::{
    Certificate, CertificateSigningRequestParams, CustomExtension, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, KeyUsagePurpose, SerialNumber
};
use serde::Deserialize;
use sha1::{Digest, Sha1};

use crate::api::Context;

// contains the OID for the Microsoft certificate extension which includes the MDM DeviceID
const MICROSOFT_DEVICE_ID_EXTENSION: &[u64] = &[1, 3, 6, 1, 4, 1, 311, 66, 1, 0];

#[derive(Deserialize)]
pub struct AuthQueryParams {
    pub appru: String,
}

// TODO: Remove this, it's bad.
fn extract_from_xml<'a>(tag_name: &str, body: &'a str) -> &'a str {
    body.split(&format!("<{tag_name}>"))
        .nth(1)
        .unwrap()
        .split(&format!("</{tag_name}>"))
        .next()
        .unwrap()
}

fn extract_from_xml2<'a>(tag_name: &str, end_tag_name: &str, body: &'a str) -> &'a str {
    body.split(tag_name)
        .nth(1)
        .unwrap()
        .split(end_tag_name)
        .next()
        .unwrap()
}

// `/EnrollmentServer`
pub fn mount(state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new()
        // TODO: Move this to SolidJS
        .route("/TermsOfService.svc", get(|| async move {
            Html(r#"<h3>AzureAD Term Of Service</h3><button onClick="acceptBtn()">Accept</button><script>function acceptBtn(){var urlParams=new URLSearchParams(window.location.search);if (!urlParams.has('redirect_uri')){alert('Redirect url not found. Did you open this in your broswer?');}else{window.location=urlParams.get('redirect_uri') + "?IsAccepted=true&OpaqueBlob=TODOCustomDataFromAzureAD";}}</script>"#)
        }))
        // allows the device to tests a domain for the existence of a enrollment server
        .route("/Discovery.svc", get(|| async move {
            StatusCode::OK
        }))
        .route("/Discovery.svc", post(|State(state): State<Arc<Context>>, body: String| async move {
            // TODO: Proper SOAP parsing
            let message_id = extract_from_xml("a:MessageID", &body);

            println!("{:?}", body); // TODO

            // TODO: Proper SOAP generation
            let body = format!(r#"<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
            <s:Header>
                <a:Action s:mustUnderstand="1">http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse</a:Action>
                <ActivityId CorrelationId="8c6060c4-3d78-4d73-ae17-e8bce88426ee" xmlns="http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics">8c6060c4-3d78-4d73-ae17-e8bce88426ee</ActivityId>
                <a:RelatesTo>{}</a:RelatesTo>
            </s:Header>
            <s:Body>
                <DiscoverResponse xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">
                    <DiscoverResult>
                        <AuthPolicy>Federated</AuthPolicy>
                        <EnrollmentVersion>5.0</EnrollmentVersion>
                        <EnrollmentPolicyServiceUrl>https://{1}/EnrollmentServer/Policy.svc</EnrollmentPolicyServiceUrl>
                        <EnrollmentServiceUrl>https://{1}/EnrollmentServer/Enrollment.svc</EnrollmentServiceUrl>
                        <AuthenticationServiceUrl>https://{2}/api/enrollment/login</AuthenticationServiceUrl>
                    </DiscoverResult>
                </DiscoverResponse>
            </s:Body>
        </s:Envelope>"#,
        message_id,
        state.config.get().enrollment_domain,
        // TODO: From config
        "cloud.mattrax.app"
    );

            Response::builder()
                .header("Content-Type", "application/soap+xml; charset=utf-8")
                // This header is important. The Windows MDM client doesn't like chunked encodings.
                .header("Content-Length", body.len())
                .body(body)
                .unwrap()
        }))
        .route("/Policy.svc", post(|body: String| async move {
            // TODO: Proper SOAP parsing
            let message_id = extract_from_xml("a:MessageID", &body);
            let binary_security_token = extract_from_xml2(r#"<wsse:BinarySecurityToken ValueType="http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentUserToken" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">"#, "</wsse:BinarySecurityToken>", &body);
            // ^ binary_security_token is base64 encoded "TODOSpecialTokenWhichVerifiesAuth"

            // TODO: Authentication
            println!("{}", String::from_utf8_lossy(&BASE64_STANDARD.decode(binary_security_token).unwrap()));

            let body = format!(r#"<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing"><s:Header><a:Action s:mustUnderstand="1">http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPoliciesResponse</a:Action><ActivityId xmlns="http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics" CorrelationId="todo">todo</ActivityId><a:RelatesTo>urn:uuid:{}</a:RelatesTo></s:Header><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><GetPoliciesResponse xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy"><response><policyID>mattrax-identity</policyID><policyFriendlyName>Mattrax Identity Certificate Policy</policyFriendlyName><nextUpdateHours xsi:nil="true"></nextUpdateHours><policiesNotChanged xsi:nil="true"></policiesNotChanged><policies><policy><policyOIDReference>0</policyOIDReference><cAs xsi:nil="true"></cAs><attributes><policySchema>3</policySchema><privateKeyAttributes><minimalKeyLength>4096</minimalKeyLength><keySpec xsi:nil="true"></keySpec><keyUsageProperty xsi:nil="true"></keyUsageProperty><permissions xsi:nil="true"></permissions><algorithmOIDReference xsi:nil="true"></algorithmOIDReference><cryptoProviders xsi:nil="true"></cryptoProviders></privateKeyAttributes><supersededPolicies xsi:nil="true"></supersededPolicies><privateKeyFlags xsi:nil="true"></privateKeyFlags><subjectNameFlags xsi:nil="true"></subjectNameFlags><enrollmentFlags xsi:nil="true"></enrollmentFlags><generalFlags xsi:nil="true"></generalFlags><hashAlgorithmOIDReference>0</hashAlgorithmOIDReference><rARequirements xsi:nil="true"></rARequirements><keyArchivalAttributes xsi:nil="true"></keyArchivalAttributes><extensions xsi:nil="true"></extensions></attributes></policy></policies></response><cAs></cAs><oIDs><policyOIDReference>0</policyOIDReference><defaultName>szOID_OIWSEC_SHA256</defaultName><group>2</group><value>2.16.840.1.101.3.4.2.1</value></oIDs></GetPoliciesResponse></s:Body></s:Envelope>"#, message_id);

            Response::builder()
                .header("Content-Type", "application/soap+xml; charset=utf-8")
                // This header is important. The Windows MDM client doesn't like chunked encodings.
                .header("Content-Length", body.len())
                .body(body)
                .unwrap()
        }))
        .route("/Enrollment.svc", post(|State(state): State<Arc<Context>>, body: String| async move {
            println!("{}\n", body);

            // TODO: Proper SOAP parsing
            let message_id = extract_from_xml("a:MessageID", &body);
            let binary_security_token = extract_from_xml2(r#"<wsse:BinarySecurityToken ValueType="http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">"#, "</wsse:BinarySecurityToken>", &body);

            let decoded_bst = BASE64_STANDARD.decode(binary_security_token.replace("\r\n", "")).unwrap();
            let mut csr = CertificateSigningRequestParams::from_der(&decoded_bst).unwrap();

            println!("{:?}", csr.params.distinguished_name);

            // Version:               csr.Version,
            // Signature:             csr.Signature,
            // SignatureAlgorithm:    csr.SignatureAlgorithm,
            // PublicKey:             csr.PublicKey,
            // PublicKeyAlgorithm:    csr.PublicKeyAlgorithm,
            csr.params.distinguished_name = DistinguishedName::new();
            csr.params.distinguished_name.push(DnType::CommonName, "Device".to_string()); // TODO: Rcgen
            // Issuer:
            csr.params.serial_number = Some(SerialNumber::from_slice(&[1])); // TODO: Encode proper Rust int type into the bytes
            csr.params.not_before = OffsetDateTime::now_utc();
            csr.params.not_after = csr.params.not_before.clone().add(time::Duration::days(365));
            csr.params.key_usages = vec![KeyUsagePurpose::DigitalSignature, KeyUsagePurpose::KeyEncipherment];
            csr.params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
            // BasicConstraintsValid: true, // TODO
            csr.params.is_ca = IsCa::ExplicitNoCa;
            csr.params.custom_extensions = vec![
                CustomExtension::from_oid_content(MICROSOFT_DEVICE_ID_EXTENSION, "TODO".as_bytes().to_vec()),
            ];           

            println!("{:?} {:?}", csr.params.not_after, csr.params.not_before); // TODO

            let certificate = Certificate::from_request(csr, &state.identity_cert, &state.identity_key).unwrap();

            let cert_store = "User";
            // if enrollmentType == "Device" {
            // 	cert_store = "System"
            // }

            let domain = "https://mdm.mattrax.app"; // TODO: Don't hardcode it

            let mut hasher = Sha1::new();
            hasher.update(state.identity_cert.der());
            let identity_cert_fingerprint =  hasher.finalize();
            let identity_cert_fingerprint =  hex::encode(&identity_cert_fingerprint).to_uppercase();

            let root_certificate_der = BASE64_STANDARD.encode(state.identity_cert.der());

            let mut hasher = Sha1::new();
            hasher.update(certificate.der());
            let signed_client_cert_fingerprint = hasher.finalize();
            let signed_client_cert_fingerprint = hex::encode(&signed_client_cert_fingerprint).to_uppercase();

            
            let client_ctr_raw = BASE64_STANDARD.encode(certificate.der());
            
            let ssl_client_cert_search_criteria = format!("Subject={}&amp;Stores=MY%5C{cert_store}", urlencoding::encode("CN=Device"));
            // TODO: Derive subject from the certificate - `certificate.get_params().distinguished_name()`
            

            // TODO: Remove the device from the DB if it doesn't do an initial checkin within a certain time period
            // TODO: Get all this information from parsing the request.
            let tenant_pk: i32 = 5;
            state.db.create_device(cuid2::create_id(), "TODO".into(), "Windows".into(), "Mind your own business".into(), tenant_pk).await.unwrap();
            
            // TODO: Get the device's DB id and put into this
            // TODO: Lookup and set tenant name
            let wap_provisioning_profile = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
            <wap-provisioningdoc version="1.1">
                <characteristic type="CertificateStore">
                    <characteristic type="Root">
                        <characteristic type="System">
                            <characteristic type="{identity_cert_fingerprint}">
                                <parm name="EncodedCertificate" value="{root_certificate_der}" />
                            </characteristic>
                        </characteristic>
                    </characteristic>
                    <characteristic type="My">
                        <characteristic type="{cert_store}">
                            <characteristic type="{signed_client_cert_fingerprint}">
                                <parm name="EncodedCertificate" value="{client_ctr_raw}" />
                            </characteristic>
                            <characteristic type="PrivateKeyContainer">
                                <param name="KeySpec" value="2" />
                                <param name="ProviderName" value="ConfigMgrEnrollment" />
                                <param name="ProviderType" value="1" />
                            </characteristic>
                        </characteristic>
                    </characteristic>
                </characteristic>
                <characteristic type="APPLICATION">
                    <parm name="APPID" value="w7" />
                    <parm name="PROVIDER-ID" value="Mattrax" />
                    <parm name="NAME" value="Mattrax MDM" />
                    <parm name="ADDR" value="{domain}/ManagementServer/Manage.svc" />
                    <parm name="ServerList" value="{domain}/ManagementServer/ServerList.svc" />
                    <parm name="ROLE" value="4294967295" />
                    <parm name="BACKCOMPATRETRYDISABLED" />
                    <parm name="DEFAULTENCODING" value="application/vnd.syncml.dm+xml" />
                    <parm name="SSLCLIENTCERTSEARCHCRITERIA" value="{ssl_client_cert_search_criteria}" />
                    <characteristic type="APPAUTH">
                        <parm name="AAUTHLEVEL" value="CLIENT" />
                        <parm name="AAUTHTYPE" value="DIGEST" />
                        <parm name="AAUTHSECRET" value="dummy" />
                        <parm name="AAUTHDATA" value="nonce" />
                    </characteristic>
                    <characteristic type="APPAUTH">
                        <parm name="AAUTHLEVEL" value="APPSRV" />
                        <parm name="AAUTHTYPE" value="DIGEST" />
                        <parm name="AAUTHNAME" value="dummy" />
                        <parm name="AAUTHSECRET" value="dummy" />
                        <parm name="AAUTHDATA" value="nonce" />
                    </characteristic>
                </characteristic>
                <characteristic type="DMClient">
                    <characteristic type="Provider">
                        <characteristic type="DEMO MDM">
                            <parm name="SyncApplicationVersion" value="5.0" datatype="string" />
                            <characteristic type="Poll">
                                <parm name="NumberOfFirstRetries" value="8" datatype="integer" />
                            </characteristic>
                        </characteristic>
                    </characteristic>
                </characteristic>
            </wap-provisioningdoc>"#);

            let wap_provisioning_profile_encoded = BASE64_STANDARD.encode(wap_provisioning_profile.replace("\n\t", ""));

            let body  = format!(r#"<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://www.w3.org/2005/08/addressing"
            xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
            <s:Header>
                <a:Action s:mustUnderstand="1">http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep</a:Action>
                <a:RelatesTo>{message_id}</a:RelatesTo>
                <o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">
                    <u:Timestamp u:Id="_0">
                        <u:Created>2018-11-30T00:32:59.420Z</u:Created>
                        <u:Expires>2018-12-30T00:37:59.420Z</u:Expires>
                    </u:Timestamp>
                </o:Security>
            </s:Header>
            <s:Body>
                <RequestSecurityTokenResponseCollection xmlns="http://docs.oasis-open.org/ws-sx/ws-trust/200512">
                    <RequestSecurityTokenResponse>
                        <TokenType>http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken</TokenType>
                        <DispositionMessage xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollment"></DispositionMessage>
                        <RequestedSecurityToken>
                            <BinarySecurityToken xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" ValueType="http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">{wap_provisioning_profile_encoded}</BinarySecurityToken>
                        </RequestedSecurityToken>
                        <RequestID xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollment">0</RequestID>
                    </RequestSecurityTokenResponse>
                </RequestSecurityTokenResponseCollection>
            </s:Body>
        </s:Envelope>"#);


            Response::builder()
                .header("Content-Type", "application/soap+xml; charset=utf-8")
                // This header is important. The Windows MDM client doesn't like chunked encodings.
                .header("Content-Length", body.len())
                .body(body)
                .unwrap()
        }))
        .with_state(state)
}
