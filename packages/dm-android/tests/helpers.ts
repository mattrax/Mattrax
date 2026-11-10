import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { pemEncode } from "@mattrax/crypto";

export type ServiceAccountFixture = {
  readonly clientEmail: string;
  readonly projectId: string;
  readonly privateKeyPem: string;
  readonly publicKey: CryptoKey;
};

const ALGORITHM: RsaHashedKeyGenParams = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

export async function makeServiceAccount(): Promise<ServiceAccountFixture> {
  const pair = (await crypto.subtle.generateKey(ALGORITHM, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    clientEmail: "mattrax-test@test-project.iam.gserviceaccount.com",
    projectId: "test-project",
    privateKeyPem: pemEncode("PRIVATE KEY", pkcs8),
    publicKey: pair.publicKey,
  };
}

export function base64UrlToBytes(input: string): Uint8Array {
  const binary = atob(
    input
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(input.length + ((4 - (input.length % 4)) % 4), "="),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function decodeJwt(token: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT must have three parts");
  const decode = (part: string) => JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
  return {
    header: decode(parts[0]!),
    claims: decode(parts[1]!),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64UrlToBytes(parts[2]!),
  };
}

export async function verifyJwt(token: string, publicKey: CryptoKey): Promise<boolean> {
  const decoded = decodeJwt(token);
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    decoded.signature as BufferSource,
    new TextEncoder().encode(decoded.signingInput) as BufferSource,
  );
}

export type RecordedRequest = {
  readonly url: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | undefined;
};

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

/**
 * Build a `FetchHttpClient` layer backed by an in-memory handler. Every request
 * is recorded for assertions.
 */
export function mockFetch(handler: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: Array<RecordedRequest> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body =
      request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const url = new URL(request.url);
    const recorded: RecordedRequest = {
      url: request.url,
      pathname: url.pathname,
      searchParams: url.searchParams,
      method: request.method,
      headers: request.headers,
      body,
    };
    requests.push(recorded);
    return handler(recorded);
  };
  return {
    requests,
    layer: FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
  };
}

export function jsonBody(request: RecordedRequest): unknown {
  if (request.body === undefined || request.body === "") return undefined;
  return JSON.parse(request.body) as unknown;
}
