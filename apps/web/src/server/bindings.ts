import { Context, Layer, ManagedRuntime } from "effect";

/**
 * Deployment bindings for the dashboard, as a `Context` service.
 *
 * The dashboard runs in two places: as a Worker on Cloudflare, where bindings
 * arrive with the request, and as a plain Node server (`MATTRAX_TARGET=node`,
 * used by `apps/docker`), where they come from `process.env` and the API is
 * another process on loopback. Application code only ever asks this service for
 * what it needs, so `cloudflare:workers` is not imported anywhere.
 */
export interface DeploymentBindings {
  /** Shared with the API so SSR bootstrap tokens verify on the edge. */
  readonly AUTH_SECRET: string | undefined;
  readonly POSTHOG_KEY: string | undefined;
  readonly POSTHOG_HOST: string | undefined;
  /** The API: a service binding on Cloudflare, loopback HTTP on Node. */
  readonly API: { fetch(request: Request): Promise<Response> };
}

export class Bindings extends Context.Service<Bindings, DeploymentBindings>()("mattraxe/web/Bindings") {}

const text = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
};

/** Forward to the API at `apiUrl`, preserving path, query, method and body. */
const forward = (apiUrl: string, request: Request): Promise<Response> => {
  const source = new URL(request.url);

  return fetch(new Request(new URL(source.pathname + source.search, apiUrl), request));
};

/**
 * Worker bindings.
 *
 * Production reaches the API over the `API` service binding. A Preview cannot
 * use a service binding to another Worker's Preview — Cloudflare resolves it to
 * that Worker's production deployment — so the preview deploy passes the
 * preview API's URL as `API_URL` and requests go there over HTTP instead.
 */
const workerBindings = (env: Env): DeploymentBindings => {
  const apiUrl = text(env.API_URL);

  return {
    AUTH_SECRET: env.AUTH_SECRET,
    POSTHOG_KEY: env.POSTHOG_KEY,
    POSTHOG_HOST: env.POSTHOG_HOST,
    API: {
      fetch: (request) => (apiUrl ? forward(apiUrl, request) : env.API.fetch(request)),
    },
  };
};

/**
 * Node bindings: the process environment and a loopback client for the API's
 * Node server, which listens on `PORT` like `apps/docker` does.
 */
const nodeBindings = (): DeploymentBindings => {
  const apiUrl =
    text(process.env.API_URL) ?? `http://127.0.0.1:${text(process.env.PORT) ?? "8080"}`;

  return {
    AUTH_SECRET: process.env.AUTH_SECRET,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    API: {
      async fetch(request) {
        try {
          return await forward(apiUrl, request);
        } catch (cause) {
          // A down API must not take the dashboard down with it. Bootstrap
          // already treats a failed call as a signed-out render; proxied
          // endpoints answer with a gateway error instead.
          console.error("[selfhost] API request failed", cause);

          return new Response("Bad Gateway", {
            status: 502,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
      },
    },
  };
};

/**
 * The Worker's bindings, as passed to the fetch handler.
 *
 * Bindings are fixed for the lifetime of an isolate, so the first request wins;
 * Node never calls this and resolves `process.env` instead.
 */
let workerEnv: Env | undefined;

export const useWorkerBindings = (env: Env): void => {
  workerEnv ??= env;
};

let runtime: ManagedRuntime.ManagedRuntime<Bindings, never> | undefined;

/**
 * Run the `Bindings` service for plain (non-Effect) request code.
 *
 * The dashboard's entry points are Solid middleware, route handlers and server
 * functions, so the runtime is a process-level singleton rather than something
 * threaded through every call: the bindings themselves do not vary per request.
 */
export const getBindings = (): DeploymentBindings =>
  (runtime ??= ManagedRuntime.make(
    Layer.succeed(
      Bindings,
      Bindings.of(workerEnv === undefined ? nodeBindings() : workerBindings(workerEnv)),
    ),
  )).runSync(Bindings);
