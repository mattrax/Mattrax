import { Effect, Schema } from "effect";
import type { Element } from "@xmldom/xmldom";
import { deserializeSoapElementNode } from "./deserializer.js";
import type { SoapParseError } from "./deserializer.js";
import { SoapAddressingNs, SoapEnvelopeNs, WssSecurityExtNs, XsiNs } from "./namespaces.js";
import { escapeXml, escapeAttr } from "./serializer.js";
import {
  markupElementByteLength,
  parseXmlDocument,
  serializeXmlElement,
  utf8ByteLength,
} from "./xml.js";

export interface SoapHeader {
  action?: string;
  messageId?: string;
  replyTo?: string;
  to?: string;
  relatesTo?: string;
  activityId?: string;
  securityXml?: string;
  rawXml?: string;
}

export interface SerializeSoapEnvelopeOptions {
  readonly header?: SoapHeader;
  readonly body: string;
  readonly namespaces?: Record<string, string>;
}

export function serializeSoapEnvelope(options: SerializeSoapEnvelopeOptions): string {
  const ns = { xsi: XsiNs, ...options.namespaces };

  const nsAttrs = Object.entries(ns)
    .map(([prefix, uri]) => ` xmlns:${prefix}="${escapeAttr(uri)}"`)
    .join("");

  let headerXml = "";

  if (options.header) {
    const h = options.header;
    const parts: Array<string> = [];

    if (h.action) {
      parts.push(`<a:Action s:mustUnderstand="1">${escapeXml(h.action)}</a:Action>`);
    }

    if (h.messageId) {
      parts.push(`<a:MessageID>${escapeXml(h.messageId)}</a:MessageID>`);
    }

    if (h.replyTo) {
      parts.push(`<a:ReplyTo><a:Address>${escapeXml(h.replyTo)}</a:Address></a:ReplyTo>`);
    }

    if (h.to) {
      parts.push(`<a:To s:mustUnderstand="1">${escapeXml(h.to)}</a:To>`);
    }

    if (h.relatesTo) {
      parts.push(`<a:RelatesTo>${escapeXml(h.relatesTo)}</a:RelatesTo>`);
    }

    if (h.activityId) {
      parts.push(
        `<ActivityId CorrelationId="${escapeAttr(h.activityId)}">${escapeXml(h.activityId)}</ActivityId>`,
      );
    }

    if (h.securityXml) {
      parts.push(h.securityXml);
    }

    if (h.rawXml) {
      parts.push(h.rawXml);
    }

    if (parts.length > 0) {
      headerXml = `  <s:Header>\n${parts.map((p) => "    " + p).join("\n")}\n  </s:Header>\n`;
    }
  }

  const bodyLines = options.body
    .split("\n")
    .map((line) => (line ? "    " + line : ""))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="${SoapEnvelopeNs}" xmlns:a="${SoapAddressingNs}"${nsAttrs}>
${headerXml}  <s:Body>
${bodyLines}
  </s:Body>
</s:Envelope>`;
}

export type SoapEnvelopeErrorReason =
  | "invalid_xml"
  | "invalid_envelope"
  | "request_too_large"
  | "header_too_large"
  | "body_empty"
  | "body_too_large";

export class SoapEnvelopeError extends Schema.TaggedError<SoapEnvelopeError>()(
  "SoapEnvelopeError",
  {
    reason: Schema.Literals([
      "invalid_xml",
      "invalid_envelope",
      "request_too_large",
      "header_too_large",
      "body_empty",
      "body_too_large",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface ParseSoapEnvelopeOptions {
  /** Maximum UTF-8 size of the complete HTTP request body. */
  readonly maxRequestBytes?: number;
  /** Maximum UTF-8 size of the SOAP Header element. */
  readonly maxHeaderBytes?: number;
  /** Maximum UTF-8 size of the single SOAP Body payload element. */
  readonly maxBodyBytes?: number;
}

export const DEFAULT_SOAP_MAX_REQUEST_BYTES = 1024 * 1024;

export const DEFAULT_SOAP_MAX_HEADER_BYTES = 64 * 1024;

export const DEFAULT_SOAP_MAX_BODY_BYTES = 768 * 1024;

export interface ParsedSoapEnvelope {
  readonly header: SoapHeader;
  readonly body: Element;
  readonly security: Element | undefined;
}

export interface DeserializeSoapEnvelopeResult<T> {
  readonly header: SoapHeader;
  readonly body: T;
}

function soapChildren(element: Element, localName: string): ReadonlyArray<Element> {
  const result: Array<Element> = [];

  for (const child of element.children) {
    if (child.namespaceURI === SoapEnvelopeNs && child.localName === localName) result.push(child);
  }

  return result;
}

function singleSoapChild(
  element: Element,
  localName: string,
  required: boolean,
): Element | undefined {
  const matches = soapChildren(element, localName);

  if (matches.length > 1) {
    throw new Error(`SOAP envelope contains multiple ${localName} elements`);
  }

  const child = matches[0];

  if (!child && required) throw new Error(`SOAP ${localName} not found in envelope`);

  return child;
}

function childByLocalName(element: Element, localName: string): Element | undefined {
  for (const child of element.children) {
    if (child.localName === localName) return child;
  }

  return undefined;
}

function parseHeader(header: Element | undefined): SoapHeader {
  const result: SoapHeader = {};

  if (!header) return result;

  for (const child of header.children) {
    switch (child.localName) {
      case "Action":
        if (child.namespaceURI === SoapAddressingNs) result.action = child.textContent ?? undefined;
        else result.rawXml = (result.rawXml ?? "") + serializeXmlElement(child);
        break;
      case "MessageID":
        if (child.namespaceURI === SoapAddressingNs)
          result.messageId = child.textContent ?? undefined;
        else result.rawXml = (result.rawXml ?? "") + serializeXmlElement(child);
        break;
      case "ReplyTo": {
        if (child.namespaceURI !== SoapAddressingNs) {
          result.rawXml = (result.rawXml ?? "") + serializeXmlElement(child);
          break;
        }

        const address = childByLocalName(child, "Address");

        if (address?.namespaceURI === SoapAddressingNs)
          result.replyTo = address.textContent ?? undefined;
        break;
      }
      case "To":
        if (child.namespaceURI === SoapAddressingNs) result.to = child.textContent ?? undefined;
        else result.rawXml = (result.rawXml ?? "") + serializeXmlElement(child);
        break;
      case "RelatesTo":
        if (child.namespaceURI === SoapAddressingNs)
          result.relatesTo = child.textContent ?? undefined;
        else result.rawXml = (result.rawXml ?? "") + serializeXmlElement(child);
        break;
      case "ActivityId":
        result.activityId = child.textContent ?? undefined;
        break;
      case "Security":
        result.securityXml = serializeXmlElement(child);
        break;
      default:
        result.rawXml = (result.rawXml ?? "") + serializeXmlElement(child);
    }
  }

  return result;
}

/** Parse and validate a SOAP 1.2 envelope once, before decoding its payload. */
export const parseSoapEnvelope = Effect.fnUntraced(function* (
  xml: string,
  options: ParseSoapEnvelopeOptions = {},
): Effect.fn.Return<ParsedSoapEnvelope, SoapEnvelopeError> {
  const maxRequestBytes = Math.max(1, options.maxRequestBytes ?? DEFAULT_SOAP_MAX_REQUEST_BYTES);
  const maxHeaderBytes = Math.max(1, options.maxHeaderBytes ?? DEFAULT_SOAP_MAX_HEADER_BYTES);
  const maxBodyBytes = Math.max(1, options.maxBodyBytes ?? DEFAULT_SOAP_MAX_BODY_BYTES);

  if (xml.length > maxRequestBytes * 4 || utf8ByteLength(xml) > maxRequestBytes) {
    return yield* new SoapEnvelopeError({
      reason: "request_too_large",
      message: "The SOAP request body is too large",
    });
  }

  const headerBytes = markupElementByteLength(xml, "Header");

  if (headerBytes !== undefined && headerBytes > maxHeaderBytes) {
    return yield* new SoapEnvelopeError({
      reason: "header_too_large",
      message: "The SOAP security header is too large",
    });
  }

  const document = yield* Effect.try({
    try: () => parseXmlDocument(xml),
    catch: (cause) =>
      new SoapEnvelopeError({ reason: "invalid_xml", message: "Invalid SOAP XML", cause }),
  });
  const envelope = document.documentElement;

  if (!envelope || envelope.localName !== "Envelope" || envelope.namespaceURI !== SoapEnvelopeNs) {
    return yield* new SoapEnvelopeError({
      reason: "invalid_envelope",
      message: "Expected a SOAP 1.2 Envelope as the root element",
    });
  }

  const headerElement = yield* Effect.try({
    try: () => singleSoapChild(envelope, "Header", false),
    catch: (cause) =>
      new SoapEnvelopeError({ reason: "invalid_envelope", message: String(cause), cause }),
  });
  const bodyElement = yield* Effect.try({
    try: () => singleSoapChild(envelope, "Body", true),
    catch: (cause) =>
      new SoapEnvelopeError({ reason: "invalid_envelope", message: String(cause), cause }),
  });

  if (!bodyElement) {
    return yield* new SoapEnvelopeError({
      reason: "invalid_envelope",
      message: "SOAP Body not found in envelope",
    });
  }

  if (bodyElement.children.length !== 1) {
    return yield* new SoapEnvelopeError({
      reason: "body_empty",
      message: "SOAP Body must contain exactly one payload element",
    });
  }

  const body = bodyElement.children[0]!;
  const bodyBytes = utf8ByteLength(serializeXmlElement(body));

  if (bodyBytes > maxBodyBytes) {
    return yield* new SoapEnvelopeError({
      reason: "body_too_large",
      message: "The SOAP body payload is too large",
    });
  }

  const normalizedHeaderBytes = headerElement
    ? utf8ByteLength(serializeXmlElement(headerElement))
    : 0;

  if (normalizedHeaderBytes > maxHeaderBytes) {
    return yield* new SoapEnvelopeError({
      reason: "header_too_large",
      message: "The SOAP security header is too large",
    });
  }

  let security: Element | undefined;

  for (const child of headerElement?.children ?? []) {
    if (child.namespaceURI === WssSecurityExtNs && child.localName === "Security") {
      if (security) {
        return yield* new SoapEnvelopeError({
          reason: "invalid_envelope",
          message: "SOAP Header contains multiple WS-Security elements",
        });
      }

      security = child;
    }
  }

  return { header: parseHeader(headerElement), body, security };
});

export function deserializeSoapEnvelope<T, RD>(
  xml: string,
  schema: Schema.Decoder<T, RD>,
  options?: ParseSoapEnvelopeOptions,
): Effect.Effect<
  DeserializeSoapEnvelopeResult<T>,
  SoapEnvelopeError | SoapParseError | Schema.SchemaError,
  RD
> {
  return Effect.gen(function* () {
    const parsed = yield* parseSoapEnvelope(xml, options);
    const body = yield* deserializeSoapElementNode(parsed.body, schema);

    return { header: parsed.header, body };
  });
}

/** @deprecated Use {@link parseSoapEnvelope} for typed failures. */
export function extractSoapBody(xml: string): string {
  return serializeXmlElement(Effect.runSync(parseSoapEnvelope(xml)).body);
}

/** @deprecated Use {@link parseSoapEnvelope} for typed failures. */
export function extractSoapHeader(xml: string): SoapHeader {
  return Effect.runSync(parseSoapEnvelope(xml)).header;
}
