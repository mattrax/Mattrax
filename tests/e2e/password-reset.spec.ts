import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test.describe("password reset delivery", () => {
  test("sends a reset link to the dev mailbox", async ({ page }) => {
    const { email } = await register(page, { name: "Password Reset User" });
    const origin = new URL(page.url()).origin;

    const response = await page.request.post("/api/v1/requestReset", {
      data: {
        payload: {
          flowId: crypto.randomUUID(),
          email,
          requestId: crypto.randomUUID(),
          locale: "en",
        },
      },
      headers: { origin, "x-effect-auth-csrf": "1" },
    });

    expect(response.ok()).toBe(true);

    let resetLink = "";
    await expect
      .poll(
        async () => {
          const mailbox = await page.request.get("/api/debug/emails");

          if (!mailbox.ok()) return "";

          const messages = (await mailbox.json()) as Array<{
            to: string;
            subject: string;
            text: string;
          }>;

          const message = messages.find(
            (item) => item.to === email && item.subject === "Your password reset link",
          );

          resetLink = message?.text.match(/(https?:\/\/[^\s]*reset-password[^\s]*)/)?.[1] ?? "";

          return resetLink;
        },
        { timeout: 20_000 },
      )
      .not.toBe("");

    expect(resetLink).toContain("/reset-password");
  });
});
