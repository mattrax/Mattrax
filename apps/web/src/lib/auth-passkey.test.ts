// @vitest-environment happy-dom
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installGlobal } from "../../../../packages/config/testing/globals.ts";
import { WebAuthnCeremony, authClient } from "./auth";
import type { PasskeyCeremony, PasskeyCeremonyRun, PasskeyFlowOptions } from "./auth";

type CapturedRequest = { readonly method: string; readonly url: string };

/** Fixed expiry for the ceremony start fixture. */
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

/** A recording HttpClient layer replaces a global fetch stub. */
const transport = {
  requests: [] as CapturedRequest[],
  responses: [] as Response[],
};

const recordingTransport = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      transport.requests.push({ method: request.method, url: request.url });

      return HttpClientResponse.fromWeb(request, transport.responses.shift() ?? Response.json({}));
    }),
  ),
);

const credential: AuthenticationResponseJSON = {
  id: "credential-1",
  rawId: "credential-1",
  type: "public-key",
  response: {
    authenticatorData: "data",
    clientDataJSON: "data",
    signature: "signature",
    userHandle: undefined,
  },
  clientExtensionResults: {},
  authenticatorAttachment: "platform",
};

const ceremonyCalls: string[] = [];
let authenticate: PasskeyCeremony["startAuthentication"];
const fakeCeremony: PasskeyCeremony = {
  startAuthentication: (options) => {
    ceremonyCalls.push("startAuthentication");

    return authenticate(options);
  },
  startRegistration: () => {
    ceremonyCalls.push("startRegistration");

    return Promise.reject(new Error("unexpected registration ceremony"));
  },
};

/** Provide the ceremony service with Effect.provideService, not a module mock. */
const runCeremony: PasskeyCeremonyRun = (use) =>
  Effect.runPromise(
    Effect.flatMap(WebAuthnCeremony, (ceremony) => Effect.promise(() => use(ceremony))).pipe(
      Effect.provideService(WebAuthnCeremony, fakeCeremony),
    ),
  );

const injected: PasskeyFlowOptions = {
  ceremonyRun: runCeremony,
  transport: recordingTransport,
};

const NativeRequest = globalThis.Request;
const requestStart = {
  flowId: "flow-1",
  expiresAtMillis: NOW + 60_000,
  options: { challenge: "challenge" },
};

/** Environment scaffolding only: Node's Request rejects relative API paths. */
const installBrowserRequest = () =>
  installGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === "string" && input.startsWith("/")
            ? new URL(input, "https://mattrax.test")
            : input,
          init,
        );
      }
    },
  );

const installEnvironment = () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: class PublicKeyCredential {},
  });
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get: () => Promise.resolve(null) },
  });
};

let restoreRequest = () => {};

beforeEach(() => {
  restoreRequest = installBrowserRequest();
  installEnvironment();
  transport.requests.length = 0;
  transport.responses.length = 0;
  ceremonyCalls.length = 0;
  authenticate = () => Promise.reject(new Error("WebAuthn ceremony not configured"));
});

afterEach(() => {
  restoreRequest();
  restoreRequest = () => {};
});

describe("passkey sign-in ceremony", () => {
  it("does not start a server flow when WebAuthn is unavailable", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });

    await expect(authClient.passkeySignIn(injected)).resolves.toEqual({
      error: {
        tag: "PasskeyUnsupported",
        message: expect.stringContaining("HTTPS"),
      },
    });
    expect(transport.requests).toEqual([]);
    expect(ceremonyCalls).toEqual([]);
  });

  it("preserves a cancellation tag and never calls completion", async () => {
    transport.responses.push(Response.json({ _tag: "Success", value: requestStart }));
    authenticate = () =>
      Promise.reject(new DOMException("The operation was canceled.", "NotAllowedError"));

    await expect(authClient.passkeySignIn(injected)).resolves.toEqual({
      error: {
        tag: "PasskeyCancelled",
        message: expect.stringContaining("cancelled"),
      },
    });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.url).toContain("/beginPasskeySignIn");
    expect(ceremonyCalls).toEqual(["startAuthentication"]);
  });

  it("preserves a missing-authenticator tag without claiming rejection", async () => {
    transport.responses.push(Response.json({ _tag: "Success", value: requestStart }));
    authenticate = () =>
      Promise.reject(new DOMException("No available authenticator", "NotAllowedError"));

    const result = await authClient.passkeySignIn(injected);

    expect(result.error?.tag).toBe("PasskeyNoAuthenticator");
    expect(result.error?.message).not.toContain("wasn't accepted");
    expect(transport.requests).toHaveLength(1);
    expect(ceremonyCalls).toEqual(["startAuthentication"]);
  });

  it("preserves an actual server rejection tag", async () => {
    transport.responses.push(
      Response.json({ _tag: "Success", value: requestStart }),
      Response.json({ _tag: "Failure", error: { _tag: "PasskeyRejected" } }, { status: 400 }),
    );
    authenticate = () => Promise.resolve(credential);

    await expect(authClient.passkeySignIn(injected)).resolves.toMatchObject({
      error: { tag: "PasskeyRejected" },
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]!.url).toContain("/completePasskeySignIn");
    expect(ceremonyCalls).toEqual(["startAuthentication"]);
  });
});
