import { describe, expect, it } from "vitest";
import {
  findRestrictedSoftwareMatch,
  inventoryApplicationMatches,
  normaliseRestrictedSoftwareMatch,
  restrictedSoftwareAgentResultRejection,
  restrictedSoftwareCapability,
  restrictedSoftwareProblem,
  restrictedSoftwareScopeApplies,
} from "./restrictedSoftware.ts";

const valid = {
  name: "Block example",
  platform: "apple",
  matchType: "bundle-id",
  matchValue: "com.example.Banned",
  action: "kill-process",
  message: "Not allowed",
  notificationEmails: ["security@example.com"],
};

describe("restricted software validation", () => {
  it("accepts identifiers that can match on each platform", () => {
    expect(restrictedSoftwareProblem(valid)).toBeNull();
    expect(
      restrictedSoftwareProblem({
        ...valid,
        platform: "android",
        matchType: "android-package",
        matchValue: "com.example.app",
        action: "block-install",
      }),
    ).toBeNull();
    expect(
      restrictedSoftwareProblem({
        ...valid,
        platform: "win",
        matchType: "msi-product-code",
        matchValue: "{12345678-1234-1234-1234-123456789ABC}",
        action: "delete-app",
      }),
    ).toBeNull();
  });

  it("rejects an identifier that cannot match the platform", () => {
    expect(
      restrictedSoftwareProblem({
        ...valid,
        platform: "android",
        matchType: "bundle-id",
      }),
    ).toContain("not a valid identifier");
    expect(
      restrictedSoftwareProblem({
        ...valid,
        platform: "win",
        matchType: "android-package",
        matchValue: "com.example.app",
      }),
    ).toContain("not a valid identifier");
  });

  it("rejects malformed bundle ids, packages, GUIDs and process paths", () => {
    expect(restrictedSoftwareProblem({ ...valid, matchValue: "not a bundle id" })).not.toBeNull();
    expect(
      restrictedSoftwareProblem({
        ...valid,
        platform: "android",
        matchType: "android-package",
        matchValue: "not-a-package",
      }),
    ).not.toBeNull();
    expect(
      restrictedSoftwareProblem({
        ...valid,
        platform: "win",
        matchType: "msi-product-code",
        matchValue: "1234",
      }),
    ).not.toBeNull();
    expect(
      restrictedSoftwareProblem({
        ...valid,
        matchType: "process-name",
        matchValue: "/Applications/Banned.app",
      }),
    ).not.toBeNull();
  });

  it("normalises the .app suffix and rejects dangerous system processes", () => {
    expect(
      restrictedSoftwareProblem({
        ...valid,
        matchType: "process-name",
        matchValue: "Banned.app",
      }),
    ).toBeNull();
    expect(
      restrictedSoftwareProblem({
        ...valid,
        matchType: "process-name",
        matchValue: "launchd",
      }),
    ).toContain("system process");
  });

  it("rejects Apple system bundle identifiers", () => {
    expect(restrictedSoftwareProblem({ ...valid, matchValue: "com.apple.Safari" })).toContain(
      "system applications",
    );
  });

  it("rejects deleting an app by process name only", () => {
    expect(
      restrictedSoftwareProblem({
        ...valid,
        matchType: "process-name",
        matchValue: "Banned",
        action: "delete-app",
      }),
    ).toContain("bundle identifier");
  });

  it("bounds recipients and validates addresses", () => {
    expect(restrictedSoftwareProblem({ ...valid, notificationEmails: ["not-an-email"] })).toContain(
      "valid email",
    );
  });
});

