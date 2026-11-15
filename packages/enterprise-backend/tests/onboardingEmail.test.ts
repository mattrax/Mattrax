import { describe, expect, it } from "vitest";
import {
  onboardingFollowUpEmail,
  welcomeEmail,
  type OnboardingFollowUpEmailInput,
  type WelcomeEmailInput,
} from "../src/onboardingEmail.js";

const welcome: WelcomeEmailInput = {
  firstName: "Ada",
  dashboardUrl: "https://app.mattrax.app/dashboard",
  enrollUrl: "https://app.mattrax.app/enrol?platform=apple",
  replyTo: "oscar@mattrax.app",
};

const followUp: OnboardingFollowUpEmailInput = {
  firstName: "Ada",
  tenantName: "Acme",
  dashboardUrl: "https://app.mattrax.app/dashboard",
  enrollUrl: "https://app.mattrax.app/enrol?platform=apple",
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
    expect(welcomeEmail(welcome).text).toContain("Hey Ada,");
    expect(welcomeEmail(welcome).html).toContain("Hey Ada,");
  });

  it("falls back to a plain greeting without a first name", () => {
    const email = welcomeEmail({ ...welcome, firstName: undefined });

    expect(email.text).toContain("Hey,\n");
    expect(email.text).not.toContain("undefined");
    expect(email.html).not.toContain("undefined");
  });

  it("puts the enrolment and dashboard links in both bodies", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain(welcome.enrollUrl);
    expect(email.text).toContain(welcome.dashboardUrl);
    expect(email.html).toContain(`href="${welcome.enrollUrl}"`);
    expect(email.html).toContain(`href="${welcome.dashboardUrl}"`);
  });

  it("renders the reply-to line and address", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain("Reply to this email and it comes straight to me.");
    expect(email.text).toContain("Replies go to oscar@mattrax.app.");
    expect(email.text).toContain("what you expected versus what actually happened");
    expect(email.html).toContain("Reply to this email and it comes straight to me.");
  });

  it("signs off as Oscar, Founder of Mattrax", () => {
    const email = welcomeEmail(welcome);

    expect(email.text).toContain("Oscar\nFounder, Mattrax");
    expect(email.html).toContain("Oscar<br />Founder, Mattrax");
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

  it("has exactly one primary CTA pointing at enrolment", () => {
    const email = welcomeEmail(welcome);
    const ctas = email.html.match(/data-cta="primary"/g) ?? [];

    expect(ctas).toHaveLength(1);
    expect(email.html).toMatch(
      /<a data-cta="primary" href="https:\/\/app\.mattrax\.app\/enrol\?platform=apple"/,
    );
  });

  it("falls back to the dashboard when no enrolment URL is given", () => {
    const email = welcomeEmail({ ...welcome, enrollUrl: null });

    expect(email.html).toMatch(
      /<a data-cta="primary" href="https:\/\/app\.mattrax\.app\/dashboard"/,
    );
    expect(email.text).toContain(`Enrol your first device: ${welcome.dashboardUrl}`);
  });

  it("shows the fallback URL as visible text", () => {
    const email = welcomeEmail(welcome);

    expect(email.html).toContain(welcome.enrollUrl);
    expect(email.html).toContain("Or paste this link into your browser:");
  });

  it("keeps the welcome body between 150 and 200 words", () => {
    const body = wordsBetween(welcomeEmail(welcome).text, "Thanks for signing up", "\n\nOscar\n");

    expect(body).toBeGreaterThanOrEqual(150);
    expect(body).toBeLessThanOrEqual(200);
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
    ["relative enrolment", { enrollUrl: "/enrol" }],
    ["ftp enrolment", { enrollUrl: "ftp://example.com/enrol" }],
    ["relative unsubscribe", { unsubscribeUrl: "/unsubscribe" }],
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
    expect(email.html).toContain("since you set up Acme on Mattrax");
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
    expect(email.html).toContain('href="https://app.mattrax.app/enrol?platform=apple"');
    expect(email.text).toContain("Finish enrolling a device: https://app.mattrax.app/enrol");
    expect(email.text).toContain("Reply and tell me where you got stuck: oscar@mattrax.app");
    expect(email.html).toContain('href="mailto:oscar@mattrax.app"');
  });

  it("renders the reply-to line, signature and a walkthrough offer", () => {
    const email = onboardingFollowUpEmail(followUp);

    expect(email.text).toContain("Reply to this email and it comes straight to me.");
    expect(email.text).toContain("Oscar\nFounder, Mattrax");
    expect(email.text).toContain("walkthrough");
    expect(email.html).toContain("Oscar<br />Founder, Mattrax");
  });

  it("escapes tenant and first-name text in HTML", () => {
    const email = onboardingFollowUpEmail({
      ...followUp,
      tenantName: `A & B <C> "D" 'E'`,
      firstName: "<script>alert('x')</script>",
    });

    expect(email.html).toContain("Hey &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;,");
    expect(email.html).toContain("set up A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; on Mattrax");
    expect(email.html).not.toContain("<script>");
  });

  it("collapses header injection in the tenant name", () => {
    const email = onboardingFollowUpEmail({
      ...followUp,
      tenantName: "Acme\r\nBcc: attacker@example.com",
    });

    expect(email.text).toContain("set up Acme Bcc: attacker@example.com on Mattrax");
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
