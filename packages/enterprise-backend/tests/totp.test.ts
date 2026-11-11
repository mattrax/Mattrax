import { describe, expect, it } from "vitest";
import { Effect, Layer, Redacted } from "effect";
import { Schema as AuthSchema, Totp } from "@yielded/auth";
import * as WebCrypto from "@yielded/auth/WebCrypto";
import { deriveTotpSecretKey } from "../src/auth.ts";

const secretKeys = (key: Uint8Array) =>
  Layer.succeed(
    Totp.TotpSecretKeys,
    Totp.TotpSecretKeys.of({
      current: Effect.succeed({ keyId: "v1", key: Redacted.make(key) }),
      get: (keyId) =>
        keyId === "v1"
          ? Effect.succeed(Redacted.make(key))
          : Effect.fail(Totp.TotpUnavailable.make({})),
    }),
  );

describe("TOTP secret storage", () => {
  it("derives a 32-byte key from AUTH_SECRET", async () => {
    const first = await deriveTotpSecretKey("first-secret");
    const second = await deriveTotpSecretKey("second-secret");
    expect(first).toHaveLength(32);
    expect(Buffer.from(first)).not.toEqual(Buffer.from(second));
  });

  it("stores an encrypted envelope rather than the secret", async () => {
    const key = await deriveTotpSecretKey("test-secret");
    const program = Effect.gen(function* () {
      const cryptography = yield* Totp.TotpCryptography;
      const secret = yield* cryptography.generateSecret;
      const binding = {
        moduleId: "mattrax/auth/totp",
        subjectId: AuthSchema.SubjectId.make("subject-1"),
        credentialId: "credential-1",
        revision: "revision-1",
      } as const;
      const envelope = yield* cryptography.encryptSecret(binding, secret);
      const stored = JSON.stringify(envelope);
      expect(stored).not.toContain(Buffer.from(secret).toString("base64"));
      expect(stored).not.toContain(Buffer.from(secret).toString("hex"));
      const decrypted = yield* cryptography.decryptSecret(binding, envelope);
      expect(Buffer.from(decrypted)).toEqual(Buffer.from(secret));
    });
    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Totp.TotpCryptography.layer.pipe(
            Layer.provide(secretKeys(key)),
            Layer.provide(WebCrypto.layer),
          ),
        ),
      ),
    );
  });
});
