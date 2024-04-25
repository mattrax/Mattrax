use std::{collections::BTreeMap, ops::Add, sync::Arc};

use axum::{
    extract::State,
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use base64::prelude::*;
use hyper::header;
use jwt::VerifyWithKey;
use ms_mde::{
    Action, ActivityId, BinarySecurityToken, DiscoverRequest, DiscoverResponse,
    DiscoverResponseBody, DiscoverResponseDiscoverResponse, DiscoverResponseDiscoverResult,
    EnrollmentRequest, EnrollmentResponse, EnrollmentResponseBody, RequestHeaderSecurity,
    RequestSecurityTokenResponse, RequestSecurityTokenResponseCollection, RequestedSecurityToken,
    ResponseHeader, ACTIVITY_ID_XMLNS, DISCOVER_ACTION_REQUEST, DISCOVER_ACTION_RESPONSE,
    DISCOVER_RESPONSE_XMLNS, ENROLLMENT_ACTION_REQUEST, ENROLLMENT_ACTION_RESPONSE,
    ENROLLMENT_REQUEST_TYPE_ISSUE, ENROLLMENT_REQUEST_TYPE_RENEW, MICROSOFT_DEVICE_ID_EXTENSION,
    REQUEST_SECURITY_TOKEN_RESPONSE_COLLECTION, REQUEST_SECURITY_TOKEN_TYPE, WSSE_NAMESPACE,
};
use rcgen::{
    Certificate, CertificateSigningRequestParams, CustomExtension, DistinguishedName, DnType,
    ExtendedKeyUsagePurpose, IsCa, KeyUsagePurpose, SerialNumber,
};
use serde::Deserialize;
use sha1::{Digest, Sha1};
use time::OffsetDateTime;
use tracing::error;

use crate::api::Context;

// TODO: Generate from Drizzle
const ENROLLMENT_TYPE_USER: &str = "user";
const ENROLLMENT_TYPE_DEVICE: &str = "device";

// TODO: Generate from Drizzle
const OS_WINDOWS: &str = "Windows";

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
        // allows the device to tests a domain for the existence of a enrollment server
        .route("/Discovery.svc", get(|| async move {
            StatusCode::OK
        }))
        .route("/Discovery.svc", post(|State(state): State<Arc<Context>>, body: String| async move {
            let cmd = match DiscoverRequest::from_str(&body) {
                Ok(cmd) => cmd,
                Err(err) => {
                    // TODO: fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
                    error!("todo: proper soap fault. invalid request body {err:?}");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            };

            if cmd.header.action != DISCOVER_ACTION_REQUEST {
                // TODO: fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
                error!("todo: proper soap fault. invalid action '{}', expected '{}", cmd.header.action, DISCOVER_ACTION_REQUEST);
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }

            // TODO: Posthog metrics on `cmd.body.discover.request.request_version`

            let (enrollment_domain, web_origin) = {
                let config = state.config.get();
                (config.enrollment_domain.clone(), config.cloud.as_ref().and_then(|c| c.frontend.as_ref()).unwrap_or(&config.domain).clone())
            };

            let response = DiscoverResponse {
                header: ResponseHeader {
                    action: Action::from(DISCOVER_ACTION_RESPONSE),
                    activity_id: ActivityId {
                        xmlns: ACTIVITY_ID_XMLNS.into(),
                        // TODO: Dynamic values
                        correlation_id: "8c6060c4-3d78-4d73-ae17-e8bce88426ee".into(),
                        value: "8c6060c4-3d78-4d73-ae17-e8bce88426ee".into(),
                    },
                    relates_to: cmd.header.message_id,
                },
                body: DiscoverResponseBody {
                    discover_result: DiscoverResponseDiscoverResponse {
                        xmlns: DISCOVER_RESPONSE_XMLNS.into(),
                        discover_result: DiscoverResponseDiscoverResult {
                            auth_policy: "Federated".into(),
                            enrollment_version: "5.0".into(), // TODO: From request
                            enrollment_policy_service_url: format!("https://{enrollment_domain}/EnrollmentServer/Policy.svc"),
                            enrollment_service_url: format!("https://{enrollment_domain}/EnrollmentServer/Enrollment.svc"),
                            authentication_service_url: Some(format!("{web_origin}/api/enrollment/login")),
                        }
                    }
                },
            };

            let result = response.to_string().unwrap(); // TODO: Error handling
            (
                [
                    (header::CONTENT_TYPE, HeaderValue::from_static("application/soap+xml; charset=utf-8")),
                    // This header is important. The Windows MDM client doesn't like chunked encodings.
                    (header::CONTENT_LENGTH, HeaderValue::from_str(&result.len().to_string()).expect("number will always be valid"))
                ],
                result,
            ).into_response()
        }))
        // Policy instructs the client how the generate the identity certificate.
        // This endpoint is part of the MS-XCEP spec.
        .route("/Policy.svc", post(|body: String| async move {
            println!("POLICY {body}"); // TODO

            // let cmd = match PolicyRequest::from_str(&body) {
            //     Ok(cmd) => cmd,
            //     Err(err) => {
            //         // TODO: fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
            //         error!("todo: proper soap fault. invalid request body {err:?}");
            //         return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            //     }
            // };

        // if cmd.Header.Action != policyActionRequest {
        // 	fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
        // 	return
        // } else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.To, "?")[0] {
        // 	fault.Fault(fmt.Errorf("the request was destined for another server"), "the request was not destined for this server", soap.FaultCodeEndpointUnavailable)
        // 	return
        // }

	// var res = soap.DefaultResponseEnvelope
	// res.Header.Action.Value = policyActionResponse
	// res.Header.ActivityID = soap.NewActivityID("todo", "todo")
	// res.Header.RelatesTo = "urn:uuid:" + cmd.Header.MessageID
	// res.Body = soap.ResponseEnvelopeBody{
	// 	NamespaceXSI: "http://www.w3.org/2001/XMLSchema-instance",
	// 	Body: soap.PolicyResponse{
	// 		Response: soap.PolicyXCEPResponse{
	// 			PolicyID:           internal.EnrollmentPolicyID,
	// 			PolicyFriendlyName: internal.EnrollmentPolicyFriendlyName,
	// 			NextUpdateHours:    soap.NillableField,
	// 			PoliciesNotChanged: soap.NillableField,
	// 			Policies: soap.XCEPPolicies{
	// 				Policies: []soap.XCEPPolicy{
	// 					{
	// 						OIDReferenceID: 0, // References to OID defined in OIDs section
	// 						CAs:            soap.NillableField,
	// 						Attributes: soap.XCEPAttributes{
	// 							PolicySchema: 3,
	// 							PrivateKeyAttributes: soap.XCEPPrivateKeyAttributes{
	// 								MinimalKeyLength:      4096,
	// 								KeySpec:               soap.NillableField,
	// 								KeyUsageProperty:      soap.NillableField,
	// 								Permissions:           soap.NillableField,
	// 								AlgorithmOIDReference: soap.NillableField,
	// 								CryptoProviders:       soap.NillableField,
	// 							},
	// 							SupersededPolicies:        soap.NillableField,
	// 							PrivateKeyFlags:           soap.NillableField,
	// 							SubjectNameFlags:          soap.NillableField,
	// 							EnrollmentFlags:           soap.NillableField,
	// 							GeneralFlags:              soap.NillableField,
	// 							HashAlgorithmOIDReference: 0,
	// 							RARequirements:            soap.NillableField,
	// 							KeyArchivalAttributes:     soap.NillableField,
	// 							Extensions:                soap.NillableField,
	// 						},
	// 					},
	// 				},
	// 			},
	// 		},
	// 		OIDs: []soap.XCEPoID{
	// 			{
	// 				OIDReferenceID: 0,
	// 				DefaultName:    "szOID_OIWSEC_SHA256",
	// 				Group:          2, // 2 = Encryption algorithm identifier
	// 				Value:          "2.16.840.1.101.3.4.2.1",
	// 			},
	// 		},
	// 	},
	// }

	// body, err := soap.Marshal(res)
	// if err != nil {
	// 	fault.Fault(err, "an internal fault occurred marshalling the response body", soap.FaultCodeInternalServiceFault)
	// 	return
	// }

	// w.Header().Set("Content-Type", "application/soap+xml; charset=utf-8")
	// w.Header().Set("Content-Length", fmt.Sprintf("%v", len(body)))
	// if _, err := w.Write(body); err != nil {
	// 	log.Println("ResponseWriter Error:", err)
	// }

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
        // Enrollment provisions the device's management client and issues it a certificate which is used for authentication.
        // This endpoint is part of the spec MS-WSTEP.
        .route("/Enrollment.svc", post(|State(state): State<Arc<Context>>, body: String| async move {
            let cmd = match EnrollmentRequest::from_str(&body) {
                Ok(cmd) => cmd,
                Err(err) => {
                    // TODO: fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
                    error!("todo: proper soap fault. invalid request body {err:?}");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            };

            if cmd.header.action != ENROLLMENT_ACTION_REQUEST {
                // TODO: fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
                error!("todo: proper soap fault. invalid action '{}', expected '{}'", cmd.header.action, DISCOVER_ACTION_REQUEST);
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            // else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.To, "?")[0] {
            //     // TODO: fault.Fault(fmt.Errorf("the request was destined for another server"), "the request was not destined for this server", soap.FaultCodeEndpointUnavailable)
            //     return
            // }

            let (upn, owner_pk, tenant_pk) = match cmd.header.security {
                Some(RequestHeaderSecurity { binary_security_token: Some(token), .. }) => {
                    let bst_raw = match token.decode() {
                        Ok(raw) => raw,
                        Err(err) => {
                            // TODO: fault.Fault(err, "the federated authentication token has an unsupported encoding", soap.FaultCodeMessageFormat)
                            error!("todo: proper soap fault. error decoding bst: {err:?}");
                            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                        }
                    };


                    match &*token.value_type {
                        // AzureAD Federated
                        "urn:ietf:params:oauth:token-type:jwt" => todo!("verify the token with Microsoft and then backtrack to Mattrax"),
                        // Mattrax token
                        "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentUserToken" => {
                            let token = String::from_utf8_lossy(&bst_raw);
                            // TODO: Does this validate the token has not expired???
                            let claims: BTreeMap<String, serde_json::Value> = match token.verify_with_key(&state.shared_secret) {
                                Ok(claims) => claims,
                                Err(err) => {
                                     // fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
                                    error!("todo: proper soap fault. error verifying token: '{err:?}'");
                                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                                }
                            };

                            if claims.get("aud") != Some(&serde_json::Value::String("mdm.mattrax.app".into())) {
                                // fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
                                error!("todo: proper soap fault. error verifying token: invalid aud '{:?}'", claims.get("aud"));
                                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                            }

                            let upn = claims.get("upn").unwrap().as_str().unwrap().to_string(); // TODO: Error handling
                            let owner_pk = claims.get("uid").unwrap().as_i64().unwrap().try_into().unwrap(); // TODO: Error handling
                            let tenant = claims.get("tid").unwrap().as_i64().unwrap().try_into().unwrap(); // TODO: Error handling

                            (upn, owner_pk, tenant)
                        },
                        ty => {
                            // fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
                            error!("todo: proper soap fault. error invalid bst value_type '{ty}'");
                            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                        }
                    }
                }
                Some(RequestHeaderSecurity { username_token: Some(token), .. }) => {
                    // fault.Fault(fmt.Errorf("OnPremise authentication not supported"), "no valid authentication method was found", soap.FaultCodeInvalidSecurity)
                    error!("todo: proper soap fault. OnPremise authentication not supported");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
                _ => {
                    // fault.Fault(fmt.Errorf("Federated authentication not supported"), "no valid authentication method was found", soap.FaultCodeInvalidSecurity)
                    error!("todo: proper soap fault. Federated authentication not supported");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }

                // TODO: Authentication for certificate renewal.
                // if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew && cmd.Header.WSSESecurity.Username != "" {
                //     if p7 == nil {
                //         fault.Fault(fmt.Errorf("pkcs7 required for authenticating renewal"), "the users authenticity could not be verified", soap.FaultCodeAuthentication)
                //         return ""
                //     }

                //     signer := p7.GetOnlySigner()
                //     if signer == nil {
                //         fault.Fault(fmt.Errorf("pkcs7: binary security token has no signer"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
                //         return ""
                //     }

                //     if now := time.Now(); now.Before(signer.NotBefore) || now.After(signer.NotAfter) /* Check that the certificate has not expired */ {
                //         fault.Fault(fmt.Errorf("pkcs7: pkcs7 signer is expired"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
                //         return ""
                //     } else if err := certService.IsIssuerIdentity(signer); err != nil {
                //         fault.Fault(fmt.Errorf("pkcs7: the signer was not a trusted certificate"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
                //         return ""
                //     } else if os.Getenv("DISABLE_CERT_RENEW_ELIGIBILITY") != "true" && time.Until(signer.NotAfter).Hours()/24 > wap.ROBORenewPeriod {
                //         fault.AdvancedFault(fmt.Errorf("pkcs7: the device is not eligible to renew yet"), "the device is not eligible to renew yet", "NotEligibleToRenew", soap.FaultCodeInternalServiceFault)
                //         return ""
                //     } else if cmd.GetAdditionalContextItem("DeviceID") != signer.Subject.CommonName {
                //         fault.Fault(fmt.Errorf("pkcs7: certificate command name does match renewal request DeviceID"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
                //         return ""
                //     }

                //     return cmd.Header.WSSESecurity.Username
                // }
            };

            let additional_context = cmd.body.request_security_token.additional_context;
            let Some(device_id) = additional_context.get("DeviceID") else {
                // TODO: fault.AdvancedFault(err, "the enrollment data is incomplete", "InvalidEnrollmentData", soap.FaultCodeInternalServiceFault)
                error!("todo: proper soap fault. the enrollment data is incomplete");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            };

            if additional_context.get("DeviceType") != Some("CIMClient_Windows") {
                // TODO: fault.AdvancedFault(err, "the device is not supported by this management server", "DeviceNotSupported", soap.FaultCodeInternalServiceFault)
                error!("todo: proper soap fault. the device is not supported by this management server");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }

            let (cert_store, common_name, enrollment_type) = match additional_context.get("EnrollmentType") {
                Some("Device") => ("System", device_id.to_string(), ENROLLMENT_TYPE_DEVICE),
                _ => ("User", upn.to_string(), ENROLLMENT_TYPE_USER),
            };

            let Ok(csr) = cmd.body.request_security_token.binary_security_token.decode().map_err(|err| {
                // TODO: proper SOAP fault
                error!("todo: error decoding the bst");
            }) else {
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            };
            let mut csr = CertificateSigningRequestParams::from_der(&csr).unwrap(); // TODO: Error handling
            let device_id = cuid2::create_id();

            // Version:               csr.Version,
            // Signature:             csr.Signature,
            // SignatureAlgorithm:    csr.SignatureAlgorithm,
            // PublicKey:             csr.PublicKey,
            // PublicKeyAlgorithm:    csr.PublicKeyAlgorithm,
            csr.params.distinguished_name = DistinguishedName::new();
            csr.params.distinguished_name.push(DnType::CommonName, common_name);
            // Issuer:
            csr.params.serial_number = Some(SerialNumber::from_slice(&[1])); // TODO: Encode proper Rust int type into the bytes
            csr.params.not_before = OffsetDateTime::now_utc();
            csr.params.not_after = csr.params.not_before.clone().add(time::Duration::days(365));
            csr.params.key_usages = vec![KeyUsagePurpose::DigitalSignature, KeyUsagePurpose::KeyEncipherment];
            csr.params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
            // BasicConstraintsValid: true, // TODO
            csr.params.is_ca = IsCa::ExplicitNoCa;
            csr.params.custom_extensions = vec![
                CustomExtension::from_oid_content(MICROSOFT_DEVICE_ID_EXTENSION, device_id.as_bytes().to_vec()),
            ];

            let certificate = Certificate::from_request(csr, &state.identity_cert_rcgen, &state.identity_key).unwrap();  // TODO: Error handling

            // var wapProvisioningDocCharacteristics = []wap.Characteristic{
            //     certStoreCharacteristic,
            // }

            if cmd.body.request_security_token.request_type == ENROLLMENT_REQUEST_TYPE_ISSUE {
                // todo!();
                        // if err := mttxAPI.CheckIn(deviceID, cmd); err != nil {
                    			// 	fault.AdvancedFault(err, "the management server encountered a fault", "InMaintenance", soap.FaultCodeInternalServiceFault)
                    			// 	return
                    			// }

                    			// wapProvisioningDocCharacteristics = append(wapProvisioningDocCharacteristics, wap.NewW7Application(internal.ProviderID, internal.ServerDisplayName, internal.ManagementServiceURL, sslClientCertSearchCriteria), wap.NewDMClient(internal.ProviderID, []wap.Parameter{
                    			// 	{
                    			// 		Name:     "EntDMID",
                    			// 		Value:    deviceID, // TODO: Mattrax's device ID
                    			// 		DataType: "string",
                    			// 	},
                    			// 	{
                    			// 		Name:     "HelpWebsite",
                    			// 		Value:    internal.SupportWebsite,
                    			// 		DataType: "string",
                    			// 	},
                    			// 	{
                    			// 		Name:     "SyncApplicationVersion",
                    			// 		Value:    "3.0",
                    			// 		DataType: "string",
                    			// 	},
                    			// }, []wap.Characteristic{
                    			// 	wap.DefaultPollCharacteristic,
                    			// 	{
                    			// 		Type: "CustomEnrollmentCompletePage",
                    			// 		Params: []wap.Parameter{
                    			// 			{
                    			// 				Name:     "Title",
                    			// 				Value:    internal.CustomEnrollmentCompletePageTitle,
                    			// 				DataType: "string",
                    			// 			},
                    			// 			{
                    			// 				Name:     "BodyText",
                    			// 				Value:    internal.CustomEnrollmentCompletePageBody,
                    			// 				DataType: "string",
                    			// 			},
                    			// 		},
                    			// 	},
                    			// }))
            } else if cmd.body.request_security_token.request_type == ENROLLMENT_REQUEST_TYPE_RENEW {
                // todo!();
                // wapProvisioningDocCharacteristics = append(wapProvisioningDocCharacteristics, wap.NewEmptyApplication(internal.ProviderID))
            }

            // rawProvisioningProfile, err := soap.Marshal(wap.NewProvisioningDoc(wapProvisioningDocCharacteristics))
            // if err != nil {
            //     fault.Fault(err, "an internal fault occurred marshalling the provisioning profile", soap.FaultCodeInternalServiceFault)
            //     return
            // }
            // rawProvisioningProfile = append([]byte(`<?xml version="1.0" encoding="UTF-8"?>`), rawProvisioningProfile...)

            let mut hasher = Sha1::new();
            hasher.update(state.identity_cert_rcgen.der());
            let identity_cert_fingerprint =  hasher.finalize();
            let identity_cert_fingerprint =  hex::encode(&identity_cert_fingerprint).to_uppercase();

            let root_certificate_der = BASE64_STANDARD.encode(state.identity_cert_rcgen.der());

            let mut hasher = Sha1::new();
            hasher.update(certificate.der());
            let signed_client_cert_fingerprint = hasher.finalize();
            let signed_client_cert_fingerprint = hex::encode(&signed_client_cert_fingerprint).to_uppercase();

            let client_ctr_raw = BASE64_STANDARD.encode(certificate.der());

            // TODO: Derive subject from the certificate - `certificate.get_params().distinguished_name()`
            let ssl_client_cert_search_criteria = format!("Subject={}&amp;Stores=MY%5C{cert_store}", urlencoding::encode("CN=Device"));

            // TODO: Remove the device from the DB if it doesn't do an initial checkin within a certain time period
            // TODO: Get all this information from parsing the request.

            let Some(hw_dev_id) = additional_context.get("HWDevID") else {
                todo!("cringe device. No HwDevId-ass");
            };

            // TODO: `HWDevID`, `DeviceID`, `OSVersion`

            state.db.create_device(device_id.clone(), additional_context.get("DeviceName").unwrap_or("Unknown").to_string(), enrollment_type.into(), OS_WINDOWS.into(), hw_dev_id.into(), tenant_pk, owner_pk).await.unwrap();

            // TODO: Get the device's DB id and put into this
            // TODO: Lookup and set tenant name
            let domain = state.config.get().domain.clone();
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
                    <parm name="NAME" value="Mattrax" />
                    <parm name="ADDR" value="https://{domain}/ManagementServer/Manage.svc" />
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
                        <characteristic type="Mattrax">
                            <parm name="EntDMID" value="{device_id}" datatype="string" />
                            <parm name="SyncApplicationVersion" value="5.0" datatype="string" />
                            <characteristic type="Poll">
                                <parm name="NumberOfFirstRetries" value="8" datatype="integer" />
                            </characteristic>
                        </characteristic>
                    </characteristic>
                </characteristic>
            </wap-provisioningdoc>"#);

            let wap_provisioning_profile_encoded = BASE64_STANDARD.encode(wap_provisioning_profile.replace("\n\t", ""));

            let response = EnrollmentResponse {
                header: ResponseHeader {
                    action: Action::from(ENROLLMENT_ACTION_RESPONSE),
                    activity_id: ActivityId {
                        xmlns: ACTIVITY_ID_XMLNS.into(),
                        // TODO: Dynamic values
                        correlation_id: "8c6060c4-3d78-4d73-ae17-e8bce88426ee".into(),
                        value: "8c6060c4-3d78-4d73-ae17-e8bce88426ee".into(),
                    },
                    relates_to: cmd.header.message_id,
                    // <o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">
                    //     <u:Timestamp u:Id="_0">
                    //         <u:Created>2018-11-30T00:32:59.420Z</u:Created>
                    //         <u:Expires>2018-12-30T00:37:59.420Z</u:Expires>
                    //     </u:Timestamp>
                    // </o:Security>
                },
                body: EnrollmentResponseBody {
                    request_security_token_response_collection: RequestSecurityTokenResponseCollection {
                        xmlns: REQUEST_SECURITY_TOKEN_RESPONSE_COLLECTION.into(),
                        request_security_token_response: RequestSecurityTokenResponse {
                            token_type: REQUEST_SECURITY_TOKEN_TYPE.into(),
                            requested_security_token: RequestedSecurityToken {
                                binary_security_token: BinarySecurityToken {
                                    xmlns: Some(WSSE_NAMESPACE.into()),
                                    // TODO: Use constants from `ms-mde`
                                    value_type: "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc".into(),
                                    encoding_type: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary".into(),
                                    value: wap_provisioning_profile_encoded,
                                }
                            }
                        }
                    }
                }
            };

            let result = response.to_string().unwrap(); // TODO: Error handling
            (
                [
                    (header::CONTENT_TYPE, HeaderValue::from_static("application/soap+xml; charset=utf-8")),
                    // This header is important. The Windows MDM client doesn't like chunked encodings.
                    (header::CONTENT_LENGTH, HeaderValue::from_str(&result.len().to_string()).expect("number will always be valid"))
                ],
                result,
            ).into_response()
        }))
        .with_state(state)
}
