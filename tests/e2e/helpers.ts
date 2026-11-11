import { expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

export const PASSWORD = "Correct-Horse-Battery-Staple-123!";

/** RFC 6238 SHA-1, six digits, thirty-second steps. */
export function totpCode(secret: string, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/, ""))
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const step = Math.floor(Date.now() / 30_000) + offset;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", bytes).update(counter).digest();
  const start = mac[mac.length - 1]! & 15;
  const binary =
    ((mac[start]! & 127) << 24) |
    (mac[start + 1]! << 16) |
    (mac[start + 2]! << 8) |
    mac[start + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Wait until the current thirty-second step changes, then return its code. */
export async function freshTotpCode(secret: string) {
  const step = Math.floor(Date.now() / 30_000);
  while (Math.floor(Date.now() / 30_000) === step)
    await new Promise((resolve) => setTimeout(resolve, 500));
  return totpCode(secret);
}

export function uniqueEmail(prefix = "e2e") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function register(page: Page, options: { name?: string; email?: string } = {}) {
  const email = options.email ?? uniqueEmail();
  const health = await page.request.get("/api/health");
  if (!health.ok()) throw new Error(`API health check failed (${health.status()})`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto("/register", { waitUntil: "networkidle" });
  try {
    await page.waitForFunction(
      () => document.documentElement.dataset.hydrated === "true",
      undefined,
      { timeout: 20_000 },
    );
  } catch {
    throw new Error(
      `Register page did not hydrate in time${errors.length ? `\n${errors.join("\n")}` : ""}`,
    );
  }
  // Solid hydration can reset controlled inputs; wait for the form to be
  // interactive and verify the values before submitting.
  await expect(page.locator("#name")).toBeVisible();
  await page.locator("#name").fill(options.name ?? "E2E User");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm-password").fill(PASSWORD);
  await expect(page.locator("#email")).toHaveValue(email);
  await expect(page.locator("#password")).toHaveValue(PASSWORD);
  const registration = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/v1/register"),
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /create account/i }).click();
  const response = await registration.catch(() => undefined);
  if (!response) throw new Error("Registration request was never sent");
  if (!response.ok())
    throw new Error(`Registration API failed (${response.status()}): ${await response.text()}`);
  // A cold dev server compiles the dashboard route on the first navigation,
  // which can take longer than the default test timeout.
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
  await verifyEmail(page, email);
  return { email, password: PASSWORD };
}

/** Confirm the registration email through the dev mailbox used by browser tests. */
export async function verifyEmail(page: Page, email: string) {
  let token = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/debug/emails");
        if (!response.ok()) return "";
        const messages = (await response.json()) as Array<{ to: string; text: string }>;
        const message = messages.find((item) => item.to === email);
        token = message?.text.match(/verify-email\?token=([^\s]+)/)?.[1] ?? "";
        return token;
      },
      { timeout: 20_000 },
    )
    .not.toBe("");
  const response = await page.request.post("/api/v1/verify-email", {
    data: { token: decodeURIComponent(token) },
    headers: { origin: "http://localhost:9050", "x-effect-auth-csrf": "1" },
  });
  if (!response.ok())
    throw new Error(`Email verification failed (${response.status()}): ${await response.text()}`);
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/dashboard|\/t\//, { timeout: 45_000 });
}

export async function createTenant(page: Page, name: string) {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
  const id = await page.evaluate(
    async ({ name, slug }) => {
      const response = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({ name, slug }),
      });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      return ((await response.json()) as { id: string }).id;
    },
    { name, slug },
  );
  return { id, slug };
}

export async function gotoHydrated(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
    undefined,
    { timeout: 20_000 },
  );
}

export async function bootstrapTenant(page: Page, name = "E2E Tenant") {
  await register(page);
  const tenant = await createTenant(page, `${name} ${Math.random().toString(36).slice(2, 6)}`);
  await gotoHydrated(page, `/t/${tenant.id}/devices`);
  await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
  return tenant;
}

export async function api<T = unknown>(page: Page, path: string, init?: RequestInit): Promise<T> {
  return page.evaluate(
    async ({ path, init }: { path: string; init?: any }) => {
      const response = await fetch(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-effect-auth-csrf": "1",
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status}: ${text}`);
      return text ? JSON.parse(text) : undefined;
    },
    { path, init },
  );
}

/**
 * Complete the step-up dialog for a sensitive action. The password factor is
 * always available to accounts created by `register`, and the grant is cached
 * for subsequent actions in the same session.
 */
export async function confirmStepUp(page: Page, password = PASSWORD) {
  const dialog = page.getByRole("dialog", { name: /confirm it's you/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator("#step-up-password").fill(password);
  await dialog.getByRole("button", { name: /^confirm$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Obtain a step-up grant directly for API-driven tests that bypass the UI.
 * `action` must match the sensitive endpoint's StepUpAction.
 */
export async function stepUpGrant(
  page: Page,
  action: string,
  password = PASSWORD,
): Promise<string> {
  const response = await page.request.post("/api/v1/account/step-up/password", {
    data: { password, action },
    headers: { origin: "http://localhost:9050", "x-effect-auth-csrf": "1" },
  });
  if (!response.ok())
    throw new Error(`Step-up failed (${response.status()}): ${await response.text()}`);
  return ((await response.json()) as { grant: string }).grant;
}

/**
 * Install a CTAP2 virtual authenticator on the page target. WebAuthn then runs
 * entirely in software, so passkey tests do not need a hardware key.
 */
export async function installVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}
