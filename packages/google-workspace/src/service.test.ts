import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { GoogleWorkspaceCredentials } from "./config.js";
import { makeGoogleWorkspaceService } from "./service.js";

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

/** SAFETY: the stub implements the fetch call shape the service uses (a URL and optional init) and returns real Response objects. */
const fetchStub = (implementation: (input: RequestInfo | URL) => Promise<Response>): typeof fetch =>
  implementation as typeof fetch;

const collector = () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];

  return { requests };
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

    const service = makeGoogleWorkspaceService({ credentials, fetch: fetchImpl });

    const first = await Effect.runPromise(service.listUsers());
    const second = await Effect.runPromise(service.listUsers(first.nextPageToken));

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

    const service = makeGoogleWorkspaceService({ credentials, fetch: fetchImpl });

    await Effect.runPromise(service.listUsers());
    await Effect.runPromise(service.listUsers());

    expect(tokenCalls).toBe(1);
  });

  it("honours Retry-After on 429 and then succeeds", async () => {
    const delays: number[] = [];
    let userCalls = 0;

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();
      userCalls++;

      if (userCalls === 1)
        return json({ error: { status: "RESOURCE_EXHAUSTED" } }, 429, { "retry-after": "1" });

      return json({ users: [{ id: "u1", primaryEmail: "one@example.com" }] });
    });

    const service = makeGoogleWorkspaceService({
      credentials,
      fetch: fetchImpl,
      sleep: (ms) => Effect.sync(() => delays.push(ms)),
      jitter: () => 0,
    });

    const page = await Effect.runPromise(service.listUsers());

    expect(userCalls).toBe(2);
    expect(delays).toEqual([1_000]);
    expect(page.users).toHaveLength(1);
  });

  it("backs off on a 403 rate-limit error and reports a final failure safely", async () => {
    const delays: number[] = [];

    const fetchImpl = fetchStub(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();

      return json(
        {
          error: { message: "User-rate limit exceeded", errors: [{ reason: "rateLimitExceeded" }] },
        },
        403,
      );
    });

    const service = makeGoogleWorkspaceService({
      credentials,
      fetch: fetchImpl,
      sleep: (ms) => Effect.sync(() => delays.push(ms)),
      jitter: () => 0,
      maxAttempts: 3,
    });

    const error = await Effect.runPromise(Effect.flip(service.listUsers()));

    expect(error.status).toBe(403);
    expect(error.message).toMatch(/rate limit/i);
    expect(delays).toEqual([500, 1_000]);
  });

  it("returns null for a missing user", async () => {
    const fetchImpl = fetchStub(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://oauth2.googleapis.com/token")
        ? tokenResponse()
        : json({ error: { status: "NOT_FOUND" } }, 404),
    );

    const service = makeGoogleWorkspaceService({ credentials, fetch: fetchImpl });

    await expect(Effect.runPromise(service.getUser("missing@example.com"))).resolves.toBeNull();
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

    const service = makeGoogleWorkspaceService({ credentials, fetch: fetchImpl });

    const members = await Effect.runPromise(service.listAllGroupMembers("group-1"));

    expect(members.map((member) => member.id)).toEqual(["u1", "u2"]);
    expect(urls.some((url) => url.includes("/groups/group-1/members"))).toBe(true);
  });

  it("validates credentials with a small directory read", async () => {
    const fetchImpl = fetchStub(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://oauth2.googleapis.com/token")
        ? tokenResponse()
        : json({ users: [{ id: "u1", primaryEmail: "one@example.com" }] }),
    );

    const service = makeGoogleWorkspaceService({ credentials, fetch: fetchImpl });

    await expect(Effect.runPromise(service.validate())).resolves.toEqual({
      ok: true,
      message: "Google Workspace is reachable; 1 user(s) visible on the first page.",
    });
  });
});
