import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createScepChallenge } from "@mattrax/scep";
import { ScepRepositoryLive } from "../scep.js";

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
