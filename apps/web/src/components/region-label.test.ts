import { describe, expect, it } from "vitest";
import { flagOf, regionName } from "./region-label";

describe("region labels", () => {
  it("renders a flag for a two-letter code", () => {
    expect(flagOf("gb")).toBe("🇬🇧");
    expect(flagOf("us")).toBe("🇺🇸");
    expect(flagOf(" gb ")).toBe("🇬🇧");
  });

  it("resolves a display name and falls back to the code", () => {
    expect(regionName("gb")).toBe("United Kingdom");
    expect(regionName("GB")).toBe("United Kingdom");
    expect(regionName("not-a-code")).toBe("NOT-A-CODE");
    expect(regionName(" ")).toBe("");
  });
});
