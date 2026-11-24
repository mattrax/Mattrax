import { Db } from "@mattrax/enterprise-core";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";
import type { MysqlClient } from "@effect/sql-mysql2";

/**
 * One scoped runtime for a whole scheduler tick. Every job shares the same
 * MysqlClient pool and outbound transport instead of provisioning leaf layers.
 */
export const scheduledRuntimeLayer = (
  database: Layer.Layer<MysqlClient.MysqlClient | SqlClient.SqlClient, unknown>,
  httpClient: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer,
): Layer.Layer<Db | HttpClient.HttpClient, unknown> =>
  Layer.mergeAll(Db.layer, httpClient).pipe(Layer.provide(database));

/** Run scheduler jobs in a stable order through one shared runtime scope. */
export const runScheduledJobs = <A, E, R>(
  jobs: ReadonlyArray<Effect.Effect<A, E, R>>,
  runtime: Layer.Layer<Db | HttpClient.HttpClient, unknown>,
) =>
  Effect.forEach(jobs, (job) => Effect.asVoid(job), { concurrency: 1, discard: true }).pipe(
    Effect.provide(runtime),
  );
