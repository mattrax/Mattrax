import * as v from "valibot";
import { envelope, withEnvelope } from "./envelope";
import { serializeXml } from "./util";
import type { WapProvisioningProfile } from "./wap";

// All of the known context items with a fallback to any generic ones.
// *Be aware* this can't be treated as an exhaustive list as the MDM client may send additional context items or omit ones listed here.
// TODO: Are we gonna need this? Should it be a schema for validation?
export type ContextItem =
	| {
			"ac:Value": boolean;
			"@_Name": "UXInitiated" | "TargetedUserLoggedIn" | "NotInOobe";
	  }
	| {
			"ac:Value": string;
			"@_Name":
				| "HWDevID"
				| "Locale"
				| "DeviceName"
				| "MAC"
				| "DeviceID"
				| "EnrollmentType"
				| "DeviceType"
				| "OSVersion"
				| "ApplicationVersion"
				| "Manufacturer"
				| "DeviceModel"
				| "SerialNumber";
	  }
	| {
			"ac:Value": number;
			"@_Name": "OSEdition" | "RequestVersion";
	  }
	| {
			"ac:Value": string;
			"@_Name": string;
	  };

//  contains the device information and identity certificate CSR
export const enrollmentRequest = envelope(
	"http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RST/wstep",
	{
		"wst:RequestSecurityToken": v.object({
			"wst:TokenType": v.literal(
				"http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
			),
			"wst:RequestType": v.literal(
				"http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue",
			),
			"wsse:BinarySecurityToken": v.object({
				"#text": v.string(),
				"@_ValueType": v.literal(
					"http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10",
				),
				"@_EncodingType": v.literal(
					"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
				),
			}),
			"ac:AdditionalContext": v.object({
				"@_xmlns": v.literal(
					"http://schemas.xmlsoap.org/ws/2006/12/authorization",
				),
				"ac:ContextItem": v.array(
					v.object({
						"ac:Value": v.union([v.string(), v.number(), v.boolean()]),
						"@_Name": v.string(),
					}),
				),
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

// contains the management client configuration and signed identity certificate
export const enrollmentResponse = withEnvelope(
	"http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep",
	(opts: {
		wapProvisioningProfile: object;
	}) => ({
		RequestSecurityTokenResponseCollection: {
			"@_xmlns": "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
			RequestSecurityTokenResponse: {
				TokenType:
					"http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
				DispositionMessage: {
					"@_xmlns":
						"http://schemas.microsoft.com/windows/pki/2009/01/enrollment",
				},
				RequestedSecurityToken: {
					BinarySecurityToken: {
						"@_xmlns":
							"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
						"@_ValueType":
							"http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc",
						"@_EncodingType":
							"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
						"#text": btoa(
							serializeXml(opts.wapProvisioningProfile)
								.replaceAll("\n", "")
								.replaceAll("\t", ""),
						),
					},
				},
				RequestID: {
					"@_xmlns":
						"http://schemas.microsoft.com/windows/pki/2009/01/enrollment",
					"#text": "0",
				},
			},
		},
	}),
	{
		schemas: {
			u: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
		},
		"s:Header": {
			"o:Security": {
				"@_xmlns:o":
					"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
				"@_s:mustUnderstand": "1",
				"u:Timestamp": {
					"@_u:Id": "_0",
					"u:Created": "2018-11-30T00:32:59.420Z", // TODO
					"u:Expires": "2018-12-30T00:37:59.420Z", // TODO
				},
			},
		},
	},
);
