import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  AzureGraphConsentRequired,
  type AutopilotDeploymentProfileInput,
  type AzureGraphService,
  type GraphAutopilotDevice,
  type ImportAutopilotDeviceIdentity,
} from "@mattrax/azure-graph";
import {
  AutopilotError,
  createAutopilotProfile,
  importAutopilotDevices,
  listAutopilotProfiles,
  parseAutopilotCsv,
  syncAutopilotDevices,
  validateAutopilotProfileInput,
} from "../src/Autopilot/autopilot.ts";
import { makeDb } from "./helpers.js";

const organizationId = "org-1";

const azureTenantId = "11111111-1111-1111-1111-111111111111";

const device = (overrides: Partial<GraphAutopilotDevice> = {}): GraphAutopilotDevice => ({
  id: "autopilot-1",
  serialNumber: "ABC123",
  groupTag: "Engineering",
  model: "Surface Laptop",
  manufacturer: "Microsoft",
  enrollmentState: "notEnrolled",
  profileStatus: "assigned",
  ...overrides,
});

type GraphCalls = {
  imports: Array<{ tenantId: string; devices: ReadonlyArray<ImportAutopilotDeviceIdentity> }>;
  lists: string[];
  profiles: AutopilotDeploymentProfileInput[];
  assignments: Array<{ tenantId: string; profileId: string; groupId: string }>;
};

/** Build a Graph double from the methods the case under test reaches. */
const asGraphService = (mock: Partial<AzureGraphService>): AzureGraphService =>
  // SAFETY: the mock is deliberately partial; only the stubbed methods are
  // called by the code under test.
  mock as AzureGraphService;

const graphMock = (
  options: {
    imported?: ReadonlyArray<GraphAutopilotDevice>;
    pages?: ReadonlyArray<ReadonlyArray<GraphAutopilotDevice>>;
  } = {},
) => {
  const calls: GraphCalls = { imports: [], lists: [], profiles: [], assignments: [] };
  const pages = options.pages ?? [[device()]];

  const graph = asGraphService({
    importAutopilotDevices: (
      tenantId: string,
      devices: ReadonlyArray<ImportAutopilotDeviceIdentity>,
    ) =>
      Effect.sync(() => {
        calls.imports.push({ tenantId, devices });

        return (
          options.imported ?? devices.map((item) => device({ serialNumber: item.serialNumber }))
        );
      }),
    listAutopilotDevices: (tenantId: string, link?: string) =>
      Effect.sync(() => {
        calls.lists.push(tenantId);
        const index = link ? Number(new URL(link).searchParams.get("page") ?? 0) : 0;
        const items = pages[index] ?? [];

        return {
          items,
          nextLink: index + 1 < pages.length ? `https://graph.test/next?page=${index + 1}` : null,
        };
      }),
    createAutopilotProfile: (tenantId: string, input: AutopilotDeploymentProfileInput) =>
      Effect.sync(() => {
        calls.profiles.push(input);

        return {
          id: "graph-profile-1",
          displayName: input.displayName,
          description: input.description,
          deploymentMode: input.deploymentMode,
          joinType: input.joinType,
          deviceNameTemplate: input.deviceNameTemplate,
          locale: input.locale,
          enableDevicePreparation: input.enableDevicePreparation ?? false,
        };
      }),
    assignAutopilotProfile: (tenantId: string, profileId: string, groupId: string) =>
      Effect.sync(() => {
        calls.assignments.push({ tenantId, profileId, groupId });
      }),
  });

  return { graph, calls };
};

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

