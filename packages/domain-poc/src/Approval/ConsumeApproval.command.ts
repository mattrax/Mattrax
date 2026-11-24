import { Schema } from "effect";
import { Domain } from "../domain.ts";
import {
  AlreadyConsumed,
  ApprovalLapsed,
  NotApproved,
  NotRequester,
  PayloadMismatch,
} from "./Rejections.ts";
import { NotFound } from "../Errors.ts";
import { ApprovalId } from "./Approval.id.ts";
import { Session } from "../Session.middleware.ts";
import { ApprovalConsumed } from "./Approval.events.ts";

/**
 * Spend an approval on the action it was granted for. Single-use, bound to the
 * payload hash and to the administrator who requested it, and only valid
 * before its deadline — the four checks the current `requireApproval` makes
 * with a conditional UPDATE.
 */
export class ConsumeApproval extends Domain.Command("ConsumeApproval", {
  target: ApprovalId,
  middleware: [Session],
  input: { payloadHash: Schema.String },
  events: [ApprovalConsumed],
  rejects: [ApprovalLapsed, NotFound, NotApproved, AlreadyConsumed, NotRequester, PayloadMismatch],
  reply: { consumedAt: Schema.Number },
}) {}
