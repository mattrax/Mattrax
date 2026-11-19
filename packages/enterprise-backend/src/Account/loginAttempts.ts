import { Effect, Option, Predicate, Schema } from "effect";
import { desc, eq, lt } from "drizzle-orm";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { schema } from "../schema.ts";
import { clientAddress, parseUserAgent } from "./accountAudit.ts";

/**
 * Sign-in attempt log.
 *
 * Every interactive sign-in that completes through the shared auth boundary
 * writes one row, as does every rejected attempt the boundary can attribute to
 * an account. The table is the account's own history: reads are always scoped
 * by `accountId`, so one account can never page another's attempts.
 *
 * Writes are best effort. A failed insert is metadata loss, never a failed
 * login, so `recordLoginAttempt` swallows and logs its own errors.
 */

export const LOGIN_ATTEMPT_METHODS = ["passkey", "totp", "sso", "recovery", "api-token"] as const;

export type LoginAttemptMethod = (typeof LOGIN_ATTEMPT_METHODS)[number];

export const LOGIN_ATTEMPT_FAILURES = [
  "invalid_code",
  "unknown_account",
  "expired",
  "disabled",
  "mfa_failed",
  "passkey_rejected",
  "sso_rejected",
  "recovery_rejected",
  "rate_limited",
  "not_member",
  "failed",
] as const;

export type LoginAttemptFailure = (typeof LOGIN_ATTEMPT_FAILURES)[number];

/** Newest page returned by the account settings endpoint. */
export const LOGIN_ATTEMPT_LIST_LIMIT = 50;

/** Matches the bound the session descriptor applies to the same header. */
export const LOGIN_ATTEMPT_USER_AGENT_LIMIT = 512;

/**
 * IPv6 text is at most 45 characters; `/64` suffixes and an IPv4-mapped form
 * stay comfortably below this. The column is bounded so MySQL can index it.
 */
export const LOGIN_ATTEMPT_IP_LIMIT = 64;

export const LOGIN_ATTEMPT_EMAIL_LIMIT = 320;

const loginAttemptId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const bounded = (value: string | null | undefined, limit: number): string | null => {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed.slice(0, limit);
};

export type LoginAttemptInput = {
  readonly accountId?: string | null;
  readonly email?: string | null;
  readonly success: boolean;
  readonly method: LoginAttemptMethod;
  readonly failureReason?: LoginAttemptFailure | null;
  /** Approximate network; callers should pass `approximateNetwork`, not a host address. */
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly at?: Date;
};

/**
 * Reduce a client address to a network prefix. IPv4 keeps 24 bits, IPv6 keeps
 * 64, which is enough to recognise a location or provider without retaining a
 * host address. Malformed input yields null rather than an unbounded string.
 */
export const approximateNetwork = (address: string | null | undefined): string | null => {
  const value = address?.trim();

  if (!value) return null;

  // `::ffff:203.0.113.7` is an IPv4 client reported over an IPv6 socket.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  const ipv4 = mapped?.[1] ?? value;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipv4)) {
    const octets = ipv4.split(".").map(Number);

    if (octets.length === 4 && octets.every((octet) => octet >= 0 && octet <= 255))
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;

    return null;
  }

  // A zone id (`fe80::1%en0`) is local interface metadata, not part of the address.
  const withoutZone = value.split("%")[0]!;

  if (!withoutZone.includes(":")) return null;

  const halves = withoutZone.split("::");

  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

  // With `::` the zero run fills the gap; without it the address must be complete.
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const hextets = [...left, ...Array<string>(Math.max(0, missing)).fill("0"), ...right];

  if (hextets.length !== 8) return null;

  const parsed: string[] = [];

  for (const hextet of hextets) {
    if (!/^[0-9a-f]{1,4}$/i.test(hextet)) return null;

    parsed.push(Number.parseInt(hextet, 16).toString(16));
  }

  return `${parsed.slice(0, 4).join(":")}::/64`;
};

/** The bounded client fields for one request, or nulls when the host supplies none. */
export const loginAttemptClient = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
  remoteAddress?: string | null,
) => {
  const rawUserAgent = headers["user-agent"];

  return {
    ip: approximateNetwork(clientAddress(headers) ?? remoteAddress ?? null),
    userAgent: bounded(
      Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent,
      LOGIN_ATTEMPT_USER_AGENT_LIMIT,
    ),
  };
};

