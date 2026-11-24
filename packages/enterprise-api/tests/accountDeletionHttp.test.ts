import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseService,
  EnterpriseUnauthorized,
  enterpriseAccountApi,
} from "@mattrax/enterprise-domain";
import { enterpriseAccountHandlers } from "@mattrax/enterprise-api";

type Failure = EnterpriseBadRequest | EnterpriseConflict | EnterpriseForbidden | undefined;

const preview = {
  canDelete: true,
  blockers: [],
  tenant: {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    memberCount: 1,
    ownerCount: 1,
    deviceCount: 2,
  },
  lastAccount: true,
};

const makeHandler = (options: { readonly failure?: Failure; readonly calls?: Array<any> } = {}) => {
  const service = {
    getAccountDeletion: (request: any) => {
      if (!request.headers.cookie)
        return Effect.fail(new EnterpriseUnauthorized({ message: "Sign in to continue." }));

      return Effect.succeed(preview);
    },
    deleteMe: (request: any, payload: any) => {
      options.calls?.push(payload);

      if (!request.headers.cookie)
        return Effect.fail(new EnterpriseUnauthorized({ message: "Sign in to continue." }));

      if (options.failure) return Effect.fail(options.failure);

      return Effect.succeed({
        status: "ok" as const,
        deletedTenants: [{ id: "org-1", name: "Acme" }],
      });
    },
  };

  const api = HttpApi.make("AccountDeletionHttpTest").add(enterpriseAccountApi);

  const layer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      HttpApiBuilder.group(api, "EnterpriseAccount", (handlers) =>
        enterpriseAccountHandlers(handlers),
      ),
    ),
    Layer.provide(Layer.succeed(EnterpriseService, service as any)),
    Layer.provide(HttpRouter.layer),
  );

  return HttpRouter.toWebHandler(layer).handler;
};

const previewUrl = "http://localhost/api/v1/me/deletion";
const deleteUrl = "http://localhost/api/v1/me";
const cookie = { cookie: "mattrax_session=user-1" };

describe("account deletion HTTP contract", () => {
  it("requires authentication for the preview", async () => {
    const response = await makeHandler()(new Request(previewUrl));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseUnauthorized" });
  });

  it("returns the typed preview shape", async () => {
    const response = await makeHandler()(new Request(previewUrl, { headers: cookie }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(preview);
  });

  it("requires the confirmation payload", async () => {
    const response = await makeHandler()(
      new Request(deleteUrl, {
        method: "DELETE",
        headers: { ...cookie, "content-type": "application/json" },
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("decodes confirmEmail and returns the deleted tenants", async () => {
    const calls: Array<any> = [];
    const response = await makeHandler({ calls })(
      new Request(deleteUrl, {
        method: "DELETE",
        headers: { ...cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirmEmail: "owner@example.com" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ confirmEmail: "owner@example.com" }]);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      deletedTenants: [{ id: "org-1", name: "Acme" }],
    });
  });

  it("requires authentication for deletion", async () => {
    const response = await makeHandler()(
      new Request(deleteUrl, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmEmail: "owner@example.com" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseUnauthorized" });
  });

  it("encodes a blocked deletion as forbidden", async () => {
    const response = await makeHandler({
      failure: new EnterpriseForbidden({ message: "You share Acme with another owner." }),
    })(
      new Request(deleteUrl, {
        method: "DELETE",
        headers: { ...cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirmEmail: "owner@example.com" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
  });

  it("encodes a mismatched email as a bad request", async () => {
    const response = await makeHandler({
      failure: new EnterpriseBadRequest({ message: "Type the account email to confirm." }),
    })(
      new Request(deleteUrl, {
        method: "DELETE",
        headers: { ...cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirmEmail: "wrong@example.com" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("encodes a teardown in progress as a conflict", async () => {
    const response = await makeHandler({
      failure: new EnterpriseConflict({ message: "A tenant deletion is already in progress." }),
    })(
      new Request(deleteUrl, {
        method: "DELETE",
        headers: { ...cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirmEmail: "owner@example.com" }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseConflict" });
  });
});
