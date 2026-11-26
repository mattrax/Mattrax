import { describe, expect, it } from "vitest";
import { welcomeEmail } from "@mattrax/enterprise-backend";
import { resolveDeploymentBranding } from "./onboardingBranding.ts";

describe("deployment onboarding branding", () => {
  it("is undefined when the deployment has no branding", () => {
    expect(resolveDeploymentBranding({})).toBeUndefined();
    expect(
      resolveDeploymentBranding({
        MATTRAX_BRAND_NAME: " ",
        MATTRAX_BRAND_LOGO_URL: " ",
        MATTRAX_BRAND_COLOR: " ",
      }),
    ).toBeUndefined();
  });

  it("passes deployment values into the welcome email", () => {
    const branding = resolveDeploymentBranding({
      MATTRAX_BRAND_NAME: "Acme Device Management",
      MATTRAX_BRAND_LOGO_URL: "/assets/acme.png",
      MATTRAX_BRAND_COLOR: "#16a34a",
    });

    expect(branding).toEqual({
      brandName: "Acme Device Management",
      logoUrl: "/assets/acme.png",
      brandColor: "#16a34a",
    });

    const email = welcomeEmail({
      firstName: "Ada",
      dashboardUrl: "https://mdm.acme.test/dashboard",
      replyTo: "help@acme.test",
      ...branding,
    });

    expect(email.subject).toBe("Welcome to Acme Device Management");
    expect(email.html).toContain('src="https://mdm.acme.test/assets/acme.png"');
    expect(email.html).toContain("background:#16a34a;");
  });
});
