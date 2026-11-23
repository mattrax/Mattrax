import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Option, Exit } from "effect";
import { Command } from "effect/cli";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "vitest";
import type { DeviceSearchQuery, TenantInfo } from "@mattrax/enterprise-domain/client";
import { cli } from "./cli.ts";
import type { MattraxApi } from "./client.ts";
import { CliOutput } from "./output.ts";
import { CliRuntime } from "./runtime.ts";
import type { ResolvedSettings, SettingsFlags } from "./settings.ts";

const settings: ResolvedSettings = {
  url: "https://mattrax.test",
  token: "mtx_test_token_123456",
  tenant: undefined,
  configPath: "/tmp/mattrax/config.json",
  sources: { url: "flag", token: "env", tenant: undefined },
};

const tenant: TenantInfo = {
  id: "tenant-1",
  name: "Acme",
  slug: "acme",
  role: "owner",
  roleName: "Owner",
  roleKind: "built-in",
  permissions: [],
};

const unused = () => Effect.die("not used by this test");

const fakeApi = (overrides: Partial<MattraxApi> = {}): MattraxApi => ({
  me: unused,
  listTenants: () => Effect.succeed({ tenants: [tenant] }),
  searchDevices: () => Effect.succeed({ devices: [], total: 0 }),
  listDevices: () => Effect.succeed({ rows: [] }),
  getDevice: unused,
  getDeviceHealth: unused,
  deviceAction: unused,
  deviceUnenroll: () => Effect.void,
  listGroups: () => Effect.succeed({ rows: [] }),
  getGroup: unused,
  createGroup: unused,
  patchGroup: () => Effect.void,
  patchGroupMembers: () => Effect.void,
  listPolicies: () => Effect.succeed({ rows: [] }),
  getPolicy: unused,
  createPolicy: unused,
  patchPolicy: () => Effect.void,
  getEnrollment: unused,
  ...overrides,
});

interface Capture {
  readonly lines: string[];
  readonly err: string[];
  flags?: SettingsFlags;
}

const runEffect = (args: ReadonlyArray<string>, api: MattraxApi, capture: Capture) => {
  const layer = Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(
      CliRuntime,
      CliRuntime.of({
        resolveSettings: (flags) =>
          Effect.sync(() => {
            capture.flags = flags;

            return settings;
          }),
        api: () => Effect.succeed(api),
      }),
    ),
    Layer.succeed(
      CliOutput,
      CliOutput.of({
        out: (text) => Effect.sync(() => capture.lines.push(text)),
        err: (text) => Effect.sync(() => capture.err.push(text)),
      }),
    ),
  );

  return Command.runWith(cli, { version: "test" })(args).pipe(Effect.provide(layer));
};

const run = async (args: ReadonlyArray<string>, api: MattraxApi, capture: Capture) =>
  Effect.runPromise(runEffect(args, api, capture));

describe("CLI argument parsing", () => {
  it("accepts global flags after the subcommand and forwards filters", async () => {
    let query: DeviceSearchQuery | undefined;
    const capture: Capture = { lines: [], err: [] };

    await run(
      ["devices", "list", "--json", "--tenant", "acme", "--q", "mac", "--limit", "5"],
      fakeApi({
        searchDevices: (tenantId, value) =>
          Effect.sync(() => {
            expect(tenantId).toBe("tenant-1");
            query = value;

            return { devices: [], total: 0 };
          }),
      }),
      capture,
    );

    expect(Option.getOrUndefined(capture.flags?.tenant ?? Option.none())).toBe("acme");
    expect(capture.flags?.json).toBe(true);
    expect(query).toEqual({
      q: "mac",
      status: undefined,
      proto: undefined,
      health: undefined,
      groupId: undefined,
      limit: 5,
      offset: 0,
    });
    expect(JSON.parse(capture.lines.join("\n"))).toEqual({
      devices: [],
      total: 0,
      limit: 5,
      offset: 0,
    });
  });

  it("decrypts a handover archive through the nested devices command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mattrax-cli-handover-"));
    const file = join(directory, "handover.json");
    const capture: Capture = { lines: [], err: [] };

    try {
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          kdf: {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations: 600000,
            salt: "FDBLTH8GFKKKV96LErlAxA==",
          },
          cipher: { name: "AES-GCM", iv: "TmbgporKfT9oXc4x" },
          ciphertext:
            "eLaH9yyGPJizYHlwXgvEa2I8Jx6pKlsUe2aMopY/8FCKwwepgplhFqDswBpysIFvHEcc0P56R5YgHyVTX/hI0++4yvIVOuGI4z8LeVc=",
        }),
      );

      await run(
        ["devices", "handover", "decrypt", file, "--passphrase", "mattrax-test-vector-passphrase"],
        fakeApi(),
        capture,
      );

      expect(JSON.parse(capture.lines.join("\n"))).toEqual({
        format: "mattrax.device-handover",
        version: 1,
        devices: [],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts global flags before the subcommand", async () => {
    const capture: Capture = { lines: [], err: [] };

    await run(["--json", "--tenant", "acme", "devices", "list"], fakeApi(), capture);

    expect(capture.flags?.json).toBe(true);
    expect(JSON.parse(capture.lines.join("\n")).total).toBe(0);
  });

  it("requires --yes for unenrollment", async () => {
    const capture: Capture = { lines: [], err: [] };

    const exit = await Effect.runPromise(
      Effect.exit(runEffect(["devices", "unenroll", "dev-1"], fakeApi(), capture)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(capture.lines).toEqual([]);
  });

  it("calls the unenroll endpoint when --yes is present", async () => {
    const capture: Capture = { lines: [], err: [] };
    let unenrolled: string | undefined;

    await run(
      ["devices", "unenroll", "dev-1", "--yes"],
      fakeApi({
        deviceUnenroll: (_tenantId, deviceId) =>
          Effect.sync(() => {
            unenrolled = deviceId;
          }),
      }),
      capture,
    );

    expect(unenrolled).toBe("dev-1");
    expect(capture.lines.join("\n")).toContain("Unenrolled dev-1");
  });
});
