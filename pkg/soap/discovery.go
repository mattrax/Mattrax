package soap

import (
	"github.com/mattrax/xml"
)

// DiscoverRequest contains the device and user information to help inform the response
type DiscoverRequest struct {
	XMLName xml.Name      `xml:"s:Envelope"`
	Header  RequestHeader `xml:"s:Header"`
	Body    struct {
		EmailAddress       string       `xml:"EmailAddress"`
		RequestVersion     string       `xml:"RequestVersion"`
		DeviceType         string       `xml:"DeviceType"`
		ApplicationVersion string       `xml:"ApplicationVersion"`
		OSEdition          string       `xml:"OSEdition"`
		AuthPolicies       AuthPolicies `xml:"AuthPolicies"`
	} `xml:"s:Body>Discover>request"`
}

// DiscoverResponse contains the enrollment endpoints and authentication type for the device to continue enrollment with
type DiscoverResponse struct {
	XMLName                    xml.Name `xml:"http://schemas.microsoft.com/windows/management/2012/01/enrollment DiscoverResponse"`
	AuthPolicy                 string   `xml:"DiscoverResult>AuthPolicy"`
	EnrollmentVersion          string   `xml:"DiscoverResult>EnrollmentVersion"`
	EnrollmentPolicyServiceURL string   `xml:"DiscoverResult>EnrollmentPolicyServiceUrl"`
	EnrollmentServiceURL       string   `xml:"DiscoverResult>EnrollmentServiceUrl"`
	AuthenticationServiceURL   string   `xml:"DiscoverResult>AuthenticationServiceUrl,omitempty"`
}

// AuthPolicies contains the array of supported AuthPolicies
type AuthPolicies struct {
	AuthPolicies []string `xml:"AuthPolicy"`
}

// IsAuthPolicySupported checks the AuthPolicies array for the existent of an AuthPolicy
func (authPolicies AuthPolicies) IsAuthPolicySupported(authPolicyStr string) bool {
	for _, ap := range authPolicies.AuthPolicies {
		if ap == authPolicyStr {
			return true
		}
	}

	return false
}

// NewDiscoverResponse creates a generic discover response envelope
func NewDiscoverResponse(relatesTo string) ResponseEnvelope {
	var res = ResponseEnvelope{
		Header: ResponseHeader{
			RelatesTo: relatesTo,
		},
		Body: ResponseEnvelopeBody{
			Body: DiscoverResponse{},
		},
	}
	res.Populate("http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse")
	return res
}
