import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Correct-Horse-Battery-Staple-123!";

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
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  return { email, password: PASSWORD };
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/dashboard|\/t\//);
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
