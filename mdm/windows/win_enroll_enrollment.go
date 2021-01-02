package windows

import (
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"crypto/x509"
	"crypto/x509/pkix"

	"github.com/fullsailor/pkcs7"
	"github.com/mattrax/Mattrax/internal/api"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/pkg"
	"github.com/mattrax/Mattrax/pkg/null"
	"github.com/mattrax/Mattrax/pkg/soap"
	wap "github.com/mattrax/Mattrax/pkg/wap_provisioning_doc"
	"github.com/openzipkin/zipkin-go"
)

// Enrollment provisions the device's management client and issues it a certificate which is used for authentication
func Enrollment(p *Protocol) http.HandlerFunc {
	managementServiceURL, err := pkg.GetNamedRouteURL(p.srv.Router, "manage")
	if err != nil {
		log.Fatal("Error: Management endpoint not found on the router.")
	}

	var Handler = func(span zipkin.Span, w http.ResponseWriter, r *http.Request, cmd soap.EnrollmentRequest) soap.ResponseEnvelope {
		if cmd.Header.Action != "http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RST/wstep" {
			err = fmt.Errorf("incorrect request action")
			log.Printf("[Error] Enrollment Enroll | %s\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:MessageFormat", "InvalidEnrollmentData", "The request was not destined for this endpoint", span.Context().TraceID.String())
		}

		if url, err := url.ParseRequestURI(cmd.Header.To); err != nil || url.Host != p.srv.Args.Domain {
			err = fmt.Errorf("the request was not destined for this server")
			log.Printf("[Error] Enrollment Enroll | %s\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:MessageFormat", "InvalidEnrollmentData", "The request was not destined for this server", span.Context().TraceID.String())
		}

		binarySecurityToken, err := cmd.Body.BinarySecurityToken.DecodedValue()
		if err != nil {
			err = fmt.Errorf("binary security token: %w", err)
			log.Printf("[Error] Enrollment Enroll | %s\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:MessageFormat", "InvalidEnrollmentData", "The binary security token format is not supported", span.Context().TraceID.String())
		}

		deviceID := cmd.GetAdditionalContextItem("DeviceID")
		if deviceID == "" {
			err = fmt.Errorf("missing additional context item 'DeviceID'")
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:InternalServiceFault", "InvalidEnrollmentData", "Request missing required information", span.Context().TraceID.String())
		} else if cmd.GetAdditionalContextItem("EnrollmentType") == "" {
			err = fmt.Errorf("missing additional context item 'EnrollmentType'")
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:InternalServiceFault", "InvalidEnrollmentData", "Request missing required information", span.Context().TraceID.String())
		}
		span.Tag("device_id", deviceID)
		span.Tag("upn", cmd.Header.WSSESecurity.Username)

		var user db.GetUserSecureRow
		var tenant db.GetTenantRow
		var certificateSigningRequest []byte
		if cmd.Body.RequestType == soap.EnrollmentRequestTypeIssue {
			span.SetName("enrollment-issue")

			if cmd.Body.BinarySecurityToken.ValueType != soap.BinarySecurityTokenTypePKCS10 {
				err = fmt.Errorf("The binary security token type is unsupported")
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token type is unsupported", span.Context().TraceID.String())
			}

			user, err = p.srv.API.Login(r.Context(), cmd.Header.WSSESecurity.Username, cmd.Header.WSSESecurity.Password)
			if err == api.ErrIncorrectCredentials {
				span.Tag("warn", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:Authentication", "", "Authentication error: incorrect credentials", span.Context().TraceID.String())
			} else if err == api.ErrUserIsDisabled {
				span.Tag("warn", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:Authentication", "", "Authentication error: user is disabled", span.Context().TraceID.String())
			} else if err != nil {
				span.Tag("err", fmt.Sprintf("error authenticating user: %s", err))
				return soap.NewFault("s:Receiver", "s:InternalServiceFault", "", "Server encountered an error. Please check the server logs for more info", span.Context().TraceID.String())
			}

			tenant, err = p.srv.DB.GetTenant(r.Context(), user.TenantID.String)
			if err != nil {
				span.Tag("err", fmt.Sprintf("error retrieving tenant: %s", err))
				return soap.NewFault("s:Receiver", "s:InternalServiceFault", "", "Server encountered an error. Please check the server logs for more info", span.Context().TraceID.String())
			}

			certificateSigningRequest = binarySecurityToken
		} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew {
			span.SetName("enrollment-renew")

			if cmd.Body.BinarySecurityToken.ValueType != soap.BinarySecurityTokenTypePKCS7 {
				err = fmt.Errorf("The binary security token type is unsupported")
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token type is unsupported", span.Context().TraceID.String())
			}

			p7, err := pkcs7.Parse(binarySecurityToken)
			if err != nil {
				err = fmt.Errorf("error parsing binary security token: %w", err)
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token could not be parsed", span.Context().TraceID.String())
			} else if err := p7.Verify(); err != nil {
				err = fmt.Errorf("error verifying binary security token: %w", err)
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token could not be verified", span.Context().TraceID.String())
			}

			signer := p7.GetOnlySigner()
			if signer == nil {
				err = fmt.Errorf("error retrieving binary security token signer")
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token signer could not be retrieved", span.Context().TraceID.String())
			} else if /* This checks that the devices existing cert has not expired */ now := time.Now(); now.Before(signer.NotBefore) || now.After(signer.NotAfter) {
				err = fmt.Errorf("error expired binary security token signer: %w", err)
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token signer is expired", span.Context().TraceID.String())
			} else if err := p.srv.Cert.IsIssuerIdentity(signer); err != nil {
				err = fmt.Errorf("error unknown binary security token signer: %w", err)
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token signer could not be verified", span.Context().TraceID.String())
			} else if os.Getenv("DISABLE_CERT_RENEW_ELIGIBILITY") != "true" && time.Until(signer.NotAfter).Hours()/24 > wap.ROBORenewPeriod {
				err = fmt.Errorf("error device is not eligible to renew yet")
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:InternalServiceFault", "NotEligibleToRenew", "The device certificate is not eligible to renew yet", span.Context().TraceID.String())
			}

			span.Tag("pkcs7_subject", signer.Subject.String())
			if deviceID != signer.Subject.CommonName {
				err = fmt.Errorf("error device identity and renewal request mismatch")
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:Authentication", "", "Device identity and renewal request mismatch", span.Context().TraceID.String())
			}

			certificateSigningRequest = p7.Content
		} else {
			err := fmt.Errorf("enrollment request type not supported")
			log.Printf("[Error] Enrollment Enroll | %s\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The request could not be handled by this server", span.Context().TraceID.String())
		}

		csr, err := x509.ParseCertificateRequest(certificateSigningRequest)
		if err != nil {
			err = fmt.Errorf("error parsing binary security token csr: %w", err)
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token could not be parsed", span.Context().TraceID.String())
		} else if err = csr.CheckSignature(); err != nil {
			err = fmt.Errorf("error verifying binary security token csr signature: %w", err)
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:MessageFormat", "", "The binary security token could not be verified", span.Context().TraceID.String())
		}

		var certStore = "User"
		var clientCertSubject = pkix.Name{}
		if cmd.GetAdditionalContextItem("EnrollmentType") == "Device" {
			certStore = "System"
			clientCertSubject.CommonName = deviceID
		} else {
			clientCertSubject.CommonName = cmd.Header.WSSESecurity.Username
		}
		span.Tag("issued_cert_subject", clientCertSubject.String())

		identityCertificate, signedClientCertificate, rawSignedClientCertificate, err := p.srv.Cert.IdentitySignCSR(csr, clientCertSubject)
		if err != nil {
			err = fmt.Errorf("error signing csr: %w", err)
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:InternalServiceFault", "", "Server encountered an error. Please check the server logs for more info", span.Context().TraceID.String())
		}

		var wapProvisioningDoc = wap.NewProvisioningDoc()
		wapProvisioningDoc.NewCertStore(identityCertificate, certStore, rawSignedClientCertificate, "")
		if cmd.Body.RequestType == soap.EnrollmentRequestTypeIssue {
			var name = cmd.GetAdditionalContextItem("DeviceName")
			if name == "" {
				name = deviceID
			}

			id, err := p.srv.DB.CreateDevice(r.Context(), db.CreateDeviceParams{
				TenantID: user.TenantID.String,
				Protocol: db.ManagementProtocolWindows,
				Scope:    MattraxManagementScope(certStore),
				State:    db.DeviceStateDeploying,
				Udid:     deviceID,
				Name: null.String{
					String: name,
					Valid:  true,
				},
				SerialNumber: null.String{
					String: cmd.GetAdditionalContextItem("HWDevID"),
					Valid:  cmd.GetAdditionalContextItem("HWDevID") != "",
				},
				OsMajor: null.String{
					String: cmd.GetAdditionalContextItem("OSEdition"),
					Valid:  cmd.GetAdditionalContextItem("OSEdition") != "",
				},
				OsMinor: null.String{
					String: cmd.GetAdditionalContextItem("OSVersion"),
					Valid:  cmd.GetAdditionalContextItem("OSVersion") != "",
				},
				Owner: null.String{
					String: cmd.Header.WSSESecurity.Username,
					Valid:  true,
				},
				Ownership: MattraxDeviceOwnership(cmd.GetAdditionalContextItem("EnrollmentType")),
			})
			if err != nil {
				err = fmt.Errorf("error creating device: %w", err)
				log.Printf("[Error] Enrollment Enroll | %v\n", err)
				span.Tag("err", fmt.Sprintf("%s", err))
				return soap.NewFault("s:Receiver", "s:InternalServiceFault", "", "Server encountered an error. Please check the server logs for more info", span.Context().TraceID.String())
			}

			var dmClientParams = []wap.Parameter{
				{
					Name:     "EntDMID",
					Value:    id,
					DataType: "string",
				},
			}

			if tenant.Phone.Valid {
				dmClientParams = append(dmClientParams, wap.Parameter{
					Name:     "HelpPhoneNumber",
					Value:    tenant.Phone.String,
					DataType: "string",
				})
			}
			// TODO: if tenant.Website.Valid {
			// 	dmClientParams = append(dmClientParams, wap.Parameter{
			// 		Name:     "HelpWebsite",
			// 		Value:    tenant.Website.String,
			// 		DataType: "string",
			// 	})
			// }
			if tenant.Email.Valid {
				dmClientParams = append(dmClientParams, wap.Parameter{
					Name:     "HelpEmailAddress",
					Value:    tenant.Email.String,
					DataType: "string",
				})
			}

			wapProvisioningDoc.NewW7Application(ProviderID, tenant.DisplayName.String, managementServiceURL, certStore, signedClientCertificate.Subject.String())
			wapProvisioningDoc.NewDMClient(ProviderID, dmClientParams, []wap.Characteristic{
				wap.DefaultPollCharacteristic,
				{
					Type: "CustomEnrollmentCompletePage",
					Params: []wap.Parameter{
						{
							Name:     "Title",
							Value:    "Mattrax Enrollment Complete",
							DataType: "string",
						},
						{
							Name:     "BodyText",
							Value:    "Welcome " + cmd.Header.WSSESecurity.Username + ", Your device is now being managed by '" + tenant.DisplayName.String + "'. Please contact your IT administrators for support if you have any problems.",
							DataType: "string",
						},
					},
				},
			})
		} else if cmd.Body.RequestType == soap.EnrollmentRequestTypeRenew {
			wapProvisioningDoc.NewEmptyApplication(ProviderID)
		}

		rawProvisioningProfile, err := xml.Marshal(wapProvisioningDoc)
		if err != nil {
			err = fmt.Errorf("error marshalling wap document: %w", err)
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return soap.NewFault("s:Receiver", "s:InternalServiceFault", "", "Server encountered an error marshalling response body", span.Context().TraceID.String())
		}

		return soap.NewIssueEnrollmentResponse(cmd.Header.MessageID, rawProvisioningProfile)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		span := zipkin.SpanOrNoopFromContext(r.Context())

		var cmd soap.EnrollmentRequest
		if err := soap.Read(&cmd, w, r); err != nil {
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return
		}

		if err := soap.Respond(Handler(span, w, r, cmd), w); err != nil {
			log.Printf("[Error] Enrollment Enroll | %v\n", err)
			span.Tag("err", fmt.Sprintf("%s", err))
			return
		}
	}
}
