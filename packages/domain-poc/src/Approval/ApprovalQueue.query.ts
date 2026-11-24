import { Effect, Schema } from "effect";
import { Domain } from "../domain.ts";
import { hasPermission } from "../Actor.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { ApprovalForbidden } from "../Errors.ts";
import { Session } from "../Session.middleware.ts";
import { ApprovalStatus } from "./ApprovalAction.ts";
import { ApprovalIndex } from "./ApprovalIndex.projection.ts";
import { ApprovalIndexRow } from "./ApprovalIndexRow.ts";
import { ApprovalIndexStore } from "./ApprovalIndexStore.ts";

/**
 * The approvals queue: every request in the caller's tenant, newest first,
 * filtered by status. Paged by keyset, never offset, so a request created
 * between two pages is neither skipped nor repeated.
 */
export class ApprovalQueue extends Domain.Query("ApprovalQueue", {
  input: {
    statuses: Schema.optional(Schema.Array(ApprovalStatus)),
    mine: Schema.optional(Schema.Boolean),
  },
  success: ApprovalIndexRow,
  paged: true,
  waitsFor: [ApprovalIndex],
  middleware: [Session],
  rejects: [ApprovalForbidden],
}) {}

export const ApprovalQueueLive = ApprovalQueue.toLayer(
  Effect.gen(function* () {
    const store = yield* ApprovalIndexStore;

    return Effect.fn(function* ({ statuses, mine }, page) {
      const actor = yield* CurrentActor;

      if (!hasPermission(actor, "approvals.read") && mine !== true)
        return yield* new ApprovalForbidden({
          message: "Your role does not include the approvals.read permission.",
        });

      return yield* store.forTenant(
        actor.tenantId,
        {
          statuses,
          requestedBy: mine === true ? actor.accountId : undefined,
        },
        page,
      );
    });
  }),
  { take: { default: 20, max: 100 } },
);