describe("Autopilot CSV parsing", () => {
  it("accepts the Intune header and normalises serials and hashes", () => {
    const result = parseAutopilotCsv(
      [
        "Device Serial Number,Hardware Hash,Group Tag",
        '"abc123","aGFzaA== ","Engineering"',
        "DEF456,aGFzaDI=,",
      ].join("\n"),
    );

    expect(result.rows).toEqual([
      { serial: "ABC123", hardwareHash: "aGFzaA==", groupTag: "Engineering" },
      { serial: "DEF456", hardwareHash: "aGFzaDI=" },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("accepts headerless serial,hash pairs and reports bad rows", () => {
    const result = parseAutopilotCsv(
      ["ABC123,aGFzaA==", "BAD", "ABC123,aGFzaA==", "DEF456,not a hash!"].join("\n"),
    );

    expect(result.rows).toEqual([{ serial: "ABC123", hardwareHash: "aGFzaA==" }]);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("missing hardware hash");
    expect(result.errors[1]).toContain("not valid base64");
  });

  it("caps the number of rows and reports truncation", () => {
    const result = parseAutopilotCsv(["A1,aGFzaA==", "A2,aGFzaDI=", "A3,aGFzaDM="].join("\n"), {
      maxRows: 2,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("handles quoted commas and escaped quotes in serials", () => {
    const result = parseAutopilotCsv('"SER,IAL","aGFzaA=="\n"QUOTE""D","aGFzaDI="');
    expect(result.rows[0]?.serial).toBe("SER,IAL");
    expect(result.rows[1]?.serial).toBe('QUOTE"D');
  });
});

describe("Autopilot profile validation", () => {
  it("accepts a valid user-driven profile", () => {
    const result = validateAutopilotProfileInput({
      name: "Standard",
      deploymentMode: "userDriven",
      joinType: "azureADJoin",
      deviceNameTemplate: "DESKTOP-%SERIAL%",
      locale: "en-US",
      timezone: "Australia/Sydney",
      assignedGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;
    expect(result.value).toMatchObject({
      name: "Standard",
      enableDevicePreparation: false,
      assignedGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("rejects hybrid join outside user-driven mode", () => {
    expect(
      validateAutopilotProfileInput({
        name: "Hybrid",
        deploymentMode: "selfDeploying",
        joinType: "hybridAzureADJoin",
      }),
    ).toMatchObject({ ok: false });
  });

  it("requires device preparation for pre-provisioning", () => {
    expect(
      validateAutopilotProfileInput({
        name: "White glove",
        deploymentMode: "preProvisioned",
        joinType: "azureADJoinUsingDeviceAuth",
        enableDevicePreparation: false,
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects malformed group ids and locales", () => {
    expect(
      validateAutopilotProfileInput({ name: "Bad group", assignedGroupId: "group-1" }),
    ).toMatchObject({ ok: false });
    expect(validateAutopilotProfileInput({ name: "Bad locale", locale: "EN_us" })).toMatchObject({
      ok: false,
    });
  });
});

describe("Autopilot Graph mirroring", () => {
  it("imports hashes through Graph and stores tenant-scoped rows", async () => {
    const db = makeDb();

    const { graph, calls } = graphMock({
      imported: [device({ id: "graph-1", serialNumber: "ABC123" })],
    });

    const now = new Date("2026-01-01T00:00:00Z");

    const result = await run(
      importAutopilotDevices({
        db,
        graph,
        organizationId,
        azureTenantId,
        rows: [{ serial: "ABC123", hardwareHash: "aGFzaA==", groupTag: "Engineering" }],
        now,
      }),
    );

    expect(result.imported).toBe(1);
    expect(calls.imports).toHaveLength(1);
    expect(calls.imports[0]!.tenantId).toBe(azureTenantId);
    expect(calls.imports[0]!.devices[0]).toMatchObject({
      serialNumber: "ABC123",
      hardwareIdentifier: "aGFzaA==",
      groupTag: "Engineering",
    });
    const rows = db.store["autopilot_device"] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId,
      serial: "ABC123",
      hardwareHash: "aGFzaA==",
      profileStatus: "assigned",
      enrollmentState: "notEnrolled",
    });
  });

  it("links synced Graph devices to the matching tenant device by serial", async () => {
    const db = makeDb({
      ["device"]: [
        {
          id: "device-1",
          organizationId,
          serial: "abc123",
          proto: "win",
          status: "enrolled",
          name: "DESKTOP-1",
          enrolledAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "device-other-tenant",
          organizationId: "org-2",
          serial: "ABC123",
          proto: "win",
          status: "enrolled",
          name: "OTHER",
          enrolledAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const { graph, calls } = graphMock({
      pages: [
        [device({ id: "graph-1", serialNumber: "ABC123" })],
        [device({ id: "graph-2", serialNumber: "DEF456", groupTag: undefined })],
      ],
    });

    const result = await run(syncAutopilotDevices({ db, graph, organizationId, azureTenantId }));

    expect(result).toEqual({ synced: 2, linked: 1, pages: 2 });
    expect(calls.lists).toEqual([azureTenantId, azureTenantId]);
    const rows = db.store["autopilot_device"] ?? [];
    expect(rows.find((row) => row.serial === "ABC123")?.deviceId).toBe("device-1");
    expect(rows.find((row) => row.serial === "DEF456")?.deviceId).toBeNull();
  });

  it("creates a profile and applies its group assignment through Graph", async () => {
    const db = makeDb();
    const { graph, calls } = graphMock();

    const profile = await run(
      createAutopilotProfile({
        db,
        graph,
        organizationId,
        azureTenantId,
        values: {
          name: "Standard",
          deploymentMode: "userDriven",
          joinType: "azureADJoin",
          enableDevicePreparation: false,
          assignedGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      }),
    );

    expect(profile).toMatchObject({
      organizationId,
      name: "Standard",
      graphProfileId: "graph-profile-1",
      status: "active",
    });
    expect(calls.profiles).toHaveLength(1);
    expect(calls.assignments).toEqual([
      {
        tenantId: azureTenantId,
        profileId: "graph-profile-1",
        groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ]);
  });

  it("fails closed before writing when Graph rejects the import", async () => {
    const db = makeDb();

    const graph = asGraphService({
      importAutopilotDevices: () =>
        Effect.fail(
          new AzureGraphConsentRequired({ message: "requires admin consent", status: 403 }),
        ),
    });

    const failure = run(
      importAutopilotDevices({
        db,
        graph,
        organizationId,
        azureTenantId,
        rows: [{ serial: "ABC123", hardwareHash: "aGFzaA==" }],
      }),
    );

    await expect(failure).rejects.toBeInstanceOf(AutopilotError);
    await expect(failure).rejects.toMatchObject({ reason: "graph" });
    expect(db.store["autopilot_device"] ?? []).toHaveLength(0);
  });

  it("lists profiles only for the requested tenant", async () => {
    const db = makeDb({
      ["autopilot_profile"]: [
        {
          id: "profile-1",
          organizationId,
          name: "Standard",
          deploymentMode: "userDriven",
          joinType: "azureADJoin",
          enableDevicePreparation: false,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "profile-2",
          organizationId: "org-2",
          name: "Other",
          deploymentMode: "userDriven",
          joinType: "azureADJoin",
          enableDevicePreparation: false,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const rows = await run(listAutopilotProfiles(db, organizationId));
    expect(rows.map((row) => row.id)).toEqual(["profile-1"]);
  });
});
