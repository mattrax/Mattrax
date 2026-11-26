/**
 * Metadata read from an uploaded `.ipa`.
 *
 * The catalogue shows when the embedded provisioning profile expires so an
 * administrator discovers an expired enterprise build before devices reject
 * it. Mattrax never re-signs the artefact: the profile inside the `.ipa` is
 * the one iOS will evaluate.
 *
 * An `.ipa` is a Zip archive. Only `Payload/<App>.app/embedded.mobileprovision`
 * is read, and the profile is a CMS SignedData whose payload is an XML plist.
 * The XML is located directly instead of verifying the CMS, because nothing
 * here is trusted for a security decision; a profile that cannot be read
 * simply omits the expiry.
 *
 * Uploads are attacker-controlled, so every size is treated as a hint. The
 * compressed slice and the inflated stream are both bounded by
 * {@link IPA_MAX_PROFILE_BYTES}, and the scan for the XML plist is linear.
 */

import { Effect, Option, Schema } from "effect";
import { parsePlist } from "@mattrax/plist";
import type { PlistValue } from "@mattrax/plist";

/** Largest provisioning profile or compressed profile Mattrax will inspect. */
export const IPA_MAX_PROFILE_BYTES = 8 * 1024 * 1024;

/**
 * A valid profile's plist starts near the beginning of the CMS payload. Refuse
 * anything that buries it deeper, so a crafted archive cannot make the scanner
 * walk megabytes of attacker data to find the opening tag.
 */
const MAX_PLIST_START = 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;

const CENTRAL_SIGNATURE = 0x02014b50;

const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_MIN_BYTES = 22;

const MAX_COMMENT_BYTES = 65_535;

const PROVISIONING_PROFILE_PATH = /^Payload\/[^/]+\.app\/embedded\.mobileprovision$/i;

const readU16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! | (bytes[offset + 1]! << 8);

const readU32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)) >>>
  0;

const decodeName = (bytes: Uint8Array, offset: number, length: number): string | undefined => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset, offset + length),
    );
  } catch {
    return undefined;
  }
};

/** Locate the Zip end-of-central-directory record, scanning back over the comment. */
const endOfCentralDirectory = (bytes: Uint8Array): number | undefined => {
  const start = Math.max(0, bytes.length - EOCD_MIN_BYTES - MAX_COMMENT_BYTES);

  for (let offset = bytes.length - EOCD_MIN_BYTES; offset >= start; offset--)
    if (readU32(bytes, offset) === EOCD_SIGNATURE) return offset;

  return undefined;
};

type ProvisioningProfileEntry = {
  readonly data: Uint8Array;
  readonly method: number;
  readonly uncompressedSize: number;
};

/**
 * Find the single provisioning-profile entry in the archive's central
 * directory. Two entries with the same name are ambiguous and rejected.
 */
const provisioningProfileEntry = (bytes: Uint8Array): ProvisioningProfileEntry | undefined => {
  const eocd = endOfCentralDirectory(bytes);

  if (eocd === undefined) return undefined;

  const entries = readU16(bytes, eocd + 10);
  const directorySize = readU32(bytes, eocd + 12);
  let offset = readU32(bytes, eocd + 16);

  if (offset > bytes.length || directorySize > bytes.length - offset) return undefined;

  let found: ProvisioningProfileEntry | undefined;

  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.length || readU32(bytes, offset) !== CENTRAL_SIGNATURE)
      return undefined;

    const method = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20);
    const uncompressedSize = readU32(bytes, offset + 24);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const localOffset = readU32(bytes, offset + 42);

    if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) return undefined;

    const name = decodeName(bytes, offset + 46, nameLength);

    if (name === undefined) return undefined;

    if (PROVISIONING_PROFILE_PATH.test(name)) {
      // The catalogue only needs the expiry, so a profile larger than the cap
      // is reported as unreadable rather than partially parsed.
      if (compressedSize > IPA_MAX_PROFILE_BYTES || uncompressedSize > IPA_MAX_PROFILE_BYTES)
        return undefined;

      if (found) return undefined;

      if (localOffset + 30 > bytes.length || readU32(bytes, localOffset) !== LOCAL_SIGNATURE)
        return undefined;

      const localNameLength = readU16(bytes, localOffset + 26);
      const localExtraLength = readU16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;

      if (dataStart + compressedSize > bytes.length) return undefined;

      found = {
        method,
        uncompressedSize,
        data: bytes.subarray(dataStart, dataStart + compressedSize),
      };
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return found;
};

