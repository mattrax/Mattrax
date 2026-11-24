import { Schema } from "effect";
import { Domain } from "../domain.ts";
import { ApprovalNotPending, NotRequester } from "./Rejections.ts";
import { NotFound } from "../Errors.ts";
import { ApprovalId } from "./Approval.id.ts";
import { Session } from "../Session.middleware.ts";
import { ApprovalCancelled } from "./Approval.events.ts";

/** Only the administrator who opened a request may withdraw it. */
export class CancelApproval extends Domain.Command("CancelApproval", {
  target: ApprovalId,
  middleware: [Session],
  events: [ApprovalCancelled],
  rejects: [ApprovalNotPending, NotFound, NotRequester],
  reply: { status: Schema.Literal("cancelled") },
}) {}
