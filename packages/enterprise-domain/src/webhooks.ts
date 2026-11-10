import { Schema } from "effect";

/**
 * Outbound webhook definitions shared by the API, dashboard and delivery
 * worker.
 *
 * An endpoint subscribes to a list of event names. Event filters are a JSON
 * array; an empty array means "all events" so an endpoint created before a new
 * event existed keeps receiving it.
 */

export const WEBHOOK_EVENT_TYPES = [
  "device.enrolled",
  "device.unenrolled",
  "device.command_failed",
  "device.declaration_invalid",
  "device.push_invalid_token",
  "device.compliance_changed",
  "policy.deployment_failed",
  "enrollment.attempt_failed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Test-only event sent by `POST .../webhooks/:id/test`. Never filterable. */
export const WEBHOOK_TEST_EVENT = "webhook.test" as const;

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  "device.enrolled": "Device enrolled",
  "device.unenrolled": "Device unenrolled",
  "device.command_failed": "Device command failed",
  "device.declaration_invalid": "Declaration invalid",
  "device.push_invalid_token": "Push token invalid",
  "device.compliance_changed": "Compliance changed",
  "policy.deployment_failed": "Policy deployment failed",
  "enrollment.attempt_failed": "Enrollment attempt failed",
};

/**
 * Header names used by every delivery. The signature header is
 * `t=<unix-seconds>,v1=<hex HMAC-SHA256(secret, "<t>." + rawBody)>`
 * (Stripe-compatible shape). See docs/enterprise/webhooks.md.
 */
export const WEBHOOK_SIGNATURE_HEADER = "X-Mattrax-Signature";
export const WEBHOOK_TIMESTAMP_HEADER = "X-Mattrax-Timestamp";
export const WEBHOOK_EVENT_HEADER = "X-Mattrax-Event";
export const WEBHOOK_DELIVERY_HEADER = "X-Mattrax-Delivery";
export const WEBHOOK_SECRET_PREFIX = "whsec_";
/** Reject deliveries whose timestamp is more than five minutes old. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export const webhookSignatureMessage = (timestamp: number | string, body: string) =>
  `${timestamp}.${body}`;

export type ParsedWebhookSignature = {
  readonly timestamp: number | null;
  readonly signatures: ReadonlyArray<string>;
};

/** Parse a `t=...,v1=...` signature header. Unknown scheme parts are ignored. */
export const parseWebhookSignatureHeader = (value: string): ParsedWebhookSignature => {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of value.split(",")) {
    const [scheme, ...rest] = part.trim().split("=");
    const payload = rest.join("=");
    if (!scheme || !payload) continue;
    if (scheme === "t") {
      const parsed = Number(payload);
      if (Number.isSafeInteger(parsed) && parsed > 0) timestamp = parsed;
    } else if (scheme === "v1") signatures.push(payload.trim());
  }
  return { timestamp, signatures };
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".lan",
  ".test",
  ".invalid",
];
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

const ipv4Parts = (value: string) => value.split(".").map((part) => Number(part));

/** RFC 1918 plus loopback, link-local, CGNAT, documentation and multicast. */
const isBlockedIpv4 = (value: string): boolean => {
  if (!IPV4.test(value)) return false;
  const [a = 0, b = 0] = ipv4Parts(value);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
};

const isBlockedIpv6 = (value: string): boolean => {
  const address = value.toLowerCase();
  if (!address.includes(":")) return false;
  if (address === "::" || address === "::1") return true;
  // IPv4-mapped addresses in either dotted (`::ffff:127.0.0.1`) or hex
  // (`::ffff:7f00:1`) form are always blocked: they can reach loopback or a
  // private network.
  if (address.includes("::ffff:")) return true;
  // IPv4-compatible forms.
  const mapped = address.match(/::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1] && isBlockedIpv4(mapped[1])) return true;
  if (address.startsWith("fe80:")) return true;
  if (address.startsWith("fc") || address.startsWith("fd")) return true;
  if (address.startsWith("ff")) return true;
  if (address.startsWith("2001:db8:")) return true;
  return false;
};

/**
 * Basic syntax-level SSRF guard for a customer-supplied delivery URL.
 *
 * It rejects non-HTTPS URLs, credentials in the URL, hostnames that are
 * obviously internal, and IP literals in loopback/private/reserved ranges.
 * It cannot see DNS answers (Workers `fetch` has no resolver hook), so a
 * hostname that resolves to a private address at delivery time is only stopped
 * by the platform's egress policy. This is documented as a limitation.
 */
