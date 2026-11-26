/**
 * Durable history of failed Windows enrollment and management requests.
 *
 * The Windows SOAP/SyncML endpoints already answer a device with a SOAP fault
 * or a SyncML status; before this module the reason only reached the device and
 * the server log. A first-time enrollment that fails has no device row, so the
 * operator had nothing to look at. These records are written best-effort at the
 * point the fault is known and are read back for the device page and the
 * tenant delivery diagnostics.
 */

import { and, count, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { Cause, Effect, Schema } from "effect";
import type { WindowsFailurePhase as CanonicalWindowsFailurePhase } from "@mattrax/management-backend";
import type { EnterpriseDb } from "./db.ts";
import { windowsFailure } from "./schema.ts";

/** Where in the Windows protocol a request failed. */
export type WindowsFailurePhase = CanonicalWindowsFailurePhase;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

type Assert<Value extends true> = Value;

/** Fails compilation if the canonical domain contract changes without review. */
export type WindowsFailurePhaseMatchesContract = Assert<
  Equal<WindowsFailurePhase, "discovery" | "wstep" | "enrollment" | "policy" | "command">
>;

/** Failure history older than this is deleted by daily maintenance. */
export const WINDOWS_FAILURE_RETENTION_DAYS = 30;

/**
 * A device retrying the same fault (a polling device with a broken policy, or
 * someone holding an enrollment link) writes the same
 * `(organization, phase, code, deviceIdentifier)` over and over. Within this
 * window the newest matching row is reused instead of appending.
 */
export const WINDOWS_FAILURE_COALESCE_SECONDS = 60;

/** Diagnostic writes must never hold up the device's protocol response. */
const WRITE_TIMEOUT = "2 seconds";

/** Bounds applied before anything is stored, so a broken client cannot bloat the table. */
export const WINDOWS_FAILURE_MESSAGE_LIMIT = 500;

export const WINDOWS_FAILURE_DETAIL_LIMIT = 1_000;

const CODE_LIMIT = 64;

const COLUMN_LIMIT = 255;

const MAX_LIST_LIMIT = 50;

const PEM_BLOCK = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g;

const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Long opaque values: tokens, keys and base64 blobs. */
const OPAQUE_VALUE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

const WHITESPACE = /\s+/g;

const stringify = (cause: unknown): string => {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;

  if (Schema.is(Schema.String)(cause)) return cause;

  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
};

/**
 * Turn an arbitrary internal error into something safe to store.
 *
 * Certificate material, passwords, tokens and full request bodies never reach
 * this function, but a dependency can still echo a PEM block or an opaque
 * credential in its message. Those are replaced rather than trusted, and the
 * result is collapsed to one bounded line.
 */
export const describeWindowsFailure = (cause: unknown): string =>
  stringify(cause)
    .replaceAll(PEM_BLOCK, "[certificate]")
    .replaceAll(EMAIL_ADDRESS, "[email]")
    .replaceAll(OPAQUE_VALUE, "[redacted]")
    .replaceAll(WHITESPACE, " ")
    .trim();

const bound = (value: string | null | undefined, limit: number): string | null => {
  if (value == null) return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
};

const boundCode = (value: string): string =>
  value
    .replaceAll(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, CODE_LIMIT)
    .trim() || "request_failed";

export type WindowsFailureInput = {
  readonly organizationId: string;
  readonly deviceId?: string | null;
  readonly deviceIdentifier?: string | null;
  readonly serial?: string | null;
  readonly hostname?: string | null;
  readonly phase: WindowsFailurePhase;
  readonly code: string;
  /** Curated operator-facing reason; redacted and bounded here regardless. */
  readonly message: string;
  /** Internal error text or the OMA-URI involved, when it helps. */
  readonly detail?: string | null;
};

/**
 * Append one failure record. Never fails: a diagnostic write must not turn a
 * device's protocol response into a server error, so a broken (or slow) insert
 * is logged and swallowed.
 *
 * Repeated identical faults are coalesced: a row with the same organization,
 * phase, code and device identifier written inside
 * {@link WINDOWS_FAILURE_COALESCE_SECONDS} is reused rather than appended, so a
 * client stuck retrying cannot grow the table.
 */
export const recordWindowsFailure = (
  db: EnterpriseDb,
  input: WindowsFailureInput,
  options: { readonly now?: Date } = {},
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();
    const code = boundCode(input.code);
    const deviceIdentifier = bound(input.deviceIdentifier, COLUMN_LIMIT);
    const cutoff = new Date(now.getTime() - WINDOWS_FAILURE_COALESCE_SECONDS * 1_000);

    const [recent] = yield* db
      .select({ id: windowsFailure.id })
      .from(windowsFailure)
      .where(
        and(
          eq(windowsFailure.organizationId, input.organizationId),
          eq(windowsFailure.phase, input.phase),
          eq(windowsFailure.code, code),
          deviceIdentifier
            ? eq(windowsFailure.deviceIdentifier, deviceIdentifier)
            : isNull(windowsFailure.deviceIdentifier),
          gte(windowsFailure.createdAt, cutoff),
        ),
      )
      .orderBy(desc(windowsFailure.createdAt))
      .limit(1);

    if (recent) return;

    yield* db.insert(windowsFailure).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      deviceId: input.deviceId ?? null,
      deviceIdentifier,
      serial: bound(input.serial, COLUMN_LIMIT),
      hostname: bound(input.hostname, COLUMN_LIMIT),
      phase: input.phase,
      code,
      message: bound(input.message, WINDOWS_FAILURE_MESSAGE_LIMIT) ?? "Windows request failed",
      detail: bound(
        input.detail && describeWindowsFailure(input.detail),
        WINDOWS_FAILURE_DETAIL_LIMIT,
      ),
      createdAt: now,
    });
  }).pipe(
    Effect.timeout(WRITE_TIMEOUT),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
        : Effect.logWarning(`Could not record Windows failure: ${String(cause)}`),
    ),
  );

