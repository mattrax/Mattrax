import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { Bindings } from "./bindings";
import type { DeploymentBindings } from "./bindings";

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  message: Schema.String,
  reason: Schema.Literals(["transport", "status", "decode", "body"]),
  cause: Schema.Defect(),
  status: Schema.optional(Schema.Number),
}) {}

export const API_TIMEOUT_MILLIS = 15_000;

const asApiError = (cause: unknown): ApiError => {
  if (cause instanceof ApiError) return cause;
  const status = HttpClientError.isHttpClientError(cause)
    ? (cause.response?.status ?? undefined)
    : undefined;

  const decode =
    Schema.isSchemaError(cause) ||
    (HttpClientError.isHttpClientError(cause) && cause.reason._tag === "DecodeError");

  return new ApiError({
    message: Predicate.isError(cause) ? cause.message : "The Mattrax API request failed",
    reason: decode ? "decode" : status === undefined ? "transport" : "status",
    cause,
    status,
  });
};

/**
 * The Worker proxy must return redirects to the browser instead of following
 * them. An API POST such as OAuth consent answers with a 302 to the client's
 * callback; following it here would replay a streamed request body against the
 * external origin, which fails and turns the redirect into a gateway error.
 */
const webFetchClient = (
  fetch: (request: Request) => Promise<Response>,
): HttpClient.HttpClient =>
  HttpClient.make((request, _url, signal) =>
    Effect.flatMap(HttpClientRequest.toWeb(request, { signal }), (webRequest) =>
      Effect.tryPromise({
        try: () => fetch(new Request(webRequest, { redirect: "manual" })),
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response))),
    ).pipe(
      Effect.catch((error) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.EncodeError({ request, cause: error }),
          }),
        ),
      ),
    ),
  );

/** Rewrite only the origin; path, query, headers, method and body are preserved. */
const forwardingLayer = (apiUrl: string): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.mapRequest((request) => {
        const source = new URL(request.url);

        return HttpClientRequest.setUrl(
          request,
          new URL(source.pathname + source.search, apiUrl).toString(),
        );
      })(client),
    ),
  ).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, webFetchClient(fetch))));

const deploymentLayer = (bindings: DeploymentBindings): Layer.Layer<ApiClient> => {
  if (bindings.API_URL)
    return Layer.effect(ApiClient, Effect.map(HttpClient.HttpClient, makeService)).pipe(
      Layer.provide(forwardingLayer(bindings.API_URL)),
    );

  if (bindings.API) {
    const api = bindings.API;

    return Layer.succeed(
      ApiClient,
      makeService(webFetchClient((request) => api.fetch(request))),
    );
  }

  // Node always supplies API_URL. Keep a typed failure for an invalid binding
  // shape rather than falling back to an ambient global fetch.
  return Layer.succeed(
    ApiClient,
    makeService(
      HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("No API transport is configured"),
            }),
          }),
        ),
      ),
    ),
  );
};

const limitBody = (
  response: HttpClientResponse.HttpClientResponse,
  maxBytes: number,
): Effect.Effect<HttpClientResponse.HttpClientResponse, ApiError> =>
  Option.match(HttpClientResponse.toWeb(response), {
    onNone: () =>
      Effect.fail(
        new ApiError({
          message: "The API transport returned a response that cannot be streamed",
          reason: "transport",
          cause: new Error("Missing Web response body"),
          status: response.status,
        }),
      ),
    onSome: (source) => {
      const reader = source.body?.getReader();
      let total = 0;
      const limited = reader
        ? new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const next = await reader.read();

                if (next.done) {
                  reader.releaseLock();
                  controller.close();

                  return;
                }

                total += next.value.byteLength;

                if (total > maxBytes) {
                  await reader.cancel();
                  controller.error(new Error("API response exceeds the configured byte limit"));

                  return;
                }

                controller.enqueue(next.value);
              } catch (error) {
                controller.error(error);
              }
            },
            cancel: (reason) => reader.cancel(reason),
          })
        : null;

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          response.request,
          new Response(limited, {
            status: source.status,
            statusText: source.statusText,
            headers: source.headers,
          }),
        ),
      );
    },
  });

