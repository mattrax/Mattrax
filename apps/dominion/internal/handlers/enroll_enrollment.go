package handlers

import (
	"crypto/rand"
	"crypto/sha1"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"fmt"
	"log"
	"math/big"
	mathrand "math/rand"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/fullsailor/pkcs7"
	"github.com/oscartbeaumont/forge/dominion/internal"
	"github.com/oscartbeaumont/forge/dominion/internal/api"
	"github.com/oscartbeaumont/forge/dominion/internal/azuread"
	"github.com/oscartbeaumont/forge/dominion/internal/certificates"
	"github.com/oscartbeaumont/forge/dominion/pkg/soap"
	wap "github.com/oscartbeaumont/forge/dominion/pkg/wap_provisioning_doc"
)

const enrollmentActionRequest = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RST/wstep"
const enrollmentActionResponse = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep"

// microsoftDeviceIDExtension contains the OID for the Microsoft certificate extension which includes the MDM DeviceID
var microsoftDeviceIDExtension = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 311, 66, 1, 0}

// Enrollment provisions the device's management client and issues it a certificate which is used for authentication.
// This endpoint is part of the spec MS-WSTEP.
func Enrollment(mttxAPI api.Service, aadService *azuread.Service, certService *certificates.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fault := soap.FaultFromRequest("enrollment", enrollmentActionResponse, w)

		var cmd soap.EnrollmentRequest
		if err := soap.NewDecoder(r.Body).Decode(&cmd); err != nil {
			fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
			return
		}
		fault.SetRequestContext(cmd.Header)

		if cmd.Header.Action != enrollmentActionRequest {
			fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
			return
		} else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.To, "?")[0] {
			fault.Fault(fmt.Errorf("the request was destined for another server"), "the request was not destined for this server", soap.FaultCodeEndpointUnavailable)
			return
		}

		deviceID := cmd.GetAdditionalContextItem("DeviceID")

		if err := cmd.ValidateEnrollmentContext(); err != nil {
			fault.AdvancedFault(err, "the enrollment data is incomplete", "InvalidEnrollmentData", soap.FaultCodeInternalServiceFault)
			return
		} else if cmd.GetAdditionalContextItem("DeviceType") != "CIMClient_Windows" {
			fault.AdvancedFault(err, "the device is not supported by this management server", "DeviceNotSupported", soap.FaultCodeInternalServiceFault)
			return
		}
		certStore := internal.Ternary(cmd.GetAdditionalContextItem("EnrollmentType") == "Device", "System", "User")

		certificateSigningRequest, p7 := DecodeBinarySecurityToken(fault, cmd)
		if certificateSigningRequest == nil {
			return
		}

		upn := Authenticate(mttxAPI, aadService, certService, fault, cmd, p7)
		if upn == "" {
			return
		}

		certStoreCharacteristic, sslClientCertSearchCriteria := ParseAndSignCSR(certService, fault, cmd, certificateSigningRequest, certStore, pkix.Name{
			CommonName: internal.Ternary(certStore == "Device", deviceID, upn),
		})
		if sslClientCertSearchCriteria == "" {
			return
		}

		var wapProvisioningDocCharacteristics = []wap.Characteristic{
			certStoreCharacteristic,
		}

		if cmd.Body.RequestType == soap.EnrollmentRequestTypeIssue {
			if err := mttxAPI.CheckIn(deviceID, cmd); err != nil {
				fault.AdvancedFault(err, "the management server encountered a fault", "InMaintenance", soap.FaultCodeInternalServiceFault)
				return
			}

			wapProvisioningDocCharacteristics = append(wapProvisioningDocCharacteristics, wap.NewW7Application(internal.ProviderID, internal.ServerDisplayName, internal.ManagementServiceURL, sslClientCertSearchCriteria), wap.NewDMClient(internal.ProviderID, []wap.Parameter{
				{
					Name:     "EntDMID",
					Value:    deviceID, // TODO: Mattrax's device ID
					DataType: "string",
				},
				{
					Name:     "HelpWebsite",
					Value:    internal.SupportWebsite,
					DataType: "string",
				},
				{
					Name:     "SyncApplicationVersion",
					Value:    "3.0",
					DataType: "string",
				},
			}, []wap.Characteristic{
				wap.DefaultPollCharacteristic,
				{
					Type: "CustomEnrollmentCompletePage",
					Params: []wap.Parameter{
						{
							Name:     "Title",
							Value:    internal.CustomEnrollmentCompletePageTitle,
							DataType: "string",
						},
						{
							Name:     "BodyText",
							Value:    internal.CustomEnrollmentCompletePageBody,
							DataType: "string",
						},
					},
				},
			}))
		} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew {
			wapProvisioningDocCharacteristics = append(wapProvisioningDocCharacteristics, wap.NewEmptyApplication(internal.ProviderID))
		}

		rawProvisioningProfile, err := soap.Marshal(wap.NewProvisioningDoc(wapProvisioningDocCharacteristics))
		if err != nil {
			fault.Fault(err, "an internal fault occurred marshalling the provisioning profile", soap.FaultCodeInternalServiceFault)
			return
		}
		rawProvisioningProfile = append([]byte(`<?xml version="1.0" encoding="UTF-8"?>`), rawProvisioningProfile...)

		var res = soap.DefaultResponseEnvelope
		res.Header.Action.Value = enrollmentActionResponse
		res.Header.ActivityID = soap.NewActivityID("todo", "todo")
		res.Header.RelatesTo = "urn:uuid:" + cmd.Header.MessageID
		res.Body = soap.ResponseEnvelopeBody{
			Body: soap.EnrollmentResponse{
				TokenType:          "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
				DispositionMessage: soap.DispositionMessage{},
				RequestedBinarySecurityToken: soap.BinarySecurityToken{
					ValueType:    "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc",
					EncodingType: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
					Value:        base64.StdEncoding.EncodeToString(rawProvisioningProfile),
				},
				RequestID: 0,
			},
		}

		body, err := soap.Marshal(res)
		if err != nil {
			fault.Fault(err, "an internal fault occurred marshalling the response body", soap.FaultCodeInternalServiceFault)
			return
		}

		w.Header().Set("Content-Type", "application/soap+xml; charset=utf-8")
		w.Header().Set("Content-Length", fmt.Sprintf("%v", len(body)))
		if _, err := w.Write(body); err != nil {
			log.Println("ResponseWriter Error:", err)
		}
	}
}

