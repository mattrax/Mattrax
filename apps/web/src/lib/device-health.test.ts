import { describe, expect, test } from "vitest";
import { HEALTH_LEVELS, healthLabel, healthRank, missingDeviceCount } from "./device-health";

describe("device health ordering", () => {
  test("ascending rank is worst first", () => {
    expect([...HEALTH_LEVELS].sort((left, right) => healthRank(left) - healthRank(right))).toEqual([
      "critical",
      "missing",
      "attention",
      "unknown",
      "healthy",
    ]);
  });

  test("MIA sorts between critical and attention", () => {
    expect(healthRank("missing")).toBeGreaterThan(healthRank("critical"));
    expect(healthRank("missing")).toBeLessThan(healthRank("attention"));
  });

  test("an absent or unrecognised level sorts with unknown", () => {
    expect(healthRank(undefined)).toBe(healthRank("unknown"));
    expect(healthRank(null)).toBe(healthRank("unknown"));
    expect(healthRank("something-else")).toBe(healthRank("unknown"));
  });

  test("labels match the badge copy", () => {
    expect(healthLabel("critical")).toBe("Critical");
    expect(healthLabel("missing")).toBe("MIA");
    expect(healthLabel("attention")).toBe("Attention");
    expect(healthLabel("healthy")).toBe("Healthy");
    expect(healthLabel(undefined)).toBe("Unknown");
  });
});

describe("MIA banner count", () => {
  test("uses the missing count from the health summary", () => {
    expect(missingDeviceCount({ missing: 3 })).toBe(3);
    expect(missingDeviceCount({ missing: 1 })).toBe(1);
  });

  test("is zero while the summary is absent or has no MIA devices", () => {
    expect(missingDeviceCount(undefined)).toBe(0);
    expect(missingDeviceCount(null)).toBe(0);
    expect(missingDeviceCount({})).toBe(0);
    expect(missingDeviceCount({ missing: 0 })).toBe(0);
  });

  test("never reports a negative or non-finite count", () => {
    expect(missingDeviceCount({ missing: -2 })).toBe(0);
    expect(missingDeviceCount({ missing: Number.NaN })).toBe(0);
  });
});
