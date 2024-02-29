use std::{ops::Add, sync::Arc};

use axum::{
    extract::State,
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use base64::prelude::*;
use hyper::header;
use mysql_common::time::OffsetDateTime;
use rcgen::{
    Certificate, CertificateSigningRequestParams, CustomExtension, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, KeyUsagePurpose, SerialNumber
};
use serde::Deserialize;
use ms_mde::{Action, ActivityId, DiscoverRequest, DiscoverResponse, DiscoverResponseBody, DiscoverResponseDiscoverResponse, DiscoverResponseDiscoverResult, ResponseHeader, ACTIVITY_ID_XMLNS, DISCOVER_ACTION_REQUEST, DISCOVER_ACTION_RESPONSE, DISCOVER_RESPONSE_XMLNS};
use sha1::{Digest, Sha1};
use tracing::error;

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

            let (enrollment_domain, web_domain) = {
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
                            authentication_service_url: Some(format!("https://{web_domain}/api/enrollment/login")),
                        }
                    }
                },
            };

            let result = response.to_string().unwrap(); // TODO: Error handling
            // println!("\nRESULT: {result}\n"); // TODO: Remove
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
        // This endpoint is part of the spec MS-XCEP.
        .route("/Policy.svc", post(|body: String| async move {
            println!("POLICY {body:?}"); // TODO

    //         fault := soap.FaultFromRequest("policy", policyActionResponse, w)

	// var cmd soap.PolicyRequest
	// if err := soap.NewDecoder(r.Body).Decode(&cmd); err != nil {
	// 	fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
	// 	return
	// }
	// fault.SetRequestContext(cmd.Header)

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
        .route("/Enrollment.svc", post(|State(state): State<Arc<Context>>, body: String| async move {
// // Enrollment provisions the device's management client and issues it a certificate which is used for authentication.
// // This endpoint is part of the spec MS-WSTEP.
// func Enrollment(mttxAPI api.Service, aadService *azuread.Service, certService *certificates.Service) http.HandlerFunc {
// 	return func(w http.ResponseWriter, r *http.Request) {
// 		fault := soap.FaultFromRequest("enrollment", enrollmentActionResponse, w)

// 		var cmd soap.EnrollmentRequest
// 		if err := soap.NewDecoder(r.Body).Decode(&cmd); err != nil {
// 			fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
// 			return
// 		}
// 		fault.SetRequestContext(cmd.Header)

// 		if cmd.Header.Action != enrollmentActionRequest {
// 			fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
// 			return
// 		} else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.To, "?")[0] {
// 			fault.Fault(fmt.Errorf("the request was destined for another server"), "the request was not destined for this server", soap.FaultCodeEndpointUnavailable)
// 			return
// 		}

// 		deviceID := cmd.GetAdditionalContextItem("DeviceID")

// 		if err := cmd.ValidateEnrollmentContext(); err != nil {
// 			fault.AdvancedFault(err, "the enrollment data is incomplete", "InvalidEnrollmentData", soap.FaultCodeInternalServiceFault)
// 			return
// 		} else if cmd.GetAdditionalContextItem("DeviceType") != "CIMClient_Windows" {
// 			fault.AdvancedFault(err, "the device is not supported by this management server", "DeviceNotSupported", soap.FaultCodeInternalServiceFault)
// 			return
// 		}
// 		certStore := internal.Ternary(cmd.GetAdditionalContextItem("EnrollmentType") == "Device", "System", "User")

// 		certificateSigningRequest, p7 := DecodeBinarySecurityToken(fault, cmd)
// 		if certificateSigningRequest == nil {
// 			return
// 		}

// 		upn := Authenticate(mttxAPI, aadService, certService, fault, cmd, p7)
// 		if upn == "" {
// 			return
// 		}

// 		certStoreCharacteristic, sslClientCertSearchCriteria := ParseAndSignCSR(certService, fault, cmd, certificateSigningRequest, certStore, pkix.Name{
// 			CommonName: internal.Ternary(certStore == "Device", deviceID, upn),
// 		})
// 		if sslClientCertSearchCriteria == "" {
// 			return
// 		}

// 		var wapProvisioningDocCharacteristics = []wap.Characteristic{
// 			certStoreCharacteristic,
// 		}

// 		if cmd.Body.RequestType == soap.EnrollmentRequestTypeIssue {
// 			if err := mttxAPI.CheckIn(deviceID, cmd); err != nil {
// 				fault.AdvancedFault(err, "the management server encountered a fault", "InMaintenance", soap.FaultCodeInternalServiceFault)
// 				return
// 			}

// 			wapProvisioningDocCharacteristics = append(wapProvisioningDocCharacteristics, wap.NewW7Application(internal.ProviderID, internal.ServerDisplayName, internal.ManagementServiceURL, sslClientCertSearchCriteria), wap.NewDMClient(internal.ProviderID, []wap.Parameter{
// 				{
// 					Name:     "EntDMID",
// 					Value:    deviceID, // TODO: Mattrax's device ID
// 					DataType: "string",
// 				},
// 				{
// 					Name:     "HelpWebsite",
// 					Value:    internal.SupportWebsite,
// 					DataType: "string",
// 				},
// 				{
// 					Name:     "SyncApplicationVersion",
// 					Value:    "3.0",
// 					DataType: "string",
// 				},
// 			}, []wap.Characteristic{
// 				wap.DefaultPollCharacteristic,
// 				{
// 					Type: "CustomEnrollmentCompletePage",
// 					Params: []wap.Parameter{
// 						{
// 							Name:     "Title",
// 							Value:    internal.CustomEnrollmentCompletePageTitle,
// 							DataType: "string",
// 						},
// 						{
// 							Name:     "BodyText",
// 							Value:    internal.CustomEnrollmentCompletePageBody,
// 							DataType: "string",
// 						},
// 					},
// 				},
// 			}))
// 		} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew {
// 			wapProvisioningDocCharacteristics = append(wapProvisioningDocCharacteristics, wap.NewEmptyApplication(internal.ProviderID))
// 		}

// 		rawProvisioningProfile, err := soap.Marshal(wap.NewProvisioningDoc(wapProvisioningDocCharacteristics))
// 		if err != nil {
// 			fault.Fault(err, "an internal fault occurred marshalling the provisioning profile", soap.FaultCodeInternalServiceFault)
// 			return
// 		}
// 		rawProvisioningProfile = append([]byte(`<?xml version="1.0" encoding="UTF-8"?>`), rawProvisioningProfile...)

// 		var res = soap.DefaultResponseEnvelope
// 		res.Header.Action.Value = enrollmentActionResponse
// 		res.Header.ActivityID = soap.NewActivityID("todo", "todo")
// 		res.Header.RelatesTo = "urn:uuid:" + cmd.Header.MessageID
// 		res.Body = soap.ResponseEnvelopeBody{
// 			Body: soap.EnrollmentResponse{
// 				TokenType:          "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
// 				DispositionMessage: soap.DispositionMessage{},
// 				RequestedBinarySecurityToken: soap.BinarySecurityToken{
// 					ValueType:    "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc",
// 					EncodingType: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
// 					Value:        base64.StdEncoding.EncodeToString(rawProvisioningProfile),
// 				},
// 				RequestID: 0,
// 			},
// 		}

// 		body, err := soap.Marshal(res)
// 		if err != nil {
// 			fault.Fault(err, "an internal fault occurred marshalling the response body", soap.FaultCodeInternalServiceFault)
// 			return
// 		}

// 		w.Header().Set("Content-Type", "application/soap+xml; charset=utf-8")
// 		w.Header().Set("Content-Length", fmt.Sprintf("%v", len(body)))
// 		if _, err := w.Write(body); err != nil {
// 			log.Println("ResponseWriter Error:", err)
// 		}
// 	}
// }

// // DecodeBinarySecurityToken decodes the binary security token
// func DecodeBinarySecurityToken(fault soap.Fault, cmd soap.EnrollmentRequest) ([]byte, *pkcs7.PKCS7) {
// 	binarySecurityToken, err := cmd.Body.BinarySecurityToken.DecodedValue()
// 	if err != nil {
// 		fault.Fault(err, "the binary security token encoding is not supported", soap.FaultCodeMessageFormat)
// 		return nil, nil
// 	}

// 	if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew {
// 		if cmd.Body.BinarySecurityToken.ValueType != soap.BinarySecurityTokenTypePKCS7 {
// 			fault.Fault(fmt.Errorf("the binary security token ValueType is not PKCS7"), "the binary security token type is not supported", soap.FaultCodeMessageFormat)
// 			return nil, nil
// 		}

// 		p7, err := pkcs7.Parse(binarySecurityToken)
// 		if err != nil {
// 			fault.Fault(err, "the binary security token type could not be parsed", soap.FaultCodeInternalServiceFault)
// 			return nil, nil
// 		} else if err := p7.Verify(); err != nil {
// 			fault.Fault(err, "the binary security token type could not be verified", soap.FaultCodeInternalServiceFault)
// 			return nil, nil
// 		}

// 		return p7.Content, p7
// 	} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeIssue {
// 		if cmd.Body.BinarySecurityToken.ValueType != soap.BinarySecurityTokenTypePKCS10 {
// 			fault.Fault(fmt.Errorf("the binary security token ValueType is not PKCS10"), "the binary security token type is not supported", soap.FaultCodeMessageFormat)
// 			return nil, nil
// 		}

// 		return binarySecurityToken, nil
// 	}

// 	fault.Fault(fmt.Errorf("the request type is not supported"), "the request could not be handled by this endpoint", soap.FaultCodeMessageFormat)
// 	return nil, nil
// }

// // Authenticate handles authenticating the enrolling user or the renewing device
// func Authenticate(mttxAPI api.Service, aadService *azuread.Service, certService *certificates.Service, fault soap.Fault, cmd soap.EnrollmentRequest, p7 *pkcs7.PKCS7) (upn string) {
// 	if cmd.Header.WSSESecurity.BinarySecurityToken != nil /* Federated Authentication */ {
// 		bst, err := cmd.Header.WSSESecurity.BinarySecurityToken.DecodedValue()
// 		if err != nil {
// 			fault.Fault(err, "the federated authentication token has an unsupported encoding", soap.FaultCodeMessageFormat)
// 			return ""
// 		}

// 		if cmd.Header.WSSESecurity.BinarySecurityToken.ValueType == "urn:ietf:params:oauth:token-type:jwt" /* AzureAD Federated */ {
// 			claims, err := aadService.VerifyAuthenticationToken(string(bst))
// 			if err != nil {
// 				fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
// 				return ""
// 			}

// 			// TODO: Verify the user is known to Mattrax
// 			// loginRes, err := mttxAPI.LoginAAD(claims)
// 			// if err != nil {
// 			// 	fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
// 			// 	return nil, ""
// 			// }

// 			return claims.UserPrincipalName
// 		}

// 		fault.Fault(fmt.Errorf("federated authentication not supported"), "no valid authentication method was found", soap.FaultCodeInvalidSecurity)
// 		return ""
// 	} else if cmd.Header.WSSESecurity.Username != "" && cmd.Header.WSSESecurity.Password != "" /* On-Premise Authentication */ {
// 		// TODO: Forbid `OnPremise` auth
// 		// loginRes, err := mttxAPI.Login(cmd.Header.WSSESecurity.Username, cmd.Header.WSSESecurity.Password)
// 		// if err != nil {
// 		// 	fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
// 		// 	return nil, ""
// 		// }

// 		return cmd.Header.WSSESecurity.Username
// 	} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew && cmd.Header.WSSESecurity.Username != "" {
// 		if p7 == nil {
// 			fault.Fault(fmt.Errorf("pkcs7 required for authenticating renewal"), "the users authenticity could not be verified", soap.FaultCodeAuthentication)
// 			return ""
// 		}

// 		signer := p7.GetOnlySigner()
// 		if signer == nil {
// 			fault.Fault(fmt.Errorf("pkcs7: binary security token has no signer"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
// 			return ""
// 		}

// 		if now := time.Now(); now.Before(signer.NotBefore) || now.After(signer.NotAfter) /* Check that the certificate has not expired */ {
// 			fault.Fault(fmt.Errorf("pkcs7: pkcs7 signer is expired"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
// 			return ""
// 		} else if err := certService.IsIssuerIdentity(signer); err != nil {
// 			fault.Fault(fmt.Errorf("pkcs7: the signer was not a trusted certificate"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
// 			return ""
// 		} else if os.Getenv("DISABLE_CERT_RENEW_ELIGIBILITY") != "true" && time.Until(signer.NotAfter).Hours()/24 > wap.ROBORenewPeriod {
// 			fault.AdvancedFault(fmt.Errorf("pkcs7: the device is not eligible to renew yet"), "the device is not eligible to renew yet", "NotEligibleToRenew", soap.FaultCodeInternalServiceFault)
// 			return ""
// 		} else if cmd.GetAdditionalContextItem("DeviceID") != signer.Subject.CommonName {
// 			fault.Fault(fmt.Errorf("pkcs7: certificate command name does match renewal request DeviceID"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
// 			return ""
// 		}

// 		return cmd.Header.WSSESecurity.Username
// 	}

// 	fault.Fault(fmt.Errorf("federated authentication not supported"), "no valid authentication method was found", soap.FaultCodeInvalidSecurity)
// 	return ""
// }

// // ParseAndSignCSR parses the binary security token as a certificate signing request, signs it and then generates the CertificateStore CSP Characteristic for the WAP provisioning profile
// func ParseAndSignCSR(certService *certificates.Service, fault soap.Fault, cmd soap.EnrollmentRequest, certificateSigningRequest []byte, certStore string, subject pkix.Name) (certStoreCharacteristic wap.Characteristic, sslClientCertSearchCriteria string) {
// 	csr, err := x509.ParseCertificateRequest(certificateSigningRequest)
// 	if err != nil {
// 		fault.Fault(err, "the binary security token could not be parsed", soap.FaultCodeInternalServiceFault)
// 		return wap.Characteristic{}, ""
// 	} else if err = csr.CheckSignature(); err != nil {
// 		fault.Fault(err, "the binary security token could not be verified", soap.FaultCodeInternalServiceFault)
// 		return wap.Characteristic{}, ""
// 	}

// 	identityCertificate, identityPrivateKey, err := certService.GetIssuerIdentity()
// 	if err != nil {
// 		fault.Fault(err, "the management server encountered an internal fault", soap.FaultCodeEnrollmentServer)
// 		return wap.Characteristic{}, ""
// 	}

// 	serialNumberHasher := sha1.New()
// 	serialNumberHasher.Write([]byte(subject.String() + time.Now().String()))

// 	var serialNumber = big.NewInt(0)
// 	serialNumber.SetBytes(serialNumberHasher.Sum(nil))

// 	var extensions = []pkix.Extension{
// 		{
// 			Id:       microsoftDeviceIDExtension,
// 			Critical: false,
// 			Value:    []byte(cmd.GetAdditionalContextItem("DeviceID")),
// 		},
// 	}

// 	var notBefore = time.Now().Add(time.Duration(mathrand.Int31n(120)) * -time.Minute)
// 	clientCertificate := &x509.Certificate{
// 		Version:               csr.Version,
// 		Signature:             csr.Signature,
// 		SignatureAlgorithm:    csr.SignatureAlgorithm,
// 		PublicKey:             csr.PublicKey,
// 		PublicKeyAlgorithm:    csr.PublicKeyAlgorithm,
// 		Subject:               subject,
// 		Extensions:            extensions,
// 		SerialNumber:          serialNumber,
// 		Issuer:                identityCertificate.Issuer,
// 		NotBefore:             notBefore,
// 		NotAfter:              notBefore.Add(365 * 24 * time.Hour),
// 		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
// 		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
// 		BasicConstraintsValid: true,
// 		IsCA:                  false,
// 	}

// 	rawSignedCert, err := x509.CreateCertificate(rand.Reader, clientCertificate, identityCertificate, csr.PublicKey, identityPrivateKey)
// 	if err != nil {
// 		fault.Fault(err, "the management server encountered an internal fault", soap.FaultCodeEnrollmentServer)
// 		return wap.Characteristic{}, ""
// 	}

// 	return wap.NewCertStore(identityCertificate, certStore, rawSignedCert), "Subject=" + url.QueryEscape(clientCertificate.Subject.String()) + "&Stores=MY%5C" + certStore
// }

            
            println!("\nENROLLMENT\n{}\n", body);

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
                    <parm name="NAME" value="Mattrax" />
                    <parm name="ADDR" value="{domain}/ManagementServer/Manage.svc" />
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
