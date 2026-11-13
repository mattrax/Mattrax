/**
 * Minimal ZIP writer for policy bundles. Entries are stored (no compression):
 * artifacts are small text files, and this keeps the browser bundle free of a
 * compression dependency.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** DOS timestamp used by ZIP local headers. */
const dosTimestamp = (date = new Date()) => {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
};

const writeU16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
  return offset + 2;
};
const writeU32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value >>> 0, true);
  return offset + 4;
};

export type ZipEntry = { name: string; content: string | Uint8Array; modified?: Date };

const bytesOf = (value: string | Uint8Array) =>
  typeof value === "string" ? new TextEncoder().encode(value) : value;

/** Build a store-only ZIP archive from text or byte entries. */
export const buildZip = (entries: ZipEntry[]): Uint8Array => {
  const encoder = new TextEncoder();
  const files = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    bytes: bytesOf(entry.content),
    modified: entry.modified ?? new Date(),
  }));

  const localSize = files.reduce(
    (total, file) => total + 30 + file.name.length + file.bytes.length,
    0,
  );
  const directorySize = files.reduce((total, file) => total + 46 + file.name.length, 0);
  const output = new Uint8Array(localSize + directorySize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  const central = new Uint32Array(files.length);

  files.forEach((file, index) => {
    const crc = crc32(file.bytes);
    const { time, day } = dosTimestamp(file.modified);
    central[index] = offset;
    offset = writeU32(view, offset, 0x04034b50);
    offset = writeU16(view, offset, 20); // version needed
    offset = writeU16(view, offset, 0); // flags
    offset = writeU16(view, offset, 0); // store
    offset = writeU16(view, offset, time);
    offset = writeU16(view, offset, day);
    offset = writeU32(view, offset, crc);
    offset = writeU32(view, offset, file.bytes.length);
    offset = writeU32(view, offset, file.bytes.length);
    offset = writeU16(view, offset, file.name.length);
    offset = writeU16(view, offset, 0); // extra
    output.set(file.name, offset);
    offset += file.name.length;
    output.set(file.bytes, offset);
    offset += file.bytes.length;
  });

  const centralStart = offset;
  files.forEach((file, index) => {
    const crc = crc32(file.bytes);
    const { time, day } = dosTimestamp(file.modified);
    offset = writeU32(view, offset, 0x02014b50);
    offset = writeU16(view, offset, 20); // made by
    offset = writeU16(view, offset, 20); // version needed
    offset = writeU16(view, offset, 0); // flags
    offset = writeU16(view, offset, 0); // store
    offset = writeU16(view, offset, time);
    offset = writeU16(view, offset, day);
    offset = writeU32(view, offset, crc);
    offset = writeU32(view, offset, file.bytes.length);
    offset = writeU32(view, offset, file.bytes.length);
    offset = writeU16(view, offset, file.name.length);
    offset = writeU16(view, offset, 0); // extra
    offset = writeU16(view, offset, 0); // comment
    offset = writeU16(view, offset, 0); // disk
    offset = writeU16(view, offset, 0); // internal attrs
    offset = writeU32(view, offset, 0); // external attrs
    offset = writeU32(view, offset, central[index]!);
    output.set(file.name, offset);
    offset += file.name.length;
  });

  const centralSize = offset - centralStart;
  offset = writeU32(view, offset, 0x06054b50);
  offset = writeU16(view, offset, 0); // disk
  offset = writeU16(view, offset, 0); // central disk
  offset = writeU16(view, offset, files.length);
  offset = writeU16(view, offset, files.length);
  offset = writeU32(view, offset, centralSize);
  offset = writeU32(view, offset, centralStart);
  offset = writeU16(view, offset, 0); // comment length
  return output.slice(0, offset);
};
