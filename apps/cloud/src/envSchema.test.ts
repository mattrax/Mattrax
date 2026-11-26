import { createHmac } from "node:crypto";
import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { relaySignature } from "@mattrax/apns";
import { resolveApiEnv } from "./envSchema.js";

const base = {
  ORIGIN: "http://localhost:9050",
  AUTH_SECRET: "local-development-auth-secret-0123456789abcdef",
};

describe("deployment branding environment resolution", () => {
  it("exposes the deployment brand without inventing values", () => {
    const resolved = resolveApiEnv({
      ...base,
      MATTRAX_BRAND_NAME: "Acme Device Management",
      MATTRAX_BRAND_LOGO_URL: "https://cdn.acme.test/logo.png",
      MATTRAX_BRAND_COLOR: "#16a34a",
    });

    expect(resolved).toMatchObject({
      MATTRAX_BRAND_NAME: "Acme Device Management",
      MATTRAX_BRAND_LOGO_URL: "https://cdn.acme.test/logo.png",
      MATTRAX_BRAND_COLOR: "#16a34a",
    });
  });

  it("treats an empty deployment brand as unset", () => {
    expect(
      resolveApiEnv({ ...base, MATTRAX_BRAND_NAME: "", MATTRAX_BRAND_COLOR: "" }),
    ).toMatchObject({
      MATTRAX_BRAND_NAME: undefined,
      MATTRAX_BRAND_COLOR: undefined,
    });
  });
});

describe("services URL environment resolution", () => {
  it("treats a whitespace-only override as unset", () => {
    expect(
      resolveApiEnv({ ...base, MATTRAX_SERVICES_URL: "   " }).MATTRAX_SERVICES_URL,
    ).toBeUndefined();
  });

  it("trims surrounding whitespace from an override", () => {
    expect(
      resolveApiEnv({
        ...base,
        MATTRAX_SERVICES_URL: "  https://services.example.com  ",
      }).MATTRAX_SERVICES_URL,
    ).toBe("https://services.example.com");
  });

  it("still rejects a malformed override", () => {
    expect(() => resolveApiEnv({ ...base, MATTRAX_SERVICES_URL: "not a URL" })).toThrow();
  });

  it("rejects a non-HTTPS override", () => {
    expect(() =>
      resolveApiEnv({ ...base, MATTRAX_SERVICES_URL: "http://services.example.com" }),
    ).toThrow("must be an https: URL");
  });

  it("rejects an override with a path", () => {
    expect(() =>
      resolveApiEnv({ ...base, MATTRAX_SERVICES_URL: "https://services.example.com/v1" }),
    ).toThrow("must be an origin without a path");
  });

  it("trims the services token", () => {
    expect(resolveApiEnv({ ...base, SERVICES_TOKEN: "  services-token  " }).SERVICES_TOKEN).toBe(
      "services-token",
    );
  });

  it("signs relay requests with the trimmed services token", async () => {
    const token = "shared-services-token";
    const resolved = resolveApiEnv({ ...base, SERVICES_TOKEN: `  ${token}\n` });
    const timestamp = "1700000000";
    const body = JSON.stringify({ pushToken: "abcd1234" });
    const signedToken = resolved.SERVICES_TOKEN ?? "";

    expect(signedToken).toBe(token);
    expect(await relaySignature(signedToken, timestamp, body)).toBe(
      createHmac("sha256", token).update(`${timestamp}.${body}`).digest("hex"),
    );
  });

  describe("typed deployment configuration", () => {
    it("decodes integer limits and UTC dates", () => {
      const env = resolveApiEnv({
        ...base,
        MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: "3600",
        MDM_AUDIT_CHECKIN_COALESCE_SECONDS: "0",
        MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: "4",
        MAINTENANCE_BACKUP_RETENTION_DAYS: "0",
        SOFA_FEED_TIMEOUT_MS: "5000",
        POSTHOG_ERROR_SAMPLE_RATE: "0.5",
        MATTRAX_ONBOARDING_SINCE: "2026-02-28",
        MATTRAX_LICENSE_KEY: "  licence-key  ",
      });

      expect(env.MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS).toBe(3600);
      expect(env.MDM_AUDIT_CHECKIN_COALESCE_SECONDS).toBe(0);
      expect(env.MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY).toBe(4);
      expect(env.MAINTENANCE_BACKUP_RETENTION_DAYS).toBe(0);
      expect(env.SOFA_FEED_TIMEOUT_MS).toBe(5000);
      expect(env.POSTHOG_ERROR_SAMPLE_RATE).toBe(0.5);
      expect(DateTime.toEpochMillis(env.MATTRAX_ONBOARDING_SINCE!)).toBe(Date.UTC(2026, 1, 28));
      expect(env.MATTRAX_LICENSE_KEY).toBe("licence-key");
    });

    it.each([
      ["MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS", "0.5"],
      ["MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS", "59"],
      ["MDM_AUDIT_CHECKIN_COALESCE_SECONDS", "1.5"],
      ["MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY", "0"],
      ["MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS", "0.9"],
      ["MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS", "0.9"],
      ["MAINTENANCE_AUDIT_RETENTION_DAYS", "-1"],
      ["SOFA_FEED_TIMEOUT_MS", "0"],
      ["POSTHOG_ERROR_SAMPLE_RATE", "1.1"],
      ["POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE", "2.5"],
    ])("rejects invalid numeric %s=%s", (name, value) => {
      expect(() => resolveApiEnv({ ...base, [name]: value })).toThrow();
    });

    it.each(["1", "2026-02-30", "2026-13-01", "2026-11-14T00:00:00Z"])(
      "rejects invalid date-only input %s",
      (value) => {
        expect(() => resolveApiEnv({ ...base, MATTRAX_ONBOARDING_SINCE: value })).toThrow();
      },
    );
  });

  describe("trusted device identity headers", () => {
    it("fails startup unless an explicit trusted peer is configured", () => {
      expect(() => resolveApiEnv({ ...base, TRUST_DEVICE_IDENTITY_HEADERS: "1" })).toThrow(
        /TRUSTED_DEVICE_IDENTITY_PEERS is required/,
      );
      expect(() =>
        resolveApiEnv({
          ...base,
          TRUST_DEVICE_IDENTITY_HEADERS: "1",
          TRUSTED_DEVICE_IDENTITY_PEERS: "   ",
        }),
      ).toThrow(/TRUSTED_DEVICE_IDENTITY_PEERS is required/);
    });

    it("trims a configured trusted peer list", () => {
      expect(
        resolveApiEnv({
          ...base,
          TRUST_DEVICE_IDENTITY_HEADERS: "1",
          TRUSTED_DEVICE_IDENTITY_PEERS: " 127.0.0.1, ::1 ",
        }).TRUSTED_DEVICE_IDENTITY_PEERS,
      ).toBe("127.0.0.1, ::1");
    });

    it.each(["localhost", "127.0.0.1/8", "0.0.0.0"])(
      "rejects an invalid trusted peer even when header trust is off: %s",
      (value) => {
        expect(() => resolveApiEnv({ ...base, TRUSTED_DEVICE_IDENTITY_PEERS: value })).toThrow(
          /TRUSTED_DEVICE_IDENTITY_PEERS/,
        );
      },
    );
  });
});
