import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import playwrightConfig from "../playwright.config";
import globalSetup from "../playwright-global-setup";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const originalBaseUrl = process.env.E2E_BASE_URL;

describe("Playwright database setup", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
    delete process.env.E2E_BASE_URL;
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.E2E_BASE_URL;
    else process.env.E2E_BASE_URL = originalBaseUrl;
  });

  it("resolves setup from the shared config when the root config re-exports it", () => {
    expect(playwrightConfig.globalSetup).toBe(
      fileURLToPath(new URL("../playwright-global-setup.ts", import.meta.url)),
    );
  });

  it("applies pending migrations before local browser tests", async () => {
    await globalSetup();

    expect(execFileSync).toHaveBeenCalledWith(
      "pnpm",
      ["cloud", "db:migrate"],
      expect.objectContaining({ stdio: "inherit", env: process.env }),
    );
  });

  it("leaves an explicitly targeted deployment alone", async () => {
    process.env.E2E_BASE_URL = "https://staging.example.com";

    await globalSetup();

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("fails setup when migrations cannot be applied", async () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("migration failed");
    });

    await expect(globalSetup()).rejects.toThrow("migration failed");
  });
});
