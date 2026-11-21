import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { makeDb, tableName } from "./fake-db.js";
import type { Row } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const now = new Date("2026-11-11T10:00:00.000Z");

const MANAGEMENT_DECLARATION_ID = "F8C4C3A1-2B6E-4D7F-A9E5-3C8B7D9E2F4A";

const scope = (udid: string) => ({
  _tag: "device" as const,
  udid,
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin: new MdmOrigin({ url: origin }),
});

const setup = (organization: Row) => {
  const db = makeDb({
    [tableName(schema.organization)]: [
      {
        logo: null,
        metadata: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
        ...organization,
      },
    ],
    [tableName(schema.device)]: [
      {
        id: "device-1",
        organizationId: "org-1",
        proto: "apple",
        status: "enrolled",
        name: "Mac",
        enrolledAt: now,
        lastSeenAt: now,
        dmIdentifier: "udid-1",
        dmIdentityFingerprint: "fingerprint-1",
      },
    ],
  });

  // SAFETY: The fake store implements only the query chains these tests exercise.
  return ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });
};

describe("DDM management declaration branding", () => {
  it("uses the tenant display name and support email", async () => {
    const backend = setup({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      displayName: "Acme Corp",
      supportEmail: "help@acme.test",
    });

    const declaration = await Effect.runPromise(
      backend.getAppleDeclaration(scope("udid-1"), "management", MANAGEMENT_DECLARATION_ID),
    );

    expect(declaration).toMatchObject({
      Type: "com.apple.management.organization-info",
      Identifier: MANAGEMENT_DECLARATION_ID,
      Payload: {
        Email: "help@acme.test",
        Name: "Acme Corp",
        URL: origin,
      },
    });
  });

  it("falls back to Mattrax defaults for an unconfigured tenant", async () => {
    const backend = setup({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      displayName: null,
      supportEmail: null,
    });

    const declaration = await Effect.runPromise(
      backend.getAppleDeclaration(scope("udid-1"), "management", MANAGEMENT_DECLARATION_ID),
    );

    expect(declaration).toMatchObject({
      Payload: {
        Email: "hello@mattrax.app",
        Name: "Acme",
        URL: origin,
      },
    });
  });

  it("does not leak another tenant's branding", async () => {
    const backend = setup({
      id: "org-1",
      name: "First",
      slug: "first",
      displayName: "First Brand",
      supportEmail: "first@example.test",
    });

    // The device identity certificate scopes every lookup to org-1, so a
    // mismatched tenant must surface as an unknown device instead of falling
    // back to another tenant's branding.
    await expect(
      Effect.runPromise(
        backend.getAppleDeclaration(
          {
            ...scope("udid-1"),
            identityCertificate: "CN=Device,OU=org-2",
          },
          "management",
          MANAGEMENT_DECLARATION_ID,
        ),
      ),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });
  });
});
