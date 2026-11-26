import { describe, expect, it } from "vitest";
import {
  APPROVAL_ACTIONS,
  APPROVAL_REQUEST_TTL_MS,
  approvalPayloadBinding,
  approvalPayloadHash,
  approvalTransitionAllowed,
  approverEligibility,
  approverRoleSatisfies,
  canonicalJson,
  effectiveApprovalStatus,
  isApprovalUsable,
  selectApprovalPolicy,
} from "./approvals.ts";

const now = new Date("2026-11-23T12:00:00.000Z");

const policy = (overrides: {
  id: string;
  scopeType?: "tenant" | "group" | "device";
  scopeId?: string | null;
  approvalsRequired?: number;
  createdAt?: Date;
}) => ({
  id: overrides.id,
  scopeType: overrides.scopeType ?? "tenant",
  scopeId: overrides.scopeId ?? null,
  approvalsRequired: overrides.approvalsRequired ?? 1,
  createdAt: overrides.createdAt ?? now,
});

describe("approval action catalogue", () => {
  it("contains every action the issue requires", () => {
    expect([...APPROVAL_ACTIONS].sort()).toEqual(
      [
        "api-token.create",
        "backup.download",
        "device.fresh-start",
        "device.wipe",
        "policy.delete",
        "script.run",
        "script.write",
        "tenant.delete",
        "tenant.export",
      ].sort(),
    );
  });
});

describe("canonical payload binding", () => {
  it("sorts object keys recursively but preserves array order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 1] } })).toBe('{"a":{"c":[3,1],"d":2},"b":1}');
    expect(canonicalJson({ b: null, a: 1 })).toBe('{"a":1,"b":null}');
  });

  it("sorts and deduplicates device targets", async () => {
    const base = { action: "device.wipe" as const, policyId: "policy-1" };
    const first = approvalPayloadBinding({ ...base, targets: ["b", "a", "a"] });
    const second = approvalPayloadBinding({ ...base, targets: ["a", "b"] });

    expect(first.targets).toEqual(["a", "b"]);
    expect(await approvalPayloadHash(first)).toBe(await approvalPayloadHash(second));
  });

  it("binds the action, policy, resource, targets and details", async () => {
    const base = approvalPayloadBinding({
      action: "script.run",
      policyId: "policy-1",
      resourceId: "script-1",
      targets: ["device-1"],
      details: { groups: ["group-1"], allAssigned: false },
    });
    const hash = await approvalPayloadHash(base);

    const others = [
      approvalPayloadBinding({ ...base, action: "script.write" }),
      approvalPayloadBinding({ ...base, policyId: "policy-2" }),
      approvalPayloadBinding({ ...base, resourceId: "script-2" }),
      approvalPayloadBinding({ ...base, targets: ["device-2"] }),
      approvalPayloadBinding({ ...base, details: { groups: ["group-2"], allAssigned: false } }),
    ];

    for (const other of others) expect(await approvalPayloadHash(other)).not.toBe(hash);
  });
});

describe("approval state machine", () => {
  it("allows only the terminal transitions from pending", () => {
    expect(approvalTransitionAllowed("pending", "approved")).toBe(true);
    expect(approvalTransitionAllowed("pending", "rejected")).toBe(true);
    expect(approvalTransitionAllowed("pending", "expired")).toBe(true);
    expect(approvalTransitionAllowed("pending", "cancelled")).toBe(true);
    expect(approvalTransitionAllowed("approved", "expired")).toBe(true);
    expect(approvalTransitionAllowed("approved", "cancelled")).toBe(false);
    expect(approvalTransitionAllowed("rejected", "approved")).toBe(false);
    expect(approvalTransitionAllowed("expired", "pending")).toBe(false);
  });

  it("treats a past deadline as expired on read", () => {
    const expiresAt = new Date(now.getTime() - 1);

    expect(effectiveApprovalStatus({ status: "pending", expiresAt }, now)).toBe("expired");
    expect(effectiveApprovalStatus({ status: "approved", expiresAt }, now)).toBe("expired");
    expect(effectiveApprovalStatus({ status: "rejected", expiresAt }, now)).toBe("rejected");
    expect(
      effectiveApprovalStatus({ status: "pending", expiresAt: new Date(now.getTime() + 1) }, now),
    ).toBe("pending");
  });

  it("counts an approval usable once, before expiry", () => {
    const expiresAt = new Date(now.getTime() + APPROVAL_REQUEST_TTL_MS);

    expect(isApprovalUsable({ status: "approved", expiresAt, consumedAt: null }, now)).toBe(true);
    expect(isApprovalUsable({ status: "approved", expiresAt, consumedAt: now }, now)).toBe(false);
    expect(isApprovalUsable({ status: "pending", expiresAt, consumedAt: null }, now)).toBe(false);
    expect(
      isApprovalUsable({ status: "approved", expiresAt: new Date(0), consumedAt: null }, now),
    ).toBe(false);
  });
});

describe("policy selection", () => {
  it("prefers the most specific scope", () => {
    const selected = selectApprovalPolicy(
      [
        policy({ id: "tenant" }),
        policy({ id: "group", scopeType: "group", scopeId: "group-1" }),
        policy({ id: "device", scopeType: "device", scopeId: "device-1" }),
      ],
      { deviceIds: ["device-1"], groupIds: ["group-1"] },
    );

    expect(selected?.id).toBe("device");
  });

  it("uses the higher approval count and then the newest policy to break ties", () => {
    const selected = selectApprovalPolicy(
      [
        policy({ id: "old", approvalsRequired: 1 }),
        policy({ id: "new", approvalsRequired: 2, createdAt: new Date(now.getTime() + 1) }),
      ],
      { deviceIds: [], groupIds: [] },
    );

    expect(selected?.id).toBe("new");
  });

  it("returns undefined when no scope matches", () => {
    expect(
      selectApprovalPolicy([policy({ id: "device", scopeType: "device", scopeId: "device-9" })], {
        deviceIds: ["device-1"],
        groupIds: [],
      }),
    ).toBeUndefined();
  });
});

describe("approver eligibility", () => {
  it("requires the configured permission", () => {
    const requirement = { approverPermission: "devices.command", approverRole: null };

    expect(
      approverEligibility(
        { permissions: new Set(["devices.command"]), role: "member" },
        requirement,
      ),
    ).toBe("eligible");
    expect(
      approverEligibility({ permissions: new Set(["devices.read"]), role: "admin" }, requirement),
    ).toBe("missing_permission");
  });

  it("treats built-in roles as a floor and excludes custom roles", () => {
    expect(approverRoleSatisfies({ role: "owner" }, "admin")).toBe(true);
    expect(approverRoleSatisfies({ role: "admin" }, "owner")).toBe(false);
    expect(approverRoleSatisfies({ role: "owner", customRoleId: "role-1" }, "admin")).toBe(false);

    expect(
      approverEligibility(
        { permissions: new Set(["approvals.write"]), role: "admin" },
        { approverPermission: null, approverRole: "owner" },
      ),
    ).toBe("missing_role");
  });

  it("reports an unconfigured requirement rather than silently allowing it", () => {
    expect(
      approverEligibility(
        { permissions: new Set(["approvals.write"]), role: "owner" },
        { approverPermission: null, approverRole: null },
      ),
    ).toBe("unconfigured");
  });
});
