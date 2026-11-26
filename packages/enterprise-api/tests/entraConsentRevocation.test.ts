import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  AzureGraph,
  AzureGraphConsentRequired,
  AzureGraphConsentRevocationFailed,
} from "@mattrax/azure-graph";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const previousTenantId = "22222222-2222-2222-2222-222222222222";

type Revocation = {
  servicePrincipalId: string | null;
  grantsRemoved: number;
};

type RevocationEffect = Effect.Effect<
  Revocation,
  AzureGraphConsentRequired | AzureGraphConsentRevocationFailed
>;

/** Fake Graph port with recorded calls, provided through the Effect context. */
const revokingGraph = (result: RevocationEffect) => {
  const calls: Array<string> = [];
  // SAFETY: these tests only reach revokeDelegatedConsent; the fake omits the
  // rest of the Graph surface, which the handler never calls here.
  const graph = AzureGraph.of({
    revokeDelegatedConsent: (tenantId: string) => {
      calls.push(tenantId);

      return result;
    },
  } as never);

  return { calls, graph };
};

const withGraph = <A, E>(effect: Effect.Effect<A, E>, graph?: AzureGraph["Service"]) =>
  Effect.runPromise(graph ? Effect.provideService(effect, AzureGraph, graph) : effect);

const makeContext = (
  options: {
    /** Omit the SSO row to exercise the "never linked" path. */
    linkedTenantId?: string | null;
    /** Skip the sync row that proves the link worked. */
    verified?: boolean;
    timeoutMs?: number;
  } = {},
) => {
  const db = makeDb();
  const now = new Date();

  db.store.account.push({
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
    requireMfa: false,
    createdAt: now,
    updatedAt: now,
  });
  db.store.member.push({
    id: "member-1",
    organizationId: "org-1",
    accountId: "user-1",
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });

  const linkedTenantId =
    options.linkedTenantId === undefined ? previousTenantId : options.linkedTenantId;

  if (linkedTenantId)
    db.store.sso_config.push({
      organizationId: "org-1",
      enabled: true,
      azureTenantId: linkedTenantId,
      autoProvision: true,
      requireMfa: false,
      createdAt: now,
      updatedAt: now,
    });

  if (linkedTenantId && options.verified !== false)
    db.store.entra_directory_sync.push({
      organizationId: "org-1",
      enabled: true,
      status: "idle",
      lastSyncedAt: now,
      domainsSyncedAt: null,
      syncIntervalMinutes: 0,
      createdAt: now,
      updatedAt: now,
    });

  const auth = {
    requireUser: () => Effect.succeed({ user: db.store.account[0] }),
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods this test exercises.
    auth: auth as any,
    authSecret: "enterprise-test-secret",
    azureClientId: "client-id",
    entraConsentRevocationTimeoutMs: options.timeoutMs,
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

describe("Entra consent revocation on unlink", () => {
  it("revokes delegated consent after the local unlink and records it", async () => {
    const { calls, graph } = revokingGraph(
      Effect.succeed<Revocation>({ servicePrincipalId: "sp-1", grantsRemoved: 2 }),
    );

    const { db, service, headers } = makeContext();

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
      graph,
    );

    expect(calls).toEqual([previousTenantId]);
    expect(result).toMatchObject({
      enabled: false,
      azureTenantId: null,
      consentRevocation: { status: "revoked", grantsRemoved: 2 },
    });
    expect(db.store.sso_config[0]).toMatchObject({ enabled: false, azureTenantId: null });

    const audit = db.store.audit_log.find((entry) => entry.action === "sso.consent_revoked");
    expect(audit?.metadata).toMatchObject({
      azureTenantId: previousTenantId,
      result: "revoked",
      grantsRemoved: 2,
      servicePrincipalFound: true,
    });
    expect(JSON.stringify(audit)).not.toContain("token");
  });

  it("treats consent that was already removed as a successful revocation", async () => {
    const { graph } = revokingGraph(Effect.succeed({ servicePrincipalId: null, grantsRemoved: 0 }));
    const { service, headers } = makeContext();

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
      graph,
    );

    expect(result.consentRevocation).toEqual({ status: "revoked", grantsRemoved: 0 });
  });

  it("keeps the unlink when Graph fails and reports a short reason", async () => {
    const { graph } = revokingGraph(
      Effect.fail(
        new AzureGraphConsentRequired({
          message: "Microsoft Graph request to /oauth2PermissionGrants requires admin consent",
          status: 403,
        }),
      ),
    );
    const { db, service, headers } = makeContext();

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
      graph,
    );

    expect(db.store.sso_config[0]).toMatchObject({ enabled: false, azureTenantId: null });
    expect(result).toMatchObject({
      azureTenantId: null,
      consentRevocation: {
        status: "failed",
        reason: "Microsoft Graph request to /oauth2PermissionGrants requires admin consent",
      },
    });

    const audit = db.store.audit_log.find(
      (entry) => entry.action === "sso.consent_revocation_failed",
    );

    expect(audit?.metadata).toMatchObject({
      azureTenantId: previousTenantId,
      result: "failed",
      httpStatus: 403,
      message: "Microsoft Graph request to /oauth2PermissionGrants requires admin consent",
    });
  });

  it("skips revocation when no Graph credentials are configured", async () => {
    const { db, service, headers } = makeContext();

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
    );

    expect(db.store.sso_config[0]).toMatchObject({ enabled: false, azureTenantId: null });
    expect(result.consentRevocation).toEqual({
      status: "skipped",
      reason: "Microsoft Graph credentials are not configured.",
    });

    const audit = db.store.audit_log.find(
      (entry) => entry.action === "sso.consent_revocation_skipped",
    );

    expect(audit?.metadata).toMatchObject({ azureTenantId: previousTenantId, result: "skipped" });
  });

  it("does not touch consent when the linked tenant is unchanged", async () => {
    const { calls, graph } = revokingGraph(
      Effect.succeed<Revocation>({ servicePrincipalId: "sp-1", grantsRemoved: 1 }),
    );

    const { service, headers } = makeContext();

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", { autoProvision: false }),
      graph,
    );

    expect(calls).toEqual([]);
    expect(result.consentRevocation).toBeUndefined();
  });

  it("does not revoke consent when no Entra tenant was ever linked", async () => {
    const { calls, graph } = revokingGraph(
      Effect.succeed<Revocation>({ servicePrincipalId: null, grantsRemoved: 0 }),
    );

    const { service, headers } = makeContext({ linkedTenantId: null });

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", { enabled: false }),
      graph,
    );

    expect(calls).toEqual([]);
    expect(result.consentRevocation).toBeUndefined();
  });

  it("skips revocation when the link was never verified", async () => {
    const { calls, graph } = revokingGraph(
      Effect.succeed<Revocation>({ servicePrincipalId: "sp-1", grantsRemoved: 1 }),
    );

    const { db, service, headers } = makeContext({ verified: false });

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
      graph,
    );

    expect(calls).toEqual([]);
    expect(db.store.sso_config[0]).toMatchObject({ enabled: false, azureTenantId: null });
    expect(result.consentRevocation).toEqual({
      status: "skipped",
      reason: "The Entra link was never verified by a successful sync or sign-in.",
    });

    const audit = db.store.audit_log.find(
      (entry) => entry.action === "sso.consent_revocation_skipped",
    );

    expect(audit?.metadata).toMatchObject({
      azureTenantId: previousTenantId,
      result: "skipped",
      reason: "The Entra link was never verified by a successful sync or sign-in.",
    });
  });

  it("does not revoke consent when only the tenant-id casing changes", async () => {
    const { calls, graph } = revokingGraph(
      Effect.succeed<Revocation>({ servicePrincipalId: "sp-1", grantsRemoved: 1 }),
    );

    const { db, service, headers } = makeContext();

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        azureTenantId: previousTenantId.toUpperCase(),
      }),
      graph,
    );

    expect(calls).toEqual([]);
    expect(result.consentRevocation).toBeUndefined();
    expect(result.azureTenantId).toBe(previousTenantId);
    expect(db.store.sso_config[0].azureTenantId).toBe(previousTenantId);
  });

  it("times out Graph and still returns the committed unlink", async () => {
    const { graph } = revokingGraph(Effect.never);
    const { db, service, headers } = makeContext({ timeoutMs: 20 });

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
      graph,
    );

    expect(db.store.sso_config[0]).toMatchObject({ enabled: false, azureTenantId: null });
    expect(result.consentRevocation).toEqual({
      status: "failed",
      reason: "Microsoft Graph did not respond in time.",
      grantsRemoved: 0,
    });
  });

  it("reports grants already removed when a later delete fails", async () => {
    const { graph } = revokingGraph(
      Effect.fail(
        new AzureGraphConsentRevocationFailed({
          message: "Failed to remove delegated consent after 3 grants: HTTP 500",
          servicePrincipalId: "sp-1",
          grantsRemoved: 3,
          phase: "delete",
          resourceId: "grant-4",
          status: 500,
        }),
      ),
    );
    const { db, service, headers } = makeContext();

    const result = await withGraph(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
      graph,
    );

    expect(result.consentRevocation).toMatchObject({
      status: "failed",
      grantsRemoved: 3,
    });

    const audit = db.store.audit_log.find(
      (entry) => entry.action === "sso.consent_revocation_failed",
    );

    expect(audit?.metadata).toMatchObject({
      result: "failed",
      httpStatus: 500,
      grantsRemoved: 3,
    });
  });
});
