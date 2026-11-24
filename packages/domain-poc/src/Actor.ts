import { Schema } from "effect";

/**
 * The administrator making a request.
 *
 * This is the POC's stand-in for the values `requireTenant` builds in
 * `packages/enterprise-api/src/enterpriseHandlers.ts`: a signed-in account,
 * the tenant it is acting in, its built-in role and the permissions that role
 * resolved to. `credential` is true when the caller authenticated with an API
 * token rather than a browser session.
 */
export const TenantId = Schema.String.pipe(Schema.brand("TenantId"));
export type TenantId = typeof TenantId.Type;

export const AccountId = Schema.String.pipe(Schema.brand("AccountId"));
export type AccountId = typeof AccountId.Type;

export const ApprovalPermission = Schema.Literals(["approvals.read", "approvals.write"]);
export type ApprovalPermission = typeof ApprovalPermission.Type;

/** Ordered by authority: an owner can do everything an admin can. */
export const TenantRole = Schema.Literals(["owner", "admin", "auditor", "member"]);
export type TenantRole = typeof TenantRole.Type;

export const Actor = Schema.Struct({
  accountId: AccountId,
  tenantId: TenantId,
  role: TenantRole,
  permissions: Schema.Array(ApprovalPermission),
  /** An API token: it may request an approval, never decide one. */
  credential: Schema.Boolean,
});
export type Actor = typeof Actor.Type;

export const hasPermission = (actor: Actor, permission: ApprovalPermission): boolean =>
  actor.permissions.includes(permission);

export const isOwner = (actor: Actor): boolean => actor.role === "owner";

const ROLE_RANK: Record<TenantRole, number> = { owner: 3, admin: 2, auditor: 1, member: 0 };

export const roleSatisfies = (actor: Actor, required: TenantRole): boolean =>
  actor.role !== "member" ? ROLE_RANK[actor.role] >= ROLE_RANK[required] : required === "member";

/**
 * The extra approver requirement a policy can put on top of
 * `approvals.write`. Mirrors `approverEligibility` in the existing domain
 * package, including the fact that role requirements only understand built-in
 * roles (a custom role cannot claim to be an owner).
 */
export type ApproverEligibility =
  | "eligible"
  | "missing_permission"
  | "missing_role"
  | "unconfigured";

export const approverEligibility = (
  actor: Actor,
  requirement: { readonly approverPermission: string | null; readonly approverRole: string | null },
): ApproverEligibility => {
  if (requirement.approverPermission == null && requirement.approverRole == null)
    return "unconfigured";

  if (
    requirement.approverPermission != null &&
    !(actor.permissions as ReadonlyArray<string>).includes(requirement.approverPermission)
  )
    return "missing_permission";

  if (requirement.approverRole != null) {
    const role = requirement.approverRole;

    if (!Object.hasOwn(ROLE_RANK, role) || !roleSatisfies(actor, role as TenantRole))
      return "missing_role";
  }

  return "eligible";
};

export const approverEligibilityMessage = (
  eligibility: Exclude<ApproverEligibility, "eligible">,
  requirement: { readonly approverPermission: string | null; readonly approverRole: string | null },
): string => {
  switch (eligibility) {
    case "missing_permission":
      return "This approval needs the " + requirement.approverPermission + " permission.";
    case "missing_role":
      return "This approval needs the " + requirement.approverRole + " role.";
    case "unconfigured":
      return "This approval policy has no eligible approver configured.";
  }
};
