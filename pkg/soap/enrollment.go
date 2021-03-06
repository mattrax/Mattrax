package soap

import (
	"encoding/base64"
	"fmt"

	"github.com/mattrax/xml"
)

// EnrollmentRequest contains the device information and identity certificate CSR
type EnrollmentRequest struct {
	XMLName xml.Name      `xml:"s:Envelope"`
	Header  RequestHeader `xml:"s:Header"`
	Body    struct {
		TokenType           string              `xml:"wst:TokenType"`
		RequestType         string              `xml:"wst:RequestType"`
		BinarySecurityToken BinarySecurityToken `xml:"wsse:BinarySecurityToken"`
		AdditionalContext   []ContextItem       `xml:"ac:AdditionalContext>ac:ContextItem"`
	} `xml:"s:Body>wst:RequestSecurityToken"`
}

// BinarySecurityToken contains the CSR for the request and wap-provisioning payload for the response
type BinarySecurityToken struct {
	ValueType    string `xml:"ValueType,attr"`
	EncodingType string `xml:"EncodingType,attr"`
	Value        string `xml:",chardata"`
}

// DecodedValue decodes the binary security token based off the specified encoding type
func (bst BinarySecurityToken) DecodedValue() ([]byte, error) {
	if bst.EncodingType == "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary" {
		return base64.StdEncoding.DecodeString(bst.Value)
	}
	return nil, fmt.Errorf("encoding not supported")
}

// EnrollmentRequestTypeIssue is the RequestType for the Enrollment request body used to issue a new certificate
const EnrollmentRequestTypeIssue = "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue"

// EnrollmentRequestTypeRenew is the RequestType for the Certificate Renewal request body to renew an existing certificate
const EnrollmentRequestTypeRenew = "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Renew"

// BinarySecurityTokenTypePKCS7 is the BinarySecurityToken ValueType for a PKCS7 which is used for the Renew request type
const BinarySecurityTokenTypePKCS7 = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS7"

// BinarySecurityTokenTypePKCS10 is the BinarySecurityToken ValueType for a PKCS10 which is used for the Issue request type
const BinarySecurityTokenTypePKCS10 = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10"

// ContextItem are key value pairs which contains information about the device being enrolled
type ContextItem struct {
	Name  string `xml:"Name,attr"`
	Value string `xml:"ac:Value"`
}

// GetAdditionalContextItem retrieves the first AdditionalContext item with the specified name
func (cmd EnrollmentRequest) GetAdditionalContextItem(name string) string {
	for _, contextItem := range cmd.Body.AdditionalContext {
		if contextItem.Name == name {
			return contextItem.Value
		}
	}
	return ""
}

// GetAdditionalContextItems retrieves all AdditionalContext items with a specified name
func (cmd EnrollmentRequest) GetAdditionalContextItems(name string) []string {
	var contextItems []string
	for _, contextItem := range cmd.Body.AdditionalContext {
		if contextItem.Name == name {
			contextItems = append(contextItems, contextItem.Value)
		}
	}
	return contextItems
}

// EnrollmentResponse contains the management client configuration and signed identity certificate
type EnrollmentResponse struct {
	XMLName xml.Name `xml:"http://docs.oasis-open.org/ws-sx/ws-trust/200512 RequestSecurityTokenResponseCollection"`
	// BinarySecurityToken          BinarySecurityToken `xml:"RequestSecurityTokenResponse>TokenType"`
	TokenType                    string              `xml:"RequestSecurityTokenResponse>TokenType"`
	DispositionMessage           DispositionMessage  `xml:"http://schemas.microsoft.com/windows/pki/2009/01/enrollment RequestSecurityTokenResponse>DispositionMessage"`
	RequestedBinarySecurityToken BinarySecurityToken `xml:"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd RequestSecurityTokenResponse>RequestedSecurityToken>BinarySecurityToken"`
	RequestID                    int                 `xml:"http://schemas.microsoft.com/windows/pki/2009/01/enrollment RequestSecurityTokenResponse>RequestID"`
}

// DispositionMessage is an extension to the string type that allows an attribute definition of the language
type DispositionMessage struct {
	Lang  string `xml:"xml:lang,attr"`
	Value string `xml:",innerxml"`
}

// NewIssueEnrollmentResponse creates a generic enrollment response envelope for device enrollment
func NewIssueEnrollmentResponse(relatesTo string, rawProvisioningProfile []byte) ResponseEnvelope {
	var res = ResponseEnvelope{
		Header: ResponseHeader{
			RelatesTo: relatesTo,
		},
		Body: ResponseEnvelopeBody{
			Body: EnrollmentResponse{
				TokenType:          "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
				DispositionMessage: DispositionMessage{},
				RequestedBinarySecurityToken: BinarySecurityToken{
					ValueType:    "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc",
					EncodingType: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
					Value:        base64.StdEncoding.EncodeToString(append([]byte(`<?xml version="1.0" encoding="UTF-8"?>`), rawProvisioningProfile...)),
				},
				RequestID: 0,
			},
		},
	}
	res.Populate("http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep")
	return res
}
