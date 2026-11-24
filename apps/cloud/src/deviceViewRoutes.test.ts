import { EnterpriseService } from "@mattrax/enterprise-domain";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { authenticateDeviceViewSync } from "./deviceViewRoutes.js";

const env = {
  ORIGIN: "https://app.example",
  TRUSTED_ORIGINS: undefined,
};

const request = (path: string) =>
  new Request("https://app.example" + path, {
    headers: { origin: "https://app.example" },
  });

const context = {
  account: { id: "account-a", email: "a@example.com" },
  organization: { id: "tenant-a" },
  permissions: new Set(["devices.read"]),
};

const service = (authorizeSync: ReturnType<typeof vi.fn>) =>
  ({ authorizeSync }) as EnterpriseService["Service"];

const run = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<A, E>);

describe("device view Sync authentication", () => {
  it("authenticates a personal source against its tenant, not the composite owner id", async () => {
    const authorizeSync = vi.fn(() => Effect.succeed(context));
    const identity = await run(
      authenticateDeviceViewSync(env, "personal")(
        request("/api/sync/device-views/personal/tenant-a%3Aaccount-a"),
        { id: "tenant-a:account-a" },
      ).pipe(Effect.provideService(EnterpriseService, service(authorizeSync))),
    );

    expect(authorizeSync).toHaveBeenCalledWith(expect.anything(), "tenant-a", "devices.read");
    expect(identity.principal).toMatchObject({
      tenantId: "tenant-a",
      accountId: "account-a",
    });
  });

  it("rejects a personal source owned by another account in the same tenant", async () => {
    const authorizeSync = vi.fn(() => Effect.succeed(context));
    const error = await run(
      authenticateDeviceViewSync(env, "personal")(
        request("/api/sync/device-views/personal/tenant-a%3Aaccount-b"),
        { id: "tenant-a:account-b" },
      ).pipe(Effect.provideService(EnterpriseService, service(authorizeSync)), Effect.flip),
    );

    expect(error.reason).toBe("Forbidden");
  });
});
