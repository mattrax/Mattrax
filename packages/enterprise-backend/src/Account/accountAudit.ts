import { Effect, Option, Schema } from "effect";
import { and, desc, eq, gte, like, lt, lte, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { escapeLike } from "./auditLog.ts";
import type { AuditExportEntry, AuditSearchFilters } from "./auditLog.ts";
import type { EnterpriseSchema } from "../schema.ts";
import { schema } from "../schema.ts";

/**
 * Account-scoped audit actions. These describe the person, not a tenant: they
 * are recorded before a tenant is chosen (sign-in, credential lifecycle) or
 * exist independently of one (API tokens, account deletion, recovery).
 */
export const ACCOUNT_AUDIT = {
  /** A session authenticated its first request after sign-in. */
  signIn: "account.sign_in",
  /** An attributable sign-in factor was rejected. */
  signInFailed: "account.sign_in_failed",
  /** A step-up confirmation for a sensitive action was rejected. */
  stepUpFailed: "account.step_up_failed",
  mfaEnrolled: "account.mfa_enrolled",
  mfaDisabled: "account.mfa_disabled",
  mfaRecoveryRegenerated: "account.mfa_recovery_regenerated",
  passkeyAdded: "account.passkey_added",
  passkeyRemoved: "account.passkey_removed",
  emailChangeRequested: "account.email_change_requested",
  emailChangeCompleted: "account.email_change_completed",
  emailChangeCancelled: "account.email_change_cancelled",
  apiTokenCreated: "account.api_token_created",
  apiTokenRevoked: "account.api_token_revoked",
  sessionRevoked: "account.session_revoked",
  sessionsRevoked: "account.sessions_revoked",
  /** A platform operator granted or revoked the target's superadmin flag. */
  superadminGranted: "account.superadmin_granted",
  superadminRevoked: "account.superadmin_revoked",
  deleted: "account.deleted",
  recoveryRequested: "account.recovery_requested",
  recoveryApproved: "account.recovery_approved",
  recoveryCompleted: "account.recovery_completed",
  recoveryCancelled: "account.recovery_cancelled",
  /** A queued account email exhausted its delivery attempts. */
  emailDeliveryFailed: "account.email_delivery_failed",
} as const;

export type AccountAuditAction = (typeof ACCOUNT_AUDIT)[keyof typeof ACCOUNT_AUDIT];

export type AccountAuditInput = {
  /** Owner of the stream. Null once the account has been deleted. */
  readonly subjectAccountId: string | null;
  /** Address snapshot; kept after deletion so the record stays meaningful. */
  readonly subjectEmail: string | null;
  readonly actorAccountId?: string | null;
  readonly actorEmail?: string | null;
  readonly action: AccountAuditAction;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly metadata?: Schema.Json;
  readonly at?: Date;
};

const accountAuditId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

/**
 * The audit writer only needs `insert`, not the whole database handle. Narrowing
 * the parameter lets a transaction (which lacks `$client`) append an entry in
 * the same unit of work as the change it records.
 */
export type AccountAuditWriter = Pick<EnterpriseDb, "insert">;

/**
 * Append one account-scoped audit entry.
 *
 * Callers that must not fail a user action because the trail is unavailable
 * wrap this in `Effect.catchCause(() => Effect.void)`; security-relevant
 * ceremonies (email change, recovery) let it fail so a change is never
 * performed without its record.
 */
export const recordAccountAudit = (
  db: AccountAuditWriter,
  input: AccountAuditInput,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    yield* db.insert(schema.accountAuditLog).values({
      id: accountAuditId(),
      subjectAccountId: input.subjectAccountId,
      subjectEmail: input.subjectEmail,
      actorAccountId: input.actorAccountId ?? input.subjectAccountId,
      actorEmail: input.actorEmail ?? input.subjectEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
      createdAt: input.at ?? new Date(),
    });
  });

/* -------------------------------------------------------------------------- */
/* Client descriptor                                                          */
/* -------------------------------------------------------------------------- */

export type ClientDescriptor = {
  /** Human browser name, or null when the header is absent/unrecognised. */
  readonly browser: string | null;
  /** Human platform name ("macOS", "Windows", "iOS", …). */
  readonly platform: string | null;
  readonly deviceType: "desktop" | "mobile" | "tablet" | "bot" | null;
  /**
   * Salted SHA-256 prefix of the client address. Raw addresses are never
   * stored; without `AUTH_SECRET` no address-derived value is stored at all
   * (an unsalted digest of an IPv4 address is trivially reversible).
   */
  readonly ipHash: string | null;
};

const USER_AGENT_LIMIT = 512;

const headerValue = (
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined => {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name];

  return Array.isArray(value) ? value[0] : value;
};

/**
 * First hop of the client address. Cloudflare's header wins because it is set
 * by the edge and cannot be spoofed by the browser; `x-forwarded-for` and
 * `x-real-ip` cover self-hosted reverse proxies.
 */
export const clientAddress = (
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>,
): string | null => {
  const direct = headerValue(headers, "cf-connecting-ip")?.trim();

  if (direct) return direct;

  const forwarded = headerValue(headers, "x-forwarded-for")?.split(",")[0]?.trim();

  if (forwarded) return forwarded;

  const real = headerValue(headers, "x-real-ip")?.trim();

  return real || null;
};

const sha256Hex = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  });

