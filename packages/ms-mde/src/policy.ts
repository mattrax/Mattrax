import * as v from "valibot";
import { envelope, withEnvelope, xsiNil } from "./envelope";

// Contains device cryptographic information and user authentication information
export const policyRequest = envelope(
	"http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPolicies",
	{
		"@_xmlns:xsi": v.literal("http://www.w3.org/2001/XMLSchema-instance"),
		"@_xmlns:xsd": v.literal("http://www.w3.org/2001/XMLSchema"),
		GetPolicies: v.object({
			"@_xmlns": v.literal(
				"http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy",
			),
			client: v.object({
				lastUpdate: v.object({
					"@_xsi:nil": v.literal("true"),
				}),
				preferredLanguage: v.object({
					"@_xsi:nil": v.literal("true"),
				}),
				TPMManufacturer: v.string(),
				TPMFirmwareVersion: v.string(),
			}),
			requestFilter: v.object({
				"@_xsi:nil": v.literal("true"),
			}),
		}),
	},
	{
		schemas: {
			u: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
			wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
			wst: "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
			ac: "http://schemas.xmlsoap.org/ws/2006/12/authorization",
		},
	},
);

type PolicyResponseArgs = {
	policyId: string;
	policyFriendlyName: string;
};

// The policy defining how the device identity certificate will be generated
export const policyResponse = withEnvelope(
	"http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPoliciesResponse",
	(opts: PolicyResponseArgs) => ({
		"@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
		GetPoliciesResponse: {
			"@_xmlns":
				"http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy",
			response: {
				policyID: opts.policyId,
				policyFriendlyName: opts.policyFriendlyName,
				nextUpdateHours: xsiNil,
				policiesNotChanged: xsiNil,
				policies: {
					policy: {
						policyOIDReference: 0, // References to OID defined in OIDs section
						cAs: xsiNil,
						attributes: {
							policySchema: 3,
							privateKeyAttributes: {
								minimalKeyLength: 4096,
								keySpec: xsiNil,
								keyUsageProperty: xsiNil,
								permissions: xsiNil,
								algorithmOIDReference: xsiNil,
								cryptoProviders: xsiNil,
							},
							supersededPolicies: xsiNil,
							privateKeyFlags: xsiNil,
							subjectNameFlags: xsiNil,
							enrollmentFlags: xsiNil,
							generalFlags: xsiNil,
							hashAlgorithmOIDReference: 0,
							rARequirements: xsiNil,
							keyArchivalAttributes: xsiNil,
							extensions: xsiNil,
						},
					},
				},
			},
			cAs: "",
			oIDs: {
				policyOIDReference: 0,
				defaultName: "szOID_OIWSEC_SHA256",
				group: 2, // 2 = Encryption algorithm identifier
				value: "2.16.840.1.101.3.4.2.1",
			},
		},
	}),
);
