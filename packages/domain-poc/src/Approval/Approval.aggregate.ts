import { DateTime, Effect, Schema } from "effect";
import { Domain } from "../domain.ts";
import {
  AccountId,
  TenantId,
  approverEligibility,
  approverEligibilityMessage,
  hasPermission,
} from "../Actor.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { NotFound } from "../Errors.ts";
import { approvalStatusOf } from "./Approval.rules.ts";
import { ApprovalId } from "./Approval.id.ts";
import {
  ApprovalDecision,
  ApprovalApproved,
  ApprovalCancelled,
  ApprovalConsumed,
  ApprovalDecisionRecorded,
  ApprovalExpired,
  ApprovalRejected,
} from "./Approval.events.ts";
import {
  AlreadyConsumed,
  AlreadyDecided,
  AlreadyRequested,
  ApprovalLapsed,
  ApprovalNotPending,
  ApproverNotEligible,
  CredentialCannotDecide,
  NoteRequired,
  NoteTooLong,
  NotApproved,
  NotRequester,
  PayloadMismatch,
  SelfDecision,
} from "./Rejections.ts";
import {
  APPROVAL_MAX_NOTE_LENGTH,
  APPROVAL_REQUEST_TTL_MS,
  ApprovalAction,
  ApprovalScopeType,
} from "./ApprovalAction.ts";
import {
  ApprovalRequested,
  InvalidApprovalRequest,
  RequestApproval,
  requestApprovalProblem,
} from "./ApprovalRequested.command.ts";
import { ApproveApproval } from "./ApproveApproval.command.ts";
import { RejectApproval } from "./RejectApproval.command.ts";
import { CancelApproval } from "./CancelApproval.command.ts";
import { ExpireApproval } from "./ExpireApproval.command.ts";
import { ConsumeApproval } from "./ConsumeApproval.command.ts";

/**
 * The fields every state after the request carries. They are copied into
 * events as well, so a policy or projection can read one event and know the
 * whole request without asking the aggregate what its state was.
 */
const Requested = Schema.Struct({
  tenantId: TenantId,
  action: ApprovalAction,
  policyId: Schema.String,
  scopeType: ApprovalScopeType,
  scopeId: Schema.NullOr(Schema.String),
  requestedBy: AccountId,
  approvalsRequired: Schema.Int,
  approverPermission: Schema.NullOr(Schema.String),
  approverRole: Schema.NullOr(Schema.String),
  payloadHash: Schema.String,
  payloadSummary: Schema.Unknown,
  expiresAt: Schema.Number,
  requestedAt: Schema.Number,
  decisions: Schema.Array(ApprovalDecision),
});

export const ApprovalState = Schema.Union([
  Schema.TaggedStruct("Unrequested", {}),
  Schema.TaggedStruct("Pending", Requested.fields),
  Schema.TaggedStruct("Approved", {
    ...Requested.fields,
    approvedAt: Schema.Number,
    consumedAt: Schema.NullOr(Schema.Number),
  }),
  Schema.TaggedStruct("Rejected", { ...Requested.fields, closedAt: Schema.Number }),
  Schema.TaggedStruct("Expired", { ...Requested.fields, closedAt: Schema.Number }),
  Schema.TaggedStruct("Cancelled", { ...Requested.fields, closedAt: Schema.Number }),
]);
export type ApprovalState = typeof ApprovalState.Type;

const nowMs = (now: DateTime.Utc): number => DateTime.toEpochMillis(now);

