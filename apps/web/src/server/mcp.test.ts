import { Effect } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { ApiClient } from "./api-client";
import { fetchMcpApi, shouldExposeMcpPath } from "./mcp.ts";

describe("MCP path exposure", () => {
  it("never exposes device handover, including the token download", () => {
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/handover")).toBe(false);
    expect(
      shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/handover/:archiveId/download"),
    ).toBe(false);
    // The impact read shares the prefix, so it is blocked by the same rule.
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/handover-impact")).toBe(false);
  });

  it("never exposes approval administration or decision endpoints", () => {
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/approvals")).toBe(false);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/approvals/:approvalId/approve")).toBe(
      false,
    );
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/approval-policies")).toBe(false);
  });

  it("still exposes ordinary device reads and commands", () => {
    expect(shouldExposeMcpPath("/api/v1/me")).toBe(false);
    expect(shouldExposeMcpPath("/api/v1/me/deletion")).toBe(false);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices")).toBe(true);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/:id")).toBe(true);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/:id/action")).toBe(true);
  });
});

const layerFor = (response: Response) =>
  ApiClient.fromClient(
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response))),
  );

describe("MCP response lifecycle", () => {
  it("fails malformed JSON instead of returning a successful null", async () => {
    const program = fetchMcpApi("Bearer token", "/api/openapi.json").pipe(
      Effect.provide(
        layerFor(new Response("not json", { headers: { "content-type": "application/json" } })),
      ),
    );

    await expect(Effect.runPromise(program)).rejects.toThrow(/malformed JSON/);
  });

  it("decodes non-2xx JSON so tool failures stay model-visible", async () => {
    const program = fetchMcpApi("Bearer token", "/api/openapi.json").pipe(
      Effect.provide(layerFor(Response.json({ message: "denied" }, { status: 403 }))),
    );

    await expect(Effect.runPromise(program)).resolves.toMatchObject({
      status: 403,
      ok: false,
      data: { message: "denied" },
    });
  });

  it("rejects oversized binary bodies before base64 buffering", async () => {
    const program = fetchMcpApi("Bearer token", "/api/binary").pipe(
      Effect.provide(
        layerFor(
          new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
      ),
    );

    await expect(Effect.runPromise(program)).rejects.toBeDefined();
  });

  it("marks real API dispatches so the backend can derive their audit entry", async () => {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const layer = ApiClient.fromClient(
      HttpClient.make((request) => {
        seen = request;

        return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ ok: true })));
      }),
    );

    await Effect.runPromise(
      fetchMcpApi("Bearer token", "/api/v1/tenants/tenant-1/devices").pipe(Effect.provide(layer)),
    );

    expect(seen?.headers["x-mattrax-mcp-authorization"]).toBe("Bearer token");
    expect(seen?.url).toBe("https://api.mattrax.internal/api/v1/tenants/tenant-1/devices");
  });
});
