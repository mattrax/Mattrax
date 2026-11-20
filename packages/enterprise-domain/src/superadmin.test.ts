import { describe, expect, it } from "vitest";
import {
  isEnvManagedSuperadmin,
  isSuperadmin,
  normalizeSuperadminEmail,
  parseSuperadminEmails,
  superadminSource,
} from "./superadmin.js";

const allowlist = new Set(parseSuperadminEmails("Ops@Example.com, , owner@example.com,ops@example.com"));

const account = (overrides: {
  email?: string;
  emailVerified?: boolean;
  superadmin?: boolean;
} = {}) => ({
  email: overrides.email ?? "someone@example.com",
  emailVerified: overrides.emailVerified ?? true,
  superadmin: overrides.superadmin ?? false,
});

describe("MATTRAX_SUPERADMINS parsing", () => {
  it("trims, lowercases, drops blanks and de-duplicates", () => {
    expect(parseSuperadminEmails(" Ops@Example.com ,, owner@example.com , OPS@example.com ")).toEqual([
      "ops@example.com",
      "owner@example.com",
    ]);
  });

  it("treats absent and blank configuration as empty", () => {
    expect(parseSuperadminEmails(undefined)).toEqual([]);
    expect(parseSuperadminEmails(null)).toEqual([]);
    expect(parseSuperadminEmails(" ,  , ")).toEqual([]);
  });

  it("normalises case for comparison", () => {
    expect(normalizeSuperadminEmail("  Ops@Example.COM ")).toBe("ops@example.com");
  });
});

describe("effective superadmin", () => {
  it("grants the flag to a verified account named by the environment", () => {
    const user = account({ email: "OPS@example.com", emailVerified: true });
    expect(isEnvManagedSuperadmin(user, allowlist)).toBe(true);
    expect(superadminSource(user, allowlist)).toBe("env");
    expect(isSuperadmin(user, allowlist)).toBe(true);
  });

  it("does not grant the environment flag to an unverified account", () => {
    const user = account({ email: "ops@example.com", emailVerified: false });
    expect(isEnvManagedSuperadmin(user, allowlist)).toBe(false);
    expect(isSuperadmin(user, allowlist)).toBe(false);
  });

  it("still honours the stored flag for an unverified account", () => {
    const user = account({ email: "ops@example.com", emailVerified: false, superadmin: true });
    expect(superadminSource(user, allowlist)).toBe("database");
    expect(isSuperadmin(user, allowlist)).toBe(true);
  });

  it("reports the environment as the source when both grant the flag", () => {
    const user = account({ email: "ops@example.com", superadmin: true });
    expect(superadminSource(user, allowlist)).toBe("env");
  });

  it("fails closed for an unknown account", () => {
    const user = account({ email: "nobody@example.com" });
    expect(superadminSource(user, allowlist)).toBeNull();
    expect(isSuperadmin(user, allowlist)).toBe(false);
  });
});
