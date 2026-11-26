import { describe, expect, it } from "vitest";
import type { DirectoryProviderDefinition } from "./provider.js";
import { makeDirectoryProviderRegistry } from "./registry.js";

const provider = (
  id: "entra" | "google",
  userSource: "entra" | "google",
  groupSource: "graph" | "google",
): DirectoryProviderDefinition => ({
  id,
  label: id === "entra" ? "Microsoft Entra ID" : "Google Workspace",
  shortLabel: id,
  capabilities: {
    users: true,
    groups: true,
    ssoSignIn: id === "entra",
    deepLink: true,
    incremental: id === "entra",
  },
  userSource,
  groupSource,
  adminDirectoryUrl: "https://example.test",
  credentials: "tenant",
  deepLink: ({ externalId }) => (externalId ? `https://example.test/${externalId}` : null),
});

describe("directory provider registry", () => {
  it("lists providers and resolves by id and persisted source", () => {
    const entra = provider("entra", "entra", "graph");
    const google = provider("google", "google", "google");
    const registry = makeDirectoryProviderRegistry([entra, google]);

    expect(registry.list()).toEqual([entra, google]);
    expect(registry.get("google")).toBe(google);
    expect(registry.byUserSource("entra")).toBe(entra);
    expect(registry.byUserSource("google")).toBe(google);
    expect(registry.byGroupSource("graph")).toBe(entra);
    expect(registry.byGroupSource("google")).toBe(google);
  });

  it("returns undefined for unknown and null sources", () => {
    const registry = makeDirectoryProviderRegistry([provider("entra", "entra", "graph")]);

    expect(registry.get("google")).toBeUndefined();
    expect(registry.byUserSource("scim")).toBeUndefined();
    expect(registry.byUserSource(null)).toBeUndefined();
    expect(registry.byGroupSource(undefined)).toBeUndefined();
  });

  it("rejects a duplicate provider id at boot", () => {
    expect(() =>
      makeDirectoryProviderRegistry([
        provider("entra", "entra", "graph"),
        provider("entra", "google", "google"),
      ]),
    ).toThrow(/Duplicate directory provider id/);
  });

  it("rejects two providers claiming one source column", () => {
    expect(() =>
      makeDirectoryProviderRegistry([
        provider("entra", "entra", "graph"),
        provider("google", "entra", "google"),
      ]),
    ).toThrow(/user source entra/);

    expect(() =>
      makeDirectoryProviderRegistry([
        provider("entra", "entra", "google"),
        provider("google", "google", "google"),
      ]),
    ).toThrow(/group source google/);
  });
});
