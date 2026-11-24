import type { AndroidEnrollment, PlatformEnrollment, WindowsEnrollment } from "~/lib/enterprise";
import type { EnrollmentPlatform } from "~/lib/enrollment-platform";

export type EnrollmentLinkProblemStatus = "expired" | "invalid" | "unavailable";
export type EnrollmentNoticeTone = "info" | "warning" | "danger";

export const enrollmentPlatformLabel = (platform: EnrollmentPlatform): string =>
  platform === "apple" ? "Apple" : platform === "windows" ? "Windows" : "Android";

export const enrollmentLinkProblemCopy = (status: EnrollmentLinkProblemStatus) => {
  if (status === "unavailable")
    return {
      description: "Enrollment is temporarily unavailable.",
      title: "Try again in a moment",
      message:
        "Check your connection, then reload this page. Your administrator can confirm the enrollment service is available.",
      action: "reload" as const,
      actionLabel: "Reload page",
      tone: "warning" as const,
    };

  if (status === "expired")
    return {
      description: "This enrollment link has expired.",
      title: "Ask your administrator for a new link",
      message:
        "Expired links cannot be used to enroll. Request a fresh link, then open it on this device.",
      action: "contact" as const,
      actionLabel: "Contact administrator",
      tone: "warning" as const,
    };

  return {
    description: "This enrollment link is no longer valid.",
    title: "Ask your administrator for a new link",
    message: "It may have been reset or replaced. Open the current link on this device.",
    action: "contact" as const,
    actionLabel: "Contact administrator",
    tone: "warning" as const,
  };
};

export const enrollmentPlatformAvailable = (
  platform: EnrollmentPlatform,
  value: PlatformEnrollment | WindowsEnrollment | AndroidEnrollment,
): boolean => {
  if (typeof value !== "object" || value === null) return false;

  if (platform === "apple") return "profile" in value && typeof value.profile === "string";
  if (platform === "windows")
    return "discoveryUrl" in value && typeof value.discoveryUrl === "string";

  return "enrollmentToken" in value && typeof value.enrollmentToken === "string";
};

const platformError = (value: PlatformEnrollment | WindowsEnrollment | AndroidEnrollment) => {
  if (typeof value === "object" && value !== null && "error" in value) return value.error;

  return undefined;
};

export const enrollmentPlatformUnavailableCopy = (
  platform: EnrollmentPlatform,
  value: PlatformEnrollment | WindowsEnrollment | AndroidEnrollment,
) => {
  const label = enrollmentPlatformLabel(platform);
  const error = platformError(value);
  const detail = error
    ?.replace(/!\s*Contact your administrator\.?/i, "")
    .trim()
    .replace(/[.!?]+$/, "");

  if (/disabled/i.test(error ?? ""))
    return {
      title: `${label} enrollment is turned off`,
      message: `${label} enrollment is disabled. Ask your administrator to turn it on, then reload this page.`,
      tone: "warning" as const,
    };

  if (/not configured/i.test(error ?? ""))
    return {
      title: `${label} enrollment isn't set up yet`,
      message: `${detail}. Ask your administrator to finish setting it up, then reload this page.`,
      tone: "warning" as const,
    };

  if (/not connected/i.test(error ?? ""))
    return {
      title: `${label} enrollment isn't connected yet`,
      message: `${detail}. Ask your administrator to connect ${label} before enrolling this device.`,
      tone: "warning" as const,
    };

  if (/temporarily unavailable/i.test(error ?? ""))
    return {
      title: `${label} is temporarily unavailable`,
      message:
        "Try again in a moment. If this keeps happening, ask your administrator to check the enrollment service.",
      tone: "danger" as const,
    };

  if (/device limit/i.test(error ?? ""))
    return {
      title: "This organization can't enroll another device",
      message:
        "Ask your administrator about the device limit or remove an old device before enrolling another one.",
      tone: "warning" as const,
    };

  if (platform === "android" && value === "unavailable")
    return {
      title: "Android enrollment isn't connected yet",
      message:
        "Your administrator needs to connect Android Enterprise before you can enroll this device.",
      tone: "warning" as const,
    };

  return {
    title: `${label} enrollment isn't available`,
    message: detail
      ? `${detail}. Ask your administrator to check the ${label} enrollment setup.`
      : `Ask your administrator to check the ${label} enrollment setup, then reload this page.`,
    tone: "warning" as const,
  };
};

/** Pick the higher-contrast foreground for an arbitrary tenant brand colour. */
export const accessibleBrandForeground = (colour: string): "white" | "black" => {
  const hex = colour.trim().replace(/^#/, "");
  const expanded = /^[0-9a-f]{3}$/i.test(hex)
    ? hex
        .split("")
        .map((character) => character + character)
        .join("")
    : hex;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) return "white";

  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.05;

  return whiteContrast >= darkContrast ? "white" : "black";
};

/** Stable across SSR and hydration, and explicit about the time zone. */
export const formatEnrollmentDate = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return undefined;

  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
};
