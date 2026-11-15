import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { createScepChallenge, verifyScepChallenge } from "../challenge.js";
import { ScepService } from "../service.js";
import { ScepRepository } from "../repository.js";
import { ScepError } from "../schema.js";
import {
  buildPkcsReq,
  buildTestCsr,
  createTestCaCert,
  createTestSignerCert,
  generateKeyPair,
  mockScepRepository,
} from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

function attributeText(attribute: pkijs.AttributeTypeAndValue | undefined): string | undefined {
  if (!attribute || !(attribute.value instanceof asn1js.Utf8String)) return undefined;

  return attribute.value.valueBlock.value;
}

const SECRET = "test-auth-secret";

describe("SCEP challenge", () => {
  it("derives a verifiable challenge from the enrollment id", async () => {
    const challenge = await createScepChallenge("enrollment-1", SECRET);
    expect(challenge.startsWith("enrollment-1.")).toBe(true);
    await expect(verifyScepChallenge(challenge, SECRET)).resolves.toEqual({
      enrollmentId: "enrollment-1",
    });
  });

  it("rejects missing and wrong challenges", async () => {
    await expect(verifyScepChallenge(undefined, SECRET)).resolves.toBeNull();
    const challenge = await createScepChallenge("enrollment-1", SECRET);
    await expect(verifyScepChallenge(challenge, "other-secret")).resolves.toBeNull();
    await expect(verifyScepChallenge("enrollment-1.invalid", SECRET)).resolves.toBeNull();
  });

  it("rejects expired challenges", async () => {
    const now = 1_700_000_000;

    const challenge = await createScepChallenge("enrollment-1", SECRET, {
      ttlSeconds: 60,
      now: now * 1000,
    });

    await expect(
      verifyScepChallenge(challenge, SECRET, { now: now * 1000 + 1_000 }),
    ).resolves.toEqual(expect.objectContaining({ enrollmentId: "enrollment-1" }));
    await expect(
      verifyScepChallenge(challenge, SECRET, { now: (now + 120) * 1000 }),
    ).resolves.toBeNull();
  });

  it("binds a challenge to the enrollment id embedded in it", async () => {
    const challenge = await createScepChallenge("enrollment-a", SECRET);

    await expect(verifyScepChallenge(challenge, SECRET)).resolves.toEqual({
      enrollmentId: "enrollment-a",
    });

    // The id is part of the signed message, so renaming it to another
    // enrollment invalidates the signature.
    await expect(
      verifyScepChallenge(challenge.replace("enrollment-a", "enrollment-b"), SECRET),
    ).resolves.toBeNull();
  });

  it("binds an expiry-bearing challenge to the enrollment id and expiry", async () => {
    const now = 1_700_000_000;

    const challenge = await createScepChallenge("enrollment-a", SECRET, {
      ttlSeconds: 300,
      now: now * 1000,
    });

    expect(challenge.split(".")).toHaveLength(3);
    await expect(
      verifyScepChallenge(challenge.replace("enrollment-a", "enrollment-b"), SECRET, {
        now: now * 1000,
      }),
    ).resolves.toBeNull();

    // Rewriting the expiry must also break the signature.
    const [enrollmentId, expiresAt, signature] = challenge.split(".");
    await expect(
      verifyScepChallenge(`${enrollmentId}.${Number(expiresAt) + 1}.${signature}`, SECRET, {
        now: now * 1000,
      }),
    ).resolves.toBeNull();
  });

  it("invalidates challenges after the auth secret rotates", async () => {
    const now = 1_700_000_000;
    const simple = await createScepChallenge("enrollment-1", SECRET);

    const expiring = await createScepChallenge("enrollment-1", SECRET, {
      ttlSeconds: 300,
      now: now * 1000,
    });

    await expect(verifyScepChallenge(simple, "rotated-secret")).resolves.toBeNull();
    await expect(
      verifyScepChallenge(expiring, "rotated-secret", { now: now * 1000 }),
    ).resolves.toBeNull();
  });

  it("accepts a challenge at exactly its expiry and rejects it one second later", async () => {
    const now = 1_700_000_000;
    const expiresAt = now + 60;

    const challenge = await createScepChallenge("enrollment-1", SECRET, {
      ttlSeconds: 60,
      now: now * 1000,
    });

    await expect(
      verifyScepChallenge(challenge, SECRET, { now: expiresAt * 1000 }),
    ).resolves.toEqual({ enrollmentId: "enrollment-1", expiresAt });
    await expect(
      verifyScepChallenge(challenge, SECRET, { now: (expiresAt + 1) * 1000 }),
    ).resolves.toBeNull();
  });

  it.each([
    ["a one-part value", "enrollment-1"],
    ["a two-part value with an empty signature", "enrollment-1."],
    ["a three-part value with a non-numeric expiry", "enrollment-1.not-a-number.signature"],
    ["a three-part value with an empty expiry", "enrollment-1.."],
    ["a four-part value", `enrollment-1.${1_700_000_000}.signature.extra`],
    ["a four-part value with an empty nonce", `enrollment-1.${1_700_000_000}..signature`],
    ["an empty value", ""],
  ])("rejects %s", async (_name, challenge) => {
    await expect(verifyScepChallenge(challenge, SECRET)).resolves.toBeNull();
  });

  // Characterisation: this helper is deliberately stateless, so it can only
  // prove a value was minted for an enrollment. One-time use is enforced by the
  // persisted challenge store in `@mattrax/management-backend-enterprise`, which
  // is covered by that package's `scep.test.ts`.
  it("can verify the same challenge more than once", async () => {
    const now = 1_700_000_000;

    const challenge = await createScepChallenge("enrollment-1", SECRET, {
      ttlSeconds: 60,
      now: now * 1000,
    });

    const verification = { enrollmentId: "enrollment-1", expiresAt: now + 60 };

    await expect(verifyScepChallenge(challenge, SECRET, { now: now * 1000 })).resolves.toEqual(
      verification,
    );
    await expect(
      verifyScepChallenge(challenge, SECRET, { now: (now + 1) * 1000 }),
    ).resolves.toEqual(verification);
  });

  it("carries and verifies a one-time nonce", async () => {
    const now = 1_700_000_000;

    const challenge = await createScepChallenge("enrollment-1", SECRET, {
      ttlSeconds: 60,
      now: now * 1000,
      nonce: "nonce-a",
    });

    expect(challenge.split(".")).toHaveLength(4);
    await expect(verifyScepChallenge(challenge, SECRET, { now: now * 1000 })).resolves.toEqual({
      enrollmentId: "enrollment-1",
      expiresAt: now + 60,
      nonce: "nonce-a",
    });
  });

  it("binds the nonce and expiry of a one-time challenge", async () => {
    const now = 1_700_000_000;

    const challenge = await createScepChallenge("enrollment-1", SECRET, {
      ttlSeconds: 60,
      now: now * 1000,
      nonce: "nonce-a",
    });

    const [enrollmentId, expiresAt, nonce, signature] = challenge.split(".");

    await expect(
      verifyScepChallenge(`${enrollmentId}.${expiresAt}.nonce-b.${signature}`, SECRET, {
        now: now * 1000,
      }),
    ).resolves.toBeNull();
    await expect(
      verifyScepChallenge(
        `${enrollmentId}.${Number(expiresAt) + 1}.${nonce}.${signature}`,
        SECRET,
        {
          now: now * 1000,
        },
      ),
    ).resolves.toBeNull();
    await expect(
      verifyScepChallenge(challenge, SECRET, { now: (now + 61) * 1000 }),
    ).resolves.toBeNull();
  });

  it("requires a lifetime for a one-time nonce", async () => {
    await expect(createScepChallenge("enrollment-1", SECRET, { nonce: "nonce-a" })).rejects.toThrow(
      "ttlSeconds",
    );
  });
});

