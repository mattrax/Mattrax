import {
  EnterpriseR2FileNotFound,
  EnterpriseR2InternalError,
} from "@mattrax/enterprise-domain";

export const policyApplicationPrefix = (tenantId: string, policyId: string) => `p/${tenantId}/${policyId}`;

export const policyApplicationKey = (tenantId: string, policyId: string, sha256: string) => `${policyApplicationPrefix(tenantId, policyId)}/${sha256}`;

export const sha256Hex = async (bytes: ArrayBuffer) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const toR2Error = (error: unknown) => {
  if (typeof error === "object" && error !== null && ((error as { _tag?: unknown })._tag === "EnterpriseR2FileNotFound" || (error as { _tag?: unknown })._tag === "EnterpriseR2InternalError")) return error as EnterpriseR2FileNotFound | EnterpriseR2InternalError;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "R2 operation failed";
  return new EnterpriseR2InternalError({ message });
};