const consumeError = (response: HttpClientResponse.HttpClientResponse) =>
  limitBody(response, 64 * 1024).pipe(
    Effect.flatMap((limited) => limited.text),
    Effect.timeout(API_TIMEOUT_MILLIS),
    Effect.asVoid,
  );

const makeService = (client: HttpClient.HttpClient): ApiClient["Service"] => {
  const timed = client.pipe(HttpClient.timeout(API_TIMEOUT_MILLIS));

  return ApiClient.of({
    client: timed,
    execute: (request) =>
      timed.execute(request).pipe(Effect.catch((error) => Effect.fail(asApiError(error)))),
    json: (request, schema) =>
      Effect.gen(function* () {
        const response = yield* timed
          .execute(request)
          .pipe(Effect.catch((error) => Effect.fail(asApiError(error))));

        if (response.status < 200 || response.status >= 300) {
          yield* consumeError(response).pipe(
            Effect.catch((error) => Effect.fail(asApiError(error))),
          );

          return yield* new ApiError({
            message: "The Mattrax API returned status " + response.status,
            reason: "status",
            cause: new Error("HTTP " + response.status),
            status: response.status,
          });
        }

        const limited = yield* limitBody(response, 4 * 1024 * 1024);

        return yield* HttpClientResponse.schemaBodyJson(schema)(limited).pipe(
          Effect.timeout(API_TIMEOUT_MILLIS),
          Effect.catch((error) => Effect.fail(asApiError(error))),
        );
      }),
    web: (request) =>
      timed.execute(HttpClientRequest.fromWeb(request)).pipe(
        Effect.catch((error) => Effect.fail(asApiError(error))),
        Effect.flatMap((response) =>
          Option.match(HttpClientResponse.toWeb(response), {
            onNone: () =>
              Effect.fail(
                new ApiError({
                  message: "The API transport returned a non-Web response",
                  reason: "transport",
                  cause: new Error("Missing Web response"),
                  status: response.status,
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
    bounded: (response, maxBytes) => limitBody(response, maxBytes),
    discard: (response) =>
      consumeError(response).pipe(Effect.catch((error) => Effect.fail(asApiError(error)))),
  });
};

export class ApiClient extends Context.Service<
  ApiClient,
  {
    /** Policy-wrapped client for generated HttpApi clients. */
    readonly client: HttpClient.HttpClient;
    /** Execute without interpreting status; proxies must preserve API responses. */
    readonly execute: (
      request: HttpClientRequest.HttpClientRequest,
    ) => Effect.Effect<HttpClientResponse.HttpClientResponse, ApiError>;
    /** Decode a successful JSON response, consuming failed response bodies. */
    readonly json: <S extends Schema.Constraint>(
      request: HttpClientRequest.HttpClientRequest,
      schema: S,
    ) => Effect.Effect<S["Type"], ApiError, S["DecodingServices"]>;
    /** Adapt a request/response pair for the plain Solid/server-function boundary. */
    readonly web: (request: Request) => Effect.Effect<Response, ApiError>;
    /** A response whose body is bounded before any decoder or buffer runs. */
    readonly bounded: (
      response: HttpClientResponse.HttpClientResponse,
      maxBytes: number,
    ) => Effect.Effect<HttpClientResponse.HttpClientResponse, ApiError>;
    /** Consume a response that the caller does not otherwise need. */
    readonly discard: (
      response: HttpClientResponse.HttpClientResponse,
    ) => Effect.Effect<void, ApiError>;
  }
>()("mattraxe/web/ApiClient") {
  static readonly fromClient = (client: HttpClient.HttpClient): Layer.Layer<ApiClient> =>
    Layer.succeed(ApiClient, makeService(client));

  static readonly layerHttp = Layer.effect(
    ApiClient,
    Effect.map(HttpClient.HttpClient, makeService),
  );

  static readonly layer = Layer.unwrap(Effect.map(Bindings, deploymentLayer));
}