export const webhookUrlProblem = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return "Enter a webhook URL";
  if (trimmed.length > 2048) return "Webhook URL must be 2048 characters or fewer";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Enter a valid URL";
  }
  if (url.protocol !== "https:") return "Webhook URLs must use https";
  if (url.username || url.password) return "Webhook URLs must not include credentials";
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return "Enter a valid URL";
  if (BLOCKED_HOSTS.has(hostname)) return "Webhook URLs must not target localhost";
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)))
    return "Webhook URLs must not target an internal hostname";
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (bare.includes(":")) {
    if (bare.includes("%")) return "Webhook URLs must not include an IPv6 zone id";
    if (isBlockedIpv6(bare)) return "Webhook URLs must not target a private address";
    return null;
  }
  if (IPV4.test(bare)) {
    if (isBlockedIpv4(bare)) return "Webhook URLs must not target a private address";
    return null;
  }
  // A single-label hostname can only resolve on an internal search domain.
  if (!bare.includes(".")) return "Webhook URLs must use a fully-qualified hostname";
  return null;
};

export const isWebhookUrlAllowed = (url: string): boolean => webhookUrlProblem(url) === null;

export const WebhookEventTypeSchema = Schema.Literals([...WEBHOOK_EVENT_TYPES]);

export const WebhookDeliveryStatus = Schema.Literals(["succeeded", "failed"]);
export type WebhookDeliveryStatus = typeof WebhookDeliveryStatus.Type;

const NullableString = Schema.NullOr(Schema.String);

export const WebhookEndpointInfo = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  description: Schema.optional(NullableString),
  /** Subscribed events. Empty means every event. */
  events: Schema.Array(WebhookEventTypeSchema),
  enabled: Schema.Boolean,
  /** Last four characters of the signing secret, for display only. */
  secretPrefix: Schema.optional(NullableString),
  lastDeliveryAt: Schema.optional(NullableString),
  lastDeliveryStatus: Schema.optional(Schema.NullOr(WebhookDeliveryStatus)),
  consecutiveFailures: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type WebhookEndpointInfo = typeof WebhookEndpointInfo.Type;

export const WebhookEndpointsResponse = Schema.Struct({
  endpoints: Schema.Array(WebhookEndpointInfo),
});
export type WebhookEndpointsResponse = typeof WebhookEndpointsResponse.Type;

export const CreateWebhookEndpointRequest = Schema.Struct({
  url: Schema.String,
  description: Schema.optional(NullableString),
  events: Schema.Array(WebhookEventTypeSchema),
  enabled: Schema.optional(Schema.Boolean),
});
export type CreateWebhookEndpointRequest = typeof CreateWebhookEndpointRequest.Type;

export const PatchWebhookEndpointRequest = Schema.Struct({
  url: Schema.optional(Schema.String),
  description: Schema.optional(NullableString),
  events: Schema.optional(Schema.Array(WebhookEventTypeSchema)),
  enabled: Schema.optional(Schema.Boolean),
});
export type PatchWebhookEndpointRequest = typeof PatchWebhookEndpointRequest.Type;

/** The plaintext signing secret is only returned by create and rotate. */
export const CreateWebhookEndpointResponse = Schema.Struct({
  endpoint: WebhookEndpointInfo,
  secret: Schema.String,
});
export type CreateWebhookEndpointResponse = typeof CreateWebhookEndpointResponse.Type;

export const RotateWebhookSecretResponse = Schema.Struct({ secret: Schema.String });
export type RotateWebhookSecretResponse = typeof RotateWebhookSecretResponse.Type;

export const WebhookTestResponse = Schema.Struct({
  status: WebhookDeliveryStatus,
  responseStatus: Schema.optional(Schema.NullOr(Schema.Number)),
  error: Schema.optional(NullableString),
  durationMs: Schema.Number,
});
export type WebhookTestResponse = typeof WebhookTestResponse.Type;

/** A bounded, secret-free delivery record shown in support tooling/tests. */
export const WebhookDeliveryInfo = Schema.Struct({
  id: Schema.String,
  endpointId: Schema.String,
  event: Schema.String,
  status: WebhookDeliveryStatus,
  attempt: Schema.Number,
  responseStatus: Schema.optional(Schema.NullOr(Schema.Number)),
  error: Schema.optional(NullableString),
  createdAt: Schema.String,
});
export type WebhookDeliveryInfo = typeof WebhookDeliveryInfo.Type;
