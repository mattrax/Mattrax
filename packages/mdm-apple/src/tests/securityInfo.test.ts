import { describe, expect, it } from "vitest";
import {
  parseActivationLockBypassCode,
  parseRecoveryLockVerification,
  parseRotatedRecoveryKey,
  parseSecurityInfo,
} from "@mattrax/mdm-core";

describe("parseSecurityInfo", () => {
  it("reads the modern SecurityInfo response shape", () => {
    expect(
      parseSecurityInfo({
        SecurityInfo: {
          FDE_Enabled: true,
          FDE_HasPersonalRecoveryKey: true,
          FDE_PersonalRecoveryKeyCMS: "QUJDREVGRw==",
          BootstrapTokenEscrowed: false,
        },
      }),
    ).toEqual({
      // A CMS-wrapped key must be tagged so reveal can unwrap it.
      recoveryKey: { value: "QUJDREVGRw==", format: "cms" },
      fileVaultStatus: "enabled",
      fileVaultHasPersonalRecoveryKey: true,
      bootstrapTokenEscrowed: false,
    });
  });

  it("reads the legacy query keys and normalises FileVault state", () => {
    expect(
      parseSecurityInfo({
        SecurityInfo: {
          FileVaultStatus: "On",
          PersonalRecoveryKey: "AAAA-BBBB-CCCC-DDDD",
          BootstrapTokenEscrowed: true,
        },
      }),
    ).toEqual({
      recoveryKey: { value: "AAAA-BBBB-CCCC-DDDD", format: "plaintext" },
      fileVaultStatus: "enabled",
      bootstrapTokenEscrowed: true,
    });

    expect(
      parseSecurityInfo({
        SecurityInfo: { FileVaultStatus: "Off", FDE_RecoveryKey: "1111-2222" },
      }),
    ).toEqual({
      recoveryKey: { value: "1111-2222", format: "plaintext" },
      fileVaultStatus: "disabled",
    });

    expect(parseSecurityInfo({ SecurityInfo: { FileVaultStatus: "Unknown" } })).toEqual({
      fileVaultStatus: "unknown",
    });
  });

  it("accepts flattened responses and binary CMS payloads", () => {
    expect(
      parseSecurityInfo({
        FDE_RecoveryKey: "FLAT-KEY",
        FileVaultStatus: false,
        BootstrapTokenEscrowed: "yes",
      }),
    ).toEqual({
      recoveryKey: { value: "FLAT-KEY", format: "plaintext" },
      fileVaultStatus: "disabled",
      bootstrapTokenEscrowed: true,
    });
    expect(
      parseSecurityInfo({
        SecurityInfo: { FDE_PersonalRecoveryKeyCMS: Uint8Array.from([65, 66, 67]) },
      }),
    ).toEqual({ recoveryKey: { value: btoa("ABC"), format: "cms" } });
  });

  it("ignores responses without a SecurityInfo payload", () => {
    expect(parseSecurityInfo(undefined)).toBeUndefined();
    expect(parseSecurityInfo({ InstalledApplicationList: [] })).toBeUndefined();
    expect(parseSecurityInfo({ SecurityInfo: { PasscodePresent: true } })).toBeUndefined();
  });
});

describe("SecurityInfo related command payloads", () => {
  it("reads the Activation Lock bypass code from its own command result", () => {
    expect(parseActivationLockBypassCode({ ActivationLockBypassCode: " BYPASS-1234 " })).toBe(
      "BYPASS-1234",
    );
    expect(parseActivationLockBypassCode({ ActivationLockBypassCode: "" })).toBeUndefined();
    expect(parseActivationLockBypassCode({ SecurityInfo: {} })).toBeUndefined();
  });

  it("reads a verified Recovery Lock password", () => {
    expect(parseRecoveryLockVerification({ PasswordVerified: true })).toBe(true);
    expect(parseRecoveryLockVerification({ PasswordVerified: "no" })).toBe(false);
    expect(parseRecoveryLockVerification({ SecurityInfo: {} })).toBeUndefined();
  });

  it("reads the replacement key from RotateFileVaultKey", () => {
    expect(
      parseRotatedRecoveryKey({
        RotateResult: { EncryptedNewRecoveryKey: Uint8Array.from([1, 2, 3]) },
      }),
    ).toEqual({ value: btoa(String.fromCharCode(1, 2, 3)), format: "cms" });
    expect(parseRotatedRecoveryKey({ RotateResult: {} })).toBeUndefined();
  });

  it("records Activation Lock manageability and Recovery Lock state", () => {
    expect(
      parseSecurityInfo({
        SecurityInfo: {
          ManagementStatus: { IsActivationLockManageable: true },
          IsRecoveryLockEnabled: true,
          FDE_HasPersonalRecoveryKey: false,
        },
      }),
    ).toEqual({
      isActivationLockManageable: true,
      isRecoveryLockEnabled: true,
      fileVaultHasPersonalRecoveryKey: false,
    });
  });
});
