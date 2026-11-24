import { describe, expect, it } from "vitest";
import { shouldExposeMcpPath } from "./mcp.ts";

describe("MCP path exposure", () => {
  it("never exposes device handover, including the token download", () => {
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/handover")).toBe(false);
    expect(
      shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/handover/:archiveId/download"),
    ).toBe(false);
    // The impact read shares the prefix, so it is blocked by the same rule.
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/handover-impact")).toBe(false);
  });

  it("never exposes approval administration or decision endpoints", () => {
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/approvals")).toBe(false);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/approvals/:approvalId/approve")).toBe(
      false,
    );
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/approval-policies")).toBe(false);
  });

  it("still exposes ordinary device reads and commands", () => {
    expect(shouldExposeMcpPath("/api/v1/me")).toBe(false);
    expect(shouldExposeMcpPath("/api/v1/me/deletion")).toBe(false);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices")).toBe(true);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/:id")).toBe(true);
    expect(shouldExposeMcpPath("/api/v1/tenants/:tenantId/devices/:id/action")).toBe(true);
  });
});
