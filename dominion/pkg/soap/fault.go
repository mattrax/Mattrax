package soap

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/mattrax/xml"
)

// faultCode is a SOAP Fault Code that is supported by Windows MDM
type faultCode string

// These codes are documented here: https://docs.microsoft.com/en-us/windows/client-management/mdm/mobile-device-enrollment#enrollment-error-messages
const (
	// FaultCodeMessageFormat 0x80180001
	FaultCodeMessageFormat faultCode = "s:MessageFormat"

	// FaultCodeAuthentication 0x80180002
	FaultCodeAuthentication faultCode = "s:Authentication"

	// FaultCodeAuthorization 0x80180003
	FaultCodeAuthorization faultCode = "s:Authorization"

	// FaultCodeCertificateRequest 0x80180004
	FaultCodeCertificateRequest faultCode = "s:CertificateRequest"

	// FaultCodeEnrollmentServer 0x80180005
	FaultCodeEnrollmentServer faultCode = "s:EnrollmentServer"

	// FaultCodeInternalServiceFault 0x80180006
	FaultCodeInternalServiceFault faultCode = "a:InternalServiceFault"

	// FaultCodeInvalidSecurity 0x80180007
	FaultCodeInvalidSecurity faultCode = "a:InvalidSecurity"

	// FaultCodeActionMismatch 0x80180008
	FaultCodeActionMismatch faultCode = "a:ActionMismatch"

	// FaultCodeEndpointUnavailable 0x80180008
	FaultCodeEndpointUnavailable faultCode = "a:EndpointUnavailable"
)

// FaultCodeCauser finds the causer of a specific fault code
func FaultCodeCauser(fc faultCode) string {
	if fc == FaultCodeActionMismatch || fc == FaultCodeEndpointUnavailable || fc == FaultCodeInternalServiceFault {
		return "s:Sender"
	} else if fc == FaultCodeMessageFormat || fc == FaultCodeAuthentication || fc == FaultCodeInvalidSecurity {
		return "s:Receiver"
	} else {
		panic("The fault code causer is not specified")
	}
}

// FaultBody is the body that is returned when an error occurs
type FaultBody struct {
	XMLName xml.Name                          `xml:"s:Fault"`
	Code    FaultCodeStruct                   `xml:"s:Code"`
	Reason  FaultReason                       `xml:"s:Reason>s:Text"`
	Detail  FaultDeviceEnrollmentServiceError `xml:"http://schemas.microsoft.com/windows/pki/2009/01/enrollment s:Detail>DeviceEnrollmentServiceError,omitempty"`
}

// FaultCodeStruct contains the errors causer (Sender or Receiver) and the error code
type FaultCodeStruct struct {
	Value   string           `xml:"s:Value"`
	Subcode FaultCodeSubcode `xml:"s:Subcode>s:Value"`
}

// FaultCodeSubcode contains the faults code
type FaultCodeSubcode struct {
	XMLNSA string `xml:"xmlns:a,attr,omitempty"`
	Value  string `xml:",innerxml"`
}

// FaultReason contains the human readable error message which is shown in the device management logs
type FaultReason struct {
	Lang  string `xml:"xml:lang,attr"`
	Value string `xml:",innerxml"`
}

// FaultDeviceEnrollmentServiceError contains extra error codes (which sometimes have special UI's) and a traceid which can be used trace requests between the client and server logs
type FaultDeviceEnrollmentServiceError struct {
	ErrorType string `xml:"ErrorType,omitempty"`
	Message   string `xml:"Message,omitempty"`
	TraceID   string `xml:"TraceId,omitempty"`
}

// Fault is a simple fault handler for endpoints
type Fault struct {
	causer string
	action string
	w      http.ResponseWriter
	header RequestHeader
}

// SetRequestContext allows the fault to correctly fill its header
func (fault *Fault) SetRequestContext(header RequestHeader) {
	fault.header = header
}

// Fault triggers a normal fault. It is logged, reported to tracing system and the SOAP Fault is send as the response body
func (fault Fault) Fault(err error, userMsg string, faultCode faultCode) {
	err = fmt.Errorf("%v: %w", fault.causer, err)
	log.Println(err)
	fault.httpFault(userMsg, faultCode, "")
}

// AdvancedFault triggers a DeviceEnrollmentServiceError fault. It is logged, reported to tracing system and the SOAP Fault is send as the response body
func (fault Fault) AdvancedFault(err error, userMsg string, errorType string, faultCode faultCode) {
	err = fmt.Errorf("%v: %w", fault.causer, err)
	log.Println(err)
	fault.httpFault(userMsg, faultCode, errorType)
}

// httpFault handles generating the fault body and sending it as the response body
func (fault Fault) httpFault(userMsg string, faultCode faultCode, errortype string) {
	var deviceEnrollmentServiceError FaultDeviceEnrollmentServiceError = FaultDeviceEnrollmentServiceError{
		TraceID: "todo",
	}
	if errortype != "" {
		deviceEnrollmentServiceError.ErrorType = errortype
		deviceEnrollmentServiceError.Message = userMsg
	}

	var xmlnsA = ""
	if strings.HasPrefix(string(faultCode), "a:") {
		xmlnsA = "http://schemas.microsoft.com/net/2005/12/windowscommunicationfoundation/dispatcher"
	}

	res := ResponseEnvelope{
		NamespaceS: "http://www.w3.org/2003/05/soap-envelope",
		NamespaceA: "http://www.w3.org/2005/08/addressing",
		Header: ResponseHeader{
			Action: MustUnderstand{
				Value: fault.action,
			},
			ActivityID: NewActivityID("todo", "todo"),
			RelatesTo:  "urn:uuid:" + fault.header.MessageID,
		},
		Body: ResponseEnvelopeBody{
			Body: FaultBody{
				Code: FaultCodeStruct{
					Value: FaultCodeCauser(faultCode),
					Subcode: FaultCodeSubcode{
						XMLNSA: xmlnsA,
						Value:  string(faultCode),
					},
				},
				Reason: FaultReason{
					Lang:  "en-US",
					Value: userMsg,
				},
				Detail: deviceEnrollmentServiceError,
			},
		},
	}

	body, err := Marshal(res)
	if err != nil {
		fault.w.WriteHeader(http.StatusInternalServerError)
		return
	}

	fault.w.Header().Set("Content-Type", "application/soap+xml; charset=utf-8")
	fault.w.Header().Set("Content-Length", fmt.Sprintf("%v", len(body)))
	fault.w.WriteHeader(http.StatusInternalServerError)
	if _, err := fault.w.Write(body); err != nil {
		log.Println("ResponseWriter Error:", err)
		return
	}
}

// FaultFromRequest creates a new fault from a HTTP request
func FaultFromRequest(causer string, action string, w http.ResponseWriter) Fault {
	return Fault{
		causer: causer,
		action: action,
		w:      w,
	}
}
