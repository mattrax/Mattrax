import { DateTime, Effect } from "effect";
import { Domain } from "../domain.ts";
import { TenantId } from "../Actor.ts";
import { ApprovalDetail } from "./ApprovalDetail.view.ts";
import { ApprovalIndexStore } from "./ApprovalIndexStore.ts";
import {
  ApprovalApproved,
  ApprovalCancelled,
  ApprovalConsumed,
  ApprovalDecisionRecorded,
  ApprovalExpired,
  ApprovalRejected,
} from "./Approval.events.ts";
import { ApprovalRequested } from "./ApprovalRequested.command.ts";

/**
 * The list/search read model.
 *
 * A view answers one question about one key; "every approval in this tenant,
 * filtered and paged" is a question across keys, so it needs a projection into
 * a store that can answer it. Building the projection from the *view's* state
 * rather than raw events means the row shape and the detail screen can never
 * disagree, and the view does the folding once.
 */
export class ApprovalIndex extends Domain.Projection("ApprovalIndex", {
  from: [ApprovalDetail],
  key: TenantId,
  keyOf: {
    ApprovalDetail: ({ state }) => state?.tenantId,
  },
  on: [
    ApprovalRequested,
    ApprovalDecisionRecorded,
    ApprovalApproved,
    ApprovalRejected,
    ApprovalCancelled,
    ApprovalExpired,
    ApprovalConsumed,
  ],
}) {}

export const ApprovalIndexLive = ApprovalIndex.toLayer(
  Effect.gen(function* () {
    const store = yield* ApprovalIndexStore;

    return Effect.fn(function* (batch) {
      const rows = batch.flatMap((input) => {
        const detail = input.state;
        if (!detail) return [];

        return [
          {
            id: input.envelope.id,
            tenantId: detail.tenantId,
            action: detail.action,
            status: detail.status,
            requestedBy: detail.requestedBy,
            approvalsRequired: detail.approvalsRequired,
            approvalsReceived: detail.decisions.filter(
              (decision) => decision.decision === "approve",
            ).length,
            scopeType: detail.scopeType,
            scopeId: detail.scopeId,
            payloadSummary: detail.payloadSummary,
            expiresAt: detail.expiresAt,
            createdAt: detail.requestedAt,
            updatedAt: DateTime.toEpochMillis(input.envelope.at),
          },
        ];
      });

      yield* store.upsert(rows);
    });
  }),
  { batch: { size: 50, wait: "100 millis" } },
);
