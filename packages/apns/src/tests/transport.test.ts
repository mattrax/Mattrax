import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createHmac } from "node:crypto";
import {
  ApnsError,
  MtlsPushTransport,
  NoopPushTransport,
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
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = { url: String(input), init: init ?? {} };
        return new Response("", { status: 200 });
      }) as typeof fetch,
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
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");

    const body = captured?.init.body as string;
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
    expect(headers["x-apns-timestamp"]).toBe("1700000000");
    expect(headers["x-apns-signature"]).toBe(expected);
  });

  it("reports failures from the relay", async () => {
    const transport = RelayPushTransport({
      url: "https://relay.test/apns",
      secret: "relay-secret",
      fetch: (async () => new Response("nope", { status: 502 })) as typeof fetch,
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
