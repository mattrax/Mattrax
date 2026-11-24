import { Db } from "@mattrax/enterprise-core";
import { Effect, Layer } from "effect";
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
