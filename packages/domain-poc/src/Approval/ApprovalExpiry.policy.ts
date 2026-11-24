import { DateTime, Duration, Effect } from "effect";
import { Domain } from "../domain.ts";
import { Approval } from "./Approval.aggregate.ts";
import { ApprovalRequested } from "./ApprovalRequested.command.ts";
import { ExpireApproval } from "./ExpireApproval.command.ts";

/**
 * Arm the deadline when a request is opened.
 *
 * The current implementation has to sweep expired rows and also treat expiry
 * as an observation on every read (`effectiveApprovalStatus`), because nothing
 * guarantees a sweep has run. Here the deadline is a durable scheduled
 * command: it fires even if no one reads the request, and `decide` still
 * refuses a decision after `expiresAt` so a clock skew cannot squeeze one in.
 */
export class ApprovalExpiry extends Domain.Policy("ApprovalExpiry", {
  from: Approval,
  on: [ApprovalRequested],
}) {}

export const ApprovalExpiryLive = ApprovalExpiry.toLayer(
  Effect.gen(function* () {
    const approvals = yield* Approval;

    return Effect.fn(function* ({ source, event, envelope }) {
      const remaining = Math.max(0, event.expiresAt - DateTime.toEpochMillis(envelope.at));

      yield* approvals.schedule(source, new ExpireApproval(), {
        commandId: "expiry:" + event.tenantId + ":" + String(envelope.id),
        after: Duration.millis(remaining),
      });
    });
  }),
);
