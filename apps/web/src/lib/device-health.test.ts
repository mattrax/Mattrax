import { describe, expect, test } from "vitest";
import { HEALTH_LEVELS, healthLabel, healthRank } from "./device-health";

describe("device health ordering", () => {
  test("ascending rank is worst first", () => {
    expect([...HEALTH_LEVELS].sort((left, right) => healthRank(left) - healthRank(right))).toEqual([
      "critical",
      "attention",
      "unknown",
      "healthy",
    ]);
  });

  test("an absent or unrecognised level sorts with unknown", () => {
    expect(healthRank(undefined)).toBe(healthRank("unknown"));
    expect(healthRank(null)).toBe(healthRank("unknown"));
    expect(healthRank("something-else")).toBe(healthRank("unknown"));
  });

  test("labels match the badge copy", () => {
    expect(healthLabel("critical")).toBe("Critical");
    expect(healthLabel("attention")).toBe("Attention");
    expect(healthLabel("healthy")).toBe("Healthy");
    expect(healthLabel(undefined)).toBe("Unknown");
  });
});
