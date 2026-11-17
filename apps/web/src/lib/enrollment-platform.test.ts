import { describe, expect, it } from "vitest";
import { detectEnrollmentPlatform, preferredEnrollmentPlatform } from "./enrollment-platform";
import { enrollmentLookupFailure } from "./enrollment-lookup";

describe("enrollment platform detection", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "apple",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "apple",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "apple",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "android",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "windows",
    ],
  ])("selects the platform for %s", (userAgent, expected) => {
    expect(detectEnrollmentPlatform(userAgent)).toBe(expected);
  });

  it("returns undefined for an unknown or missing user agent", () => {
    expect(
      detectEnrollmentPlatform(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      ),
    ).toBeUndefined();
    expect(detectEnrollmentPlatform("")).toBeUndefined();
    expect(detectEnrollmentPlatform(undefined)).toBeUndefined();
  });

  it("prefers the detected platform and otherwise keeps the fallback", () => {
    expect(preferredEnrollmentPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "apple")).toBe(
      "windows",
    );
    expect(preferredEnrollmentPlatform("Mozilla/5.0 (X11; Linux x86_64)", "android")).toBe(
      "android",
    );
  });
});

describe("enrollment lookup failures", () => {
  it("treats a missing or gone link as expired", () => {
    expect(enrollmentLookupFailure(404)).toBe("expired");
    expect(enrollmentLookupFailure(410)).toBe("expired");
  });

  it("keeps outages retryable", () => {
    expect(enrollmentLookupFailure(408)).toBe("unavailable");
    expect(enrollmentLookupFailure(429)).toBe("unavailable");
    expect(enrollmentLookupFailure(500)).toBe("unavailable");
    expect(enrollmentLookupFailure(503)).toBe("unavailable");
  });

  it("treats other client errors as an invalid link", () => {
    expect(enrollmentLookupFailure(400)).toBe("invalid");
    expect(enrollmentLookupFailure(403)).toBe("invalid");
  });
});
