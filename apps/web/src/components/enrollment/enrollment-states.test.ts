import { createComponent } from "solid-js";
import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";
import type { EnrollmentResponse } from "~/lib/enterprise";
import EnrollmentDetails from "./enrollment-details";
import {
  EnrollmentDeviceLimitNotice,
  EnrollmentLinkProblem,
  EnrollmentNotice,
} from "./enrollment-feedback";
import EnrollmentPasswordInput from "./enrollment-password-input";
import { deviceLimitCardDescription } from "~/lib/enrollment-presentation";

const authenticated = (
  overrides: Partial<Extract<EnrollmentResponse, { authenticated: true }>> = {},
): Extract<EnrollmentResponse, { authenticated: true }> => ({
  name: "Test Tenant",
  branding: {
    displayName: "Test Tenant",
    logo: null,
    supportEmail: "help@example.com",
    brandColor: "#1c1917",
  },
  authenticated: true,
  apple: { error: "Apple enrollment is disabled! Contact your administrator." },
  windows: { error: "Windows enrollment is disabled! Contact your administrator." },
  android: { error: "Android enrollment is disabled! Contact your administrator." },
  assetTag: false,
  ...overrides,
});

describe("enrollment password progressive enhancement", () => {
  it("server-renders a native password input without a client-only reveal control", () => {
    const html = renderToString(() =>
      createComponent(EnrollmentPasswordInput, {
        id: "enrollment-password",
        name: "code",
        autocomplete: "off",
        required: true,
      }),
    );

    expect(html).toContain('type="password"');
    expect(html).toContain('name="code"');
    expect(html).toContain("required");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("aria-controls");
    // Sizing stays on the primitive as a static class; spacing is owned by the
    // design system, not composed into the input by the client-only reveal.
    expect(html).toContain("h-12");
    expect(html).not.toContain("Show password");
    expect(html).not.toContain("<button");
  });
});

describe("enrollment details SSR", () => {
  it("renders serial, optional asset fields, and required custom questions", () => {
    const html = renderToString(() =>
      createComponent(EnrollmentDetails, {
        id: "enrollment-id",
        code: "secret-code",
        enrollment: authenticated({
          assetTag: true,
          questions: [
            { key: "owner", label: "Owner", type: "text", required: true, sortOrder: 0 },
            {
              key: "site",
              label: "Site",
              type: "select",
              options: ["HQ", "Remote"],
              required: true,
              sortOrder: 1,
            },
            { key: "loaner", label: "Loaner", type: "boolean", required: false, sortOrder: 2 },
          ],
        }),
        onSaved: () => undefined,
      }),
    );

    expect(html).toContain("Tell us about this device");
    expect(html).toContain('id="enrollment-serial"');
    expect(html).toContain('name="serial"');
    expect(html).toContain("Serial number");
    expect(html).toContain("Device name");
    expect(html).toContain("Asset tag");
    expect(html).toContain('id="enrollment-question-owner"');
    expect(html).toContain('name="answers[owner]"');
    expect(html).toContain("Owner");
    expect(html).toContain("(required)");
    expect(html).toContain('id="enrollment-question-site"');
    expect(html).toContain("HQ");
    expect(html).toContain("Remote");
    expect(html).toContain('id="enrollment-question-loaner"');
    expect(html).toContain("Yes");
    expect(html).toContain("No");
    expect(html).toContain("Continue to enrollment");
  });
});

describe("enrollment link problem SSR", () => {
  it.each([
    {
      status: "invalid" as const,
      title: "Ask your administrator for a new link",
      message: "It may have been reset or replaced.",
      href: "mailto:help@example.com",
    },
    {
      status: "expired" as const,
      title: "Ask your administrator for a new link",
      message: "Expired links cannot be used to enroll.",
      href: "mailto:help@example.com",
    },
    {
      status: "unavailable" as const,
      title: "Try again in a moment",
      message: "Check your connection, then reload this page.",
      href: "/enroll/enrollment-id?code=secret-code",
    },
  ])("renders the $status notice and its recovery action", ({ status, title, message, href }) => {
    const html = renderToString(() =>
      createComponent(EnrollmentLinkProblem, {
        status,
        reloadHref: "/enroll/enrollment-id?code=secret-code",
        supportEmail: "help@example.com",
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain(title);
    expect(html).toContain(message);
    expect(html).toContain('href="' + href + '"');
  });
});

describe("enrollment device-limit copy", () => {
  it("explains a reached allowance in the card description", () => {
    expect(deviceLimitCardDescription()).toContain("device limit");
    expect(deviceLimitCardDescription()).not.toContain("Choose your device type");
  });
});

describe("enrollment device-limit SSR", () => {
  it("explains the limit and offers administrator contact", () => {
    const html = renderToString(() =>
      createComponent(EnrollmentDeviceLimitNotice, {
        limit: 5,
        supportEmail: "help@example.com",
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Device limit reached");
    expect(html).toContain("This plan allows 5 devices.");
    expect(html).toContain("Contact administrator");
    expect(html).toContain('href="mailto:help@example.com"');
  });

  it("uses a status role for informational notices", () => {
    const html = renderToString(() =>
      createComponent(EnrollmentNotice, {
        tone: "info",
        title: "Device details saved",
        message: "Now choose your platform.",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
});
