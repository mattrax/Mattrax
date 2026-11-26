import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseBadRequest, EnterpriseConflict } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { openSecret } from "@mattrax/crypto";
import { makeDb, request, runEffect, schema } from "./helpers.js";
import {
  TEST_PFX_2_BASE64,
  TEST_PFX_2_CERTIFICATE_PEM,
  TEST_PFX_2_PASSWORD,
  TEST_PFX_BASE64,
  TEST_PFX_CERTIFICATE_PEM,
  TEST_PFX_PASSWORD,
} from "./pfxFixture.js";

const origin = "https://enterprise.test";
const headers = { cookie: "mattrax_session=test" };
const authSecret = "policy-certificate-test-secret";

const makeContext = () => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);

  const stepUps: string[] = [];
  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return inputHeaders.cookie
        ? Effect.succeed({ user })
        : Effect.fail(new Error("unauthenticated"));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: (_request: unknown, action: string) => {
      stepUps.push(action);

      return Effect.void;
    },
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
  });

  return { db, service, user, stepUps };
};

const makeTenant = (context: ReturnType<typeof makeContext>) =>
  runEffect(
    context.service.createTenant(request(headers), {
      name: "Acme",
      slug: "acme",
    }),
  );

const pfxConfiguration = (password = TEST_PFX_PASSWORD) => ({
  pfx: TEST_PFX_BASE64,
  password,
  certificatePem: TEST_PFX_CERTIFICATE_PEM,
  fileName: "person.pfx",
  keyLocation: "tpm-preferred",
  exportable: false,
});

