import { describe, expect, it } from "vitest";
import { initials } from "./names";

describe("initials", () => {
  it("uses the first letter of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Grace Brewster Hopper")).toBe("GB");
  });

  it("handles single names, padding and casing", () => {
    expect(initials("ada")).toBe("A");
    expect(initials("  Ada   Lovelace  ")).toBe("AL");
    expect(initials("ada lovelace")).toBe("AL");
  });

  it("falls back for missing names", () => {
    expect(initials(undefined)).toBe("?");
    expect(initials(null)).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});
