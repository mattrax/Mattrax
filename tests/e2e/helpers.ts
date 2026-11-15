import { expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

type DebugEmail = { readonly to: string; readonly text: string };

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
  await installVirtualAuthenticator(page);
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
  await expect(page.locator("#email")).toHaveValue(email);

  const registration = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/v1/completePasskeyRegistration"),
    { timeout: 20_000 },
  );

  await page.getByRole("button", { name: /create account with a passkey/i }).click();
  const response = await registration.catch(() => undefined);

  if (!response) throw new Error("Registration request was never sent");

  if (!response.ok())
    throw new Error(`Registration API failed (${response.status()}): ${await response.text()}`);

  // Registration signs in with the new passkey, then waits on the code step
  // until the address is proven. A cold dev server occasionally loses the
  // inline transition (and with it the challenge); in that case use the magic
  // link from the same email, which exercises the verification endpoint too.
  const verificationCodeInput = page.locator("#verification-code");

  if (!(await verificationCodeInput.isVisible().catch(() => false))) {
    await verifyEmail(page, email);
    await page.goto("/dashboard", { waitUntil: "networkidle" });
  } else {
    const code = await verificationCode(page, email);
    await verificationCodeInput.fill(code);
    await page.getByRole("button", { name: /verify email/i }).click();
  }

  // A cold dev server compiles the dashboard route on the first navigation,
  // which can take longer than the default test timeout.
  await page.waitForURL(/\/dashboard|\/t\/|\/tenants\/new/, { timeout: 45_000 });

  return { email };
}

/** Read the six-digit code from the dev mailbox used by browser tests. */
export async function verificationCode(page: Page, email: string) {
  let code = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/debug/emails");

        if (!response.ok()) return "";
        const messages: ReadonlyArray<DebugEmail> = await response.json();
        const message = messages.find((item) => item.to === email);
        code = message?.text.match(/code is (\d{6})/)?.[1] ?? "";

        return code;
      },
      { timeout: 20_000 },
    )
    .not.toBe("");

  return code;
}

/** Confirm the registration email through the dev mailbox used by browser tests. */
export async function verifyEmail(page: Page, email: string) {
  let token = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/debug/emails");

        if (!response.ok()) return "";
        const messages: ReadonlyArray<DebugEmail> = await response.json();
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

export async function signIn(page: Page, _email?: string) {
  await installVirtualAuthenticator(page);
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
    undefined,
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /sign in with a passkey/i }).click();
  // A passkey signs in directly unless TOTP is enabled, in which case the
  // pending step appears on the same page.
  await Promise.race([
    page.waitForURL(/\/dashboard|\/t\/|\/tenants\/new/, { timeout: 45_000 }).catch(() => undefined),
    page
      .getByText(/two-factor authentication required/i)
      .waitFor({ timeout: 45_000 })
      .catch(() => undefined),
  ]);
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

      const created: { id: string } = await response.json();

      return created.id;
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
  await gotoHydrated(page, `/t/${tenant.slug}/devices`);
  await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();

  return tenant;
}

/**
 * The request fields these tests send. A narrower shape than the DOM
 * `RequestInit` keeps the node and DOM stream types from colliding, and every
 * call site only ever sets these.
 */
type ApiRequest = {
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Record<string, string>;
};

export async function api<T = unknown>(page: Page, path: string, init?: ApiRequest): Promise<T> {
  return page.evaluate<T, { path: string; init?: ApiRequest }>(
    async ({ path, init }) => {
      const headers = new Headers(init?.headers);

      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      headers.set("x-effect-auth-csrf", "1");

      const response = await fetch(path, { ...init, headers });

      const text = await response.text();

      if (!response.ok) throw new Error(`${response.status}: ${text}`);

      return text ? JSON.parse(text) : undefined;
    },
    { path, init },
  );
}

/**
 * Complete the step-up dialog for a sensitive action. Accounts created by
 * `register` always have a passkey, so the passkey factor is used.
 */
export async function confirmStepUp(page: Page) {
  const dialog = page.getByRole("dialog", { name: /confirm it's you/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: /^passkey$/i }).click();
  await dialog.getByRole("button", { name: /use passkey/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Obtain a step-up grant directly for API-driven tests that bypass the UI.
 * The browser already owns the virtual authenticator from `register`.
 */
export async function stepUpGrant(page: Page, action: string): Promise<string> {
  return page.evaluate(async (action) => {
    const toBase64Url = (buffer: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");

    const fromBase64Url = (value: string) => {
      const padded = value.replaceAll("-", "+").replaceAll("_", "/");
      const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
      const bytes = new Uint8Array(binary.length);

      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

      return bytes.buffer;
    };

    const headers = {
      "content-type": "application/json",
      "x-effect-auth-csrf": "1",
    };

    const startedResponse = await fetch("/api/v1/account/step-up/passkey/begin", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ action }),
    });

    if (!startedResponse.ok) throw new Error(`Step-up begin failed (${startedResponse.status})`);

    const started = await startedResponse.json();
    // SAFETY: the step-up endpoint returns @simplewebauthn request options,
    // which the browser WebAuthn API accepts with this field shape.
    const options = started.options as any;

    // SAFETY: `publicKey` is the browser WebAuthn request shape; the cast
    // narrows the DOM union returned by `navigator.credentials.get`.
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rpId: options.rpId,
        allowCredentials: (options.allowCredentials ?? []).map((item: any) => ({
          ...item,
          id: fromBase64Url(item.id),
        })),
        timeout: options.timeout,
        userVerification: options.userVerification,
      },
    })) as PublicKeyCredential | null;

    if (!credential) throw new Error("Passkey assertion was not created");

    // SAFETY: a public-key credential response is an assertion response.
    const assertion = credential.response as AuthenticatorAssertionResponse;

    const response = {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      response: {
        authenticatorData: toBase64Url(assertion.authenticatorData),
        clientDataJSON: toBase64Url(assertion.clientDataJSON),
        signature: toBase64Url(assertion.signature),
        userHandle: assertion.userHandle ? toBase64Url(assertion.userHandle) : undefined,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };

    const completeResponse = await fetch("/api/v1/account/step-up/passkey/complete", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        stepUpToken: started.stepUpToken,
        response: JSON.stringify(response),
      }),
    });

    if (!completeResponse.ok)
      throw new Error(`Step-up completion failed (${completeResponse.status})`);

    const body: { grant: string } = await completeResponse.json();

    return body.grant;
  }, action);
}

type VirtualAuthenticator = { client: any; authenticatorId: string };

const authenticators = new WeakMap<Page, VirtualAuthenticator>();

/**
 * Install a CTAP2 virtual authenticator on the page target. WebAuthn then runs
 * entirely in software, so passkey tests do not need a hardware key.
 */
export async function installVirtualAuthenticator(page: Page) {
  const existing = authenticators.get(page);

  if (existing) return existing;

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

  const value = { client, authenticatorId };
  authenticators.set(page, value);

  return value;
}

/**
 * Add another virtual authenticator without removing the existing one. Tests use
 * this to simulate a second device; Chrome picks the credential it has.
 */
export async function addVirtualAuthenticator(page: Page) {
  const current = await installVirtualAuthenticator(page);

  const { authenticatorId } = await current.client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return { client: current.client, authenticatorId };
}

/**
 * Toggle whether a virtual authenticator answers WebAuthn prompts. Tests use
 * this to choose which simulated device performs a ceremony.
 */
export async function setVirtualAuthenticatorPresence(
  authenticator: VirtualAuthenticator,
  enabled: boolean,
) {
  await authenticator.client.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId: authenticator.authenticatorId,
    enabled,
  });
}
