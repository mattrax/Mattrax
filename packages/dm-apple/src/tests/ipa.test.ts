import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { extractIpaProvisioningProfile, ipaProvisioningExpiresAt } from "../ipa.js";

const encoder = new TextEncoder();

const writeU16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
};

const writeU32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
};

const deflateRaw = async (bytes: Uint8Array) => {
  const stream = new Blob([bytes.slice().buffer])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));

  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * Minimal Zip writer for fixtures. The real reader only needs the local and
 * central directory records, so no CRC or timestamps are written.
 */
type ZipFixtureFile = {
  readonly name: string;
  readonly rawName?: Uint8Array;
  readonly data: Uint8Array;
  readonly deflate?: boolean;
  /** Forge only the central-directory size, as a hostile archive would. */
  readonly declaredCompressedSize?: number;
  readonly declaredUncompressedSize?: number;
};

const makeZip = async (files: ReadonlyArray<ZipFixtureFile>) => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = file.rawName ?? encoder.encode(file.name);
    const data = file.deflate ? await deflateRaw(file.data) : file.data;
    const method = file.deflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length + data.length);

    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0);
    writeU16(local, 8, method);
    writeU32(local, 14, 0);
    writeU32(local, 18, data.length);
    writeU32(local, 22, file.data.length);
    writeU16(local, 26, name.length);
    writeU16(local, 28, 0);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    localParts.push(local);

    const central = new Uint8Array(46 + name.length);

    writeU32(central, 0, 0x02014b50);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0);
    writeU16(central, 10, method);
    writeU32(central, 16, 0);
    writeU32(central, 20, file.declaredCompressedSize ?? data.length);
    writeU32(central, 24, file.declaredUncompressedSize ?? file.data.length);
    writeU16(central, 28, name.length);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU32(central, 42, offset);
    central.set(name, 46);

    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const eocd = new Uint8Array(22);

  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 8, files.length);
  writeU16(eocd, 10, files.length);
  writeU32(eocd, 12, centralSize);
  writeU32(eocd, 16, offset);

  const total = localParts.reduce((size, part) => size + part.length, 0) + centralSize + 22;
  const bytes = new Uint8Array(total);
  let cursor = 0;

  for (const part of [...localParts, ...centralParts, eocd]) {
    bytes.set(part, cursor);
    cursor += part.length;
  }

  return bytes;
};

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Name</key>
  <string>Internal Distribution</string>
  <key>ExpirationDate</key>
  <date>2027-01-02T03:04:05Z</date>
</dict>
</plist>`;

/** A CMS wrapper is opaque to the reader; only the embedded plist matters. */
const mobileProvision = (plist = PLIST) => {
  const payload = encoder.encode(plist);

  return new Uint8Array([0x30, 0x82, 0x01, 0x00, ...payload, 0x00, 0x01, 0x02]);
};

const ipa = (files: Parameters<typeof makeZip>[0]) => makeZip(files);

describe("ipa provisioning metadata", () => {
  it("reads the embedded provisioning profile from an ipa", async () => {
    const bytes = await ipa([
      { name: "Payload/Internal.app/Info.plist", data: encoder.encode("info") },
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: mobileProvision(),
        deflate: true,
      },
    ]);

    const profile = await extractIpaProvisioningProfile(bytes);

    expect(profile).toBeTruthy();
    expect(new TextDecoder().decode(profile)).toContain("<key>ExpirationDate</key>");
  });

  it("returns the profile expiry", async () => {
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: mobileProvision(),
      },
    ]);

    const expiry = await Effect.runPromise(ipaProvisioningExpiresAt(bytes));

    expect(expiry?.toISOString()).toBe("2027-01-02T03:04:05.000Z");
  });

  it("omits the expiry when there is no readable profile", async () => {
    const withoutProfile = await ipa([
      { name: "Payload/Internal.app/Info.plist", data: encoder.encode("info") },
    ]);

    await expect(Effect.runPromise(ipaProvisioningExpiresAt(withoutProfile))).resolves.toBe(
      undefined,
    );

    const malformed = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: encoder.encode("not a cms plist"),
      },
    ]);

    await expect(Effect.runPromise(ipaProvisioningExpiresAt(malformed))).resolves.toBeUndefined();
  });

  it("ignores a file that is not a zip", async () => {
    const bytes = encoder.encode("definitely not a zip");

    await expect(extractIpaProvisioningProfile(bytes)).resolves.toBeUndefined();
  });

  it("rejects a forged compressed size above the cap without reading it", async () => {
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: mobileProvision(),
        declaredCompressedSize: 8 * 1024 * 1024 + 1,
      },
    ]);

    await expect(extractIpaProvisioningProfile(bytes)).resolves.toBeUndefined();
  });

  it("rejects a stored entry whose declared size is understated", async () => {
    const profile = mobileProvision();
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: profile,
        declaredUncompressedSize: profile.byteLength - 1,
      },
    ]);

    await expect(extractIpaProvisioningProfile(bytes)).resolves.toBeUndefined();
  });

  it("stops a 1000:1 deflate bomb at the declared size", async () => {
    const bomb = new Uint8Array(9 * 1024 * 1024);
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: bomb,
        deflate: true,
        declaredUncompressedSize: 1024,
      },
    ]);

    const startedAt = Date.now();

    await expect(extractIpaProvisioningProfile(bytes)).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("rejects truncated EOCD and central-directory records", async () => {
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: mobileProvision(),
      },
    ]);

    await expect(
      extractIpaProvisioningProfile(bytes.slice(0, bytes.length - 10)),
    ).resolves.toBeUndefined();

    // Keep the EOCD but point the central directory past the file.
    const broken = bytes.slice();
    writeU32(broken, broken.length - 22 + 16, broken.length);

    await expect(extractIpaProvisioningProfile(broken)).resolves.toBeUndefined();
  });

  it("rejects duplicate provisioning-profile entries", async () => {
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: mobileProvision(),
      },
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: mobileProvision(),
      },
    ]);

    await expect(extractIpaProvisioningProfile(bytes)).resolves.toBeUndefined();
  });

  it("ignores path traversal in the entry name", async () => {
    const bytes = await ipa([
      {
        name: "Payload/../../Internal.app/embedded.mobileprovision",
        data: mobileProvision(),
      },
    ]);

    await expect(extractIpaProvisioningProfile(bytes)).resolves.toBeUndefined();
  });

  it("ignores a non-UTF8 entry name", async () => {
    const bytes = await ipa([
      {
        name: "unused",
        rawName: new Uint8Array([0xff, 0xfe, 0xfd]),
        data: mobileProvision(),
      },
    ]);

    await expect(extractIpaProvisioningProfile(bytes)).resolves.toBeUndefined();
  });

  it("ignores a non-UTF8 profile payload", async () => {
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02]),
      },
    ]);

    await expect(Effect.runPromise(ipaProvisioningExpiresAt(bytes))).resolves.toBeUndefined();
  });

  it("scans many unterminated plist tokens in linear time", async () => {
    // The previous lazy regex took tens of seconds on this shape; the linear
    // scan must not care how many opening tokens exist without a close.
    const profile = encoder.encode("<plist>".repeat(200_000));
    const bytes = await ipa([
      {
        name: "Payload/Internal.app/embedded.mobileprovision",
        data: profile,
      },
    ]);

    const startedAt = Date.now();

    await expect(Effect.runPromise(ipaProvisioningExpiresAt(bytes))).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
