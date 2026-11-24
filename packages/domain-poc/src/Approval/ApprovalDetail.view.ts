import { Effect, Schema } from "effect";
import { Domain } from "../domain.ts";
import { AccountId, TenantId, hasPermission } from "../Actor.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { ApprovalForbidden } from "../Errors.ts";
import { Session } from "../Session.middleware.ts";
import { Approval } from "./Approval.aggregate.ts";
import { ApprovalDecision } from "./Approval.events.ts";
import { ApprovalAction, ApprovalScopeType, ApprovalStatus } from "./ApprovalAction.ts";

/**
 * What one administrator may see about a request.
 *
 * This is the read side of the aggregate: the commit does not update it, the
 * platform delivers the events after the commit. A caller that has just sent a
 * command can pass `atLeast` to wait for its own event, which is how the API
 * avoids the read-after-write race the current SQL version has to reason about
 * in every handler.
 */
export class ApprovalDetail extends Domain.View("ApprovalDetail", {
  from: [Approval],
  key: Approval,
  middleware: [Session],
  rejects: [ApprovalForbidden],
  state: Schema.Struct({
    tenantId: TenantId,
    action: ApprovalAction,
    policyId: Schema.String,
    scopeType: ApprovalScopeType,
    scopeId: Schema.NullOr(Schema.String),
    requestedBy: AccountId,
    status: ApprovalStatus,
    approvalsRequired: Schema.Int,
    approverPermission: Schema.NullOr(Schema.String),
    approverRole: Schema.NullOr(Schema.String),
    payloadHash: Schema.String,
    payloadSummary: Schema.Unknown,
    decisions: Schema.Array(ApprovalDecision),
    expiresAt: Schema.Number,
    requestedAt: Schema.Number,
    approvedAt: Schema.NullOr(Schema.Number),
    consumedAt: Schema.NullOr(Schema.Number),
    closedAt: Schema.NullOr(Schema.Number),
  }),
  initial: {
    tenantId: "" as TenantId,
    action: "device.wipe" as const,
    policyId: "",
    scopeType: "tenant" as const,
    scopeId: null,
    requestedBy: "" as AccountId,
    status: "pending" as const,
    approvalsRequired: 0,
    approverPermission: null,
    approverRole: null,
    payloadHash: "",
    payloadSummary: {},
    decisions: [],
    expiresAt: 0,
    requestedAt: 0,
    approvedAt: null,
    consumedAt: null,
    closedAt: null,
  },
  evolve: {
    ApprovalRequested: (_detail, event) => ({
      tenantId: event.tenantId,
      action: event.action,
      policyId: event.policyId,
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      requestedBy: event.requestedBy,
      status: "pending" as const,
      approvalsRequired: event.approvalsRequired,
      approverPermission: event.approverPermission,
      approverRole: event.approverRole,
      payloadHash: event.payloadHash,
      payloadSummary: event.payloadSummary,
      decisions: [],
      expiresAt: event.expiresAt,
      requestedAt: event.requestedAt,
      approvedAt: null,
      consumedAt: null,
      closedAt: null,
    }),
    ApprovalDecisionRecorded: (detail, event) => ({
      ...detail,
      decisions: [
        ...detail.decisions,
        { approverId: event.approverId, decision: event.decision, note: event.note, at: event.at },
      ],
    }),
    ApprovalApproved: (detail, event) => ({
      ...detail,
      status: "approved" as const,
      approvedAt: event.at,
    }),
    ApprovalRejected: (detail, event) => ({
      ...detail,
      status: "rejected" as const,
      closedAt: event.at,
    }),
    ApprovalCancelled: (detail, event) => ({
      ...detail,
      status: "cancelled" as const,
      closedAt: event.at,
    }),
    ApprovalExpired: (detail, event) => ({
      ...detail,
      status: "expired" as const,
      closedAt: event.at,
    }),
    ApprovalConsumed: (detail, event) => ({ ...detail, consumedAt: event.at }),
  },
}) {}

/**
 * Authorize every read, including every change while it is watched. The
 * requester always sees their own request; anyone else needs
 * `approvals.read`. A cross-tenant key is refused rather than reported
 * missing, because the view is reached by an id the caller must already know.
 */
export const ApprovalDetailLive = ApprovalDetail.toLayer(
  Effect.succeed(
    Effect.fn(function* (_request, detail) {
      if (detail == null) return;
      const actor = yield* CurrentActor;

      if (detail.tenantId !== actor.tenantId)
        return yield* new ApprovalForbidden({
          message: "This approval belongs to another tenant.",
        });

      if (detail.requestedBy !== actor.accountId && !hasPermission(actor, "approvals.read"))
        return yield* new ApprovalForbidden({
          message: "Your role does not include the approvals.read permission.",
        });
    }),
  ),
);
