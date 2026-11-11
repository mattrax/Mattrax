import { describe, expect, it } from "vitest";
import {
  DEVICE_LIMIT_REACHED_TITLE,
  PLAN_LIMIT_REACHED_BODY,
  PLAN_LIMIT_REACHED_TITLE,
  UNLIMITED_PLAN_NOTICE,
  deviceLimitReachedMessage,
  formatPlanLimit,
  formatPlanUsage,
} from "./plan-limits.js";

describe("plan limit copy", () => {
  it("formats finite and unlimited limits", () => {
    expect(formatPlanLimit(5)).toBe("5");
    expect(formatPlanLimit(0)).toBe("0");
    expect(formatPlanLimit(null)).toBe("Unlimited");
    expect(formatPlanLimit(undefined)).toBe("Unlimited");
  });

  it("formats usage against a limit", () => {
    expect(formatPlanUsage(3, 10)).toBe("3 / 10");
    expect(formatPlanUsage(3, null)).toBe("3 / Unlimited");
    expect(formatPlanUsage(undefined, undefined)).toBe("0 / Unlimited");
  });

  it("explains an over-limit tenant without implying devices are removed", () => {
    expect(PLAN_LIMIT_REACHED_TITLE).toBe("Plan limit reached");
    expect(PLAN_LIMIT_REACHED_BODY).toContain("Existing devices remain manageable");
  });

  it("explains a reached device limit on the enrollment page", () => {
    expect(DEVICE_LIMIT_REACHED_TITLE).toBe("Device limit reached");
    expect(deviceLimitReachedMessage(1)).toContain("allows 1 device.");
    expect(deviceLimitReachedMessage(50)).toContain("allows 50 devices.");
    expect(deviceLimitReachedMessage(null)).toContain("allows 0 devices.");
  });

  it("explains when the deployment has no plan catalogue", () => {
    expect(UNLIMITED_PLAN_NOTICE).toContain("unlimited");
  });
});
