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
