package handlers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/oscartbeaumont/forge/dominion/internal"
	"github.com/oscartbeaumont/forge/dominion/pkg/soap"
)

const discoverActionRequest = "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover"
const discoverActionResponse = "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse"

// DiscoverGET allows the device to tests a domain for the existance of a management server
func DiscoverGET(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

// DiscoverPOST allows the device to discover the enrollment policy and the URLs of the future endpoints
func DiscoverPOST(w http.ResponseWriter, r *http.Request) {
	fault := soap.FaultFromRequest("discover", discoverActionResponse, w)

	var cmd soap.DiscoverRequest
	if err := soap.NewDecoder(r.Body).Decode(&cmd); err != nil {
		fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
		return
	}
	fault.SetRequestContext(cmd.Header)

	if cmd.Header.Action != discoverActionRequest {
		fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
		return
	}

	if cmd.Body.RequestVersion == "" {
		cmd.Body.RequestVersion = "4.0"
	}

	var res = soap.DefaultResponseEnvelope
	res.Header.Action.Value = discoverActionResponse
	res.Header.ActivityID = soap.NewActivityID("todo", "todo")
	res.Header.RelatesTo = "urn:uuid:" + cmd.Header.MessageID
	res.Body = soap.ResponseEnvelopeBody{
		Body: soap.DiscoverResponse{
			AuthPolicy:                 "OnPremise",
			EnrollmentVersion:          cmd.Body.RequestVersion,
			EnrollmentPolicyServiceURL: internal.EnrollmentPolicyServiceURL,
			EnrollmentServiceURL:       internal.EnrollmentServiceURL,
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
