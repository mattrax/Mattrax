import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createAbmClient, describeAppleError } from "./appleBusinessManager.js";
import type { AbmApiCredential } from "./appleBusinessManager.js";
import { makeVppClient } from "./volumePurchase.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const makeCredential = async (): Promise<AbmApiCredential> => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const body = bytesToBase64(new Uint8Array(pkcs8));

  return {
    kind: "abm_api",
    clientId: "BUSINESSAPI.client",
    teamId: "BUSINESSAPI.team",
    keyId: "key-1",
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`,
    scope: "business.api",
    expiresAt: null,
  };
};

describe("ABM OAuth requests", () => {
  it("sends the client assertion only in the form body and redacts it from errors", async () => {
    const tokenUrl = "https://account.example.test/token";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });

      return jsonResponse({
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }) satisfies typeof globalThis.fetch;
    const client = createAbmClient({ fetch: fetchImpl, tokenUrl });

    await Effect.runPromise(client.exchangeAccessToken(await makeCredential()));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(tokenUrl);
    expect(new URL(calls[0]!.url).search).toBe("");

    const body = new URLSearchParams(String(calls[0]!.init?.body));
    const assertions = body.getAll("client_assertion");

    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatch(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(String(calls[0]!.init?.body).match(/client_assertion=/g)).toHaveLength(1);

    const rendered = describeAppleError(
      new Error(`Apple OAuth request failed for ${tokenUrl}?client_assertion=${assertions[0]}`),
    );

    expect(rendered).not.toContain(assertions[0]);
    expect(rendered).toContain("client_assertion=[client_assertion]");
  });

  it("redacts a client assertion echoed in an OAuth error description", async () => {
    let assertion = "";
    const client = createAbmClient({
      tokenUrl: "https://account.example.test/token",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        assertion = new URLSearchParams(String(init?.body)).get("client_assertion") ?? "";

        return jsonResponse(
          { error: "invalid_client", error_description: `bad client_assertion=${assertion}` },
          400,
        );
      }) satisfies typeof globalThis.fetch,
    });

    const failure = await Effect.runPromise(
      Effect.flip(client.exchangeAccessToken(await makeCredential())),
    );

    expect(assertion).not.toBe("");
    expect(failure).toMatchObject({ kind: "unauthorized" });
    expect(failure.message).not.toContain(assertion);
    expect(failure.message).toContain("client_assertion=[client_assertion]");
  });
});

describe("Apple collection response validation", () => {
  it("accepts explicit empty collection arrays", async () => {
    const abm = createAbmClient({
      businessBaseUrl: "https://api.example.test/v1",
      fetch: (async () => jsonResponse({ data: [] })) satisfies typeof globalThis.fetch,
    });
    const vpp = makeVppClient({
      baseUrl: "https://vpp.example.test/mdm",
      fetch: (async () =>
        jsonResponse({ assets: [], totalPages: 1 })) satisfies typeof globalThis.fetch,
    });

    await expect(Effect.runPromise(abm.listOrgDevices("access-token"))).resolves.toEqual([]);
    await expect(Effect.runPromise(vpp.listAssets("content-token"))).resolves.toEqual([]);
  });

  it.each([
    {},
    { data: {} },
    { data: [{ attributes: { serialNumber: "SERIAL-1" } }] },
    { data: [{ id: "" }] },
  ])("rejects a malformed ABM device page: %j", async (page) => {
    const client = createAbmClient({
      businessBaseUrl: "https://api.example.test/v1",
      fetch: (async () => jsonResponse(page)) satisfies typeof globalThis.fetch,
    });

    const failure = await Effect.runPromise(Effect.flip(client.listOrgDevices("access-token")));

    expect(failure).toMatchObject({ kind: "invalid_response" });
  });

  it.each([{}, { assets: {} }, { assets: [{}], totalPages: 1 }, { assets: [], totalPages: 0 }])(
    "rejects a malformed Apps and Books asset page: %j",
    async (page) => {
      const client = makeVppClient({
        baseUrl: "https://vpp.example.test/mdm",
        fetch: (async () => jsonResponse(page)) satisfies typeof globalThis.fetch,
      });

      const failure = await Effect.runPromise(Effect.flip(client.listAssets("content-token")));

      expect(failure).toMatchObject({ kind: "invalid_response" });
    },
  );
});

describe("Apple pagination bounds", () => {
  it("rejects ABM pages before accumulating more than 5000 devices", async () => {
    let calls = 0;
    const client = createAbmClient({
      businessBaseUrl: "https://api.example.test/v1",
      fetch: (async () => {
        const pageIndex = calls++;

        return jsonResponse({
          data: Array.from({ length: 1000 }, (_, index) => ({
            id: `device-${pageIndex}-${index}`,
          })),
          links:
            pageIndex < 5
              ? { next: `https://api.example.test/v1/orgDevices?page=${pageIndex + 1}` }
              : undefined,
        });
      }) satisfies typeof globalThis.fetch,
    });

    const failure = await Effect.runPromise(Effect.flip(client.listOrgDevices("access-token")));

    expect(failure).toMatchObject({ kind: "invalid_response" });
    expect(failure.message).toContain("5000");
    expect(calls).toBe(5);
  });

  it("rejects oversized Apps and Books pagination before accumulating pages", async () => {
    let calls = 0;
    const client = makeVppClient({
      baseUrl: "https://vpp.example.test/mdm",
      fetch: (async () => {
        calls++;

        return jsonResponse({
          assets: [{ adamId: "361309726" }],
          totalPages: 101,
        });
      }) satisfies typeof globalThis.fetch,
    });

    const failure = await Effect.runPromise(Effect.flip(client.listAssets("content-token")));

    expect(failure).toMatchObject({ kind: "invalid_response" });
    expect(failure.message).toContain("100 pages");
    expect(calls).toBe(1);
  });
});
