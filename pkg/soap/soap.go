package soap

import (
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/mattrax/xml"
)

// MaxRequestBodySize is the maximum amount of data that is allowed in a single request
const MaxRequestBodySize = 10000

// MustUnderstand is a easily way to create SOAP tags with s:mustUnderstand
type MustUnderstand struct {
	MustUnderstand string `xml:"s:mustUnderstand,attr,omitempty"`
	Value          string `xml:",innerxml"`
}

// RequestHeader is a generic SOAP body for requests
type RequestHeader struct {
	Action    string `xml:"a:Action"`
	MessageID string `xml:"a:MessageID"`
	ReplyTo   struct {
		Address string `xml:"a:Address"`
	} `xml:"a:ReplyTo"`
	To           string `xml:"a:To"`
	WSSESecurity struct {
		Username            string `xml:"wsse:UsernameToken>wsse:Username"`
		Password            string `xml:"wsse:UsernameToken>wsse:Password"`
		BinarySecurityToken string `xml:"wsse:BinarySecurityToken"`
	} `xml:"wsse:Security"`
}

// ResponseEnvelope is a generic Envelope used for the servers responses
type ResponseEnvelope struct {
	XMLName    xml.Name             `xml:"s:Envelope"`
	NamespaceS string               `xml:"xmlns:s,attr"`
	NamespaceA string               `xml:"xmlns:a,attr"`
	Header     ResponseHeader       `xml:"s:Header"`
	Body       ResponseEnvelopeBody `xml:"s:Body"`
}

// Populate sets reasonable default values on the response envelope
func (e *ResponseEnvelope) Populate(action string) {
	e.NamespaceS = "http://www.w3.org/2003/05/soap-envelope"
	e.NamespaceA = "http://www.w3.org/2005/08/addressing"
	e.Header.Action = MustUnderstand{
		MustUnderstand: "1",
		Value:          action,
	}
	e.Header.ActivityID = uuid.New().String()
	e.Body.NamespaceXSI = "http://www.w3.org/2001/XMLSchema-instance"
	e.Body.NamespaceXSD = "http://www.w3.org/2001/XMLSchema"
}

// ResponseHeader is a generic SOAP body for responses
type ResponseHeader struct {
	Action     MustUnderstand `xml:"a:Action,omitempty"`
	ActivityID string         `xml:"a:ActivityID,omitempty"`
	RelatesTo  string         `xml:"a:RelatesTo,omitempty"`
}

// ResponseEnvelopeBody is a generic s:Body which contains the endpoint specific response
type ResponseEnvelopeBody struct {
	NamespaceXSI string `xml:"xmlns:xsi,attr,omitempty"`
	NamespaceXSD string `xml:"xmlns:xsd,attr,omitempty"`
	Body         interface{}
}

// Read safely decodes a SOAP request from the HTTP body into a struct
func Read(v interface{}, w http.ResponseWriter, r *http.Request) error {
	if r.ContentLength > MaxRequestBodySize {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return fmt.Errorf("error reading request body of size '%d' as its larger than the maximum supported size of '%d'", r.ContentLength, MaxRequestBodySize)
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodySize)
	if err := xml.NewDecoder(r.Body).Decode(v); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return fmt.Errorf("error decoding request of type '%T': %v", v, err)
	}

	return nil
}

// Respond encodes a SOAP response from a struct into the HTTP response
func Respond(v ResponseEnvelope, w http.ResponseWriter) error {
	body, err := xml.Marshal(v)
	if err != nil {
		v = NewFault("s:Receiver", "s:InternalServiceFault", "", "Server encountered an error. Please check the server logs for more info", "")
		var err2 error
		if body, err2 = xml.Marshal(v); err2 != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return fmt.Errorf("error marshalling response of type '%T': %v", v, err)
		}
	}

	w.Header().Set("Content-Type", "application/soap+xml; charset=utf-8")
	w.Header().Set("Content-Length", fmt.Sprintf("%v", len(body)))
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("error writing response body to client: %v", err)
	}

	return nil
}
