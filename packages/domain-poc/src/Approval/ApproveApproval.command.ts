import { Schema } from "effect";
import { Domain } from "../domain.ts";
import {
  AlreadyDecided,
  ApprovalLapsed,
  ApprovalNotPending,
  ApproverNotEligible,
  CredentialCannotDecide,
  NoteTooLong,
  SelfDecision,
} from "./Rejections.ts";
import { NotFound } from "../Errors.ts";
import { ApprovalId } from "./Approval.id.ts";
import { Session } from "../Session.middleware.ts";
import { ApprovalApproved, ApprovalDecisionRecorded } from "./Approval.events.ts";

/**
 * Record one approver's signature. The request becomes approved as soon as the
 * number of approvals reaches its policy's requirement, in the same commit, so
 * two approvers can never leave it one short.
 */
export class ApproveApproval extends Domain.Command("ApproveApproval", {
  target: ApprovalId,
  middleware: [Session],
  input: { note: Schema.optional(Schema.String) },
  events: [ApprovalDecisionRecorded, ApprovalApproved],
  rejects: [
    ApprovalNotPending,
    ApprovalLapsed,
    NotFound,
    SelfDecision,
    CredentialCannotDecide,
    AlreadyDecided,
    ApproverNotEligible,
    NoteTooLong,
  ],
  reply: {
    status: Schema.String,
    approvalsReceived: Schema.Int,
    approvalsRequired: Schema.Int,
  },
}) {}
