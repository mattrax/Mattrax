import { createSignal } from "solid-js";

export type ApprovalRetryInput = {
  /** The approved request to retry the original action with. */
  readonly approvalId?: string;
  /** Owner override; the server requires a non-empty reason. */
  readonly breakGlassReason?: string;
};

export type ApprovalHeaders = {
  readonly "x-mattrax-approval"?: string;
  readonly "x-mattrax-approval-break-glass"?: string;
};

/** The headers a replay (or break-glass run) adds to the original call. */
export const approvalHeaders = (input?: ApprovalRetryInput): ApprovalHeaders => ({
  ...(input?.approvalId ? { "x-mattrax-approval": input.approvalId } : {}),
  ...(input?.breakGlassReason ? { "x-mattrax-approval-break-glass": input.breakGlassReason } : {}),
});

export type ApprovalRetry = {
  readonly requestId: string;
  readonly action: string;
  /** Replays the original call with the approval context in the headers. */
  readonly retry: (input: ApprovalRetryInput) => Promise<void>;
};

/**
 * The browser's memory of an action that was stopped by a four-eyes policy.
 *
 * The retry closure replays the exact client call that produced the 403, so
 * "Retry with this approval" does not have to reconstruct the original payload
 * and cannot accidentally apply an approval to a different action. It lives
 * for the page session; after a reload the requester can re-run the action
 * once the approval is decided and the fresh 403 carries the approved status.
 */
const retries = new Map<string, ApprovalRetry>();

const [version, setVersion] = createSignal(0);

export const registerApprovalRetry = (entry: ApprovalRetry): void => {
  retries.set(entry.requestId, entry);
  setVersion((value) => value + 1);
};

export const approvalRetryFor = (requestId: string): ApprovalRetry | undefined => {
  // Read the signal so a component re-renders when a retry is registered
  // after the approvals page mounted.
  version();

  return retries.get(requestId);
};

export const clearApprovalRetry = (requestId: string): void => {
  if (!retries.delete(requestId)) return;

  setVersion((value) => value + 1);
};

/** A gated endpoint stopped before execution and named the request to wait on. */
export class ApprovalRequiredError extends Error {
  readonly requestId: string;
  readonly status: "pending" | "approved";

  constructor(input: { message: string; requestId: string; status: "pending" | "approved" }) {
    super(input.message);
    this.name = "ApprovalRequiredError";
    this.requestId = input.requestId;
    this.status = input.status;
  }
}
