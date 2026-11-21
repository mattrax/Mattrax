import { Effect, Option, Predicate, Schema } from "effect";
import { desc, eq, inArray, lt } from "drizzle-orm";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import {
  LOGIN_ATTEMPT_FAILURES,
  LOGIN_ATTEMPT_FACTORS,
  LOGIN_ATTEMPT_METHODS,
  normalisePath,
} from "@mattrax/enterprise-domain";
import type {
  LoginAttemptFactor,
  LoginAttemptFailure,
  LoginAttemptMethod,
} from "@mattrax/enterprise-domain";
import { schema } from "../schema.ts";
import { clientAddress, parseUserAgent } from "./accountAudit.ts";

export { LOGIN_ATTEMPT_FAILURES, LOGIN_ATTEMPT_FACTORS, LOGIN_ATTEMPT_METHODS };

export type { LoginAttemptFactor, LoginAttemptFailure, LoginAttemptMethod };

/**
 * Sign-in attempt log.
 *
 * Every completed sign-in writes one row, as does a rejected attempt that the
 * boundary can attribute to an account (a pending-MFA failure identified by
 * its pending credential, or an SSO callback rejection after the account was
 * resolved). Rejections with no owner are not stored: the table is readable
 * only through an account-scoped API, so an unattributable row would be dead
 * data. Reads are always scoped by `accountId`, so one account can never page
 * another's attempts.
 *
 * Writes are best effort. A failed insert is metadata loss, never a failed
 * login, so `recordLoginAttempt` swallows and logs its own errors.
 */

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
  /** Primary proof that signed the session in. */
  readonly method: LoginAttemptMethod;
  /** Step that completed the sign-in; omitted for failures. */
  readonly factor?: LoginAttemptFactor | null;
  readonly failureReason?: LoginAttemptFailure | null;
  /** Client address; `recordLoginAttempt` always reduces it to a network prefix. */
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
  // Accept an address that is already a prefix so the function is idempotent.
  const value = address?.trim().replace(/\/\d{1,3}$/, "");

  if (!value) return null;

  // `::ffff:203.0.113.7` is an IPv4 client reported over an IPv6 socket.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  // The same mapping in hexadecimal, e.g. `::ffff:cb00:7107`.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(value);

  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const octets = [high >> 8, high & 0xff, low >> 8, low & 0xff].map((part) => part & 0xff);

    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  const ipv4 = mapped?.[1] ?? value;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipv4)) {
    const octets = ipv4.split(".").map(Number);

    if (octets.length === 4 && octets.every((octet) => octet >= 0 && octet <= 255))
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;

    return null;
  }

  // A zone id (`fe80::1%en0`) is local interface metadata, not part of the address.
  const withoutZone = value.split("%")[0];

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
 * The library-owned pending-authentication proof cookie. A completed primary
 * factor issues it; the MFA/pending actions present it while the login is not
 * yet a session. Reading the pending row is the only way to attribute a failed
 * second factor, because the failure response deliberately carries no identity.
 */
export const PENDING_PROOF_COOKIE = "__Host-effect-auth-pending-proof";

/**
 * `Sessions.stateful()` creates the module from the default namespace, so the
 * pending digest is the library's stable SHA-256 domain separation for
 * `effect-auth/sessions`. The library version is pinned in `pnpm-workspace.yaml`;
 * if a future upgrade changes the namespace, update this constant with it.
 */
const SESSION_MODULE_ID = "effect-auth/sessions";

const cookieFrom = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null => {
  const raw = headers["cookie"];

  if (raw === undefined) return null;

  for (const part of (Array.isArray(raw) ? raw.join(";") : raw).split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }

  return null;
};

/** The opaque pending credential's at-rest digest, matching `Sessions` persistence. */
export const pendingCredentialDigest = (credential: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const message = new TextEncoder().encode(
      JSON.stringify({
        namespace: "effect-auth/session",
        moduleId: SESSION_MODULE_ID,
        purpose: "pending",
        secret: credential,
      }),
    );

    const digest = await crypto.subtle.digest("SHA-256", message);

    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  });

