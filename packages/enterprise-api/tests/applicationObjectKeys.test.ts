import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseNotFound } from "@mattrax/enterprise-domain";
import type { R2Bucket, R2PutValue } from "@mattrax/enterprise-core";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const now = new Date("2026-11-01T00:00:00Z");

const makeStorage = () => {
  const objects = new Map<string, string>();
  const read: string[] = [];
  const deleted: string[] = [];

  const storage: R2Bucket = {
    put: async (key: string, value: R2PutValue) => {
      objects.set(key, String(value));

      return {
        key,
        version: "1",
        size: String(value).length,
        etag: "etag",
        httpEtag: "etag",
        uploaded: now,
      };
    },
    head: async () => null,
    get: async (key: string) => {
      read.push(key);
      const body = objects.get(key);

      if (body === undefined) return null;

      return {
        key,
        version: "1",
        size: body.length,
        etag: "etag",
        httpEtag: "etag",
        uploaded: now,
        body: new ReadableStream(),
        bodyUsed: false,
        text: async () => body,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
        json: async () => JSON.parse(body),
        blob: async () => new Blob([body]),
      };
    },
    delete: async (keys: string | ReadonlyArray<string>) => {
      for (const key of Schema.is(Schema.String)(keys) ? [keys] : keys) {
        deleted.push(key);
        objects.delete(key);
      }
    },
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
  };

  return { storage, objects, read, deleted };
};

const makeContext = () => {
  const db = makeDb();

  db.store.account.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  db.store.organization.push({
    id: "org-1",
    name: "Acme",
    slug: "acme",
    logo: null,
    displayName: "Acme",
    supportEmail: null,
    brandColor: null,
    metadata: null,
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
  });
  db.store.member.push({
    id: "member-1",
    organizationId: "org-1",
    accountId: "user-1",
    role: "owner",
    customRoleId: null,
    onboardingDismissedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: () => Effect.succeed({ user: db.store.account[0] }),
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
  };

  const { storage, objects, read, deleted } = makeStorage();

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    storage,
    auth: auth as never,
    authSecret: "application-object-test-secret",
  });

  return { db, service, objects, read, deleted };
};

const addApplication = (
  context: ReturnType<typeof makeContext>,
  input: { id: string; r2Key: string; sha256: string },
) => {
  context.db.store.application.push({
    id: input.id,
    organizationId: "org-1",
    name: input.id,
    platform: "apple",
    bundleId: null,
    version: "1.0",
    source: "upload",
    manifestUrl: null,
    storeId: null,
    fileName: `${input.id}.pkg`,
    contentType: "application/octet-stream",
    size: 5,
    sha256: input.sha256,
    r2Key: input.r2Key,
    notes: null,
    removeOnUnassign: false,
    createdAt: now,
    updatedAt: now,
  });
  context.db.store.application_installer.push({
    id: `${input.id}-installer`,
    organizationId: "org-1",
    applicationId: input.id,
    platform: "apple",
    source: "upload",
    bundleId: null,
    version: "1.0",
    manifestUrl: null,
    storeId: null,
    fileName: `${input.id}.pkg`,
    contentType: "application/octet-stream",
    size: 5,
    sha256: input.sha256,
    r2Key: input.r2Key,
    minOsVersion: null,
    requiredCapability: null,
    priority: 0,
    provisioningExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  });
};

describe("application object ownership at the R2 sinks", () => {
  it("does not read a foreign application or installer key", async () => {
    const context = makeContext();
    const foreignKey = "a/org-2/app-foreign/sha";

    addApplication(context, { id: "app-foreign", r2Key: foreignKey, sha256: "a".repeat(64) });
    context.objects.set(foreignKey, "VICTIM");

    await expect(
      runEffect(
        context.service.downloadApplication(
          request(headers),
          "org-1",
          "app-foreign",
          "a".repeat(64),
        ),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    await expect(
      runEffect(
        context.service.downloadApplicationInstaller(
          request(headers),
          "org-1",
          "app-foreign",
          "app-foreign-installer",
          "a".repeat(64),
        ),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    expect(context.read).not.toContain(foreignKey);
    expect(context.objects.get(foreignKey)).toBe("VICTIM");
  });

  it("does not delete a foreign key while deleting the application row", async () => {
    const context = makeContext();
    const foreignKey = "a/org-2/app-foreign/sha";

    addApplication(context, { id: "app-foreign", r2Key: foreignKey, sha256: "a".repeat(64) });
    context.objects.set(foreignKey, "VICTIM");

    const result = await runEffect(
      context.service.deleteApplications(request(headers), "org-1", ["app-foreign"]),
    );

    expect(result.deleted).toEqual(["app-foreign"]);
    expect(context.deleted).not.toContain(foreignKey);
    expect(context.objects.get(foreignKey)).toBe("VICTIM");
    expect(context.db.store.application).toHaveLength(0);
  });

  it("still reads and deletes an object under the caller's tenant prefix", async () => {
    const context = makeContext();
    const key = "a/org-1/app-owned/sha";

    addApplication(context, { id: "app-owned", r2Key: key, sha256: "b".repeat(64) });
    context.objects.set(key, "OWNED");

    const download = await runEffect(
      context.service.downloadApplication(request(headers), "org-1", "app-owned", "b".repeat(64)),
    );

    expect(download.content).toBe(Buffer.from("OWNED").toString("base64"));

    await runEffect(context.service.deleteApplications(request(headers), "org-1", ["app-owned"]));

    expect(context.deleted).toContain(key);
    expect(context.objects.has(key)).toBe(false);
  });
});
