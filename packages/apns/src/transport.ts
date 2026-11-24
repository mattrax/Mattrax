import http2 from "node:http2";
import { Data, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export class ApnsError extends Data.TaggedError("ApnsError")<{
  message: string;
  cause?: unknown;
}> {}

export const APNS_PRODUCTION_ENDPOINT = "https://api.push.apple.com";

/** Apple's gateway is fast or the token is dead; never hold a push open. */
export const APNS_REQUEST_TIMEOUT_MS = 10_000;

/** The relay is our own service, so the same deadline applies. */
export const APNS_RELAY_TIMEOUT_MS = 10_000;

export type ApnsPushRequest = {
  /** Hex encoded device push token. */
  readonly pushToken: string;
  readonly pushMagic: string;
  readonly topic: string;
  /** PEM certificate. Required by transports that attach it directly. */
  readonly certPem?: string;
  /** PEM private key. Required by transports that attach it directly. */
  readonly privateKeyPem?: string;
};

export type ApnsPushTransport = {
  readonly name: string;
  /** Whether this deployment can actually deliver pushes. */
  readonly available: boolean;
  readonly push: (request: ApnsPushRequest) => Effect.Effect<void, ApnsError>;
};

export const apnsDeviceUrl = (pushToken: string) =>
  `${APNS_PRODUCTION_ENDPOINT}/3/device/${pushToken}`;

export const apnsHeaders = (topic: string) => ({
  "apns-topic": topic,
  "apns-push-type": "mdm",
  "apns-priority": "10",
  "content-type": "application/json",
});

export const apnsBody = (pushMagic: string) => JSON.stringify({ mdm: pushMagic });

/** The exact HTTP request Apple expects for an MDM wake-up push. */
export const buildApnsRequest = (
  request: Pick<ApnsPushRequest, "pushToken" | "pushMagic" | "topic">,
  endpoint = APNS_PRODUCTION_ENDPOINT,
) => ({
  url: `${endpoint}/3/device/${request.pushToken}`,
  method: "POST" as const,
  headers: apnsHeaders(request.topic),
  body: apnsBody(request.pushMagic),
});

/** An `HttpClient` over a specific fetch implementation (binding or stub). */
const httpClientLayer = (fetchImpl: typeof globalThis.fetch) =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)));

const rejected = (status: number, text: string) =>
  `APNs rejected push (HTTP ${status})${text ? `: ${text}` : ""}`;

/**
 * Direct HTTP/2 delivery using the tenant's APNs client certificate. Used by
 * self-hosted deployments (and by Cloudflare Workers through `nodejs_compat`).
 *
 * The whole connect + request lifecycle is bounded by `timeoutMs` (default
 * {@link APNS_REQUEST_TIMEOUT_MS}); on expiry or error the HTTP/2 session is
 * destroyed so a hung Apple gateway cannot pin the request open.
 */
export function NodePushTransport(defaults?: {
  readonly certPem?: string;
  readonly privateKeyPem?: string;
  readonly timeoutMs?: number;
  /** Override the Apple endpoint (tests, or an APNs proxy). */
  readonly endpoint?: string;
}): ApnsPushTransport {
  const timeoutMs = defaults?.timeoutMs ?? APNS_REQUEST_TIMEOUT_MS;
  const endpoint = defaults?.endpoint ?? APNS_PRODUCTION_ENDPOINT;

  return {
    name: "node",
    available: true,
    push: (input) => {
      const certPem = input.certPem ?? defaults?.certPem;
      const privateKeyPem = input.privateKeyPem ?? defaults?.privateKeyPem;

      if (!certPem || !privateKeyPem)
        return Effect.fail(
          new ApnsError({
            message: "APNs push requires a certificate and private key for this transport",
          }),
        );

      return Effect.tryPromise({
        try: () => {
          const request = buildApnsRequest(input, endpoint);
          const url = new URL(request.url);
          const body = Buffer.from(request.body);

          const client = http2.connect(url.origin, {
            cert: certPem,
            key: privateKeyPem,
          });

          return new Promise<void>((resolve, reject) => {
            let status = 0;
            let settled = false;
            // Assigned once, after the callbacks that read it are defined, so
            // it cannot be a \`const\` declaration.
            // oxlint-disable-next-line prefer-const -- assigned after the closures that capture it.
            let timer: ReturnType<typeof setTimeout> | undefined;

            const timeoutError = () =>
              new ApnsError({ message: `APNs request timed out after ${timeoutMs}ms` });

            const close = () => {
              // `close` only waits for existing streams; `destroy` guarantees
              // the socket (and any in-flight TLS handshake) is released.
              try {
                client.close();
              } catch {
                // The socket may already be closed; destroy still releases it.
              }

              try {
                client.destroy();
              } catch {
                // Already destroyed by a concurrent failure path.
              }
            };

            const fail = (cause: unknown) => {
              if (settled) return;
              settled = true;

              if (timer !== undefined) clearTimeout(timer);
              close();
              reject(cause);
            };

            timer = setTimeout(() => fail(timeoutError()), timeoutMs);
            timer.unref?.();

            // Covers a stalled TCP/TLS connect as well as an idle socket.
            client.setTimeout(timeoutMs, () => fail(timeoutError()));
            client.on("error", fail);

            const req = client.request({
              ":method": request.method,
              ":path": url.pathname + url.search,
              ...request.headers,
            });

            const chunks: Buffer[] = [];
            req.on("response", (headers) => {
              status = Number(headers[":status"] ?? 0);
            });
            req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            req.on("error", fail);
            req.on("end", () => {
              if (settled) return;
              settled = true;

              if (timer !== undefined) clearTimeout(timer);
              close();

              if (status === 200) return resolve();
              const text = Buffer.concat(chunks).toString("utf8");
              reject(new ApnsError({ message: rejected(status, text) }));
            });
            req.end(body);
          });
        },
        catch: (cause) =>
          cause instanceof ApnsError
            ? cause
            : new ApnsError({ message: "APNs request failed", cause }),
      });
    },
  };
}

