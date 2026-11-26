import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { describeScepCa, generateScepCa, sealCaPrivateKey } from "@mattrax/scep";
import { issueScepChallenge, ScepRepositoryLive } from "@mattrax/mdm-core";
import { dbRows, makeDb as makeStoreDb, tableName } from "./fake-db.js";
import type { Row } from "./fake-db.js";

const authSecret = "scep-test-secret";

type StoreDb = ReturnType<typeof makeStoreDb>;

const enrollmentRow = (overrides: Row = {}): Row => ({
  id: "enrollment-1",
  organizationId: "tenant-1",
  ...overrides,
});

const makeScepDb = (enrollments: Row[] = [enrollmentRow()]) =>
  makeStoreDb({ [tableName(schema.enterpriseEnrollment)]: enrollments });

const issueChallenge = (
  db: StoreDb,
  options: {
    enrollmentId?: string;
    organizationId?: string;
    ttlSeconds?: number;
    now?: number;
    authSecret?: string;
    referenceId?: string;
  } = {},
) =>
  Effect.runPromise(
    // SAFETY: The fake store implements only the query chains this repository
    // exercises; it is passed through the repository's database boundary.
    issueScepChallenge(db as never, {
      enrollmentId: options.enrollmentId ?? "enrollment-1",
      organizationId: options.organizationId ?? "tenant-1",
      authSecret: options.authSecret ?? authSecret,
      ttlSeconds: options.ttlSeconds ?? 7 * 24 * 60 * 60,
      referenceId: options.referenceId,
      now: options.now,
    }),
  );

// SAFETY: The fake store implements only the query chains these tests exercise.
const makeRepository = (db: StoreDb, options: { authSecret?: string } = { authSecret }) =>
  ScepRepositoryLive.make(db as never, options);

// SAFETY: The repository reads the challenge password from this minimal
// request object and does not require the full PKCS#10 request contract.
const request = (challengePassword: string | undefined) => ({ challengePassword }) as never;

/** The URL scope every SCEP request carries. */
const scope = { organizationId: "tenant-1" };

const challengeRows = (db: StoreDb) => dbRows(db, tableName(schema.scepChallenge));

