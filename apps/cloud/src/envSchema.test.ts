import { describe, expect, it } from "vitest";
import { resolveApiEnv } from "./envSchema.js";

const base = {
  ORIGIN: "http://localhost:9050",
  AUTH_SECRET: "local-development-auth-secret-0123456789abcdef",
};

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
});
