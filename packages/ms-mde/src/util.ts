import { XMLBuilder, XMLParser } from "fast-xml-parser";
import * as v from "valibot";

const parser = new XMLParser({
	ignoreAttributes: false,
	allowBooleanAttributes: true,
});

const builder = new XMLBuilder({
	ignoreAttributes: false,
	suppressBooleanAttributes: false,
});

// Deserialize and validation an XML string to a JavaScript object.
export function deserializeXml<
	S extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: S, xml: string) {
	console.log("INCOMING", JSON.stringify(parser.parse(xml), null, 2)); // TODO
	return v.safeParse(schema, parser.parse(xml));
}

// Serialize an XML structure to a string.
export function serializeXml<S extends object>(xml: S) {
	const output = builder.build(xml);
	console.log("OUTGOING", output); // TODO
	return output;
}

// Convert a SOAP XML structure to a `Response` object.
export function soapResponse<S extends object>(xml: S) {
	const output = serializeXml(xml);
	return new Response(output, {
		headers: {
			"Content-Type": "application/soap+xml; charset=utf-8",
			// This header is important. The Windows MDM client doesn't like chunked encodings.
			"Content-Length": output.length.toString(),
		},
	});
}
