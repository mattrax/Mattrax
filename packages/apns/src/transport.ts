import http2 from "node:http2";
import { Data, Effect } from "effect";
import { OUTBOUND_TIMEOUTS, OutboundTimeoutError, fetchWithTimeout } from "@mattrax/net";

export class ApnsError extends Data.TaggedError("ApnsError")<{
  message: string;
  cause?: unknown;
}> {}

export const APNS_PRODUCTION_ENDPOINT = "https://api.push.apple.com";

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

const responseError = async (response: Response) => {
  const text = await response.text().catch(() => "");

  return `APNs rejected push (HTTP ${response.status})${text ? `: ${text}` : ""}`;
};

/**
 * Direct HTTP/2 delivery using the tenant's APNs client certificate. Used by
 * self-hosted deployments (and by Cloudflare Workers through `nodejs_compat`).
 *
 * The whole connect + request lifecycle is bounded by `timeoutMs` (default
 * {@link OUTBOUND_TIMEOUTS.apns}); on expiry or error the HTTP/2 session is
 * destroyed so a hung Apple gateway cannot pin the request open.
 */
export function NodePushTransport(defaults?: {
  readonly certPem?: string;
  readonly privateKeyPem?: string;
  readonly timeoutMs?: number;
  /** Override the Apple endpoint (tests, or an APNs proxy). */
  readonly endpoint?: string;
}): ApnsPushTransport {
  const timeoutMs = defaults?.timeoutMs ?? OUTBOUND_TIMEOUTS.apns;
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
            let timer: ReturnType<typeof setTimeout> | undefined;

            const timeoutError = () =>
              new ApnsError({ message: `APNs request timed out after ${timeoutMs}ms` });

            const close = () => {
              // `close` only waits for existing streams; `destroy` guarantees
              // the socket (and any in-flight TLS handshake) is released.
              try {
                client.close();
              } catch {}

              try {
                client.destroy();
              } catch {}
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
              reject(
                new ApnsError({
                  message: `APNs rejected push (HTTP ${status})${text ? `: ${text}` : ""}`,
                }),
              );
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
  const timeoutMs = options.timeoutMs ?? OUTBOUND_TIMEOUTS.apns;

  const fetch: typeof globalThis.fetch = (input, init) =>
    options.fetch(new Request(input, init));

  return {
    name: "mtls",
    available: true,
    push: (input) =>
      Effect.tryPromise({
        try: async () => {
          const request = buildApnsRequest(input);

          const response = await fetchWithTimeout(
            new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: request.body,
            }),
            {},
            { timeoutMs, fetch },
          );

          if (response.status !== 200)
            throw new ApnsError({ message: await responseError(response) });
        },
        catch: (cause) =>
          cause instanceof ApnsError
            ? cause
            : cause instanceof OutboundTimeoutError
              ? new ApnsError({ message: cause.message })
              : new ApnsError({ message: "APNs mTLS request failed", cause }),
      }),
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
  readonly secret: string;
  /** Override for tests or alternative runtimes. */
  readonly fetch?: typeof globalThis.fetch;
  /** Override for deterministic signatures in tests. */
  readonly now?: () => number;
  /** Deadline for the relay request. Defaults to {@link OUTBOUND_TIMEOUTS.relay}. */
  readonly timeoutMs?: number;
};

/**
 * HMAC-signed HTTP delivery to a push relay. Hosted Cloud uses this because a
 * single Worker cannot attach a different client certificate per tenant.
 */
export function RelayPushTransport(options: RelayPushTransportOptions): ApnsPushTransport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = options.timeoutMs ?? OUTBOUND_TIMEOUTS.relay;

  return {
    name: "relay",
    available: true,
    push: (input) =>
      Effect.tryPromise({
        try: async () => {
          const body = JSON.stringify({
            pushToken: input.pushToken,
            pushMagic: input.pushMagic,
            topic: input.topic,
            certPem: input.certPem,
            privateKeyPem: input.privateKeyPem,
          });

          const timestamp = String(now());
          const signature = await relaySignature(options.secret, timestamp, body);

          // The relay talks to APNs on our behalf; a hung relay must not hold
          // the Worker's request open.
          const response = await fetchWithTimeout(
            options.url,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-apns-timestamp": timestamp,
                "x-apns-signature": signature,
              },
              body,
            },
            { timeoutMs, fetch: doFetch },
          );

          if (!response.ok) throw new ApnsError({ message: await responseError(response) });
        },
        catch: (cause) =>
          cause instanceof ApnsError
            ? cause
            : cause instanceof OutboundTimeoutError
              ? new ApnsError({ message: cause.message })
              : new ApnsError({ message: "APNs relay request failed", cause }),
      }),
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
