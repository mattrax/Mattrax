import { expect, test } from "@playwright/test";
import {
  api,
  bootstrapTenant,
  createTenant,
  gotoHydrated,
  register,
  uniqueEmail,
} from "./helpers";

const openPalette = async (page: import("@playwright/test").Page) => {
  // Global shortcuts register from `onSettled`, which can be later than first
  // paint on a cold dev server. Retry the header trigger until the palette is
  // actually mounted instead of racing the first transition.
  const input = page.locator('[data-slot="command-palette"] input[role="combobox"]');

  await expect
    .poll(
      async () => {
        if ((await input.count()) > 0) return 1;

        await page.getByRole("button", { name: "Search" }).click();

        return input.count();
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  await expect(input).toBeVisible();

  return input;
};


type InvitePayload = { email: string; roleId?: string; role?: string };

const invite = async (page: import("@playwright/test").Page, tenantId: string, body: InvitePayload) =>
  api<{ inviteUrl: string }>(page, `/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    body: JSON.stringify(body),
  });

const acceptInvitation = async (page: import("@playwright/test").Page, inviteUrl: string) => {
  await gotoHydrated(page, inviteUrl);
  await page.getByRole("button", { name: /^Join / }).click();
};


test.describe("settings destination by role", () => {
  for (const [label, permissions, startPath, expected] of [
    ["devices only", ["devices.read"], "migration", "migration"],
    ["backups only", ["backups.read"], "backups", "backups"],
    ["export only", ["tenant.export"], "migration/export", "migration/export"],
  ] as const) {
    test(`opens the first readable settings tab for a ${label} role`, async ({
      page,
      context,
    }) => {
      const tenant = await bootstrapTenant(page, `Palette ${label}`);
      const email = uniqueEmail(`palette-${label.replaceAll(" ", "-")}`);

      const role = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/roles`, {
        method: "POST",
        body: JSON.stringify({
          name: `Palette ${label}`,
          description: `Settings palette coverage: ${label}`,
          permissions,
        }),
      });

      const invitation = await invite(page, tenant.id, { email, roleId: role.id });
      await context.clearCookies();

      const member = await context.newPage();
      await register(member, { email, name: `Palette ${label}` });
      await acceptInvitation(member, invitation.inviteUrl);

      await gotoHydrated(member, `/t/${tenant.id}/settings/${startPath}`);
      await member.waitForTimeout(900);

      const input = await openPalette(member);
      await input.fill("settings");
      const command = member.getByRole("option", { name: /^Settings/ });
      await expect(command).toBeVisible();
      await command.click();
      await expect(member).toHaveURL(
        new RegExp(`/t/(${tenant.id}|${tenant.slug})/settings/${expected}$`),
      );

      // The `g t` sequence uses the same command and destination.
      await gotoHydrated(member, `/t/${tenant.id}/settings/${startPath}`);
      await member.waitForTimeout(900);
      await member.keyboard.press("g");
      await member.keyboard.press("t");
      await expect(member).toHaveURL(
        new RegExp(`/t/(${tenant.id}|${tenant.slug})/settings/${expected}$`),
      );

      await member.close();
    });
  }
});

test.describe("command palette", () => {
  test("opens with Cmd+K, navigates, and remembers entities", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Tenant");
    await createTenant(page, "Palette Extra");

    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    // The global shortcut is registered from `onSettled`, which runs after the
    // first router transition settles — slightly after the hydration flag.
    await page.waitForTimeout(1000);
    const input = await openPalette(page);

    // Set a marker that only survives an in-document navigation.
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-spa-navigation", "pending"),
    );

    await input.fill("settings");
    await page.getByRole("option", { name: /^Settings/ }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/settings`));

    // The palette must stay inside the document: the marker survives only when
    // the router navigated instead of reloading the page.
    await expect(page.locator("html")).toHaveAttribute("data-spa-navigation", "pending");
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);

    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Quarterly Ops" }),
    });
    await openPalette(page);
    await input.fill("Quarterly");
    // Entity results come from the server search endpoint after the debounce.
    await expect(page.getByRole("option", { name: /Quarterly Ops/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("finds settings, people and constructs device queries", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Discovery");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(900);

    const input = await openPalette(page);
    await input.fill("apns");
    // Settings commands are derived from the settings tab metadata, so the
    // destinations use the tab labels while the APNs keywords still find them.
    await expect(page.getByRole("option", { name: /Delivery/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Management/ })).toBeVisible();

    await input.fill("E2E User");
    await expect(page.getByRole("option", { name: /E2E User/ })).toBeVisible();

    await input.fill("devices critical apple");
    await expect(page.getByRole("option", { name: /Show devices: critical apple/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/devices\?health=critical&proto=apple/);
  });

  test("exposes actions with keyboard shortcuts", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Actions");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(900);

    await openPalette(page);
    await expect(page.getByRole("option", { name: /Account settings/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Create policy/ })).toBeVisible();

    const shortcut = await page
      .getByRole("option", { name: /Account settings/ })
      .locator("kbd")
      .innerText();

    expect(shortcut).toMatch(/[,]/);
    await page.keyboard.press("Escape");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("navigates with sequence shortcuts", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Sequences");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(900);

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/policies$`));
  });

  test("registers policy designer actions and removes them on unmount", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Designer");

    const policy = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/policies`, {
      method: "POST",
      body: JSON.stringify({ name: "Command Policy" }),
    });

    await gotoHydrated(page, `/t/${tenant.id}/policies/${policy.id}/design`);
    await page.waitForTimeout(1600);

    const input = await openPalette(page);
    await expect(page.getByRole("option", { name: /Save policy/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Export policy/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // The registered shortcut drives the same save action as the header button.
    await page.getByRole("button", { name: /security baseline/i }).click();
    await page.waitForTimeout(500);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await expect(page).toHaveURL(new RegExp(`/policies/${policy.id}$`), { timeout: 20_000 });

    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(600);
    await openPalette(page);
    await input.fill("save policy");
    await expect(page.getByRole("option", { name: /Save policy/ })).toHaveCount(0);
  });
});
