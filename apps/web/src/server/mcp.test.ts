import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { ApiClient } from "./api-client";
import { fetchMcpApi, recordMcpActivity, shouldExposeMcpPath } from "./mcp.ts";

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

  it("consumes activity response bodies", async () => {
    const source = Response.json({ ignored: true });
    const program = recordMcpActivity("Bearer token", "tenant-1", {
      tool: "search",
      method: "GET",
      path: "/api/v1/search",
      status: 200,
    }).pipe(Effect.provide(layerFor(source)));

    await Effect.runPromise(program);
    expect(source.bodyUsed).toBe(true);
  });
});
