import { Schema } from "effect";
import { Domain } from "../domain.ts";
import { AccountId, TenantId } from "../Actor.ts";
import { ApprovalDecisionKind } from "./ApprovalAction.ts";

/** One approver's answer. Kept on every decision so history says who and why. */
export const ApprovalDecision = Schema.Struct({
  approverId: AccountId,
  decision: ApprovalDecisionKind,
  note: Schema.NullOr(Schema.String),
  at: Schema.Number,
});
export type ApprovalDecision = typeof ApprovalDecision.Type;

export class ApprovalDecisionRecorded extends Domain.Event("ApprovalDecisionRecorded", {
  tenantId: TenantId,
  approverId: AccountId,
  decision: ApprovalDecisionKind,
  note: Schema.NullOr(Schema.String),
  at: Schema.Number,
}) {}

export class ApprovalApproved extends Domain.Event("ApprovalApproved", {
  at: Schema.Number,
}) {}

export class ApprovalRejected extends Domain.Event("ApprovalRejected", {
  at: Schema.Number,
}) {}

export class ApprovalCancelled extends Domain.Event("ApprovalCancelled", {
  at: Schema.Number,
}) {}

export class ApprovalExpired extends Domain.Event("ApprovalExpired", {
  at: Schema.Number,
}) {}

export class ApprovalConsumed extends Domain.Event("ApprovalConsumed", {
  at: Schema.Number,
  payloadHash: Schema.String,
}) {}