describe("restricted software matching", () => {
  const applications = [
    { bundleId: "com.example.Banned", name: "Banned App", version: "1.0" },
    { bundleId: "com.example.Allowed", name: "Allowed App", version: "2.0" },
    { bundleId: "12345678-1234-1234-1234-123456789abc", name: "Legacy Suite" },
  ];

  it("matches bundle ids case-insensitively", () => {
    expect(
      inventoryApplicationMatches(
        { matchType: "bundle-id", matchKey: "COM.EXAMPLE.BANNED" },
        applications[0]!,
      ),
    ).toBe(true);
  });

  it("canonicalises MSI GUIDs so brace forms cannot create overlapping rules", () => {
    expect(
      normaliseRestrictedSoftwareMatch(
        "{12345678-1234-1234-1234-123456789ABC}",
        "msi-product-code",
      ),
    ).toBe("12345678-1234-1234-1234-123456789abc");
    expect(
      normaliseRestrictedSoftwareMatch("12345678-1234-1234-1234-123456789abc", "msi-product-code"),
    ).toBe("12345678-1234-1234-1234-123456789abc");
  });

  it("matches MSI ProductCodes", () => {
    expect(
      inventoryApplicationMatches(
        { matchType: "msi-product-code", matchKey: "{12345678-1234-1234-1234-123456789ABC}" },
        applications[2]!,
      ),
    ).toBe(true);
  });

  it("matches Android packages exactly", () => {
    expect(
      inventoryApplicationMatches(
        { matchType: "android-package", matchKey: "com.example.banned" },
        applications[0]!,
      ),
    ).toBe(true);
    expect(
      inventoryApplicationMatches(
        { matchType: "android-package", matchKey: "com.example.ban" },
        applications[0]!,
      ),
    ).toBe(false);
  });

  it("falls back to the display name or bundle id segment for process names", () => {
    expect(
      inventoryApplicationMatches(
        { matchType: "process-name", matchKey: "banned app" },
        applications[0]!,
      ),
    ).toBe(true);
    expect(
      inventoryApplicationMatches(
        { matchType: "process-name", matchKey: "banned" },
        applications[0]!,
      ),
    ).toBe(true);
  });

  it("returns the first matching inventory row deterministically", () => {
    const match = findRestrictedSoftwareMatch(
      { matchType: "bundle-id", matchKey: "com.example.banned" },
      [...applications].reverse(),
    );

    expect(match?.bundleId).toBe("com.example.Banned");
  });
});

describe("restricted software scope", () => {
  const deviceId = "device-1";
  const groupIds = new Set(["group-1"]);

  it("applies a group include", () => {
    expect(
      restrictedSoftwareScopeApplies(
        [{ targetType: "group", targetId: "group-1", mode: "include" }],
        { deviceId, groupIds },
      ),
    ).toBe(true);
  });

  it("lets a group exclude veto a group include", () => {
    expect(
      restrictedSoftwareScopeApplies(
        [
          { targetType: "group", targetId: "group-1", mode: "include" },
          { targetType: "group", targetId: "group-1", mode: "exclude" },
        ],
        { deviceId, groupIds },
      ),
    ).toBe(false);
  });

  it("lets a direct device include win over a group exclude", () => {
    expect(
      restrictedSoftwareScopeApplies(
        [
          { targetType: "group", targetId: "group-1", mode: "exclude" },
          { targetType: "device", targetId: deviceId, mode: "include" },
        ],
        { deviceId, groupIds },
      ),
    ).toBe(true);
  });

  it("treats a direct device exclude as final", () => {
    expect(
      restrictedSoftwareScopeApplies(
        [
          { targetType: "group", targetId: "group-1", mode: "include" },
          { targetType: "device", targetId: deviceId, mode: "exclude" },
        ],
        { deviceId, groupIds },
      ),
    ).toBe(false);
  });
});

describe("agent result rejection", () => {
  it("rejects detection-only, iOS and mismatched actions", () => {
    const valid = {
      capabilityMode: "agent",
      osEdition: "macOS",
      ruleAction: "kill-process",
      reportedAction: "kill-process",
    };

    expect(restrictedSoftwareAgentResultRejection(valid)).toBeNull();
    expect(restrictedSoftwareAgentResultRejection({ ...valid, osEdition: "iOS" })).toContain(
      "macOS",
    );
    expect(
      restrictedSoftwareAgentResultRejection({ ...valid, capabilityMode: "detection-only" }),
    ).toContain("detection-only");
    expect(
      restrictedSoftwareAgentResultRejection({ ...valid, reportedAction: "delete-app" }),
    ).toContain("does not match");
  });
});

describe("restricted software enforcement matrix", () => {
  it("enforces Android block-install through the policy", () => {
    expect(restrictedSoftwareCapability("android", "block-install").mode).toBe("policy");
  });

  it("does not pretend Android can kill a process", () => {
    expect(restrictedSoftwareCapability("android", "kill-process").mode).toBe("detection-only");
  });

  it("enforces macOS kill and delete through the agent", () => {
    expect(restrictedSoftwareCapability("apple", "kill-process").mode).toBe("agent");
    expect(restrictedSoftwareCapability("apple", "delete-app").mode).toBe("agent");
  });

  it("is honest that macOS cannot block an install", () => {
    expect(restrictedSoftwareCapability("apple", "block-install").mode).toBe("detection-only");
  });

  it("is detection-only on Windows", () => {
    expect(restrictedSoftwareCapability("win", "kill-process").mode).toBe("detection-only");
    expect(restrictedSoftwareCapability("win", "delete-app").mode).toBe("detection-only");
  });
});
