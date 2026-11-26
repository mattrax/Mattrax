import { describe, expect, it } from "vitest";
import { onboardingFollowUpEmail, welcomeEmail } from "../src/Tenant/onboardingEmail.ts";
import type {
  OnboardingFollowUpEmailInput,
  WelcomeEmailInput,
} from "../src/Tenant/onboardingEmail.ts";
import { buttonTextColor, contrastRatio } from "../src/Mail/emailTemplate.ts";

const welcome: WelcomeEmailInput = {
  firstName: "Ada",
  dashboardUrl: "https://app.mattrax.app/dashboard",
  createTenantUrl: "https://app.mattrax.app/tenants/new",
  replyTo: "oscar@mattrax.app",
};

const followUp: OnboardingFollowUpEmailInput = {
  firstName: "Ada",
  tenantName: "Acme",
  dashboardUrl: "https://app.mattrax.app/dashboard",
  enrollUrl: "https://app.mattrax.app/t/acme/enrollment",
  replyTo: "oscar@mattrax.app",
  daysSinceCreation: 7,
};

const wordsBetween = (text: string, start: string, end: string): number => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);

  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);

  return text.slice(from, to).split(/\s+/).filter(Boolean).length;
};

describe("welcomeEmail", () => {
  it("uses the welcome subject", () => {
    expect(welcomeEmail(welcome).subject).toBe("Welcome to Mattrax");
  });

  it("greets by first name when one is present", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain("Hey Ada,");
    expect(email.html).toContain("Hey Ada,");
  });

  it("falls back to a plain greeting without a first name", () => {
    const email = welcomeEmail({ ...welcome, firstName: undefined });

    expect(email.text).toContain("Hey,\n");
    expect(email.text).not.toContain("undefined");
    expect(email.html).not.toContain("undefined");
  });

  it("links to tenant creation and the dashboard in both bodies", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain(welcome.createTenantUrl);
    expect(email.text).toContain(welcome.dashboardUrl);
    expect(email.html).toContain(`href="${welcome.createTenantUrl}"`);
    expect(email.html).toContain(`href="${welcome.dashboardUrl}"`);
  });

  it("starts with creating a tenant, not a tenantless enrolment link", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain(`Create your tenant: ${welcome.createTenantUrl}`);
    expect(email.html).toContain(`href="${welcome.createTenantUrl}"`);
    expect(email.text).toContain("Create your tenant");
    expect(email.text).toContain("Set a baseline policy");
    expect(email.text).toContain("Enrol your first device");
    expect(email.text).not.toContain("/enrollment");
    expect(email.html).not.toContain("/enrollment");
  });

  it("keeps the deprecated enrolment input as an additional step link", () => {
    const enrollUrl = "https://app.mattrax.app/t/acme/enrollment";

    const email = welcomeEmail({ ...welcome, enrollUrl });

    expect(email.text).toContain(`Open enrolment: ${enrollUrl}`);
    expect(email.html).toContain(`href="${enrollUrl}"`);
  });

  it("defaults tenant creation to /tenants/new on the dashboard origin", () => {
    const email = welcomeEmail({ ...welcome, createTenantUrl: null });

    expect(email.text).toContain("Create your tenant: https://app.mattrax.app/tenants/new");
    expect(email.html).toContain('href="https://app.mattrax.app/tenants/new"');
  });

  it("renders the reply-to line and address", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain("Questions? Reply to this email and it comes straight to me.");
    expect(email.text).toContain("I read every reply.");
    expect(email.text).toContain("Replies go to oscar@mattrax.app.");
    expect(email.html).toContain("Reply to this email and it comes straight to me.");
  });

  it("signs off as Oscar, Founder of Mattrax for the default brand", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain("Oscar\nFounder, Mattrax");
    expect(email.html).toContain("Founder, Mattrax");
  });

  it("does not claim to be a founder of a white-label brand", () => {
    const email = welcomeEmail({ ...welcome, brandName: "Acme Device Management" });

    expect(email.text).toContain("Oscar\nThe Mattrax team");
    expect(email.text).not.toContain("Founder, Acme");
    expect(email.html).toContain("The Mattrax team");
  });

  it("escapes HTML in the first name", () => {
    const email = welcomeEmail({
      ...welcome,
      firstName: `A & B <C> "D" 'E'`,
    });

    expect(email.html).toContain("Hey A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;,");
    expect(email.html).not.toContain("<C>");
  });

  it("does not let the first name inject mail headers", () => {
    const email = welcomeEmail({
      ...welcome,
      firstName: "Ada\r\nBcc: attacker@example.com",
    });

    expect(email.text).toContain("Hey Ada Bcc: attacker@example.com,");
    expect(email.html).not.toMatch(/[\r\n]Bcc:/);
  });

  it("has exactly one primary CTA, pointing at the dashboard", () => {
    const email = welcomeEmail(welcome);
    const ctas = email.html.match(/data-cta="primary"/g) ?? [];

    expect(ctas).toHaveLength(1);
    expect(email.html).toMatch(
      /<a data-cta="primary" href="https:\/\/app\.mattrax\.app\/dashboard"/,
    );
    expect(email.text).toContain(`Open your dashboard: ${welcome.dashboardUrl}`);
  });

  it("shows the dashboard URL as visible text", () => {
    const email = welcomeEmail(welcome);

    expect(email.html).toContain(welcome.dashboardUrl);
    expect(email.html).toContain("Or paste this link into your browser:");
  });

  it("links to the quick start on the dashboard origin", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain(
      "Read the quick start: https://app.mattrax.app/docs/getting-started/quick-start",
    );
    expect(email.html).toContain('href="https://app.mattrax.app/docs/getting-started/quick-start"');
  });

  it("keeps the welcome body concise", () => {
    const body = wordsBetween(
      welcomeEmail(welcome).text,
      "Your account is ready. Create a tenant",
      "\n\nOscar\n",
    );

    expect(body).toBeGreaterThanOrEqual(70);
    expect(body).toBeLessThanOrEqual(180);
  });

  it("includes support and unsubscribe details only when provided", () => {
    const bare = welcomeEmail(welcome);

    expect(bare.text).not.toContain("Unsubscribe");
    expect(bare.html).not.toContain("Unsubscribe");
    expect(bare.text).not.toContain("Need help?");

    const full = welcomeEmail({
      ...welcome,
      supportEmail: "help@acme.test",
      unsubscribeUrl: "https://app.mattrax.app/unsubscribe?token=abc",
    });

    expect(full.text).toContain("Need help? Contact help@acme.test.");
    expect(full.html).toContain('href="mailto:help@acme.test"');
    expect(full.text).toContain("Unsubscribe: https://app.mattrax.app/unsubscribe?token=abc");
    expect(full.html).toContain('href="https://app.mattrax.app/unsubscribe?token=abc"');
  });

  it("drops an invalid optional support address instead of rendering it", () => {
    const email = welcomeEmail({ ...welcome, supportEmail: "not an address" });

    expect(email.text).not.toContain("not an address");
    expect(email.html).not.toContain("not an address");
    expect(email.html).not.toContain('href="mailto:not an address"');
  });

  it("rejects an invalid reply-to address", () => {
    expect(() => welcomeEmail({ ...welcome, replyTo: "not an address" })).toThrow(
      "replyTo must be a valid email address",
    );
  });

  it.each([
    ["relative dashboard", { dashboardUrl: "/dashboard" }],
    ["javascript dashboard", { dashboardUrl: "javascript:alert(1)" }],
    ["relative tenant creation", { createTenantUrl: "/tenants/new" }],
    ["ftp tenant creation", { createTenantUrl: "ftp://example.com/tenants/new" }],
    ["relative unsubscribe", { unsubscribeUrl: "/unsubscribe" }],
    ["relative docs", { docsUrl: "/docs" }],
  ])("rejects an %s", (_label, patch) => {
    expect(() => welcomeEmail({ ...welcome, ...patch })).toThrow(/absolute http\(s\) URL/);
  });

  it("never renders undefined or NaN", () => {
    for (const email of [welcomeEmail(welcome), welcomeEmail({ ...welcome, firstName: null })]) {
      expect(email.text).not.toMatch(/undefined|NaN/);
      expect(email.html).not.toMatch(/undefined|NaN/);
    }
  });

  it("keeps plain text free of HTML", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).not.toContain("<");
    expect(email.html).toContain("<!doctype html>");
  });

  it("uses the tenant brand name, colour and logo when supplied", () => {
    const email = welcomeEmail({
      ...welcome,
      brandName: "Acme Device Management",
      brandColor: "#2563EB",
      logoUrl: "https://cdn.acme.test/logo.png?tenant=acme&size=2",
      supportEmail: "help@acme.test",
      accountEmail: "ada@acme.test",
    });

    expect(email.subject).toBe("Welcome to Acme Device Management");
    expect(email.text).toContain("Acme Device Management");
    expect(email.text).toContain(
      "You're receiving this because the Acme Device Management account ada@acme.test was created.",
    );
    expect(email.html).toContain("background:#2563eb;");
    expect(email.html).toContain('src="https://cdn.acme.test/logo.png?tenant=acme&amp;size=2"');
    expect(email.html).toContain('href="mailto:help@acme.test"');
  });

  it("keeps the text brand mark and wordmark when images are blocked", () => {
    const email = welcomeEmail({
      ...welcome,
      brandName: "Acme",
      logoUrl: "https://cdn.acme.test/logo.png",
    });

    // The coloured square is aria-hidden decoration and the wordmark is the
    // accessible brand; the logo is decorative, so a blocked image leaves both.
    expect(email.html).toContain('aria-hidden="true" class="email-mark"');
    expect(email.html).toContain(">A</td>");
    expect(email.html).toContain("Acme</td>");
    expect(email.html).toContain('alt="" role="presentation"');
  });

  it("preserves logo aspect ratio and puts it on a light chip", () => {
    for (const logoUrl of [
      "https://cdn.acme.test/logo-208x32.png",
      "https://cdn.acme.test/logo-wide-600x40.png",
    ]) {
      const email = welcomeEmail({ ...welcome, logoUrl });

      expect(email.html).toContain("max-width:120px;max-height:28px");
      expect(email.html).toContain("width:auto;height:auto");
      expect(email.html).toContain('width="120" height="28"');
      expect(email.html).toContain('bgcolor="#ffffff"');
      expect(email.html).toContain("border:1px solid #e5e5df;border-radius:6px");
    }
  });

  it("resolves a root-relative logo against the dashboard origin", () => {
    const email = welcomeEmail({ ...welcome, logoUrl: "/assets/acme.png" });

    expect(email.html).toContain('src="https://app.mattrax.app/assets/acme.png"');
  });

  it("omits logos that email clients cannot load", () => {
    for (const logoUrl of [
      "//cdn.acme.test/logo.png",
      "http://cdn.acme.test/logo.png",
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
    ]) {
      const email = welcomeEmail({ ...welcome, logoUrl });

      expect(email.html).not.toContain("<img");
    }
  });

  it("renders real email-client structure rather than a marker", () => {
    const email = welcomeEmail(welcome);

    expect(email.html).toContain('<meta name="color-scheme" content="light dark" />');
    expect(email.html).toContain('<meta name="supported-color-schemes" content="light dark" />');
    expect(email.html).toContain("@media (prefers-color-scheme: dark)");
    expect(email.html).toContain("[data-ogsc]");
    expect(email.html).toContain("<!--[if mso]>");
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain('class="email-card"');
    expect(email.html).toContain('bgcolor="#e9e9e6"');
    expect(email.html).toContain('bgcolor="#ffffff"');
    expect(email.html).toContain("border-spacing:0");
    expect(email.html).toContain("mso-table-lspace:0pt");
    expect(email.html).toContain('dir="auto"');
    expect(email.html).toContain("overflow-wrap:anywhere");
    expect(email.html).not.toContain('<div style="max-width:520px');
  });

  it("escapes every user-controlled value in HTML", () => {
    const email = welcomeEmail({
      ...welcome,
      firstName: "<script>alert('x')</script>",
      brandName: "A & B <C> \"D\" 'E'",
      accountEmail: "ada+<x>@example.com",
      logoUrl: "https://cdn.acme.test/logo.png?tenant=a&next=b",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<C>");
    expect(email.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(email.html).toContain("A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;");
    expect(email.html).toContain("ada+&lt;x&gt;@example.com");
    expect(email.html).toContain("tenant=a&amp;next=b");
  });

  it("wraps a 255-character unbroken brand name and isolates it", () => {
    const brandName = "A".repeat(255);
    const email = welcomeEmail({ ...welcome, brandName });

    expect(email.html).toContain(brandName);
    expect(email.html).toContain('dir="auto"');
    expect(email.html).toContain("unicode-bidi:isolate");
    expect(email.html).toContain("overflow-wrap:anywhere");
    // English copy keeps an explicit LTR base direction; the name is isolated
    // inside it rather than flipping the paragraph.
    expect(email.html).toContain('dir="ltr"');
    expect(email.html).not.toContain('dir="auto" class="email-heading"');
  });

  it("isolates RTL brand names inside English copy", () => {
    const email = welcomeEmail({ ...welcome, brandName: "شركة أكمي" });

    expect(email.html).toContain("شركة أكمي");
    expect(email.html).toContain('dir="auto"');
    expect(email.html).toContain("unicode-bidi:isolate");
  });

  it("chooses WCAG AA contrast for mid-tone and light brand colours", () => {
    expect(buttonTextColor("#16a34a")).toBe("#1c1917");
    expect(buttonTextColor("#999999")).toBe("#1c1917");
    expect(buttonTextColor("#2563eb")).toBe("#ffffff");

    for (const background of [
      "#16a34a",
      "#999999",
      "#808080",
      "#777777",
      "#7f7f7f",
      "#2563eb",
      "#ffffff",
      "#000000",
    ]) {
      const chosen = buttonTextColor(background);

      expect(contrastRatio(background, chosen)).toBeGreaterThanOrEqual(4.5);
    }

    // These three are the boundary the old white/near-black pair missed.
    for (const background of ["#808080", "#777777", "#7f7f7f"]) {
      expect(buttonTextColor(background)).toBe("#000000");
      expect(contrastRatio(background, buttonTextColor(background))).toBeGreaterThanOrEqual(4.5);
    }

    const midTone = welcomeEmail({ ...welcome, brandColor: "#16a34a" });
    expect(midTone.html).toContain("background:#16a34a;");
    expect(midTone.html).toContain("color:#1c1917;");

    const boundary = welcomeEmail({ ...welcome, brandColor: "#808080" });
    expect(boundary.html).toContain("background:#808080;");
    expect(boundary.html).toContain("color:#000000;");

    const nearWhite = welcomeEmail({ ...welcome, brandColor: "#ffffff" });
    expect(nearWhite.html).toContain("color:#1c1917;");
    expect(nearWhite.html).toContain("border:1px solid #d6d6cf;");
  });
});

describe("onboardingFollowUpEmail", () => {
  it("uses the follow-up subject", () => {
    expect(onboardingFollowUpEmail(followUp).subject).toBe("Did you get a chance to try Mattrax?");
  });

  it("mentions the tenant and the missing device", () => {
    const email = onboardingFollowUpEmail(followUp);

    expect(email.text).toContain("since you set up Acme on Mattrax");
    expect(email.text).toContain("no device has enrolled yet");
    expect(email.text).toContain("Did something get in the way?");
    expect(email.html).toContain("It's been 7 days since you set up");
    expect(email.html).toContain("Acme");
    expect(email.html).toContain("no device has enrolled yet");
    expect(email.html).toContain("Did something get in the way?");
  });

  it("greets by first name or falls back", () => {
    expect(onboardingFollowUpEmail(followUp).text).toContain("Hey Ada,");
    expect(onboardingFollowUpEmail({ ...followUp, firstName: undefined }).text).toContain("Hey,\n");
  });

  it("uses a supplied day count deterministically", () => {
    expect(onboardingFollowUpEmail(followUp).text).toContain("It's been 7 days");
    expect(onboardingFollowUpEmail({ ...followUp, daysSinceCreation: 1 }).text).toContain(
      "It's been 1 day",
    );
    expect(onboardingFollowUpEmail({ ...followUp, daysSinceCreation: undefined }).text).toContain(
      "It's been about a week",
    );
  });

  it("offers both an enrolment CTA and a reply path", () => {
    const email = onboardingFollowUpEmail(followUp);

    expect(email.html.match(/data-cta="primary"/g) ?? []).toHaveLength(1);
    expect(email.html).toContain('href="https://app.mattrax.app/t/acme/enrollment"');
    expect(email.text).toContain(
      "Finish enrolling a device: https://app.mattrax.app/t/acme/enrollment",
    );
    expect(email.text).toContain("Reply and tell me where you got stuck: oscar@mattrax.app");
    expect(email.html).toContain('href="mailto:oscar@mattrax.app"');
  });

  it("renders the reply-to line, signature and a walkthrough offer", () => {
    const email = onboardingFollowUpEmail(followUp);

    expect(email.text).toContain("Reply to this email and it comes straight to me.");
    expect(email.text).toContain("Oscar\nFounder, Mattrax");
    expect(email.text).toContain("walkthrough");
    expect(email.html).toContain("Founder, Mattrax");
  });

  it("escapes tenant and first-name text in HTML", () => {
    const email = onboardingFollowUpEmail({
      ...followUp,
      tenantName: `A & B <C> "D" 'E'`,
      firstName: "<script>alert('x')</script>",
    });

    expect(email.html).toContain("Hey &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;,");
    expect(email.html).toContain("A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;");
    expect(email.html).not.toContain("<script>");
  });

  it("collapses header injection in the tenant name", () => {
    const email = onboardingFollowUpEmail({
      ...followUp,
      tenantName: "Acme\r\nBcc: attacker@example.com",
    });

    expect(email.text).toContain("since you set up Acme Bcc: attacker@example.com on Mattrax");
    expect(email.text).not.toContain("\r");
    expect(email.html).not.toMatch(/[\r\n]Bcc:/);
  });

  it("keeps the follow-up body between 120 and 180 words", () => {
    const body = wordsBetween(
      onboardingFollowUpEmail(followUp).text,
      "A quick check-in",
      "\n\nOscar\n",
    );

    expect(body).toBeGreaterThanOrEqual(120);
    expect(body).toBeLessThanOrEqual(180);
  });

  it("includes unsubscribe only when provided", () => {
    expect(onboardingFollowUpEmail(followUp).text).not.toContain("Unsubscribe");

    const email = onboardingFollowUpEmail({
      ...followUp,
      unsubscribeUrl: "https://app.mattrax.app/unsubscribe?tenant=acme",
    });

    expect(email.text).toContain("Unsubscribe: https://app.mattrax.app/unsubscribe?tenant=acme");
    expect(email.html).toContain('href="https://app.mattrax.app/unsubscribe?tenant=acme"');
  });

  it("validates URLs and the reply-to address", () => {
    expect(() => onboardingFollowUpEmail({ ...followUp, dashboardUrl: "/dashboard" })).toThrow(
      /absolute http\(s\) URL/,
    );
    expect(() => onboardingFollowUpEmail({ ...followUp, replyTo: "nope" })).toThrow(
      "replyTo must be a valid email address",
    );
  });

  it("never renders undefined or NaN", () => {
    for (const email of [
      onboardingFollowUpEmail(followUp),
      onboardingFollowUpEmail({ ...followUp, daysSinceCreation: Number.NaN }),
    ]) {
      expect(email.text).not.toMatch(/undefined|NaN/);
      expect(email.html).not.toMatch(/undefined|NaN/);
    }
  });

  it("keeps plain text free of HTML", () => {
    const email = onboardingFollowUpEmail(followUp);

    expect(email.text).not.toContain("<");
    expect(email.html).toContain("<!doctype html>");
  });
});
