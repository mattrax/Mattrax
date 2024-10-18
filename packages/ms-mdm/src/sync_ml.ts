import * as v from "valibot";

// The SessionID element type specifies the identifier of the SyncML session that is associated with the SyncML message.
// The SessionID can remain valid across the exchange of many SyncML messages between the client and server.
const SessionID = v.pipe(
	v.number(),
	v.minValue(0),
	v.maxValue(65_535 /* u16::MAX */),
);

// The Target element type specifies target routing information.
const Target = v.object({
	LocURI: v.string(),
});

// The Source element type specifies source routing or mapping information.
const Source = v.object({
	LocURI: v.string(),
});

// is the recommended maximum amount of data that is allowed in a single request.
export const MAX_REQUEST_BODY_SIZE = 524288;

// Construct a SyncML schema, used for validating SyncML requests
export const envelope = <B extends v.ObjectEntries>(body: B) =>
	v.object({
		/// The SyncHdr element type serves as the container for the revisioning routing information in the SyncML message.
		SyncML: v.object({
			"@_xmlns": v.picklist(["SYNCML:SYNCML1.1", "SYNCML:SYNCML1.2"]),
			// This isn't strictly in the spec but it's what my Go code does. I suspect I copied it from intercepting Intune.
			"@_xmlns:a": v.literal("syncml:metinf"),
			SyncHdr: v.object({
				// The VerDTD element type specifies the major and minor version identifier of the SyncML representation protocol specification.
				VerDTD: v.literal("1.2"),
				// The VerProto element type specifies the major and minor version identifier of the Device Management representation protocol specification
				VerProto: v.literal("DM/1.2"),
				// The SessionID element type specifies the identifier of the SyncML session that is associated with the SyncML message.
				// SessionID is an opaque string.
				// The initiator SHOULD use a unique SessionID for each session.
				// The maximum length of a SessionID is 4 bytes. Note that for practical implementations for a client, using an 8-bit incrementing SessionID counter is sufficient.
				SessionID,
				// The MsgID element type specifies a unique SyncML session identifier for the SyncML message.
				// The MsgID specified in a SyncML request MUST be the content of the MsgRef (section 2.2.3.7) element type specified in the corresponding SyncML Results (section 2.2.7.8) or response Status (section 2.2.6.1).
				MsgID: v.string(),
				// The Target element type specifies target routing information.
				// Target specifies the target routing information for the network device that is receiving the SyncML message.
				Target,
				// The Source element type specifies source routing or mapping information.
				// Source specifies the source routing information for the network device that originated the SyncML message.
				Source,
				// The Meta element type provides a container for meta-information about the parent element type.
				Meta: v.optional(
					// TODO: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/b6272c46-f152-481f-afa9-e05b96baf661

					// TODO: Parent Elements: Add (section 2.2.7.1), Atomic (section 2.2.7.3), Delete (section 2.2.7.4), Get (section 2.2.7.6), Item (section 2.2.5.2), Replace (section 2.2.7.7), Results (section 2.2.7.8)

					// TODO: Windows MDM extensions. I think `Meta` should probs be a HashMap????
					// - Format
					// - NextNonce
					// - MaxMsgSize
					// - Type

					v.object({
						// TODO: Does this namespace work correctly???
						// #[easy_xml(prefix = "a", rename = "MaxRequestBodySize")]
						// pub max_request_body_size: Option<usize>, // TODO: Should this be a `usize`. It's no in the MS spec but check the OMA spec.

						// For `Exec` commands
						Format: v.optional(
							v.object({
								"@_xmlns": v.string(), // TODO: Should this be a literal?
								"#test": v.string(), // TODO: Will this be the body?
							}),
						),
						Type: v.optional(v.string()),
					}),
				),
			}),
			SyncBody,
		}),
	});

// The SyncBody element type serves as the container for the body or contents of the SyncML message.
const SyncBody = v.intersect([
	v.object({
		// This *SHOULD* be set when 'SyncApplicationVersion' is greater than '3.0' in the DMCLient CSP but we just set it regardless.
		"@_msft": v.literal("http://schemas.microsoft.com/MobileDevice/MDM"),
	}),
	// TODO: need an array
	v.union([
		v.object({
			Atomic: v.object({}),
		}),
		v.object({
			Exec: v.object({}),
		}),
		v.object({
			Get: v.object({}),
		}),
		v.object({
			Results: v.object({}),
		}),
		v.object({
			Status: v.object({}),
		}),
		v.object({
			Add: v.object({}),
		}),
		v.object({
			Replace: v.object({}),
		}),
		v.object({
			Delete: v.object({}),
		}),
		v.object({
			Alert: v.object({}),
		}),
		// TODO: Ordering? - This must be last
		v.object({
			Final: v.object({}),
		}),
	]),
]);

// Construct a SyncML body, used for serializing SyncML responses
// export function withEnvelope<T, I>(
// 	action: string,
// 	body: (arg: I) => T,
// 	opts?: {
// 		schemas?: Record<string, string>;
// 		"s:Header"?: Record<string, unknown>;
// 	},
// ) {
// 	return (
// 		arg: I,
// 		head: {
// 			relatesTo: string;
// 			// TODO: How do these actually differ?
// 			// TODO: Can they be optional?
// 			correlationId: string;
// 			activityId: string;
// 		},
// 	) => ({
// 		"s:Envelope": {
// 			"@_xmlns:s": "http://www.w3.org/2003/05/soap-envelope",
// 			"@_xmlns:a": "http://www.w3.org/2005/08/addressing",
// 			...Object.fromEntries(
// 				Object.entries(opts?.schemas ?? {}).map(([key, value]) => [
// 					`@_xmlns:${key}`,
// 					value,
// 				]),
// 			),
// 			"s:Header": {
// 				"a:Action": {
// 					"@_s:mustUnderstand": "1",
// 					"#text": action,
// 				},
// 				ActivityId: {
// 					"@_xmlns":
// 						"http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics",
// 					"@_CorrelationId": head.correlationId,
// 					"#text": head.activityId,
// 				},
// 				"a:RelatesTo": head.relatesTo,
// 				...(opts?.["s:Header"] ?? {}),
// 			},
// 			"s:Body": body(arg),
// 		},
// 	});
// }