describe("ScepRepositoryLive challenge authentication", () => {
  it("accepts a valid challenge, resolves the tenant and consumes it", async () => {
    const db = makeScepDb();
    const { challenge, expiresAt } = await issueChallenge(db);

    const repository = makeRepository(db);
    const queryStart = db.queries.length;

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(scope, request(challenge))),
    ).resolves.toEqual({ organizationalUnit: "tenant-1", enrollmentId: "enrollment-1" });

    expect(db.queries.slice(queryStart)).toMatchObject([
      {
        operation: "select",
        table: tableName(schema.enterpriseEnrollment),
        joins: [tableName(schema.scepChallenge)],
      },
      { operation: "update", table: tableName(schema.scepChallenge) },
    ]);
    expect(challengeRows(db)).toMatchObject([
      {
        organizationId: "tenant-1",
        enrollmentId: "enrollment-1",
        expiresAt,
        consumedAt: expect.any(Date),
      },
    ]);
  });

  it("carries the BYOD reference from the joined challenge read without reading it again", async () => {
    const db = makeScepDb();
    const { challenge } = await issueChallenge(db, { referenceId: "byod-1" });
    const repository = makeRepository(db);
    const queryStart = db.queries.length;

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(scope, request(challenge))),
    ).resolves.toEqual({
      organizationalUnit: "tenant-1",
      enrollmentId: "enrollment-1",
      referenceId: "byod-1",
    });
    expect(db.queries.slice(queryStart)).toMatchObject([
      {
        operation: "select",
        table: tableName(schema.enterpriseEnrollment),
        joins: [tableName(schema.scepChallenge)],
      },
      { operation: "update", table: tableName(schema.scepChallenge) },
    ]);
  });

  it("rejects missing, wrong and expired challenges", async () => {
    const db = makeScepDb();
    const repository = makeRepository(db);

    const wrong = await issueChallenge(db, { authSecret: "another-secret" });
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(scope, request(undefined))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const });
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(scope, request(wrong.challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const });

    const now = Date.now() - 120_000;

    const expired = await issueChallenge(db, { ttlSeconds: 60, now });

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(scope, request(expired.challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const });
  });

  it("issues a unique challenge and row for every call", async () => {
    const db = makeScepDb();

    const first = await issueChallenge(db);
    const second = await issueChallenge(db);

    expect(first.challenge).not.toBe(second.challenge);
    expect(challengeRows(db)).toHaveLength(2);
  });

  it("rejects a replayed challenge", async () => {
    const db = makeScepDb();
    const { challenge } = await issueChallenge(db);
    const repository = makeRepository(db);

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(scope, request(challenge))),
    ).resolves.toMatchObject({ organizationalUnit: "tenant-1" });

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(scope, request(challenge))),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: "Invalid SCEP challenge",
    });
  });

  it("rejects a challenge whose stored row has expired", async () => {
    const db = makeScepDb();
    // A long lifetime keeps the signed expiry valid, so only the persisted
    // row's `expiresAt` guard can reject it.
    const { challenge } = await issueChallenge(db);
    db.store[tableName(schema.scepChallenge)][0].expiresAt = new Date(Date.now() - 1_000);

    await expect(
      Effect.runPromise(makeRepository(db).authenticatePkcsReq(scope, request(challenge))),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: "Invalid SCEP challenge",
      reason: "invalid_request",
    });
  });

  it("rejects a challenge consumed for another tenant", async () => {
    const db = makeScepDb();
    const { challenge } = await issueChallenge(db, { organizationId: "tenant-2" });

    await expect(
      Effect.runPromise(makeRepository(db).authenticatePkcsReq(scope, request(challenge))),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: "Invalid SCEP challenge",
      reason: "invalid_request",
    });
    expect(challengeRows(db)[0].consumedAt).toBeNull();
  });

  it("allows only one of two concurrent uses of the same challenge", async () => {
    const db = makeScepDb();
    const { challenge } = await issueChallenge(db);
    const repository = makeRepository(db);

    const attempt = () =>
      repository.authenticatePkcsReq(scope, request(challenge)).pipe(
        Effect.match({
          onFailure: () => false,
          onSuccess: () => true,
        }),
      );

    const results = await Effect.runPromise(
      Effect.all([attempt(), attempt()], { concurrency: "unbounded" }),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(challengeRows(db)[0].consumedAt).toBeInstanceOf(Date);
  });

  it("rejects a challenge for an unknown enrollment", async () => {
    const db = makeScepDb([]);
    const { challenge } = await issueChallenge(db, { enrollmentId: "missing-enrollment" });

    await expect(
      Effect.runPromise(makeRepository(db).authenticatePkcsReq(scope, request(challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const, reason: "invalid_request" });
  });

  it("fails closed when no secret is configured", async () => {
    const db = makeScepDb();
    const { challenge } = await issueChallenge(db);
    const previous = process.env.AUTH_SECRET;
    const previousLocal = process.env.MATTRAX_AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.MATTRAX_AUTH_SECRET;

    try {
      await expect(
        Effect.runPromise(makeRepository(db, {}).authenticatePkcsReq(scope, request(challenge))),
      ).rejects.toMatchObject({ _tag: "ScepError" as const, reason: "internal" });
    } finally {
      if (previous !== undefined) process.env.AUTH_SECRET = previous;

      if (previousLocal !== undefined) process.env.MATTRAX_AUTH_SECRET = previousLocal;
    }
  });
});

/**
 * Queued stand-in for the select chain used by `findIssuedCertificate`.
 * Each `select().from().where().limit()` consumes one result set.
 *
 * SAFETY: The stand-in implements only that chain, not the full Db service.
 */
const makeQueuedDb = (results: Array<Array<Row>>) => {
  let index = 0;

  // SAFETY: The queued stand-in implements the exact select chain the repository
  // calls and is passed through the repository's fake-database boundary.
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed(results[index++] ?? []),
        }),
      }),
    }),
  } as never;
};

// SAFETY: The fake store implements only the query chains these tests exercise.
const issuedCertificate = (overrides: Row = {}) => ({
  serial: "01",
  organizationId: "tenant-1",
  enrollmentId: null,
  deviceId: null,
  notAfter: new Date(Date.now() + 86_400_000),
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe("ScepRepositoryLive identity revocation", () => {
  it("rejects renewal when the issued certificate was revoked", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ revokedAt: new Date() })]]),
      { authSecret },
    );

    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("revoked"),
    });
  });

  it("rejects renewal when the certificate's device is no longer enrolled", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], [{ status: "unenrolled" }]]),
      { authSecret },
    );

    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("no longer enrolled"),
    });
  });

  it("rejects renewal when the certificate's device has been deleted", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], []]),
      { authSecret },
    );

    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("no longer enrolled"),
    });
  });

  it("accepts renewal for an active, still-enrolled identity", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], [{ status: "enrolled" }]]),
      { authSecret },
    );

    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).resolves.toMatchObject({ serial: "01", organizationId: "tenant-1", deviceId: "device-1" });
  });

  it("accepts non-device-scoped (Apple) certificates until they are revoked", async () => {
    const repository = ScepRepositoryLive.make(makeQueuedDb([[issuedCertificate()]]), {
      authSecret,
    });

    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).resolves.toMatchObject({ serial: "01" });
  });

  it("returns null for an unknown serial", async () => {
    const repository = ScepRepositoryLive.make(makeQueuedDb([[]]), { authSecret });
    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "ff")),
    ).resolves.toBeNull();
  });
});

