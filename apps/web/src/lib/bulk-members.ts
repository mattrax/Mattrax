/** One row a bulk member action could not complete, with a readable reason. */
export type BulkFailure = { id: string; name: string; reason: string };

/** Per-row outcome returned by the member bulk endpoints. */
export type BulkOutcome = { succeeded: number; failed: BulkFailure[] };

/** Raw per-row response from a member bulk endpoint. */
export type BulkResult = {
  readonly updated: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<{ id: string; reason: string }>;
};

/** Split an id list into requests the endpoint accepts in one call. */
export function chunkIds(ids: ReadonlyArray<string>, limit: number): string[][] {
  const chunks: string[][] = [];

  for (let offset = 0; offset < ids.length; offset += limit)
    chunks.push(ids.slice(offset, offset + limit));

  return chunks;
}

/** Combine per-batch responses without losing any succeeded or failed row. */
export function mergeBulkResults(results: ReadonlyArray<BulkResult>): BulkResult {
  return {
    updated: results.flatMap((result) => result.updated),
    failed: results.flatMap((result) => result.failed),
  };
}

/**
 * Run a bulk member action across the endpoint's per-request cap. Selections
 * larger than one page must not fail as a whole, so batches run in order and
 * their outcomes are merged for the caller's single report.
 */
export async function runBulkBatches(
  ids: ReadonlyArray<string>,
  limit: number,
  request: (batch: string[]) => Promise<BulkResult>,
): Promise<BulkResult> {
  const results: BulkResult[] = [];

  for (const batch of chunkIds(ids, limit)) results.push(await request(batch));

  return mergeBulkResults(results);
}

/** Copy for the toast that reports a bulk outcome. */
export type BulkReport = {
  tone: "success" | "warning" | "error";
  title: string;
  description?: string;
  details: string[];
};

/** The list kinds that share bulk actions and report copy. */
export type BulkEntity = "device" | "group" | "policy";

const capitalise = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1);

/** Singular and plural nouns for a bulk report; `policy` is the irregular one. */
export const bulkNouns = (entity: BulkEntity) => ({
  one: entity,
  many: entity === "policy" ? "policies" : `${entity}s`,
});

const entityNoun = (noun: { one: string; many: string }, count: number) =>
  `${count} ${count === 1 ? noun.one : noun.many}`;

/** `3 devices`, `1 policy`, ... for confirmation copy and report titles. */
export const bulkEntityNoun = (entity: BulkEntity, count: number): string =>
  entityNoun(bulkNouns(entity), count);

/** One `name: reason` line per failed row, for a toast's details. */
export const bulkFailureDetails = (failed: ReadonlyArray<BulkFailure>): string[] =>
  failed.map((row) => `${row.name}: ${row.reason}`);

/**
 * The API uses short tagged reasons so clients can translate them. Anything
 * unrecognised is still shown, never hidden.
 */
const failureLabels = new Map<string, string>([
  ["notFound", "No longer exists"],
  ["forbidden", "Not allowed"],
  ["lastOwner", "Cannot remove the last owner"],
]);

export const bulkFailureReason = (reason: string) =>
  failureLabels.get(reason) ?? capitalise(reason.replace(/[_-]+/g, " "));

/**
 * The single-member endpoint and the bulk one share a role picker value shape.
 * `builtin:` is a UI token; `role:` carries a custom role id with `member` as
 * the built-in fallback.
 */
export function rolePatch(value: string): { role: string; roleId: string | null } {
  return value.startsWith("role:")
    ? { role: "member", roleId: value.slice("role:".length) }
    : { role: value.slice("builtin:".length), roleId: null };
}

/**
 * Turn a bulk outcome into toast copy. A partial failure names how many rows
 * completed so the operator can tell the difference between "nothing worked"
 * and "some were skipped".
 */
export function bulkReport(
  noun: { one: string; many: string },
  copy: { ok: string; fail: string },
  outcome: BulkOutcome,
): BulkReport {
  const requested = outcome.succeeded + outcome.failed.length;
  const details = bulkFailureDetails(outcome.failed);

  if (outcome.failed.length === 0)
    return {
      tone: "success",
      title: `${capitalise(copy.ok)} ${entityNoun(noun, outcome.succeeded)}`,
      details,
    };

  if (outcome.succeeded === 0)
    return {
      tone: "error",
      title: `${capitalise(copy.fail)} ${entityNoun(noun, requested)}`,
      details,
    };

  return {
    tone: "warning",
    title: `${capitalise(copy.ok)} ${outcome.succeeded} of ${entityNoun(noun, requested)}`,
    description: `${capitalise(entityNoun(noun, outcome.failed.length))} did not complete.`,
    details,
  };
}
