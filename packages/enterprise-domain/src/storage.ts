export const policyApplicationPrefix = (tenantId: string, policyId: string) => `p/${tenantId}/${policyId}`;

export const policyApplicationKey = (tenantId: string, policyId: string, sha256: string) => `${policyApplicationPrefix(tenantId, policyId)}/${sha256}`;
