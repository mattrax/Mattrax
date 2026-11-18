#!/usr/bin/env node
/**
 * Development-only MySQL TCP proxy used by `api-bench.ts`.
 *
 * Production reaches MySQL through Hyperdrive in a different region, so every
 * statement costs a full network round trip (tens of milliseconds) even though
 * a local socket costs a fraction of one. This proxy makes local numbers look
 * like production by delaying each direction by half the configured RTT, and
 * counts client commands so a benchmark can attribute statements to an
 * endpoint.
 *
 *   tsx apps/cloud/scripts/db-latency-proxy.ts --latency 40 --port 3307
 *
 * Control API (used by the benchmark, on `--control-port`, default 3309):
 *   GET  /stats  -> { queries, connections }
 *   POST /reset  -> { queries: 0 }
 *
 * It speaks the MySQL wire framing just enough to count commands; it never
 * parses SQL and never modifies the byte stream.
 */
import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer } from "node:net";

const args = process.argv.slice(2);

const numberArg = (name: string, fallback: number): number => {
  const index = args.indexOf(`--${name}`);

  if (index === -1) return fallback;

  const value = Number(args[index + 1]);

  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const stringArg = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);

  if (index === -1) return fallback;

  return args[index + 1] ?? fallback;
};

const latencyMs = numberArg("latency", 40);
const listenPort = numberArg("port", 3307);
const controlPort = numberArg("control-port", 3309);
const targetHost = stringArg("target-host", "127.0.0.1");
const targetPort = numberArg("target-port", 3306);
const verbose = args.includes("--verbose");

/** Half the RTT in each direction, matching a single request/response trip. */
const oneWayDelay = latencyMs / 2;

let queries = 0;
let connections = 0;

/**
 * Count one client command per packet. The application disables prepared
 * statements (Hyperdrive rejects COM_STMT_PREPARE), so `COM_QUERY` is the
 * statement count; PING/QUIT/INIT handshake packets are ignored.
 */
const countCommands = (state: { buffer: Buffer }, chunk: Buffer) => {
  state.buffer = state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk]);

  while (state.buffer.length >= 4) {
    const length = state.buffer.readUIntLE(0, 3);

    if (state.buffer.length < 4 + length) return;

    const command = state.buffer[4];

    // 0x03 = COM_QUERY. 0x16 = COM_STMT_PREPARE (defensive: counted too so a
    // driver change cannot silently under-report).
    if (command === 0x03 || command === 0x16) {
      queries += 1;

      if (verbose)
        console.log(
          state.buffer
            .subarray(5, 4 + length)
            .toString("utf8")
            .slice(0, 500),
        );
    }

    state.buffer = state.buffer.subarray(4 + length);
  }
};

/** Write chunks in arrival order, each after its own delay. */
const delayedWriter = (socket: { write: (chunk: Buffer) => void; destroyed?: boolean }) => {
  let chain = Promise.resolve();

  return (chunk: Buffer, delay = oneWayDelay) => {
    // Always append to the chain: a zero-delay chunk must not overtake one
    // that is still waiting, or MySQL sees packets out of order.
    chain = chain.then(
      () =>
        new Promise<void>((resolve) => {
          const write = () => {
            if (!socket.destroyed) socket.write(chunk);

            resolve();
          };

          if (delay === 0) write();
          else setTimeout(write, delay);
        }),
    );
  };
};

// Delaying the handshake by half an RTT each way is realistic, but the server
// greeting is not a query; `queries` only counts client commands.

const proxy = createServer((client) => {
  connections += 1;

  const upstream = createConnection({ host: targetHost, port: targetPort });
  const clientState = { buffer: Buffer.alloc(0) };
  const writeClient = delayedWriter(client);
  const writeUpstream = delayedWriter(upstream);

  // A statement costs one round trip: the request crosses the network and the
  // first response byte comes back. Extra packets of a large result stream at
  // bandwidth, not latency, so only the first response chunk is delayed.
  let awaitingFirstResponse = true;

  client.on("data", (chunk: Buffer) => {
    countCommands(clientState, chunk);
    awaitingFirstResponse = true;
    writeUpstream(chunk);
  });

  upstream.on("data", (chunk: Buffer) => {
    writeClient(chunk, awaitingFirstResponse ? oneWayDelay : 0);
    awaitingFirstResponse = false;
  });

  const close = () => {
    client.destroy();
    upstream.destroy();
  };

  client.on("error", close);
  upstream.on("error", close);
  client.on("close", close);
  upstream.on("close", close);
  client.on("end", () => upstream.end());
  upstream.on("end", () => client.end());
});

proxy.listen(listenPort, "127.0.0.1", () => {
  console.log(
    `MySQL latency proxy listening on 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort} (+${latencyMs}ms RTT)`,
  );
});

const control = createHttpServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "POST" && url.pathname === "/reset") {
    queries = 0;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ queries, connections }));

    return;
  }

  if (url.pathname === "/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ queries, connections, latencyMs }));

    return;
  }

  response.writeHead(404);
  response.end();
});

control.listen(controlPort, "127.0.0.1", () => {
  console.log(`Control API listening on http://127.0.0.1:${controlPort}`);
});

const stop = () => {
  proxy.close();
  control.close();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
