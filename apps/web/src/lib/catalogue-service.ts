import { Context, Effect, Layer, ManagedRuntime, Ref, Schema, Semaphore } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { webHttpClientLayer } from "~/lib/web-http";

export class CatalogueError extends Schema.TaggedError<CatalogueError>()("CatalogueError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

type CachedRequest = Effect.Effect<Schema.Json, CatalogueError>;

const makeService = (client: HttpClient.HttpClient): Effect.Effect<CatalogueService["Service"]> =>
  Effect.gen(function* () {
    const cache = yield* Ref.make(new Map<string, CachedRequest>());
    const lock = yield* Semaphore.make(1);
    const evict = (url: string) =>
      Ref.update(cache, (current) => {
        const next = new Map(current);
        next.delete(url);

        return next;
      });

    return CatalogueService.of({
      get: (url, schema) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const requests = yield* Ref.get(cache);
            let request = requests.get(url);

            if (!request) {
              request = client.get(url).pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Json)),
                Effect.mapError(
                  (cause) =>
                    new CatalogueError({
                      message: "Could not load catalogue asset " + url,
                      cause,
                    }),
                ),
              );
              const cached = yield* Effect.cached(request);
              yield* Ref.update(cache, (current) => new Map(current).set(url, cached));
              request = cached;
            }

            const body = yield* request.pipe(Effect.tapError(() => evict(url)));
            const decoded = yield* Schema.decodeUnknownEffect(schema)(body).pipe(
              Effect.catch((error) =>
                evict(url).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new CatalogueError({
                        message: "Catalogue asset is malformed: " + url,
                        cause: error,
                      }),
                    ),
                  ),
                ),
              ),
            );

            return decoded;
          }),
        ),
    });
  });

export class CatalogueService extends Context.Service<
  CatalogueService,
  {
    readonly get: <S extends Schema.Constraint>(
      url: string,
      schema: S,
    ) => Effect.Effect<S["Type"], CatalogueError, S["DecodingServices"]>;
  }
>()("mattraxe/web/CatalogueService") {
  static readonly layerHttp = Layer.effect(
    CatalogueService,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      return yield* makeService(client);
    }),
  );

  static readonly layer = CatalogueService.layerHttp.pipe(Layer.provide(webHttpClientLayer));
}

let runtime: ManagedRuntime.ManagedRuntime<CatalogueService, never> | undefined;

export const runCatalogue = <A, E>(effect: Effect.Effect<A, E, CatalogueService>): Promise<A> =>
  (runtime ??= ManagedRuntime.make(CatalogueService.layer)).runPromise(effect);

/** Test/HMR lifecycle hook; production owns the runtime for the page session. */
export const disposeCatalogueRuntime = async (): Promise<void> => {
  await runtime?.dispose();
  runtime = undefined;
};
