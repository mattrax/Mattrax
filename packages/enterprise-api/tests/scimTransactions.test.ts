import { Effect, Exit } from "effect";
import { HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { recorder } from "../../config/testing/recorder.ts";
import { Db } from "@mattrax/enterprise-core";
import { ScimMembershipNotifier, scimHandler } from "@mattrax/enterprise-api";
import { makeDb, runEffect } from "./helpers.js";

const tenantId = "tenant-acme";
const token = "directory-token";

const makeNotifier = () =>
  recorder((_request: unknown, _response: unknown, _ids: ReadonlyArray<string>) => Effect.void);

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const makeScimDb = async (expiresAt: Date | null = null) => {
  const db = makeDb();
  const at = new Date(0);

  db.store.scim_token.push({
    id: "scim-token",
    organizationId: tenantId,
    name: "IdP connector",
    tokenHash: await sha256Hex(token),
    lastUsedAt: null,
    expiresAt,
    revokedAt: null,
    createdAt: at,
    updatedAt: at,
  });

  return db;
};

const request = (options: { method?: string; path?: string; tenantId?: string; body?: unknown }) =>
  ({
    headers: { authorization: `Bearer ${token}` },
    url: `https://enterprise.test/scim/v2/${options.tenantId ?? tenantId}${options.path ?? "/Users"}`,
    method: options.method ?? "GET",
    json: Effect.succeed(options.body ?? {}),
  }) as any;

const callScim = (
  db: ReturnType<typeof makeDb>,
  options: Parameters<typeof request>[0],
  notifier?: ScimMembershipNotifier["Service"],
) => {
  const effect = scimHandler(request(options)).pipe(Effect.provideService(Db, db));

  return runEffect(
    notifier ? effect.pipe(Effect.provideService(ScimMembershipNotifier, notifier)) : effect,
  );
};

const responseJson = async (response: any) => HttpServerResponse.toWeb(response).json();

const createUser = async (db: ReturnType<typeof makeDb>, userName: string) => {
  const response = await callScim(db, {
    method: "POST",
    body: { userName },
  });

  expect(response.status).toBe(201);

  return (await responseJson(response)) as { id: string };
};

const createGroup = async (
  db: ReturnType<typeof makeDb>,
  members: Array<{ value: string }> = [],
) => {
  const response = await callScim(db, {
    method: "POST",
    path: "/Groups",
    body: { displayName: "Staff", members },
  });

  expect(response.status).toBe(201);

  return (await responseJson(response)) as { id: string };
};

describe("SCIM path and clock boundaries", () => {
  it("maps malformed percent escapes to invalidSyntax", async () => {
    const db = await makeScimDb();
    const response = await callScim(db, { tenantId: "%E0%A4%A" });

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      status: "400",
      scimType: "invalidSyntax",
    });
  });

  it("preserves interruption while reading a request body", async () => {
    const db = await makeScimDb();
    const interrupted = { ...request({ method: "POST" }), json: Effect.interrupt };
    const exit = await Effect.runPromiseExit(
      scimHandler(interrupted).pipe(Effect.provideService(Db, db)),
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
  });

  it("uses the Effect clock for token expiry", async () => {
    const db = await makeScimDb(new Date(1_000));

    await Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* scimHandler(request({}));
        yield* TestClock.setTime(1_000);
        const after = yield* scimHandler(request({}));

        expect(before.status).toBe(200);
        expect(after.status).toBe(401);
      }).pipe(Effect.provideService(Db, db), Effect.provide(TestClock.layer())),
    );
  });
});

