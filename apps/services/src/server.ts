import { createServer } from "node:http";
import { Duration, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { NodeHttpServer } from "@effect/platform-node";

export const makeHttpServerLayer = <A, E, R>(
  app: Layer.Layer<A, E, R>,
  options: {
    readonly port: number;
    readonly host?: string;
    readonly gracefulShutdownTimeout?: Duration.Input;
  },
) =>
  HttpRouter.serve(app, { disableLogger: true }).pipe(
    Layer.provideMerge(
      NodeHttpServer.layer(() => createServer(), {
        host: options.host ?? "127.0.0.1",
        port: options.port,
        gracefulShutdownTimeout: options.gracefulShutdownTimeout ?? Duration.seconds(10),
      }),
    ),
  );
