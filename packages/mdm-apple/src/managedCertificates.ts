import { Schema } from "effect";
import type { PlistValue } from "@mattrax/plist";
import { isPlistArray, isPlistObject, plistText, statusItemValue } from "@mattrax/mdm-core";
import { loadPkijs } from "@mattrax/scep";

/** One managed certificate reported by `security.certificate.list`. */
export type ManagedCertificate = {
  readonly identifier: string;
  readonly subject: string;
  readonly isIdentity: boolean;
  readonly fingerprintSha256: string | null;
  readonly notAfter: string | null;
};

const MAX_MANAGED_CERTIFICATES = 100;

const dataBytes = (value: PlistValue | undefined): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;

  if (value instanceof ArrayBuffer) return new Uint8Array(value);

  if (Schema.is(Schema.String)(value)) {
    try {
      const binary = atob(value.replaceAll(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);

      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

      return bytes.length > 0 ? bytes : null;
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    const bytes = value.filter((entry): entry is number => Schema.is(Schema.Number)(entry));

    return bytes.length === value.length ? Uint8Array.from(bytes) : null;
  }

  return null;
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Turn Apple's certificate status item into displayable metadata.
 *
 * The DER is parsed for the expiry and fingerprint; the subject summary Apple
 * supplies is preferred because it is already localised and formatted. A
 * malformed entry is skipped instead of failing the whole inventory report.
 */
export const parseManagedCertificates = async (
  statusItems: PlistValue | undefined,
): Promise<ManagedCertificate[] | null> => {
  const entries = statusItemValue(statusItems as never, "security.certificate.list");

  if (!isPlistArray(entries)) return null;

  const certificates: ManagedCertificate[] = [];
  let pkijs: Awaited<ReturnType<typeof loadPkijs>> | null = null;

  for (const entry of entries) {
    if (certificates.length >= MAX_MANAGED_CERTIFICATES) break;

    if (!isPlistObject(entry)) continue;

    // A removal carries only identifier + _removed, and the status item is a
    // full list, so there is nothing to record for it.
    if (entry._removed === true) continue;

    const identifier = plistText(entry.identifier);

    if (!identifier) continue;

    const subject = plistText(entry["subject-summary"]) ?? "Certificate";
    const isIdentity = entry["is-identity"] === true;
    const der = dataBytes(entry.data);
    let fingerprintSha256: string | null = null;
    let notAfter: string | null = null;

    if (der) {
      const digest = await crypto.subtle.digest("SHA-256", der as BufferSource);

      fingerprintSha256 = hex(new Uint8Array(digest));

      try {
        pkijs ??= await loadPkijs();
        const certificate = pkijs.Certificate.fromBER(
          der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
        );

        notAfter = certificate.notAfter.value.toISOString();
      } catch {
        // The subject summary is still useful even when a malformed DER cannot
        // be parsed for expiry.
      }
    }

    certificates.push({
      identifier,
      subject,
      isIdentity,
      fingerprintSha256,
      notAfter,
    });
  }

  return certificates;
};
