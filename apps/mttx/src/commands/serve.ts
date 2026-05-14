import { Context, Console, Effect, Layer, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpRouter } from "effect/unstable/http";
import { createServer } from "node:http";
import { createAppLayer } from "../app.ts";

const isProductionBuild = process.env.MATTRAX_SERVER_BUNDLED === "1";
const defaultDataDir = isProductionBuild ? "/opt/mattrax" : "./.data";
const maxRequestsPerSecond = 5;
const maxRuntimeMs = 24 * 60 * 60 * 1000;

export const serveCommand = Command.make("serve", {
  port: Flag.integer("port").pipe(Flag.withDefault(3000)),
  origin: Flag.string("origin").pipe(Flag.withDefault("http://localhost:3000")),
  webhookUrl: Flag.string("webhook-url").pipe(
    Flag.withDescription("URL of the management webhook backend"),
  ),
  dataDir: Flag.string("data-dir").pipe(
    Flag.withDefault(defaultDataDir),
    Flag.withDescription("Directory for filesystem data storage"),
  ),
  appleVendorCert: Flag.string("apple-vendor-cert").pipe(
    Flag.withDescription("Path to Apple vendor certificate PEM file"),
    Flag.optional,
  ),
}, (config) =>
  Effect.gen(function* () {
    yield* Console.log(`Starting Mattrax self-hosted server on port ${config.port}`);
    yield* Console.log(`Webhook backend: ${config.webhookUrl}`);
    yield* Console.log(`Data directory: ${config.dataDir}`);

    const appLayer = createAppLayer({
      origin: config.origin,
      webhookUrl: config.webhookUrl,
      dataDir: config.dataDir,
      appleVendorCert: Option.getOrUndefined(config.appleVendorCert),
    });

    const fullLayer = appLayer.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(NodeServices.layer),
    );

    const { handler, dispose } = HttpRouter.toWebHandler(fullLayer);

    let requestWindowStartedAt = Date.now();
    let requestsInWindow = 0;

    const server = createServer(async (req, res) => {
      const now = Date.now();
      if (now - requestWindowStartedAt >= 1000) {
        requestWindowStartedAt = now;
        requestsInWindow = 0;
      }

      requestsInWindow += 1;
      if (requestsInWindow > maxRequestsPerSecond) {
        res.statusCode = 429;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.setHeader("retry-after", "1");
        res.end("Too Many Requests\n");
        req.resume();
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      await new Promise<void>((resolve) => req.on("end", resolve));

      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: new Headers(
          Object.entries(req.headers).flatMap(([k, v]) =>
            Array.isArray(v) ? v.map((val) => [k, val] as [string, string]) : [[k, v] as [string, string]]
          ),
        ),
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      });

      const response = await (handler as (request: Request, context?: unknown) => Promise<Response>)(request, Context.empty());

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }

      res.end();
    });

    server.listen(config.port, () => {
      console.log(`Server listening on http://localhost:${config.port}`);
    });

    yield* Effect.promise<void>(() =>
      new Promise((resolve) => {
        let shuttingDown = false;

        const shutdown = (message: string) => {
          if (shuttingDown) return;
          shuttingDown = true;

          console.warn(message);
          server.close(async () => {
            clearTimeout(maxRuntimeTimer);
            await dispose();
            resolve();
          });
        };

        const maxRuntimeTimer = setTimeout(() => {
          shutdown("WARNING: Server reached the 24 hour runtime limit and is shutting down.");
        }, maxRuntimeMs);

        process.on("SIGINT", () => {
          shutdown("Shutting down...");
        });
      })
    );
  }),
);
