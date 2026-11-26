import { Db } from "@mattrax/enterprise-core";
import { Deferred, Effect, Exit, Fiber, Layer, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { MysqlClient } from "@effect/sql-mysql2";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { runScheduledJobs, scheduledRuntimeLayer } from "./scheduledRuntime.js";

describe("scheduled runtime", () => {
  it("builds one database pool for every job in a tick", async () => {
    let poolBuilds = 0;
    const database = Layer.mergeAll(
      Layer.effect(
        MysqlClient.MysqlClient,
        Effect.sync(() => {
          poolBuilds += 1;
          // Db.layer only wraps the client; these jobs never execute SQL.
          return {} as MysqlClient.MysqlClient & SqlClient.SqlClient;
        }),
      ),
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
    );
    const jobs = Array.from({ length: 5 }, () =>
      Effect.gen(function* () {
        yield* Db;
      }),
    );

    await Effect.runPromise(runScheduledJobs(jobs, scheduledRuntimeLayer(database)));

    expect(poolBuilds).toBe(1);
  });

  it("routes every job through one replaceable HTTP transport", async () => {
    const requests: string[] = [];
    const client = HttpClient.make((request) => {
      requests.push(request.url);

      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response("ok", { status: 200 })),
      );
    });
    const database = Layer.mergeAll(
      Layer.succeed(MysqlClient.MysqlClient, {} as MysqlClient.MysqlClient & SqlClient.SqlClient),
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
    );
    const jobs = Array.from({ length: 3 }, () =>
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        yield* http.execute(HttpClientRequest.get("https://outbound.example.com/probe"));
      }),
    );

    await Effect.runPromise(
      runScheduledJobs(
        jobs,
        scheduledRuntimeLayer(database, Layer.succeed(HttpClient.HttpClient, client)),
      ),
    );

    expect(requests).toEqual(Array(3).fill("https://outbound.example.com/probe"));
  });

  it("runs independent jobs with bounded concurrency", async () => {
    const gate = await Effect.runPromise(Deferred.make<void>());
    const threeStarted = await Effect.runPromise(Deferred.make<void>());
    const startedCount = await Effect.runPromise(Ref.make(0));
    const started: number[] = [];
    const completed: number[] = [];
    const jobs = Array.from({ length: 6 }, (_, index) =>
      Effect.gen(function* () {
        started.push(index);
        if (index < 3) {
          const count = yield* Ref.updateAndGet(startedCount, (value) => value + 1);
          if (count === 3) yield* Deferred.succeed(threeStarted, undefined);
          yield* Deferred.await(gate);
        }
        completed.push(index);
      }),
    );
    const database = Layer.mergeAll(
      Layer.succeed(MysqlClient.MysqlClient, {} as MysqlClient.MysqlClient & SqlClient.SqlClient),
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
    );
    const running = Effect.runFork(runScheduledJobs(jobs, scheduledRuntimeLayer(database)));

    // The barrier proves exactly three jobs are in flight; no polling or sleep.
    await Effect.runPromise(Deferred.await(threeStarted));
    expect(started).toEqual([0, 1, 2]);
    expect(completed).toEqual([]);

    await Effect.runPromise(Deferred.succeed(gate, undefined));
    await Effect.runPromise(Fiber.join(running));
    expect(completed).toHaveLength(6);
    expect(new Set(completed)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("finishes independent jobs before propagating a failure", async () => {
    const completed: string[] = [];
    const slowGate = await Effect.runPromise(Deferred.make<void>());
    const fastDone = await Effect.runPromise(Deferred.make<void>());
    const jobs = [
      Effect.fail("failed job"),
      Deferred.await(slowGate).pipe(Effect.andThen(Effect.sync(() => void completed.push("slow")))),
      Effect.sync(() => void completed.push("fast")).pipe(
        Effect.andThen(Deferred.succeed(fastDone, undefined)),
      ),
    ];
    const database = Layer.mergeAll(
      Layer.succeed(MysqlClient.MysqlClient, {} as MysqlClient.MysqlClient & SqlClient.SqlClient),
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
    );

    const running = Effect.runFork(runScheduledJobs(jobs, scheduledRuntimeLayer(database)));

    // The fast job finished while the slow one is still gated: the sibling
    // failure must not cut the slow job short.
    await Effect.runPromise(Deferred.await(fastDone));
    expect(completed).toEqual(["fast"]);

    await Effect.runPromise(Deferred.succeed(slowGate, undefined));
    const result = await Effect.runPromise(Fiber.await(running));

    expect(Exit.isFailure(result)).toBe(true);
    expect(completed.sort()).toEqual(["fast", "slow"]);
  });

  it("uses the injected Fetch reference for the shared HttpClient layer", async () => {
    const requests: string[] = [];
    const fetchLayer = Layer.succeed(FetchHttpClient.Fetch, async (input) => {
      requests.push(String(input));

      return new Response("ok", { status: 200 });
    });
    const database = Layer.mergeAll(
      Layer.succeed(MysqlClient.MysqlClient, {} as MysqlClient.MysqlClient & SqlClient.SqlClient),
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
    );
    const runtime = scheduledRuntimeLayer(
      database,
      FetchHttpClient.layer.pipe(Layer.provide(fetchLayer)),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        yield* http.execute(HttpClientRequest.get("https://outbound.example.com/probe"));
      }).pipe(Effect.provide(runtime)),
    );

    expect(requests).toEqual(["https://outbound.example.com/probe"]);
  });
});
