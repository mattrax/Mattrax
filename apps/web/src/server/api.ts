import { Effect, Layer, ManagedRuntime } from "effect";
import { ApiClient } from "./api-client";
import type { ApiError } from "./api-client";
import { bindingsLayer } from "./bindings";

let runtime: ManagedRuntime.ManagedRuntime<ApiClient, never> | undefined;

const apiRuntime = () =>
  (runtime ??= ManagedRuntime.make(ApiClient.layer.pipe(Layer.provide(bindingsLayer))));

/** The Effect boundary shared by SSR, proxy, enrollment, auth and MCP callers. */
export const apiEffect = (request: Request): Effect.Effect<Response, ApiError, ApiClient> =>
  Effect.flatMap(ApiClient, (client) => client.web(request));

export const runApiEffect = <A, E>(effect: Effect.Effect<A, E, ApiClient>): Promise<A> =>
  apiRuntime().runPromise(effect);

/**
 * The only Promise adapter for plain Solid routes and server functions.
 * Transport failures become a gateway response; callers that need the typed
 * failure use apiEffect with an injected ApiClient Layer instead.
 */
export const fetchApi = async (request: Request): Promise<Response> => {
  try {
    return await apiRuntime().runPromise(apiEffect(request));
  } catch (error) {
    console.error("[web] API request failed", error);

    return new Response("Bad Gateway", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
};
