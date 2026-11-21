import type { AdmxInputFile } from "./types.js";
import { ADMX_LIMITS, AdmxImportError } from "./xml.js";

/**
 * Minimal ZIP reader for ADMX template bundles.
 *
 * The designer already has a store-only ZIP *writer* for exports; imports need
 * a reader because vendors ship templates in ordinary deflate archives. This
 * reader supports exactly the two methods ADMX bundles use (stored and
 * deflate), verifies the declared sizes and CRC, and refuses zip64, encryption
 * and anything that would expand past the upload budget. It never writes to
 * disk and never trusts a path from the archive.
 */

const EOCD_SIGNATURE = 0x06054b50;

const CENTRAL_SIGNATURE = 0x02014b50;

const LOCAL_SIGNATURE = 0x04034b50;

const MAX_EOCD_SEARCH = 65_557; // fixed EOCD size + maximum comment

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }

  return table;
})();

export const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;

  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);

  return (crc ^ 0xffffffff) >>> 0;
};

export const decodeText = (bytes: Uint8Array) => {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));

  return new TextDecoder("utf-8").decode(bytes);
};

const findEocd = (view: DataView) => {
  const start = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);

  for (let offset = view.byteLength - 22; offset >= start; offset -= 1)
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;

  return -1;
};

const isTemplateEntry = (name: string) => /\.(admx|adml)$/i.test(name);

const baseName = (name: string) => {
  const file = name.split("/").pop() ?? name;

  return file.replace(/\.[^.]+$/, "").toLowerCase();
};

const streamBytes = async (
  compressed: Uint8Array,
  declaredSize: number,
  limit: number,
): Promise<Uint8Array> => {
  if (declaredSize > limit)
    throw new AdmxImportError(
      "zip-too-large",
      `A zip entry expands to ${declaredSize.toLocaleString()} bytes; the limit is ${limit.toLocaleString()}.`,
    );

  const reader = new Blob([new Uint8Array(compressed)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const result = await reader.read();

    if (result.done) break;

    const value = result.value;
    total += value.length;

    if (total > limit) {
      await reader.cancel();

      throw new AdmxImportError(
        "zip-too-large",
        `A zip entry expands beyond the ${limit.toLocaleString()} byte limit.`,
      );
    }

    chunks.push(value);
  }

  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
};

export type ReadAdmxZipOptions = {
  readonly maxEntries?: number;
  readonly maxEntryBytes?: number;
  readonly maxBundleBytes?: number;
};

/** Read every `.admx` and `.adml` entry from a ZIP archive, in directory order. */
export const readAdmxZip = async (
  archive: Uint8Array,
  options: ReadAdmxZipOptions = {},
): Promise<AdmxInputFile[]> => {
  const maxEntries = options.maxEntries ?? ADMX_LIMITS.maxZipEntries;
  const maxEntryBytes = options.maxEntryBytes ?? ADMX_LIMITS.maxZipEntryBytes;
  const maxBundleBytes = options.maxBundleBytes ?? ADMX_LIMITS.maxZipBundleBytes;

  if (archive.length > maxBundleBytes)
    throw new AdmxImportError("zip-too-large", "The zip archive is larger than the 4 MiB limit.");

  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = findEocd(view);

  if (eocd < 0) throw new AdmxImportError("zip-invalid", "The file is not a zip archive.");

  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff)
    throw new AdmxImportError(
      "zip-unsupported",
      "zip64 archives are not supported; re-save the template as a regular zip.",
    );

  if (entries > maxEntries)
    throw new AdmxImportError(
      "zip-too-large",
      `The zip has ${entries.toLocaleString()} entries; the limit is ${maxEntries.toLocaleString()}.`,
    );

  if (directoryOffset + directorySize > archive.length)
    throw new AdmxImportError("zip-invalid", "The zip central directory is out of bounds.");

  const files: AdmxInputFile[] = [];
  let offset = directoryOffset;
  let expanded = 0;

  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > archive.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE)
      throw new AdmxImportError("zip-invalid", "The zip central directory is corrupt.");

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    if ((flags & 0x1) !== 0)
      throw new AdmxImportError("zip-encrypted", "Encrypted zip archives are not supported.");

    if (offset + 46 + nameLength > archive.length)
      throw new AdmxImportError("zip-invalid", "The zip entry name is out of bounds.");

    const name = decodeText(archive.subarray(offset + 46, offset + 46 + nameLength));

    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/") || !isTemplateEntry(name)) continue;

    if (localOffset + 30 > archive.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE)
      throw new AdmxImportError("zip-invalid", `The local header for "${name}" is corrupt.`);

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;

    if (dataStart + compressedSize > archive.length)
      throw new AdmxImportError("zip-invalid", `The data for "${name}" is out of bounds.`);

    if (method !== 0 && method !== 8)
      throw new AdmxImportError(
        "zip-unsupported",
        `"${name}" uses zip compression method ${method}; only stored and deflate are supported.`,
      );

    const compressed = archive.subarray(dataStart, dataStart + compressedSize);

    const bytes =
      method === 0
        ? (() => {
            if (compressed.length > maxEntryBytes)
              throw new AdmxImportError(
                "zip-too-large",
                `"${name}" is larger than the 1 MiB per-file limit.`,
              );

            return compressed;
          })()
        : await streamBytes(compressed, uncompressedSize, maxEntryBytes);

    if (bytes.length !== uncompressedSize)
      throw new AdmxImportError("zip-invalid", `"${name}" did not expand to its declared size.`);

    if (crc32(bytes) !== crc)
      throw new AdmxImportError("zip-invalid", `"${name}" failed its CRC check.`);

    expanded += bytes.length;

    if (expanded > maxBundleBytes)
      throw new AdmxImportError(
        "zip-too-large",
        `The zip expands beyond the ${maxBundleBytes.toLocaleString()} byte limit.`,
      );

    files.push({ name, text: decodeText(bytes) });
  }

  return files;
};

/** The lowercase base name used to pair `foo.admx` with `en-US/foo.adml`. */
export const admxPairKey = (name: string) => baseName(name);
