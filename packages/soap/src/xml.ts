import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document, Element } from "@xmldom/xmldom";

const textEncoder = new TextEncoder();

/** Parse XML without letting xmldom turn malformed input into a partial document. */
export function parseXmlDocument(xml: string): Document {
  if (/<!DOCTYPE\b/i.test(xml))
    throw new Error("XML document types are not allowed in SOAP messages");

  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === "error" || level === "fatalError") throw new Error(message);
    },
  });
  const document = parser.parseFromString(xml, "application/xml");

  if (document.doctype) throw new Error("XML document types are not allowed in SOAP messages");

  return document;
}

export function serializeXmlElement(element: Element): string {
  return new XMLSerializer().serializeToString(element);
}

export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

interface MarkupTag {
  readonly end: number;
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

function localName(name: string): string {
  const separator = name.indexOf(":");

  return separator === -1 ? name : name.slice(separator + 1);
}

function readMarkupTag(xml: string, start: number): MarkupTag | undefined {
  let index = start + 1;
  const closing = xml[index] === "/";

  if (closing) index++;

  const nameStart = index;

  while (index < xml.length && !/[\s/>]/.test(xml[index]!)) index++;

  if (index === nameStart) return undefined;

  const name = xml.slice(nameStart, index);
  let quote: string | undefined;

  for (; index < xml.length; index++) {
    const character = xml[index]!;

    if (quote !== undefined) {
      if (character === quote) quote = undefined;

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === ">") {
      return {
        end: index,
        name,
        closing,
        selfClosing: !closing && xml[index - 1] === "/",
      };
    }
  }

  return undefined;
}

function skipMarkupDeclaration(xml: string, start: number): number | undefined {
  if (xml.startsWith("<!--", start)) {
    const end = xml.indexOf("-->", start + 4);

    return end === -1 ? undefined : end + 3;
  }

  if (xml.startsWith("<![CDATA[", start)) {
    const end = xml.indexOf("]]>", start + 9);

    return end === -1 ? undefined : end + 3;
  }

  if (xml.startsWith("<?", start)) {
    const end = xml.indexOf("?>", start + 2);

    return end === -1 ? undefined : end + 2;
  }

  if (xml.startsWith("<!DOCTYPE", start)) {
    let quote: string | undefined;
    let subsetDepth = 0;

    for (let index = start + 9; index < xml.length; index++) {
      const character = xml[index]!;

      if (quote !== undefined) {
        if (character === quote) quote = undefined;

        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }

      if (character === "[") subsetDepth++;
      if (character === "]") subsetDepth--;
      if (character === ">" && subsetDepth === 0) return index + 1;
    }

    return undefined;
  }

  return undefined;
}

/**
 * Find an element's serialized UTF-8 size without constructing a DOM. This is a
 * deliberately conservative preflight: any namespace using the requested local
 * name counts, while comments, CDATA, processing instructions and quoted `>`
 * characters are skipped. The XML parser remains responsible for correctness.
 */
export function markupElementByteLength(xml: string, elementLocalName: string): number | undefined {
  const stack: Array<string> = [];
  let start = -1;
  let parentDepth = 0;
  let index = xml.indexOf("<");

  while (index !== -1) {
    const declarationEnd = skipMarkupDeclaration(xml, index);

    if (declarationEnd !== undefined) {
      index = xml.indexOf("<", declarationEnd);
      continue;
    }

    const tag = readMarkupTag(xml, index);

    if (tag === undefined) {
      index = xml.indexOf("<", index + 1);
      continue;
    }

    if (start === -1) {
      if (
        !tag.closing &&
        localName(tag.name) === elementLocalName &&
        stack.length === 1 &&
        localName(stack[0]!) === "Envelope"
      ) {
        parentDepth = stack.length;
        start = index;

        if (tag.selfClosing) return utf8ByteLength(xml.slice(start, tag.end + 1));
        stack.push(tag.name);
      } else if (!tag.closing && !tag.selfClosing) {
        stack.push(tag.name);
      }
    } else if (tag.closing) {
      stack.pop();

      if (stack.length === parentDepth) return utf8ByteLength(xml.slice(start, tag.end + 1));
    } else if (!tag.selfClosing) {
      stack.push(tag.name);
    }

    index = xml.indexOf("<", tag.end + 1);
  }

  return undefined;
}
