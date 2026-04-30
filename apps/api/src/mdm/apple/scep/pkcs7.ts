import { Effect } from "effect";
import { ScepError } from "../schema";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./crypto";

// ─── ASN.1 Writer ────────────────────────────────────────────────

class ASN1Writer {
  private tag(tag: number, content: Uint8Array): Uint8Array {
    const len = this.lengthBytes(content.length);
    const result = new Uint8Array(1 + len.length + content.length);
    result[0] = tag;
    result.set(len, 1);
    result.set(content, 1 + len.length);
    return result;
  }

  private lengthBytes(length: number): Uint8Array {
    if (length < 128) return new Uint8Array([length]);
    const hex = length.toString(16);
    const byteLen = Math.ceil(hex.length / 2);
    const header = 0x80 | byteLen;
    const arr = new Uint8Array(byteLen + 1);
    arr[0] = header;
    for (let i = 0; i < byteLen; i++) {
      arr[byteLen - i] = (length >> (i * 8)) & 0xff;
    }
    return arr;
  }

  sequence(children: Uint8Array[]): Uint8Array {
    const total = children.reduce((sum, c) => sum + c.length, 0);
    const content = new Uint8Array(total);
    let offset = 0;
    for (const child of children) {
      content.set(child, offset);
      offset += child.length;
    }
    return this.tag(0x30, content);
  }

  set(children: Uint8Array[]): Uint8Array {
    const total = children.reduce((sum, c) => sum + c.length, 0);
    const content = new Uint8Array(total);
    let offset = 0;
    for (const child of children) {
      content.set(child, offset);
      offset += child.length;
    }
    return this.tag(0x31, content);
  }

  integer(value: number | Uint8Array): Uint8Array {
    if (typeof value === "number") {
      const hex = value.toString(16);
      const padded = hex.length % 2 === 1 ? "0" + hex : hex;
      const bytes = new Uint8Array(padded.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
      }
      if (bytes.length > 0 && bytes[0] & 0x80) {
        const withZero = new Uint8Array(bytes.length + 1);
        withZero[0] = 0;
        withZero.set(bytes, 1);
        return this.tag(0x02, withZero);
      }
      return this.tag(0x02, bytes);
    }
    return this.tag(0x02, value);
  }

  bitString(data: Uint8Array): Uint8Array {
    const content = new Uint8Array(data.length + 1);
    content[0] = 0;
    content.set(data, 1);
    return this.tag(0x03, content);
  }

  octetString(data: Uint8Array): Uint8Array {
    return this.tag(0x04, data);
  }

  null(): Uint8Array {
    return this.tag(0x05, new Uint8Array(0));
  }

  oid(oidStr: string): Uint8Array {
    const parts = oidStr.split(".").map(Number);
    const bytes = [parts[0]! * 40 + parts[1]!];
    for (let i = 2; i < parts.length; i++) {
      let v = parts[i]!;
      const octets = [];
      do {
        octets.unshift((v & 0x7f) | 0x80);
        v = v >> 7;
      } while (v > 0);
      octets[octets.length - 1] &= 0x7f;
      bytes.push(...octets);
    }
    return this.tag(0x06, new Uint8Array(bytes));
  }

  printableString(str: string): Uint8Array {
    const encoder = new TextEncoder();
    return this.tag(0x13, encoder.encode(str));
  }

  utf8String(str: string): Uint8Array {
    const encoder = new TextEncoder();
    return this.tag(0x0c, encoder.encode(str));
  }

  utcTime(date: Date): Uint8Array {
    const str = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const encoder = new TextEncoder();
    return this.tag(0x17, encoder.encode(str));
  }

  bool(value: boolean): Uint8Array {
    return this.tag(0x01, new Uint8Array([value ? 0xff : 0x00]));
  }

  context(tag: number, content: Uint8Array): Uint8Array {
    return this.tag(0xa0 | tag, content);
  }
}

const w = new ASN1Writer();

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.1";
const SHA256_WITH_RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.11";

export const sha256AlgorithmIdentifier = w.sequence([
  w.oid(SHA256_OID),
  w.null(),
]);

export const rsaAlgorithmIdentifier = w.sequence([
  w.oid(RSA_ENCRYPTION_OID),
  w.null(),
]);

export const sha256WithRsaAlgorithmIdentifier = w.sequence([
  w.oid(SHA256_WITH_RSA_ENCRYPTION_OID),
  w.null(),
]);

