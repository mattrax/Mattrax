import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "../index.js";
import { makeWindowsBackend } from "../windows.js";
import { makeDb, tableName } from "./fake-db.js";

const origin = "https://policies.test";
const authSecret = "policy-delivery-secret";
const mdmOrigin = new MdmOrigin({ url: origin });
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const organization = (id: string) => ({
  id,
  name: id,
  slug: id,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const device = (id: string, dmIdentifier: string, organizationId: string) => ({
  id,
  organizationId,
  proto: "apple",
  status: "enrolled",
  name: id,
  dmIdentifier,
  enrolledAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-01-01T00:00:00Z"),
});

const policy = (id: string, organizationId: string, priority: number) => ({
  id,
  organizationId,
  name: id,
  notes: null,
  priority,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date(Date.UTC(2026, 0, 1, 0, priority)),
});

const configuration = (policyId: string, kind: string, data: unknown, hash: string) => ({
  policyId,
  kind,
  data,
  hash,
});

const appleScope = {
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  mdmOrigin,
};

describe("Apple declaration delivery uses resolved policy", () => {
  it("delivers only the winning policy for a duplicated kind", async () => {
    const kind = "mttx.apple.declaration.wifi";
    const db = makeDb({
      [tableName(schema.organization)]: [organization("org-1")],
      [tableName(schema.device)]: [device("device-1", "udid-1", "org-1")],
      [tableName(schema.enterpriseGroup)]: [
        { id: "group-1", organizationId: "org-1", name: "Engineering" },
      ],
      [tableName(schema.groupDevice)]: [{ groupId: "group-1", deviceId: "device-1" }],
      [tableName(schema.groupPolicy)]: [
        { groupId: "group-1", policyId: "low", mode: "include" },
        { groupId: "group-1", policyId: "high", mode: "include" },
      ],
      [tableName(schema.policy)]: [policy("low", "org-1", 1), policy("high", "org-1", 10)],
      [tableName(schema.configuration)]: [
        configuration("low", kind, { kind: "com.apple.configuration.wifi" }, "hash-low"),
        configuration("high", kind, { kind: "com.apple.configuration.wifi" }, "hash-high"),
      ],
    });
    const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

    const items = await run(backend.getAppleDeclarationItems(appleScope));
    const policyConfigurations = items.configurations.filter(
      (item) => item.identifier.startsWith("high:") || item.identifier.startsWith("low:"),
    );

    expect(policyConfigurations).toHaveLength(1);
    expect(policyConfigurations[0]!.identifier).toBe(`high:${kind}`);
  });

  it("removes a group include when the device directly excludes the policy", async () => {
    const kind = "mttx.apple.declaration.wifi";
    const db = makeDb({
      [tableName(schema.organization)]: [organization("org-1")],
      [tableName(schema.device)]: [device("device-1", "udid-1", "org-1")],
      [tableName(schema.enterpriseGroup)]: [
        { id: "group-1", organizationId: "org-1", name: "Engineering" },
      ],
      [tableName(schema.groupDevice)]: [{ groupId: "group-1", deviceId: "device-1" }],
      [tableName(schema.groupPolicy)]: [
        { groupId: "group-1", policyId: "policy-a", mode: "include" },
      ],
      [tableName(schema.devicePolicy)]: [
        { deviceId: "device-1", policyId: "policy-a", mode: "exclude" },
      ],
      [tableName(schema.policy)]: [policy("policy-a", "org-1", 5)],
      [tableName(schema.configuration)]: [
        configuration("policy-a", kind, { kind: "com.apple.configuration.wifi" }, "hash-a"),
      ],
    });
    const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

    const items = await run(backend.getAppleDeclarationItems(appleScope));
    expect(items.configurations.some((item) => item.identifier.startsWith("policy-a:"))).toBe(
      false,
    );
  });
});

describe("Windows command delivery uses resolved policy", () => {
  it("sends only the winning policy for a duplicated kind", async () => {
    const kind = "mttx.windows.custom.wifi";
    const db = makeDb({
      [tableName(schema.organization)]: [organization("org-1")],
      [tableName(schema.device)]: [{ ...device("device-1", "win-1", "org-1"), proto: "win" }],
      [tableName(schema.enterpriseGroup)]: [
        { id: "group-1", organizationId: "org-1", name: "Engineering" },
      ],
      [tableName(schema.groupDevice)]: [{ groupId: "group-1", deviceId: "device-1" }],
      [tableName(schema.groupPolicy)]: [
        { groupId: "group-1", policyId: "low", mode: "include" },
        { groupId: "group-1", policyId: "high", mode: "include" },
      ],
      [tableName(schema.policy)]: [policy("low", "org-1", 1), policy("high", "org-1", 10)],
      [tableName(schema.configuration)]: [
        configuration(
          "low",
          kind,
          { omaUri: "./Vendor/MSFT/WiFi/Profile/Test", value: "low" },
          "hash-low",
        ),
        configuration(
          "high",
          kind,
          { omaUri: "./Vendor/MSFT/WiFi/Profile/Test", value: "high" },
          "hash-high",
        ),
      ],
    });
    const backend = makeWindowsBackend({
      db: db as any,
      origin,
      authSecret,
      windowsOrganizationId: "org-1",
    });

    const response = await run(
      backend.windowsManagementCheckin(
        { deviceId: "win-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "win-1",
          target: origin,
          statuses: [],
          alerts: [],
        },
      ),
    );
    const policyCommands = response.commands.filter((command) =>
      command.locURI?.includes("/WiFi/Profile/Test"),
    );

    expect(policyCommands).toHaveLength(1);
    expect(policyCommands[0]).toMatchObject({ kind: "Replace", data: "high" });
  });
});
