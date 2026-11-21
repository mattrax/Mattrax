import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { escapeXml, escapeAttr } from "./serializer.js";

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
  const ns = options.namespaces ?? {};

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
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing"${nsAttrs}>
${headerXml}  <s:Body>
${bodyLines}
  </s:Body>
</s:Envelope>`;
}

export interface DeserializeSoapEnvelopeResult<T> {
  readonly header: SoapHeader;
  readonly body: T;
}

function findChildByLocalName(element: Element, localName: string): Element | undefined {
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];

    if (child.localName === localName) {
      return child;
    }
  }

  return undefined;
}

function serializeNode(node: Element): string {
  return new XMLSerializer().serializeToString(node);
}

export function extractSoapBody(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const envelope = doc.documentElement;

  if (!envelope || envelope.localName !== "Envelope") {
    throw new Error("Expected SOAP Envelope as root element");
  }

  const body = findChildByLocalName(envelope, "Body");

  if (!body) {
    throw new Error("SOAP Body not found in envelope");
  }

  const firstChild = body.children[0];

  if (!firstChild) {
    throw new Error("SOAP Body is empty");
  }

  return serializeNode(firstChild);
}

export function extractSoapHeader(xml: string): SoapHeader {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const envelope = doc.documentElement;

  if (!envelope) {
    return {};
  }

  const header = findChildByLocalName(envelope, "Header");
  const result: SoapHeader = {};

  if (!header) return result;

  for (let i = 0; i < header.children.length; i++) {
    const child = header.children[i];

    switch (child.localName) {
      case "Action":
        result.action = child.textContent ?? undefined;
        break;
      case "MessageID":
        result.messageId = child.textContent ?? undefined;
        break;
      case "ReplyTo": {
        let addr: Element | undefined;

        for (let j = 0; j < child.children.length; j++) {
          if (child.children[j].localName === "Address") {
            addr = child.children[j];
            break;
          }
        }

        result.replyTo = addr?.textContent ?? undefined;
        break;
      }

      case "To":
        result.to = child.textContent ?? undefined;
        break;
      case "RelatesTo":
        result.relatesTo = child.textContent ?? undefined;
        break;
      case "ActivityId":
        result.activityId = child.textContent ?? undefined;
        break;
      case "Security":
        result.securityXml = serializeNode(child);
        break;
      default:
        result.rawXml = (result.rawXml ?? "") + serializeNode(child);
    }
  }

  return result;
}
