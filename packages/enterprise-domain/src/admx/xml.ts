import { DOMParser, onErrorStopParsing, type Element } from "@xmldom/xmldom";

/**
 * A deliberately small, read-only XML tree.
 *
 * ADMX ingestion is an unauthenticated-ish path: a tenant administrator can
 * upload any file, so the parser must not resolve external entities, must not
 * process a document type declaration and must not build an unbounded tree.
 * We refuse `<!DOCTYPE` and `<!ENTITY` before handing the text to the DOM
 * parser, and we stop parsing on any well-formedness error.
 */

/** Hard bounds applied to every ADMX/ADML document. */
export const ADMX_LIMITS = {
  /** Characters in one XML document. ADMX files are well under this. */
  maxXmlChars: 2_000_000,
  /** Elements in one document, including ADML presentation tables. */
  maxElements: 50_000,
  /** Nesting depth; ADMX is normally five or six levels deep. */
  maxDepth: 64,
  /** Bytes of one uploaded ADMX or ADML file. */
  maxFileBytes: 1_048_576,
  /** Bytes of every ADMX/ADML file in one bundle. */
  maxBundleBytes: 4_194_304,
  /** Policies read from one ADMX file before refusing it. */
  maxPoliciesPerFile: 1_000,
  /** Policies returned by one import. The review UI stays usable. */
  maxPolicies: 500,
  /** Entries in one zip archive. */
  maxZipEntries: 64,
  /** Uncompressed bytes in one zip entry. */
  maxZipEntryBytes: 1_048_576,
  /** Uncompressed bytes across a zip archive. */
  maxZipBundleBytes: 4_194_304,
} as const;

export type AdmxErrorCode =
  | "file-too-large"
  | "unsupported-file"
  | "xml-too-large"
  | "xml-too-deep"
  | "dtd-not-allowed"
  | "malformed-xml"
  | "wrong-root"
  | "too-many-policies"
  | "zip-invalid"
  | "zip-unsupported"
  | "zip-too-large"
  | "zip-encrypted";

/** Every parse failure surfaced to the UI is one of these. */
export class AdmxImportError extends Error {
  readonly code: AdmxErrorCode;

  constructor(code: AdmxErrorCode, message: string) {
    super(message);
    this.name = "AdmxImportError";
    this.code = code;
  }
}

export type XmlElement = {
  /** Local name, without a namespace prefix. */
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Concatenated descendant text, trimmed at the call site. */
  readonly text: string;
};

const DOCTYPE = /<!DOCTYPE/i;

const ENTITY = /<!ENTITY/i;

const localName = (name: string) => {
  const colon = name.lastIndexOf(":");

  return colon === -1 ? name : name.slice(colon + 1);
};

const attributesOf = (element: Element) => {
  const entries: Array<[string, string]> = [];

  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);

    if (attribute) entries.push([localName(attribute.name), attribute.value]);
  }

  return Object.fromEntries(entries);
};

export type ParseXmlOptions = {
  readonly maxChars?: number;
  readonly maxElements?: number;
  readonly maxDepth?: number;
};

/**
 * Parse an XML document into `XmlElement`.
 *
 * External entities are impossible here for two independent reasons: document
 * type declarations are rejected before parsing, and `onErrorStopParsing`
 * turns any parser warning (including an undefined entity reference) into a
 * thrown error. No network or file access happens at any point.
 */
export const parseXml = (xml: string, options: ParseXmlOptions = {}): XmlElement => {
  const maxChars = options.maxChars ?? ADMX_LIMITS.maxXmlChars;
  const maxElements = options.maxElements ?? ADMX_LIMITS.maxElements;
  const maxDepth = options.maxDepth ?? ADMX_LIMITS.maxDepth;

  if (xml.length > maxChars)
    throw new AdmxImportError(
      "xml-too-large",
      `The XML document is ${xml.length.toLocaleString()} characters; the limit is ${maxChars.toLocaleString()}.`,
    );

  if (DOCTYPE.test(xml) || ENTITY.test(xml))
    throw new AdmxImportError(
      "dtd-not-allowed",
      "Document type declarations and entity definitions are not allowed in ADMX or ADML files.",
    );

  let document;

  try {
    document = new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, "application/xml");
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 200) : "";

    throw new AdmxImportError(
      "malformed-xml",
      `The XML document is not well formed${detail ? `: ${detail}` : "."}`,
    );
  }

  const root = document.documentElement;

  if (!root) throw new AdmxImportError("malformed-xml", "The XML document has no root element.");

  let elementCount = 0;

  const convert = (element: Element, depth: number): XmlElement => {
    elementCount += 1;

    if (elementCount > maxElements)
      throw new AdmxImportError(
        "xml-too-large",
        `The XML document has more than ${maxElements.toLocaleString()} elements.`,
      );

    if (depth > maxDepth)
      throw new AdmxImportError(
        "xml-too-deep",
        `The XML document is nested more than ${maxDepth} levels deep.`,
      );

    const children: XmlElement[] = [];

    for (let index = 0; index < element.childNodes.length; index += 1) {
      const child = element.childNodes.item(index);

      if (child && child.nodeType === 1) {
        // SAFETY: nodeType 1 is ELEMENT_NODE, so this node is an xmldom Element.
        const element = child as Element;

        children.push(convert(element, depth + 1));
      }
    }

    return {
      name: localName(element.nodeName),
      attributes: attributesOf(element),
      children,
      text: (element.textContent ?? "").trim(),
    };
  };

  return convert(root, 0);
};

/** Child elements with a local name, case-insensitive. */
export const childrenNamed = (element: XmlElement | undefined, name: string): XmlElement[] =>
  element?.children.filter((child) => child.name.toLowerCase() === name.toLowerCase()) ?? [];

export const firstChildNamed = (element: XmlElement | undefined, name: string) =>
  childrenNamed(element, name)[0];

/** Descendants with a local name at any depth, bounded by the parse limits. */
export const descendantsNamed = (element: XmlElement | undefined, name: string): XmlElement[] => {
  if (!element) return [];
  const found: XmlElement[] = [];
  const queue = [...element.children];

  while (queue.length > 0) {
    const child = queue.shift()!;

    if (child.name.toLowerCase() === name.toLowerCase()) found.push(child);

    queue.push(...child.children);
  }

  return found;
};

export const attribute = (element: XmlElement | undefined, name: string): string | undefined => {
  const value = element?.attributes[name];

  return value === undefined || value === "" ? undefined : value;
};

export const boolAttribute = (element: XmlElement | undefined, name: string) =>
  attribute(element, name)?.toLowerCase() === "true";
