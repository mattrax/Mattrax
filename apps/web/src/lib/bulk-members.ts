/** One row a bulk member action could not complete, with a readable reason. */
export type BulkFailure = { id: string; name: string; reason: string };

/** Per-row outcome returned by the member bulk endpoints. */
export type BulkOutcome = { succeeded: number; failed: BulkFailure[] };

/** Copy for the toast that reports a bulk outcome. */
export type BulkReport = {
  tone: "success" | "warning" | "error";
  title: string;
  description?: string;
  details: string[];
};

const capitalise = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1);

const entityNoun = (noun: { one: string; many: string }, count: number) =>
  `${count} ${count === 1 ? noun.one : noun.many}`;

/**
 * The API uses short tagged reasons so clients can translate them. Anything
 * unrecognised is still shown, never hidden.
 */
export const bulkFailureReason = (reason: string) =>
  reason === "notFound"
    ? "No longer exists"
    : capitalise(reason.replace(/[_-]+/g, " "));

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
  const details = outcome.failed.map((row) => `${row.name}: ${row.reason}`);

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
