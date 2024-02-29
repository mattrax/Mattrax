// package soap

// import (
// 	"io"

// 	"github.com/mattrax/xml"
// )

// // MaxRequestBodySize is the maximum amount of data that is allowed in a single request
// const MaxRequestBodySize = 10000

// // DefaultResponseEnvelope is a SOAP response body prepopulated with defaults
// var DefaultResponseEnvelope = ResponseEnvelope{
// 	NamespaceS: "http://www.w3.org/2003/05/soap-envelope",
// 	NamespaceA: "http://www.w3.org/2005/08/addressing",
// 	Header: ResponseHeader{
// 		Action: MustUnderstand{
// 			MustUnderstand: "1",
// 		},
// 	},
// }

// // NewDecoder exposes mattrax/xml as soap.NewDecoder
// // This prevents xml.NewDecode defaulting to encoding/xml not the forked version and causing bugs
// func NewDecoder(r io.Reader) *xml.Decoder {
// 	return xml.NewDecoder(r)
// }

// // Marshal exposes mattrax/xml as soap.Marshal
// // This prevents xml.Marshal defaulting to encoding/xml not the forked version and causing bugs
// func Marshal(v interface{}) ([]byte, error) {
// 	return xml.Marshal(v)
// }

// // MustUnderstand is a easily way to create SOAP tags with s:mustUnderstand
// type MustUnderstand struct {
// 	MustUnderstand string `xml:"s:mustUnderstand,attr,omitempty"`
// 	Value          string `xml:",innerxml"`
// }

// // RequestHeader is a generic SOAP body for requests
// type RequestHeader struct {
// 	Action    string `xml:"a:Action"`
// 	MessageID string `xml:"a:MessageID"`
// 	ReplyTo   struct {
// 		Address string `xml:"a:Address"`
// 	} `xml:"a:ReplyTo"`
// 	To           string `xml:"a:To"`
// 	WSSESecurity struct {
// 		Username            string               `xml:"wsse:UsernameToken>wsse:Username"`
// 		Password            string               `xml:"wsse:UsernameToken>wsse:Password"`
// 		BinarySecurityToken *BinarySecurityToken `xml:"wsse:BinarySecurityToken"`
// 	} `xml:"wsse:Security"`
// }

// // ResponseEnvelope is a generic Envelope used for the servers responses
// type ResponseEnvelope struct {
// 	XMLName    xml.Name             `xml:"s:Envelope"`
// 	NamespaceS string               `xml:"xmlns:s,attr"`
// 	NamespaceA string               `xml:"xmlns:a,attr"`
// 	Header     ResponseHeader       `xml:"s:Header"`
// 	Body       ResponseEnvelopeBody `xml:"s:Body"`
// }

// // ResponseHeader is a generic SOAP body for responses
// type ResponseHeader struct {
// 	Action     MustUnderstand `xml:"a:Action,omitempty"`
// 	ActivityID ActivityID     `xml:"ActivityId,omitempty"`
// 	RelatesTo  string         `xml:"a:RelatesTo,omitempty"`
// }

// // ActivityID contains information for tracing the response
// type ActivityID struct {
// 	XMLNS         string `xml:"xmlns,attr"`
// 	CorrelationID string `xml:"CorrelationId,attr,omitempty"`
// 	ActivityID    string `xml:",innerxml"`
// }

// // NewActivityID creates an ActivityID component
// func NewActivityID(aid string, tid string) ActivityID {
// 	return ActivityID{
// 		XMLNS:         "http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics",
// 		CorrelationID: tid,
// 		ActivityID:    aid,
// 	}
// }

// // ResponseEnvelopeBody is a generic s:Body which contains the endpoint specific response
// type ResponseEnvelopeBody struct {
// 	NamespaceXSI string `xml:"xmlns:xsi,attr,omitempty"`
// 	NamespaceXSD string `xml:"xmlns:xsd,attr,omitempty"`
// 	Body         interface{}
// }
