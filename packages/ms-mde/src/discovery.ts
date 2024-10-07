import * as v from "valibot";
import { envelope, withEnvelope } from "./envelope";

// DiscoverRequest contains the device and user information to help inform the response
export const discoveryRequest = envelope(
	"http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover",
	{
		Discover: v.object({
			"@_xmlns": v.literal(
				"http://schemas.microsoft.com/windows/management/2012/01/enrollment",
			),
			request: v.object({
				"@_xmlns:i": v.literal("http://www.w3.org/2001/XMLSchema-instance"),
				EmailAddress: v.pipe(v.string(), v.email()),
				OSEdition: v.number(),
				RequestVersion: v.number(),
				DeviceType: v.string(),
				ApplicationVersion: v.string(),
				AuthPolicies: v.object({
					AuthPolicy: v.pipe(
						v.any(),
						v.transform((input) => (Array.isArray(input) ? input : [input])),
						v.array(v.picklist(["Federated", "OnPremise", "Certificate"])),
					),
				}),
			}),
		}),
	},
);

type DiscoveryResponseArgs = {
	enrollmentVersion: string;
	enrollmentPolicyServiceUrl: string;
	enrollmentServiceUrl: string;
} & (
	| {
			authPolicy: "Federated";
			authenticationServiceUrl: string;
	  }
	| {
			authPolicy: "OnPremise" | "Certificate";
	  }
);

// Contains the enrollment endpoints and authentication type for the device to continue enrollment with
export const discoverResponse = withEnvelope(
	"http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse",
	(opts: DiscoveryResponseArgs) => ({
		DiscoverResponse: {
			"@_xmlns":
				"http://schemas.microsoft.com/windows/management/2012/01/enrollment",
			DiscoverResult: {
				AuthPolicy: opts.authPolicy,
				EnrollmentVersion: opts.enrollmentVersion,
				EnrollmentPolicyServiceUrl: opts.enrollmentPolicyServiceUrl,
				EnrollmentServiceUrl: opts.enrollmentServiceUrl,
				AuthenticationServiceUrl:
					"authenticationServiceUrl" in opts
						? opts.authenticationServiceUrl
						: undefined,
			},
		},
	}),
);
