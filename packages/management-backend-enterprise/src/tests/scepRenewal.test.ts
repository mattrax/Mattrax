import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import * as pkijs from "pkijs";
import {
  ScepRepository,
  ScepService,
  ScepServiceTag,
  certToPem,
  certificateSerialHex,
  createDeviceCertificate,
  sealCaPrivateKey,
} from "@mattrax/scep";
import {
  buildPkcsReq,
  buildTestCsr,
  createTestCaCert,
  generateKeyPair,
} from "@mattrax/scep/testing";
import { schema } from "@mattrax/enterprise-core";
import { ScepRepositoryLive } from "../scep.js";
import { dbRows, makeDb, tableName, type Row } from "./fake-db.js";

const DAY = 24 * 60 * 60 * 1000;

const authSecret = "scep-renewal-e2e-secret";

const scope = { organizationId: "tenant-1" };

const now = new Date("2026-11-10T12:00:00.000Z");

/**
 * End-to-end renewal through the hosted management layer: the real repository,
 * the real SCEP service and a CA rotation overlap, against the in-memory
 * database model.
 */
describe("SCEP renewal during a CA rotation (management layer)", () => {
  const setup = async () => {
    const retiredKeys = await generateKeyPair();
    const retiredCa = await createTestCaCert(retiredKeys, "Retired SCEP CA");
    const currentKeys = await generateKeyPair();
    const currentCa = await createTestCaCert(currentKeys, "Current SCEP CA");

    const deviceKeys = await generateKeyPair();

    const identity = await createDeviceCertificate(
      1,
      [
        { type: "2.5.4.3", value: "Enrolled Mac" },
        { type: "2.5.4.11", value: scope.organizationId },
      ],
      deviceKeys.publicKey,
      retiredCa,
      retiredKeys.privateKey,
      {
        notBefore: new Date(now.getTime() - 60_000),
        notAfter: new Date(now.getTime() + 30 * DAY),
      },
    );

    const identitySerial = certificateSerialHex(identity);

    const db = makeDb({
      [tableName(schema.organization)]: [{ id: scope.organizationId, name: "Acme" }],
      [tableName(schema.device)]: [
        {
          id: "device-1",
          organizationId: scope.organizationId,
          proto: "apple",
          status: "enrolled",
          name: "Mac",
          dmIdentifier: "udid-1",
          enrolledAt: now,
          lastSeenAt: now,
        },
      ],
      [tableName(schema.scepCa)]: [
        {
          id: 1,
          organizationId: scope.organizationId,
          certPem: certToPem(currentCa),
          privateKeyJwk: await sealCaPrivateKey(
            authSecret,
            await crypto.subtle.exportKey("jwk", currentKeys.privateKey),
          ),
          source: "generated",
          createdAt: new Date(now.getTime() - 180 * DAY),
          rotatedAt: now,
        },
      ],
      [tableName(schema.scepCaTrust)]: [
        {
          id: "trust-1",
          organizationId: scope.organizationId,
          certPem: certToPem(retiredCa),
          fingerprintSha256: "a".repeat(64),
          source: "generated",
          retiredAt: now,
          // The retired CA remains trusted until it expires.
          trustUntil: new Date(now.getTime() + 180 * DAY),
          createdAt: now,
        },
      ],
      [tableName(schema.scepIssuedCertificate)]: [
        {
          serial: identitySerial,
          organizationId: scope.organizationId,
          enrollmentId: "enrollment-1",
          deviceId: "device-1",
          caFingerprintSha256: "a".repeat(64),
          notAfter: new Date(now.getTime() + 30 * DAY),
          revokedAt: null,
          createdAt: new Date(now.getTime() - 60_000),
        },
      ],
    });

    const csr = await buildTestCsr(deviceKeys, "Enrolled Mac");

    const renewal = await buildPkcsReq(
      csr,
      currentCa,
      identity,
      deviceKeys.privateKey,
      "txn-management-renewal",
      crypto.getRandomValues(new Uint8Array(16)),
      false,
      "17",
    );

    return { db, currentCa, retiredCa, identitySerial, renewal };
  };

  it("renews with the existing identity and issues from the current CA", async () => {
    const { db, currentCa, retiredCa, identitySerial, renewal } = await setup();

    const repositoryLayer = Layer.succeed(
      ScepRepository,
      // SAFETY: the fake store implements the query chains the repository uses.
      ScepRepositoryLive.make(db as never, { authSecret }),
    );

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const scep = yield* ScepServiceTag;

        return yield* scep.pkiOperation(scope, renewal);
      }).pipe(Effect.provide(ScepService.pipe(Layer.provide(repositoryLayer)))),
    );

    const signedData = new pkijs.SignedData({
      schema: pkijs.ContentInfo.fromBER(response).content,
    });

    const issued = signedData.certificates?.find(
      (certificate): certificate is pkijs.Certificate =>
        certificate instanceof pkijs.Certificate &&
        !certificate.issuer.isEqual(certificate.subject),
    );

    if (!issued) throw new Error("CertRep did not contain the renewed identity");

    // The renewed identity chains to the successor, and the retired CA is still
    // an accepted anchor for the old identity that authorised this request.
    expect(await issued.verify(currentCa)).toBe(true);
    expect(issued.issuer.isEqual(currentCa.subject)).toBe(true);
    expect(issued.issuer.isEqual(retiredCa.subject)).toBe(false);

    const rows = dbRows(db, tableName(schema.scepIssuedCertificate));

    const renewed = rows.find((row: Row) => row.serial !== identitySerial);

    expect(renewed).toMatchObject({
      organizationId: scope.organizationId,
      deviceId: "device-1",
      enrollmentId: "enrollment-1",
    });

    // The original identity is not revoked by a rotation.
    expect(rows.find((row: Row) => row.serial === identitySerial)?.revokedAt).toBeNull();
  });

  it("refuses the renewal after the retired CA's trust window closes", async () => {
    const { db, identitySerial, renewal } = await setup();
    // Mutate the live row (dbRows returns copies) so the repository sees the
    // closed trust window.
    db.store[tableName(schema.scepCaTrust)]![0]!.trustUntil = new Date(now.getTime() - DAY);

    const repositoryLayer = Layer.succeed(
      ScepRepository,
      // SAFETY: the fake store implements the query chains the repository uses.
      ScepRepositoryLive.make(db as never, { authSecret }),
    );

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const scep = yield* ScepServiceTag;

        return yield* scep.pkiOperation(scope, renewal);
      }).pipe(Effect.provide(ScepService.pipe(Layer.provide(repositoryLayer)))),
    );

    const signedData = new pkijs.SignedData({
      schema: pkijs.ContentInfo.fromBER(response).content,
    });

    const pkiStatus = signedData.signerInfos[0]!.signedAttrs!.attributes.find(
      (attribute) => attribute.type === "2.16.840.1.113733.1.9.3",
    );

    // Failure CertRep (pkiStatus=2) rather than a transport error.
    expect(pkiStatus).toBeDefined();
    expect(dbRows(db, tableName(schema.scepIssuedCertificate))).toHaveLength(1);
    expect(dbRows(db, tableName(schema.scepIssuedCertificate))[0]?.serial).toBe(identitySerial);
  });
});
