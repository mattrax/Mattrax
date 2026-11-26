import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rootConfig from "../../../playwright.config";
import playwrightConfig from "../playwright.config";
import globalSetup from "../playwright-global-setup";
import { DEFAULT_E2E_BASE_URL, normalizeE2EBaseUrl } from "../e2e-target.ts";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const environmentKeys = [
  "E2E_BASE_URL",
  "E2E_ALLOW_REMOTE_DATABASE",
  "MATTRAX_DEV_DATABASE_URL",
  "DATABASE_URL",
  "DATABASE_HOST",
  "DATABASE_PORT",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
  "DATABASE_NAME",
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]] as const));
const repository = fileURLToPath(new URL("../../..", import.meta.url));
const defaultDevDatabaseUrl = "mysql://mattrax:mattrax@127.0.0.1:3306/mattraxe";

const migrationOptions = () =>
  vi.mocked(execFileSync).mock.calls[0]?.[2] as {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: "inherit";
  };

describe("Playwright database setup", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
    for (const key of environmentKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      const value = originalEnvironment.get(key);

      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("re-exports the shared config and resolves setup from the repository root", () => {
    expect(rootConfig).toBe(playwrightConfig);
    expect(playwrightConfig.globalSetup).toBe(
      fileURLToPath(new URL("../playwright-global-setup.ts", import.meta.url)),
    );
  });

  it("normalizes blank base URLs consistently", () => {
    expect(normalizeE2EBaseUrl(undefined)).toBeUndefined();
    expect(normalizeE2EBaseUrl("")).toBeUndefined();
    expect(normalizeE2EBaseUrl("  ")).toBeUndefined();
    expect(normalizeE2EBaseUrl(`  ${DEFAULT_E2E_BASE_URL}  `)).toBe(DEFAULT_E2E_BASE_URL);
  });

  it("uses the default local target for a blank base URL", async () => {
    process.env.E2E_BASE_URL = "  ";
    vi.resetModules();

    const { default: config } = await import("../playwright.config");

    expect(config.use?.baseURL).toBe(DEFAULT_E2E_BASE_URL);
    expect(config.webServer).toBeDefined();
  });

  it("trims an external base URL and disables the local server", async () => {
    process.env.E2E_BASE_URL = "  https://staging.example.com  ";
    vi.resetModules();

    const { default: config } = await import("../playwright.config");

    expect(config.use?.baseURL).toBe("https://staging.example.com");
    expect(config.webServer).toBeUndefined();
  });

  it("ignores inherited deployment database variables and migrates the local default", async () => {
    process.env.DATABASE_URL = "mysql://deploy:secret@db.production.example.com/mattraxe";
    process.env.DATABASE_HOST = "db.production.example.com";
    process.env.DATABASE_PORT = "3306";
    process.env.DATABASE_USER = "deploy";
    process.env.DATABASE_PASSWORD = "secret";
    process.env.DATABASE_NAME = "mattraxe";

    await globalSetup();

    expect(execFileSync).toHaveBeenCalledWith(
      "pnpm",
      ["cloud", "db:migrate"],
      expect.objectContaining({ cwd: repository, stdio: "inherit" }),
    );
    expect(migrationOptions().env.DATABASE_URL).toBe(defaultDevDatabaseUrl);
    for (const key of environmentKeys.filter((key) => key.startsWith("DATABASE_")))
      if (key !== "DATABASE_URL") expect(migrationOptions().env[key]).toBeUndefined();
  });

  it("honors a custom local MATTRAX_DEV_DATABASE_URL over deployment variables", async () => {
    const databaseUrl = "mysql://custom:secret@127.0.0.1:3310/custom_e2e";

    process.env.MATTRAX_DEV_DATABASE_URL = `  ${databaseUrl}  `;
    process.env.DATABASE_URL = "mysql://deploy:secret@db.production.example.com/mattraxe";
    process.env.DATABASE_HOST = "db.production.example.com";

    await globalSetup();

    expect(migrationOptions().env.DATABASE_URL).toBe(databaseUrl);
    expect(migrationOptions().env.DATABASE_HOST).toBeUndefined();
  });

  it("rejects a non-local dev database without an explicit opt-in", async () => {
    process.env.MATTRAX_DEV_DATABASE_URL =
      "mysql://deploy:secret@db.production.example.com/mattraxe";

    await expect(globalSetup()).rejects.toThrow(/non-local E2E database host/i);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("allows a non-local dev database only with the explicit opt-in", async () => {
    const databaseUrl = "mysql://deploy:secret@db.staging.example.com/mattraxe";

    process.env.MATTRAX_DEV_DATABASE_URL = databaseUrl;
    process.env.E2E_ALLOW_REMOTE_DATABASE = "1";

    await globalSetup();

    expect(migrationOptions().env.DATABASE_URL).toBe(databaseUrl);
  });

  it("rejects malformed or non-MySQL dev database URLs", async () => {
    process.env.MATTRAX_DEV_DATABASE_URL = "https://localhost/mattraxe";

    await expect(globalSetup()).rejects.toThrow(/MySQL URL with a database name/i);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("leaves an explicitly targeted deployment alone", async () => {
    process.env.E2E_BASE_URL = "  https://staging.example.com  ";

    await globalSetup();

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("fails setup when migrations cannot be applied", async () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("migration failed");
    });

    await expect(globalSetup()).rejects.toThrow("migration failed");
  });

  it("treats a whitespace-only base URL as the default local target", async () => {
    process.env.E2E_BASE_URL = "  ";

    await globalSetup();

    expect(execFileSync).toHaveBeenCalledOnce();
  });
});
