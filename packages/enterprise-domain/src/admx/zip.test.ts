import { describe, expect, it } from "vitest";
import { AdmxImportError, crc32, decodeText, readAdmxZip } from "./index.js";

type Entry = { name: string; content: string; deflate?: boolean; encrypted?: boolean };

const deflate = async (bytes: Uint8Array) =>
  new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer(),
  );

/** Store/deflate ZIP writer, small enough to keep the fixture in one file. */
const makeZip = async (entries: Entry[]) => {
  const encoder = new TextEncoder();

  const files = await Promise.all(
    entries.map(async (entry) => {
      const raw = encoder.encode(entry.content);
      const data = entry.deflate ? await deflate(raw) : raw;

      return {
        name: encoder.encode(entry.name),
        raw,
        data,
        method: entry.deflate ? 8 : 0,
        flags: entry.encrypted ? 1 : 0,
        crc: crc32(raw),
      };
    }),
  );

  const write16 = (view: DataView, offset: number, value: number) => {
    view.setUint16(offset, value, true);

    return offset + 2;
  };

  const write32 = (view: DataView, offset: number, value: number) => {
    view.setUint32(offset, value >>> 0, true);

    return offset + 4;
  };

  const localSize = files.reduce(
    (total, file) => total + 30 + file.name.length + file.data.length,
    0,
  );
  const centralSize = files.reduce((total, file) => total + 46 + file.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  const central: number[] = [];
  let offset = 0;

  for (const file of files) {
    central.push(offset);
    offset = write32(view, offset, 0x04034b50);
    offset = write16(view, offset, 20);
    offset = write16(view, offset, file.flags);
    offset = write16(view, offset, file.method);
    offset = write16(view, offset, 0);
    offset = write16(view, offset, 0);
    offset = write32(view, offset, file.crc);
    offset = write32(view, offset, file.data.length);
    offset = write32(view, offset, file.raw.length);
    offset = write16(view, offset, file.name.length);
    offset = write16(view, offset, 0);
    output.set(file.name, offset);
    offset += file.name.length;
    output.set(file.data, offset);
    offset += file.data.length;
  }

  const directoryStart = offset;

  files.forEach((file, index) => {
    offset = write32(view, offset, 0x02014b50);
    offset = write16(view, offset, 20);
    offset = write16(view, offset, 20);
    offset = write16(view, offset, file.flags);
    offset = write16(view, offset, file.method);
    offset = write16(view, offset, 0);
    offset = write16(view, offset, 0);
    offset = write32(view, offset, file.crc);
    offset = write32(view, offset, file.data.length);
    offset = write32(view, offset, file.raw.length);
    offset = write16(view, offset, file.name.length);
    offset = write16(view, offset, 0);
    offset = write16(view, offset, 0);
    offset = write16(view, offset, 0);
    offset = write16(view, offset, 0);
    offset = write32(view, offset, 0);
    offset = write32(view, offset, central[index]);
    output.set(file.name, offset);
    offset += file.name.length;
  });

  const directorySize = offset - directoryStart;
  offset = write32(view, offset, 0x06054b50);
  offset = write16(view, offset, 0);
  offset = write16(view, offset, 0);
  offset = write16(view, offset, files.length);
  offset = write16(view, offset, files.length);
  offset = write32(view, offset, directorySize);
  offset = write32(view, offset, directoryStart);
  offset = write16(view, offset, 0);

  return output.slice(0, offset);
};

describe("readAdmxZip", () => {
  it("reads stored and deflated ADMX/ADML entries", async () => {
    const zip = await makeZip([
      { name: "chrome.admx", content: "<policyDefinitions />", deflate: true },
      { name: "en-US/chrome.adml", content: "<policyDefinitionResources />", deflate: true },
      { name: "README.txt", content: "not a template" },
    ]);

    const files = await readAdmxZip(zip);

    expect(files.map((file) => file.name)).toEqual(["chrome.admx", "en-US/chrome.adml"]);
    expect(files[0]?.text).toBe("<policyDefinitions />");
    expect(files[1]?.text).toBe("<policyDefinitionResources />");
  });

  it("rejects an entry larger than the limit", async () => {
    const zip = await makeZip([{ name: "big.admx", content: "x".repeat(100) }]);

    await expect(readAdmxZip(zip, { maxEntryBytes: 10 })).rejects.toMatchObject({
      code: "zip-too-large",
    });
  });

  it("rejects a bundle larger than the limit", async () => {
    const zip = await makeZip([{ name: "a.admx", content: "a" }]);

    await expect(readAdmxZip(zip, { maxBundleBytes: 10 })).rejects.toBeInstanceOf(AdmxImportError);
  });

  it("rejects encrypted entries", async () => {
    const zip = await makeZip([{ name: "a.admx", content: "<a/>", encrypted: true }]);

    await expect(readAdmxZip(zip)).rejects.toMatchObject({ code: "zip-encrypted" });
  });

  it("rejects a file that is not a zip", async () => {
    await expect(readAdmxZip(new TextEncoder().encode("hello"))).rejects.toMatchObject({
      code: "zip-invalid",
    });
  });
});

describe("decodeText", () => {
  it("strips a UTF-8 BOM and decodes UTF-16", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");

    const utf16 = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]);

    expect(decodeText(utf16)).toBe("ab");
  });
});
