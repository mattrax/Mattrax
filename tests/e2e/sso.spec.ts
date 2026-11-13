import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { bootstrapTenant } from "./helpers";

const base64url = (value: Buffer | string) =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const sign = (secret: string, payload: Record<string, unknown>) => {
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest();

  return `${body}.${base64url(signature)}`;
};

const authSecret = () => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const vars = readFileSync("apps/api/.dev.vars", "utf8");
  const match = vars.match(/^AUTH_SECRET=(.+)$/m);

  if (!match?.[1]) throw new Error("AUTH_SECRET is not configured for the SSO test");

  return match[1].trim();
};

test.describe("single sign-on", () => {
  test("accepts a signed IdP assertion and issues a session", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "SSO Tenant");
    const origin = new URL(page.url()).origin;

    const me = (await (await page.request.get(`${origin}/api/v1/me`)).json()) as {
      user: { id: string; email: string };
    };

    await page.context().clearCookies();

    const token = sign(authSecret(), {
      sub: me.user.id,
      email: me.user.email,
      exp: Date.now() + 60_000,
      purpose: "sso-assertion",
      tenantId: tenant.id,
    });

    const response = await page.request.post(`${origin}/api/v1/ssoSignIn`, {
      data: { payload: { token } },
      headers: { origin, "x-effect-auth-csrf": "1" },
    });

    expect(response.ok(), await response.text()).toBe(true);

    const after = (await (await page.request.get(`${origin}/api/v1/me`)).json()) as {
      user: { id: string };
    };

    expect(after.user.id).toBe(me.user.id);
  });

  test("rejects a forged assertion", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "SSO Tenant");
    const origin = new URL(page.url()).origin;

    const response = await page.request.post(`${origin}/api/v1/ssoSignIn`, {
      data: { payload: { token: "forged" } },
      headers: { origin, "x-effect-auth-csrf": "1" },
    });

    expect(response.status()).toBe(400);
    expect(tenant.id).toBeTruthy();
  });
});