export function buildName(commonName: string): Uint8Array {
  return w.sequence([
    w.set([
      w.sequence([
        w.oid("2.5.4.3"),
        w.utf8String(commonName),
      ]),
    ]),
  ]);
}

export function buildValidity(notBefore: Date, notAfter: Date): Uint8Array {
  return w.sequence([
    w.utcTime(notBefore),
    w.utcTime(notAfter),
  ]);
}

export function buildSubjectPublicKeyInfo(spki: ArrayBuffer): Uint8Array {
  return w.sequence([
    rsaAlgorithmIdentifier,
    w.bitString(new Uint8Array(spki)),
  ]);
}

export function buildTBSCertificate(
  serialNumber: number,
  issuerName: string,
  validity: { notBefore: Date; notAfter: Date },
  subjectName: string,
  subjectPublicKeyInfo: ArrayBuffer,
  isCa: boolean,
): Uint8Array {
  const extensions: Uint8Array[] = [];
  if (isCa) {
    const basicConstraints = w.sequence([
      w.bool(true),
      w.integer(2),
    ]);
    const extValue = w.octetString(basicConstraints);
    extensions.push(
      w.sequence([
        w.oid("2.5.29.19"),
        w.bool(true),
        extValue,
      ]),
    );
    const keyUsage = new Uint8Array([0x03, 0x02, 0x01, 0x86]);
    extensions.push(
      w.sequence([
        w.oid("2.5.29.15"),
        w.bool(true),
        w.octetString(keyUsage),
      ]),
    );
  }

  const extSeq = extensions.length > 0
    ? [w.context(3, w.sequence(extensions))]
    : [];

  return w.sequence([
    w.integer(2),
    w.integer(serialNumber),
    sha256WithRsaAlgorithmIdentifier,
    buildName(issuerName),
    buildValidity(validity.notBefore, validity.notAfter),
    buildName(subjectName),
    buildSubjectPublicKeyInfo(subjectPublicKeyInfo),
    ...extSeq,
  ]);
}

export function buildCertificate(
  tbsCert: Uint8Array,
  signature: ArrayBuffer,
): Uint8Array {
  return w.sequence([
    tbsCert,
    sha256WithRsaAlgorithmIdentifier,
    w.bitString(new Uint8Array(signature)),
  ]);
}

// Correct PKCS#7 degenerate SignedData (certs-only)
// ContentInfo { contentType=signedData, content[0]=SignedData }
// SignedData { version=1, digestAlgorithms={}, encapContentInfo={oid=data}, certificates[0]={cert}, signerInfos={} }
export function buildPkcs7Degenerate(certDer: Uint8Array): Uint8Array {
  const encapContentInfo = w.sequence([
    w.oid("1.2.840.113549.1.7.1"), // data
  ]);

  const signedData = w.sequence([
    w.integer(1), // version
    w.set([]), // digestAlgorithms (empty)
    encapContentInfo,
    w.context(0, w.set([certDer])), // certificates [0]
    w.set([]), // signerInfos (empty)
  ]);

  const contentInfo = w.sequence([
    w.oid("1.2.840.113549.1.7.2"), // signedData
    w.context(0, signedData),
  ]);

  return contentInfo;
}

// ─── ASN.1 Parser ────────────────────────────────────────────────

interface Asn1Node {
  tag: number;
  bytes: Uint8Array;
  content: Uint8Array;
  children: Asn1Node[];
}

function readAsn1Length(der: Uint8Array, offset: number): [number, number] {
  let length = der[offset]!;
  let headerLen = 1;
  if (length & 0x80) {
    const numBytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | der[offset + 1 + i]!;
    }
    headerLen = 1 + numBytes;
  }
  return [length, headerLen];
}

function parseNode(der: Uint8Array, offset: number): { node: Asn1Node; nextOffset: number } {
  const tag = der[offset]!;
  const [length, headerLen] = readAsn1Length(der, offset + 1);
  const contentStart = offset + 1 + headerLen;
  const endOffset = contentStart + length;
  const content = der.slice(contentStart, endOffset);

  const children: Asn1Node[] = [];
  if ((tag & 0x20) !== 0) {
    let childOffset = contentStart;
    while (childOffset < endOffset) {
      const child = parseNode(der, childOffset);
      children.push(child.node);
      childOffset = child.nextOffset;
    }
  }

  return {
    node: { tag, bytes: der.slice(offset, endOffset), content, children },
    nextOffset: endOffset,
  };
}

