import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import {
  ManagementNotSupported,
  UnknownDevice,
  InternalServerError,
} from "@mattrax/management-backend";
import { managementApi, managementWebhookHandlers } from "../index.js";
import { mockManagementBackend } from "./helpers.js";

async function makeHandler(backendLayer: Layer.Layer<any>, secret?: string) {
  const apiLayer = HttpApiBuilder.layer(managementApi, {
    openapiPath: "/openapi.json",
  }).pipe(
    Layer.provide(
      HttpApiBuilder.group(managementApi, "ManagementWebhook", (handlers) =>
        managementWebhookHandlers(handlers, { secret }),
      ),
    ),
  );
  const appLayer = apiLayer.pipe(
    Layer.provideMerge(backendLayer),
    Layer.provide(HttpServer.layerServices),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(appLayer);
  return { handler, dispose };
}

const deviceScope = {
  _tag: "device" as const,
  udid: "test-udid-001",
  mdmOrigin: { url: "https://mdm.test" },
};

describe("Management Backend HTTP E2E", () => {
  it("handles apple device event", async () => {
    let receivedEvent: unknown;
    const backend = mockManagementBackend({
      appleDeviceEvent: (_scope: any, event: any) =>
        Effect.sync(() => {
          receivedEvent = event;
        }),
    });

    const { handler, dispose } = await makeHandler(backend);
    const event = {
      _tag: "Authenticate" as const,
      serialNumber: "SN001",
      model: "MacBookPro",
      osVersion: "14.0",
    };

    const res = await handler(
      new Request("http://localhost/webhook/apple/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: deviceScope, event }),
      }),
    );

    expect(res.status).toBe(204);
    expect(receivedEvent).toBeDefined();
    expect((receivedEvent as any)._tag).toBe("Authenticate");
    await dispose();
  });

  it("handles apple management checkin", async () => {
    const backend = mockManagementBackend({
      appleManagementCheckin: () =>
        Effect.succeed({
          _tag: "Command" as const,
          commandUUID: "cmd-001",
          requestType: "DeviceInformation",
          payload: { Queries: ["DeviceName"] },
        }),
    });

    const { handler, dispose } = await makeHandler(backend);

    const res = await handler(
      new Request("http://localhost/webhook/apple/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: deviceScope }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body._tag).toBe("Command");
    expect(body.commandUUID).toBe("cmd-001");
    await dispose();
  });

  it("handles get apple declaration tokens", async () => {
    const backend = mockManagementBackend({
      getAppleDeclarationTokens: () =>
        Effect.succeed({
          activationsToken: "act-001",
          configurationsToken: "cfg-001",
          assetsToken: "asset-001",
          managementToken: "mgmt-001",
          declarationsToken: "decl-001",
        }),
    });

    const { handler, dispose } = await makeHandler(backend);

    const res = await handler(
      new Request("http://localhost/webhook/apple/declaration-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: deviceScope }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.activationsToken).toBe("act-001");
    expect(body.configurationsToken).toBe("cfg-001");
    expect(body.assetsToken).toBe("asset-001");
    expect(body.managementToken).toBe("mgmt-001");
    await dispose();
  });

  it("handles get apple declaration items", async () => {
    const backend = mockManagementBackend({
      getAppleDeclarationItems: () =>
        Effect.succeed({
          activations: [{ identifier: "act-1", serverToken: "tok-1" }],
          configurations: [{ identifier: "cfg-1", serverToken: "tok-2" }],
          assets: [{ identifier: "asset-1", serverToken: "tok-3" }],
          management: [{ identifier: "mgmt-1", serverToken: "tok-4" }],
        }),
    });

    const { handler, dispose } = await makeHandler(backend);

    const res = await handler(
      new Request("http://localhost/webhook/apple/declaration-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: deviceScope }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.activations).toHaveLength(1);
    expect(body.configurations).toHaveLength(1);
    expect(body.assets).toHaveLength(1);
    expect(body.management).toHaveLength(1);
    await dispose();
  });

  it("handles get apple declaration", async () => {
    const backend = mockManagementBackend({
      getAppleDeclaration: (_scope: any, type: any, identifier: any) =>
        Effect.succeed({
          Identifier: identifier,
          Type: type,
          Payload: { test: true },
        }),
    });

    const { handler, dispose } = await makeHandler(backend);

    const res = await handler(
      new Request("http://localhost/webhook/apple/declaration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: deviceScope,
          type: "com.apple.configuration",
          identifier: "decl-001",
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Identifier).toBe("decl-001");
    expect(body.Type).toBe("com.apple.configuration");
    await dispose();
  });

  it("propagates ManagementNotSupported errors", async () => {
    const backend = mockManagementBackend({
      appleManagementCheckin: () => Effect.fail(new ManagementNotSupported()),
    });

    const { handler, dispose } = await makeHandler(backend);

    const res = await handler(
      new Request("http://localhost/webhook/apple/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: deviceScope }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as any;
    expect(body._tag).toBe("ManagementNotSupported");
    await dispose();
  });

  it("propagates UnknownDevice errors", async () => {
    const backend = mockManagementBackend({
      getAppleDeclarationTokens: () => Effect.fail(new UnknownDevice()),
    });

    const { handler, dispose } = await makeHandler(backend);

    const res = await handler(
      new Request("http://localhost/webhook/apple/declaration-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: deviceScope }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as any;
    expect(body._tag).toBe("UnknownDevice");
    await dispose();
  });

  it("maps getAppleProfile over the webhook", async () => {
    const backend = mockManagementBackend({
      getAppleProfile: (policyId: string, kind: string) =>
        Effect.succeed({
          content: new TextEncoder().encode(`${policyId}:${kind}`),
          contentType: "application/x-apple-aspen-config",
        }),
    });

    const { handler, dispose } = await makeHandler(backend);
    const res = await handler(
      new Request("http://localhost/webhook/apple/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: "policy-1", kind: "mttx.apple.device" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.contentType).toBe("application/x-apple-aspen-config");
    expect(atob(body.content)).toBe("policy-1:mttx.apple.device");
    await dispose();
  });

  it("maps windows discovery over the webhook", async () => {
    const backend = mockManagementBackend({
      windowsDiscovery: () =>
        Effect.succeed({
          authPolicy: "OnPremise",
          enrollmentVersion: "4.0",
          enrollmentPolicyServiceUrl: "https://mdm.test/mdm/windows/policy",
          enrollmentServiceUrl: "https://mdm.test/mdm/windows/enroll",
        }),
    });

    const { handler, dispose } = await makeHandler(backend);
    const res = await handler(
      new Request("http://localhost/webhook/windows/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestVersion: "5.0",
          deviceType: "CIMClient_Windows",
          applicationVersion: "10.0",
          osEdition: 48,
          authPolicies: ["OnPremise"],
          mdmOrigin: { url: "https://mdm.test" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.authPolicy).toBe("OnPremise");
    expect(body.enrollmentServiceUrl).toBe("https://mdm.test/mdm/windows/enroll");
    await dispose();
  });

  it("maps windows management check-in over the webhook", async () => {
    const backend = mockManagementBackend({
      windowsManagementCheckin: () => Effect.succeed({ commands: [] }),
    });

    const { handler, dispose } = await makeHandler(backend);
    const res = await handler(
      new Request("http://localhost/webhook/windows/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: { deviceId: "device-1", mdmOrigin: { url: "https://mdm.test" } },
          request: {
            sessionID: "1",
            msgID: "1",
            source: "device-1",
            target: "https://mdm.test",
            statuses: [],
            alerts: [],
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ commands: [] });
    await dispose();
  });

  it("propagates unsupported windows management", async () => {
    const backend = mockManagementBackend({
      windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
    });

    const { handler, dispose } = await makeHandler(backend);
    const res = await handler(
      new Request("http://localhost/webhook/windows/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestVersion: "5.0",
          deviceType: "CIMClient_Windows",
          applicationVersion: "10.0",
          osEdition: 48,
          authPolicies: ["OnPremise"],
          mdmOrigin: { url: "https://mdm.test" },
        }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as any;
    expect(body._tag).toBe("ManagementNotSupported");
    await dispose();
  });

  it("propagates InternalServerError errors", async () => {
    const backend = mockManagementBackend({
      getAppleDeclarationItems: () => Effect.fail(new InternalServerError()),
    });

    const { handler, dispose } = await makeHandler(backend);

    const res = await handler(
      new Request("http://localhost/webhook/apple/declaration-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: deviceScope }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as any;
    expect(body._tag).toBe("InternalServerError");
    await dispose();
  });
});

describe("Management webhook signing", () => {
  const secret = "test-webhook-secret";
  const sign = async (operation: string, payload: unknown) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const digest = createHash("sha256")
      .update(JSON.stringify(payload ?? null))
      .digest("hex");
    const signature = createHmac("sha256", secret)
      .update(`${operation}.${timestamp}.${digest}`)
      .digest("hex");
    return {
      "x-mattrax-timestamp": timestamp,
      "x-mattrax-signature": signature,
    };
  };

  it("accepts a correctly signed request", async () => {
    let received = false;
    const backend = mockManagementBackend({
      appleDeviceEvent: () =>
        Effect.sync(() => {
          received = true;
        }),
    });
    const { handler, dispose } = await makeHandler(backend, secret);
    const payload = {
      scope: deviceScope,
      event: { _tag: "CheckOut" as const },
    };
    const body = JSON.stringify(payload);
    const response = await handler(
      new Request("http://localhost/webhook/apple/event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await sign("appleDeviceEvent", payload)),
        },
        body,
      }),
    );
    expect(response.status).toBe(204);
    expect(received).toBe(true);
    await dispose();
  });

  it("rejects unsigned and tampered requests", async () => {
    const backend = mockManagementBackend({});
    const { handler, dispose } = await makeHandler(backend, secret);
    const payload = { scope: deviceScope, event: { _tag: "CheckOut" as const } };
    const unsigned = await handler(
      new Request("http://localhost/webhook/apple/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(unsigned.status).toBe(500);

    const headers = await sign("appleDeviceEvent", payload);
    const tampered = await handler(
      new Request("http://localhost/webhook/apple/event", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          scope: { ...deviceScope, udid: "tampered-udid" },
          event: { _tag: "CheckOut" as const },
        }),
      }),
    );
    expect(tampered.status).toBe(500);
    await dispose();
  });
});