async function makeScepHandler(secret: string) {
  const caKeyPair = await generateKeyPair();
  const caCert = await createTestCaCert(caKeyPair, "Challenge SCEP CA");
  const { certToPem } = await import("../pkcs7.js");

  const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey);

  const repoLayer: Layer.Layer<ScepRepository> = mockScepRepository({
    getCa: () => Effect.succeed({ certPem: certToPem(caCert), privateKeyJwk: caPrivateKeyJwk }),
    authenticatePkcsReq: (_scope, req) =>
      Effect.gen(function* () {
        const verification = yield* Effect.tryPromise({
          try: () => verifyScepChallenge(req.challengePassword, secret),
          catch: (cause) => new ScepError({ message: "Failed to verify challenge", cause }),
        });

        if (!verification)
          return yield* Effect.fail(new ScepError({ message: "Invalid SCEP challenge" }));

        return { organizationalUnit: "tenant-from-challenge" };
      }),
  });

  const serviceLayer = ScepService.pipe(Layer.provideMerge(repoLayer));

  const { handler } = HttpRouter.toWebHandler(
    (await import("../routes.js")).scepRoutes.pipe(Layer.provideMerge(serviceLayer)),
  );

  return { handler, caCert, caKeyPair };
}

const pkiOperation = async (
  handler: (request: Request) => Promise<Response>,
  csr: pkijs.CertificationRequest,
  caCert: pkijs.Certificate,
  deviceKeyPair: CryptoKeyPair,
) => {
  const signerCert = await createTestSignerCert(deviceKeyPair, "DeviceSigner");

  const request = await buildPkcsReq(
    csr,
    caCert,
    signerCert,
    deviceKeyPair.privateKey,
    "txn-challenge",
    crypto.getRandomValues(new Uint8Array(16)),
    true,
  );

  return handler(
    new Request("http://localhost/mdm/apple/scep/tenant-from-challenge?operation=PKIOperation", {
      method: "POST",
      body: request,
    }),
  );
};

