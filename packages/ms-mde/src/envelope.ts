import * as v from "valibot";

// Construct a SOAP envelope schema, used for validating SOAP requests
export const envelope = <B extends v.ObjectEntries>(
	action: string,
	body: B,
	opts?: {
		schemas?: Record<string, string>;
	},
) =>
	v.object({
		"s:Envelope": v.object({
			"@_xmlns:s": v.literal("http://www.w3.org/2003/05/soap-envelope"),
			"@_xmlns:a": v.literal("http://www.w3.org/2005/08/addressing"),
			...Object.fromEntries(
				Object.entries(opts?.schemas ?? {}).map(([key, value]) => [
					`@_xmlns:${key}`,
					v.literal(value),
				]),
			),
			"s:Header": v.object({
				"a:Action": v.object({
					"@_s:mustUnderstand": v.literal("1"),
					"#text": v.literal(action),
				}),
				"a:MessageID": v.string(),
				"a:ReplyTo": v.object({
					// TODO: I think this is wrong
					"a:Address": v.literal(
						"http://www.w3.org/2005/08/addressing/anonymous",
					),
				}),
				"a:To": v.object({
					"@_s:mustUnderstand": v.literal("1"),
					"#text": v.string(),
				}),
				"wsse:Security": v.optional(
					v.object({
						"@_s:mustUnderstand": v.literal("1"),
						"wsse:BinarySecurityToken": v.optional(
							v.object({
								"@_ValueType": v.picklist([
									// AzureAD Federated
									"urn:ietf:params:oauth:token-type:jwt",
									// Token required from `Federated` authentication flow
									"http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentUserToken",
								]),
								"@_EncodingType": v.literal(
									"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
								),
								"#text": v.string(),
							}),
						),
						"wsse:UsernameToken": v.optional(
							v.object({
								"wsse:Username": v.string(),
								"wsse:Password": v.string(),
							}),
						),
					}),
				),
			}),
			"s:Body": v.object(body),
		}),
	});

// Construct a SOAP envelope body, used for serializing SOAP responses
export function withEnvelope<T, I>(
	action: string,
	body: (arg: I) => T,
	opts?: {
		schemas?: Record<string, string>;
		"s:Header"?: Record<string, unknown>;
	},
) {
	return (
		arg: I,
		head: {
			relatesTo: string;
			// TODO: How do these actually differ?
			// TODO: Can they be optional?
			correlationId: string;
			activityId: string;
		},
	) => ({
		"s:Envelope": {
			"@_xmlns:s": "http://www.w3.org/2003/05/soap-envelope",
			"@_xmlns:a": "http://www.w3.org/2005/08/addressing",
			...Object.fromEntries(
				Object.entries(opts?.schemas ?? {}).map(([key, value]) => [
					`@_xmlns:${key}`,
					value,
				]),
			),
			"s:Header": {
				"a:Action": {
					"@_s:mustUnderstand": "1",
					"#text": action,
				},
				ActivityId: {
					"@_xmlns":
						"http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics",
					"@_CorrelationId": head.correlationId,
					"#text": head.activityId,
				},
				"a:RelatesTo": head.relatesTo,
				...(opts?.["s:Header"] ?? {}),
			},
			"s:Body": body(arg),
		},
	});
}

// A nil value
export const xsiNil = {
	"@_xsi:nil": "true",
};
