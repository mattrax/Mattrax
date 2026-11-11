import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createEnterpriseService } from "../src/enterpriseHandlers.js";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const makeContext = () => {
  const db = makeDb();
  const now = new Date();
  db.store.user.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    totpEnabled: true,
    createdAt: now,
    updatedAt: now,
  });
  db.store.organization.push({
    id: "org-1",
    name: "Acme",
    slug: "acme",
    createdAt: now,
    updatedAt: now,
  });
  db.store.member.push({
    id: "member-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: () =>
      Effect.succeed({
        user: db.store.user[0],
      }),
  };

  const service = createEnterpriseService({
    db: db as any,
    schema,
    origin,
    storage: {} as any,
    auth: auth as any,
    authSecret: "enterprise-test-secret",
    azureGraph: {
      domains: () => Effect.succeed([]),
      usersDelta: () => Effect.succeed({ items: [], nextLink: null, deltaLink: null }),
      groupsDelta: () => Effect.succeed({ items: [], nextLink: null, deltaLink: null }),
      consentUrl: () => "https://consent.test",
    } as any,
    azureClientId: "client-id",
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

describe("Entra directory schedule settings", () => {
  it("defaults the schedule to off and reports the next run", async () => {
    const { service, headers } = makeContext();

    const initial = await runEffect(service.getEntraDirectorySync(request(headers), "org-1"));
    expect(initial).toMatchObject({
      enabled: false,
      syncIntervalMinutes: 0,
      nextSyncAt: null,
      lastRunTrigger: null,
    });

    await runEffect(
      service.patchEntraDirectorySync(request(headers), "org-1", { syncIntervalMinutes: 1440 }),
    );

    const updated = await runEffect(service.getEntraDirectorySync(request(headers), "org-1"));
    expect(updated.syncIntervalMinutes).toBe(1440);
    expect(updated.nextSyncAt).toBeTruthy();
    expect(new Date(updated.nextSyncAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("clears the next run when the interval is set back to zero", async () => {
    const { db, service, headers } = makeContext();

    await runEffect(
      service.patchEntraDirectorySync(request(headers), "org-1", { syncIntervalMinutes: 60 }),
    );
    expect(db.store.entra_directory_sync[0].nextSyncAt).toBeInstanceOf(Date);

    await runEffect(
      service.patchEntraDirectorySync(request(headers), "org-1", { syncIntervalMinutes: 0 }),
    );
    expect(db.store.entra_directory_sync[0]).toMatchObject({
      syncIntervalMinutes: 0,
      nextSyncAt: null,
    });
  });

  it("keeps an existing next run when only `enabled` changes", async () => {
    const { db, service, headers } = makeContext();

    await runEffect(
      service.patchEntraDirectorySync(request(headers), "org-1", { syncIntervalMinutes: 60 }),
    );
    const scheduledAt = db.store.entra_directory_sync[0].nextSyncAt;

    await runEffect(service.patchEntraDirectorySync(request(headers), "org-1", { enabled: true }));
    expect(db.store.entra_directory_sync[0].nextSyncAt.getTime()).toBe(scheduledAt.getTime());
    expect(db.store.entra_directory_sync[0].enabled).toBe(true);
  });

  it("rejects intervals that are not whole non-negative minutes", async () => {
    const { service, headers } = makeContext();

    for (const value of [-5, 1.5, 525_601]) {
      await expect(
        runEffect(
          service.patchEntraDirectorySync(request(headers), "org-1", {
            syncIntervalMinutes: value,
          }),
        ),
      ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
    }
  });
});
