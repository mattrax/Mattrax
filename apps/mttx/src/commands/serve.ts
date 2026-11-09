import { Context, Console, Effect, Layer, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import { HttpRouter } from "effect/http";
import { createServer } from "node:http";
import { createAppLayer } from "../app.ts";

const isProductionBuild = process.env.MATTRAX_SERVER_BUNDLED === "1";
const defaultDataDir = isProductionBuild ? "/opt/mattrax" : "./.data";

export const serveCommand = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(
      Flag.withDefault(Number(process.env.PORT ?? 3000)),
      Flag.withDescription("HTTP port to listen on"),
    ),
    origin: Flag.String("origin").pipe(
      Flag.withDefault(process.env.MATTRAX_ORIGIN ?? "http://localhost:3000"),
      Flag.withDescription("Public origin used in enrollment profiles and URLs"),
    ),
    webhookUrl: Flag.String("webhook-url").pipe(
      Flag.withDescription("URL of the management webhook backend"),
    ),
    dataDir: Flag.String("data-dir").pipe(
      Flag.withDefault(defaultDataDir),
      Flag.withDescription("Directory for filesystem data storage"),
    ),
    appleVendorCert: Flag.String("apple-vendor-cert").pipe(
      Flag.withDescription("Path to Apple vendor certificate PEM file"),
      Flag.optional,
    ),
    rateLimit: Flag.Int("rate-limit").pipe(
      Flag.withDefault(Number(process.env.MATTRAX_RATE_LIMIT ?? 0)),
      Flag.withDescription(
        "Maximum requests per second per process (0 disables the limiter; deploy behind a real rate limiter)",
      ),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      yield* Console.log(`Starting Mattrax self-hosted server on port ${config.port}`);
      yield* Console.log(`Public origin: ${config.origin}`);
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
        try {
          if (config.rateLimit > 0) {
            const now = Date.now();
            if (now - requestWindowStartedAt >= 1000) {
              requestWindowStartedAt = now;
              requestsInWindow = 0;
            }

            requestsInWindow += 1;
            if (requestsInWindow > config.rateLimit) {
              res.statusCode = 429;
              res.setHeader("content-type", "text/plain; charset=utf-8");
              res.setHeader("retry-after", "1");
              res.end("Too Many Requests\n");
              req.resume();
              return;
            }
          }

          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(chunk));
          await new Promise<void>((resolve) => req.on("end", resolve));

          const host = req.headers.host ?? `localhost:${config.port}`;
          const request = new Request(`http://${host}${req.url}`, {
            method: req.method,
            headers: new Headers(
              Object.entries(req.headers).flatMap(([k, v]) =>
                Array.isArray(v)
                  ? v.map((val) => [k, val] as [string, string])
                  : v === undefined
                    ? []
                    : [[k, v] as [string, string]],
              ),
            ),
            body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
          });

          const response = await (
            handler as (request: Request, context?: unknown) => Promise<Response>
          )(request, Context.empty());

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
        } catch (error) {
          console.error("Unhandled request error", error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
          }
          res.end("Internal Server Error\n");
        }
      });

      server.listen(config.port, () => {
        console.log(`Server listening on http://localhost:${config.port}`);
      });

      yield* Effect.promise<void>(
        () =>
          new Promise((resolve) => {
            let shuttingDown = false;

            const shutdown = (message: string) => {
              if (shuttingDown) return;
              shuttingDown = true;

              console.warn(message);
              // Stop accepting connections, then dispose the Effect runtime.
              // A hard timeout prevents a stuck request from blocking a deploy.
              const timer = setTimeout(() => process.exit(1), 30_000);
              timer.unref();
              server.close(async () => {
                clearTimeout(timer);
                await dispose();
                resolve();
              });
            };

            process.on("SIGINT", () => shutdown("Shutting down..."));
            process.on("SIGTERM", () => shutdown("Shutting down..."));
          }),
      );
    }),
);
