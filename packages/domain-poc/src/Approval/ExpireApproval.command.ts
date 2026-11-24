import { Domain } from "../domain.ts";
import { ApprovalId } from "./Approval.id.ts";
import { ApprovalExpired } from "./Approval.events.ts";

/**
 * The deadline. Sent by `ApprovalExpiry` durably at `expiresAt`, replacing the
 * current code's sweep plus read-time observation.
 *
 * Never rejects: a scheduled command has to be safe to run after the approval
 * was already decided or cancelled, and this command's answer in that case is
 * simply "nothing happened".
 */
export class ExpireApproval extends Domain.Command("ExpireApproval", {
  target: ApprovalId,
  events: [ApprovalExpired],
}) {}
