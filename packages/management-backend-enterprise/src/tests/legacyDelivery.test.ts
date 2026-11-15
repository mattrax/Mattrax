import { describe, expect, it } from "vitest";
import { parsePlist } from "@mattrax/plist";
import { Effect, Schema } from "effect";
import { createEscrowCertificate, pemEncode } from "@mattrax/scep";
import {
  buildLegacyProfiles,
  installProfilePayload,
  installedProfiles,
  planLegacyProfileChanges,
  profileDigest,
} from "../legacyDelivery.js";

const customProfile = (identifier: string, extra = "") => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadIdentifier</key><string>${identifier}</string>
<key>PayloadDisplayName</key><string>Test profile</string>
<key>PayloadUUID</key><string>11111111-1111-1111-1111-111111111111</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.apple.applicationaccess</string>
<key>PayloadIdentifier</key><string>${identifier}.payload</string>
<key>PayloadUUID</key><string>22222222-2222-2222-2222-222222222222</string>
<key>PayloadVersion</key><integer>1</integer>${extra}
</dict></array>
</dict></plist>`;

  return btoa(xml);
};

const unsign = (value: string) => atob(value);

describe("buildLegacyProfiles", () => {
  it("compiles device restrictions and custom profiles with stable identifiers", async () => {
    const built = await buildLegacyProfiles([
      { policyId: "policy-1", kind: "mttx.apple.device", data: { camera: false }, hash: "h1" },
      {
        policyId: "policy-1",
        kind: "mttx.apple.custom.one",
        data: { content: customProfile("app.mattrax.custom.one") },
        hash: "h2",
      },
    ]);

    expect(built.unsupported).toEqual([]);
    expect(built.profiles.map((profile) => profile.identifier)).toEqual([
      "app.mattrax.p.policy-1.mttx.apple.device",
      "app.mattrax.custom.one",
    ]);

    const devicePlist = await Effect.runPromise(
      parsePlist(unsign(installProfilePayload(built.profiles[0]!).Payload)),
    );

    expect(devicePlist).toMatchObject({ PayloadType: "Configuration" });
  });

  it("compiles a certificate into a pkcs1 profile a pre-DDM device can install", async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );

    const certificate = await createEscrowCertificate(keyPair, "Test certificate");
    const pem = pemEncode("CERTIFICATE", certificate.toSchema().toBER(false));

    const built = await buildLegacyProfiles([
      { policyId: "policy-1", kind: "mttx.apple.certificate.root", data: { pem }, hash: "h" },
    ]);

    expect(built.profiles).toHaveLength(1);

    const plist = await Effect.runPromise(
      parsePlist(unsign(installProfilePayload(built.profiles[0]!).Payload)),
    );

    const content = Schema.decodeUnknownSync(
      Schema.Struct({
        PayloadContent: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    )(plist).PayloadContent;

    expect(content[0]).toMatchObject({ PayloadType: "com.apple.security.pkcs1" });
  });

  it("reports kinds that have no legacy equivalent instead of dropping them", async () => {
    const built = await buildLegacyProfiles([
      {
        policyId: "policy-1",
        kind: "mttx.apple.declaration.abc",
        data: { kind: "com.apple.configuration.legacy", configuration: {} },
        hash: "h",
      },
    ]);

    expect(built.profiles).toEqual([]);
    expect(built.unsupported[0]?.reason).toContain("declarative management");
  });
});

describe("planLegacyProfileChanges", () => {
  const profile = (identifier: string, content: string) => ({
    identifier,
    policyId: "policy-1",
    kind: "mttx.apple.device",
    content: new TextEncoder().encode(content),
  });

  it("queues nothing when the device already has the same bytes", async () => {
    const wanted = profile("a", "one");
    const installed = new Map([["a", await profileDigest(wanted.content)]]);

    await expect(planLegacyProfileChanges([wanted], installed)).resolves.toEqual({
      install: [],
      remove: [],
    });
  });

  it("re-installs changed content and removes profiles no longer in the policy", async () => {
    const wanted = profile("a", "two");

    const installed = new Map([
      ["a", await profileDigest(new TextEncoder().encode("one"))],
      ["b", await profileDigest(new TextEncoder().encode("other"))],
    ]);

    const changes = await planLegacyProfileChanges([wanted], installed);

    expect(changes.install.map((item) => item.identifier)).toEqual(["a"]);
    expect(changes.remove).toEqual(["b"]);
  });
});

describe("installedProfiles", () => {
  it("reads install history and honours a later removal", async () => {
    const install = {
      payload: { Payload: customProfile("app.mattrax.custom.one") },
    };

    const installed = await installedProfiles([install], []);
    expect([...installed.keys()]).toEqual(["app.mattrax.custom.one"]);

    const afterRemoval = await installedProfiles(
      [install],
      [{ payload: { Identifier: "app.mattrax.custom.one" } }],
    );

    expect(afterRemoval.size).toBe(0);
  });

  it("ignores malformed history", async () => {
    await expect(
      installedProfiles([{ payload: { Payload: "not base64!" } }, { payload: null }], []),
    ).resolves.toEqual(new Map());
  });
});
