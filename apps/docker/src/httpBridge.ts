import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Option, Scope } from "effect";
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http";

export type RuntimeContext = {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
  signal?: AbortSignal;
};

export type ScheduledController = {
  cron: string;
  scheduledTime: number;
  noRetry: () => void;
};

export type ApiRuntime = {
  fetch(request: Request, context: RuntimeContext): Promise<Response>;
  scheduled(controller: ScheduledController, context: RuntimeContext): Promise<void>;
  backgroundTasks?: {
    idle: () => Promise<void>;
    drain: (deadlineMs: number) => Promise<"drained" | "interrupted">;
  };
};

/**
 * Route API traffic through Effect's Node adapter. It owns response streaming
 * and client cancellation, so this bridge never appends an error after headers.
 */
export const makeApiHttpHandler = (api: ApiRuntime, context: RuntimeContext, scope: Scope.Scope) =>
  NodeHttpServer.makeHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const peerAddress = Option.getOrUndefined(request.peerAddress);

      // The shared API uses this value to decide whether proxy-supplied device
      // identity is trustworthy. Delete any caller value first, then write the
      // address of the socket that actually connected to this Node process.
      const withoutCallerPeer = Headers.remove(request.headers, "x-mattrax-peer-address");
      const headers = peerAddress
        ? Headers.set(withoutCallerPeer, "x-mattrax-peer-address", peerAddress)
        : withoutCallerPeer;

      const webRequest = yield* HttpServerRequest.toWeb(request.modify({ headers }));
      const response = yield* Effect.tryPromise({
        try: (signal) => api.fetch(webRequest, { ...context, signal }),
        catch: (error) => error,
      }).pipe(
        Effect.map(HttpServerResponse.fromWeb),
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error("mattrax self-host: API request failed", error);

            return HttpServerResponse.text("Internal Server Error", { status: 500 });
          }),
        ),
      );

      return response;
    }).pipe(Effect.interruptible),
    { scope },
  );
