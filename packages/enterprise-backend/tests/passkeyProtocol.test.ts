import { Effect, Layer } from "effect";
import { Passkey } from "@yielded/auth";
import { Base64Url } from "effect/encoding";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "vitest";
import {
  PASSKEY_PROFILE_INVALID,
  PASSKEY_VERIFIER_LOAD_FAILED,
  makePasskeyProtocolLayer,
} from "../src/Account/auth.ts";

/**
 * The passkey protocol layer is a lazy wrapper around the WebAuthn verifier, so
 * these tests drive the wrapper itself: the injectable loader decides whether
 * the chunk resolves, rejects, or is merely counted.
 */

/** A relying party the real WebAuthn verifier accepts. */
const rpConfig = { id: "example.com", name: "Mattrax", origins: ["https://example.com"] } as const;

/** 32 bytes of base64url: the minimum WebAuthn challenge length. */
const challenge = Base64Url.encode(new TextEncoder().encode("mattrax-test-challenge-0123456789"));

/** The config layer the API builds from the deployment origin. */
const configLayer = (config: Parameters<typeof Passkey.PasskeyConfig.layer>[0]) =>
  Passkey.PasskeyConfig.layer(config);

/**
 * Run a program against the lazy protocol layer with console capture. The layer
 * is built inside the provided effect, exactly as the API builds it per request.
 */
const withProtocol = <A, E>(
  program: Effect.Effect<A, E, Passkey.PasskeyProtocol | Passkey.PasskeyConfig>,
  options: {
    readonly load?: Parameters<typeof makePasskeyProtocolLayer>[0];
    readonly config?: Parameters<typeof Passkey.PasskeyConfig.layer>[0];
  } = {},
) => {
  const config = configLayer(options.config ?? rpConfig);

  return program.pipe(
    Effect.provide(
      Layer.merge(makePasskeyProtocolLayer(options.load).pipe(Layer.provide(config)), config),
    ),
    Effect.provide(TestConsole.layer),
  );
};

/** Prepare one authentication ceremony with the configured profile. */
const prepareAuthentication = Effect.gen(function* () {
  const protocol = yield* Passkey.PasskeyProtocol;
  const config = yield* Passkey.PasskeyConfig;
  const profile = config.profiles[0];

  if (!profile) throw new Error("the test config has no profile");

  return yield* protocol.prepareAuthentication({
    profile,
    challenge,
    timeoutMillis: 60_000,
    allowedCredentials: [],
  });
});

/** Everything the default logger wrote during the program, as searchable text. */
const loggedLines = Effect.gen(function* () {
  const logs = yield* TestConsole.logLines;
  const errors = yield* TestConsole.errorLines;

  return [...logs, ...errors].map((entry) =>
    typeof entry === "string" ? entry : JSON.stringify(entry),
  );
});

/** The ceremony's typed failure, flipped into the success channel. */
const prepareAuthenticationFailure = Effect.gen(function* () {
  const error = yield* Effect.flip(prepareAuthentication);
  const lines = yield* loggedLines;

  return { error: error as { readonly _tag?: string }, lines };
});

describe("lazy passkey protocol layer", () => {
  it("imports the verifier on the first ceremony, not when the layer is built", async () => {
    let loads = 0;

    const load = async () => {
      loads += 1;

      return import("@yielded/auth-simplewebauthn/Server");
    };

    const options = await Effect.runPromise(
      withProtocol(
        Effect.gen(function* () {
          // The layer has been built by now; building it must not import.
          expect(loads).toBe(0);

          return yield* prepareAuthentication;
        }),
        { load },
      ),
    );

    expect(loads).toBe(1);
    expect(options.rpId).toBe(rpConfig.id);
    expect(options.challenge).toBe(challenge);
  });

  it("loads one verifier for concurrent first ceremonies", async () => {
    let loads = 0;

    const load = async () => {
      loads += 1;

      return import("@yielded/auth-simplewebauthn/Server");
    };

    const options = await Effect.runPromise(
      withProtocol(
        Effect.all([prepareAuthentication, prepareAuthentication, prepareAuthentication], {
          concurrency: "unbounded",
        }),
        { load },
      ),
    );

    expect(loads).toBe(1);
    expect(options.map((value) => value.rpId)).toEqual([rpConfig.id, rpConfig.id, rpConfig.id]);
  });

  it("fails closed with PasskeyUnavailable and logs the cause when the chunk is rejected", async () => {
    const { error, lines } = await Effect.runPromise(
      withProtocol(prepareAuthenticationFailure, {
        load: async () => {
          throw new Error("chunk load failed");
        },
      }),
    );

    // Reaching this line proves the failure is typed, not a defect.
    expect(error._tag).toBe("PasskeyUnavailable");
    expect(lines.some((line) => line.includes(PASSKEY_VERIFIER_LOAD_FAILED))).toBe(true);
    expect(lines.some((line) => line.includes("chunk load failed"))).toBe(true);
  });

  it("logs a rejected relying-party profile and fails closed", async () => {
    const { error, lines } = await Effect.runPromise(
      withProtocol(prepareAuthenticationFailure, {
        // Plain HTTP cannot host WebAuthn, so the real verifier rejects it.
        config: { id: "example.com", name: "Mattrax", origins: ["http://example.com"] },
      }),
    );

    expect(error._tag).toBe("PasskeyUnavailable");
    expect(lines.some((line) => line.includes(PASSKEY_PROFILE_INVALID))).toBe(true);
    expect(lines.some((line) => line.includes("example.com"))).toBe(true);
  });
});