const cleanNote = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class Approval extends Domain.Aggregate("Approval", {
  id: ApprovalId,
  state: ApprovalState,
  initial: { _tag: "Unrequested" },
  commands: [
    RequestApproval,
    ApproveApproval,
    RejectApproval,
    CancelApproval,
    ExpireApproval,
    ConsumeApproval,
  ],
  decide: {
    RequestApproval: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;

      if (state._tag !== "Unrequested") return yield* new AlreadyRequested();

      const scopeType = cmd.scopeType ?? "tenant";
      const approvalsRequired = cmd.approvalsRequired ?? 1;
      const expiresInMs = cmd.expiresInMs ?? APPROVAL_REQUEST_TTL_MS;
      const problem = requestApprovalProblem({
        action: cmd.action,
        scopeType,
        approvalsRequired,
        expiresInMs,
      });

      if (problem) return yield* new InvalidApprovalRequest({ message: problem });

      const at = nowMs(ctx.now);
      return [
        new ApprovalRequested({
          tenantId: actor.tenantId,
          action: cmd.action,
          policyId: cmd.policyId,
          scopeType,
          scopeId: cmd.scopeId ?? null,
          requestedBy: actor.accountId,
          approvalsRequired,
          approverPermission: cmd.approverPermission ?? null,
          approverRole: cmd.approverRole ?? null,
          payloadHash: cmd.payloadHash,
          payloadSummary: cmd.payloadSummary ?? {},
          expiresAt: at + expiresInMs,
          requestedAt: at,
        }),
      ];
    }),
    ApproveApproval: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      if (state._tag !== "Pending")
        return yield* new ApprovalNotPending({ status: approvalStatusOf(state) });
      const at = nowMs(ctx.now);
      if (at >= state.expiresAt) return yield* new ApprovalLapsed({ expiresAt: state.expiresAt });
      if (state.tenantId !== actor.tenantId)
        return yield* new NotFound({ message: "Approval not found" });
      if (actor.credential)
        return yield* new CredentialCannotDecide({
          message: "API tokens cannot approve requests. Sign in to decide.",
        });
      if (state.requestedBy === actor.accountId)
        return yield* new SelfDecision({ message: "You cannot approve your own request." });
      if (state.decisions.some((decision) => decision.approverId === actor.accountId))
        return yield* new AlreadyDecided();
      if (!hasPermission(actor, "approvals.write"))
        return yield* new ApproverNotEligible({
          reason: "This approval needs the approvals.write permission.",
        });

      const requirement = {
        approverPermission: state.approverPermission,
        approverRole: state.approverRole,
      };
      const eligibility = approverEligibility(actor, requirement);
      if (eligibility !== "eligible" && eligibility !== "unconfigured")
        return yield* new ApproverNotEligible({
          reason: approverEligibilityMessage(eligibility, requirement),
        });

      const note = cleanNote(cmd.note);
      if (note != null && note.length > APPROVAL_MAX_NOTE_LENGTH)
        return yield* new NoteTooLong({ max: APPROVAL_MAX_NOTE_LENGTH });

      const received =
        state.decisions.filter((decision) => decision.decision === "approve").length + 1;
      const events = [
        new ApprovalDecisionRecorded({
          tenantId: state.tenantId,
          approverId: actor.accountId,
          decision: "approve" as const,
          note,
          at,
        }),
      ];

      return received >= state.approvalsRequired
        ? [...events, new ApprovalApproved({ at })]
        : events;
    }),
    RejectApproval: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      if (state._tag !== "Pending")
        return yield* new ApprovalNotPending({ status: approvalStatusOf(state) });
      const at = nowMs(ctx.now);
      if (at >= state.expiresAt) return yield* new ApprovalLapsed({ expiresAt: state.expiresAt });
      if (state.tenantId !== actor.tenantId)
        return yield* new NotFound({ message: "Approval not found" });
      if (actor.credential)
        return yield* new CredentialCannotDecide({
          message: "API tokens cannot reject requests. Sign in to decide.",
        });
      if (state.requestedBy === actor.accountId)
        return yield* new SelfDecision({
          message: "You cannot reject your own request. Cancel it instead.",
        });
      if (state.decisions.some((decision) => decision.approverId === actor.accountId))
        return yield* new AlreadyDecided();
      if (!hasPermission(actor, "approvals.write"))
        return yield* new ApproverNotEligible({
          reason: "This approval needs the approvals.write permission.",
        });

      const requirement = {
        approverPermission: state.approverPermission,
        approverRole: state.approverRole,
      };
      const eligibility = approverEligibility(actor, requirement);
      if (eligibility !== "eligible" && eligibility !== "unconfigured")
        return yield* new ApproverNotEligible({
          reason: approverEligibilityMessage(eligibility, requirement),
        });

      const note = cleanNote(cmd.note);
      if (note == null) return yield* new NoteRequired();
      if (note.length > APPROVAL_MAX_NOTE_LENGTH)
        return yield* new NoteTooLong({ max: APPROVAL_MAX_NOTE_LENGTH });

      return [
        new ApprovalDecisionRecorded({
          tenantId: state.tenantId,
          approverId: actor.accountId,
          decision: "reject" as const,
          note,
          at,
        }),
        new ApprovalRejected({ at }),
      ];
    }),
    CancelApproval: Effect.fn(function* (state, _cmd, ctx) {
      const actor = yield* CurrentActor;
      if (state._tag !== "Pending")
        return yield* new ApprovalNotPending({ status: approvalStatusOf(state) });
      if (state.tenantId !== actor.tenantId)
        return yield* new NotFound({ message: "Approval not found" });
      if (state.requestedBy !== actor.accountId)
        return yield* new NotRequester({
          message: "Only the administrator who requested this approval can cancel it.",
        });
      return [new ApprovalCancelled({ at: nowMs(ctx.now) })];
    }),
    ExpireApproval: (state, _cmd, ctx) =>
      state._tag === "Pending" || state._tag === "Approved"
        ? [new ApprovalExpired({ at: nowMs(ctx.now) })]
        : [],
    ConsumeApproval: Effect.fn(function* (state, cmd, ctx) {
      const actor = yield* CurrentActor;
      if (state._tag !== "Approved")
        return yield* new NotApproved({ status: approvalStatusOf(state) });
      if (state.tenantId !== actor.tenantId)
        return yield* new NotFound({ message: "Approval not found" });
      if (state.consumedAt != null)
        return yield* new AlreadyConsumed({ message: "This approval has already been used." });
      if (nowMs(ctx.now) >= state.expiresAt)
        return yield* new ApprovalLapsed({ expiresAt: state.expiresAt });
      if (state.requestedBy !== actor.accountId)
        return yield* new NotRequester({
          message: "Only the administrator who requested this approval can use it.",
        });
      if (state.payloadHash !== cmd.payloadHash)
        return yield* new PayloadMismatch({
          message: "This approval was issued for a different request. Start a new approval.",
        });
      return [new ApprovalConsumed({ at: nowMs(ctx.now), payloadHash: cmd.payloadHash })];
    }),
  },
  evolve: {
    ApprovalRequested: (_state, event) => ({
      _tag: "Pending" as const,
      tenantId: event.tenantId,
      action: event.action,
      policyId: event.policyId,
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      requestedBy: event.requestedBy,
      approvalsRequired: event.approvalsRequired,
      approverPermission: event.approverPermission,
      approverRole: event.approverRole,
      payloadHash: event.payloadHash,
      payloadSummary: event.payloadSummary,
      expiresAt: event.expiresAt,
      requestedAt: event.requestedAt,
      decisions: [],
    }),
    ApprovalDecisionRecorded: (state, event) =>
      state._tag === "Unrequested"
        ? state
        : {
            ...state,
            decisions: [
              ...state.decisions,
              {
                approverId: event.approverId,
                decision: event.decision,
                note: event.note,
                at: event.at,
              },
            ],
          },
    ApprovalApproved: (state, event) =>
      state._tag === "Pending"
        ? { ...state, _tag: "Approved" as const, approvedAt: event.at, consumedAt: null }
        : state,
    ApprovalRejected: (state, event) =>
      state._tag === "Pending" || state._tag === "Approved"
        ? { ...state, _tag: "Rejected" as const, closedAt: event.at }
        : state,
    ApprovalCancelled: (state, event) =>
      state._tag === "Pending"
        ? { ...state, _tag: "Cancelled" as const, closedAt: event.at }
        : state,
    ApprovalExpired: (state, event) =>
      state._tag === "Pending" || state._tag === "Approved"
        ? { ...state, _tag: "Expired" as const, closedAt: event.at }
        : state,
    ApprovalConsumed: (state, event) =>
      state._tag === "Approved" ? { ...state, consumedAt: event.at } : state,
  },
  reply: {
    RequestApproval: (state) => ({ expiresAt: state._tag === "Unrequested" ? 0 : state.expiresAt }),
    ApproveApproval: (state) => ({
      status: approvalStatusOf(state),
      approvalsReceived:
        state._tag === "Unrequested"
          ? 0
          : state.decisions.filter((d) => d.decision === "approve").length,
      approvalsRequired: state._tag === "Unrequested" ? 0 : state.approvalsRequired,
    }),
    RejectApproval: (state) => ({ status: approvalStatusOf(state) }),
    CancelApproval: () => ({ status: "cancelled" as const }),
    ConsumeApproval: (state) => ({
      consumedAt: state._tag === "Approved" ? (state.consumedAt ?? 0) : 0,
    }),
  },
}) {}
