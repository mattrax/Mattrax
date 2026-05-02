import { pemDecode } from "@mattrax/scep";

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
    node: {
      tag,
      bytes: der.slice(offset, endOffset),
      content,
      children,
    },
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

export function extractTopicFromCertPem(pem: string): string | null {
  try {
    const certDer = new Uint8Array(pemDecode("CERTIFICATE", pem));
    return extractTopicFromCertDer(certDer);
  } catch {
    return null;
  }
}

function extractTopicFromCertDer(certDer: Uint8Array): string | null {
  const root = parseNode(certDer, 0).node;
  if (root.tag !== 0x30 || root.children.length < 2) return null;

  const tbsCert = root.children[0];
  if (tbsCert.tag !== 0x30) return null;

  // Navigate to subject in TBSCertificate:
  // version[0]?, serialNumber, signature, issuer, validity → subject
  let idx = 0;
  if (idx < tbsCert.children.length && tbsCert.children[idx].tag === 0xa0) idx++; // version [0]
  if (idx < tbsCert.children.length) idx++; // serialNumber
  if (idx < tbsCert.children.length) idx++; // signature AlgorithmIdentifier
  if (idx < tbsCert.children.length) idx++; // issuer
  if (idx < tbsCert.children.length) idx++; // validity
  if (idx >= tbsCert.children.length) return null;

  const subject = tbsCert.children[idx];
  if (subject.tag !== 0x30) return null;

  for (const rdn of subject.children) {
    if (rdn.tag !== 0x31) continue; // SET
    for (const atv of rdn.children) {
      if (atv.tag !== 0x30 || atv.children.length < 2) continue; // SEQUENCE
      const oidNode = atv.children[0];
      const valueNode = atv.children[1];
      if (oidNode.tag !== 0x06) continue;

      const oid = decodeOid(oidNode.content);
      // UID (0.9.2342.19200300.100.1.1) is the standard APNS topic field
      // Fall back to CN (2.5.4.3) if UID is absent
      if (oid === "0.9.2342.19200300.100.1.1" || oid === "2.5.4.3") {
        const value = decodeStringValue(valueNode);
        if (value) return value;
      }
    }
  }

  return null;
}
