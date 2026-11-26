import { Schema } from "effect";
import { BUILT_IN_TENANT_ROLES } from "./rbac.js";
import type { BuiltInTenantRole } from "./rbac.js";

/**
 * Destructive actions that can be gated behind a second administrator.
 *
 * The list is intentionally closed: a policy names one of these values, so a
 * policy cannot quietly start applying to an action nobody reviewed. Adding an
 * action here is a deliberate product decision.
 */
export const APPROVAL_ACTIONS = [
  "device.wipe",
  "device.fresh-start",
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

export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  "device.wipe": "Wipe a device",
  "device.fresh-start": "Run Windows Fresh Start",
  "tenant.delete": "Delete the tenant",
  "tenant.export": "Export tenant data",
  "policy.delete": "Delete policies or restore a backup",
  "script.run": "Run a script",
  "script.write": "Create or change a script",
  "backup.download": "Download a tenant backup",
  "api-token.create": "Create an API token",
};

/** A policy can cover the whole tenant or a single group/device target. */
export const APPROVAL_SCOPE_TYPES = ["tenant", "group", "device"] as const;

export type ApprovalScopeType = (typeof APPROVAL_SCOPE_TYPES)[number];

export const ApprovalScopeType = Schema.Literals(APPROVAL_SCOPE_TYPES);

/**
 * Actions whose request names devices or groups. Other actions can only be
 * scoped to the whole tenant; the API rejects a narrower scope for them rather
 * than silently ignoring it.
 */
export const APPROVAL_SCOPED_ACTIONS: ReadonlySet<ApprovalAction> = new Set([
  "device.wipe",
  "device.fresh-start",
  "script.run",
]);

export const approvalActionSupportsScope = (action: ApprovalAction): boolean =>
  APPROVAL_SCOPED_ACTIONS.has(action);

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ApprovalStatus = Schema.Literals(APPROVAL_STATUSES);

export const APPROVAL_DECISIONS = ["approve", "reject"] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const ApprovalDecision = Schema.Literals(APPROVAL_DECISIONS);

/**
 * A request is usable for exactly 24 hours. The window has to be long enough
 * for a colleague in another timezone to answer and short enough that a stolen
 * session cannot wait for a forgotten approval; execution enforces the same
 * deadline as the read path.
 */
export const APPROVAL_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum number of distinct approvals a policy can ask for. */
export const APPROVAL_MAX_REQUIRED = 10;

const APPROVAL_TRANSITIONS: Record<ApprovalStatus, ReadonlyArray<ApprovalStatus>> = {
  pending: ["approved", "rejected", "expired", "cancelled"],
  // Approval is a bounded window, not a permanent capability. An approved
  // request that nobody uses before its deadline expires like a pending one.
  approved: ["expired"],
  rejected: [],
  expired: [],
  cancelled: [],
};

export const approvalTransitionAllowed = (from: ApprovalStatus, to: ApprovalStatus): boolean =>
  APPROVAL_TRANSITIONS[from].includes(to);

const approvalDeadlinePassed = (row: { readonly expiresAt: Date | string }, now: Date): boolean => {
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);

  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime();
};

/**
 * The status a row effectively has at `now`. Expiry is an observation, not
 * only a stored flag: a request past its deadline is expired even if no sweep
 * has run.
 */
export const effectiveApprovalStatus = (
  row: { readonly status: ApprovalStatus; readonly expiresAt: Date | string },
  now: Date,
): ApprovalStatus => {
  if ((row.status === "pending" || row.status === "approved") && approvalDeadlinePassed(row, now))
    return "expired";

  return row.status;
};

/** An approval can run the gated action once, before its deadline. */
export const isApprovalUsable = (
  row: {
    readonly status: ApprovalStatus;
    readonly expiresAt: Date | string;
    readonly consumedAt: Date | string | null;
  },
  now: Date,
): boolean =>
  row.status === "approved" && row.consumedAt == null && !approvalDeadlinePassed(row, now);

/**
 * Canonical JSON for payload binding.
 *
 * Object keys are sorted recursively and `undefined` members are dropped, so
 * two payloads that mean the same thing produce the same bytes. Arrays keep
 * their order: argument order is meaningful, and callers that want a set sort
 * it themselves (`approvalPayloadBinding` does that for `targets`).
 */
