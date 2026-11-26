import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signToken, verifyToken } from "./tokens.js";

const secret = "token-test-secret";

const payload = {
  sub: "user-1",
  email: "owner@example.com",
  exp: 1_000,
  purpose: "test",
} as const;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/** Sign an arbitrary body so malformed JSON/schema tests reach the decoder. */
const signBody = async (body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));

  return `${body}.${base64Url(new Uint8Array(signature))}`;
};

const expectTokenError = async (effect: Effect.Effect<unknown, unknown>, reason: string) => {
  await expect(Effect.runPromise(effect)).rejects.toMatchObject({ _tag: "TokenError", reason });
};

afterEach(() => vi.restoreAllMocks());

describe("enterprise token codec", () => {
  it("round-trips a signed payload", async () => {
    const token = await Effect.runPromise(signToken(secret, payload));

    await expect(Effect.runPromise(verifyToken(secret, token))).resolves.toEqual(payload);
  });

  it("returns a typed error for malformed token structure and base64", async () => {
    for (const token of ["", "missing-signature", "a.b.c", "body.%%%"])
      await expectTokenError(verifyToken(secret, token), "malformed");
  });

  it("returns a typed error for a tampered signature", async () => {
    const token = await Effect.runPromise(signToken(secret, payload));
    const [body] = token.split(".");

    await expectTokenError(
      verifyToken(secret, `${body}.${base64Url(new Uint8Array(32))}`),
      "invalid_signature",
    );
  });

  it("returns a typed error for malformed JSON and invalid payloads", async () => {
    const json = base64Url(new TextEncoder().encode("not-json"));
    const schema = base64Url(new TextEncoder().encode(JSON.stringify({ sub: 42 })));

    await expectTokenError(verifyToken(secret, await signBody(json)), "invalid_payload");
    await expectTokenError(verifyToken(secret, await signBody(schema)), "invalid_payload");
  });

  it("returns a typed error when WebCrypto rejects", async () => {
    vi.spyOn(crypto.subtle, "verify").mockRejectedValueOnce(new Error("crypto unavailable"));
    const token = await Effect.runPromise(signToken(secret, payload));

    await expectTokenError(verifyToken(secret, token), "crypto");
  });

  it("returns a typed error when a payload cannot be serialized", async () => {
    class Cyclic {
      readonly self = this;
    }

    await expectTokenError(
      signToken(secret, { ...payload, account: new Cyclic() }),
      "invalid_payload",
    );
  });
});