describe("SCIM atomic mutations", () => {
  it("rolls back a failed user insert", async () => {
    const db = await makeScimDb();
    db.failNextWrite("insert", "user");

    const response = await callScim(db, { method: "POST", body: { userName: "ada@example.com" } });

    expect(response.status).toBe(500);
    expect(db.store.user).toEqual([]);
  });

  it("rolls back a failed profile update", async () => {
    const db = await makeScimDb();
    const user = await createUser(db, "ada@example.com");
    db.failNextWrite("update", "user");

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Users/${user.id}`,
      body: { Operations: [{ op: "replace", path: "name.formatted", value: "Changed" }] },
    });

    expect(response.status).toBe(500);
    expect(db.store.user.find((row: any) => row.id === user.id)?.name).toBe("ada@example.com");
  });

  it("rolls back a failed upsert of an existing user", async () => {
    const db = await makeScimDb();
    const user = await createUser(db, "ada@example.com");
    db.failNextWrite("update", "user");

    const response = await callScim(db, {
      method: "POST",
      body: { userName: "ada@example.com", name: { formatted: "Changed" } },
    });

    expect(response.status).toBe(500);
    expect(db.store.user).toHaveLength(1);
    expect(db.store.user.find((row: any) => row.id === user.id)?.name).toBe("ada@example.com");
  });

  it("rolls back a user update and membership removal together", async () => {
    const db = await makeScimDb();
    const user = await createUser(db, "ada@example.com");
    const group = await createGroup(db, [{ value: user.id }]);
    const notifier = makeNotifier();

    db.failNextWrite("delete", "user_group_member");

    const response = await callScim(
      db,
      {
        method: "PATCH",
        path: `/Users/${user.id}`,
        body: { Operations: [{ op: "replace", path: "active", value: false }] },
      },
      notifier,
    );

    expect(response.status).toBe(500);
    expect(db.store.user.find((row: any) => row.id === user.id)?.disabled).toBe(false);
    expect(db.store.user_group_member).toEqual([{ groupId: group.id, userId: user.id }]);
    expect(notifier.calls).toHaveLength(0);
  });

  it("rolls back a failed group insert before members are written", async () => {
    const db = await makeScimDb();
    const user = await createUser(db, "ada@example.com");
    db.failNextWrite("insert", "user_group");

    const response = await callScim(db, {
      method: "POST",
      path: "/Groups",
      body: { displayName: "Staff", members: [{ value: user.id }] },
    });

    expect(response.status).toBe(500);
    expect(db.store.user_group).toEqual([]);
    expect(db.store.user_group_member).toEqual([]);
  });

  it("rolls back a created group when member insertion fails", async () => {
    const db = await makeScimDb();
    const user = await createUser(db, "ada@example.com");
    db.failNextWrite("insert", "user_group_member");

    const response = await callScim(db, {
      method: "POST",
      path: "/Groups",
      body: { displayName: "Staff", members: [{ value: user.id }] },
    });

    expect(response.status).toBe(500);
    expect(db.store.user_group).toEqual([]);
    expect(db.store.user_group_member).toEqual([]);
  });

  it("keeps the old collection when membership deletion fails", async () => {
    const db = await makeScimDb();
    const user = await createUser(db, "ada@example.com");
    const group = await createGroup(db, [{ value: user.id }]);
    db.failNextWrite("delete", "user_group_member");

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Groups/${group.id}`,
      body: { Operations: [{ op: "replace", path: "members", value: [] }] },
    });

    expect(response.status).toBe(500);
    expect(db.store.user_group_member).toEqual([{ groupId: group.id, userId: user.id }]);
  });

  it("restores the old collection when replacement insertion fails", async () => {
    const db = await makeScimDb();
    const first = await createUser(db, "ada@example.com");
    const second = await createUser(db, "bob@example.com");
    const group = await createGroup(db, [{ value: first.id }]);
    db.failNextWrite("insert", "user_group_member");

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Groups/${group.id}`,
      body: {
        Operations: [{ op: "replace", path: "members", value: [{ value: second.id }] }],
      },
    });

    expect(response.status).toBe(500);
    expect(db.store.user_group_member).toEqual([{ groupId: group.id, userId: first.id }]);
  });

  it("validates every PATCH operation before applying the first one", async () => {
    const db = await makeScimDb();
    const first = await createUser(db, "ada@example.com");
    const second = await createUser(db, "bob@example.com");
    const group = await createGroup(db, [{ value: first.id }]);

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Groups/${group.id}`,
      body: {
        Operations: [
          { op: "add", path: "members", value: [{ value: second.id }] },
          { op: "invalid", path: "members", value: [] },
        ],
      },
    });

    expect(response.status).toBe(400);
    expect(db.store.user_group_member).toEqual([{ groupId: group.id, userId: first.id }]);
  });

  it("rolls back earlier PATCH writes when a later write fails", async () => {
    const db = await makeScimDb();
    const first = await createUser(db, "ada@example.com");
    const second = await createUser(db, "bob@example.com");
    const group = await createGroup(db, [{ value: first.id }]);
    const notifier = makeNotifier();
    db.failNextWrite("delete", "user_group_member");

    const response = await callScim(
      db,
      {
        method: "PATCH",
        path: `/Groups/${group.id}`,
        body: {
          Operations: [
            { op: "add", path: "members", value: [{ value: second.id }] },
            { op: "remove", path: "members", value: [{ value: first.id }] },
          ],
        },
      },
      notifier,
    );

    expect(response.status).toBe(500);
    expect(db.store.user_group_member).toEqual([{ groupId: group.id, userId: first.id }]);
    expect(notifier.calls).toHaveLength(0);
  });

  it("rolls back a failed membership insert", async () => {
    const db = await makeScimDb();
    const first = await createUser(db, "ada@example.com");
    const second = await createUser(db, "bob@example.com");
    const group = await createGroup(db, [{ value: first.id }]);
    db.failNextWrite("insert", "user_group_member");

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Groups/${group.id}`,
      body: { Operations: [{ op: "add", path: "members", value: [{ value: second.id }] }] },
    });

    expect(response.status).toBe(500);
    expect(db.store.user_group_member).toEqual([{ groupId: group.id, userId: first.id }]);
  });

  it("rolls back membership changes when the group timestamp update fails", async () => {
    const db = await makeScimDb();
    const first = await createUser(db, "ada@example.com");
    const second = await createUser(db, "bob@example.com");
    const group = await createGroup(db, [{ value: first.id }]);
    db.failNextWrite("update", "user_group");

    const response = await callScim(db, {
      method: "PATCH",
      path: `/Groups/${group.id}`,
      body: { Operations: [{ op: "add", path: "members", value: [{ value: second.id }] }] },
    });

    expect(response.status).toBe(500);
    expect(db.store.user_group_member).toEqual([{ groupId: group.id, userId: first.id }]);
  });

  it("does not notify when a user or group delete fails", async () => {
    const db = await makeScimDb();
    const user = await createUser(db, "ada@example.com");
    const group = await createGroup(db, [{ value: user.id }]);
    const notifier = makeNotifier();

    db.failNextWrite("delete", "user");
    expect(
      (await callScim(db, { method: "DELETE", path: `/Users/${user.id}` }, notifier)).status,
    ).toBe(500);

    db.failNextWrite("delete", "user_group");
    expect(
      (await callScim(db, { method: "DELETE", path: `/Groups/${group.id}` }, notifier)).status,
    ).toBe(500);

    expect(db.store.user.map((row: any) => row.id)).toContain(user.id);
    expect(db.store.user_group.map((row: any) => row.id)).toContain(group.id);
    expect(notifier.calls).toHaveLength(0);
  });

  it("notifies only after a membership mutation commits", async () => {
    const db = await makeScimDb();
    const first = await createUser(db, "ada@example.com");
    const second = await createUser(db, "bob@example.com");
    const group = await createGroup(db, [{ value: first.id }]);
    const notifier = makeNotifier();

    const response = await callScim(
      db,
      {
        method: "PATCH",
        path: `/Groups/${group.id}`,
        body: { Operations: [{ op: "add", path: "members", value: [{ value: second.id }] }] },
      },
      notifier,
    );

    expect(response.status).toBe(200);
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.mock.calls[0]?.[2]).toEqual([second.id]);
    expect(db.store.user_group_member).toHaveLength(2);
  });
});
