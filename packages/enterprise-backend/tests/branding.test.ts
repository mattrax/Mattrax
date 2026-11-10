import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_SUPPORT_EMAIL,
  isLogoUrl,
  normalizeBrandColor,
  resolveTenantBranding,
  validateTenantBranding,
} from "@mattrax/enterprise-domain";

describe("tenant branding helpers", () => {
  it("falls back to Mattrax defaults for an unconfigured tenant", () => {
    expect(resolveTenantBranding({ name: "Acme" })).toEqual({
      displayName: "Acme",
      logo: null,
      supportEmail: DEFAULT_SUPPORT_EMAIL,
      brandColor: DEFAULT_BRAND_COLOR,
    });
  });

  it("resolves stored branding and expands short hex colours", () => {
    expect(
      resolveTenantBranding({
        name: "Acme",
        displayName: " Acme Corp ",
        logo: "https://cdn.example.com/logo.png",
        supportEmail: "help@acme.test",
        brandColor: "#ABC",
      }),
    ).toEqual({
      displayName: "Acme Corp",
      logo: "https://cdn.example.com/logo.png",
      supportEmail: "help@acme.test",
      brandColor: "#aabbcc",
    });
  });

  it("treats blank values as unset", () => {
    expect(
      resolveTenantBranding({
        name: "Acme",
        displayName: "   ",
        logo: "  ",
        supportEmail: "",
        brandColor: "",
      }),
    ).toMatchObject({
      displayName: "Acme",
      logo: null,
      supportEmail: DEFAULT_SUPPORT_EMAIL,
      brandColor: DEFAULT_BRAND_COLOR,
    });
  });

  it("validates brand colours, emails and logo URLs", () => {
    expect(normalizeBrandColor("#1C1917")).toBe("#1c1917");
    expect(normalizeBrandColor("#fff")).toBe("#ffffff");
    expect(normalizeBrandColor("blue")).toBeNull();
    expect(normalizeBrandColor("#12345")).toBeNull();

    expect(isLogoUrl("https://example.com/logo.svg")).toBe(true);
    expect(isLogoUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isLogoUrl("/static/logo.png")).toBe(true);
    expect(isLogoUrl("//evil.example/logo.png")).toBe(false);
    expect(isLogoUrl("javascript:alert(1)")).toBe(false);
    expect(isLogoUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);

    expect(
      validateTenantBranding({
        displayName: "Acme",
        logo: "https://example.com/logo.png",
        supportEmail: "help@acme.test",
        brandColor: "#abc",
      }),
    ).toEqual({});

    expect(
      validateTenantBranding({
        logo: "javascript:alert(1)",
        supportEmail: "help",
        brandColor: "blue",
      }),
    ).toEqual({
      logo: "Logo must be an http(s) URL, a data: image URL, or an absolute path",
      supportEmail: "Enter a valid support email address",
      brandColor: "Brand colour must be a hex value like #1c1917",
    });
  });
});
