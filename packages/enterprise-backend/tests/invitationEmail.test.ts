import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_COLOR } from "@mattrax/enterprise-domain";
import { invitationEmail } from "../src/Mail/invitationEmail.ts";
import type { InvitationEmailInput } from "../src/Mail/invitationEmail.ts";

const base: InvitationEmailInput = {
  tenantName: "Acme",
  roleLabel: "Administrator",
  inviterName: "Ada Lovelace",
  invitedEmail: "newhire@example.com",
  inviteUrl: "https://app.mattrax.app/accept-invitation?token=secret-token",
  expiresAt: new Date("2026-11-21T09:30:00.000Z"),
};

describe("invitationEmail", () => {
  it("puts the tenant in the subject", () => {
    const email = invitationEmail(base);

    expect(email.subject).toBe("Join Acme on Mattrax");
  });

  it("does not let tenant text inject mail headers", () => {
    const email = invitationEmail({
      ...base,
      tenantName: "Acme\r\nBcc: attacker@example.com",
    });

    expect(email.subject).toBe("Join Acme Bcc: attacker@example.com on Mattrax");
    expect(email.subject).not.toContain("\n");
    expect(email.subject).not.toContain("\r");
  });

  it("includes the inviter, role, invited address and support address", () => {
    const email = invitationEmail(base);

    for (const value of [
      "Ada Lovelace",
      "Administrator",
      "newhire@example.com",
      "hello@mattrax.app",
      "If you weren't expecting this, ignore this email",
    ]) {
      expect(email.text).toContain(value);
      expect(email.html).toContain(value);
    }
  });

  it("uses a custom support address when one is provided", () => {
    const email = invitationEmail({ ...base, supportEmail: "help@acme.test" });

    expect(email.text).toContain("help@acme.test");
    expect(email.html).toContain('href="mailto:help@acme.test"');
  });

  it("falls back to the default support address for an invalid one", () => {
    const email = invitationEmail({ ...base, supportEmail: "not an address" });

    expect(email.text).toContain("hello@mattrax.app");
    expect(email.text).not.toContain("not an address");
    expect(email.html).toContain('href="mailto:hello@mattrax.app"');
  });

  it("links to the invitation in both bodies exactly as given", () => {
    const email = invitationEmail(base);

    expect(email.text).toContain(base.inviteUrl);
    expect(email.html).toContain(`href="${base.inviteUrl}"`);
    // The token is never rendered outside the invitation link.
    expect(email.text.split("secret-token")).toHaveLength(2);
  });

  it("shows the exact expiry in UTC", () => {
    const email = invitationEmail(base);

    expect(email.text).toContain("expires on 21 November 2026 at 09:30 UTC");
    expect(email.html).toContain("Expires: 21 November 2026 at 09:30 UTC");
  });

  it("accepts an ISO string expiry", () => {
    const email = invitationEmail({ ...base, expiresAt: "2026-12-01T23:05:00.000Z" });

    expect(email.text).toContain("1 December 2026 at 23:05 UTC");
  });

  it("escapes tenant-controlled text in the HTML body", () => {
    const email = invitationEmail({
      ...base,
      tenantName: "A & B <C> \"D\" 'E'",
      inviterName: "<script>alert('x')</script>",
      roleLabel: "owner & <admin>",
      invitedEmail: "a<b>@example.com",
    });

    expect(email.html).toContain("A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;");
    expect(email.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(email.html).toContain("owner &amp; &lt;admin&gt;");
    expect(email.html).toContain("a&lt;b&gt;@example.com");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<admin>");
  });

  it("renders a brand-coloured button and falls back for invalid colours", () => {
    const branded = invitationEmail({ ...base, brandColor: "#2563EB" });
    expect(branded.html).toContain("background:#2563eb;");

    const injected = invitationEmail({
      ...base,
      brandColor: "red;background:url(javascript:alert(1))",
    });

    expect(injected.html).not.toContain("url(");
    expect(injected.html).toContain(`background:${DEFAULT_BRAND_COLOR};`);
  });

  it("includes a logo only for absolute https URLs", () => {
    const logo = "https://cdn.acme.test/logo.png?tenant=acme&size=2";
    const email = invitationEmail({ ...base, logoUrl: logo });

    expect(email.html).toContain(
      `<img src="https://cdn.acme.test/logo.png?tenant=acme&amp;size=2"`,
    );
    expect(email.html).toContain('alt="Acme"');
  });

  it.each([
    ["relative", "/logo.png"],
    ["protocol-relative", "//cdn.acme.test/logo.png"],
    ["plain http", "http://cdn.acme.test/logo.png"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data URL", "data:image/png;base64,iVBORw0KGgo="],
    ["not a URL", "not a url"],
  ])("omits the %s logo", (_label, logoUrl) => {
    const email = invitationEmail({ ...base, logoUrl });

    expect(email.html).not.toContain("<img");
  });

  it("renders plain-text content without HTML", () => {
    const email = invitationEmail(base);

    expect(email.text).not.toContain("<");
    expect(email.text).toContain("Accept the invitation by opening this link:");
    expect(email.text).toContain("— Mattrax");
  });
});
