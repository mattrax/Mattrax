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
  /** Optional support or calendar URL used by the app menu and checklist. */
  readonly SUPPORT_URL: string | undefined;
  /** Preview/self-host API origin. Takes precedence over the service binding. */
  readonly API_URL: string | undefined;
  /** Cloudflare service binding; Node reaches the API over API_URL instead. */
  readonly API: { fetch(request: Request): Promise<Response> } | undefined;
}

export class Bindings extends Context.Service<Bindings, DeploymentBindings>()(
  "mattraxe/web/Bindings",
) {}

const text = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
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
    SUPPORT_URL: env.SUPPORT_URL,
    API_URL: apiUrl,
    API: env.API,
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
    SUPPORT_URL: process.env.SUPPORT_URL,
    API_URL: apiUrl,
    API: undefined,
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

const resolveBindings = (): DeploymentBindings =>
  workerEnv === undefined ? nodeBindings() : workerBindings(workerEnv);

/** One binding snapshot per isolate/runtime, shared by Effect layers. */
export const bindingsLayer = Layer.sync(Bindings, () => Bindings.of(resolveBindings()));

let runtime: ManagedRuntime.ManagedRuntime<Bindings, never> | undefined;

/**
 * Run the `Bindings` service for plain (non-Effect) request code.
 *
 * The dashboard's entry points are Solid middleware, route handlers and server
 * functions, so the runtime is a process-level singleton rather than something
 * threaded through every call: the bindings themselves do not vary per request.
 */
export const getBindings = (): DeploymentBindings =>
  (runtime ??= ManagedRuntime.make(bindingsLayer)).runSync(Bindings);