/**
 * Resolve the account that owns this request's pending login. Null when the
 * cookie is absent, malformed or no longer maps to a live pending row.
 */
export const pendingAttemptSubject = (
  db: EnterpriseDb,
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    const credential = cookieFrom(headers, PENDING_PROOF_COOKIE);

    if (credential === null || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return null;

    const digest = yield* pendingCredentialDigest(credential);

    const rows = yield* db
      .select({ subjectId: schema.authPending.subjectId })
      .from(schema.authPending)
      .where(eq(schema.authPending.digest, digest))
      .limit(1);

    return rows[0]?.subjectId ?? null;
  }).pipe(Effect.catchCause(() => Effect.succeed(null)));

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
      factor: input.factor ?? null,
      failureReason: input.failureReason ?? null,
      // The recorder owns this reduction so no caller can store a host address.
      ip: bounded(approximateNetwork(input.ip), LOGIN_ATTEMPT_IP_LIMIT),
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

/** One maintenance run removes at most this many rows. */
export const LOGIN_ATTEMPT_PRUNE_BATCH = 1_000;

/** Delete a bounded batch of attempts older than `before`; returns the removed count. */
export const pruneLoginAttempts = (
  db: EnterpriseDb,
  before: Date,
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const stale = yield* db
      .select({ id: schema.loginAttempt.id })
      .from(schema.loginAttempt)
      .where(lt(schema.loginAttempt.createdAt, before))
      .limit(LOGIN_ATTEMPT_PRUNE_BATCH);

    if (stale.length === 0) return 0;

    yield* db.delete(schema.loginAttempt).where(
      inArray(
        schema.loginAttempt.id,
        stale.map((row) => row.id),
      ),
    );

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
    factor: row.factor,
    failureReason: row.failureReason,
    ip: row.ip,
    browser: parsed.browser,
    platform: parsed.platform,
    deviceType: parsed.deviceType,
  };
};

/**
 * One auth-action path the library exposes, mapped to the factor that completes
 * the login. The path is normalised first, so case, duplicate slashes and a
 * trailing slash cannot evade the log. `begin*` actions only issue a challenge;
 * they are not attempts.
 */
export const signInFactorForPath = (path: string): LoginAttemptFactor | undefined => {
  switch (normalisePath(path)) {
    case "/api/v1/completepasskeysignin":
    case "/api/v1/completepasskeypending":
      return "passkey";
    case "/api/v1/verifytotppending":
      return "totp";
    case "/api/v1/recovertotppending":
      return "recovery";
    case "/api/v1/ssosignin":
      return "sso";
    case "/api/v1/recoverysignin":
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
    const factor = signInFactorForPath(input.path);

    if (factor === undefined) return;

    const outcome = decodeLoginAttemptOutcome(input.body);
    const client = loginAttemptClient(input.headers, input.remoteAddress);

    // A pending MFA step is not a completed sign-in; the completion request
    // writes the row that represents the login.
    if (outcome.status === "ignored") return;

    if (outcome.status === "success") {
      // A completed session always names its subject. Without one the row would
      // be unreadable by any account, so it is dropped.
      if (outcome.subjectId === null) return;

      yield* recordLoginAttempt(db, {
        accountId: outcome.subjectId,
        email: outcome.email,
        success: true,
        method: loginAttemptMethodFromAssurance(outcome.assuranceMethod) ?? factor,
        factor,
        ip: client.ip,
        userAgent: client.userAgent,
      });

      return;
    }

    // The response carries no identity by design. The pending credential does:
    // it was issued to the account whose primary factor already succeeded, so
    // a rejected second factor can be attributed for that account's own log.
    const subjectId = yield* pendingAttemptSubject(db, input.headers);

    if (subjectId === null) return;

    yield* recordLoginAttempt(db, {
      accountId: subjectId,
      success: false,
      method: factor,
      factor,
      failureReason: outcome.failureReason,
      ip: client.ip,
      userAgent: client.userAgent,
    });
  });

/** True when this path is one the HTTP observer should record. */
export const isObservedSignInPath = (path: string) => signInFactorForPath(path) !== undefined;