// DecodeBinarySecurityToken decodes the binary security token
func DecodeBinarySecurityToken(fault soap.Fault, cmd soap.EnrollmentRequest) ([]byte, *pkcs7.PKCS7) {
	binarySecurityToken, err := cmd.Body.BinarySecurityToken.DecodedValue()
	if err != nil {
		fault.Fault(err, "the binary security token encoding is not supported", soap.FaultCodeMessageFormat)
		return nil, nil
	}

	if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew {
		if cmd.Body.BinarySecurityToken.ValueType != soap.BinarySecurityTokenTypePKCS7 {
			fault.Fault(fmt.Errorf("the binary security token ValueType is not PKCS7"), "the binary security token type is not supported", soap.FaultCodeMessageFormat)
			return nil, nil
		}

		p7, err := pkcs7.Parse(binarySecurityToken)
		if err != nil {
			fault.Fault(err, "the binary security token type could not be parsed", soap.FaultCodeInternalServiceFault)
			return nil, nil
		} else if err := p7.Verify(); err != nil {
			fault.Fault(err, "the binary security token type could not be verified", soap.FaultCodeInternalServiceFault)
			return nil, nil
		}

		return p7.Content, p7
	} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeIssue {
		if cmd.Body.BinarySecurityToken.ValueType != soap.BinarySecurityTokenTypePKCS10 {
			fault.Fault(fmt.Errorf("the binary security token ValueType is not PKCS10"), "the binary security token type is not supported", soap.FaultCodeMessageFormat)
			return nil, nil
		}

		return binarySecurityToken, nil
	}

	fault.Fault(fmt.Errorf("the request type is not supported"), "the request could not be handled by this endpoint", soap.FaultCodeMessageFormat)
	return nil, nil
}

