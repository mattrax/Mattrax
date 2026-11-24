import { Schema } from "effect";

/**
 * Destructive actions that can be gated behind a second administrator.
 * Copied from `packages/enterprise-domain/src/approvals.ts` so the POC has the
 * same closed vocabulary as the real product.
 */
export const APPROVAL_ACTIONS = [
  "device.wipe",
  "tenant.delete",
  "tenant.export",
  "policy.delete",
  "script.run",
  "script.write",
  "backup.download",
  "api-token.create",
] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export const ApprovalAction = Schema.Literals(APPROVAL_ACTIONS);

export const ApprovalScopeType = Schema.Literals(["tenant", "group", "device"]);
export type ApprovalScopeType = typeof ApprovalScopeType.Type;

/** Only these actions name a device or group; the rest are tenant-wide. */
export const approvalActionSupportsScope = (action: ApprovalAction): boolean =>
  action === "device.wipe" || action === "script.run";

export const ApprovalStatus = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
]);
export type ApprovalStatus = typeof ApprovalStatus.Type;

export const ApprovalDecisionKind = Schema.Literals(["approve", "reject"]);
export type ApprovalDecisionKind = typeof ApprovalDecisionKind.Type;

export const APPROVAL_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
export const APPROVAL_MAX_REQUIRED = 10;
export const APPROVAL_MAX_NOTE_LENGTH = 500;
