import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { syncEntraDirectory } from "../src/entraSync.js";
import { makeDb } from "./helpers.js";

const user = (id: string, email: string) => ({
  id,
  mail: email,
  displayName: email.split("@")[0],
  accountEnabled: true,
});

const page = <T>(items: T[], next?: string, delta?: string) => ({
  items,
  nextLink: next,
  deltaLink: delta,
});

const makeGraph = (options: {
  users: Array<unknown>;
  groups: Array<unknown> | (() => Effect.Effect<never, Error>);
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
      typeof options.groups === "function"
        ? options.groups()
        : Effect.succeed(page(options.groups, undefined, "groups-delta")),
  }) as never;

const baseOptions = {
  organizationId: "org-1",
  azureTenantId: "entra-1",
  autoProvision: true,
  syncUsersAndGroups: true,
} as const;

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
    db.transaction = (work: (tx: any) => unknown) => {
      transactions++;
      return transaction(work);
    };

    const result = await Effect.runPromise(
      syncEntraDirectory({
        ...baseOptions,
        db: db as never,
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
          db: db as never,
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
        db: db as never,
        graph,
      }),
    );

    expect(result).toMatchObject({ users: 0, groups: 0, domains: 1 });
    expect(called).toBe(false);
  });
});
