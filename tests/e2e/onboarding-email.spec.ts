import { expect, test } from "@playwright/test";
import { installVirtualAuthenticator, uniqueEmail } from "./helpers.js";

type DebugEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly replyTo?: string;
};

const mailbox = async (page: import("@playwright/test").Page) => {
  const response = await page.request.get("/api/debug/emails");

  expect(response.ok()).toBe(true);

  // SAFETY: the dev mailbox serves its own JSON array of recorded messages.
  return (await response.json()) as ReadonlyArray<DebugEmail>;
};

const welcomeMessages = (messages: ReadonlyArray<DebugEmail>, email: string) =>
  messages.filter((message) => message.to === email && message.subject === "Welcome to Mattrax");

test.describe("onboarding email", () => {
  test("verification sends one welcome email and a repeat verify does not", async ({ page }) => {
    const email = uniqueEmail("welcome");

    await installVirtualAuthenticator(page);
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await page.locator("#name").fill("Ada Lovelace");
    await page.locator("#email").fill(email);

    const registration = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/v1/completePasskeyRegistration"),
    );

    await page.getByRole("button", { name: /create account with a passkey/i }).click();
    expect((await registration).ok()).toBe(true);

    await expect(page.locator("#verification-code")).toBeVisible({ timeout: 20_000 });

    let code = "";

    await expect
      .poll(
        async () => {
          const messages = await mailbox(page);

          const message = messages.find(
            (item) => item.to === email && item.subject === "Your Mattrax verification code",
          );

          code = message?.text.match(/code is (\d{6})/)?.[1] ?? "";

          return code;
        },
        { timeout: 20_000 },
      )
      .not.toBe("");

    await page.locator("#verification-code").fill(code);
    await page.getByRole("button", { name: /verify email/i }).click();
    await page.waitForURL(/\/dashboard|\/t\/|\/tenants\/new/, { timeout: 45_000 });

    const afterRegistration = await mailbox(page);
    const welcome = welcomeMessages(afterRegistration, email);

    expect(welcome).toHaveLength(1);
    expect(welcome[0]).toMatchObject({ replyTo: "oscar@otbeaumont.me" });
    expect(welcome[0]!.text).toContain("Hey Ada,");
    expect(welcome[0]!.text).toContain("/dashboard");

    const verification = afterRegistration.find(
      (item) => item.to === email && item.subject === "Your Mattrax verification code",
    );

    const token = verification?.text.match(/verify-email\?token=([^\s]+)/)?.[1];

    expect(token).toBeTruthy();


    const again = await page.request.post("/api/v1/verify-email", {
      data: { token: decodeURIComponent(token!) },
      headers: { origin: "http://localhost:9050", "x-effect-auth-csrf": "1" },
    });

    expect(again.ok()).toBe(true);
    expect(welcomeMessages(await mailbox(page), email)).toHaveLength(1);

    // The debug sweep is the same bounded backstop the daily cron runs. It may
    // mail other recent accounts in this shared dev database, but the claimed
    // account must never receive a second welcome.
    const sweep = await page.request.post("/api/debug/onboarding-emails");

    expect(sweep.ok()).toBe(true);

    // SAFETY: the debug route serialises the two sweep results it produced.
    const sweepBody = (await sweep.json()) as {
      readonly welcome: { readonly sent: number };
      readonly followUp: { readonly candidates: number } | null;
    };

    expect(sweepBody.welcome).toMatchObject({ sent: expect.any(Number) });
    expect(sweepBody.followUp).not.toBeNull();
  });
});
