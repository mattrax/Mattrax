/**
 * `SecurityInfo` command-result parsing.
 *
 * Apple returns the payload under `QueryResponses.SecurityInfo`; some protocol
 * shims flatten it onto the response root. Both shapes are accepted. Only the
 * fields Mattrax escrows are normalised here — persistence (and sealing) lives
 * in `index.ts`.
 */

export type FileVaultStatus = "enabled" | "disabled" | "unknown";

export type SecurityInfoReport = {
  /** Raw recovery key/payload. Sealed before storage; never logged. */
  readonly recoveryKey?: string;
  readonly fileVaultStatus?: FileVaultStatus;
  readonly bootstrapTokenEscrowed?: boolean;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const BOOLEAN_TRUE = new Set(["enabled", "true", "yes", "on", "1"]);
const BOOLEAN_FALSE = new Set(["disabled", "false", "no", "off", "0"]);

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (BOOLEAN_TRUE.has(normalised)) return true;
    if (BOOLEAN_FALSE.has(normalised)) return false;
  }
  return undefined;
};

const fileVaultStatus = (value: unknown): FileVaultStatus | undefined => {
  const enabled = booleanValue(value);
  if (enabled !== undefined) return enabled ? "enabled" : "disabled";
  if (typeof value !== "string") return undefined;
  const normalised = value.trim().toLowerCase();
  if (normalised === "") return undefined;
  if (normalised.includes("unknown") || normalised.includes("not supported")) return "unknown";
  return "unknown";
};

/**
 * Recovery keys normally arrive as strings. CMS escrow payloads are binary
 * (`data` in the plist) and may decode to `Uint8Array`, `ArrayBuffer` or a
 * number array depending on the plist parser.
 */
const binaryText = (value: unknown): string | undefined => {
  if (typeof value === "string") return text(value);
  let bytes: Uint8Array | undefined;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (Array.isArray(value) && value.every((entry) => typeof entry === "number"))
    bytes = Uint8Array.from(value as number[]);
  if (!bytes || bytes.byteLength === 0) return undefined;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const SECURITY_INFO_CONTAINER = (queryResponses: unknown) => {
  const root = record(queryResponses);
  if (!root) return undefined;
  return record(root.SecurityInfo) ?? root;
};

/**
 * Pull the FileVault recovery key and escrow state out of a `CommandResult`.
 * Returns `undefined` when the response contains no `SecurityInfo` payload so
 * unrelated command results are ignored.
 */
export const parseSecurityInfo = (queryResponses: unknown): SecurityInfoReport | undefined => {
  const info = SECURITY_INFO_CONTAINER(queryResponses);
  if (!info) return undefined;

  const report: {
    -readonly [K in keyof SecurityInfoReport]: SecurityInfoReport[K];
  } = {};

  let recognised = false;

  const recoveryKey =
    binaryText(info.PersonalRecoveryKey) ??
    binaryText(info.FDE_RecoveryKey) ??
    binaryText(info.FDE_PersonalRecoveryKeyCMS);
  if (recoveryKey !== undefined) {
    report.recoveryKey = recoveryKey;
    recognised = true;
  }

  const fde = fileVaultStatus(info.FDE_Enabled) ?? fileVaultStatus(info.FileVaultStatus);
  if (fde !== undefined) {
    report.fileVaultStatus = fde;
    recognised = true;
  }

  const bootstrap = booleanValue(info.BootstrapTokenEscrowed);
  if (bootstrap !== undefined) {
    report.bootstrapTokenEscrowed = bootstrap;
    recognised = true;
  }

  return recognised ? report : undefined;
};
