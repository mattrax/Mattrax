import { describe, expect, it } from "vitest";
import {
  auditActorKind,
  auditActorLabel,
  auditProtocolLabel,
  formatAuditAction,
} from "./audit-log.ts";

describe("audit log presentation helpers", () => {
  it("formats an action without changing its meaning", () => {
    expect(formatAuditAction("device.command_failed")).toBe("Device · command failed");
    expect(formatAuditAction("mdm.policy_delivered")).toBe("MDM · policy delivered");
    expect(formatAuditAction("tenant.created")).toBe("Tenant · created");
  });

  it("labels the system actor without exposing the sentinel as an address", () => {
    expect(auditActorLabel({ actorType: "system", actorEmail: "system" })).toBe("System");
    expect(auditActorLabel({ actorType: "system", actorEmail: null })).toBe("System");
    expect(auditActorLabel({ actorType: "account", actorEmail: "owner@example.com" })).toBe(
      "owner@example.com",
    );
    expect(auditActorLabel({ actorType: "api-token", actorEmail: "ci@example.com" })).toBe(
      "ci@example.com",
    );
  });

  it("distinguishes account, API token and system actors", () => {
    expect(auditActorKind({ actorType: "account" })).toBe("Account");
    expect(auditActorKind({ actorType: "api-token" })).toBe("API token");
    expect(auditActorKind({ actorType: "system" })).toBe("Device / system");
  });

  it("maps protocols and ignores unknown values", () => {
    expect(auditProtocolLabel("apple")).toBe("Apple");
    expect(auditProtocolLabel("win")).toBe("Windows");
    expect(auditProtocolLabel("android")).toBe("Android");
    expect(auditProtocolLabel(null)).toBeUndefined();
    expect(auditProtocolLabel("ios")).toBeUndefined();
  });
});