// Authenticate handles authenticating the enrolling user or the renewing device
func Authenticate(mttxAPI api.Service, aadService *azuread.Service, certService *certificates.Service, fault soap.Fault, cmd soap.EnrollmentRequest, p7 *pkcs7.PKCS7) (upn string) {
	if cmd.Header.WSSESecurity.BinarySecurityToken != nil /* Federated Authentication */ {
		bst, err := cmd.Header.WSSESecurity.BinarySecurityToken.DecodedValue()
		if err != nil {
			fault.Fault(err, "the federated authentication token has an unsupported encoding", soap.FaultCodeMessageFormat)
			return ""
		}

		if cmd.Header.WSSESecurity.BinarySecurityToken.ValueType == "urn:ietf:params:oauth:token-type:jwt" /* AzureAD Federated */ {
			claims, err := aadService.VerifyAuthenticationToken(string(bst))
			if err != nil {
				fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
				return ""
			}

			// TODO: Verify the user is known to Mattrax
			// loginRes, err := mttxAPI.LoginAAD(claims)
			// if err != nil {
			// 	fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
			// 	return nil, ""
			// }

			return claims.UserPrincipalName
		}

		fault.Fault(fmt.Errorf("federated authentication not supported"), "no valid authentication method was found", soap.FaultCodeInvalidSecurity)
		return ""
	} else if cmd.Header.WSSESecurity.Username != "" && cmd.Header.WSSESecurity.Password != "" /* On-Premise Authentication */ {
		// TODO: Forbid `OnPremise` auth
		// loginRes, err := mttxAPI.Login(cmd.Header.WSSESecurity.Username, cmd.Header.WSSESecurity.Password)
		// if err != nil {
		// 	fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
		// 	return nil, ""
		// }

		return cmd.Header.WSSESecurity.Username
	} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew && cmd.Header.WSSESecurity.Username != "" {
		if p7 == nil {
			fault.Fault(fmt.Errorf("pkcs7 required for authenticating renewal"), "the users authenticity could not be verified", soap.FaultCodeAuthentication)
			return ""
		}

		signer := p7.GetOnlySigner()
		if signer == nil {
			fault.Fault(fmt.Errorf("pkcs7: binary security token has no signer"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
			return ""
		}

		if now := time.Now(); now.Before(signer.NotBefore) || now.After(signer.NotAfter) /* Check that the certificate has not expired */ {
			fault.Fault(fmt.Errorf("pkcs7: pkcs7 signer is expired"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
			return ""
		} else if err := certService.IsIssuerIdentity(signer); err != nil {
			fault.Fault(fmt.Errorf("pkcs7: the signer was not a trusted certificate"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
			return ""
		} else if os.Getenv("DISABLE_CERT_RENEW_ELIGIBILITY") != "true" && time.Until(signer.NotAfter).Hours()/24 > wap.ROBORenewPeriod {
			fault.AdvancedFault(fmt.Errorf("pkcs7: the device is not eligible to renew yet"), "the device is not eligible to renew yet", "NotEligibleToRenew", soap.FaultCodeInternalServiceFault)
			return ""
		} else if cmd.GetAdditionalContextItem("DeviceID") != signer.Subject.CommonName {
			fault.Fault(fmt.Errorf("pkcs7: certificate command name does match renewal request DeviceID"), "the devices authenticity could not be verified", soap.FaultCodeAuthentication)
			return ""
		}

		return cmd.Header.WSSESecurity.Username
	}

	fault.Fault(fmt.Errorf("federated authentication not supported"), "no valid authentication method was found", soap.FaultCodeInvalidSecurity)
	return ""
}

// ParseAndSignCSR parses the binary security token as a certificate signing request, signs it and then generates the CertificateStore CSP Characteristic for the WAP provisioning profile
func ParseAndSignCSR(certService *certificates.Service, fault soap.Fault, cmd soap.EnrollmentRequest, certificateSigningRequest []byte, certStore string, subject pkix.Name) (certStoreCharacteristic wap.Characteristic, sslClientCertSearchCriteria string) {
	csr, err := x509.ParseCertificateRequest(certificateSigningRequest)
	if err != nil {
		fault.Fault(err, "the binary security token could not be parsed", soap.FaultCodeInternalServiceFault)
		return wap.Characteristic{}, ""
	} else if err = csr.CheckSignature(); err != nil {
		fault.Fault(err, "the binary security token could not be verified", soap.FaultCodeInternalServiceFault)
		return wap.Characteristic{}, ""
	}

	identityCertificate, identityPrivateKey, err := certService.GetIssuerIdentity()
	if err != nil {
		fault.Fault(err, "the management server encountered an internal fault", soap.FaultCodeEnrollmentServer)
		return wap.Characteristic{}, ""
	}

	serialNumberHasher := sha1.New()
	serialNumberHasher.Write([]byte(subject.String() + time.Now().String()))

	var serialNumber = big.NewInt(0)
	serialNumber.SetBytes(serialNumberHasher.Sum(nil))

	var extensions = []pkix.Extension{
		{
			Id:       microsoftDeviceIDExtension,
			Critical: false,
			Value:    []byte(cmd.GetAdditionalContextItem("DeviceID")),
		},
	}

	var notBefore = time.Now().Add(time.Duration(mathrand.Int31n(120)) * -time.Minute)
	clientCertificate := &x509.Certificate{
		Version:               csr.Version,
		Signature:             csr.Signature,
		SignatureAlgorithm:    csr.SignatureAlgorithm,
		PublicKey:             csr.PublicKey,
		PublicKeyAlgorithm:    csr.PublicKeyAlgorithm,
		Subject:               subject,
		Extensions:            extensions,
		SerialNumber:          serialNumber,
		Issuer:                identityCertificate.Issuer,
		NotBefore:             notBefore,
		NotAfter:              notBefore.Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
		IsCA:                  false,
	}

	rawSignedCert, err := x509.CreateCertificate(rand.Reader, clientCertificate, identityCertificate, csr.PublicKey, identityPrivateKey)
	if err != nil {
		fault.Fault(err, "the management server encountered an internal fault", soap.FaultCodeEnrollmentServer)
		return wap.Characteristic{}, ""
	}

	return wap.NewCertStore(identityCertificate, certStore, rawSignedCert), "Subject=" + url.QueryEscape(clientCertificate.Subject.String()) + "&Stores=MY%5C" + certStore
}
