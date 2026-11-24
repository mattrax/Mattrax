import { createHmac } from "node:crypto";
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
});
