import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { DEFAULT_E2E_BASE_URL, normalizeE2EBaseUrl } from "./e2e-target.ts";

/**
 * A single authenticated session, captured by Playwright global setup and
 * reused by specs that only need an account (not a registration ceremony).
 *
 * process.env set in global setup does not reach test workers, and
 * test-results/ is wiped at the start of a run, so both sides derive the
 * same path from the target and database instead of passing an env var.
 */
export type E2EStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type SharedSession = {
  readonly version: 1;
  readonly baseURL: string;
  readonly email: string;
  readonly createdAt: string;
  readonly state: E2EStorageState;
};

const VERSION = 1;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const defaultDevDatabaseUrl = "mysql://mattrax:mattrax@127.0.0.1:3306/mattraxe";

/** The base URL this run uses, including CI's explicit loopback override. */
export const e2eBaseURL = (): string =>
  normalizeE2EBaseUrl(process.env.E2E_BASE_URL) ?? DEFAULT_E2E_BASE_URL;

const hostnameOf = (baseURL: string) => {
  const url = new URL(baseURL);

  return url.hostname.replaceAll(/^\[|\]$/g, "").toLowerCase();
};

/** Only seed credentials into our own local server, never a real deployment. */
export const isLocalE2ETarget = (baseURL = e2eBaseURL()): boolean => localHosts.has(hostnameOf(baseURL));

/** Changed-only runs select a small spec set and must not pay for a new account. */
export const shouldCreateSharedSession = (baseURL = e2eBaseURL()): boolean =>
  isLocalE2ETarget(baseURL) && process.env.E2E_ONLY_CHANGED !== "true";

/** Keep sessions from different local databases and origins apart. */
export const sharedSessionPath = (baseURL = e2eBaseURL()): string => {
  const database = process.env.MATTRAX_DEV_DATABASE_URL?.trim() || defaultDevDatabaseUrl;
  const key = createHash("sha256").update(baseURL + "\n" + database).digest("hex").slice(0, 12);

  return path.join(tmpdir(), "mattrax-e2e-shared-session-" + key + ".json");
};

export const readSharedSession = (baseURL = e2eBaseURL()): SharedSession | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(sharedSessionPath(baseURL), "utf8"));
    const session = parsed as SharedSession;

    if (
      !session ||
      session.version !== VERSION ||
      session.baseURL !== baseURL ||
      typeof session.email !== "string" ||
      !session.state?.cookies?.length
    )
      return undefined;

    return session;
  } catch {
    return undefined;
  }
};

/** A stored cookie can outlive the server-side session, so ask the API. */
export const isSharedSessionValid = async (
  session: SharedSession,
  baseURL = e2eBaseURL(),
): Promise<boolean> => {
  // Expired cookies are ignored by the browser; the API is the source of
  // truth for whether this session still works.
  const context = await request.newContext({
    storageState: session.state,
    baseURL,
    ignoreHTTPSErrors: true,
  });

  try {
    const response = await context.get("/api/v1/me", { timeout: 10_000 });

    return response.ok();
  } catch {
    return false;
  } finally {
    await context.dispose();
  }
};

export const writeSharedSession = (session: SharedSession, baseURL = e2eBaseURL()): string => {
  const target = sharedSessionPath(baseURL);
  const temporary = target + "." + process.pid + "." + randomUUID().slice(0, 8) + ".tmp";

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(temporary, JSON.stringify(session), { mode: 0o600 });
  // Readers never observe a half-written state file.
  renameSync(temporary, target);

  return target;
};