function decodeOid(content: Uint8Array): string {
  if (content.length === 0) return "";
  const first = content[0]!;
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let i = 1; i < content.length; i++) {
    value = (value << 7) | (content[i]! & 0x7f);
    if ((content[i]! & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

// Parse a PKCS#7 SignedData and extract the eContent (the inner CSR bytes)
export function parsePkcs7Content(der: Uint8Array): Effect.Effect<Uint8Array, ScepError> {
  return Effect.try({
    try: () => {
      // Parse ContentInfo
      const root = parseNode(der, 0).node;
      if (root.tag !== 0x30 || root.children.length < 2) {
        throw new Error("Invalid ContentInfo");
      }

      const contentTypeNode = root.children[0];
      if (contentTypeNode.tag !== 0x06) throw new Error("Missing contentType OID");
      const contentType = decodeOid(contentTypeNode.content);
      if (contentType !== "1.2.840.113549.1.7.2") {
        throw new Error(`Unexpected contentType: ${contentType}`);
      }

      // content [0] EXPLICIT SignedData
      const contentNode = root.children[1];
      if (contentNode.tag !== 0xa0 || contentNode.children.length < 1) {
        throw new Error("Missing SignedData content");
      }

      const signedData = contentNode.children[0];
      if (signedData.tag !== 0x30) throw new Error("Invalid SignedData");

      // SignedData fields: version, digestAlgorithms, encapContentInfo, [certificates], [crls], signerInfos
      if (signedData.children.length < 3) throw new Error("SignedData too short");

      const encapContentInfo = signedData.children[2];
      if (encapContentInfo.tag !== 0x30) throw new Error("Invalid encapContentInfo");

      // encapContentInfo: eContentType, eContent [0]?
      for (const child of encapContentInfo.children) {
        if (child.tag === 0xa0) {
          // eContent [0] EXPLICIT OCTET STRING
          if (child.children.length < 1) throw new Error("Empty eContent");
          const octet = child.children[0];
          if (octet.tag === 0x04) {
            return octet.content; // The CSR bytes
          }
          // Some implementations don't wrap in OCTET STRING
          return child.content;
        }
      }

      throw new Error("No eContent found in PKCS#7");
    },
    catch: (cause) => new ScepError({ message: "Failed to parse PKCS#7 content", cause }),
  });
}

// ─── CSR Parser ──────────────────────────────────────────────────

export function parseCsr(der: Uint8Array): Effect.Effect<{ subject: string; spki: ArrayBuffer }, ScepError> {
  return Effect.try({
    try: () => {
      const root = parseNode(der, 0).node;
      if (root.tag !== 0x30 || root.children.length < 3) {
        throw new Error("Invalid CSR");
      }

      // CertificationRequestInfo is the first child of PKCS#10
      const certReqInfo = root.children[0];
      if (certReqInfo.tag !== 0x30) throw new Error("Invalid CertificationRequestInfo");

      // Fields: version, subject, subjectPKInfo, attributes
      if (certReqInfo.children.length < 3) throw new Error("CertificationRequestInfo too short");

      const subjectNode = certReqInfo.children[1];
      const spkiNode = certReqInfo.children[2];

      // Extract CN from subject
      let subject = "device";
      if (subjectNode.tag === 0x30) {
        for (const rdn of subjectNode.children) {
          if (rdn.tag !== 0x31) continue;
          for (const atv of rdn.children) {
            if (atv.tag !== 0x30 || atv.children.length < 2) continue;
            const oidNode = atv.children[0];
            const valNode = atv.children[1];
            if (oidNode.tag !== 0x06) continue;
            const oid = decodeOid(oidNode.content);
            if (oid === "2.5.4.3") {
              const val = decodeStringValue(valNode);
              if (val) subject = val;
            }
          }
        }
      }

      // Extract SPKI
      const spki = spkiNode.bytes.buffer as ArrayBuffer;

      return { subject, spki };
    },
    catch: (cause) => new ScepError({ message: "Failed to parse CSR", cause }),
  });
}

function decodeStringValue(node: Asn1Node): string {
  switch (node.tag) {
    case 0x0c: // UTF8String
    case 0x13: // PrintableString
    case 0x16: // IA5String
    case 0x14: // T61String
      return new TextDecoder().decode(node.content);
    default:
      return "";
  }
}

export { arrayBufferToBase64, base64ToArrayBuffer };
