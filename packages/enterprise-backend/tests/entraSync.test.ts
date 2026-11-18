import { describe, expect, it } from "vitest";
import { Effect, Predicate } from "effect";
import { syncEntraDirectory } from "@mattrax/entra-id";
import { makeDb } from "./helpers.js";

const user = (id: string, email: string) => ({
  id,
  mail: email,
  displayName: email.split("@")[0],
  accountEnabled: true,
});

const group = (id: string, displayName: string, members: string[] = []) => ({
  id,
  displayName,
  members,
});

const page = <T>(items: T[], next?: string, delta?: string) => ({
  items,
  nextLink: next,
  deltaLink: delta,
});

type EntraUser = ReturnType<typeof user>;

type EntraGroup = ReturnType<typeof group>;

// SAFETY: the double implements only the Graph calls `syncEntraDirectory` makes;
// the remaining members are unused by this path.
const makeGraph = (options: {
  users: Array<EntraUser>;
  groups: Array<EntraGroup> | (() => Effect.Effect<never, Error>);
}) =>
  ({
    domains: () =>
      Effect.succeed([
        { id: "acme.com", isVerified: true, isInitial: false },
        { id: "acme.onmicrosoft.com", isVerified: true, isInitial: false },
      ]),
    usersDelta: (_tenantId: string, link?: string) =>
      Effect.succeed(
        link
          ? page([user("u2", "two@acme.com")], undefined, "users-delta")
          : page(options.users, "users-next"),
      ),
    groupsDelta: () =>
      Predicate.isFunction(options.groups)
        ? options.groups()
        : Effect.succeed(page(options.groups, undefined, "groups-delta")),
  }) as never;

const baseOptions = {
  organizationId: "org-1",
  azureTenantId: "entra-1",
  autoProvision: true,
  syncUsersAndGroups: true,
} as const;

/** A Graph double whose user and group listings complete in one page. */
const singlePageGraph = (options: {
  users: ReadonlyArray<unknown>;
  groups?: ReadonlyArray<unknown>;
}) =>
  // SAFETY: the double implements only the three Graph reads this sync makes;
  // the remaining members are unused by this path.
  ({
    domains: () => Effect.succeed([{ id: "acme.com", isVerified: true, isInitial: false }]),
    usersDelta: () => Effect.succeed(page(options.users, undefined, "users-delta")),
    groupsDelta: () => Effect.succeed(page(options.groups ?? [], undefined, "groups-delta")),
  }) as never;

describe("syncEntraDirectory pagination", () => {
  it("commits each page and reports delta cursors as resource classes finish", async () => {
    const db = makeDb();

    const progress: Array<{
      users: number;
      groups: number;
      usersDelta?: string;
      groupsDelta?: string;
    }> = [];

    let transactions = 0;
    const transaction = db.transaction;
    db.transaction = <Result>(work: (tx: any) => Result): Result => {
      transactions++;

      return transaction(work);
    };

    const result = await Effect.runPromise(
      syncEntraDirectory({
        ...baseOptions,
        db,
        graph: makeGraph({
          users: [user("u1", "one@acme.com")],
          groups: [{ id: "g1", displayName: "Group", members: [] }],
        }),
        onProgress: (value) =>
          Effect.sync(() => {
            progress.push(value);
          }),
      }),
    );

    expect(result).toMatchObject({ users: 2, groups: 1, domains: 1 });
    expect(result.usersDelta).toBe("users-delta");
    expect(result.groupsDelta).toBe("groups-delta");
    // Two user pages + one group page, each in its own transaction.
    expect(transactions).toBe(3);
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({ users: 2, usersDelta: "users-delta" });
    expect(progress[1]).toMatchObject({ groups: 1, groupsDelta: "groups-delta" });
  });

  it("keeps the users cursor when the group phase fails", async () => {
    const db = makeDb();
    const progress: Array<{ usersDelta?: string; groupsDelta?: string }> = [];

    await expect(
      Effect.runPromise(
        syncEntraDirectory({
          ...baseOptions,
          db,
          graph: makeGraph({
            users: [user("u1", "one@acme.com")],
            groups: () => Effect.fail(new Error("graph down")),
          }),
          onProgress: (value) =>
            Effect.sync(() => {
              progress.push(value);
            }),
        }),
      ),
    ).rejects.toThrow("graph down");

    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ usersDelta: "users-delta" });
    expect(progress[0].groupsDelta).toBeUndefined();
  });

  it("skips user/group work for a domain-only refresh", async () => {
    const db = makeDb();
    let called = false;

    // SAFETY: the fake implements only the three Graph reads this refresh uses.
    const graph = {
      domains: () => Effect.succeed([{ id: "acme.com", isVerified: true, isInitial: false }]),
      usersDelta: () => {
        called = true;

        return Effect.succeed(page([]));
      },
      groupsDelta: () => {
        called = true;

        return Effect.succeed(page([]));
      },
    } as never;

    const result = await Effect.runPromise(
      syncEntraDirectory({
        ...baseOptions,
        syncUsersAndGroups: false,
        db,
        graph,
      }),
    );

    expect(result).toMatchObject({ users: 0, groups: 0, domains: 1 });
    expect(called).toBe(false);
  });
});

