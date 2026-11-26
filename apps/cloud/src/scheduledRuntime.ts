import { Db } from "@mattrax/enterprise-core";
import { Effect, Exit, Layer } from "effect";
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

/**
 * Run independent scheduler jobs with bounded concurrency through one shared
 * runtime scope. Capturing each Exit prevents one failed job from interrupting
 * the others; the first failure is rethrown after every job has finished.
 */
export const runScheduledJobs = <A, E, R>(
  jobs: ReadonlyArray<Effect.Effect<A, E, R>>,
  runtime: Layer.Layer<Db | HttpClient.HttpClient, unknown>,
) =>
  Effect.forEach(jobs, (job) => Effect.exit(job), { concurrency: 3 }).pipe(
    Effect.flatMap((exits) => {
      const failure = exits.find(Exit.isFailure);

      return failure ? Effect.failCause(failure.cause) : Effect.void;
    }),
    Effect.provide(runtime),
  );