export const canonicalJson = (value: Schema.Json): string => {
  const canonical = (input: Schema.Json): Schema.Json => {
    if (Array.isArray(input)) return input.map((item) => canonical(item));

    if (input !== null && typeof input === "object") {
      const source = input as { readonly [key: string]: Schema.Json };
      const output: { [key: string]: Schema.Json } = {};

      for (const key of Object.keys(source).sort()) {
        const member = source[key];

        if (member !== undefined) output[key] = canonical(member);
      }

      return output;
    }

    return input;
  };

  return JSON.stringify(canonical(value));
};

export const ApprovalPayloadBinding = Schema.Struct({
  action: ApprovalAction,
  /** The policy the caller must be following. */
  policyId: Schema.String,
  /** The single resource the action names, when it has one. */
  resourceId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Every device the action will touch, in canonical (sorted) order. */
  targets: Schema.Array(Schema.String),
  /**
   * Metadata that distinguishes variants of the same action, such as script
   * arguments or API-token scopes. Never put a secret here: the summary is
   * stored and shown to approvers.
   */
  details: Schema.optional(Schema.Json),
});

export type ApprovalPayloadBinding = typeof ApprovalPayloadBinding.Type;

/** Build the canonical binding, deduplicating and sorting the device targets. */
export const approvalPayloadBinding = (input: {
  readonly action: ApprovalAction;
  readonly policyId: string;
  readonly resourceId?: string | null;
  readonly targets?: ReadonlyArray<string>;
  readonly details?: Schema.Json;
}): ApprovalPayloadBinding => ({
  action: input.action,
  policyId: input.policyId,
  resourceId: input.resourceId ?? null,
  targets: [...new Set(input.targets ?? [])].sort(),
  ...(input.details === undefined ? {} : { details: input.details }),
});

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 of any JSON value after canonicalisation (stable key order). */
export const hashCanonicalJson = async (value: Schema.Json): Promise<string> => {
  const encoded = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return hex(new Uint8Array(digest));
};

/**
 * SHA-256 of the canonical binding. The digest, never the payload, is stored
 * on the request; the server recomputes it from the retried request so an
 * approval cannot be reused for different devices, arguments, policy or
 * credential scope.
 */
export const approvalPayloadHash = (binding: ApprovalPayloadBinding): Promise<string> =>
  hashCanonicalJson(binding);

/** The resource targets a request names, used to match scoped policies. */
export type ApprovalTarget = {
  readonly deviceIds: ReadonlyArray<string>;
  readonly groupIds: ReadonlyArray<string>;
};

export const emptyApprovalTarget: ApprovalTarget = { deviceIds: [], groupIds: [] };

const policyMatchesTarget = (
  policy: { readonly scopeType: ApprovalScopeType; readonly scopeId: string | null },
  target: ApprovalTarget,
): boolean => {
  if (policy.scopeType === "tenant") return true;

  if (policy.scopeType === "device")
    return policy.scopeId != null && target.deviceIds.includes(policy.scopeId);

  return policy.scopeId != null && target.groupIds.includes(policy.scopeId);
};

const scopeRank = (scopeType: ApprovalScopeType): number =>
  scopeType === "device" ? 3 : scopeType === "group" ? 2 : 1;

export type ApprovalPolicyCandidate = {
  readonly id: string;
  readonly scopeType: ApprovalScopeType;
  readonly scopeId: string | null;
  readonly approvalsRequired: number;
  readonly createdAt: Date | string;
};

/**
 * Pick the policy that governs one request.
 *
 * The most specific scope wins (device, then group, then tenant), so a
 * tenant-wide default can be narrowed for a production group. When two policies
 * are equally specific, the one asking for more approvals wins; the newest
 * breaks a remaining tie. A stable winner matters because the policy id is part
 * of the payload binding.
 */
