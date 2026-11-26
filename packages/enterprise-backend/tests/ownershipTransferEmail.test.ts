import { describe, expect, it } from "vitest";
import { ownershipTransferEmail } from "../src/Mail/ownershipTransferEmail.ts";
import type { OwnershipTransferEmailInput } from "../src/Mail/ownershipTransferEmail.ts";
import { DEFAULT_BRAND_COLOR, resolveTenantBranding } from "@mattrax/enterprise-domain";
import { DEFAULT_EMAIL_BRAND_COLOR } from "../src/Mail/emailLayout.ts";

const base: OwnershipTransferEmailInput = {
  tenantName: "Acme",
  requesterName: "Ada Lovelace",
  targetEmail: "newowner@example.com",
  acceptUrl: "https://app.mattrax.app/accept-ownership?token=secret-token",
  expiresAt: new Date("2026-11-21T09:30:00.000Z"),
};

describe("ownershipTransferEmail", () => {
  it("puts the tenant in the subject", () => {
    expect(ownershipTransferEmail(base).subject).toBe("Take over Acme on Mattrax");
  });

  it("does not let tenant text inject mail headers", () => {
    const email = ownershipTransferEmail({
      ...base,
      tenantName: "Acme\r\nBcc: attacker@example.com",
    });

    expect(email.subject).toBe("Take over Acme Bcc: attacker@example.com on Mattrax");
    expect(email.subject).not.toContain("\n");
    expect(email.subject).not.toContain("\r");
  });

  it("includes the requester, target address, expiry and support", () => {
    const email = ownershipTransferEmail(base);

    for (const value of [
      "Ada Lovelace",
      "newowner@example.com",
      "21 November 2026 at 09:30 UTC",
      "hello@mattrax.app",
      "If you weren't expecting this",
    ]) {
      expect(email.text).toContain(value);
      expect(email.html).toContain(value);
    }
  });

  it("uses a custom support address and drops an invalid one", () => {
    const custom = ownershipTransferEmail({ ...base, supportEmail: "help@acme.test" });
    expect(custom.text).toContain("help@acme.test");
    expect(custom.html).toContain('href="mailto:help@acme.test"');

    const invalid = ownershipTransferEmail({ ...base, supportEmail: "not an address" });
    expect(invalid.text).toContain("hello@mattrax.app");
    expect(invalid.text).not.toContain("not an address");
  });

  it("renders exactly one ownership CTA with the given link", () => {
    const email = ownershipTransferEmail(base);

    expect(email.html.match(/data-cta="primary"/g) ?? []).toHaveLength(1);
    expect(email.text).toContain(base.acceptUrl);
    expect(email.html).toContain(`href="${base.acceptUrl}"`);
    expect(email.html).toContain("Accept ownership");
  });

  it("accepts an ISO string expiry", () => {
    const email = ownershipTransferEmail({ ...base, expiresAt: "2026-12-01T23:05:00.000Z" });

    expect(email.html).toContain("1 December 2026 at 23:05 UTC");
  });

  it("escapes tenant and requester text in HTML", () => {
    const email = ownershipTransferEmail({
      ...base,
      tenantName: `A & B <C> "D" 'E'`,
      requesterName: "<script>alert('x')</script>",
      targetEmail: "a<b>@example.com",
    });

    expect(email.html).toContain("A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;");
    expect(email.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(email.html).toContain("a&lt;b&gt;@example.com");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<C>");
  });

  it("renders a brand-coloured button and falls back for invalid colours", () => {
    const branded = ownershipTransferEmail({ ...base, brandColor: "#2563EB" });
    expect(branded.html).toContain("background:#2563eb;");

    const injected = ownershipTransferEmail({
      ...base,
      brandColor: "red;background:url(javascript:alert(1))",
    });

    expect(injected.html).not.toContain("url(");
    expect(injected.html).toContain(`background:${DEFAULT_EMAIL_BRAND_COLOR};`);
  });

  it("renders the resolved tenant default colour when none is set", () => {
    const branding = resolveTenantBranding({ name: "Acme" });
    const email = ownershipTransferEmail({ ...base, brandColor: branding.brandColor });

    expect(branding.brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(email.html).toContain("background:#1c1917;");
    expect(email.html).not.toContain("background:#6e56cf;");
  });

  it("renders a decorative logo on a light, ratio-safe chip", () => {
    const email = ownershipTransferEmail({
      ...base,
      logoUrl: "https://cdn.acme.test/logo-208x32.png",
    });

    expect(email.html).toContain('src="https://cdn.acme.test/logo-208x32.png"');
    expect(email.html).toContain('alt="" role="presentation"');
    expect(email.html).toContain("max-width:120px;max-height:28px");
    expect(email.html).toContain("width:auto;height:auto");
    expect(email.html).toContain('width="120" height="28"');
    expect(email.html).toContain('bgcolor="#ffffff"');
  });

  it("resolves root-relative logos and omits unloadable ones", () => {
    expect(ownershipTransferEmail({ ...base, logoUrl: "/assets/acme.png" }).html).toContain(
      'src="https://app.mattrax.app/assets/acme.png"',
    );

    for (const logoUrl of [
      "//cdn.acme.test/logo.png",
      "http://cdn.acme.test/logo.png",
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
    ])
      expect(ownershipTransferEmail({ ...base, logoUrl }).html).not.toContain("<img");
  });

  it("wraps long names and isolates RTL names", () => {
    const long = ownershipTransferEmail({ ...base, tenantName: "A".repeat(255) });
    expect(long.html).toContain("A".repeat(255));
    expect(long.html).toContain("overflow-wrap:anywhere");
    expect(long.html).toContain('dir="auto"');

    const rtl = ownershipTransferEmail({ ...base, tenantName: "شركة أكمي" });
    expect(rtl.html).toContain("شركة أكمي");
    expect(rtl.html).toContain("unicode-bidi:isolate");
  });

  it("renders plain-text content without HTML", () => {
    const email = ownershipTransferEmail(base);

    expect(email.text).not.toContain("<");
    expect(email.text).toContain("Accept the transfer by opening this link:");
    expect(email.text).toContain("— Mattrax");
  });
});
