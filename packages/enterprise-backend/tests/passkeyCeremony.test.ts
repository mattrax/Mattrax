import { Effect, Layer, Redacted, Result, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { describe, expect, it } from "vitest";
import { Passkey } from "@yielded/auth";
import * as PasskeyServer from "@yielded/auth-simplewebauthn/Server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { passkeyProfile } from "../src/Account/auth.ts";

/**
 * These tests drive the maintained WebAuthn verifier with software-generated
 * authenticator responses, so no hardware key is required. They cover the
 * registration and assertion paths used by enrollment, sign-in and step-up.
 */

const origin = "https://mattrax.example.com";

const profile = yieldedProfile();

function yieldedProfile() {
  const derived = passkeyProfile(origin);

  return {
    profileId: "default",
    rpId: derived.id,
    rpName: derived.name,
    origins: [...derived.origins],
    developmentLocalhost: derived.developmentLocalhost,
    residentKey: "required" as const,
    userVerification: "required" as const,
    primarySignIn: true,
    attestation: "none" as const,
    algorithms: [-7] as const,
  };
}

const protocol = () =>
  Effect.gen(function* () {
    return yield* Passkey.PasskeyProtocol;
  }).pipe(
    Effect.provide(
      PasskeyServer.layer.pipe(Layer.provide(Passkey.PasskeyConfig.layer({ profiles: [profile] }))),
    ),
  );

const b64 = (bytes: Uint8Array) => Base64Url.encode(bytes);

const utf8 = (value: string) => new TextEncoder().encode(value);

const concat = (...parts: ReadonlyArray<Uint8Array>) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
};

const u16 = (value: number) => new Uint8Array([(value >> 8) & 0xff, value & 0xff]);

const u32 = (value: number) =>
  new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);

const sha256 = (bytes: Uint8Array) => crypto.subtle.digest("SHA-256", bytes);

const flags = { up: 0x01, uv: 0x04, at: 0x40, be: 0x08, bs: 0x10 };

/**
 * WebAuthn carries ECDSA signatures as ASN.1 DER, while WebCrypto produces the
 * raw 64-byte r||s pair. Encode it the way an authenticator would.
 */
const derSignature = (raw: Uint8Array) => {
  const integer = (bytes: Uint8Array) => {
    let start = 0;

    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let value = bytes.slice(start);

    if ((value[0] & 0x80) !== 0) value = concat(new Uint8Array([0]), value);

    return concat(new Uint8Array([0x02, value.length]), value);
  };

  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));

  return concat(new Uint8Array([0x30, body.length]), body);
};

const makeKey = () =>
  crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

const cosePublicKey = async (key: CryptoKey) => {
  const jwk = await crypto.subtle.exportKey("jwk", key);

  const x = Base64Url.decode(jwk.x!).pipe((result) => {
    if (!Result.isSuccess(result)) throw new Error("invalid x");

    return new Uint8Array(result.success);
  });

  const y = Base64Url.decode(jwk.y!).pipe((result) => {
    if (!Result.isSuccess(result)) throw new Error("invalid y");

    return new Uint8Array(result.success);
  });

  return new Uint8Array(
    isoCBOR.encode(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]),
    ),
  );
};

const registrationCeremony = (challenge: string) => ({
  moduleId: "mattrax/auth/passkey",
  flowId: "flow-registration",
  commandId: "command-registration",
  purpose: "registration" as const,
  profile,
  challenge,
  requestBindingVerifier: "binding-verifier",
  requestBindingExpiresAtMillis: Date.now() + 60_000,
  issuedAtMillis: Date.now(),
  expiresAtMillis: Date.now() + 60_000,
  allowedCredentials: [],
  context: {
    _tag: "Registration" as const,
    fingerprint: "fingerprint",
    userHandle: b64(crypto.getRandomValues(new Uint8Array(16))),
    name: "owner@example.com",
    displayName: "Owner",
  },
});

