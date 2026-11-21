import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { pemEncode } from "@mattrax/crypto";
import { createTestApnsCertificate, createTestApnsKeys } from "./helpers.js";
import {
  ApnsError,
  MtlsPushTransport,
  NoopPushTransport,
  NodePushTransport,
  RelayPushTransport,
  buildApnsRequest,
  relaySignature,
} from "../transport.js";

describe("APNs push request", () => {
  it("uses Apple's MDM push shape", () => {
    const request = buildApnsRequest({
      pushToken: "abcd1234",
      pushMagic: "magic-1",
      topic: "com.apple.mgmt.External.tenant",
    });

    expect(request.url).toBe("https://api.push.apple.com/3/device/abcd1234");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({
      "apns-topic": "com.apple.mgmt.External.tenant",
      "apns-push-type": "mdm",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    expect(JSON.parse(request.body)).toEqual({ mdm: "magic-1" });
  });

  it("delivers through an mTLS Fetcher binding", async () => {
    let captured: Request | undefined;

    const transport = MtlsPushTransport({
      fetch: async (request) => {
        captured = request;

        return new Response(null, { status: 200 });
      },
    });

    await Effect.runPromise(
      transport.push({
        pushToken: "abcd1234",
        pushMagic: "magic-1",
        topic: "com.apple.mgmt.External.tenant",
      }),
    );

    expect(captured?.url).toBe("https://api.push.apple.com/3/device/abcd1234");
    expect(captured?.headers.get("apns-push-type")).toBe("mdm");
    expect(await captured?.text()).toBe(JSON.stringify({ mdm: "magic-1" }));
  });

  it("surfaces rejected pushes as ApnsError", async () => {
    const transport = MtlsPushTransport({
      fetch: async () => new Response("BadDeviceToken", { status: 400 }),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        transport.push({
          pushToken: "bad",
          pushMagic: "magic-1",
          topic: "com.apple.mgmt.External.tenant",
        }),
      ),
    );

    expect(error).toBeInstanceOf(ApnsError);
    expect(error.message).toContain("400");
  });
});

describe("APNs relay transport", () => {
  it("signs the timestamp and body with HMAC-SHA256", async () => {
    const secret = "relay-secret";
    const timestamp = "1700000000";
    const body = JSON.stringify({ pushToken: "abcd" });
    const signature = await relaySignature(secret, timestamp, body);

    const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(signature).toBe(expected);
  });

  it("posts an HMAC-signed request to the relay", async () => {
    let captured: { url: string; init: RequestInit } | undefined;

    const transport = RelayPushTransport({
      url: "https://relay.test/apns",
      secret: "relay-secret",
      now: () => 1_700_000_000,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = { url: String(input), init: init ?? {} };

        return new Response("", { status: 200 });
      },
    });

    await Effect.runPromise(
      transport.push({
        pushToken: "abcd1234",
        pushMagic: "magic-1",
        topic: "com.apple.mgmt.External.tenant",
        certPem: "CERT",
        privateKeyPem: "KEY",
      }),
    );

    expect(captured?.url).toBe("https://relay.test/apns");
    expect(captured?.init.method).toBe("POST");
    const headers = new Headers(captured?.init.headers);
    expect(headers.get("content-type")).toBe("application/json");

    const body = String(captured?.init.body ?? "");
    expect(JSON.parse(body)).toEqual({
      pushToken: "abcd1234",
      pushMagic: "magic-1",
      topic: "com.apple.mgmt.External.tenant",
      certPem: "CERT",
      privateKeyPem: "KEY",
    });

    const expected = createHmac("sha256", "relay-secret")
      .update(`1700000000.${body}`)
      .digest("hex");

    expect(headers.get("x-apns-timestamp")).toBe("1700000000");
    expect(headers.get("x-apns-signature")).toBe(expected);
  });

  it("reports failures from the relay", async () => {
    const transport = RelayPushTransport({
      url: "https://relay.test/apns",
      secret: "relay-secret",
      fetch: async () => new Response("nope", { status: 502 }),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        transport.push({
          pushToken: "abcd",
          pushMagic: "magic",
          topic: "com.apple.mgmt.External.tenant",
        }),
      ),
    );

    expect(error.message).toContain("502");
  });
});

describe("APNs outbound timeouts", () => {
  const push = (transport: ReturnType<typeof MtlsPushTransport>) =>
    Effect.runPromise(
      Effect.flip(
        transport.push({
          pushToken: "abcd",
          pushMagic: "magic",
          topic: "com.apple.mgmt.External.tenant",
        }),
      ),
    );

  it("aborts a hung mTLS fetch", async () => {
    let aborted: AbortSignal | undefined;

    const transport = MtlsPushTransport({
      timeoutMs: 25,
      fetch: (request: Request) =>
        new Promise<Response>((_resolve, reject) => {
          aborted = request.signal;
          request.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });

    const started = Date.now();
    const error = await push(transport);
    expect(error).toBeInstanceOf(ApnsError);
    expect(error.message).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(aborted?.aborted).toBe(true);
  });

  it("aborts a hung relay fetch", async () => {
    const transport = RelayPushTransport({
      url: "https://relay.test/apns",
      secret: "relay-secret",
      timeoutMs: 25,
      fetch: (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });

    const error = await push(transport);
    expect(error).toBeInstanceOf(ApnsError);
    expect(error.message).toContain("timed out");
  });

  it("closes the HTTP/2 session when the connection stalls", async () => {
    // A TCP server that accepts the connection but never completes the TLS
    // handshake. Without a deadline this promise would never settle.
    const sockets: Array<import("node:net").Socket> = [];

    const server = createServer((socket) => {
      sockets.push(socket);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = Schema.is(Schema.Struct({ port: Schema.Number }))(address) ? address.port : 0;

    const keys = await createTestApnsKeys();

    const certificate = await createTestApnsCertificate({
      keyPair: keys,
      topic: "com.apple.mgmt.External.tenant",
    });

    const privateKeyPem = pemEncode(
      "PRIVATE KEY",
      await crypto.subtle.exportKey("pkcs8", keys.privateKey),
    );

    try {
      const transport = NodePushTransport({
        certPem: certificate.pem,
        privateKeyPem,
        timeoutMs: 150,
        endpoint: `https://127.0.0.1:${port}`,
      });

      const started = Date.now();

      const error = await Effect.runPromise(
        Effect.flip(
          transport.push({
            pushToken: "abcd",
            pushMagic: "magic",
            topic: "com.apple.mgmt.External.tenant",
          }),
        ),
      );

      expect(error).toBeInstanceOf(ApnsError);
      expect(error.message).toContain("timed out");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });
});

describe("APNs noop transport", () => {
  it("reports unavailable with a clear error", async () => {
    const transport = NoopPushTransport("relay not configured");
    expect(transport.available).toBe(false);

    const error = await Effect.runPromise(
      Effect.flip(
        transport.push({
          pushToken: "abcd",
          pushMagic: "magic",
          topic: "com.apple.mgmt.External.tenant",
        }),
      ),
    );

    expect(error).toBeInstanceOf(ApnsError);
    expect(error.message).toBe("relay not configured");
  });
});
