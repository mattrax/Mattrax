import { Effect, Exit, Schedule } from "effect";
import { describe, expect, it } from "vitest";
import { isTransientDatabaseError, runMigrations } from "./migrations.js";
import type { Migration, MigrationConnection } from "./migrations.js";

const migration: Migration = {
  name: "20261124000000_example",
  statements: ["CREATE TABLE example (id INT)", "INSERT INTO example VALUES (1)"],
  hash: "hash",
  createdAt: Date.UTC(2026, 10, 24),
};

const asRows = <T extends unknown[]>(rows: unknown[]): T => rows as T;

const makeConnection = (
  failStatement = false,
  acquired: number | string = 1,
): MigrationConnection & { readonly sql: string[]; readonly ended: boolean } => {
  const state = {
    sql: [] as string[],
    ended: false,
    async query<T extends unknown[] = unknown[]>(sql: string): Promise<[T, unknown]> {
      state.sql.push(sql);

      if (sql.startsWith("SELECT GET_LOCK")) return [asRows<T>([{ acquired }]), []];
      if (sql.startsWith("SELECT hash")) return [asRows<T>([]), []];
      if (failStatement && sql.startsWith("CREATE TABLE")) throw new Error("DDL failed");

      return [asRows<T>([]), []];
    },
    async end() {
      state.ended = true;
    },
  };

  return state;
};

const options = (connection: MigrationConnection) => ({
  migrations: [migration],
  lockName: "test_migrate",
  label: "test",
  log: () => {},
  retrySchedule: Schedule.recurs(2),
  connect: Effect.succeed(connection),
});

describe("shared migration runner", () => {
  it("uses a parameterized advisory lock and records applied migrations", async () => {
    const connection = makeConnection();
    const queries: Array<{ sql: string; values?: Array<unknown> }> = [];
    const tracked: MigrationConnection = {
      query: (sql, values) => {
        queries.push({ sql, values });
        return connection.query(sql, values);
      },
      end: () => connection.end(),
    };

    await Effect.runPromise(runMigrations(options(tracked)));

    expect(queries[0]).toEqual({
      sql: "SELECT GET_LOCK(?, 60) AS acquired",
      values: ["test_migrate"],
    });
    expect(queries.at(-1)).toEqual({
      sql: "SELECT RELEASE_LOCK(?)",
      values: ["test_migrate"],
    });
    expect(queries.some(({ sql }) => sql.includes("INSERT INTO"))).toBe(true);
    expect(connection.ended).toBe(true);
  });

  it("releases the lock and closes the connection when a statement fails", async () => {
    const connection = makeConnection(true);
    const exit = await Effect.runPromiseExit(runMigrations(options(connection)));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(connection.sql.some((sql) => sql.startsWith("SELECT RELEASE_LOCK"))).toBe(true);
    expect(connection.ended).toBe(true);
  });

  it("closes the connection when the advisory lock is unavailable", async () => {
    const connection = makeConnection(false, 0);
    const exit = await Effect.runPromiseExit(runMigrations(options(connection)));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(connection.sql.some((sql) => sql.startsWith("SELECT RELEASE_LOCK"))).toBe(false);
    expect(connection.ended).toBe(true);
  });

  it("retries transient connection failures with the bounded schedule", async () => {
    let attempts = 0;
    const connection = makeConnection();
    const exit = await Effect.runPromiseExit(
      runMigrations({
        ...options(connection),
        connect: Effect.suspend(() => {
          attempts += 1;
          return attempts < 3
            ? Effect.fail(Object.assign(new Error("offline"), { code: "ECONNREFUSED" }))
            : Effect.succeed(connection);
        }),
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(attempts).toBe(3);
  });

  it("does not retry authentication or configuration failures", async () => {
    let attempts = 0;
    const connection = makeConnection();
    const exit = await Effect.runPromiseExit(
      runMigrations({
        ...options(connection),
        connect: Effect.suspend(() => {
          attempts += 1;
          return Effect.fail(
            Object.assign(new Error("denied"), { code: "ER_ACCESS_DENIED_ERROR" }),
          );
        }),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(attempts).toBe(1);
    expect(connection.ended).toBe(false);
  });

  it("bounds the whole run with an overall timeout", async () => {
    const exit = await Effect.runPromiseExit(
      runMigrations({
        ...options(makeConnection()),
        connect: Effect.never,
        timeout: "5 millis",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("recognizes cross-realm errors with transient mysql codes", () => {
    expect(
      isTransientDatabaseError(
        Object.assign(new Error("lost"), { code: "PROTOCOL_CONNECTION_LOST" }),
      ),
    ).toBe(true);
    expect(
      isTransientDatabaseError(
        Object.assign(new Error("denied"), { code: "ER_ACCESS_DENIED_ERROR" }),
      ),
    ).toBe(false);
    expect(isTransientDatabaseError("ECONNREFUSED")).toBe(false);
  });
});