/**
 * Append one attempt. Errors are logged and swallowed: bookkeeping must never
 * fail the sign-in it describes.
 */
export const recordLoginAttempt = (
  db: EnterpriseDb,
  input: LoginAttemptInput,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* db.insert(schema.loginAttempt).values({
      id: loginAttemptId(),
      accountId: input.accountId ?? null,
      email: bounded(input.email?.toLowerCase() ?? null, LOGIN_ATTEMPT_EMAIL_LIMIT),
      success: input.success,
      method: input.method,
      failureReason: input.failureReason ?? null,
      ip: bounded(input.ip ?? null, LOGIN_ATTEMPT_IP_LIMIT),
      userAgent: bounded(input.userAgent ?? null, LOGIN_ATTEMPT_USER_AGENT_LIMIT),
      createdAt: input.at ?? new Date(),
    });
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Sign-in attempt could not be recorded", cause)),
  );

/** Newest first, bounded, and always scoped to one account. */
export const listLoginAttempts = (
  db: EnterpriseDb,
  accountId: string,
  limit = LOGIN_ATTEMPT_LIST_LIMIT,
): Effect.Effect<ReadonlyArray<typeof schema.loginAttempt.$inferSelect>, unknown> =>
  Effect.gen(function* () {
    return yield* db
      .select()
      .from(schema.loginAttempt)
      .where(eq(schema.loginAttempt.accountId, accountId))
      .orderBy(desc(schema.loginAttempt.createdAt), desc(schema.loginAttempt.id))
      .limit(Math.max(1, Math.min(limit, LOGIN_ATTEMPT_LIST_LIMIT)));
  });

/** Delete attempts older than `before`; returns the number removed. */
export const pruneLoginAttempts = (
  db: EnterpriseDb,
  before: Date,
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const stale = yield* db
      .select({ id: schema.loginAttempt.id })
      .from(schema.loginAttempt)
      .where(lt(schema.loginAttempt.createdAt, before));

    if (stale.length === 0) return 0;

    yield* db.delete(schema.loginAttempt).where(lt(schema.loginAttempt.createdAt, before));

    return stale.length;
  });

/** Shape returned by the account settings endpoint. */
export const loginAttemptEntry = (row: typeof schema.loginAttempt.$inferSelect) => {
  const parsed = parseUserAgent(row.userAgent);

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    success: row.success,
    method: row.method,
    failureReason: row.failureReason,
    ip: row.ip,
    browser: parsed.browser,
    platform: parsed.platform,
    deviceType: parsed.deviceType,
  };
};

/**
 * One auth-action path the library exposes, mapped to the factor it proves.
 * `begin*` actions only issue a challenge; they are not attempts.
 */
export const signInMethodForPath = (path: string): LoginAttemptMethod | undefined => {
  switch (path) {
    case "/api/v1/completePasskeySignIn":
    case "/api/v1/completePasskeyPending":
      return "passkey";
    case "/api/v1/verifyTotpPending":
    case "/api/v1/recoverTotpPending":
      return "totp";
    case "/api/v1/ssoSignIn":
      return "sso";
    case "/api/v1/recoverySignIn":
      return "recovery";
    default:
      return undefined;
  }
};

/**
 * The strong method the session recorded. TOTP is a second factor, so a
 * completed passkey-plus-TOTP sign-in must still read as a passkey sign-in
 * rather than as an authenticator-only login.
 */
export const loginAttemptMethodFromAssurance = (
  method: string | null | undefined,
): LoginAttemptMethod | undefined => {
  switch (method) {
    case "passkey":
      return "passkey";
    case "sso-oidc":
      return "sso";
    case "account-recovery":
      return "recovery";
    case "totp":
      return "totp";
    default:
      return undefined;
  }
};

export const loginAttemptFailureFromTag = (tag: string | null | undefined): LoginAttemptFailure => {
  switch (tag) {
    case "PasskeyRejected":
    case "PasskeyProtocolRejected":
      return "passkey_rejected";
    case "TotpRejected":
      return "mfa_failed";
    case "PendingAuthenticationInvalid":
      return "expired";
    case "SsoRejected":
      return "sso_rejected";
    case "RecoveryRejected":
      return "recovery_rejected";
    default:
      // Rate limits are surfaced as a reason string rather than a tagged error
      // on some transports.
      return tag !== undefined && tag !== null && /rate.?limit/i.test(tag)
        ? "rate_limited"
        : "failed";
  }
};