describe("SCEP PKCSReq authentication", () => {
  it("issues a certificate for a valid challenge and pins the OU to the tenant", async () => {
    const { handler, caCert } = await makeScepHandler(SECRET);
    const deviceKeyPair = await generateKeyPair();
    const challenge = await createScepChallenge("enrollment-1", SECRET);

    const csr = await buildTestCsr(deviceKeyPair, "Device", {
      challengePassword: challenge,
      organizationalUnit: "attacker-tenant",
    });

    const response = await pkiOperation(handler, csr, caCert, deviceKeyPair);
    expect(response.status).toBe(200);

    const signedData = new pkijs.SignedData({
      schema: pkijs.ContentInfo.fromBER(await response.arrayBuffer()).content,
    });

    const issued = signedData.certificates?.find(
      (certificate): certificate is pkijs.Certificate =>
        certificate instanceof pkijs.Certificate &&
        certificate.subject.typesAndValues.some((attribute) => attribute.type === "2.5.4.3"),
    );

    if (!issued) throw new Error("CertRep did not contain an issued certificate");

    const ou = issued.subject.typesAndValues.find((attribute) => attribute.type === "2.5.4.11");
    expect(attributeText(ou)).toBe("tenant-from-challenge");
    expect(
      issued.subject.typesAndValues.some(
        (attribute) => attributeText(attribute) === "attacker-tenant",
      ),
    ).toBe(false);
  });

  it("rejects a missing challenge", async () => {
    const { handler, caCert } = await makeScepHandler(SECRET);
    const deviceKeyPair = await generateKeyPair();
    const csr = await buildTestCsr(deviceKeyPair, "Device");
    const response = await pkiOperation(handler, csr, caCert, deviceKeyPair);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-pki-message");
  });

  it("rejects a wrong challenge", async () => {
    const { handler, caCert } = await makeScepHandler(SECRET);
    const deviceKeyPair = await generateKeyPair();

    const csr = await buildTestCsr(deviceKeyPair, "Device", {
      challengePassword: "enrollment-1.wrong-signature",
    });

    const response = await pkiOperation(handler, csr, caCert, deviceKeyPair);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-pki-message");
  });
});
