import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("Apple Business Manager and Apps and Books", () => {
  test("shows unconfigured ABM/VPP state and rejects an invalid ABM token", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Apple Business Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/management`);

    await expect(page.getByText("Apple Business Manager", { exact: true })).toBeVisible();
    await expect(page.getByText("Automated Device Enrollment")).toBeVisible();
    await expect(page.getByText("Volume licences")).toBeVisible();
    await expect(page.getByText("Not configured").first()).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("abm-token-file").click();
    const files = await chooser;
    await files.setFiles({
      name: "invalid.pem",
      mimeType: "application/x-pem-file",
      buffer: Buffer.from("this is not an Apple private key"),
    });

    await page.getByRole("button", { name: /Save ABM credential/i }).click();
    await expect(
      page.getByText(/Unrecognised Apple token|private key|Client ID/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
