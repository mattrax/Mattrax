import { Match } from "effect";

/**
 * Optimistic concurrency for tenant resources.
 *
 * Every guarded mutation compares the client's copy of `updatedAt` with the
 * stored row and refuses the write when they differ (HTTP 412). The timestamp
 * travels in the request body as `expectedUpdatedAt`, an ISO-8601 timestamp
 * with millisecond precision taken from the row the client loaded. Clients
 * that cannot send a body precondition may send the standard
 * `If-Unmodified-Since` header instead; HTTP dates only carry seconds, so
 * that path compares whole seconds and is documented as the coarse fallback.
 *
 * A missing precondition is allowed. Older API clients and integrations keep
 * working, while the dashboard always sends one.
 *
 * ## Guarded mutations
 *
 * `patchPolicy`, `patchGroup`, `patchApplication` and `patchScript` replace
 * administrator-authored fields (and, for policies, the configuration set), so
 * a write based on a stale read would silently lose the other edit. Each locks
 * the row, compares its `updatedAt`, then writes in the same transaction.
 *
 * ## Deliberately unguarded
 *
 * The assignment, membership and settings endpoints
 * (`patchPolicyAssignments`, `patchGroupMembers`,
 * `patchApplicationAssignments`, `patchScriptAssignments`,
 * `patchScriptSettings`) send explicit per-target deltas rather than a whole
 * replacement set: inserts are idempotent (`ignore`/upsert), deletes name only
 * the targets the client is changing, and two different targets merge. They
 * are last-writer-wins per target, which is the intended meaning of an
 * explicit assignment. The bulk delete endpoints take explicit ids and are
 * idempotent. Creates and duplicate actions never overwrite an existing row.
 */
/** How precisely a supplied timestamp can be compared with the stored row. */
export type UpdatedAtPrecision = "millisecond" | "second";

export type PreconditionTimestamp = {
  readonly at: Date;
  readonly precision: UpdatedAtPrecision;
  /** The value as supplied, so a validation failure can echo it. */
  readonly value: string;
};

export type UpdatedAtPrecondition =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "At"; readonly timestamp: PreconditionTimestamp }
  | { readonly _tag: "Invalid"; readonly value: string };

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/;

const ISO_FRACTION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(\d+)/;

/** Parse an ISO-8601 timestamp or an RFC 9110 HTTP-date. */
export const parseUpdatedAtTimestamp = (value: string): PreconditionTimestamp | undefined => {
  const text = value.trim();

  if (!text) return undefined;

  const millis = Date.parse(text);

  if (!Number.isFinite(millis)) return undefined;

  const at = new Date(millis);

  if (!Number.isFinite(at.getTime())) return undefined;

  // Only an ISO timestamp with a fractional part carries sub-second
  // precision. Date-only, second-precision ISO and HTTP-date strings cannot,
  // so they are compared as whole seconds.
  const precision: UpdatedAtPrecision =
    ISO_TIMESTAMP.test(text) && ISO_FRACTION.test(text) ? "millisecond" : "second";

  return { at, precision, value: text };
};

/**
 * Read the precondition from the request body first, then the header.
 *
 * A body value that is present but malformed is invalid rather than falling
 * back to the header: the caller explicitly chose that value, and silently
 * using another one would hide a client bug. An absent value in both places is
 * allowed for backwards compatibility.
 */
export const updatedAtPrecondition = (input: {
  readonly expectedUpdatedAt?: string | undefined;
  readonly ifUnmodifiedSince?: string | undefined;
}): UpdatedAtPrecondition => {
  for (const candidate of [input.expectedUpdatedAt, input.ifUnmodifiedSince]) {
    if (candidate === undefined) continue;

    if (!candidate.trim()) return { _tag: "Invalid", value: candidate };

    const timestamp = parseUpdatedAtTimestamp(candidate);

    return timestamp ? { _tag: "At", timestamp } : { _tag: "Invalid", value: candidate };
  }

  return { _tag: "Missing" };
};

/**
 * Whether the stored row still matches what the client loaded.
 *
 * Missing preconditions always match. A malformed one never does; handlers
 * reject it as a bad request before reaching this point.
 */
export const updatedAtSatisfiesPrecondition = (
  current: Date,
  precondition: UpdatedAtPrecondition,
): boolean =>
  Match.value(precondition).pipe(
    Match.tag("Missing", () => true),
    Match.tag("Invalid", () => false),
    Match.tag("At", ({ timestamp }) =>
      timestamp.precision === "millisecond"
        ? current.getTime() === timestamp.at.getTime()
        : Math.floor(current.getTime() / 1_000) === Math.floor(timestamp.at.getTime() / 1_000),
    ),
    Match.orElse(() => false),
  );
