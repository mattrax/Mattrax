import { Schema } from "effect";
import { Domain } from "../domain.ts";
import { ApprovalStatus } from "./ApprovalAction.ts";

export class AlreadyRequested extends Domain.Rejection(
  "AlreadyRequested",
  {},
  { httpApiStatus: 409 },
) {}

/** The request is no longer pending (or is already consumed). */
export class ApprovalNotPending extends Domain.Rejection(
  "ApprovalNotPending",
  { status: ApprovalStatus },
  { httpApiStatus: 409 },
) {}

export class NotApproved extends Domain.Rejection(
  "NotApproved",
  { status: ApprovalStatus },
  { httpApiStatus: 409 },
) {}

export class ApprovalLapsed extends Domain.Rejection(
  "ApprovalLapsed",
  { expiresAt: Schema.Number },
  { httpApiStatus: 409, description: "The deadline passed before the request was decided." },
) {}

export class AlreadyDecided extends Domain.Rejection(
  "AlreadyDecided",
  {},
  { httpApiStatus: 409 },
) {}

export class SelfDecision extends Domain.Rejection(
  "SelfDecision",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class CredentialCannotDecide extends Domain.Rejection(
  "CredentialCannotDecide",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class ApproverNotEligible extends Domain.Rejection(
  "ApproverNotEligible",
  { reason: Schema.String },
  { httpApiStatus: 403 },
) {}

export class NoteTooLong extends Domain.Rejection(
  "NoteTooLong",
  { max: Schema.Int },
  { httpApiStatus: 400 },
) {}

export class NoteRequired extends Domain.Rejection("NoteRequired", {}, { httpApiStatus: 400 }) {}

export class NotRequester extends Domain.Rejection(
  "NotRequester",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class AlreadyConsumed extends Domain.Rejection(
  "AlreadyConsumed",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class PayloadMismatch extends Domain.Rejection(
  "PayloadMismatch",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}
