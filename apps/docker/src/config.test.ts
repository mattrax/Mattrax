import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeConfigFromEnv } from "./config.js";

const compose = readFileSync(join(import.meta.dirname, "..", "docker-compose.yml"), "utf8");
const selfHostingDocs = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "operations", "self-hosting.md"),
  "utf8",
);

describe("self-hosted compose configuration", () => {
  it("passes deployment branding through to the container", () => {
    for (const name of ["MATTRAX_BRAND_NAME", "MATTRAX_BRAND_LOGO_URL", "MATTRAX_BRAND_COLOR"])
      expect(compose).toContain(`${name}: \${${name}:-}`);
  });

  it("publishes the backend on loopback by default", () => {
    expect(compose).toContain('- "${MATTRAX_BIND_ADDRESS:-127.0.0.1}:8080:8080"');
    expect(compose).not.toContain('- "8080:8080"');
  });

  it("passes the explicit trusted peer allowlist without inventing a default", () => {
    expect(compose).toContain("TRUSTED_DEVICE_IDENTITY_PEERS: ${TRUSTED_DEVICE_IDENTITY_PEERS:-}");
  });

  it("documents a supported proxy that forwards the verified SHA-256 fingerprint", () => {
    const caddyExample = selfHostingDocs.match(/```caddy\n([\s\S]*?)\n```/)?.[1];

    expect(caddyExample).toBeDefined();
    expect(caddyExample).toContain("mode verify_if_given");
    expect(caddyExample).toContain(
      "trust_pool file /path/to/apple-ca-bundle.pem /path/to/tenant-scep-ca-bundle.pem",
    );
    expect(caddyExample).not.toContain("/path/to/apple-device-ca.pem");
    expect(caddyExample).toContain(
      "header_up x-device-identity-certificate-sha256 {tls_client_fingerprint}",
    );
    expect(caddyExample).toContain(
      "header_up x-device-identity-certificate-der-base64 {tls_client_certificate_der_base64}",
    );
    expect(caddyExample).not.toContain('x-device-identity-certificate-sha256 ""');
    expect(selfHostingDocs).toMatch(/serial-only fallback is no longer valid/i);
    expect(selfHostingDocs).toContain("Global proxy trust is not tenant authorization");
    expect(selfHostingDocs).toContain("identityCertificateDerBase64");
    expect(selfHostingDocs).toContain("derives its issuer fingerprint");
    expect(selfHostingDocs).toContain("every tenant SCEP CA that signs Windows identities");
    expect(selfHostingDocs).toContain("SELECT cert_pem FROM scep_ca");
    expect(selfHostingDocs).toContain("SELECT cert_pem FROM scep_ca_trust");
    expect(selfHostingDocs).toContain("trust_until > UTC_TIMESTAMP()");
    expect(selfHostingDocs).toContain("caddy reload --config /etc/caddy/Caddyfile");
    expect(selfHostingDocs).toContain("For an external MySQL database");
    expect(selfHostingDocs).toContain("--defaults-extra-file=/secure/mattrax-ca-export.cnf");
  });
});

const base = {
  HOST: "0.0.0.0",
  PORT: "8080",
  ORIGIN: "https://mattrax.example.com",
  AUTH_SECRET: "local-development-auth-secret-0123456789abcdef",
  DATABASE_URL: "mysql://user:pass@database.example.com/mattrax",
  DATA_DIR: "/data",
};

describe("self-host runtime configuration", () => {
  it("decodes defaults and validates the database URL", () => {
    expect(runtimeConfigFromEnv(base)).toEqual({
      host: "0.0.0.0",
      port: 8080,
      origin: "https://mattrax.example.com",
      authSecret: base.AUTH_SECRET,
      databaseUrl: base.DATABASE_URL,
      dataDirectory: "/data",
      skipMigrations: false,
    });
  });

  it("parses the migration opt-out", () => {
    expect(runtimeConfigFromEnv({ ...base, SKIP_MIGRATIONS: "true" }).skipMigrations).toBe(true);
  });

  it("fails before startup when trusted identity headers have no trusted peer", () => {
    expect(() => runtimeConfigFromEnv({ ...base, TRUST_DEVICE_IDENTITY_HEADERS: "1" })).toThrow(
      /TRUSTED_DEVICE_IDENTITY_PEERS is required/,
    );
  });

  it("starts with trusted identity headers when the proxy peer is explicit", () => {
    expect(
      runtimeConfigFromEnv({
        ...base,
        TRUST_DEVICE_IDENTITY_HEADERS: "1",
        TRUSTED_DEVICE_IDENTITY_PEERS: "127.0.0.1,::1",
      }).port,
    ).toBe(8080);
  });

  it.each([
    { PORT: "0" },
    { PORT: "65536" },
    { PORT: "1.5" },
    { PORT: "nope" },
    { ORIGIN: "not a URL" },
    { ORIGIN: "ftp://example.com" },
    { AUTH_SECRET: "short" },
    { DATABASE_URL: "mysql://user:pass@database.example.com/mattrax?ssl-mode=PREFERRED" },
    { DATABASE_URL: "mysql://user:pass@database.example.com:65536/mattrax" },
  ])("rejects invalid host configuration before startup: %j", (override) => {
    expect(() => runtimeConfigFromEnv({ ...base, ...override })).toThrow();
  });
});
