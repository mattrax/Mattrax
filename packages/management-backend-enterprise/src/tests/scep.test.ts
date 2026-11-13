import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { createScepChallenge } from "@mattrax/scep";
import { ScepRepositoryLive } from "../scep.js";
import { dbRows, makeDb as makeStoreDb, tableName } from "./fake-db.js";

const authSecret = "scep-test-secret";

/**
 * Minimal read-only stand-in for the Drizzle effect client. The SCEP repository
 * only performs `select().from().where().limit(1)` when resolving an enrollment.
 */
const makeDb = (enrollments: Array<{ id: string; organizationId: string }>) =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed(enrollments),
        }),
      }),
    }),
  }) as never;

const request = (challengePassword: string | undefined) => ({ challengePassword }) as never;

describe("ScepRepositoryLive challenge authentication", () => {
  it("accepts a valid challenge and resolves the tenant", async () => {
    const challenge = await createScepChallenge("enrollment-1", authSecret);

    const repository = ScepRepositoryLive.make(
      makeDb([{ id: "enrollment-1", organizationId: "tenant-1" }]),
      { authSecret },
    );

    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(challenge))),
    ).resolves.toEqual({ organizationalUnit: "tenant-1", enrollmentId: "enrollment-1" });
  });

  it("rejects missing, wrong and expired challenges", async () => {
    const repository = ScepRepositoryLive.make(
      makeDb([{ id: "enrollment-1", organizationId: "tenant-1" }]),
      { authSecret },
    );

    const wrong = await createScepChallenge("enrollment-1", "another-secret");
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(undefined))),
    ).rejects.toMatchObject({ _tag: "ScepError" });
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(wrong))),
    ).rejects.toMatchObject({ _tag: "ScepError" });

    const now = 1_700_000_000;

    const expired = await createScepChallenge("enrollment-1", authSecret, {
      ttlSeconds: 60,
      now: now * 1000,
    });

    // The repository uses the real clock; this challenge expired in 2023.
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(expired))),
    ).rejects.toMatchObject({ _tag: "ScepError" });
  });

  it("rejects a challenge for an unknown enrollment", async () => {
    const challenge = await createScepChallenge("missing-enrollment", authSecret);
    const repository = ScepRepositoryLive.make(makeDb([]), { authSecret });
    await expect(
      Effect.runPromise(repository.authenticatePkcsReq(request(challenge))),
    ).rejects.toMatchObject({ _tag: "ScepError" });
  });

  it("fails closed when no secret is configured", async () => {
    const challenge = await createScepChallenge("enrollment-1", authSecret);
    const previous = process.env.AUTH_SECRET;
    const previousLocal = process.env.MATTRAX_AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.MATTRAX_AUTH_SECRET;

    try {
      const repository = ScepRepositoryLive.make(
        makeDb([{ id: "enrollment-1", organizationId: "tenant-1" }]),
      );

      await expect(
        Effect.runPromise(repository.authenticatePkcsReq(request(challenge))),
      ).rejects.toMatchObject({ _tag: "ScepError" });
    } finally {
      if (previous !== undefined) process.env.AUTH_SECRET = previous;

      if (previousLocal !== undefined) process.env.MATTRAX_AUTH_SECRET = previousLocal;
    }
  });
});

/**
 * Queued stand-in for the select chain used by `findIssuedCertificate`.
 * Each `select().from().where().limit()` consumes one result set.
 */
const makeQueuedDb = (results: Array<Array<Record<string, unknown>>>) => {
  let index = 0;

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

const issuedCertificate = (overrides: Record<string, unknown> = {}) => ({
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
      _tag: "ScepError",
      message: expect.stringContaining("revoked"),
    });
  });

  it("rejects renewal when the certificate's device is no longer enrolled", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], [{ status: "unenrolled" }]]),
      { authSecret },
    );

    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).rejects.toMatchObject({
      _tag: "ScepError",
      message: expect.stringContaining("no longer enrolled"),
    });
  });

  it("rejects renewal when the certificate's device has been deleted", async () => {
    const repository = ScepRepositoryLive.make(
      makeQueuedDb([[issuedCertificate({ deviceId: "device-1" })], []]),
      { authSecret },
    );

    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).rejects.toMatchObject({
      _tag: "ScepError",
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

const seedDevice = (db: ReturnType<typeof makeStoreDb>, overrides: Record<string, unknown> = {}) =>
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
    const repository = ScepRepositoryLive.make(db as never, { authSecret });
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
    const repository = ScepRepositoryLive.make(db as never, { authSecret });
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
    const repository = ScepRepositoryLive.make(db as never, { authSecret });
    await expect(Effect.runPromise(repository.findIssuedCertificate!("01"))).rejects.toMatchObject({
      _tag: "ScepError",
      message: expect.stringContaining("no longer enrolled"),
    });
  });
});

describe("ScepRepositoryLive certificate recording", () => {
  const certificate = (overrides: Record<string, unknown> = {}) => ({
    serial: "01",
    organizationId: "tenant-1",
    enrollmentId: "enrollment-1",
    deviceId: "internal-device-1",
    notAfter: new Date(Date.now() + 86_400_000),
    ...overrides,
  });

  it("records a new certificate", async () => {
    const db = makeStoreDb();
    const repository = ScepRepositoryLive.make(db as never, { authSecret });
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

    const repository = ScepRepositoryLive.make(db as never, { authSecret });
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

    const repository = ScepRepositoryLive.make(db as never, { authSecret });
    await expect(
      Effect.runPromise(repository.recordIssuedCertificate!(certificate())),
    ).rejects.toMatchObject({
      _tag: "ScepError",
      message: expect.stringContaining("collision"),
    });
    // The original row is untouched.
    const [row] = dbRows(db, tableName(schema.scepIssuedCertificate));
    expect(row).toMatchObject({ deviceId: "other-device", organizationId: "tenant-2" });
  });
});
