import { Effect, Stream } from "effect";
import { layer as reactivityLayer } from "effect/reactivity/Reactivity";
import { SqlClient } from "effect/sql";
import type { Connection } from "effect/sql/SqlConnection";
import { MysqlClient } from "@effect/sql-mysql2";
import {
  resetStorageMetadataCache,
  storageMetadataCacheSize,
  validateStorageBatch,
} from "@yielded/auth-persistence/Adapter";
import { beforeEach, describe, expect, it } from "vitest";

type Counters = { columns: number; indexes: number };

const table = {
  name: "tenant",
  columns: { id: { name: "id" } },
};

const requirements = [{ table, required: [["id"]] }];

const makeConnection = (counters: Counters): Connection => {
  const rows = (sql: string) => {
    if (sql.includes("information_schema.columns")) {
      counters.columns++;

      return [{ relation: '"tenant"', name: "id", type: "varchar", collation: "utf8mb4_bin" }];
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

const validate = (counters: Counters) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.make({
      acquirer: Effect.succeed(makeConnection(counters)),
      compiler: MysqlClient.makeCompiler(),
      driver: "mysql",
      spanAttributes: [],
    });

    yield* validateStorageBatch("mysql", requirements).pipe(
      Effect.provideService(SqlClient.SqlClient, client),
    );
  }).pipe(Effect.provide(reactivityLayer));

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

  it("revalidates after the cache is cleared", async () => {
    const first: Counters = { columns: 0, indexes: 0 };
    const second: Counters = { columns: 0, indexes: 0 };

    await Effect.runPromise(validate(first));
    resetStorageMetadataCache();
    await Effect.runPromise(validate(second));

    expect(loaded(first)).toBe(2);
    expect(loaded(second)).toBe(2);
  });
});