export const selectApprovalPolicy = <Policy extends ApprovalPolicyCandidate>(
  policies: ReadonlyArray<Policy>,
  target: ApprovalTarget,
): Policy | undefined => {
  const candidates = policies.filter((policy) => policyMatchesTarget(policy, target));

  if (candidates.length === 0) return undefined;

  const time = (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);

    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  };

  return [...candidates].sort((left, right) => {
    const specificity = scopeRank(right.scopeType) - scopeRank(left.scopeType);

    if (specificity !== 0) return specificity;

    const approvals = right.approvalsRequired - left.approvalsRequired;

    if (approvals !== 0) return approvals;

    const recency = time(right.createdAt) - time(left.createdAt);

    if (recency !== 0) return recency;

    return left.id.localeCompare(right.id);
  })[0];
};

export type ApprovalRequirement = {
  readonly approverPermission: string | null;
  readonly approverRole: string | null;
};

export type ApproverIdentity = {
  readonly permissions: ReadonlySet<string>;
  readonly role: string;
  readonly customRoleId?: string | null;
};

export type ApproverEligibility =
  | "eligible"
  | "missing_permission"
  | "missing_role"
  | "unconfigured";

const BUILT_IN_ROLE_RANK: Record<BuiltInTenantRole, number> = {
  auditor: 1,
  member: 1,
  admin: 2,
  owner: 3,
};

const roleNames = (role: string) =>
  role
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

/**
 * Built-in role requirements are a floor, not an exact match: an owner can
 * approve anything an administrator can. A custom role replaces the member's
 * built-in capabilities, so it never satisfies a built-in role requirement.
 */
export const approverRoleSatisfies = (
  member: { readonly role: string; readonly customRoleId?: string | null },
  required: BuiltInTenantRole,
): boolean => {
  if (member.customRoleId != null) return false;

  const rank = BUILT_IN_ROLE_RANK[required];

  return roleNames(member.role).some((name) => {
    if (!(name in BUILT_IN_ROLE_RANK)) return false;
    const actual = BUILT_IN_ROLE_RANK[name as BuiltInTenantRole];

    return actual >= rank;
  });
};

/**
 * Evaluate the policy requirement for one administrator. `approvals.write` is
 * enforced separately by the endpoint; this is the additional configured
 * requirement that narrows who may decide.
 */
export const approverEligibility = (
  approver: ApproverIdentity,
  requirement: ApprovalRequirement,
): ApproverEligibility => {
  if (requirement.approverPermission == null && requirement.approverRole == null)
    return "unconfigured";

  if (
    requirement.approverPermission != null &&
    !approver.permissions.has(requirement.approverPermission)
  )
    return "missing_permission";

  if (
    requirement.approverRole != null &&
    !(BUILT_IN_TENANT_ROLES as ReadonlyArray<string>).includes(requirement.approverRole)
  )
    return "missing_role";

  if (
    requirement.approverRole != null &&
    !approverRoleSatisfies(approver, requirement.approverRole as BuiltInTenantRole)
  )
    return "missing_role";

  return "eligible";
};

export const approvalEligibilityMessage = (
  eligibility: Exclude<ApproverEligibility, "eligible">,
  requirement: ApprovalRequirement,
): string => {
  switch (eligibility) {
    case "missing_permission":
      return ["This approval needs the", requirement.approverPermission, "permission."].join(" ");
    case "missing_role":
      return ["This approval needs the", requirement.approverRole, "role."].join(" ");
    case "unconfigured":
      return "This approval policy has no eligible approver configured.";
  }
};

