import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import { describe, expect, it } from "vitest";
import {
  ApprovalRequired,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseService,
  enterpriseAccountApi,
  enterpriseApprovalApi,
} from "@mattrax/enterprise-domain";
import { enterpriseAccountHandlers, enterpriseApprovalHandlers } from "@mattrax/enterprise-api";

type Mode = {
  patch?: unknown;
  gate?: "pending" | "approved" | "allow" | "expired" | "consumed" | "mismatch";
  /** Drives the export, download and token endpoints. */
  error?: "expired" | "consumed" | "mismatch";
};

const modeFailure = (mode: Mode) => {
  switch (mode.error) {
    case "expired":
      return new EnterpriseBadRequest({
        message: "This approval has expired. Start a new request.",
      });
    case "consumed":
      return new EnterpriseConflict({
        message: "This approval has already been used. Start a new request.",
      });
    case "mismatch":
      return new EnterpriseBadRequest({
        message:
          "This approval was issued for a different request. Start a new approval for the current action.",
      });
    default:
      return undefined;
  }
};

const makeHandler = (mode: Mode = {}) => {
  const service = {
    exportTenant: () => {
      const failure = modeFailure(mode);

      return failure
        ? Effect.fail(failure)
        : Effect.succeed({ body: "{}", filename: "tenant.json", version: 1 });
    },
    downloadTenantBackup: () => {
      const failure = modeFailure(mode);

      return failure
        ? Effect.fail(failure)
        : Effect.succeed({ content: "{}", filename: "backup.json" });
    },
    createApiToken: () => {
      const failure = modeFailure(mode);

      return failure
        ? Effect.fail(failure)
        : Effect.succeed({ token: "mtx_test", item: { id: "token-1" } });
    },
    patchApprovalPolicy: () =>
      mode.patch === undefined
        ? Effect.succeed({ status: "ok" as const })
        : Effect.succeed(mode.patch),
    createApprovalPolicy: () => Effect.succeed({ id: "policy-1" }),
    deleteApprovalPolicy: () => Effect.succeed({ status: "ok" as const }),
    deletePolicies: (request: any) => {
      if (mode.gate === "allow")
        return request.headers["x-mattrax-approval"] === "req-1"
          ? Effect.succeed({ deleted: ["policy-1"], failed: [] })
          : Effect.fail(
              new ApprovalRequired({
                code: "approval_required",
                message:
                  "Approval request req-1 is pending. Another administrator must approve it.",
                requestId: "req-1",
                status: "pending",
              }),
            );

      switch (mode.gate) {
        case "approved":
          return Effect.fail(
            new ApprovalRequired({
              code: "approval_required",
              message: "Approval request req-1 is approved — retry with this approval.",
              requestId: "req-1",
              status: "approved",
            }),
          );
        case "expired":
          return Effect.fail(
            new EnterpriseBadRequest({
              message: "This approval has expired. Start a new request.",
            }),
          );
        case "consumed":
          return Effect.fail(
            new EnterpriseConflict({
              message: "This approval has already been used. Start a new request.",
            }),
          );
        case "mismatch":
          return Effect.fail(
            new EnterpriseBadRequest({
              message:
                "This approval was issued for a different request. Start a new approval for the current action.",
            }),
          );
        default:
          return Effect.fail(
            new ApprovalRequired({
              code: "approval_required",
              message: "Approval request req-1 is pending. Another administrator must approve it.",
              requestId: "req-1",
              status: "pending",
            }),
          );
      }
    },
  };

  const api = HttpApi.make("ApprovalHttpTest").add(enterpriseApprovalApi).add(enterpriseAccountApi);

  const layer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      Layer.mergeAll(
        HttpApiBuilder.group(api, "EnterpriseApproval", (handlers) =>
          enterpriseApprovalHandlers(handlers),
        ),
        HttpApiBuilder.group(api, "EnterpriseAccount", (handlers) =>
          enterpriseAccountHandlers(handlers),
        ),
      ),
    ),
    Layer.provide(Layer.succeed(EnterpriseService, service as any)),
    Layer.provide(HttpRouter.layer),
  );

  return HttpRouter.toWebHandler(layer).handler;
};

const base = "http://localhost/api/v1/tenants/org-1";

describe("approval HTTP contract", () => {
  it("returns the declared OkResponse for patchApprovalPolicy", async () => {
    const handler = makeHandler();
    const response = await handler(
      new Request(base + "/approval-policies/policy-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalsRequired: 2 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns the declared IdResponse for createApprovalPolicy", async () => {
    const handler = makeHandler();
    const response = await handler(
      new Request(base + "/approval-policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "script.run", approverRole: "admin" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "policy-1" });
  });

  it("returns the declared OkResponse for deleteApprovalPolicy", async () => {
    const handler = makeHandler();
    const response = await handler(
      new Request(base + "/approval-policies/policy-1", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("encodes ApprovalRequired with the machine-readable request handle", async () => {
    const handler = makeHandler();
    const response = await handler(
      new Request(base + "/policies", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["policy-1"]),
      }),
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as any;

    expect(body).toMatchObject({
      _tag: "ApprovalRequired",
      code: "approval_required",
      requestId: "req-1",
      status: "pending",
    });
    expect(body.message).toContain("Approval request");
  });

  it("completes the original action when retried with the approval header", async () => {
    const handler = makeHandler({ gate: "allow" });

    const blocked = await handler(
      new Request(base + "/policies", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["policy-1"]),
      }),
    );

    expect(blocked.status).toBe(403);

    const retried = await handler(
      new Request(base + "/policies", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-mattrax-approval": "req-1",
        },
        body: JSON.stringify(["policy-1"]),
      }),
    );

    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({ deleted: ["policy-1"], failed: [] });
  });

  it("encodes an approved gate response so the client can retry", async () => {
    const handler = makeHandler({ gate: "approved" });
    const response = await handler(
      new Request(base + "/policies", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["policy-1"]),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      _tag: "ApprovalRequired",
      requestId: "req-1",
      status: "approved",
    });
  });

  for (const [gate, tag] of [
    ["expired", "EnterpriseBadRequest"],
    ["consumed", "EnterpriseConflict"],
    ["mismatch", "EnterpriseBadRequest"],
  ] as const) {
    it("encodes " + gate + " as " + tag + " instead of a 500", async () => {
      const handler = makeHandler({ gate });
      const response = await handler(
        new Request(base + "/policies", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(["policy-1"]),
        }),
      );

      expect(response.status).toBe(tag === "EnterpriseConflict" ? 409 : 400);
      await expect(response.json()).resolves.toMatchObject({ _tag: tag });
    });
  }

  it("declares and encodes expired approvals on exportTenant", async () => {
    const handler = makeHandler({ error: "expired" });
    const response = await handler(new Request(base + "/export"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("declares and encodes consumed approvals on downloadTenantBackup", async () => {
    const handler = makeHandler({ error: "consumed" });
    const response = await handler(new Request(base + "/backups/backup-1/download"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseConflict" });
  });

  it("declares and encodes payload mismatches on createApiToken", async () => {
    const handler = makeHandler({ error: "mismatch" });
    const response = await handler(
      new Request("http://localhost/api/v1/account/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "CI", tenantId: "org-1" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });
});
