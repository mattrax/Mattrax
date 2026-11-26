import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import type { GoogleWorkspaceCredentials } from "./config.js";
import { makeGoogleWorkspaceService } from "./service.js";
import type { GoogleWorkspaceService, GoogleWorkspaceServiceOptions } from "./service.js";

/** A real RS256 key: the service signs the token before any fetch stub runs. */
const makePrivateKeyPem = async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const exported = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString(
    "base64",
  );

  return `-----BEGIN PRIVATE KEY-----\n${exported.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
};

const credentials: GoogleWorkspaceCredentials = {
  serviceAccount: {
    clientEmail: "sync@project.iam.gserviceaccount.com",
    privateKeyPem: await makePrivateKeyPem(),
  },
  adminEmail: "admin@example.com",
  customer: "my_customer",
};

const json = (body: Schema.Json, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const tokenResponse = () => json({ access_token: "test-token", expires_in: 3600 });

/** SAFETY: the stub implements the fetch call shape the service uses and returns real Response objects. */
const fetchStub = (
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch => implementation;

const collector = () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];

  return { requests };
};

const runWithService = <A, E>(
  fetchImpl: typeof fetch,
  use: (service: GoogleWorkspaceService) => Effect.Effect<A, E>,
  options: Omit<GoogleWorkspaceServiceOptions, "credentials" | "fetch"> = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* makeGoogleWorkspaceService({
        credentials,
        fetch: fetchImpl,
        ...options,
      });

      return yield* use(service);
    }).pipe(Effect.provide(TestClock.layer())),
  );

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

describe("Google Workspace Directory client", () => {
  it("paginates users and normalises suspended and deleted accounts", async () => {
    const { requests } = collector();

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push({ url, authorization: null });

      if (url.startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();

      if (url.includes("pageToken=p2"))
        return json({
          users: [{ id: "u3", primaryEmail: "Three@Example.com", suspended: false }],
        });

      return json({
        users: [
          {
            id: "u1",
            primaryEmail: "one@example.com",
            name: { fullName: "One Person" },
            suspended: true,
            orgUnitPath: "/Staff",
          },
          {
            id: "u2",
            primaryEmail: "two@example.com",
            deletionTime: "2026-01-01T00:00:00.000Z",
          },
        ],
        nextPageToken: "p2",
      });
    });

    const { first, second } = await runWithService(fetchImpl, (service) =>
      Effect.gen(function* () {
        const first = yield* service.listUsers();

        return { first, second: yield* service.listUsers(first.nextPageToken) };
      }),
    );

    expect(first.users).toEqual([
      {
        id: "u1",
        primaryEmail: "one@example.com",
        name: "One Person",
        suspended: true,
        archived: false,
        deleted: false,
        orgUnitPath: "/Staff",
        isAdmin: false,
      },
      {
        id: "u2",
        primaryEmail: "two@example.com",
        name: "two@example.com",
        suspended: false,
        archived: false,
        deleted: true,
        isAdmin: false,
      },
    ]);
    expect(first.nextPageToken).toBe("p2");
    expect(second.users[0]?.primaryEmail).toBe("three@example.com");

    const usersUrl = new URL(requests.find((request) => request.url.includes("/users"))!.url);
    expect(usersUrl.searchParams.get("customer")).toBe("my_customer");
    expect(usersUrl.searchParams.get("showDeleted")).toBe("true");
    expect(usersUrl.searchParams.get("maxResults")).toBe("200");
    expect(new URL(requests.at(-1)!.url).searchParams.get("pageToken")).toBe("p2");
  });

  it("caches the access token between calls", async () => {
    let tokenCalls = 0;

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        tokenCalls++;

        return tokenResponse();
      }

      return json({ users: [] });
    });

    await runWithService(fetchImpl, (service) =>
      Effect.gen(function* () {
        yield* service.listUsers();
        yield* service.listUsers();
      }),
    );

    expect(tokenCalls).toBe(1);
  });

  it("coalesces concurrent token refreshes", async () => {
    let tokenCalls = 0;
    const started = deferred();
    const release = deferred();

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/token")) {
        tokenCalls++;
        started.resolve();
        await release.promise;

        return tokenResponse();
      }

      return json({ users: [] });
    });

    await runWithService(fetchImpl, (service) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.all([service.listUsers(), service.listUsers()], {
          concurrency: "unbounded",
        }).pipe(Effect.forkChild);

        yield* Effect.promise(() => started.promise);
        expect(tokenCalls).toBe(1);
        release.resolve();

        return yield* Fiber.join(fiber);
      }),
    );

    expect(tokenCalls).toBe(1);
  });

  it("expires cached tokens with the Effect clock", async () => {
    let tokenCalls = 0;

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/token")) {
        tokenCalls++;

        return json({ access_token: `token-${tokenCalls}`, expires_in: 120 });
      }

      return json({ users: [] });
    });

    await runWithService(fetchImpl, (service) =>
      Effect.gen(function* () {
        yield* service.listUsers();
        yield* service.listUsers();
        expect(tokenCalls).toBe(1);

        yield* TestClock.adjust(60_000);
        yield* service.listUsers();
        expect(tokenCalls).toBe(2);
      }),
    );
  });

  it("invalidates a cached token after one 401 and retries once", async () => {
    let tokenCalls = 0;
    let userCalls = 0;
    const authorizations: Array<string | null> = [];

    const fetchImpl = fetchStub(async (input: RequestInfo | URL, init) => {
      const url = String(input);

      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        tokenCalls++;

        return json({ access_token: `token-${tokenCalls}`, expires_in: 3600 });
      }

      userCalls++;
      authorizations.push(new Headers(init?.headers).get("authorization"));

      return userCalls === 1
        ? json({ error: { status: "UNAUTHENTICATED" } }, 401)
        : json({ users: [] });
    });

    await runWithService(fetchImpl, (service) => service.listUsers());

    expect(authorizations).toEqual(["Bearer token-1", "Bearer token-2"]);
    expect(tokenCalls).toBe(2);
  });

  it("honours Retry-After on 429 with TestClock and then succeeds", async () => {
    let userCalls = 0;
    const rateLimited = deferred();

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();
      userCalls++;

      if (userCalls === 1) {
        rateLimited.resolve();

        return json({ error: { status: "RESOURCE_EXHAUSTED" } }, 429, { "retry-after": "1" });
      }

      return json({ users: [{ id: "u1", primaryEmail: "one@example.com" }] });
    });

    const page = await runWithService(
      fetchImpl,
      (service) =>
        Effect.gen(function* () {
          const fiber = yield* service.listUsers().pipe(Effect.forkChild);

          yield* Effect.promise(() => rateLimited.promise);
          yield* TestClock.adjust(1_000);

          return yield* Fiber.join(fiber);
        }),
      { jitter: () => 0 },
    );

    expect(userCalls).toBe(2);
    expect(page.users).toHaveLength(1);
  });

  it("backs off on a 403 rate-limit error and reports a final failure safely", async () => {
    const rateLimited = deferred();

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();

      rateLimited.resolve();

      return json(
        {
          error: { message: "User-rate limit exceeded", errors: [{ reason: "rateLimitExceeded" }] },
        },
        403,
      );
    });

    const error = await runWithService(
      fetchImpl,
      (service) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.flip(service.listUsers()).pipe(Effect.forkChild);

          yield* Effect.promise(() => rateLimited.promise);
          yield* TestClock.adjust(1_500);

          return yield* Fiber.join(fiber);
        }),
      { jitter: () => 0, maxAttempts: 3 },
    );

    expect(error.status).toBe(403);
    expect(error.message).toMatch(/rate limit/i);
  });

  it("retries transport failures", async () => {
    let userCalls = 0;
    const failed = deferred();

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();

      userCalls++;

      if (userCalls === 1) {
        failed.resolve();
        throw new TypeError("connection reset");
      }

      return json({ users: [] });
    });

    await runWithService(
      fetchImpl,
      (service) =>
        Effect.gen(function* () {
          const fiber = yield* service.listUsers().pipe(Effect.forkChild);

          yield* Effect.promise(() => failed.promise);
          yield* TestClock.adjust(10);

          return yield* Fiber.join(fiber);
        }),
      { baseDelayMs: 10, jitter: () => 0 },
    );

    expect(userCalls).toBe(2);
  });

  it("times out a hung request, aborts fetch, and returns a typed error", async () => {
    const started = deferred();
    let signal: AbortSignal | null | undefined;

    const fetchImpl = fetchStub(async (input: RequestInfo | URL, init) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();

      signal = init?.signal;
      started.resolve();

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    });

    const error = await runWithService(
      fetchImpl,
      (service) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.flip(service.listUsers()).pipe(Effect.forkChild);

          yield* Effect.promise(() => started.promise);
          yield* TestClock.adjust(100);

          return yield* Fiber.join(fiber);
        }),
      { timeoutMs: 100, maxAttempts: 1 },
    );

    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("100ms");
    expect(signal?.aborted).toBe(true);
  });

  it("rejects oversized response bodies", async () => {
    const fetchImpl = fetchStub(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://oauth2.googleapis.com/token")
        ? tokenResponse()
        : json({ users: [{ id: "u1", primaryEmail: "one@example.com", name: "x".repeat(100) }] }),
    );

    const error = await runWithService(fetchImpl, (service) => Effect.flip(service.listUsers()), {
      maxResponseBytes: 64,
      maxAttempts: 1,
    });

    expect(error.kind).toBe("response");
    expect(error.message).toContain("64 bytes");
  });

  it("returns null for a missing user", async () => {
    const fetchImpl = fetchStub(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://oauth2.googleapis.com/token")
        ? tokenResponse()
        : json({ error: { status: "NOT_FOUND" } }, 404),
    );

    await expect(
      runWithService(fetchImpl, (service) => service.getUser("missing@example.com")),
    ).resolves.toBeNull();
  });

  it("fetches group members, ignores nested groups and paginates", async () => {
    const urls: string[] = [];

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);

      if (url.startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();

      if (url.includes("pageToken=m2"))
        return json({ members: [{ id: "u2", email: "two@example.com", type: "USER" }] });

      return json({
        members: [
          { id: "u1", email: "one@example.com", type: "USER" },
          { id: "g1", email: "nested@example.com", type: "GROUP" },
        ],
        nextPageToken: "m2",
      });
    });

    const members = await runWithService(fetchImpl, (service) =>
      service.listAllGroupMembers("group-1"),
    );

    expect(members.map((member) => member.id)).toEqual(["u1", "u2"]);
    expect(urls.some((url) => url.includes("/groups/group-1/members"))).toBe(true);
  });

  it("validates credentials with a small directory read", async () => {
    const fetchImpl = fetchStub(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://oauth2.googleapis.com/token")
        ? tokenResponse()
        : json({ users: [{ id: "u1", primaryEmail: "one@example.com" }] }),
    );

    await expect(runWithService(fetchImpl, (service) => service.validate())).resolves.toEqual({
      ok: true,
      message: "Google Workspace is reachable; 1 user(s) visible on the first page.",
    });
  });
});
