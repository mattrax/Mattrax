import { describe, expect, it } from "vitest";
import { recorder } from "../../../../packages/config/testing/recorder.ts";
import { hashTargetId, scrollToHashTarget } from "./hash-scroll";

describe("hash scrolling", () => {
  it("reads a target id from a fragment and ignores empty fragments", () => {
    expect(hashTargetId("#restore")).toBe("restore");
    expect(hashTargetId("#")).toBeUndefined();
    expect(hashTargetId("")).toBeUndefined();
    expect(hashTargetId("restore")).toBeUndefined();
  });

  it("scrolls the named element to the top of its scrollport", () => {
    const target = { scrollIntoView: recorder() };
    const lookup = recorder((id: string) => (id === "restore" ? target : undefined));

    expect(scrollToHashTarget("#restore", lookup)).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("does nothing when the target is not mounted", () => {
    const lookup = recorder(() => undefined);

    expect(scrollToHashTarget("#restore", lookup)).toBe(false);
    expect(lookup).toHaveBeenCalledWith("restore");
  });

  it("does not look up an empty or relative fragment", () => {
    const lookup = recorder(() => undefined);

    expect(scrollToHashTarget("restore", lookup)).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });
});
