import { describe, expect, it } from "vitest";
import type { Permission, TenantOnboardingState } from "@mattrax/enterprise-domain/client";
import {
  deriveOnboardingSteps,
  markOnboardingDismissed,
  onboardingComplete,
  onboardingProgress,
  shouldShowOnboarding,
} from "./onboarding";

const state = (overrides: Partial<TenantOnboardingState> = {}): TenantOnboardingState => ({
  dismissedAt: null,
  groups: 0,
  policies: 0,
  assignedPolicies: 0,
  devices: 0,
  administrators: 1,
  pendingInvitations: 0,
  firstPolicyId: null,
  ...overrides,
});

const can =
  (...permissions: Permission[]) =>
  (permission: Permission) =>
    permissions.includes(permission);

const ALL_ADMIN_PERMISSIONS = can(
  "groups.write",
  "policies.write",
  "enrollment.write",
  "members.write",
);

const stepFor = (steps: ReturnType<typeof deriveOnboardingSteps>, key: string) =>
  steps.find((step) => step.key === key);

describe("onboarding step derivation", () => {
  it("lists all five admin steps for an empty tenant", () => {
    const steps = deriveOnboardingSteps("tenant-1", state(), ALL_ADMIN_PERMISSIONS);

    expect(steps.map((step) => step.key)).toEqual([
      "group",
      "policy",
      "assignment",
      "device",
      "administrator",
    ]);
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(stepFor(steps, "group")?.href).toBe("/t/tenant-1/groups/new");
    expect(stepFor(steps, "policy")?.href).toBe("/t/tenant-1/policies/new");
    expect(stepFor(steps, "device")?.href).toBe("/t/tenant-1/settings/enrollment");
    expect(stepFor(steps, "administrator")?.href).toBe(
      "/t/tenant-1/settings/administrators",
    );
  });

  it("marks the group step done from a real group and links to the list", () => {
    const steps = deriveOnboardingSteps("tenant-1", state({ groups: 1 }), ALL_ADMIN_PERMISSIONS);

    expect(stepFor(steps, "group")?.done).toBe(true);
    expect(stepFor(steps, "group")?.href).toBe("/t/tenant-1/groups");
  });

  it("marks policy creation and assignment independently", () => {
    const created = deriveOnboardingSteps(
      "tenant-1",
      state({ policies: 1, firstPolicyId: "policy-1" }),
      ALL_ADMIN_PERMISSIONS,
    );

    const assigned = deriveOnboardingSteps(
      "tenant-1",
      state({ policies: 1, assignedPolicies: 1, firstPolicyId: "policy-1" }),
      ALL_ADMIN_PERMISSIONS,
    );

    expect(stepFor(created, "policy")?.done).toBe(true);
    expect(stepFor(created, "assignment")?.done).toBe(false);
    expect(stepFor(created, "assignment")?.href).toBe(
      "/t/tenant-1/policies/policy-1/assignments",
    );
    expect(stepFor(assigned, "assignment")?.done).toBe(true);
  });

  it("marks the device step only from an enrolled device", () => {
    const steps = deriveOnboardingSteps("tenant-1", state({ devices: 1 }), ALL_ADMIN_PERMISSIONS);

    expect(stepFor(steps, "device")?.done).toBe(true);
    expect(stepFor(steps, "device")?.href).toBe("/t/tenant-1/devices");
  });

  it("counts a pending invitation as inviting a second administrator", () => {
    const member = deriveOnboardingSteps(
      "tenant-1",
      state({ administrators: 2 }),
      ALL_ADMIN_PERMISSIONS,
    );

    const invited = deriveOnboardingSteps(
      "tenant-1",
      state({ pendingInvitations: 1 }),
      ALL_ADMIN_PERMISSIONS,
    );

    expect(stepFor(member, "administrator")?.done).toBe(true);
    expect(stepFor(invited, "administrator")?.done).toBe(true);
  });

  it("hides the card once every step is complete", () => {
    const steps = deriveOnboardingSteps(
      "tenant-1",
      state({
        groups: 1,
        policies: 1,
        assignedPolicies: 1,
        devices: 1,
        administrators: 2,
        firstPolicyId: "policy-1",
      }),
      ALL_ADMIN_PERMISSIONS,
    );

    expect(onboardingComplete(steps)).toBe(true);
    expect(onboardingProgress(steps)).toEqual({ done: 5, total: 5 });
    expect(shouldShowOnboarding(state(), steps)).toBe(false);
  });

  it("never shows admin-only steps to a read-only member", () => {
    const readOnly = can(
      "tenant.read",
      "groups.read",
      "policies.read",
      "devices.read",
      "members.read",
    );

    const steps = deriveOnboardingSteps("tenant-1", state(), readOnly);

    expect(steps).toEqual([]);
    expect(onboardingComplete(steps)).toBe(false);
    expect(shouldShowOnboarding(state(), steps)).toBe(false);
  });

  it("keeps a step only when the member can act on it", () => {
    const policyOnly = can("policies.write");
    const steps = deriveOnboardingSteps("tenant-1", state(), policyOnly);

    expect(steps.map((step) => step.key)).toEqual(["policy", "assignment"]);

    const enrollmentOnly = can("enrollment.write");
    expect(
      deriveOnboardingSteps("tenant-1", state(), enrollmentOnly).map((step) => step.key),
    ).toEqual(["device"]);
  });

  it("hides a dismissed checklist until it is restored", () => {
    const steps = deriveOnboardingSteps("tenant-1", state(), ALL_ADMIN_PERMISSIONS);

    expect(shouldShowOnboarding(state(), steps)).toBe(true);
    expect(shouldShowOnboarding(state({ dismissedAt: "2026-11-20T00:00:00.000Z" }), steps)).toBe(
      false,
    );
  });
});

describe("onboarding dismissal helper", () => {
  it("returns a new state with the dismissal timestamp", () => {
    const before = state();
    const after = markOnboardingDismissed(before, "2026-11-20T12:00:00.000Z");

    expect(after).not.toBe(before);
    expect(before.dismissedAt).toBeNull();
    expect(after.dismissedAt).toBe("2026-11-20T12:00:00.000Z");
    expect(after.groups).toBe(before.groups);
  });

  it("hides the card after the optimistic dismissal", () => {
    const steps = deriveOnboardingSteps("tenant-1", state(), ALL_ADMIN_PERMISSIONS);
    const dismissed = markOnboardingDismissed(state(), "2026-11-20T12:00:00.000Z");

    expect(shouldShowOnboarding(dismissed, steps)).toBe(false);
  });
});
