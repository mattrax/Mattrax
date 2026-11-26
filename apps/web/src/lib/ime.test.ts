import { describe, expect, it } from "vitest";
import { isImeComposing, isSubmitEnter } from "./ime";

const key = (overrides: Partial<KeyboardEvent> = {}) =>
  ({ key: "Enter", isComposing: false, keyCode: 13, ...overrides }) as KeyboardEvent;

describe("IME-safe Enter handling", () => {
  it("ignores composition confirmation in the region search", () => {
    expect(isSubmitEnter(key({ isComposing: true }))).toBe(false);
    expect(isSubmitEnter(key({ isComposing: false, keyCode: 229 }))).toBe(false);
    expect(isSubmitEnter(key())).toBe(true);
  });

  it("ignores composition confirmation in the new-dashboard name", () => {
    expect(isImeComposing(key({ isComposing: true }))).toBe(true);
    expect(isImeComposing(key({ keyCode: 229 }))).toBe(true);
    expect(isImeComposing(key())).toBe(false);
  });

  it("does not intercept other keys", () => {
    expect(isSubmitEnter(key({ key: "a", isComposing: true }))).toBe(false);
    expect(isSubmitEnter(key({ key: "Escape" }))).toBe(false);
  });
});
