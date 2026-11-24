import { Schema } from "effect";
import { Domain } from "../domain.ts";
import { AccountId, TenantId } from "../Actor.ts";
import { ApprovalId } from "./Approval.id.ts";
import { AlreadyRequested } from "./Rejections.ts";
import {
  APPROVAL_MAX_REQUIRED,
  ApprovalAction,
  ApprovalScopeType,
  approvalActionSupportsScope,
} from "./ApprovalAction.ts";
import { Session } from "../Session.middleware.ts";

export class InvalidApprovalRequest extends Domain.Rejection(
  "InvalidApprovalRequest",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class ApprovalRequested extends Domain.Event("ApprovalRequested", {
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
}) {}

/**
 * Ask for a second administrator's signature.
 *
 * The requester and tenant come from the session, not the payload: a caller
 * can only open an approval as itself, in the tenant it is acting in.
 */
export class RequestApproval extends Domain.Command("RequestApproval", {
  target: ApprovalId,
  middleware: [Session],
  input: {
    action: ApprovalAction,
    policyId: Schema.String,
    scopeType: Schema.optional(ApprovalScopeType),
    scopeId: Schema.optional(Schema.NullOr(Schema.String)),
    approvalsRequired: Schema.optional(Schema.Int),
    approverPermission: Schema.optional(Schema.NullOr(Schema.String)),
    approverRole: Schema.optional(Schema.NullOr(Schema.String)),
    payloadHash: Schema.String,
    payloadSummary: Schema.optional(Schema.Unknown),
    /** Shortened in the demo so expiry is easy to watch. Defaults to 24 hours. */
    expiresInMs: Schema.optional(Schema.Int),
  },
  events: [ApprovalRequested],
  rejects: [InvalidApprovalRequest, AlreadyRequested],
  reply: { expiresAt: Schema.Number },
}) {}

export const requestApprovalProblem = (input: {
  readonly action: ApprovalAction;
  readonly scopeType: ApprovalScopeType;
  readonly approvalsRequired: number;
  readonly expiresInMs: number;
}): string | null => {
  if (input.approvalsRequired < 1 || input.approvalsRequired > APPROVAL_MAX_REQUIRED)
    return "An approval must need between 1 and " + APPROVAL_MAX_REQUIRED + " approvals.";

  if (!approvalActionSupportsScope(input.action) && input.scopeType !== "tenant")
    return "This action can only be scoped to the whole tenant.";

  if (input.expiresInMs <= 0) return "An approval must have a deadline.";

  return null;
};