const seedDevice = (db: ReturnType<typeof makeStoreDb>, overrides: Row = {}) =>
  db.store[tableName(schema.device)].push({
    id: "internal-device-1",
    organizationId: "tenant-1",
    proto: "win",
    status: "enrolled",
    name: "DESKTOP",
    dmIdentifier: "windows-device-id",
    enrolledAt: new Date(),
    lastSeenAt: new Date(),
    __table: tableName(schema.device),
    ...overrides,
  });

describe("ScepRepositoryLive certificate linkage", () => {
  it("accepts renewal for a certificate linked by the internal device id", async () => {
    const db = makeStoreDb({
      [tableName(schema.scepIssuedCertificate)]: [
        issuedCertificate({ deviceId: "internal-device-1" }),
      ],
    });

    seedDevice(db);
    const repository = makeRepository(db);
    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).resolves.toMatchObject({
      serial: "01",
      deviceId: "internal-device-1",
    });
  });

  it("accepts renewal for a legacy certificate linked by dmIdentifier", async () => {
    const db = makeStoreDb({
      [tableName(schema.scepIssuedCertificate)]: [
        issuedCertificate({ deviceId: "windows-device-id" }),
      ],
    });

    seedDevice(db);
    const repository = makeRepository(db);
    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).resolves.toMatchObject({
      serial: "01",
      deviceId: "windows-device-id",
    });
  });

  it("rejects renewal when the linked device is no longer enrolled", async () => {
    const db = makeStoreDb({
      [tableName(schema.scepIssuedCertificate)]: [
        issuedCertificate({ deviceId: "internal-device-1" }),
      ],
    });

    seedDevice(db, { status: "unenrolled" });
    const repository = makeRepository(db);
    await expect(
      Effect.runPromise(repository.findIssuedCertificate!(scope, "01")),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("no longer enrolled"),
    });
  });
});

describe("ScepRepositoryLive certificate recording", () => {
  const certificate = (overrides: Row = {}) => ({
    serial: "01",
    organizationId: "tenant-1",
    enrollmentId: "enrollment-1",
    deviceId: "internal-device-1",
    notAfter: new Date(Date.now() + 86_400_000),
    ...overrides,
  });

  it("records a new certificate", async () => {
    const db = makeStoreDb();
    const repository = makeRepository(db);
    await Effect.runPromise(repository.recordIssuedCertificate!(certificate()));
    expect(dbRows(db, tableName(schema.scepIssuedCertificate))).toMatchObject([
      { serial: "01", organizationId: "tenant-1", deviceId: "internal-device-1" },
    ]);
  });

  it("keeps a revoked certificate revoked when the same identity is reissued", async () => {
    const revokedAt = new Date("2026-01-01T00:00:00Z");

    const db = makeStoreDb({
      [tableName(schema.scepIssuedCertificate)]: [
        issuedCertificate({ deviceId: "internal-device-1", revokedAt }),
      ],
    });

    const repository = makeRepository(db);
    await Effect.runPromise(repository.recordIssuedCertificate!(certificate()));
    const [row] = dbRows(db, tableName(schema.scepIssuedCertificate));
    expect(row.revokedAt).toEqual(revokedAt);
    expect(row.notAfter).toBeInstanceOf(Date);
  });

  it("refuses a colliding serial that belongs to another identity", async () => {
    const db = makeStoreDb({
      [tableName(schema.scepIssuedCertificate)]: [
        issuedCertificate({ deviceId: "other-device", organizationId: "tenant-2" }),
      ],
    });

    const repository = makeRepository(db);
    await expect(
      Effect.runPromise(repository.recordIssuedCertificate!(certificate())),
    ).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("collision"),
    });
    // The original row is untouched.
    const [row] = dbRows(db, tableName(schema.scepIssuedCertificate));
    expect(row).toMatchObject({ deviceId: "other-device", organizationId: "tenant-2" });
  });
});