/** 128-bit salted digest prefix of the client address, hex encoded. */
export const hashClientAddress = (secret: string | undefined, address: string | null) =>
  secret === undefined || secret.length === 0 || address === null
    ? Effect.succeed<string | null>(null)
    : sha256Hex(`${secret}:ip:${address}`).pipe(Effect.map((digest) => digest.slice(0, 32)));

const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\/|\bChromium\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const BOT_PATTERN =
  /\b(bot|crawler|spider|slurp)\b|curl\/|wget\/|httpclient|python-requests|node-fetch|axios\//i;

/**
 * Parse a User-Agent into the three display fields. Only the family is kept —
 * no version, locale or full header — so the descriptor identifies "Chrome on
 * macOS" without becoming a fingerprint.
 */
export const parseUserAgent = (
  userAgent: string | null | undefined,
): Omit<ClientDescriptor, "ipHash"> => {
  const value = (userAgent ?? "").slice(0, USER_AGENT_LIMIT);

  if (!value) return { browser: null, platform: null, deviceType: null };

  if (BOT_PATTERN.test(value)) return { browser: "Bot", platform: null, deviceType: "bot" };

  const browser = BROWSER_PATTERNS.find(([pattern]) => pattern.test(value))?.[1] ?? null;

  let platform: string | null = null;

  if (/\b(iPhone|iPad|iPod)\b/.test(value)) platform = "iOS";
  else if (/\bAndroid\b/.test(value)) platform = "Android";
  else if (/\bCrOS\b/.test(value)) platform = "ChromeOS";
  else if (/\bWindows NT\b/.test(value)) platform = "Windows";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(value)) platform = "macOS";
  else if (/\bLinux\b/.test(value)) platform = "Linux";

  const deviceType = /\biPad\b|\bTablet\b/.test(value)
    ? "tablet"
    : /\biPhone\b|\biPod\b|\bMobile\b/.test(value)
      ? "mobile"
      : "desktop";

  return { browser, platform, deviceType };
};

/** Everything a session row stores about its client, derived from one request. */
export const clientDescriptor = (
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>,
  secret: string | undefined,
) =>
  Effect.gen(function* () {
    const parsed = parseUserAgent(headerValue(headers, "user-agent"));

    return {
      ...parsed,
      ipHash: yield* hashClientAddress(secret, clientAddress(headers)),
    } satisfies ClientDescriptor;
  });

/* -------------------------------------------------------------------------- */
/* Account audit search                                                       */
/* -------------------------------------------------------------------------- */

export type AccountAuditEntry = AuditExportEntry;

export const accountAuditWhere = (
  schema: EnterpriseSchema,
  subjectAccountId: string,
  filters: AuditSearchFilters,
): SQL => {
  const conditions: [SQL, ...Array<SQL>] = [
    eq(schema.accountAuditLog.subjectAccountId, subjectAccountId),
  ];

  if (filters.action) conditions.push(eq(schema.accountAuditLog.action, filters.action));

  if (filters.targetType)
    conditions.push(eq(schema.accountAuditLog.targetType, filters.targetType));

  if (filters.targetId)
    conditions.push(like(schema.accountAuditLog.targetId, `%${escapeLike(filters.targetId)}%`));

  if (filters.actor) {
    const pattern = `%${escapeLike(filters.actor)}%`;

    const condition = or(
      like(schema.accountAuditLog.actorEmail, pattern),
      like(schema.accountAuditLog.actorAccountId, pattern),
    );

    if (condition) conditions.push(condition);
  }

  if (filters.from) conditions.push(gte(schema.accountAuditLog.createdAt, filters.from));

  if (filters.to) conditions.push(lte(schema.accountAuditLog.createdAt, filters.to));

  if (filters.cursor) {
    const condition = or(
      lt(schema.accountAuditLog.createdAt, filters.cursor.createdAt),
      and(
        eq(schema.accountAuditLog.createdAt, filters.cursor.createdAt),
        lt(schema.accountAuditLog.id, filters.cursor.id),
      ),
    );

    if (condition) conditions.push(condition);
  }

  return and(...conditions) ?? conditions[0];
};

/** Newest first, with the primary key as a deterministic tiebreaker. */
export const accountAuditOrder = (schema: EnterpriseSchema) => [
  desc(schema.accountAuditLog.createdAt),
  desc(schema.accountAuditLog.id),
];

/** Decode one row for the API/export shape shared with the tenant audit log. */
export const accountAuditEntry = (entry: {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorAccountId?: string | null;
  actorEmail?: string | null;
  metadata?: unknown;
  createdAt: Date;
}): AccountAuditEntry => ({
  id: entry.id,
  action: entry.action,
  // The account stream is account actions by definition; it predates the
  // category column and can never contain device protocol traffic.
  category: "account",
  targetType: entry.targetType,
  targetId: entry.targetId,
  actorAccountId: entry.actorAccountId ?? null,
  actorEmail: entry.actorEmail ?? null,
  actorType: entry.actorAccountId ? "account" : "system",
  ip: null,
  userAgent: null,
  deviceId: null,
  deviceCertificateFingerprint: null,
  deviceCertificateSerial: null,
  principalId: null,
  protocol: null,
  // Drizzle types a `json` column as unknown; only valid JSON reaches a response.
  metadata: Option.getOrNull(Schema.decodeUnknownOption(Schema.Json)(entry.metadata)),
  createdAt: entry.createdAt.toISOString(),
});
