import { Context, Effect, Layer, Stream } from "effect";
import { layer as reactivityLayer } from "effect/reactivity/Reactivity";
import { SqlClient } from "effect/sql";
import type { Connection } from "effect/sql/SqlConnection";
import { MysqlClient } from "@effect/sql-mysql2";
import { Schema as AuthSchema, Sessions } from "@yielded/auth";
import { AuthPersistenceConfig, authStorage } from "@mattrax/enterprise-core";
import { describe, expect, it } from "vitest";

type Counters = { columns: number; indexes: number };

const makeClient = async (counters: Counters) => {
  const rows = (sql: string) => {
    if (sql.includes("information_schema.columns")) counters.columns++;
    if (sql.includes("information_schema.statistics")) counters.indexes++;

    return [];
  };
  const connection: Connection = {
    execute: (sql) => Effect.sync(() => rows(sql)),
    executeRaw: () => Effect.succeed([]),
    executeStream: () => Stream.empty,
    executeValues: () => Effect.succeed([]),
    executeValuesUnprepared: () => Effect.succeed([]),
    executeUnprepared: (sql) => Effect.sync(() => rows(sql)),
  };
  const client = await Effect.runPromise(
    SqlClient.make({
      acquirer: Effect.succeed(connection),
      compiler: MysqlClient.makeCompiler(),
      driver: "mysql",
      spanAttributes: [],
    }).pipe(Effect.provide(reactivityLayer)),
  );

  return Object.assign(client, {
    [MysqlClient.TypeId]: MysqlClient.TypeId,
    config: {},
  }) as MysqlClient.MysqlClient & SqlClient.SqlClient;
};

describe("AuthPersistence MySQL composition", () => {
  it("builds the real MySQL consumer path into storage validation", async () => {
    const counters: Counters = { columns: 0, indexes: 0 };
    const client = await makeClient(counters);
    const layer = AuthPersistenceConfig.layer.pipe(
      Layer.provide(AuthPersistenceConfig.Config.layer(authStorage)),
      Layer.provide(Layer.succeed(MysqlClient.MysqlClient, client)),
      Layer.provide(Layer.succeed(SqlClient.SqlClient, client)),
    );

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(layer as Layer.Layer<unknown, never, never>);
          const authority = Context.get(context, Sessions.AuthenticationAuthority);

          // The composed config is intentionally erased at the enterprise-core
          // boundary; the runtime service itself has no remaining requirements.
          const capture = authority.capture(
            AuthSchema.SubjectId.make("subject-1"),
            [],
          ) as Effect.Effect<unknown, unknown, never>;

          return yield* Effect.exit(capture);
        }),
      ),
    );

    // If the MySQL dialect mapping were missing, createPersistence would fail
    // before issuing any catalog query. Reaching information_schema proves the
    // real AuthPersistenceConfig consumer path selected MySQL and validated.
    expect(counters.columns).toBeGreaterThan(0);
    expect(counters.indexes).toBeGreaterThan(0);
    expect(result._tag).toBe("Failure");
  });
});