describe("ScepRepositoryLive staged rotation", () => {
  const DAY = 24 * 60 * 60 * 1000;

  const seedCa = async (organizationId: string, lifetimeDays: number) => {
    const ca = await Effect.runPromise(generateScepCa(organizationId, { lifetimeDays }));
    const description = await Effect.runPromise(describeScepCa(ca.certPem));
    const sealed = await sealCaPrivateKey(authSecret, ca.privateKeyJwk);

    return {
      ca,
      description,
      row: {
        id: 1,
        organizationId,
        certPem: ca.certPem,
        privateKeyJwk: sealed,
        source: "generated",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        rotatedAt: null,
      },
    };
  };

  const makeRotationDb = async () => {
    const previous = await seedCa("tenant-1", 500);

    const db = makeStoreDb({
      [tableName(schema.organization)]: [{ id: "tenant-1", name: "Tenant One" }],
      [tableName(schema.scepCa)]: [previous.row],
    });

    return { db, previous };
  };

  it("retains the previous CA until its own expiry and trusts both", async () => {
    const { db, previous } = await makeRotationDb();
    const repository = makeRepository(db);

    const candidate = await Effect.runPromise(generateScepCa("tenant-1", { lifetimeDays: 365 }));

    const retiredAt = new Date("2026-01-01T00:00:00.000Z");

    // Asking for a longer overlap must be clamped: a retired CA is never
    // trusted past its own expiry.
    const stored = await Effect.runPromise(
      repository.rotateCa(scope, candidate, {
        retiredAt,
        trustUntil: new Date(previous.description.notAfter.getTime() + 30 * DAY),
      }),
    );

    expect(stored.certPem).toBe(candidate.certPem);
    expect(dbRows(db, tableName(schema.scepCa))).toHaveLength(1);
    expect(dbRows(db, tableName(schema.scepCa))[0]?.certPem).toBe(candidate.certPem);

    const trust = dbRows(db, tableName(schema.scepCaTrust));
    expect(trust).toHaveLength(1);
    expect(trust[0]).toMatchObject({
      organizationId: "tenant-1",
      certPem: previous.ca.certPem,
      fingerprintSha256: previous.description.fingerprintSha256,
      source: "generated",
      retiredAt,
      trustUntil: previous.description.notAfter,
    });

    // The current CA is tried first, then the retired anchor.
    await expect(Effect.runPromise(repository.trustedCaCertificates(scope))).resolves.toEqual([
      candidate.certPem,
      previous.ca.certPem,
    ]);

    await expect(Effect.runPromise(repository.listRetiredCa(scope))).resolves.toMatchObject([
      {
        certPem: previous.ca.certPem,
        fingerprintSha256: previous.description.fingerprintSha256,
        retiredAt,
        trustUntil: previous.description.notAfter,
      },
    ]);
  });

  it("stops trusting a retired CA when its window closes without deleting the record", async () => {
    const { db, previous } = await makeRotationDb();
    const repository = makeRepository(db);

    const candidate = await Effect.runPromise(generateScepCa("tenant-1", { lifetimeDays: 365 }));

    await Effect.runPromise(
      repository.rotateCa(scope, candidate, {
        retiredAt: new Date("2026-01-01T00:00:00.000Z"),
        trustUntil: previous.description.notAfter,
      }),
    );

    const afterExpiry = new Date(previous.description.notAfter.getTime() + 1);
    await expect(
      Effect.runPromise(repository.trustedCaCertificates(scope, afterExpiry)),
    ).resolves.toEqual([candidate.certPem]);

    // Health still sees the retirement history until it is purged.
    await expect(Effect.runPromise(repository.listRetiredCa(scope))).resolves.toHaveLength(1);
  });

  it("bootstraps through rotateCa when the tenant has no CA", async () => {
    const db = makeStoreDb({
      [tableName(schema.organization)]: [{ id: "tenant-1", name: "Tenant One" }],
    });

    const repository = makeRepository(db);

    const candidate = await Effect.runPromise(generateScepCa("tenant-1", { lifetimeDays: 365 }));

    const stored = await Effect.runPromise(
      repository.rotateCa(scope, candidate, {
        retiredAt: new Date(),
        trustUntil: new Date(),
      }),
    );

    expect(stored.certPem).toBe(candidate.certPem);
    expect(dbRows(db, tableName(schema.scepCaTrust))).toHaveLength(0);
  });
});

describe("ScepRepositoryLive issuing CA attribution", () => {
  it("records the issuing CA fingerprint so rotation overlap can be audited", async () => {
    const db = makeStoreDb();
    const repository = makeRepository(db);

    await Effect.runPromise(
      repository.recordIssuedCertificate!({
        serial: "0a",
        organizationId: "tenant-1",
        caFingerprintSha256: "f".repeat(64),
        notAfter: new Date(Date.now() + 86_400_000),
      }),
    );

    expect(dbRows(db, tableName(schema.scepIssuedCertificate))[0]).toMatchObject({
      serial: "0a",
      caFingerprintSha256: "f".repeat(64),
    });

    // A duplicate serial for the same identity refreshes the row.
    await Effect.runPromise(
      repository.recordIssuedCertificate!({
        serial: "0a",
        organizationId: "tenant-1",
        caFingerprintSha256: "e".repeat(64),
        notAfter: new Date(Date.now() + 172_800_000),
      }),
    );

    expect(dbRows(db, tableName(schema.scepIssuedCertificate))).toHaveLength(1);
    expect(dbRows(db, tableName(schema.scepIssuedCertificate))[0]?.caFingerprintSha256).toBe(
      "e".repeat(64),
    );
  });
});
