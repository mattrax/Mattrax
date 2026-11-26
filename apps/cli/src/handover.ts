import { openWithPassphrase } from "@mattrax/crypto";
import type { PassphraseEnvelope } from "@mattrax/crypto";
import { CUTOVER_FORMAT, decodeCutoverArchive } from "@mattrax/enterprise-domain";
import type { CutoverEnvelope, CutoverPayload } from "@mattrax/enterprise-domain";

/**
 * A decrypted file. The CLI accepts both encrypted formats Mattrax writes:
 *
 * - `mattrax.cutover`: a schema-validated tenant snapshot with a manifest and
 *   two digests (see `packages/enterprise-domain/src/Cutover.ts`).
 * - a device handover envelope: a smaller, self-describing PBKDF2/AES-GCM
 *   object whose payload is the device-disposal document.
 *
 * They stay separate on purpose: the cutover payload is a typed tenant export
 * that the import path must validate, while handover is a one-file disposal
 * record that has no import path. Both use PBKDF2-HMAC-SHA256 with 600,000
 * iterations and AES-256-GCM.
 */
export type DecodedMattraxArchive =
  | {
      readonly kind: "handover";
      readonly document: unknown;
    }
  | {
      readonly kind: "cutover";
      readonly envelope: CutoverEnvelope;
      readonly payload: CutoverPayload;
    };

const isCutoverEnvelope = (value: unknown): value is { readonly format: string } =>
  typeof value === "object" &&
  value !== null &&
  "format" in value &&
  (value as { readonly format?: unknown }).format === CUTOVER_FORMAT;

/**
 * Decrypt either archive format. Errors are ordinary `Error`s with no secret
 * material; callers render them through the CLI's redacting error path.
 */
export const decodeMattraxArchive = async (
  text: string,
  passphrase: string,
): Promise<DecodedMattraxArchive> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not a Mattrax JSON archive.");
  }

  if (isCutoverEnvelope(parsed)) {
    const decoded = await decodeCutoverArchive({ archive: text, passphrase });

    return {
      kind: "cutover",
      envelope: decoded.envelope,
      payload: decoded.payload,
    };
  }

  const plaintext = await openWithPassphrase(passphrase, parsed as PassphraseEnvelope);

  let document: unknown;

  try {
    document = JSON.parse(plaintext);
  } catch {
    throw new Error("The decrypted handover archive is not valid JSON.");
  }

  return { kind: "handover", document };
};
