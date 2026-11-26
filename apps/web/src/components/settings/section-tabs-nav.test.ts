import { afterEach, describe, expect, it, vi } from "vitest";
import { recorder } from "../../../../../packages/config/testing/recorder.ts";
import { activateSectionTabAnchor, sectionTabTarget } from "./section-tabs-nav";

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

  it("leaves browser shortcuts with a modifier to the browser", () => {
    const modifiers = [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }];

    for (const modifier of modifiers) {
      expect(sectionTabTarget(tabs, "endpoints", "ArrowRight", modifier)).toBeUndefined();
      expect(sectionTabTarget(tabs, "endpoints", "ArrowLeft", modifier)).toBeUndefined();
      expect(sectionTabTarget(tabs, "endpoints", "Home", modifier)).toBeUndefined();
      expect(sectionTabTarget(tabs, "endpoints", "End", modifier)).toBeUndefined();
    }
  });

  it("still handles unmodified keys alongside modifier state that is false", () => {
    expect(
      sectionTabTarget(tabs, "endpoints", "ArrowRight", {
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("deliveries");
  });
});

describe("section tab anchor activation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clicks a navigation tab after the current event settles", () => {
    vi.useFakeTimers();
    const click = recorder();

    activateSectionTabAnchor({ click });

    expect(click).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(click).toHaveBeenCalledOnce();
  });

  it("ignores a tab that is no longer mounted", () => {
    vi.useFakeTimers();

    expect(() => activateSectionTabAnchor(undefined)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
