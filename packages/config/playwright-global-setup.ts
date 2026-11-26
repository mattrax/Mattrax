import { execFileSync as nodeExecFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { normalizeE2EBaseUrl } from "./e2e-target.ts";
import {
  e2eBaseURL,
  isSharedSessionValid,
  readSharedSession,
  shouldCreateSharedSession,
  writeSharedSession,
} from "./e2e-shared-session.ts";
import type { SharedSession } from "./e2e-shared-session.ts";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const defaultDevDatabaseUrl = "mysql://mattrax:mattrax@127.0.0.1:3306/mattraxe";
const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const migrationEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };

  // Drizzle Kit prefers DATABASE_URL and then DATABASE_*. Those variables are
  // for deployments; browser tests must use the dev server's database instead.
  for (const key of Object.keys(env)) if (key.startsWith("DATABASE_")) delete env[key];

  const databaseUrl = process.env.MATTRAX_DEV_DATABASE_URL?.trim() || defaultDevDatabaseUrl;
  const url = new URL(databaseUrl);

  if (url.protocol !== "mysql:" || !url.pathname || url.pathname === "/")
    throw new Error("MATTRAX_DEV_DATABASE_URL must be a MySQL URL with a database name");

  const host = url.hostname.replaceAll(/^\[|\]$/g, "").toLowerCase();

  if (!localDatabaseHosts.has(host) && process.env.E2E_ALLOW_REMOTE_DATABASE !== "1")
    throw new Error(
      `Refusing to migrate non-local E2E database host "${host}". ` +
        "Use a local MATTRAX_DEV_DATABASE_URL or set E2E_ALLOW_REMOTE_DATABASE=1 explicitly.",
    );

  env.DATABASE_URL = databaseUrl;

  return env;
};

/** The one child-process call setup makes, injected so tests never mock node:child_process. */
export type GlobalSetupExec = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" },
) => void;

type BrowserLauncher = () => Promise<Browser>;
type Register = (page: Page, options?: { name?: string; email?: string }) => Promise<{ email: string }>;

/**
 * Loaded at runtime so the config project keeps its own rootDir: the UI flow
 * itself lives in tests/e2e/helpers.ts and is never duplicated here.
 */
const loadRegister = async (): Promise<Register> => {
  const moduleUrl = new URL("../../tests/e2e/helpers.ts", import.meta.url).href;
  const module = (await import(moduleUrl)) as { register: Register };

  return module.register;
};

const launchBrowser: BrowserLauncher = () => {
  const configured = process.env.E2E_CHANNEL?.trim();

  return chromium.launch({
    channel: configured === "bundled" ? undefined : configured || "chrome",
    headless: true,
  });
};

/**
 * Register one account up front and hand its session cookie to the workers.
 * Migrated specs create a unique tenant from it, skipping the ~10-15s
 * email-code and passkey ceremony without skipping any product assertion.
 * Specs that test registration keep calling register() themselves.
 */
export const createSharedSession = async (
  baseURL = e2eBaseURL(),
  launch: BrowserLauncher = launchBrowser,
): Promise<SharedSession | undefined> => {
  if (!shouldCreateSharedSession(baseURL)) return undefined;

  const existing = readSharedSession(baseURL);

  if (existing && (await isSharedSessionValid(existing, baseURL))) return existing;

  const browser = await launch();

  try {
    const context = await browser.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    });

    try {
      const page = await context.newPage();
      const register = await loadRegister();
      const { email } = await register(page);
      const session: SharedSession = {
        version: 1,
        baseURL,
        email,
        createdAt: new Date().toISOString(),
        state: await context.storageState(),
      };

      console.log("[e2e] shared session saved to " + writeSharedSession(session, baseURL));

      return session;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
};

/** Keep local browser tests on the same schema as the checkout. */
export const runGlobalSetup = async (exec: GlobalSetupExec = nodeExecFileSync): Promise<void> => {
  // An explicitly targeted deployment owns its migrations.
  if (normalizeE2EBaseUrl(process.env.E2E_BASE_URL)) return;

  exec("pnpm", ["cloud", "db:migrate"], {
    cwd: repository,
    env: migrationEnvironment(),
    stdio: "inherit",
  });
};

/** Playwright entry point; the real child process is the default port. */
export default async function globalSetup(): Promise<void> {
  await runGlobalSetup();

  try {
    await createSharedSession();
  } catch (error) {
    // A missing state file is not fatal: bootstrapSession() falls back to the
    // full UI registration for each spec that needs an account.
    console.warn("[e2e] shared session setup failed: " + String(error));
  }
}
