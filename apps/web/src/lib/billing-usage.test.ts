import { describe, expect, it } from "vitest";
import { billingUsagePercent, billingUsageRemaining, billingUsageState } from "./billing-usage";

describe("billing usage presentation", () => {
  it("treats missing and null limits as unlimited", () => {
    expect(billingUsageState(24, null)).toBe("unlimited");
    expect(billingUsageState(24, undefined)).toBe("unlimited");
    expect(billingUsagePercent(24, null)).toBe(0);
    expect(billingUsageRemaining(24, null)).toBeNull();
  });

  it("warns at eighty percent and distinguishes a full limit", () => {
    expect(billingUsageState(7, 10)).toBe("healthy");
    expect(billingUsageState(8, 10)).toBe("near");
    expect(billingUsageState(10, 10)).toBe("full");
  });

  it("keeps over-limit usage visible without overflowing the meter", () => {
    expect(billingUsageState(12, 10)).toBe("over");
    expect(billingUsageState(10, 10, true)).toBe("over");
    expect(billingUsagePercent(12, 10)).toBe(100);
    expect(billingUsageRemaining(12, 10)).toBe(0);
  });

  it("handles plans with no allowance", () => {
    expect(billingUsageState(0, 0)).toBe("full");
    expect(billingUsageState(1, 0)).toBe("over");
    expect(billingUsagePercent(1, 0)).toBe(0);
  });
});
