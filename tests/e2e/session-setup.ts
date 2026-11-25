import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { e2eSessionFile, installVirtualAuthenticator, register } from "./helpers";
import type { SessionCredential } from "./helpers";

/**
 * Register one account for the whole run and leave its session for
 * `bootstrapTenant`.
 *
 * Every test that needs a tenant used to pay the full registration ceremony
 * (~3.2s: register, tenant API, first hydrated navigation) before its own
 * assertions. The account is account-level state; the tenant id is what
 * isolates tests, so one account can own every test's tenant. Registering once
 * removes most of that setup without changing isolation.
 *
 * The WebAuthn credential created by registration is copied into the session
 * file too: tests run in their own browser context with their own virtual
 * authenticator, and step-up actions need the passkey that the shared account
 * registered.
 *
 * A non-local `E2E_BASE_URL` (staging) skips this: `bootstrapTenant` falls
 * back to registering per test, because a local session must not be replayed
 * against a deployment.
 */
export default async function sessionSetup(): Promise<void> {
  const target = (process.env.E2E_BASE_URL?.trim() || "http://localhost:9050").replace(/\/$/, "");
  const host = new URL(target).hostname.replaceAll(/^\[|\]$/g, "").toLowerCase();

  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(host)) {
    console.log(`[e2e-session] ${target} is not local; tests register per test`);
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: target });
  const page = await context.newPage();

  try {
    const authenticator = await installVirtualAuthenticator(page);
    const { email } = await register(page);
    const state = await context.storageState();
    const { credentials } = (await authenticator.client.send("WebAuthn.getCredentials", {
      authenticatorId: authenticator.authenticatorId,
    })) as { credentials: ReadonlyArray<SessionCredential> };

    await writeFile(e2eSessionFile(), JSON.stringify({ email, ...state, credentials }));

    console.log(`[e2e-session] registered ${email} once for this run`);
  } catch (error) {
    // A broken session setup must not fail the suite: `bootstrapTenant` then
    // does the registration per test, which is the behaviour this optimises.
    console.warn("[e2e-session] could not register once; falling back to per-test registration");
    console.warn(error);
  } finally {
    await browser.close();
  }
}
