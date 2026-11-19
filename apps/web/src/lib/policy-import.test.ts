import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { PolicyRow } from "@mattrax/enterprise-domain/client";
import {
  normalizeMobileconfig,
  parsePolicyImportText,
  planMobileconfigImport,
  planPolicyImport,
} from "./policy-import";

const row = (overrides: Partial<PolicyRow> = {}): PolicyRow => ({
  id: "p1",
  name: "Baseline",
  notes: null,
  priority: 10,
  configurations: {},
  configurationScopes: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const parse = (text: string) => Effect.runPromise(parsePolicyImportText(text, "test"));

const unsignedProfile = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadDisplayName</key>
  <string>Restrictions</string>
  <key>PayloadIdentifier</key>
  <string>com.example.restrictions</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.applicationaccess</string>
    </dict>
  </array>
</dict>
</plist>`;

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const base64ToText = (content: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(content), (char) => char.charCodeAt(0)));

describe("parsePolicyImportText", () => {
  it("parses the JSON document written by the CLI", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          {
            name: "Baseline",
            notes: "Company defaults",
            priority: 100,
            configurations: { "mttx.apple.device": { camera: false } },
            configurationScopes: { "mttx.apple.custom.wifi": "user" },
          },
        ],
      }),
    );

    expect(policy).toMatchObject({
      name: "Baseline",
      priority: 100,
      configurations: { "mttx.apple.device": { camera: false } },
      configurationScopes: { "mttx.apple.custom.wifi": "user" },
    });
  });

  it("parses the default YAML export", async () => {
    const policy = await parse(
      [
        "version: 1",
        "policies:",
        "  - name: Baseline",
        "    configurations:",
        "      mttx.apple.device:",
        "        camera: false",
      ].join("\n"),
    );

    expect(policy.name).toBe("Baseline");
    expect(policy.configurations?.["mttx.apple.device"]).toEqual({ camera: false });
  });

  it("accepts a bare policy object", async () => {
    const policy = await parse(
      JSON.stringify({ name: "Pasted", configurations: { "mttx.apple.device": {} } }),
    );

    expect(policy.name).toBe("Pasted");
  });

  it("refuses a multi-policy document and points at the single-policy export", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        parsePolicyImportText(
          JSON.stringify({ version: 1, policies: [{ name: "One" }, { name: "Two" }] }),
          "two.json",
        ),
      ),
    );

    expect(error).toContain("2 policies");
    expect(error).toContain("--format json");
  });

  it("rejects a document that is not a policy", async () => {
    await expect(parse(JSON.stringify({ hello: "world" }))).rejects.toContain(
      "not a Mattrax policy",
    );
  });
});

describe("planPolicyImport", () => {
  it("adds every kind when the target policy has none", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          {
            name: "Imported",
            configurations: {
              "mttx.apple.device": { camera: false },
              "mttx.windows.custom.edge": { omaUri: "./Vendor/MSFT/Policy", value: "1" },
            },
          },
        ],
      }),
    );

    const plan = planPolicyImport({ policy });

    expect(plan.name).toBe("Imported");
    expect(plan.configurations.map((entry) => entry.action)).toEqual(["add", "add"]);
    expect(plan.payload.configurations).toEqual(policy.configurations);
    expect(plan.payload.configurationScopes).toEqual({
      "mttx.apple.device": "device",
      "mttx.windows.custom.edge": "device",
    });
  });

  it("skips an existing kind by default", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          {
            name: "Baseline",
            configurations: {
              "mttx.apple.device": { camera: true },
              "mttx.windows.custom.new": { omaUri: "./Vendor/MSFT/Policy", value: "1" },
            },
          },
        ],
      }),
    );

    const plan = planPolicyImport({
      policy,
      existing: row({ configurations: { "mttx.apple.device": { camera: false } } }),
    });

    expect(plan.configurations.map((entry) => entry.action)).toEqual(["skip", "add"]);
    expect(plan.payload.configurations).toEqual({
      "mttx.windows.custom.new": { omaUri: "./Vendor/MSFT/Policy", value: "1" },
    });
  });

  it("overwrites an existing kind when asked", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [{ name: "Baseline", configurations: { "mttx.apple.device": { camera: true } } }],
      }),
    );

    const plan = planPolicyImport({
      policy,
      existing: row({ configurations: { "mttx.apple.device": { camera: false } } }),
      conflict: "overwrite",
    });

    expect(plan.configurations[0]?.action).toBe("overwrite");
    expect(plan.payload.configurations["mttx.apple.device"]).toEqual({ camera: true });
  });

  it("reports identical configurations as unchanged and writes nothing", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          { name: "Baseline", configurations: { "mttx.apple.device": { camera: false } } },
        ],
      }),
    );

    const plan = planPolicyImport({
      policy,
      existing: row({ configurations: { "mttx.apple.device": { camera: false } } }),
      conflict: "overwrite",
    });

    expect(plan.configurations[0]?.action).toBe("unchanged");
    expect(plan.payload.configurations).toEqual({});
  });

  it("keeps the stored user scope when the document does not name one", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          { name: "Baseline", configurations: { "mttx.apple.custom.wifi": { ssid: "new" } } },
        ],
      }),
    );

    const plan = planPolicyImport({
      policy,
      existing: row({
        configurations: { "mttx.apple.custom.wifi": { ssid: "old" } },
        configurationScopes: { "mttx.apple.custom.wifi": "user" },
      }),
      conflict: "overwrite",
    });

    expect(plan.configurations[0]?.scope).toBe("user");
    expect(plan.payload.configurationScopes).toEqual({ "mttx.apple.custom.wifi": "user" });
  });

  it("treats an identical payload on a different channel as a conflict, not unchanged", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          {
            name: "Baseline",
            configurations: { "mttx.apple.custom.wifi": { ssid: "same" } },
            configurationScopes: { "mttx.apple.custom.wifi": "user" },
          },
        ],
      }),
    );

    const existing = row({
      configurations: { "mttx.apple.custom.wifi": { ssid: "same" } },
      configurationScopes: {},
    });

    const skipped = planPolicyImport({ policy, existing });

    expect(skipped.configurations[0]?.action).toBe("skip");
    expect(skipped.payload.configurations).toEqual({});

    const replaced = planPolicyImport({ policy, existing, conflict: "overwrite" });

    expect(replaced.configurations[0]?.action).toBe("overwrite");
    expect(replaced.payload.configurations).toEqual({
      "mttx.apple.custom.wifi": { ssid: "same" },
    });
    expect(replaced.payload.configurationScopes).toEqual({ "mttx.apple.custom.wifi": "user" });
  });

  it("keeps an unchanged kind unchanged when the stored channel matches", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          {
            name: "Baseline",
            configurations: { "mttx.apple.custom.wifi": { ssid: "same" } },
            configurationScopes: { "mttx.apple.custom.wifi": "user" },
          },
        ],
      }),
    );

    const plan = planPolicyImport({
      policy,
      existing: row({
        configurations: { "mttx.apple.custom.wifi": { ssid: "same" } },
        configurationScopes: { "mttx.apple.custom.wifi": "user" },
      }),
      conflict: "overwrite",
    });

    expect(plan.configurations[0]?.action).toBe("unchanged");
    expect(plan.payload.configurations).toEqual({});
  });

  it("uses the document scope for a new kind", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [
          {
            name: "Baseline",
            configurations: { "mttx.apple.custom.wifi": { ssid: "new" } },
            configurationScopes: { "mttx.apple.custom.wifi": "user" },
          },
        ],
      }),
    );

    const plan = planPolicyImport({ policy });

    expect(plan.configurations[0]?.scope).toBe("user");
    expect(plan.payload.configurationScopes).toEqual({ "mttx.apple.custom.wifi": "user" });
  });

  it("ignores metadata when merging into an existing policy", async () => {
    const policy = await parse(
      JSON.stringify({
        version: 1,
        policies: [{ name: "Other name", notes: "n", priority: 5, configurations: {} }],
      }),
    );

    const plan = planPolicyImport({ policy, existing: row({ name: "Target" }) });

    expect(plan.name).toBe("Target");
    expect(plan.warnings.join(" ")).toContain("Only its configurations are imported");
  });
});

describe("mobileconfig import", () => {
  it("stores an unsigned plist as read-only XML content", () => {
    const profile = normalizeMobileconfig({
      content: unsignedProfile,
      fileName: "wifi.mobileconfig",
    });

    expect(profile.signed).toBe(false);
    expect(base64ToText(profile.content)).toBe(unsignedProfile);

    const plan = planMobileconfigImport({
      content: profile.content,
      fileName: "wifi.mobileconfig",
      signed: profile.signed,
      displayName: "Restrictions",
    });

    expect(plan.name).toBe("Restrictions");
    expect(plan.configurations[0]?.kind).toBe("mttx.apple.custom.imported");
    expect(plan.configurations[0]?.data).toMatchObject({
      content: profile.content,
      fileName: "wifi.mobileconfig",
      signed: false,
    });
    expect(plan.payload.configurations).toHaveProperty("mttx.apple.custom.imported");
  });

  it("keeps a signed profile byte-for-byte", () => {
    const der = new Uint8Array([0x30, 0x82, 0x01, 0x00, 0x06, 0x09]);
    const content = bytesToBase64(der);
    const profile = normalizeMobileconfig({ content, fileName: "signed.mobileconfig" });

    expect(profile).toEqual({ content, signed: true });
  });

  it("numbers a second imported kind instead of replacing the first", () => {
    const profile = normalizeMobileconfig({ content: unsignedProfile });

    const plan = planMobileconfigImport({
      content: profile.content,
      signed: false,
      existing: row({
        configurations: {
          "mttx.apple.custom.imported": { content: "different", signed: false },
        },
      }),
    });

    expect(plan.configurations[0]?.kind).toBe("mttx.apple.custom.imported2");
    expect(plan.configurations[0]?.action).toBe("add");
  });

  it("reports an identical profile as unchanged", () => {
    const profile = normalizeMobileconfig({ content: unsignedProfile });

    const plan = planMobileconfigImport({
      content: profile.content,
      signed: false,
      existing: row({
        configurations: {
          "mttx.apple.custom.imported": { content: profile.content, signed: false },
        },
      }),
      conflict: "overwrite",
    });

    expect(plan.configurations[0]?.action).toBe("unchanged");
    expect(plan.payload.configurations).toEqual({});
  });

  it("carries the previewed user scope into the plan", () => {
    const profile = normalizeMobileconfig({ content: unsignedProfile });

    const plan = planMobileconfigImport({
      content: profile.content,
      signed: false,
      scope: "user",
    });

    expect(plan.payload.configurationScopes).toEqual({ "mttx.apple.custom.imported": "user" });
  });

  it("rejects a PEM-wrapped signed profile instead of storing one that fails to save", () => {
    expect(() =>
      normalizeMobileconfig({
        content: "-----BEGIN PKCS7-----\nMIIB\n-----END PKCS7-----",
      }),
    ).toThrow("PEM-wrapped signed profile");
  });

  it("blocks a signed user-scoped profile because the server refuses it", () => {
    const profile = normalizeMobileconfig({ content: unsignedProfile });

    const blocked = planMobileconfigImport({
      content: profile.content,
      signed: true,
      scope: "user",
    });

    expect(blocked.blocked).toBe(true);
    expect(blocked.warnings.join(" ")).toContain("signed profile cannot be imported");

    const unsigned = planMobileconfigImport({
      content: profile.content,
      signed: false,
      scope: "user",
    });

    expect(unsigned.blocked).toBe(false);
  });

  it("rejects a file that is not a profile", () => {
    expect(() => normalizeMobileconfig({ content: "not a profile" })).toThrow(
      "not a .mobileconfig",
    );
  });
});
