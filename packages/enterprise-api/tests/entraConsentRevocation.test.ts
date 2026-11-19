import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { AzureGraphConsentRequired } from "@mattrax/azure-graph";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const previousTenantId = "22222222-2222-2222-2222-222222222222";

type Revocation = {
  servicePrincipalId: string | null;
  grantsRemoved: number;
};

const makeContext = (
  options: {
    azureGraph?: {
      revokeDelegatedConsent: (
        tenantId: string,
      ) => Effect.Effect<Revocation, AzureGraphConsentRequired>;
    };
    /** Omit the SSO row to exercise the "never linked" path. */
    linkedTenantId?: string | null;
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
    // SAFETY: the fake only implements the Graph method this test exercises.
    azureGraph: options.azureGraph as any,
    azureClientId: "client-id",
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

describe("Entra consent revocation on unlink", () => {
  it("revokes delegated consent after the local unlink and records it", async () => {
    const revokeDelegatedConsent = vi.fn(() =>
      Effect.succeed<Revocation>({ servicePrincipalId: "sp-1", grantsRemoved: 2 }),
    );

    const { db, service, headers } = makeContext({
      // SAFETY: this test only reaches `revokeDelegatedConsent`; the fake omits
      // the rest of the Graph surface the service never calls here.
      azureGraph: { revokeDelegatedConsent } as any,
    });

    const result = await runEffect(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
    );

    expect(revokeDelegatedConsent).toHaveBeenCalledWith(previousTenantId);
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
    const { service, headers } = makeContext({
      // SAFETY: this test only reaches `revokeDelegatedConsent`; the fake omits
      // the rest of the Graph surface the service never calls here.
      azureGraph: {
        revokeDelegatedConsent: () =>
          Effect.succeed({ servicePrincipalId: null, grantsRemoved: 0 }),
      } as any,
    });

    const result = await runEffect(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
    );

    expect(result.consentRevocation).toEqual({ status: "revoked", grantsRemoved: 0 });
  });

  it("keeps the unlink when Graph fails and reports a short reason", async () => {
    const { db, service, headers } = makeContext({
      // SAFETY: this test only reaches `revokeDelegatedConsent`; the fake omits
      // the rest of the Graph surface the service never calls here.
      azureGraph: {
        revokeDelegatedConsent: () =>
          Effect.fail(
            new AzureGraphConsentRequired({
              message: "Microsoft Graph request to /oauth2PermissionGrants requires admin consent",
              status: 403,
            }),
          ),
      } as any,
    });

    const result = await runEffect(
      service.patchSsoConfig(request(headers), "org-1", {
        enabled: false,
        azureTenantId: null,
      }),
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

    const result = await runEffect(
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
    const revokeDelegatedConsent = vi.fn(() =>
      Effect.succeed<Revocation>({ servicePrincipalId: "sp-1", grantsRemoved: 1 }),
    );

    const { service, headers } = makeContext({
      // SAFETY: this test only asserts the fake is never called; it omits the
      // rest of the Graph surface, which the handler never reaches.
      azureGraph: { revokeDelegatedConsent } as any,
    });

    const result = await runEffect(
      service.patchSsoConfig(request(headers), "org-1", { autoProvision: false }),
    );

    expect(revokeDelegatedConsent).not.toHaveBeenCalled();
    expect(result.consentRevocation).toBeUndefined();
  });

  it("does not revoke consent when no Entra tenant was ever linked", async () => {
    const revokeDelegatedConsent = vi.fn(() =>
      Effect.succeed<Revocation>({ servicePrincipalId: null, grantsRemoved: 0 }),
    );

    const { service, headers } = makeContext({
      // SAFETY: this test only asserts the fake is never called; it omits the
      // rest of the Graph surface, which the handler never reaches.
      azureGraph: { revokeDelegatedConsent } as any,
      linkedTenantId: null,
    });

    const result = await runEffect(
      service.patchSsoConfig(request(headers), "org-1", { enabled: false }),
    );

    expect(revokeDelegatedConsent).not.toHaveBeenCalled();
    expect(result.consentRevocation).toBeUndefined();
  });
});