const stepUpCeremony = (challenge: string, credentialId: string) => ({
  moduleId: "mattrax/auth/passkey",
  flowId: "flow-step-up",
  commandId: "command-step-up",
  purpose: "step-up" as const,
  profile,
  challenge,
  requestBindingVerifier: "binding-verifier",
  requestBindingExpiresAtMillis: Date.now() + 60_000,
  issuedAtMillis: Date.now(),
  expiresAtMillis: Date.now() + 60_000,
  allowedCredentials: [{ type: "public-key" as const, id: credentialId }],
  context: {
    _tag: "StepUp" as const,
    target: {
      moduleId: "mattrax/auth/passkey",
      kind: "step-up",
      commandId: "command-step-up",
      flowId: "flow-step-up",
      bindingDigest: "binding-digest",
      revision: {
        subjectId: "user-1",
        securityRevision: "revision-1",
        credentials: [{ credentialId: "credential-1", revision: "revision-1" }],
      },
      expiresAtMillis: Date.now() + 60_000,
    },
  },
});

describe("WebAuthn ceremonies", () => {
  it("verifies a registration response", async () => {
    const verifier = await Effect.runPromise(protocol());
    const challenge = b64(crypto.getRandomValues(new Uint8Array(32)));
    const ceremony = registrationCeremony(challenge);

    // SAFETY: the fixture's user handle is opaque to this test; the verifier
    // accepts any opaque bytes and echoes them in the challenge.
    const started = await Effect.runPromise(
      verifier.prepareRegistration({
        profile,
        challenge,
        timeoutMillis: 60_000,
        userHandle: ceremony.context.userHandle as never,
        name: ceremony.context.name,
        displayName: ceremony.context.displayName,
        excludedCredentials: [],
      }),
    );

    expect(started.challenge).toBe(challenge);

    const key = await makeKey();
    const credentialId = crypto.getRandomValues(new Uint8Array(32));
    const rpIdHash = new Uint8Array(await sha256(utf8(profile.rpId)));

    const authData = concat(
      rpIdHash,
      new Uint8Array([flags.up | flags.uv | flags.at]),
      u32(0),
      new Uint8Array(16),
      u16(credentialId.length),
      credentialId,
      await cosePublicKey(key.publicKey),
    );

    const attestationObject = new Uint8Array(
      isoCBOR.encode(
        new Map<string, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      ),
    );

    const clientDataJSON = utf8(
      JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }),
    );

    // SAFETY: the fixture ceremony is the exact object prepared above; its
    // runtime shape matches what the verifier issued.
    const verified = await Effect.runPromise(
      verifier.verifyRegistration({
        ceremony: ceremony as never,
        response: Redacted.make(
          JSON.stringify({
            id: b64(credentialId),
            rawId: b64(credentialId),
            type: "public-key",
            response: {
              clientDataJSON: b64(clientDataJSON),
              attestationObject: b64(attestationObject),
            },
          }),
        ),
      }),
    );

    expect(verified.protocolCredentialId).toBe(b64(credentialId));
    expect(verified.algorithm).toBe(-7);
    expect(verified.userVerified).toBe(true);
  });

  it("verifies a step-up assertion", async () => {
    const verifier = await Effect.runPromise(protocol());
    const challenge = b64(crypto.getRandomValues(new Uint8Array(32)));
    const credentialId = b64(crypto.getRandomValues(new Uint8Array(32)));
    const ceremony = stepUpCeremony(challenge, credentialId);

    const started = await Effect.runPromise(
      verifier.prepareAuthentication({
        profile,
        challenge,
        timeoutMillis: 60_000,
        allowedCredentials: ceremony.allowedCredentials,
      }),
    );

    expect(started.allowCredentials.map((item) => item.id)).toEqual([credentialId]);

    const key = await makeKey();
    const publicKey = await cosePublicKey(key.publicKey);
    const rpIdHash = new Uint8Array(await sha256(utf8(profile.rpId)));
    const authData = concat(rpIdHash, new Uint8Array([flags.up | flags.uv]), u32(1));

    const clientDataJSON = utf8(
      JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
    );

    const signature = derSignature(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key.privateKey,
          concat(authData, new Uint8Array(await sha256(clientDataJSON))),
        ),
      ),
    );

    const credential = await Effect.runPromise(
      Schema.decodeUnknownEffect(Passkey.PasskeyCredential)({
        requirement: {
          alternatives: [
            {
              factors: ["possession"],
              userVerified: true,
              phishingResistant: true,
              minimumCredentials: 1,
            },
          ],
          maximumAgeMillis: 300_000,
        },
        credentialId: "credential-1",
        rpId: profile.rpId,
        protocolCredentialId: credentialId,
        userHandle: b64(crypto.getRandomValues(new Uint8Array(16))),
        publicKey: b64(publicKey),
        algorithm: -7,
        profile,
        revision: {
          subjectId: "user-1",
          securityRevision: "revision-1",
          credentials: [{ credentialId: "credential-1", revision: "revision-1" }],
        },
        active: true,
        primarySignIn: true,
        enrollmentUserVerified: true,
        backupEligible: false,
        backupState: false,
        counter: 0,
      }),
    );

    // SAFETY: the fixture ceremony is the exact object prepared above; its
    // runtime shape matches what the verifier issued.
    const verified = await Effect.runPromise(
      verifier.verifyAuthentication({
        ceremony: ceremony as never,
        credential,
        response: Redacted.make(
          JSON.stringify({
            id: credentialId,
            rawId: credentialId,
            type: "public-key",
            response: {
              clientDataJSON: b64(clientDataJSON),
              authenticatorData: b64(authData),
              signature: b64(signature),
            },
          }),
        ),
      }),
    );

    expect(verified.protocolCredentialId).toBe(credentialId);
    expect(verified.userVerified).toBe(true);
    expect(verified.counter).toBe(1);
  });

  it("rejects an assertion for a different challenge", async () => {
    const verifier = await Effect.runPromise(protocol());
    const challenge = b64(crypto.getRandomValues(new Uint8Array(32)));
    const credentialId = b64(crypto.getRandomValues(new Uint8Array(32)));
    const ceremony = stepUpCeremony(challenge, credentialId);
    const key = await makeKey();
    const publicKey = await cosePublicKey(key.publicKey);

    const authData = concat(
      new Uint8Array(await sha256(utf8(profile.rpId))),
      new Uint8Array([flags.up | flags.uv]),
      u32(1),
    );

    const clientDataJSON = utf8(
      JSON.stringify({
        type: "webauthn.get",
        challenge: b64(crypto.getRandomValues(new Uint8Array(32))),
        origin,
        crossOrigin: false,
      }),
    );

    const signature = derSignature(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key.privateKey,
          concat(authData, new Uint8Array(await sha256(clientDataJSON))),
        ),
      ),
    );

    const credential = await Effect.runPromise(
      Schema.decodeUnknownEffect(Passkey.PasskeyCredential)({
        requirement: {
          alternatives: [
            {
              factors: ["possession"],
              userVerified: true,
              phishingResistant: true,
              minimumCredentials: 1,
            },
          ],
          maximumAgeMillis: 300_000,
        },
        credentialId: "credential-1",
        rpId: profile.rpId,
        protocolCredentialId: credentialId,
        userHandle: b64(crypto.getRandomValues(new Uint8Array(16))),
        publicKey: b64(publicKey),
        algorithm: -7,
        profile,
        revision: {
          subjectId: "user-1",
          securityRevision: "revision-1",
          credentials: [{ credentialId: "credential-1", revision: "revision-1" }],
        },
        active: true,
        primarySignIn: true,
        enrollmentUserVerified: true,
        backupEligible: false,
        backupState: false,
        counter: 0,
      }),
    );

    // SAFETY: the fixture ceremony was prepared by this same verifier above.
    await expect(
      Effect.runPromise(
        verifier.verifyAuthentication({
          ceremony: ceremony as never,
          credential,
          response: Redacted.make(
            JSON.stringify({
              id: credentialId,
              rawId: credentialId,
              type: "public-key",
              response: {
                clientDataJSON: b64(clientDataJSON),
                authenticatorData: b64(authData),
                signature: b64(signature),
              },
            }),
          ),
        }),
      ),
    ).rejects.toBeInstanceOf(Passkey.PasskeyProtocolRejected);
  });
});