describe("policy certificate material", () => {
  it("stores the PFX sealed and never returns it in the configuration", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const input = pfxConfiguration();

    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "S/MIME",
        configurations: {
          "mttx.apple.pfx.smime": input,
        },
      }),
    );

    const configuration = context.db.store.configuration.find(
      (row) => row.policyId === created.id,
    );
    const stored = structuredClone(configuration?.data ?? {});

    expect(stored).not.toHaveProperty("pfx");
    expect(stored).not.toHaveProperty("password");
    expect(stored.materialSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.certificatePem).toContain("BEGIN CERTIFICATE");
    expect(stored.subject).toBe("person@example.com");
    expect(stored.notAfter).toEqual(expect.any(String));
    expect(context.stepUps).toContain("certificate-upload");

    const material = context.db.store.policy_certificate_material.find(
      (row) => row.policyId === created.id,
    );

    expect(material?.sealedPfx).not.toContain(input.pfx);
    expect(await openSecret(authSecret, material?.sealedPfx as string)).toBe(input.pfx);
    expect(await openSecret(authSecret, material?.sealedPassword as string)).toBe("pfx-secret");
  });

  it("replaces the sealed material and leaves the configuration metadata in sync", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "Wi-Fi",
        configurations: { "mttx.apple.pfx.wifi": pfxConfiguration() },
      }),
    );

    const replacement = {
      ...pfxConfiguration(TEST_PFX_2_PASSWORD),
      pfx: TEST_PFX_2_BASE64,
      certificatePem: TEST_PFX_2_CERTIFICATE_PEM,
    };

    await runEffect(
      context.service.patchPolicy(request(headers), tenant.id, created.id, {
        configurations: { "mttx.apple.pfx.wifi": replacement },
      }),
    );

    const material = context.db.store.policy_certificate_material.find(
      (row) => row.policyId === created.id,
    );

    expect(await openSecret(authSecret, material?.sealedPfx as string)).toBe(replacement.pfx);
    expect(await openSecret(authSecret, material?.sealedPassword as string)).toBe(
      TEST_PFX_2_PASSWORD,
    );
    expect(context.db.store.policy_certificate_material).toHaveLength(1);

    // A metadata-only edit keeps the stored material and ignores client-supplied
    // subject/fingerprint, so the configuration cannot claim a different cert.
    const current = context.db.store.configuration.find(
      (row) => row.policyId === created.id,
    )!.data as Schema.JsonObject;

    await runEffect(
      context.service.patchPolicy(request(headers), tenant.id, created.id, {
        configurations: {
          "mttx.apple.pfx.wifi": {
            ...current,
            subject: "attacker.example",
            fingerprintSha256: "f".repeat(64),
          },
        },
      }),
    );

    const updated = context.db.store.configuration.find(
      (row) => row.policyId === created.id,
    )!.data as Schema.JsonObject;

    expect(updated.subject).not.toBe("attacker.example");
    expect(updated.fingerprintSha256).toBe(current.fingerprintSha256);
  });

  it("rejects a wrong PFX password and a leaf certificate outside the PFX", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const wrongPassword = await runEffect(
      context.service
        .createPolicy(request(headers), tenant.id, {
          name: "Bad password",
          configurations: {
            "mttx.apple.pfx.wifi": { ...pfxConfiguration(), password: "wrong" },
          },
        })
        .pipe(Effect.flip),
    );

    expect(wrongPassword).toBeInstanceOf(EnterpriseBadRequest);
    expect((wrongPassword as EnterpriseBadRequest).message).toContain(
      "PFX password is wrong",
    );

    const mismatched = await runEffect(
      context.service
        .createPolicy(request(headers), tenant.id, {
          name: "Wrong leaf",
          configurations: {
            "mttx.apple.pfx.wifi": {
              ...pfxConfiguration(),
              certificatePem: TEST_PFX_CERTIFICATE_PEM.replace("MIIC", "MIIZ"),
            },
          },
        })
        .pipe(Effect.flip),
    );

    expect(mismatched).toBeInstanceOf(EnterpriseBadRequest);
    expect((mismatched as EnterpriseBadRequest).message).toBeDefined();
    expect(context.db.store.policy).toHaveLength(0);
  });

  it("copies sealed material when a policy is duplicated", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "Original",
        configurations: { "mttx.apple.pfx.smime": pfxConfiguration() },
      }),
    );

    const duplicate = await runEffect(
      context.service.duplicatePolicy(request(headers), tenant.id, created.id, {
        name: "Copy",
      }),
    );

    const copied = context.db.store.policy_certificate_material.find(
      (row) => row.policyId === duplicate.id,
    );

    expect(copied).toBeDefined();
    expect(await openSecret(authSecret, copied?.sealedPfx as string)).toBe(
      pfxConfiguration().pfx,
    );
  });

  it("refuses a rollback that would pair old metadata with different material", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "Rollback",
        configurations: { "mttx.apple.pfx.smime": pfxConfiguration() },
      }),
    );
    const deployment = context.db.store.policy_deployment.find(
      (row) => row.policyId === created.id,
    );
    const material = context.db.store.policy_certificate_material.find(
      (row) => row.policyId === created.id,
    );

    expect(deployment).toBeDefined();
    material!.materialSha256 = "f".repeat(64);

    const result = await runEffect(
      context.service
        .rollbackPolicy(request(headers), tenant.id, created.id, deployment!.id as string)
        .pipe(Effect.flip),
    );

    expect(result).toBeInstanceOf(EnterpriseConflict);
    expect((result as EnterpriseConflict).message).toContain("certificate material has changed");
  });

  it("refuses to store a new identity configuration without material", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const result = await runEffect(
      context.service
        .createPolicy(request(headers), tenant.id, {
          name: "No material",
          configurations: {
            "mttx.apple.pfx.smime": {
              certificatePem: TEST_PFX_CERTIFICATE_PEM,
              subject: "person@example.com",
              notAfter: "2027-01-01T00:00:00.000Z",
              fingerprintSha256: "a".repeat(64),
              materialSha256: "b".repeat(64),
            },
          },
        })
        .pipe(Effect.flip),
    );

    expect(result).toBeInstanceOf(EnterpriseBadRequest);
    expect((result as EnterpriseBadRequest).message).toContain("has no certificate material");
    expect(context.db.store.policy).toHaveLength(0);
  });

  it("rejects Android client certificates with an explanation", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const result = await runEffect(
      context.service
        .createPolicy(request(headers), tenant.id, {
          name: "Android",
          configurations: { "mttx.android.pfx.wifi": pfxConfiguration() },
        })
        .pipe(Effect.flip),
    );

    expect(result).toBeInstanceOf(EnterpriseBadRequest);
    expect((result as EnterpriseBadRequest).message).toContain(
      "Android Management API cannot install client certificates",
    );
    expect(context.db.store.policy).toHaveLength(0);
  });

  it("rejects a mail profile that references a certificate outside the policy", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const result = await runEffect(
      context.service
        .createPolicy(request(headers), tenant.id, {
          name: "Mail",
          configurations: {
            "mttx.apple.mail.work": {
              incoming: {
                serverType: "IMAP",
                hostName: "imap.example.com",
                authenticationMethod: "None",
              },
              outgoing: { hostName: "smtp.example.com", authenticationMethod: "None" },
              smime: {
                signing: { enabled: true, certificateKind: "mttx.apple.pfx.missing" },
              },
            },
          },
        })
        .pipe(Effect.flip),
    );

    expect(result).toBeInstanceOf(EnterpriseBadRequest);
    expect((result as EnterpriseBadRequest).message).toContain("not part of this policy");
  });
});