/**
 * Deliver through a preconfigured Workers mTLS Fetcher binding. Whitelabel
 * deployments deploy one binding per APNs certificate.
 */
export function MtlsPushTransport(options: {
  fetch: (request: Request) => Promise<Response>;
  readonly timeoutMs?: number;
}): ApnsPushTransport {
  const timeoutMs = options.timeoutMs ?? APNS_REQUEST_TIMEOUT_MS;
  const fetchImpl: typeof globalThis.fetch = (input, init) =>
    options.fetch(new Request(input, init));

  return {
    name: "mtls",
    available: true,
    push: (input) => {
      const request = buildApnsRequest(input);

      return Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;

        // The deadline covers the response body as well as the headers, so a
        // stalled APNs reply fails like a hung connect.
        const exchange = Effect.gen(function* () {
          const response = yield* client.execute(
            HttpClientRequest.post(request.url).pipe(
              HttpClientRequest.setHeaders(request.headers),
              HttpClientRequest.bodyText(request.body, "application/json"),
            ),
          );

          return {
            status: response.status,
            text: yield* response.text.pipe(Effect.orElseSucceed(() => "")),
          };
        }).pipe(
          Effect.mapError((cause) => new ApnsError({ message: "APNs mTLS request failed", cause })),
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () =>
              Effect.fail(
                new ApnsError({ message: `APNs request timed out after ${timeoutMs}ms` }),
              ),
          }),
        );

        const { status, text } = yield* exchange;

        if (status !== 200)
          return yield* Effect.fail(new ApnsError({ message: rejected(status, text) }));
      }).pipe(Effect.provide(httpClientLayer(fetchImpl)));
    },
  };
}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * HMAC signature for relay requests: `hex(HMAC-SHA256(secret, timestamp.body))`.
 * Exported so the relay and its tests can verify requests independently.
 */
export async function relaySignature(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );

  return bytesToHex(new Uint8Array(signature));
}

export type RelayPushTransportOptions = {
  readonly url: string;
  /** Shared HMAC secret. Use \`token\` for a per-deployment licence instead. */
  readonly secret?: string;
  /** Bearer token (a deployment licence key) for relays that validate it. */
  readonly token?: string;
  /** Override for tests or alternative runtimes. */
  readonly fetch?: typeof globalThis.fetch;
  /** Override for deterministic signatures in tests. */
  readonly now?: () => number;
  /** Deadline for the relay request. Defaults to {@link APNS_RELAY_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
};

/**
 * HMAC-signed HTTP delivery to a push relay. Hosted Cloud uses this because a
 * single Worker cannot attach a different client certificate per tenant.
 */
export function RelayPushTransport(options: RelayPushTransportOptions): ApnsPushTransport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = options.timeoutMs ?? APNS_RELAY_TIMEOUT_MS;

  return {
    name: "relay",
    available: Boolean(options.secret || options.token),
    push: (input) =>
      Effect.gen(function* () {
        const body = JSON.stringify({
          pushToken: input.pushToken,
          pushMagic: input.pushMagic,
          topic: input.topic,
          certPem: input.certPem,
          privateKeyPem: input.privateKeyPem,
        });

        const headers: Record<string, string> = {};

        if (options.secret) {
          const timestamp = String(now());
          headers["x-apns-timestamp"] = timestamp;
          headers["x-apns-signature"] = yield* Effect.tryPromise({
            try: () => relaySignature(options.secret!, timestamp, body),
            catch: (cause) => new ApnsError({ message: "APNs relay signing failed", cause }),
          });
        }

        if (options.token) headers.authorization = `Bearer ${options.token}`;

        const client = yield* HttpClient.HttpClient;

        // The relay talks to APNs on our behalf; a hung relay must not hold
        // the Worker's request open, and the deadline covers the body read too.
        const exchange = Effect.gen(function* () {
          const response = yield* client.execute(
            HttpClientRequest.post(options.url).pipe(
              HttpClientRequest.setHeaders(headers),
              HttpClientRequest.bodyText(body, "application/json"),
            ),
          );

          return {
            status: response.status,
            text: yield* response.text.pipe(Effect.orElseSucceed(() => "")),
          };
        }).pipe(
          Effect.mapError(
            (cause) => new ApnsError({ message: "APNs relay request failed", cause }),
          ),
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () =>
              Effect.fail(
                new ApnsError({ message: `APNs relay request timed out after ${timeoutMs}ms` }),
              ),
          }),
        );

        const { status, text } = yield* exchange;

        if (status < 200 || status > 299)
          return yield* Effect.fail(new ApnsError({ message: rejected(status, text) }));
      }).pipe(Effect.provide(httpClientLayer(doFetch))),
  };
}

/** Fallback used when no transport is configured (Cloud without a relay). */
export function NoopPushTransport(
  reason = "No APNs push transport is configured",
): ApnsPushTransport {
  return {
    name: "noop",
    available: false,
    push: () => Effect.fail(new ApnsError({ message: reason })),
  };
}
