import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";
import type {
  AndroidEnrollment,
  EnrollmentResponse,
  PlatformEnrollment,
  WindowsEnrollment,
} from "~/lib/enterprise";
import { EnrollmentOptions } from "./enrollment-platforms";

const enrollment = (input: {
  apple?: PlatformEnrollment;
  windows?: WindowsEnrollment;
  android?: AndroidEnrollment;
  brandColor?: string;
}): Extract<EnrollmentResponse, { authenticated: true }> => ({
  name: "Test Tenant",
  branding: {
    displayName: "Test Tenant",
    logo: null,
    supportEmail: "help@example.com",
    brandColor: input.brandColor ?? "#1c1917",
  },
  authenticated: true,
  apple: { error: "Apple enrollment is disabled! Contact your administrator." },
  windows: { error: "Windows enrollment is disabled! Contact your administrator." },
  android: { error: "Android enrollment is disabled! Contact your administrator." },
  assetTag: false,
  ...input,
});

const renderOptions = (value: Extract<EnrollmentResponse, { authenticated: true }>) =>
  renderToString(() =>
    createComponent(EnrollmentOptions, {
      id: "enrollment-id",
      code: "secret code",
      brandColor: value.branding.brandColor,
      supportEmail: value.branding.supportEmail,
      enrollment: value,
    }),
  );

describe("enrollment platform panels", () => {
  it("renders an enabled Apple profile with its credential-bearing URL", () => {
    const html = renderOptions(enrollment({ apple: { profile: "plist" } }));

    expect(html).toContain("Enroll an Apple device");
    expect(html).toContain("Install Apple profile");
    expect(html).toContain(
      "/api/v1/enrollment/enrollment-id/apple.mobileconfig?code=secret%20code",
    );
    expect(html).toContain("Ready to enroll");
    expect(html).toContain('data-available="true"');
  });

  it("uses dark text on a light tenant brand colour", () => {
    expect(
      renderOptions(enrollment({ apple: { profile: "plist" }, brandColor: "#facc15" })),
    ).toContain("color:#111111");
  });

  it("renders an enabled Windows discovery link and setup steps", () => {
    const html = renderOptions(
      enrollment({
        windows: {
          discoveryUrl: "https://mdm.example.com/mdm/windows/discovery?tenant=signed",
          tenantScoped: true,
          expiresAt: "2026-12-01T10:30:00.000Z",
        },
      }),
    );

    expect(html).toContain("Enroll a Windows device");
    expect(html).toContain("https://mdm.example.com/mdm/windows/discovery?tenant=signed");
    expect(html).toContain("Copy Windows discovery URL");
    expect(html).toContain("scoped to your organization");
    expect(html).toContain("UTC");
  });

  it.each(["work-profile", "fully-managed", "dedicated"] as const)(
    "renders the %s Android flow with a QR SVG and manual fallback",
    (provisioningMode) => {
      const token = "android-enrollment-token";
      const html = renderOptions(
        enrollment({
          android: {
            qrCode: JSON.stringify({ token }),
            enrollmentToken: token,
            provisioningMode,
            expiresAt: "2026-12-01T10:30:00.000Z",
          },
        }),
      );

      expect(html).toContain("Enroll an Android device");
      expect(html).toContain('aria-label="Android enrollment QR code"');
      expect(html).toContain("<svg");
      expect(html).toContain("afw#setup");
      expect(html).toContain(token);
      if (provisioningMode === "fully-managed") expect(html).toContain("company-owned device");
      if (provisioningMode === "dedicated") expect(html).toContain("set up this device for work");
      if (provisioningMode === "work-profile") expect(html).toContain("tap six times");
    },
  );

  it("keeps manual Android enrollment usable when no QR payload is returned", () => {
    const html = renderOptions(
      enrollment({
        android: {
          qrCode: null,
          enrollmentToken: "manual-token",
          provisioningMode: "work-profile",
        },
      }),
    );

    expect(html).toContain("Use the enrollment token below");
    expect(html).not.toContain('aria-label="Android enrollment QR code"');
    expect(html).toContain("manual-token");
  });

  it("explains disabled platforms instead of exposing dead actions", () => {
    const html = renderOptions(enrollment({}));

    expect(html).toContain("Apple enrollment is turned off");
    expect(html).toContain("Windows enrollment is turned off");
    expect(html).toContain("Android enrollment is turned off");
    expect(html).not.toContain("Install Apple profile");
    expect(html).not.toContain("Copy Windows discovery URL");
    expect(html).toContain('data-available="false"');
    expect(html).toContain("You do not need to erase or reset your device");
  });

  it("keeps every tab connected to a rendered panel", () => {
    const html = renderOptions(enrollment({}));

    for (const platform of ["apple", "windows", "android"]) {
      expect(html).toContain('id="enrollment-tab-' + platform + '"');
      expect(html).toContain('id="enrollment-panel-' + platform + '"');
      expect(html).toContain('aria-controls="enrollment-panel-' + platform + '"');
    }
  });
});
