import { Effect, Stream } from "effect";
import { layer as reactivityLayer } from "effect/reactivity/Reactivity";
import { SqlClient } from "effect/sql";
import type { Connection } from "effect/sql/SqlConnection";
import { MysqlClient } from "@effect/sql-mysql2";
import {
  resetStorageMetadataCache,
  storageMetadataCacheSize,
  validateStorageBatch,
  withStorageValidation,
} from "@yielded/auth-persistence/Adapter";
import { beforeEach, describe, expect, it } from "vitest";

type Counters = { columns: number; indexes: number };

type Behaviour = {
  readonly failColumns?: boolean;
  readonly omitColumn?: string;
};

const table = {
  name: "tenant",
  columns: { id: { name: "id" } },
};

const tableWithName = {
  name: "tenant",
  columns: { id: { name: "id" }, name: { name: "name" } },
};

const requirements = [{ table, required: [["id"]] }];
const requirementsWithName = [{ table: tableWithName, required: [["id"]] }];

const makeConnection = (counters: Counters, behaviour: Behaviour = {}): Connection => {
  const rows = (sql: string) => {
    if (sql.includes("information_schema.columns")) {
      counters.columns++;

      if (behaviour.failColumns) throw new Error("catalog is unavailable");

      return [
        { relation: '"tenant"', name: "id", type: "varchar", collation: "utf8mb4_bin" },
        ...(behaviour.omitColumn === "name"
          ? []
          : [{ relation: '"tenant"', name: "name", type: "varchar", collation: "utf8mb4_bin" }]),
      ];
    }

    if (sql.includes("information_schema.statistics")) {
      counters.indexes++;

      return [{ relation: '"tenant"', name: "PRIMARY", columnName: "id", prefix: null }];
    }

    return [];
  };

  return {
    execute: (sql) => Effect.sync(() => rows(sql)),
    executeRaw: () => Effect.succeed([]),
    executeStream: () => Stream.empty,
    executeValues: () => Effect.succeed([]),
    executeValuesUnprepared: () => Effect.succeed([]),
    executeUnprepared: (sql) => Effect.sync(() => rows(sql)),
  };
};

const makeClient = (counters: Counters, behaviour: Behaviour = {}) =>
  Effect.gen(function* () {
    return yield* SqlClient.make({
      acquirer: Effect.succeed(makeConnection(counters, behaviour)),
      compiler: MysqlClient.makeCompiler(),
      driver: "mysql",
      spanAttributes: [],
    });
  }).pipe(Effect.provide(reactivityLayer));

const validate = (counters: Counters, behaviour: Behaviour = {}, validation = requirements) =>
  Effect.gen(function* () {
    const client = yield* makeClient(counters, behaviour);

    yield* validateStorageBatch("mysql", validation).pipe(
      Effect.provideService(SqlClient.SqlClient, client),
    );
  });

const loaded = (counters: Counters) => counters.columns + counters.indexes;

describe("auth storage metadata cache", () => {
  beforeEach(() => {
    resetStorageMetadataCache();
  });

  it("performs no information_schema validation on a warm request", async () => {
    const first: Counters = { columns: 0, indexes: 0 };
    const second: Counters = { columns: 0, indexes: 0 };

    await Effect.runPromise(validate(first));
    await Effect.runPromise(validate(second));

    expect(loaded(first)).toBe(2);
    expect(loaded(second)).toBe(0);
    expect(storageMetadataCacheSize()).toBe(1);
  });

  it("expires a warm entry after the bounded TTL", async () => {
    const first: Counters = { columns: 0, indexes: 0 };
    const second: Counters = { columns: 0, indexes: 0 };
    let now = 1_000_000;
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      await Effect.runPromise(validate(first));
      now += 60_001;
      await Effect.runPromise(validate(second));
    } finally {
      Date.now = originalNow;
    }

    expect(loaded(first)).toBe(2);
    expect(loaded(second)).toBe(2);
  });

  it("does not cache a failed catalog read", async () => {
    const failing: Counters = { columns: 0, indexes: 0 };
    const recovered: Counters = { columns: 0, indexes: 0 };

    await expect(Effect.runPromise(validate(failing, { failColumns: true }))).rejects.toBeDefined();
    expect(storageMetadataCacheSize()).toBe(0);

    await Effect.runPromise(validate(recovered));

    expect(loaded(failing)).toBe(1);
    expect(loaded(recovered)).toBe(2);
  });

  it("invalidates a cached snapshot when a required column is missing", async () => {
    const incomplete: Counters = { columns: 0, indexes: 0 };
    const recovered: Counters = { columns: 0, indexes: 0 };

    await expect(
      Effect.runPromise(validate(incomplete, { omitColumn: "name" }, requirementsWithName)),
    ).rejects.toBeDefined();
    expect(storageMetadataCacheSize()).toBe(0);

    await Effect.runPromise(validate(recovered, {}, requirementsWithName));

    expect(loaded(incomplete)).toBe(2);
    expect(loaded(recovered)).toBe(2);
  });

  it("shares one catalog read inside a production withStorageValidation acquisition", async () => {
    const counters: Counters = { columns: 0, indexes: 0 };
    const client = await Effect.runPromise(makeClient(counters));

    await Effect.runPromise(
      withStorageValidation(
        Effect.gen(function* () {
          yield* validateStorageBatch("mysql", requirements).pipe(
            Effect.provideService(SqlClient.SqlClient, client),
          );

          // Clear the module cache between the two calls. The acquisition-local
          // cache must still serve the second validation without SQL.
          resetStorageMetadataCache();

          yield* validateStorageBatch("mysql", requirements).pipe(
            Effect.provideService(SqlClient.SqlClient, client),
          );
        }),
      ).pipe(Effect.provideService(SqlClient.SqlClient, client)),
    );

    expect(loaded(counters)).toBe(2);
  });

  it("revalidates after the process cache is cleared", async () => {
    const first: Counters = { columns: 0, indexes: 0 };
    const second: Counters = { columns: 0, indexes: 0 };

    await Effect.runPromise(validate(first));
    resetStorageMetadataCache();
    await Effect.runPromise(validate(second));

    expect(loaded(first)).toBe(2);
    expect(loaded(second)).toBe(2);
  });
});
