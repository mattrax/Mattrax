import { Effect } from "effect";
import { ScepError } from "../schema";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./crypto";

// Minimal DER/ASN.1 helpers for SCEP PKCS#7

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

export function buildPkcs7Degenerate(certDer: Uint8Array): Uint8Array {
  const certSet = w.set([certDer]);
  const contentInfo = w.sequence([
    w.oid("1.2.840.113549.1.7.2"),
    w.context(0, w.sequence([
      w.integer(1),
      w.set([sha256WithRsaAlgorithmIdentifier]),
      w.sequence([]),
      w.set([]),
      certSet,
    ])),
  ]);
  return contentInfo;
}

export function parsePkcs7SignedData(der: Uint8Array): Effect.Effect<Uint8Array, ScepError> {
  return Effect.try({
    try: () => {
      let i = 0;
      while (i < der.length - 1) {
        if (der[i] === 0x30) {
          const [seqLen, seqEnd] = readLength(der, i + 1);
          if (seqEnd > der.length) break;
          let j = seqEnd - seqLen;
          while (j < seqEnd - 1) {
            if (der[j] === 0x04) {
              const [octetLen, octetEnd] = readLength(der, j + 1);
              if (octetEnd <= seqEnd) {
                return der.slice(j + 1 + (octetLen < 128 ? 1 : 1 + ((octetLen >> 7) & 0x7f)), octetEnd);
              }
            }
            j++;
          }
        }
        i++;
      }
      return der;
    },
    catch: (cause) => new ScepError({ message: "Failed to parse PKCS#7", cause }),
  });
}

function readLength(der: Uint8Array, offset: number): [number, number] {
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
  return [length, offset + headerLen + length];
}

export function parseCsr(der: Uint8Array): Effect.Effect<{ subject: string; spki: ArrayBuffer }, ScepError> {
  return Effect.try({
    try: () => {
      const text = new TextDecoder("utf-8").decode(der);
      let subject = "device";
      const cnMatch = text.match(/CN=([^,]+)/);
      if (cnMatch) subject = cnMatch[1]!;

      let spki: ArrayBuffer = der.buffer as ArrayBuffer;
      for (let i = 0; i < der.length - 4; i++) {
        if (der[i] === 0x30 && der[i + 1] === 0x82) {
          const [len, end] = readLength(der, i + 1);
          if (len > 200 && end < der.length) {
            spki = der.slice(i, end).buffer as ArrayBuffer;
            break;
          }
        }
      }

      return { subject, spki };
    },
    catch: (cause) => new ScepError({ message: "Failed to parse CSR", cause }),
  });
}

export { arrayBufferToBase64, base64ToArrayBuffer };
