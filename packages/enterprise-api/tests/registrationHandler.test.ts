// The handler only reads url, method and headers; building the rest of the
// server request would test the framework instead of the registration flow.
// oxlint-disable quality/no-chained-type-assertions
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import type { OutboundEmailMessage } from "@mattrax/email";
import { EnterpriseService, enterpriseAccountApi } from "@mattrax/enterprise-domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, makeHttpHandler, schema } from "./helpers.js";

const state = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock("email-verification-api", () => ({ verifyEmailToken: state.verify }));

import { createEnterpriseService } from "../src/enterpriseHandlers.js";
import { enterpriseAccountHandlers } from "../src/enterpriseHandlers.js";

const origin = "https://mattrax.test";

const request = (cookie?: string) =>
  ({
    url: `${origin}/api/v1/register/verification`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
      "x-mattrax-public-origin": origin,
    },
  }) as unknown as HttpServerRequest;

const cookieFor = (nonce: string) => `mattrax_register_nonce=${nonce}`;

const makeService = () => {
  const db = makeDb();
  const sent: OutboundEmailMessage[] = [];
  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: the guest registration endpoints never touch storage or the
    // session auth service; the fakes only satisfy constructor requirements.
    storage: {} as never,
    auth: {} as never,
    authSecret: "registration-handler-test-secret",
    email: {
      local: true,
      send: (message) =>
        Effect.sync(() => {
          sent.push(message);
        }),
    },
  });

  return { db, service, sent };
};

type RegistrationResult = {
  readonly body: {
    readonly status: string;
    readonly emailSent: boolean;
    readonly verified?: boolean;
    readonly grant?: string;
    readonly nonce?: string;
  };
  readonly headers: Readonly<Record<string, string | undefined>>;
};

const sendCode = (
  service: ReturnType<typeof makeService>["service"],
  payload: { name: string; email: string; token?: string; nonce?: string },
  cookie?: string,
): Promise<RegistrationResult> =>
  Effect.runPromise(service.requestRegistrationCode(request(cookie), payload));

beforeEach(() => {
  state.verify.mockReset();
});

describe("requestRegistrationCode Email Verification API", () => {
  it("verifies the token, skips the email and marks the registration verified", async () => {
    state.verify.mockResolvedValue({ ok: true });
    const { db, service, sent } = makeService();

    const result = await sendCode(
      service,
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        token: "evt-token",
        nonce: "nonce-1",
      },
      cookieFor("nonce-1"),
    );

    expect(result.body).toMatchObject({ status: "ok", emailSent: false, verified: true });
    expect(result.body.grant).toEqual(expect.any(String));
    expect(result.headers["set-cookie"]).toContain("mattrax_register_nonce=");
    expect(result.headers["set-cookie"]).not.toContain("nonce-1");
    expect(sent).toHaveLength(0);
    expect(db.store.registration_verification[0]).toMatchObject({
      email: "ada@example.com",
      grant: result.body.grant,
    });
    expect(db.store.registration_verification[0]?.verifiedAt).toBeInstanceOf(Date);
    expect(state.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        token: "evt-token",
        nonce: "nonce-1",
        audience: origin,
      }),
    );
  });

  it("falls through to the emailed code when verification fails", async () => {
    state.verify.mockResolvedValue({ ok: false });
    const { db, service, sent } = makeService();

    const result = await sendCode(
      service,
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        token: "bad-token",
        nonce: "nonce-1",
      },
      cookieFor("nonce-1"),
    );

    expect(result.body).toMatchObject({ status: "ok", emailSent: true });
    expect(result.body.verified).toBeUndefined();
    expect(result.body.grant).toBeUndefined();
    expect(result.headers["set-cookie"]).toContain("mattrax_register_nonce=");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers).toEqual({ "OTP-Token": expect.stringMatching(/^\d{6}$/) });
    expect(db.store.registration_verification[0]?.verifiedAt).toBeNull();
  });

  it("never calls the verifier for a token whose nonce is not this session's", async () => {
    const { service, sent } = makeService();

    const result = await sendCode(
      service,
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        token: "evt-token",
        nonce: "stale-nonce",
      },
      cookieFor("current-nonce"),
    );

    expect(result.body).toMatchObject({ status: "ok", emailSent: true });
    expect(state.verify).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it("serialises the rotated nonce as a Set-Cookie on the HTTP response", async () => {
    state.verify.mockResolvedValue({ ok: true });
    const { service } = makeService();
    const api = HttpApi.make("RegistrationNonceHttpTest").add(enterpriseAccountApi);
    const layer = HttpApiBuilder.layer(api).pipe(
      Layer.provide(
        HttpApiBuilder.group(api, "EnterpriseAccount", (handlers) =>
          enterpriseAccountHandlers(handlers),
        ),
      ),
      Layer.provide(Layer.succeed(EnterpriseService, service as never)),
      Layer.provide(HttpRouter.layer),
      Layer.provide(HttpServer.layerServices),
    );
    const handler = makeHttpHandler(layer);
    const response = await handler(
      new Request(`${origin}/api/v1/register/verification`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: cookieFor("nonce-1"),
          "x-mattrax-public-origin": origin,
        },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@example.com",
          token: "evt-token",
          nonce: "nonce-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    const body = (await response.json()) as {
      verified?: boolean;
      grant?: string;
      nonce?: string;
    };

    expect(body.verified).toBe(true);
    expect(body.nonce).toEqual(expect.any(String));
    expect(cookie).toContain(`mattrax_register_nonce=${body.nonce}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("behaves exactly like today when no token is submitted", async () => {
    const { service, sent } = makeService();

    const result = await sendCode(
      service,
      { name: "Ada Lovelace", email: "ada@example.com" },
      cookieFor("nonce-1"),
    );

    expect(result.body).toMatchObject({ status: "ok", emailSent: true });
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(state.verify).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
});
