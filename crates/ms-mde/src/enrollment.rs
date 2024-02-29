// const enrollmentActionRequest = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RST/wstep"
// const enrollmentActionResponse = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep"

// // microsoftDeviceIDExtension contains the OID for the Microsoft certificate extension which includes the MDM DeviceID
// var microsoftDeviceIDExtension = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 311, 66, 1, 0}

// package soap

// import (
// 	"encoding/base64"
// 	"fmt"

// 	"github.com/mattrax/xml"
// )

// // EnrollmentRequestTypeIssue is the RequestType for the Enrollment request body used to issue a new certificate
// const EnrollmentRequestTypeIssue = "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue"

// // EnrollmentRequestTypeRenew is the RequestType for the Certificate Renewal request body to renew an existing certificate
// const EnrollmentRequestTypeRenew = "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Renew"

// // BinarySecurityTokenTypePKCS7 is the BinarySecurityToken ValueType for a PKCS7 which is used for the Renew request type
// const BinarySecurityTokenTypePKCS7 = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS7"

// // BinarySecurityTokenTypePKCS10 is the BinarySecurityToken ValueType for a PKCS10 which is used for the Issue request type
// const BinarySecurityTokenTypePKCS10 = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10"

// // EnrollmentRequest contains the device information and identity certificate CSR
// type EnrollmentRequest struct {
// 	XMLName xml.Name      `xml:"s:Envelope"`
// 	Header  RequestHeader `xml:"s:Header"`
// 	Body    struct {
// 		TokenType           string              `xml:"wst:TokenType"`
// 		RequestType         string              `xml:"wst:RequestType"`
// 		BinarySecurityToken BinarySecurityToken `xml:"wsse:BinarySecurityToken"`
// 		AdditionalContext   []ContextItem       `xml:"ac:AdditionalContext>ac:ContextItem"`
// 	} `xml:"s:Body>wst:RequestSecurityToken"`
// }

// // ContextItem are key value pairs which contains information about the device being enrolled
// type ContextItem struct {
// 	Name  string `xml:"Name,attr"`
// 	Value string `xml:"ac:Value"`
// }

// // BinarySecurityToken contains the CSR for the request and wap-provisioning payload for the response
// type BinarySecurityToken struct {
// 	ValueType    string `xml:"ValueType,attr"`
// 	EncodingType string `xml:"EncodingType,attr"`
// 	Value        string `xml:",chardata"`
// }

// // DecodedValue decodes the binary security token based off the specified encoding type
// func (bst BinarySecurityToken) DecodedValue() ([]byte, error) {
// 	if bst.EncodingType == "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary" {
// 		return base64.StdEncoding.DecodeString(bst.Value)
// 	}
// 	return nil, fmt.Errorf("encoding not supported")
// }

// // ValidateEnrollmentContext checks all of the required fields are present in the enrollment context
// func (cmd EnrollmentRequest) ValidateEnrollmentContext() error {
// 	if cmd.GetAdditionalContextItem("DeviceID") == "" {
// 		return fmt.Errorf("request missing ContextItem 'DeviceID'")
// 	} else if cmd.GetAdditionalContextItem("EnrollmentType") == "" {
// 		return fmt.Errorf("request missing ContextItem 'EnrollmentType'")
// 	} else if cmd.GetAdditionalContextItem("OSEdition") == "" {
// 		return fmt.Errorf("request missing ContextItem 'OSEdition'")
// 	}
// 	return nil
// }

// // GetAdditionalContextItem retrieves the first AdditionalContext item with the specified name
// func (cmd EnrollmentRequest) GetAdditionalContextItem(name string) string {
// 	for _, contextItem := range cmd.Body.AdditionalContext {
// 		if contextItem.Name == name {
// 			return contextItem.Value
// 		}
// 	}
// 	return ""
// }

// // GetAdditionalContextItems retrieves all AdditionalContext items with a specified name
// func (cmd EnrollmentRequest) GetAdditionalContextItems(name string) []string {
// 	var contextItems []string
// 	for _, contextItem := range cmd.Body.AdditionalContext {
// 		if contextItem.Name == name {
// 			contextItems = append(contextItems, contextItem.Value)
// 		}
// 	}
// 	return contextItems
// }

// // EnrollmentResponse contains the management client configuration and signed identity certificate
// type EnrollmentResponse struct {
// 	XMLName                      xml.Name            `xml:"http://docs.oasis-open.org/ws-sx/ws-trust/200512 RequestSecurityTokenResponseCollection"`
// 	TokenType                    string              `xml:"RequestSecurityTokenResponse>TokenType"`
// 	DispositionMessage           DispositionMessage  `xml:"http://schemas.microsoft.com/windows/pki/2009/01/enrollment RequestSecurityTokenResponse>DispositionMessage"`
// 	RequestedBinarySecurityToken BinarySecurityToken `xml:"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd RequestSecurityTokenResponse>RequestedSecurityToken>BinarySecurityToken"`
// 	RequestID                    int                 `xml:"http://schemas.microsoft.com/windows/pki/2009/01/enrollment RequestSecurityTokenResponse>RequestID"`
// }

// // DispositionMessage is an extension to the string type that allows an attribute definition of the language
// type DispositionMessage struct {
// 	Lang  string `xml:"xml:lang,attr"`
// 	Value string `xml:",innerxml"`
// }
