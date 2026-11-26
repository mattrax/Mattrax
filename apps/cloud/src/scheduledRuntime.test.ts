import { Db } from "@mattrax/enterprise-core";
import { Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { MysqlClient } from "@effect/sql-mysql2";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { describe, expect, it, vi } from "vitest";
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
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: number[] = [];
    const completed: number[] = [];
    const jobs = Array.from({ length: 6 }, (_, index) =>
      Effect.gen(function* () {
        started.push(index);
        if (index < 3) yield* Effect.promise(() => gate);
        completed.push(index);
      }),
    );
    const database = Layer.mergeAll(
      Layer.succeed(MysqlClient.MysqlClient, {} as MysqlClient.MysqlClient & SqlClient.SqlClient),
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
    );
    const running = Effect.runPromise(runScheduledJobs(jobs, scheduledRuntimeLayer(database)));

    try {
      await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
      expect(completed).toEqual([]);
    } finally {
      release();
    }

    await running;
    expect(completed).toHaveLength(6);
    expect(new Set(completed)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("finishes independent jobs before propagating a failure", async () => {
    const completed: string[] = [];
    const jobs = [
      Effect.fail("failed job"),
      Effect.sleep("5 millis").pipe(Effect.andThen(Effect.sync(() => completed.push("slow")))),
      Effect.sync(() => completed.push("fast")),
    ];
    const database = Layer.mergeAll(
      Layer.succeed(MysqlClient.MysqlClient, {} as MysqlClient.MysqlClient & SqlClient.SqlClient),
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
    );

    const result = await Effect.runPromiseExit(
      runScheduledJobs(jobs, scheduledRuntimeLayer(database)),
    );

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