/** Inflate with a hard output cap, aborting the stream as soon as it is hit. */
const inflateRaw = async (
  data: Uint8Array,
  declaredSize: number,
): Promise<Uint8Array | undefined> => {
  // `slice` gives the copy a plain ArrayBuffer, which is what BlobPart accepts.
  const reader = new Blob([data.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      total += value.byteLength;

      // Both the cap and the declared size are enforced while reading, so a
      // 1000:1 bomb stops after the first chunk instead of buffering itself.
      if (total > IPA_MAX_PROFILE_BYTES || total > declaredSize) {
        await reader.cancel();

        return undefined;
      }

      chunks.push(value);
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }

  if (total !== declaredSize) return undefined;

  const output = new Uint8Array(total);
  let cursor = 0;

  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  return output;
};

/** The raw `embedded.mobileprovision` bytes, or undefined when not present. */
export const extractIpaProvisioningProfile = async (
  bytes: Uint8Array,
): Promise<Uint8Array | undefined> => {
  const entry = provisioningProfileEntry(bytes);

  if (!entry) return undefined;

  if (entry.method === 0) {
    // A stored entry has no decompression step, so the declared size must
    // match the bytes exactly; a forged/truncated size is rejected.
    if (
      entry.uncompressedSize > IPA_MAX_PROFILE_BYTES ||
      entry.data.byteLength !== entry.uncompressedSize
    )
      return undefined;

    return entry.data;
  }

  if (entry.method === 8) return await inflateRaw(entry.data, entry.uncompressedSize);

  return undefined;
};

/**
 * Extract the first XML plist from the profile bytes with a bounded, linear
 * scan. A regex with a lazy wildcard was quadratic on crafted input.
 */
const firstPlistXml = (profile: Uint8Array): string | undefined => {
  const text = new TextDecoder().decode(profile);
  const lower = text.toLowerCase();
  const start = lower.indexOf("<plist");

  if (start < 0 || start > MAX_PLIST_START) return undefined;

  const end = lower.indexOf("</plist>", start);

  return end < 0 ? undefined : text.slice(start, end + "</plist>".length);
};

/**
 * Expiry of the provisioning profile embedded in an `.ipa`.
 *
 * Undefined means the file had no readable `embedded.mobileprovision` or an
 * unparseable one; the catalogue then omits the expiry instead of guessing.
 */
export const ipaProvisioningExpiresAt = (bytes: Uint8Array): Effect.Effect<Date | undefined> =>
  Effect.gen(function* () {
    const profile = yield* Effect.tryPromise({
      try: () => extractIpaProvisioningProfile(bytes),
      catch: () => new Error("unreadable ipa"),
    }).pipe(Effect.catch(() => Effect.succeed(undefined)));

    if (!profile) return undefined;

    const xml = firstPlistXml(profile);

    if (!xml) return undefined;

    const parsed = yield* parsePlist(xml).pipe(Effect.option);

    if (Option.isNone(parsed)) return undefined;

    const value = parsed.value;

    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

    // SAFETY: the plist top level is a dictionary; the union still includes
    // Date/Uint8Array because nested values can be either.
    const expiry = (value as { readonly [key: string]: PlistValue })["ExpirationDate"];

    return Schema.is(Schema.Date)(expiry) ? expiry : undefined;
  });
