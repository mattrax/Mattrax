/**
 * Every uploaded application/installer object a tenant may serve lives under
 * `a/<tenantId>/`. The trailing slash makes `a/org-1/` and `a/org-10/` distinct.
 *
 * Ownership is re-checked at each sink so a row written before this rule (or by
 * a bug) cannot reach another tenant's bytes.
 */
export const tenantApplicationObjectPrefix = (organizationId: string) => `a/${organizationId}/`;

export const isTenantApplicationObjectKey = (
  organizationId: string,
  key: string | null | undefined,
): key is string =>
  typeof key === "string" &&
  key.length > 0 &&
  key.startsWith(tenantApplicationObjectPrefix(organizationId));

export const policyApplicationPrefix = (tenantId: string, policyId: string) =>
  `p/${tenantId}/${policyId}`;

export const policyApplicationKey = (tenantId: string, policyId: string, sha256: string) =>
  `${policyApplicationPrefix(tenantId, policyId)}/${sha256}`;

export const applicationPrefix = (tenantId: string, applicationId: string) =>
  `a/${tenantId}/${applicationId}`;

export const applicationKey = (tenantId: string, applicationId: string, sha256: string) =>
  `${applicationPrefix(tenantId, applicationId)}/${sha256}`;
