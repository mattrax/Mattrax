import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPORT_URL, resolveSupportUrl } from "./support-config-store";

describe("support URL resolution", () => {
  it("falls back to the mailto when nothing is configured", () => {
    expect(resolveSupportUrl(undefined)).toBe(DEFAULT_SUPPORT_URL);
    expect(resolveSupportUrl("")).toBe(DEFAULT_SUPPORT_URL);
    expect(resolveSupportUrl("   ")).toBe(DEFAULT_SUPPORT_URL);
  });

  it("accepts a support form, calendar booking page or mailto", () => {
    expect(resolveSupportUrl("https://calendar.example.com/mattrax")).toBe(
      "https://calendar.example.com/mattrax",
    );
    expect(resolveSupportUrl("http://localhost:3000/support")).toBe(
      "http://localhost:3000/support",
    );
    expect(resolveSupportUrl("mailto:support@example.com")).toBe("mailto:support@example.com");
    expect(resolveSupportUrl("  https://example.com/help  ")).toBe("https://example.com/help");
  });

  it("falls back instead of rendering a dead or script link", () => {
    expect(resolveSupportUrl("javascript:alert(1)")).toBe(DEFAULT_SUPPORT_URL);
    expect(resolveSupportUrl("/support")).toBe(DEFAULT_SUPPORT_URL);
    expect(resolveSupportUrl("not a url")).toBe(DEFAULT_SUPPORT_URL);
    expect(resolveSupportUrl("data:text/html,hello")).toBe(DEFAULT_SUPPORT_URL);
  });
});