export const ApprovalPolicy = Schema.Struct({
  id: Schema.String,
  action: ApprovalAction,
  scopeType: ApprovalScopeType,
  scopeId: Schema.optional(Schema.NullOr(Schema.String)),
  approverPermission: Schema.optional(Schema.NullOr(Schema.String)),
  approverRole: Schema.optional(Schema.NullOr(Schema.String)),
  approvalsRequired: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type ApprovalPolicy = typeof ApprovalPolicy.Type;

export const ApprovalPoliciesResponse = Schema.Struct({
  policies: Schema.Array(ApprovalPolicy),
});

export type ApprovalPoliciesResponse = typeof ApprovalPoliciesResponse.Type;

export const CreateApprovalPolicyRequest = Schema.Struct({
  action: ApprovalAction,
  scopeType: Schema.optional(ApprovalScopeType),
  scopeId: Schema.optional(Schema.NullOr(Schema.String)),
  approverPermission: Schema.optional(Schema.NullOr(Schema.String)),
  approverRole: Schema.optional(Schema.NullOr(Schema.String)),
  approvalsRequired: Schema.optional(Schema.Number),
});

export type CreateApprovalPolicyRequest = typeof CreateApprovalPolicyRequest.Type;

export const PatchApprovalPolicyRequest = Schema.Struct({
  scopeType: Schema.optional(ApprovalScopeType),
  scopeId: Schema.optional(Schema.NullOr(Schema.String)),
  approverPermission: Schema.optional(Schema.NullOr(Schema.String)),
  approverRole: Schema.optional(Schema.NullOr(Schema.String)),
  approvalsRequired: Schema.optional(Schema.Number),
});

export type PatchApprovalPolicyRequest = typeof PatchApprovalPolicyRequest.Type;

export const ApprovalDecisionInfo = Schema.Struct({
  id: Schema.String,
  approverAccountId: Schema.optional(Schema.NullOr(Schema.String)),
  approverEmail: Schema.optional(Schema.NullOr(Schema.String)),
  approverName: Schema.optional(Schema.NullOr(Schema.String)),
  decision: ApprovalDecision,
  note: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
});

export type ApprovalDecisionInfo = typeof ApprovalDecisionInfo.Type;

export const ApprovalRequestInfo = Schema.Struct({
  id: Schema.String,
  action: ApprovalAction,
  actionLabel: Schema.String,
  status: ApprovalStatus,
  policyId: Schema.optional(Schema.NullOr(Schema.String)),
  scopeType: ApprovalScopeType,
  scopeId: Schema.optional(Schema.NullOr(Schema.String)),
  requesterAccountId: Schema.optional(Schema.NullOr(Schema.String)),
  requesterEmail: Schema.optional(Schema.NullOr(Schema.String)),
  requesterName: Schema.optional(Schema.NullOr(Schema.String)),
  approvalsRequired: Schema.Number,
  approvalsReceived: Schema.Number,
  approverPermission: Schema.optional(Schema.NullOr(Schema.String)),
  approverRole: Schema.optional(Schema.NullOr(Schema.String)),
  payloadSummary: Schema.Json,
  decisions: Schema.Array(ApprovalDecisionInfo),
  breakGlass: Schema.Boolean,
  breakGlassReason: Schema.optional(Schema.NullOr(Schema.String)),
  canApprove: Schema.Boolean,
  canCancel: Schema.Boolean,
  requestedByMe: Schema.Boolean,
  expiresAt: Schema.String,
  consumedAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type ApprovalRequestInfo = typeof ApprovalRequestInfo.Type;

export const ApprovalRequestsResponse = Schema.Struct({
  requests: Schema.Array(ApprovalRequestInfo),
});

export type ApprovalRequestsResponse = typeof ApprovalRequestsResponse.Type;

export const ApprovalRequestQuery = Schema.Struct({
  status: Schema.optional(Schema.Literals(["pending", "decided", "all"])),
  mine: Schema.optional(Schema.Literals(["true", "false"])),
});

export type ApprovalRequestQuery = typeof ApprovalRequestQuery.Type;

export const ApproveApprovalRequest = Schema.Struct({
  note: Schema.optional(Schema.NullOr(Schema.String)),
});

export type ApproveApprovalRequest = typeof ApproveApprovalRequest.Type;

export const RejectApprovalRequest = Schema.Struct({
  note: Schema.String,
});

export type RejectApprovalRequest = typeof RejectApprovalRequest.Type;

/** Header a caller sends to retry a gated action with an approved request. */
export const APPROVAL_ID_HEADER = "x-mattrax-approval";

/** Header an owner sends to bypass approval, with a mandatory reason. */
export const APPROVAL_BREAK_GLASS_HEADER = "x-mattrax-approval-break-glass";

export const APPROVAL_MAX_NOTE_LENGTH = 2_000;

export const APPROVAL_MAX_REASON_LENGTH = 1_000;
