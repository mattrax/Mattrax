import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

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
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "policy-import-test-secret",
  });

  return { db, service, user };
};

const makeTenant = (context: ReturnType<typeof makeContext>, slug: string) =>
  runEffect(
    context.service.createTenant(request(headers), {
      name: slug === "acme" ? "Acme" : "Globex",
      slug,
    }),
  );

const mobileconfig = (xml: string) => Buffer.from(xml, "utf8").toString("base64");

const restrictionsXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadIdentifier</key>
  <string>com.example.restrictions</string>
  <key>PayloadDisplayName</key>
  <string>Restrictions</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.applicationaccess</string>
      <key>PayloadIdentifier</key>
      <string>com.example.restrictions.applicationaccess</string>
      <key>PayloadUUID</key>
      <string>11111111-1111-1111-1111-111111111111</string>
      <key>allowCamera</key>
      <false/>
    </dict>
  </array>
</dict>
</plist>`;

const restrictionsProfile = mobileconfig(restrictionsXml);

describe("policy import through createPolicy", () => {
  it("creates the policy and its configurations in one request", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context, "acme");

    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "Imported",
        notes: "From a document",
        priority: 20,
        configurations: {
          "mttx.apple.device": { camera: false },
          "mttx.apple.custom.imported": {
            content: restrictionsProfile,
            fileName: "restrictions.mobileconfig",
            signed: false,
          },
        },
        configurationScopes: {
          "mttx.apple.device": "device",
          "mttx.apple.custom.imported": "device",
        },
      }),
    );

    expect(context.db.store.policy).toMatchObject([
      {
        id: created.id,
        organizationId: tenant.id,
        name: "Imported",
        notes: "From a document",
        priority: 20,
      },
    ]);
    expect(context.db.store.configuration).toHaveLength(2);
    expect(context.db.store.configuration).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: created.id,
          kind: "mttx.apple.device",
          scope: "device",
        }),
        expect.objectContaining({
          policyId: created.id,
          kind: "mttx.apple.custom.imported",
          scope: "device",
        }),
      ]),
    );

    // The create snapshots the settings, so the first deployment is complete.
    expect(context.db.store.policy_deployment).toMatchObject([
      {
        policyId: created.id,
        organizationId: tenant.id,
        version: 1,
      },
    ]);
    expect(context.db.store.audit_log.at(-1)).toMatchObject({
      action: "policy.created",
      metadata: { configurations: ["mttx.apple.device", "mttx.apple.custom.imported"] },
    });
  });

  it("rejects an invalid configuration without creating the policy", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context, "acme");

    await expect(
      runEffect(
        context.service.createPolicy(request(headers), tenant.id, {
          name: "Broken",
          configurations: { "not.a.kind": { value: true } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(context.db.store.policy).toEqual([]);
    expect(context.db.store.configuration).toEqual([]);
  });

  it("rejects a mobileconfig that is not a profile", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context, "acme");

    await expect(
      runEffect(
        context.service.createPolicy(request(headers), tenant.id, {
          name: "Broken profile",
          configurations: {
            "mttx.apple.custom.imported": { content: "bm90IGEgcHJvZmlsZQ==" },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(context.db.store.policy).toEqual([]);
  });

  it("keeps configurations inside the target tenant", async () => {
    const context = makeContext();
    const acme = await makeTenant(context, "acme");
    const globex = await makeTenant(context, "globex");

    const created = await runEffect(
      context.service.createPolicy(request(headers), acme.id, {
        name: "Only Acme",
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );

    expect(context.db.store.configuration).toEqual([
      expect.objectContaining({ policyId: created.id, kind: "mttx.apple.device" }),
    ]);
    await expect(
      runEffect(context.service.getPolicy(request(headers), globex.id, created.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
    await expect(
      runEffect(
        context.service.patchPolicy(request(headers), globex.id, created.id, {
          configurations: { "mttx.apple.device": { camera: true } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("refuses the import for a role without policies.write", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context, "acme");

    context.db.store.member[0]!.role = "auditor";

    await expect(
      runEffect(
        context.service.createPolicy(request(headers), tenant.id, {
          name: "Denied",
          configurations: { "mttx.apple.device": { camera: false } },
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
    expect(context.db.store.policy).toEqual([]);
  });
});

describe("policy import merge", () => {
  it("keeps the scope of a kind the patch does not touch", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context, "acme");

    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "Merged",
        configurations: {
          "mttx.windows.custom.user": {
            omaUri: "./User/Vendor/MSFT/Policy/Config/Start/AllowPinnedFolder",
            value: "1",
          },
          "mttx.windows.custom.device": {
            omaUri: "./Vendor/MSFT/Policy/Config/Privacy/AllowTelemetry",
            value: "0",
          },
        },
        configurationScopes: { "mttx.windows.custom.user": "user" },
      }),
    );

    await runEffect(
      context.service.patchPolicy(request(headers), tenant.id, created.id, {
        configurations: {
          "mttx.windows.custom.device": {
            omaUri: "./Vendor/MSFT/Policy/Config/Privacy/AllowTelemetry",
            value: "1",
          },
        },
        configurationScopes: { "mttx.windows.custom.device": "device" },
      }),
    );

    const rows = context.db.store.configuration.filter((row: any) => row.policyId === created.id);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "mttx.windows.custom.user", scope: "user" }),
        expect.objectContaining({ kind: "mttx.windows.custom.device", scope: "device" }),
      ]),
    );
  });

  it("overwrites a kind when the import sends it", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context, "acme");

    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "Imported",
        configurations: { "mttx.apple.device": { camera: false } },
      }),
    );

    await runEffect(
      context.service.patchPolicy(request(headers), tenant.id, created.id, {
        configurations: { "mttx.apple.device": { camera: true } },
      }),
    );

    // The fake store appends on `onDuplicateKeyUpdate`; MySQL keeps one row per
    // (policy, kind). Assert the write the patch issued, not the fake's shape.
    const rows = context.db.store.configuration.filter(
      (row: any) => row.policyId === created.id && row.kind === "mttx.apple.device",
    );

    expect(rows.at(-1)).toMatchObject({ data: { camera: true }, scope: "device" });
  });
});

describe("mobileconfig preview scope", () => {
  it("reports a user-scoped profile so the import selects the user channel", async () => {
    const context = makeContext();

    const userProfile = mobileconfig(
      restrictionsXml.replace(
        "<key>PayloadDisplayName</key>",
        "<key>PayloadScope</key><string>User</string><key>PayloadDisplayName</key>",
      ),
    );

    // SAFETY: the preview endpoint is account-scoped and takes no request.
    const preview = await runEffect(
      (context.service as any).previewMobileconfig({ mobileconfig: userProfile }),
    );

    expect(preview.scope).toBe("user");
  });
});
