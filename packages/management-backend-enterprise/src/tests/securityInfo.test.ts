import { describe, expect, it } from "vitest";
import { parseSecurityInfo } from "../securityInfo.js";

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
      recoveryKey: "QUJDREVGRw==",
      fileVaultStatus: "enabled",
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
      recoveryKey: "AAAA-BBBB-CCCC-DDDD",
      fileVaultStatus: "enabled",
      bootstrapTokenEscrowed: true,
    });

    expect(
      parseSecurityInfo({
        SecurityInfo: { FileVaultStatus: "Off", FDE_RecoveryKey: "1111-2222" },
      }),
    ).toEqual({ recoveryKey: "1111-2222", fileVaultStatus: "disabled" });

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
      recoveryKey: "FLAT-KEY",
      fileVaultStatus: "disabled",
      bootstrapTokenEscrowed: true,
    });
    expect(
      parseSecurityInfo({
        SecurityInfo: { FDE_PersonalRecoveryKeyCMS: Uint8Array.from([65, 66, 67]) },
      }),
    ).toEqual({ recoveryKey: btoa("ABC") });
  });

  it("ignores responses without a SecurityInfo payload", () => {
    expect(parseSecurityInfo(undefined)).toBeUndefined();
    expect(parseSecurityInfo({ InstalledApplicationList: [] })).toBeUndefined();
    expect(parseSecurityInfo({ SecurityInfo: { PasscodePresent: true } })).toBeUndefined();
  });
});
