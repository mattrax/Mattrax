import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeCutoverArchive,
  encodeCutoverArchive,
  EnterpriseBadRequest,
  EnterpriseConflict,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const passphrase = "correct horse battery staple";

type AuthRequest = Request;

const makeContext = () => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: "usr_user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);

  const auth = {
    requireUser: (input: AuthRequest) =>
      input.headers.get("cookie")
        ? Effect.succeed({ user })
        : Effect.fail(new EnterpriseBadRequest({ message: "Unauthenticated" })),
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: these tests never reach R2.
    storage: {} as never,
    // SAFETY: the fake implements only the auth methods this service calls.
    auth: auth as never,
    authSecret: "cutover-test-secret",
  });

  return { db, service, user };
};

const seedTenant = async (context: ReturnType<typeof makeContext>) => {
  const tenant = await runEffect(
    context.service.createTenant(request(headers), {
      name: "Acme",
      slug: "acme",
      displayName: "Acme Corp",
    }),
  );

  const policy = await runEffect(
    context.service.createPolicy(request(headers), tenant.id, {
      name: "Baseline",
      notes: null,
    }),
  );

  const group = await runEffect(
    context.service.createGroup(request(headers), tenant.id, {
      name: "Staff",
      notes: null,
      policies: [policy.id],
    }),
  );

  return { tenant, policy, group };
};

const exportArchive = async (context: ReturnType<typeof makeContext>, tenantId: string) =>
  runEffect(
    context.service.exportTenantCutover(request(headers), tenantId, {
      passphrase,
      sections: { members: true, devices: false, scepCa: false, audit: true },
    }),
  );

// The service derives the archive key at the production work factor. One real
// export in setup gives us the same payload; encodeCutoverArchive's documented
// test-only override then reseals it at the minimum work factor the format
// accepts. The archive is read-only input, so every import and preview test can
// share it without sharing any database state.
const FAST_KDF_ITERATIONS = 10_000;
let fastArchive: string;
let realExport: Awaited<ReturnType<typeof exportArchive>>;

beforeAll(async () => {
  const context = makeContext();
  const { tenant } = await seedTenant(context);
  realExport = await exportArchive(context, tenant.id);
  const { payload } = await decodeCutoverArchive({ archive: realExport.body, passphrase });
  const resealed = await encodeCutoverArchive({
    payload,
    passphrase,
    iterations: FAST_KDF_ITERATIONS,
  });

  fastArchive = resealed.archive;
});

describe("cutover API", () => {
  it("exports an encrypted archive and previews it without writing", async () => {
    const context = makeContext();
    await seedTenant(context);

    expect(realExport.body).toContain('"format": "mattrax.cutover"');
    expect(realExport.body).not.toContain("correct horse battery staple");
    expect(realExport.counts.groups).toBe(1);

    const before = context.db.store.organization.length;

    const preview = await runEffect(
      context.service.previewTenantCutover(request(headers), {
        archive: fastArchive,
        passphrase,
        targetTenantId: null,
      }),
    );

    expect(preview.confirm).toBe("acme");
    expect(preview.counts.devices).toBe(0);
    expect(preview.requirements.allowCrossDeployment).toBe(false);
    expect(context.db.store.organization.length).toBe(before);
  });

  it("imports into a new tenant and reports the summary", async () => {
    const context = makeContext();
    const { tenant } = await seedTenant(context);

    const result = await runEffect(
      context.service.importTenantCutover(request(headers), {
        archive: fastArchive,
        passphrase,
        confirm: "acme",
        allowCrossDeployment: true,
      }),
    );

    expect(result.mode).toBe("new");
    // The source tenant still exists in this test deployment, so the slug is
    // made unique exactly like a plain import.
    expect(result.slug).toBe("acme-2");
    expect(result.imported.groups).toBe(1);
    expect(result.imported.policies).toBe(1);
    expect(result.tenantId).not.toBe(tenant.id);
  });

  it("rejects a wrong passphrase", async () => {
    const context = makeContext();

    await expect(
      runEffect(
        context.service.importTenantCutover(request(headers), {
          archive: fastArchive,
          passphrase: "wrong passphrase",
          confirm: "acme",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("rejects a missing confirmation", async () => {
    const context = makeContext();

    await expect(
      runEffect(
        context.service.importTenantCutover(request(headers), {
          archive: fastArchive,
          passphrase,
          confirm: "not-acme",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("reports the origin-switch preflight", async () => {
    const context = makeContext();
    const { tenant } = await seedTenant(context);

    const report = await runEffect(
      context.service.getTenantCutoverPreflight(request(headers), tenant.id, {
        origin: "https://new.example.test",
      }),
    );

    expect(report.currentOrigin).toBe(origin);
    expect(report.targetOrigin).toBe("https://new.example.test");
    expect(report.hostnameChanged).toBe(true);
    expect(report.items.length).toBeGreaterThan(0);
    expect(report.steps.length).toBeGreaterThan(0);
  });

  it("requires a verified account for import", async () => {
    const context = makeContext();

    const previous = context.user.emailVerified;
    context.user.emailVerified = false;

    await expect(
      runEffect(
        context.service.importTenantCutover(request(headers), {
          archive: fastArchive,
          passphrase,
          confirm: "acme",
        }),
      ),
    ).rejects.toBeDefined();

    context.user.emailVerified = previous;
  });

  it("reports an existing target's configuration as a required acknowledgement", async () => {
    const context = makeContext();
    const { tenant } = await seedTenant(context);

    const preview = await runEffect(
      context.service.previewTenantCutover(request(headers), {
        archive: fastArchive,
        passphrase,
        targetTenantId: tenant.id,
      }),
    );

    expect(preview.requirements.replaceConfiguration).toBe(true);
    expect(preview.conflicts.map((conflict) => conflict.kind)).toContain("configuration");

    await expect(
      runEffect(
        context.service.importTenantCutover(request(headers), {
          archive: fastArchive,
          passphrase,
          confirm: "acme",
          targetTenantId: tenant.id,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);
  });
});