describe("syncEntraDirectory directory users", () => {
  it("imports tenant directory users without creating accounts or members", async () => {
    const db = makeDb();

    const result = await Effect.runPromise(
      syncEntraDirectory({
        ...baseOptions,
        db,
        graph: singlePageGraph({
          users: [
            {
              id: "graph-1",
              mail: "Ada@Acme.com",
              displayName: "Ada Lovelace",
              accountEnabled: true,
            },
          ],
        }),
      }),
    );

    expect(result.users).toBe(1);
    expect(db.store.user).toHaveLength(1);
    expect(db.store.user[0]).toMatchObject({
      organizationId: "org-1",
      name: "Ada Lovelace",
      email: "ada@acme.com",
      externalId: "graph-1",
      source: "entra",
      disabled: false,
    });

    // Directory people are not dashboard identities: no account, membership,
    // invitation or SSO link is provisioned by a sync.
    expect(db.store.account).toEqual([]);
    expect(db.store.member).toEqual([]);
    expect(db.store.invitation).toEqual([]);
    expect(db.store.sso_identity).toEqual([]);
  });

  it("imports directory users even when tenant auto-provisioning is disabled", async () => {
    const db = makeDb();

    await Effect.runPromise(
      syncEntraDirectory({
        ...baseOptions,
        autoProvision: false,
        db,
        graph: singlePageGraph({
          users: [{ id: "graph-1", mail: "ada@acme.com", accountEnabled: true }],
        }),
      }),
    );

    expect(db.store.user).toHaveLength(1);
    expect(db.store.account).toEqual([]);
  });

  it("disables a removed directory user without touching accounts or members", async () => {
    const timestamp = new Date();

    const db = makeDb({
      account: [
        {
          id: "acc-1",
          name: "Ada",
          email: "ada@acme.com",
          emailVerified: true,
          image: null,
          disabled: false,
          source: "manual",
          authRevision: "revision",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      member: [
        {
          id: "member-1",
          organizationId: "org-1",
          accountId: "acc-1",
          role: "owner",
          customRoleId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      user: [
        {
          id: "dir-1",
          organizationId: "org-1",
          name: "Ada",
          email: "ada@acme.com",
          externalId: "graph-1",
          source: "entra",
          disabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "dir-2",
          organizationId: "org-1",
          name: "Bob",
          email: "bob@acme.com",
          externalId: "graph-2",
          source: "entra",
          disabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      user_group: [
        {
          id: "group-1",
          organizationId: "org-1",
          name: "Staff",
          externalId: "graph-group-1",
          description: null,
          source: "graph",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      user_group_member: [
        { groupId: "group-1", userId: "dir-1" },
        { groupId: "group-1", userId: "dir-2" },
      ],
      sso_identity: [
        { organizationId: "org-1", objectId: "graph-1", accountId: "acc-1", createdAt: timestamp },
      ],
    });

    await Effect.runPromise(
      syncEntraDirectory({
        ...baseOptions,
        db,
        graph: singlePageGraph({
          users: [
            { id: "graph-1", removed: true },
            { id: "graph-2", mail: "bob@acme.com", displayName: "Bob", accountEnabled: true },
          ],
        }),
      }),
    );

    expect(db.store.user.find((row: any) => row.id === "dir-1")?.disabled).toBe(true);
    expect(db.store.user.find((row: any) => row.id === "dir-2")?.disabled).toBe(false);

    // Only the removed person's directory grants disappear.
    expect(db.store.user_group_member).toEqual([{ groupId: "group-1", userId: "dir-2" }]);

    // Accounts, memberships and SSO links are a separate identity and survive,
    // including the tenant's only owner.
    expect(db.store.account).toHaveLength(1);
    expect(db.store.member).toHaveLength(1);
    expect(db.store.member[0]).toMatchObject({ accountId: "acc-1", role: "owner" });
    expect(db.store.sso_identity).toHaveLength(1);
  });

  it("maps Graph group members to directory users by external id", async () => {
    const timestamp = new Date();

    const db = makeDb({
      user: [
        {
          id: "dir-1",
          organizationId: "org-1",
          name: "Ada",
          email: "ada@acme.com",
          externalId: "graph-1",
          source: "entra",
          disabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "dir-other",
          organizationId: "org-2",
          name: "Ada elsewhere",
          email: "ada@acme.com",
          externalId: "graph-1",
          source: "entra",
          disabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      user_group: [
        {
          id: "group-1",
          organizationId: "org-1",
          name: "Staff",
          externalId: "graph-group-1",
          description: null,
          source: "graph",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      user_group_member: [{ groupId: "group-1", userId: "dir-1" }],
    });

    await Effect.runPromise(
      syncEntraDirectory({
        ...baseOptions,
        db,
        graph: singlePageGraph({
          users: [{ id: "graph-1", mail: "ada@acme.com", displayName: "Ada", accountEnabled: true }],
          groups: [
            {
              id: "graph-group-1",
              displayName: "Staff",
              members: [{ id: "graph-1", type: "user", removed: true }],
            },
            {
              id: "graph-group-2",
              displayName: "Engineers",
              members: [{ id: "graph-1", type: "user" }],
            },
          ],
        }),
      }),
    );

    const engineers = db.store.user_group.find(
      (row: any) => row.externalId === "graph-group-2",
    );

    expect(engineers).toMatchObject({ organizationId: "org-1", source: "graph" });
    // The member was added to the new group and removed from the old one, and
    // the same external id in another tenant was never touched.
    expect(db.store.user_group_member).toEqual([{ groupId: engineers.id, userId: "dir-1" }]);
  });
});
