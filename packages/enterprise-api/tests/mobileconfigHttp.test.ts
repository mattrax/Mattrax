import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import { describe, expect, it } from "vitest";
import { EnterpriseService, enterpriseAttributeApi } from "@mattrax/enterprise-domain";
import {
  createConcurrencyGate,
  enterpriseAttributeHandlers,
  MOBILECONFIG_MAX_CONCURRENT,
} from "@mattrax/enterprise-api";
import { makeHttpHandler } from "./helpers.js";

const makeHandler = () => {
  const calls: Array<{ method: string; payload: unknown }> = [];

  const service = {
    extractMobileconfig: (_request: unknown, payload: unknown) => {
      calls.push({ method: "extractMobileconfig", payload });

      return Effect.succeed({ plist: "parsed" });
    },
    previewMobileconfig: (_request: unknown, payload: unknown) => {
      calls.push({ method: "previewMobileconfig", payload });

      return Effect.succeed({
        displayName: "Test",
        description: null,
        organization: null,
        identifier: null,
        uuid: null,
        type: "Configuration",
        scope: "device",
        payloads: [],
      });
    },
  };

  const api = HttpApi.make("MobileconfigHttpTest").add(enterpriseAttributeApi);

  const layer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      HttpApiBuilder.group(api, "EnterpriseAttribute", (handlers) =>
        enterpriseAttributeHandlers(handlers),
      ),
    ),
    Layer.provide(Layer.succeed(EnterpriseService, service as never)),
    Layer.provide(HttpRouter.layer),
    Layer.provide(HttpServer.layerServices),
  );

  return { handler: makeHttpHandler(layer), calls };
};

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/policy/extract-mobileconfig", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

describe("mobileconfig parse concurrency gate", () => {
  it("caps concurrent parses and releases slots exactly once", () => {
    const gate = createConcurrencyGate(MOBILECONFIG_MAX_CONCURRENT);
    const releases = Array.from({ length: MOBILECONFIG_MAX_CONCURRENT }, () => gate.tryAcquire());

    expect(releases.every((release) => release !== undefined)).toBe(true);
    expect(gate.tryAcquire()).toBeUndefined();
    expect(gate.active()).toBe(MOBILECONFIG_MAX_CONCURRENT);

    releases[0]!();
    releases[0]!();

    expect(gate.active()).toBe(MOBILECONFIG_MAX_CONCURRENT - 1);
    expect(gate.tryAcquire()).toBeDefined();
    expect(gate.active()).toBe(MOBILECONFIG_MAX_CONCURRENT);
  });
});

describe("mobileconfig helper HTTP body cap", () => {
  it("parses a normal request", async () => {
    const { handler, calls } = makeHandler();

    const response = await handler(post(JSON.stringify({ mobileconfig: btoa("<plist></plist>") })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ plist: "parsed" });
    expect(calls).toHaveLength(1);
  });

  it("rejects an oversized raw body before parsing or calling the service", async () => {
    const { handler, calls } = makeHandler();

    const response = await handler(
      post(JSON.stringify({ mobileconfig: btoa("<plist></plist>") }), {
        "content-length": String(12 * 1024 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "payload_too_large" });
    expect(calls).toHaveLength(0);
  });

  it("rejects an oversized streamed body without a content-length header", async () => {
    const { handler, calls } = makeHandler();

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(13 * 1024 * 1024));
        controller.close();
      },
    });

    const response = await handler(
      new Request("http://localhost/api/v1/policy/extract-mobileconfig", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "payload_too_large" });
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed JSON before calling the service", async () => {
    const { handler, calls } = makeHandler();

    const response = await handler(post("{not json"));

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
