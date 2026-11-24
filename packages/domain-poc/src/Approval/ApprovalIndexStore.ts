import { Context, Effect, Layer } from "effect";
import { Domain } from "../domain.ts";
import type { ApprovalIndexRow } from "./ApprovalIndexRow.ts";

export interface ApprovalIndexFilters {
  readonly statuses?: ReadonlyArray<string> | undefined;
  readonly requestedBy?: string | undefined;
}

/**
 * The port a projection writes and a query reads.
 *
 * In a real port this is the existing MySQL table, written with an upsert
 * keyed by approval id; the memory implementation below is what lets stories
 * run without a database. Keeping the port in the domain package is what makes
 * the model independent of where it is hosted.
 */
export class ApprovalIndexStore extends Context.Service<
  ApprovalIndexStore,
  {
    readonly upsert: (rows: ReadonlyArray<ApprovalIndexRow>) => Effect.Effect<void>;
    readonly forTenant: (
      tenantId: string,
      filters: ApprovalIndexFilters,
      page: Domain.Query.PageRequest,
    ) => Effect.Effect<Domain.Query.Page<ApprovalIndexRow>>;
  }
>()("Enterprise/ApprovalIndexStore") {}

const cursorOf = (row: ApprovalIndexRow): string => row.updatedAt + ":" + row.id;

/**
 * In-memory store for stories and the local demo. Rows are keyed by approval
 * id, so a replayed projection input overwrites the same row instead of
 * creating a second one — the idempotency a projection requires.
 */
export const MemoryApprovalIndexStore = Layer.sync(ApprovalIndexStore, () => {
  const rows = new Map<string, ApprovalIndexRow>();

  return ApprovalIndexStore.of({
    upsert: (batch) =>
      Effect.sync(() => {
        for (const row of batch) rows.set(row.id, row);
      }),
    forTenant: (tenantId, filters, page) =>
      Effect.sync(() => {
        const matching = [...rows.values()]
          .filter((row) => row.tenantId === tenantId)
          .filter((row) => !filters.statuses || filters.statuses.includes(row.status))
          .filter((row) => !filters.requestedBy || row.requestedBy === filters.requestedBy)
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));

        const after = page.after;
        const remaining = after ? matching.filter((row) => cursorOf(row) < after) : matching;
        const entries = remaining.slice(0, page.take);
        const last = entries.at(-1);

        return {
          entries,
          cursor: remaining.length > entries.length && last ? cursorOf(last) : null,
        };
      }),
  });
});
