export const policyApplicationPrefix = (tenantId: string, policyId: string) =>
  `p/${tenantId}/${policyId}`;

export const policyApplicationKey = (tenantId: string, policyId: string, sha256: string) =>
  `${policyApplicationPrefix(tenantId, policyId)}/${sha256}`;

export const applicationPrefix = (tenantId: string, applicationId: string) =>
  `a/${tenantId}/${applicationId}`;

export const applicationKey = (tenantId: string, applicationId: string, sha256: string) =>
  `${applicationPrefix(tenantId, applicationId)}/${sha256}`;
