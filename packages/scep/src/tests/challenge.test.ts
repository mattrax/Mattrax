import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
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
    pkijs.setEngine("WebCrypto", crypto as unknown as Crypto, crypto.subtle);
  }
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
});

async function makeScepHandler(secret: string) {
  const caKeyPair = await generateKeyPair();
  const caCert = await createTestCaCert(caKeyPair, "Challenge SCEP CA");
  const { certToPem } = await import("../pkcs7.js");
  const caPrivateKeyJwk = (await crypto.subtle.exportKey(
    "jwk",
    caKeyPair.privateKey,
  )) as JsonWebKey;

  const repoLayer: Layer.Layer<ScepRepository> = mockScepRepository({
    getCa: () => Effect.succeed({ certPem: certToPem(caCert), privateKeyJwk: caPrivateKeyJwk }),
    saveCa: () => Effect.void,
    authenticatePkcsReq: (req) =>
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
    new Request("http://localhost/mdm/apple/scep?operation=PKIOperation", {
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
    )!;
    const ou = issued.subject.typesAndValues.find((attribute) => attribute.type === "2.5.4.11");
    expect((ou?.value as any).valueBlock.value).toBe("tenant-from-challenge");
    expect(
      issued.subject.typesAndValues.some(
        (attribute) => (attribute.value as any).valueBlock.value === "attacker-tenant",
      ),
    ).toBe(false);
  });

  it("rejects a missing challenge", async () => {
    const { handler, caCert } = await makeScepHandler(SECRET);
    const deviceKeyPair = await generateKeyPair();
    const csr = await buildTestCsr(deviceKeyPair, "Device");
    const response = await pkiOperation(handler, csr, caCert, deviceKeyPair);
    expect(response.status).not.toBe(200);
  });

  it("rejects a wrong challenge", async () => {
    const { handler, caCert } = await makeScepHandler(SECRET);
    const deviceKeyPair = await generateKeyPair();
    const csr = await buildTestCsr(deviceKeyPair, "Device", {
      challengePassword: "enrollment-1.wrong-signature",
    });
    const response = await pkiOperation(handler, csr, caCert, deviceKeyPair);
    expect(response.status).not.toBe(200);
  });
});