export type WindowsFailureRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly deviceId: string | null;
  readonly deviceIdentifier: string | null;
  readonly serial: string | null;
  readonly hostname: string | null;
  readonly phase: WindowsFailurePhase;
  readonly code: string;
  readonly message: string;
  readonly detail: string | null;
  readonly createdAt: Date;
};

const clampLimit = (limit: number | undefined): number => {
  if (!limit || !Number.isFinite(limit)) return 10;

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIST_LIMIT);
};

/** Newest failures in one tenant. */
export const listWindowsFailuresForOrganization = (
  db: EnterpriseDb,
  organizationId: string,
  limit?: number,
): Effect.Effect<ReadonlyArray<WindowsFailureRow>, unknown> =>
  Effect.gen(function* () {
    return yield* db
      .select()
      .from(windowsFailure)
      .where(eq(windowsFailure.organizationId, organizationId))
      .orderBy(desc(windowsFailure.createdAt))
      .limit(clampLimit(limit));
  });

/** Newest failures attributed to one device row (already tenant-scoped). */
export const listWindowsFailuresForDevice = (
  db: EnterpriseDb,
  input: { readonly organizationId: string; readonly deviceId: string; readonly limit?: number },
): Effect.Effect<ReadonlyArray<WindowsFailureRow>, unknown> =>
  Effect.gen(function* () {
    return yield* db
      .select()
      .from(windowsFailure)
      .where(
        and(
          eq(windowsFailure.organizationId, input.organizationId),
          eq(windowsFailure.deviceId, input.deviceId),
        ),
      )
      .orderBy(desc(windowsFailure.createdAt))
      .limit(clampLimit(input.limit));
  });

/**
 * Failures inside the retention window. The window is used instead of an
 * all-time count so the number an operator sees matches the history beside it.
 * `retentionDays <= 0` means history is kept forever, so every row counts.
 */
export const countWindowsFailures = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly deviceId?: string;
    readonly retentionDays?: number;
    readonly since?: Date;
  },
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const retentionDays = input.retentionDays ?? WINDOWS_FAILURE_RETENTION_DAYS;

    const since =
      input.since ??
      (retentionDays > 0 ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000) : undefined);

    const [row] = yield* db
      .select({ value: count() })
      .from(windowsFailure)
      .where(
        and(
          eq(windowsFailure.organizationId, input.organizationId),
          input.deviceId ? eq(windowsFailure.deviceId, input.deviceId) : undefined,
          since ? gte(windowsFailure.createdAt, since) : undefined,
        ),
      );

    return row?.value ?? 0;
  });

/** Delete records older than the retention window. Returns the count removed. */
export const pruneWindowsFailures = (
  db: EnterpriseDb,
  options: { readonly now?: Date; readonly retentionDays?: number } = {},
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const retentionDays = options.retentionDays ?? WINDOWS_FAILURE_RETENTION_DAYS;

    if (retentionDays <= 0) return 0;

    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const stale = yield* db
      .select({ id: windowsFailure.id })
      .from(windowsFailure)
      .where(lt(windowsFailure.createdAt, cutoff));

    if (stale.length === 0) return 0;

    yield* db.delete(windowsFailure).where(lt(windowsFailure.createdAt, cutoff));

    return stale.length;
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
        : Effect.succeed(0),
    ),
  );
