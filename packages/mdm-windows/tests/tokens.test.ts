import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { CryptoError, Mac } from "effect/crypto";
import {
  WindowsTokenService,
  WindowsTokenServiceLayer,
  createWindowsEnrollmentToken,
  createWindowsTenantToken,
  verifyWindowsEnrollmentTokenDetailed,
  verifyWindowsTenantTokenDetailed,
} from "../src/tokens.js";

const failure = new CryptoError.CryptoError({
  module: "Mac",
  method: "sign",
  reason: new CryptoError.Unsupported({ description: "injected crypto failure" }),
});

const failingMac = Layer.succeed(Mac.Mac, {
  generateKey: () => Effect.fail(failure),
  sign: () => Effect.fail(failure),
  verify: () => Effect.fail(failure),
} as Mac.Mac["Service"]);

describe("Windows token crypto failures", () => {
  it("keeps signing and verification failures in the typed error channel", async () => {
    const program = Effect.gen(function* () {
      const tokens = yield* WindowsTokenService;
      const created = yield* tokens.createEnrollmentToken("subject", "secret").pipe(Effect.result);
      const verified = yield* tokens
        .verifyEnrollmentTokenDetailed("subject.1.AAAA", "secret")
        .pipe(Effect.result);

      return { created, verified };
    }).pipe(Effect.provide(WindowsTokenServiceLayer.pipe(Layer.provide(failingMac))));
    const result = await Effect.runPromise(program);

    expect(result.created).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "WindowsTokenError", reason: "crypto" },
    });
    expect(result.verified).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "WindowsTokenError", reason: "crypto" },
    });
  });

  it("retains the promise compatibility API", async () => {
    const now = 1_700_000_000_000;
    const enrollment = await createWindowsEnrollmentToken("subject", "secret", { now });
    const tenant = await createWindowsTenantToken("org-1", "secret", { now });

    await expect(
      verifyWindowsEnrollmentTokenDetailed(enrollment, "secret", { now }),
    ).resolves.toMatchObject({ verification: { subject: "subject" }, expired: false });
    await expect(
      verifyWindowsTenantTokenDetailed(tenant, "secret", { now }),
    ).resolves.toMatchObject({
      verification: { organizationId: "org-1" },
      expired: false,
    });
  });
});
