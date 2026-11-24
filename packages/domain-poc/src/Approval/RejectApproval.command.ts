import { Schema } from "effect";
import { Domain } from "../domain.ts";
import {
  AlreadyDecided,
  ApprovalLapsed,
  ApprovalNotPending,
  ApproverNotEligible,
  CredentialCannotDecide,
  NoteRequired,
  NoteTooLong,
  SelfDecision,
} from "./Rejections.ts";
import { NotFound } from "../Errors.ts";
import { ApprovalId } from "./Approval.id.ts";
import { Session } from "../Session.middleware.ts";
import { ApprovalDecisionRecorded, ApprovalRejected } from "./Approval.events.ts";

/** A rejection is final and needs a reason, so the requester learns why. */
export class RejectApproval extends Domain.Command("RejectApproval", {
  target: ApprovalId,
  middleware: [Session],
  input: { note: Schema.String },
  events: [ApprovalDecisionRecorded, ApprovalRejected],
  rejects: [
    ApprovalNotPending,
    ApprovalLapsed,
    NotFound,
    SelfDecision,
    CredentialCannotDecide,
    AlreadyDecided,
    ApproverNotEligible,
    NoteTooLong,
    NoteRequired,
  ],
  reply: { status: Schema.String },
}) {}
