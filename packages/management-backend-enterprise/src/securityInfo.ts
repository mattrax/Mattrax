/**
 * `SecurityInfo` command-result parsing.
 *
 * Apple returns the payload under `QueryResponses.SecurityInfo`; some protocol
 * shims flatten it onto the response root. Both parents are accepted. Only the
 * fields Mattrax escrows are normalised here — persistence (and sealing) lives
 * in `index.ts`.
 */

import { Schema } from "effect";
import {
  isPlistArray,
  isPlistObject,
  plistStatusBoolean,
  plistText,
  type PlistInput,
  type PlistObject,
} from "./internal/plistValue.js";

export type FileVaultStatus = "enabled" | "disabled" | "unknown";

export type SecurityInfoReport = {
  /** Raw recovery key/payload. Sealed before storage; never logged. */
  readonly recoveryKey?: string;
  readonly fileVaultStatus?: FileVaultStatus;
  readonly bootstrapTokenEscrowed?: boolean;
};

const fileVaultStatus = (value: PlistInput): FileVaultStatus | undefined => {
  const enabled = plistStatusBoolean(value);

  if (enabled !== undefined) return enabled ? "enabled" : "disabled";

  if (!Schema.is(Schema.String)(value)) return undefined;
  const normalised = value.trim().toLowerCase();

  if (normalised === "") return undefined;

  return "unknown";
};

/**
 * Recovery keys normally arrive as strings. CMS escrow payloads are binary
 * (`data` in the plist) and may decode to `Uint8Array`, `ArrayBuffer` or a
 * number array depending on the plist parser.
 */
const binaryText = (value: PlistInput): string | undefined => {
  if (Schema.is(Schema.String)(value)) return plistText(value);
  let bytes: Uint8Array | undefined;

  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (isPlistArray(value)) {
    const numbers = value.filter((entry): entry is number => Schema.is(Schema.Number)(entry));

    if (numbers.length === value.length) bytes = Uint8Array.from(numbers);
  }

  if (!bytes || bytes.byteLength === 0) return undefined;
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const securityInfoContainer = (
  queryResponses: PlistInput,
): PlistObject | undefined => {
  if (!isPlistObject(queryResponses)) return undefined;

  const nested = queryResponses.SecurityInfo;

  return isPlistObject(nested) ? nested : queryResponses;
};

/**
 * Pull the FileVault recovery key and escrow state out of a `CommandResult`.
 * Returns `undefined` when the response contains no `SecurityInfo` payload so
 * unrelated command results are ignored.
 */
export const parseSecurityInfo = (
  queryResponses: PlistInput,
): SecurityInfoReport | undefined => {
  const info = securityInfoContainer(queryResponses);

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

  const bootstrap = plistStatusBoolean(info.BootstrapTokenEscrowed);

  if (bootstrap !== undefined) {
    report.bootstrapTokenEscrowed = bootstrap;
    recognised = true;
  }

  return recognised ? report : undefined;
};
