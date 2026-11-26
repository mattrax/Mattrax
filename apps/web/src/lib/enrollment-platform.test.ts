import { describe, expect, it } from "vitest";
import {
  detectEnrollmentPlatform,
  preferredEnrollmentPlatform,
  resolveInitialEnrollmentPlatform,
} from "./enrollment-platform";
import { enrollmentLookupFailure } from "./enrollment-lookup";

describe("enrollment platform detection", () => {
  const selectsPlatform = (userAgent: string, expected: string) => {
    expect(detectEnrollmentPlatform(userAgent)).toBe(expected);
  };

  it("selects the platform for an iPhone user agent", () =>
    selectsPlatform(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "apple",
    ));

  it("selects the platform for an iPad user agent", () =>
    selectsPlatform(
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "apple",
    ));

  it("selects the platform for a macOS user agent", () =>
    selectsPlatform(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "apple",
    ));

  it("selects the platform for an Android user agent", () =>
    selectsPlatform(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "android",
    ));

  it("selects the platform for a Windows user agent", () =>
    selectsPlatform(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "windows",
    ));

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

  it("uses the server-authored marker during hydration instead of the browser UA", () => {
    expect(
      resolveInitialEnrollmentPlatform({
        marker: "windows",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        fallback: "apple",
      }),
    ).toBe("windows");

    expect(
      resolveInitialEnrollmentPlatform({
        marker: "not-a-platform",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        fallback: "apple",
      }),
    ).toBe("windows");
  });
});

describe("enrollment lookup failures", () => {
  it("treats an unknown or gone link as neutral, not expired", () => {
    expect(enrollmentLookupFailure(404)).toBe("invalid");
    expect(enrollmentLookupFailure(410)).toBe("invalid");
  });

  it("shows expired only for an explicit API signal", () => {
    expect(enrollmentLookupFailure(404, true)).toBe("expired");
    expect(enrollmentLookupFailure(410, true)).toBe("expired");
  });

  it("keeps authorization, throttling and server errors retryable", () => {
    expect(enrollmentLookupFailure(401)).toBe("unavailable");
    expect(enrollmentLookupFailure(403)).toBe("unavailable");
    expect(enrollmentLookupFailure(408)).toBe("unavailable");
    expect(enrollmentLookupFailure(429)).toBe("unavailable");
    expect(enrollmentLookupFailure(500)).toBe("unavailable");
    expect(enrollmentLookupFailure(503)).toBe("unavailable");
  });

  it("treats other client errors as an invalid link", () => {
    expect(enrollmentLookupFailure(400)).toBe("invalid");
  });
});
