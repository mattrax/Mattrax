import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { issueScepChallenge, ScepRepositoryLive } from "../scep.js";
import { dbRows, makeDb as makeStoreDb, tableName, type Row } from "./fake-db.js";

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
      now: options.now,
    }),
  );

// SAFETY: The fake store implements only the query chains these tests exercise.
const makeRepository = (db: StoreDb, options: { authSecret?: string } = { authSecret }) =>
  ScepRepositoryLive.make(db as never, options);

// SAFETY: The repository reads the challenge password from this minimal
// request object and does not require the full PKCS#10 request contract.
const request = (challengePassword: string | undefined) => ({ challengePassword }) as never;

const challengeRows = (db: StoreDb) => dbRows(db, tableName(schema.scepChallenge));

describe("ScepRepositoryLive challenge authentication", () => {
  it("accepts a valid challenge, resolves the tenant and consumes it", async () => {
    const db = makeScepDb();
    const { challenge, expiresAt } = await issueChallenge(db);

    const repository = makeRepository(db);

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(challenge))),
    ).resolves.toEqual({ organizationalUnit: "tenant-1", enrollmentId: "enrollment-1" });

    expect(challengeRows(db)).toMatchObject([
      {
        organizationId: "tenant-1",
        enrollmentId: "enrollment-1",
        expiresAt,
        consumedAt: expect.any(Date),
      },
    ]);
  });

  it("rejects missing, wrong and expired challenges", async () => {
    const db = makeScepDb();
    const repository = makeRepository(db);

    const wrong = await issueChallenge(db, { authSecret: "another-secret" });
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(undefined))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const });
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(wrong.challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const });

    const now = Date.now() - 120_000;

    const expired = await issueChallenge(db, { ttlSeconds: 60, now });

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(expired.challenge))),
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
      Effect.runPromise(repository.authenticatePkcsReq(request(challenge))),
    ).resolves.toMatchObject({ organizationalUnit: "tenant-1" });

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(challenge))),
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
    db.store[tableName(schema.scepChallenge)]![0]!.expiresAt = new Date(Date.now() - 1_000);

    await expect(
      Effect.runPromise(makeRepository(db).authenticatePkcsReq(request(challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const, message: "Invalid SCEP challenge" });
  });

  it("rejects a challenge consumed for another tenant", async () => {
    const db = makeScepDb();
    const { challenge } = await issueChallenge(db, { organizationId: "tenant-2" });

    await expect(
      Effect.runPromise(makeRepository(db).authenticatePkcsReq(request(challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const, message: "Invalid SCEP challenge" });
    expect(challengeRows(db)[0]!.consumedAt).toBeNull();
  });

  it("allows only one of two concurrent uses of the same challenge", async () => {
    const db = makeScepDb();
    const { challenge } = await issueChallenge(db);
    const repository = makeRepository(db);

    const attempt = () =>
      repository.authenticatePkcsReq(request(challenge)).pipe(
        Effect.match({
          onFailure: () => false,
          onSuccess: () => true,
        }),
      );

    const results = await Effect.runPromise(
      Effect.all([attempt(), attempt()], { concurrency: "unbounded" }),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(challengeRows(db)[0]!.consumedAt).toBeInstanceOf(Date);
  });

  it("rejects a challenge for an unknown enrollment", async () => {
    const db = makeScepDb([]);
    const { challenge } = await issueChallenge(db, { enrollmentId: "missing-enrollment" });

    await expect(
      Effect.runPromise(makeRepository(db).authenticatePkcsReq(request(challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" as const });
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
        Effect.runPromise(makeRepository(db, {}).authenticatePkcsReq(request(challenge))),
      ).rejects.toMatchObject({ _tag: "ScepError" as const });
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

    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("revoked"),
    });
  });

  it("rejects renewal when the certificate's device is no longer enrolled", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], [{ status: "unenrolled" }]]),
      { authSecret },
    );

    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("no longer enrolled"),
    });
  });

  it("rejects renewal when the certificate's device has been deleted", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], []]),
      { authSecret },
    );

    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).rejects.toMatchObject({
      _tag: "ScepError" as const,
      message: expect.stringContaining("no longer enrolled"),
    });
  });

  it("accepts renewal for an active, still-enrolled identity", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], [{ status: "enrolled" }]]),
      { authSecret },
    );

    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).resolves.toMatchObject(
      { serial: "01", organizationId: "tenant-1", deviceId: "device-1" },
    );
  });

  it("accepts non-device-scoped (Apple) certificates until they are revoked", async () => {
    const repository = ScepRepositoryLive.make(makeQueuedDb([[issuedCertificate()]]), {
      authSecret,
    });

    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).resolves.toMatchObject(
      { serial: "01" },
    );
  });

  it("returns null for an unknown serial", async () => {
    const repository = ScepRepositoryLive.make(makeQueuedDb([[]]), { authSecret });
    await expect(Effect.runPromise(repository.findIssuedCertificate!("ff"))).resolves.toBeNull();
  });
});

const seedDevice = (db: ReturnType<typeof makeStoreDb>, overrides: Row = {}) =>
  db.store[tableName(schema.device)]!.push({
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
    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).resolves.toMatchObject(
      {
        serial: "01",
        deviceId: "internal-device-1",
      },
    );
  });

  it("accepts renewal for a legacy certificate linked by dmIdentifier", async () => {
    const db = makeStoreDb({
      [tableName(schema.scepIssuedCertificate)]: [
        issuedCertificate({ deviceId: "windows-device-id" }),
      ],
    });

    seedDevice(db);
    const repository = makeRepository(db);
    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).resolves.toMatchObject(
      {
        serial: "01",
        deviceId: "windows-device-id",
      },
    );
  });

  it("rejects renewal when the linked device is no longer enrolled", async () => {
    const db = makeStoreDb({
      [tableName(schema.scepIssuedCertificate)]: [
        issuedCertificate({ deviceId: "internal-device-1" }),
      ],
    });

    seedDevice(db, { status: "unenrolled" });
    const repository = makeRepository(db);
    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).rejects.toMatchObject({
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
    expect(row!.revokedAt).toEqual(revokedAt);
    expect(row!.notAfter).toBeInstanceOf(Date);
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
