package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/oscartbeaumont/forge/dominion/internal"
	"github.com/oscartbeaumont/forge/dominion/pkg/soap"
)

const policyActionRequest = "http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPolicies"
const policyActionResponse = "http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPoliciesResponse"

// Policy instructs the client how the generate the identity certificate.
// This endpoint is part of the spec MS-XCEP.
func Policy(w http.ResponseWriter, r *http.Request) {
	fault := soap.FaultFromRequest("policy", policyActionResponse, w)

	var cmd soap.PolicyRequest
	if err := soap.NewDecoder(r.Body).Decode(&cmd); err != nil {
		fault.Fault(err, "the request could not be parsed", soap.FaultCodeInternalServiceFault)
		return
	}
	fault.SetRequestContext(cmd.Header)

	if cmd.Header.Action != policyActionRequest {
		fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
		return
	} else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.To, "?")[0] {
		fault.Fault(fmt.Errorf("the request was destined for another server"), "the request was not destined for this server", soap.FaultCodeEndpointUnavailable)
		return
	}

	var res = soap.DefaultResponseEnvelope
	res.Header.Action.Value = policyActionResponse
	res.Header.ActivityID = soap.NewActivityID("todo", "todo")
	res.Header.RelatesTo = "urn:uuid:" + cmd.Header.MessageID
	res.Body = soap.ResponseEnvelopeBody{
		NamespaceXSI: "http://www.w3.org/2001/XMLSchema-instance",
		Body: soap.PolicyResponse{
			Response: soap.PolicyXCEPResponse{
				PolicyID:           internal.EnrollmentPolicyID,
				PolicyFriendlyName: internal.EnrollmentPolicyFriendlyName,
				NextUpdateHours:    soap.NillableField,
				PoliciesNotChanged: soap.NillableField,
				Policies: soap.XCEPPolicies{
					Policies: []soap.XCEPPolicy{
						{
							OIDReferenceID: 0, // References to OID defined in OIDs section
							CAs:            soap.NillableField,
							Attributes: soap.XCEPAttributes{
								PolicySchema: 3,
								PrivateKeyAttributes: soap.XCEPPrivateKeyAttributes{
									MinimalKeyLength:      4096,
									KeySpec:               soap.NillableField,
									KeyUsageProperty:      soap.NillableField,
									Permissions:           soap.NillableField,
									AlgorithmOIDReference: soap.NillableField,
									CryptoProviders:       soap.NillableField,
								},
								SupersededPolicies:        soap.NillableField,
								PrivateKeyFlags:           soap.NillableField,
								SubjectNameFlags:          soap.NillableField,
								EnrollmentFlags:           soap.NillableField,
								GeneralFlags:              soap.NillableField,
								HashAlgorithmOIDReference: 0,
								RARequirements:            soap.NillableField,
								KeyArchivalAttributes:     soap.NillableField,
								Extensions:                soap.NillableField,
							},
						},
					},
				},
			},
			OIDs: []soap.XCEPoID{
				{
					OIDReferenceID: 0,
					DefaultName:    "szOID_OIWSEC_SHA256",
					Group:          2, // 2 = Encryption algorithm identifier
					Value:          "2.16.840.1.101.3.4.2.1",
				},
			},
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
