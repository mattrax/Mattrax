import https from "node:https";
import { Context, Data, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export class ApnsError extends Data.TaggedError("ApnsError")<{
  message: string;
  cause?: unknown;
}> {}

export class ApnsService extends Context.Service<
  ApnsService,
  {
    readonly push: (params: {
      pushToken: string;
      pushMagic: string;
      topic: string;
    }) => Effect.Effect<void, ApnsError>;
  }
>()("ApnsService") {}

// Wraps node:https with a client certificate into a fetch-compatible function.
// Cloudflare Workers' node:https (via nodejs_compat) routes through CF's HTTP/2
// infrastructure, so HTTP/2 is used automatically despite the node:https API.
function makeMtlsFetch(certPem: string, keyPem: string): typeof globalThis.fetch {
  const agent = new https.Agent({ cert: certPem, key: keyPem });

  return async (input, init?) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const parsedUrl = new URL(url);

    let bodyBuf: Buffer | null = null;
    if (init?.body) {
      const b = init.body;
      if (b instanceof ArrayBuffer) {
        bodyBuf = Buffer.from(b);
      } else if (ArrayBuffer.isView(b)) {
        bodyBuf = Buffer.from(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
      } else if (typeof b === "string") {
        bodyBuf = Buffer.from(b);
      }
    }

    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (headers[k] = v));
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers as [string, string][]) headers[k] = v;
      } else {
        Object.assign(headers, init.headers);
      }
    }

    return new Promise<Response>((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: (init?.method ?? "GET").toUpperCase(),
          headers,
          agent,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const responseHeaders = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v !== undefined) {
                const vals = Array.isArray(v) ? v : [String(v)];
                vals.forEach((val) => responseHeaders.append(k, val));
              }
            }
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode ?? 200,
                headers: responseHeaders,
              }),
            );
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });
  };
}

export const ApnsServiceLive = (certPem: string, keyPem: string) => {
  const httpClientLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch, makeMtlsFetch(certPem, keyPem)),
  );

  return Layer.effect(
    ApnsService,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      return ApnsService.of({
        push: ({ pushToken, pushMagic, topic }) =>
          Effect.gen(function* () {
            const request = yield* HttpClientRequest.post(
              `https://api.push.apple.com/3/device/${pushToken}`,
              {
                headers: {
                  "apns-topic": topic,
                  "apns-push-type": "mdm",
                  "apns-priority": "10",
                },
              },
            ).pipe(
              HttpClientRequest.bodyJson({ mdm: pushMagic }),
              Effect.mapError(
                (cause) => new ApnsError({ message: "Failed to encode APNS payload", cause }),
              ),
            );

            const response = yield* client
              .execute(request)
              .pipe(
                Effect.mapError(
                  (cause) => new ApnsError({ message: "APNS request failed", cause }),
                ),
              );

            if (response.status !== 200) {
              const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
              yield* Effect.fail(
                new ApnsError({
                  message: `APNS rejected push (HTTP ${response.status}): ${text}`,
                }),
              );
            }
          }),
      });
    }),
  ).pipe(Layer.provide(httpClientLayer));
};