const AuthActionOutcome = Schema.Union([
  Schema.TaggedStruct("Success", { value: Schema.optionalKey(Schema.Json) }),
  Schema.TaggedStruct("Failure", { error: Schema.optionalKey(Schema.Json) }),
]);

const SessionSummary = Schema.Struct({
  subjectId: Schema.optional(Schema.String),
  claims: Schema.optional(Schema.Struct({ email: Schema.optional(Schema.String) })),
  assurance: Schema.optional(Schema.Struct({ method: Schema.optional(Schema.String) })),
});

const AuthenticatedResult = Schema.TaggedStruct("Authenticated", {
  session: SessionSummary,
});

const TaggedErrorBody = Schema.Struct({ _tag: Schema.optional(Schema.String) });

export type LoginAttemptOutcome =
  | { readonly status: "ignored" }
  | {
      readonly status: "success";
      readonly subjectId: string | null;
      readonly email: string | null;
      readonly assuranceMethod: string | null;
    }
  | { readonly status: "failure"; readonly failureReason: LoginAttemptFailure };

const failureTagOf = (error: Schema.Json | undefined): string | null => {
  if (error === undefined) return null;

  return Option.getOrUndefined(Schema.decodeUnknownOption(TaggedErrorBody)(error))?._tag ?? null;
};

/**
 * Read the public auth-action envelope. Success carries the completed session,
 * which is the only response that names the account and the factor that proved
 * it; `PendingAuthentication` is deliberately ignored because the sign-in is
 * not finished yet.
 */
export const decodeLoginAttemptOutcome = (body: string | null): LoginAttemptOutcome => {
  if (body === null || body.length === 0) return { status: "ignored" };

  const parsed = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(body),
  );

  if (parsed === undefined) return { status: "ignored" };

  const envelope = Option.getOrUndefined(Schema.decodeUnknownOption(AuthActionOutcome)(parsed));

  if (envelope === undefined) return { status: "ignored" };

  if (Predicate.isTagged(envelope, "Failure"))
    return {
      status: "failure",
      failureReason: loginAttemptFailureFromTag(failureTagOf(envelope.error)),
    };

  if (envelope.value === undefined) return { status: "ignored" };

  const completed = Option.getOrUndefined(
    Schema.decodeUnknownOption(AuthenticatedResult)(envelope.value),
  );

  if (completed === undefined) return { status: "ignored" };

  return {
    status: "success",
    subjectId: completed.session.subjectId ?? null,
    email: completed.session.claims?.email ?? null,
    assuranceMethod: completed.session.assurance?.method ?? null,
  };
};

/**
 * Map one observed auth-action response to a row. The caller supplies the
 * shared database handle and the request's client descriptor, keeping the HTTP
 * middleware free of policy.
 */
export const recordObservedLoginAttempt = (
  db: EnterpriseDb,
  input: {
    readonly path: string;
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
    readonly remoteAddress?: string | null;
    readonly body: string | null;
  },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const routeMethod = signInMethodForPath(input.path);

    if (routeMethod === undefined) return;

    const outcome = decodeLoginAttemptOutcome(input.body);
    const client = loginAttemptClient(input.headers, input.remoteAddress);

    // A pending MFA step is not a completed sign-in; the completion request
    // writes the row that represents the login.
    if (outcome.status === "ignored") return;

    const success = outcome.status === "success";

    const method = success
      ? (loginAttemptMethodFromAssurance(outcome.assuranceMethod) ?? routeMethod)
      : routeMethod;

    yield* recordLoginAttempt(db, {
      accountId: success ? outcome.subjectId : null,
      email: success ? outcome.email : null,
      success,
      method,
      failureReason: success ? null : outcome.failureReason,
      ip: client.ip,
      userAgent: client.userAgent,
    });
  });

/** True when this path is one the HTTP observer should record. */
export const isObservedSignInPath = (path: string) => signInMethodForPath(path) !== undefined;
