/**
 * `SecurityInfo` command-result parsing.
 *
 * Apple returns the payload under `QueryResponses.SecurityInfo`; some protocol
 * shims flatten it onto the response root. Both parents are accepted. Only the
 * fields Mattrax escrows are normalised here — persistence (and sealing) lives
 * in `index.ts`.
 *
 * The Activation Lock bypass code is *not* part of this payload: Apple returns
 * it from the separate `ActivationLockBypassCode` command. `SecurityInfo` only
 * reports whether Activation Lock is manageable for this enrolment.
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

/** How the device wrapped the personal recovery key. */
export type RecoveryKeyFormat = "plaintext" | "cms";

export type SecurityInfoReport = {
  /**
   * Raw recovery key/payload. Sealed before storage; never logged. `cms` means
   * the bytes are a CMS EnvelopedData payload that must be unwrapped with the
   * tenant escrow private key before an operator can use it.
   */
  readonly recoveryKey?: { readonly value: string; readonly format: RecoveryKeyFormat };
  readonly fileVaultStatus?: FileVaultStatus;
  readonly bootstrapTokenEscrowed?: boolean;
  /** `FDE_HasPersonalRecoveryKey`: FileVault holds a personal recovery key. */
  readonly fileVaultHasPersonalRecoveryKey?: boolean;
  /** `ManagementStatus.IsActivationLockManageable`. */
  readonly isActivationLockManageable?: boolean;
  /** `IsRecoveryLockEnabled` (Apple silicon, macOS 11.5+). */
  readonly isRecoveryLockEnabled?: boolean;
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

const securityInfoContainer = (queryResponses: PlistInput): PlistObject | undefined => {
  if (!isPlistObject(queryResponses)) return undefined;

  const nested = queryResponses.SecurityInfo;

  return isPlistObject(nested) ? nested : queryResponses;
};

const managementStatus = (info: PlistObject): PlistObject | undefined => {
  const status = info.ManagementStatus;

  return isPlistObject(status) ? status : undefined;
};

/**
 * Pull the FileVault recovery key and escrow state out of a `CommandResult`.
 * Returns `undefined` when the response contains no `SecurityInfo` payload so
 * unrelated command results are ignored.
 */
export const parseSecurityInfo = (queryResponses: PlistInput): SecurityInfoReport | undefined => {
  const info = securityInfoContainer(queryResponses);

  if (!info) return undefined;

  const report: {
    -readonly [K in keyof SecurityInfoReport]: SecurityInfoReport[K];
  } = {};

  let recognised = false;

  const cms = binaryText(info.FDE_PersonalRecoveryKeyCMS);

  if (cms !== undefined) {
    report.recoveryKey = { value: cms, format: "cms" };
    recognised = true;
  } else {
    const plaintext = binaryText(info.PersonalRecoveryKey) ?? binaryText(info.FDE_RecoveryKey);

    if (plaintext !== undefined) {
      report.recoveryKey = { value: plaintext, format: "plaintext" };
      recognised = true;
    }
  }

  const fde = fileVaultStatus(info.FDE_Enabled) ?? fileVaultStatus(info.FileVaultStatus);

  if (fde !== undefined) {
    report.fileVaultStatus = fde;
    recognised = true;
  }

  const hasPersonalKey = plistStatusBoolean(info.FDE_HasPersonalRecoveryKey);

  if (hasPersonalKey !== undefined) {
    report.fileVaultHasPersonalRecoveryKey = hasPersonalKey;
    recognised = true;
  }

  const bootstrap = plistStatusBoolean(info.BootstrapTokenEscrowed);

  if (bootstrap !== undefined) {
    report.bootstrapTokenEscrowed = bootstrap;
    recognised = true;
  }

  const activationLockManageable = plistStatusBoolean(
    managementStatus(info)?.IsActivationLockManageable,
  );

  if (activationLockManageable !== undefined) {
    report.isActivationLockManageable = activationLockManageable;
    recognised = true;
  }

  const recoveryLock = plistStatusBoolean(info.IsRecoveryLockEnabled);

  if (recoveryLock !== undefined) {
    report.isRecoveryLockEnabled = recoveryLock;
    recognised = true;
  }

  return recognised ? report : undefined;
};

/**
 * `ActivationLockBypassCode` returns the supervised device's bypass code at the
 * response root. Returns undefined for any other command result.
 */
export const parseActivationLockBypassCode = (queryResponses: PlistInput): string | undefined => {
  if (!isPlistObject(queryResponses)) return undefined;
  const code = queryResponses.ActivationLockBypassCode;

  if (!Schema.is(Schema.String)(code)) return undefined;
  const trimmed = code.trim();

  return trimmed.length > 0 ? trimmed : undefined;
};

/** `VerifyRecoveryLock` reports `<key>PasswordVerified</key><true/>`. */
export const parseRecoveryLockVerification = (queryResponses: PlistInput): boolean | undefined => {
  if (!isPlistObject(queryResponses)) return undefined;

  return plistStatusBoolean(queryResponses.PasswordVerified);
};

/**
 * `RotateFileVaultKey` returns `RotateResult.EncryptedNewRecoveryKey`, a new
 * personal recovery key wrapped as CMS data for the `ReplyEncryptionCertificate`
 * that Mattrax supplies.
 */
export const parseRotatedRecoveryKey = (
  queryResponses: PlistInput,
): { readonly value: string; readonly format: "cms" } | undefined => {
  if (!isPlistObject(queryResponses)) return undefined;
  const result = queryResponses.RotateResult;

  if (!isPlistObject(result)) return undefined;
  const encrypted = binaryText(result.EncryptedNewRecoveryKey);

  return encrypted ? { value: encrypted, format: "cms" } : undefined;
};
