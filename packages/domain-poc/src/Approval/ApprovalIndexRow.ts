import { Schema } from "effect";
import { ApprovalAction, ApprovalScopeType, ApprovalStatus } from "./ApprovalAction.ts";

/** One row of the approvals queue's store, and one entry of a query page. */
export const ApprovalIndexRow = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  action: ApprovalAction,
  status: ApprovalStatus,
  requestedBy: Schema.String,
  approvalsRequired: Schema.Int,
  approvalsReceived: Schema.Int,
  scopeType: ApprovalScopeType,
  scopeId: Schema.NullOr(Schema.String),
  payloadSummary: Schema.Unknown,
  expiresAt: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type ApprovalIndexRow = typeof ApprovalIndexRow.Type;
