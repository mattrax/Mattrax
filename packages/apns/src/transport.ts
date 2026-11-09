import https from "node:https";
import { Data, Effect } from "effect";

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

export const apnsHeaders = (topic: string): Record<string, string> => ({
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
 */
export function NodePushTransport(defaults?: {
  readonly certPem?: string;
  readonly privateKeyPem?: string;
}): ApnsPushTransport {
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
          const request = buildApnsRequest(input);
          const url = new URL(request.url);
          const body = Buffer.from(request.body);
          const agent = new https.Agent({ cert: certPem, key: privateKeyPem });

          return new Promise<void>((resolve, reject) => {
            const req = https.request(
              {
                hostname: url.hostname,
                port: url.port ? parseInt(url.port, 10) : 443,
                path: url.pathname + url.search,
                method: request.method,
                headers: { ...request.headers, "content-length": body.byteLength },
                agent,
              },
              (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                res.on("end", () => {
                  if (res.statusCode === 200) return resolve();
                  const text = Buffer.concat(chunks).toString("utf8");
                  reject(
                    new ApnsError({
                      message: `APNs rejected push (HTTP ${res.statusCode ?? 0})${text ? `: ${text}` : ""}`,
                    }),
                  );
                });
                res.on("error", reject);
              },
            );
            req.on("error", reject);
            req.write(body);
            req.end();
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
export function MtlsPushTransport(fetcher: {
  fetch: (request: Request) => Promise<Response>;
}): ApnsPushTransport {
  return {
    name: "mtls",
    available: true,
    push: (input) =>
      Effect.tryPromise({
        try: async () => {
          const request = buildApnsRequest(input);
          const response = await fetcher.fetch(
            new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: request.body,
            }),
          );
          if (response.status !== 200)
            throw new ApnsError({ message: await responseError(response) });
        },
        catch: (cause) =>
          cause instanceof ApnsError
            ? cause
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
};

/**
 * HMAC-signed HTTP delivery to a push relay. Hosted Cloud uses this because a
 * single Worker cannot attach a different client certificate per tenant.
 */
export function RelayPushTransport(options: RelayPushTransportOptions): ApnsPushTransport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

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
          const response = await doFetch(options.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-apns-timestamp": timestamp,
              "x-apns-signature": signature,
            },
            body,
          });
          if (!response.ok) throw new ApnsError({ message: await responseError(response) });
        },
        catch: (cause) =>
          cause instanceof ApnsError
            ? cause
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
