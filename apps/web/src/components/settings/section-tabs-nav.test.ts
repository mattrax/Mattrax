import { describe, expect, it } from "vitest";
import { sectionTabTarget } from "./section-tabs-nav";

const tabs = ["endpoints", "deliveries"] as const;

describe("section tab keyboard navigation", () => {
  it("moves right and wraps at the end", () => {
    expect(sectionTabTarget(tabs, "endpoints", "ArrowRight")).toBe("deliveries");
    expect(sectionTabTarget(tabs, "deliveries", "ArrowRight")).toBe("endpoints");
  });

  it("moves left and wraps at the start", () => {
    expect(sectionTabTarget(tabs, "deliveries", "ArrowLeft")).toBe("endpoints");
    expect(sectionTabTarget(tabs, "endpoints", "ArrowLeft")).toBe("deliveries");
  });

  it("jumps to the first and last tab", () => {
    expect(sectionTabTarget(tabs, "deliveries", "Home")).toBe("endpoints");
    expect(sectionTabTarget(tabs, "endpoints", "End")).toBe("deliveries");
  });

  it("starts from the first tab when the active id is unknown", () => {
    expect(sectionTabTarget(tabs, "missing", "ArrowRight")).toBe("deliveries");
  });

  it("ignores other keys and empty tab sets", () => {
    expect(sectionTabTarget(tabs, "endpoints", "Enter")).toBeUndefined();
    expect(sectionTabTarget([], "endpoints", "ArrowRight")).toBeUndefined();
  });
});
