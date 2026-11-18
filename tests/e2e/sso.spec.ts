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

type SsoAssertionClaims = {
  readonly sub: string;
  readonly email: string;
  readonly exp: number;
  readonly purpose: string;
  readonly tenantId: string;
  readonly jti: string;
};

const sign = (secret: string, payload: SsoAssertionClaims) => {
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest();

  return `${body}.${base64url(signature)}`;
};

const authSecret = () => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const vars = readFileSync("apps/cloud/.dev.vars", "utf8");
  const match = vars.match(/^AUTH_SECRET=(.+)$/m);

  if (!match?.[1]) throw new Error("AUTH_SECRET is not configured for the SSO test");

  return match[1].trim();
};

test.describe("single sign-on", () => {
  test("accepts a signed IdP assertion and issues a session", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "SSO Tenant");
    const origin = new URL(page.url()).origin;

    const me: {
      account: { id: string; email: string };
    } = await (await page.request.get(`${origin}/api/v1/me`)).json();

    await page.context().clearCookies();

    const token = sign(authSecret(), {
      sub: me.account.id,
      email: me.account.email,
      exp: Date.now() + 60_000,
      purpose: "sso-assertion",
      tenantId: tenant.id,
      jti: crypto.randomUUID(),
    });

    const response = await page.request.post(`${origin}/api/v1/ssoSignIn`, {
      data: { payload: { token } },
      headers: { origin, "x-effect-auth-csrf": "1" },
    });

    expect(response.ok(), await response.text()).toBe(true);

    const after: {
      account: { id: string };
    } = await (await page.request.get(`${origin}/api/v1/me`)).json();

    expect(after.account.id).toBe(me.account.id);
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
