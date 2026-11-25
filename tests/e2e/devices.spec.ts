import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";
import { addFilter, api, bootstrapTenant, gotoHydrated } from "./helpers";

async function mockFleetSearch(page: Page, tenantId: string, rowCount: number, attributeCount = 0) {
  const attributes = Array.from({ length: attributeCount }, (_, index) => ({
    id: `attribute-${index}`,
    key: `custom_${index}`,
    label: `Custom attribute ${index + 1}`,
    type: "text",
    required: false,
    visibility: "visible",
    source: "manual",
    sortOrder: index,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  }));
  const devices = Array.from({ length: rowCount }, (_, index) => ({
    id: `device-${index}`,
    proto: "apple",
    name: `Virtual Device ${String(index + 1).padStart(3, "0")}`,
    model: "MacBook Pro",
    serial: `SERIAL-${index}`,
    status: "enrolled",
    enrolledAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-11-18T00:00:00.000Z",
    groups: [],
    health: { level: "healthy", reasons: [], stale: false, online: true },
    attributes: Object.fromEntries(
      attributes.map((attribute, attributeIndex) => [
        attribute.key,
        `value-${index}-${attributeIndex}-${"x".repeat(80)}`,
      ]),
    ),
  }));

  await page.route(`**/api/v1/tenants/${tenantId}/attributes`, (route) =>
    route.fulfill({ json: { rows: attributes } }),
  );
  await page.route(`**/api/v1/tenants/${tenantId}/devices/search*`, async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q")?.toLowerCase() ?? "";
    const direction = url.searchParams.get("direction") ?? "asc";
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const matching = devices.filter((device) => device.name.toLowerCase().includes(query));
    const ordered = direction === "desc" ? [...matching].reverse() : matching;

    await route.fulfill({
      json: { devices: ordered.slice(offset, offset + limit), total: ordered.length },
    });
  });
}

async function scrollColumnHeaderIntoView(viewport: Locator, name: string) {
  const header = viewport.getByRole("columnheader", { name, exact: true });

  await expect
    .poll(
      async () => {
        if (await header.count()) {
          // Scroll the region by the header's offset. `scrollIntoViewIfNeeded`
          // does not move this sticky header out of the far-right window, so
          // compute the target from the rendered geometry instead.
          const left = await header.evaluate((element) => {
            const region = element.closest('[role="region"]');
            const rect = element.getBoundingClientRect();
            const regionRect = region?.getBoundingClientRect();

            if (!region || !regionRect) return 0;

            return Math.max(0, rect.left - regionRect.left + region.scrollLeft - 24);
          });

          await viewport.evaluate((element, value) => {
            element.scrollLeft = value;
          }, left);

          try {
            await expect(header).toBeInViewport({ timeout: 1_000 });

            return true;
          } catch {
            return false;
          }
        }

        // Jump to the far end. Column windows are measured, and a wide column
        // can be hundreds of pixels, so scrolling one viewport at a time makes
        // the target recede as newly measured columns widen the table.
        await viewport.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });

        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  return header;
}

async function scrollRowCheckboxIntoView(viewport: Locator, name: RegExp) {
  const checkbox = viewport.getByRole("checkbox", { name });

  await expect
    .poll(
      async () => {
        if (await checkbox.count()) return true;

        await viewport.evaluate((element) => {
          element.scrollTop = Math.min(
            element.scrollHeight,
            element.scrollTop + element.clientHeight,
          );
        });

        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await checkbox.scrollIntoViewIfNeeded();
  await expect(checkbox).toBeInViewport();

  return checkbox;
}

const fulfillJson = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

const deviceDetailFixtures = [
  {
    proto: "apple",
    name: "Regression MacBook",
    actionLabel: "Start lost mode",
    actions: ["sync", "lock", "wipe", "start-lost-mode"],
  },
  {
    proto: "win",
    name: "Regression workstation",
    actionLabel: "Restart",
    actions: ["sync", "lock", "wipe", "restart"],
  },
  {
    proto: "android",
    name: "Regression work phone",
    actionLabel: "Relinquish ownership",
    actions: ["sync", "lock", "wipe", "relinquish-ownership"],
  },
] as const;

/** Mock only the device-detail reads; authentication and shell data stay real. */
async function mockDeviceDetail(
  page: Page,
  tenantId: string,
  fixture: (typeof deviceDetailFixtures)[number],
) {
  const id = `regression-${fixture.proto}`;
  const at = "2026-11-24T12:00:00.000Z";
  const row = {
    id,
    proto: fixture.proto,
    name: fixture.name,
    model: `${fixture.proto} regression model`,
    serial: `REGRESSION-${fixture.proto.toUpperCase()}`,
    status: "enrolled",
    enrolledAt: at,
    lastSeenAt: at,
    actions: [...fixture.actions],
    groups: [],
    ...(fixture.proto === "apple" ? { apple: { lostMode: null, localAccounts: [] } } : {}),
  };
  const base = `**/api/v1/tenants/${tenantId}`;

  await page.route(`${base}/devices/${id}`, (route) => fulfillJson(route, row));
  await page.route(`${base}/devices/${id}/**`, (route) => {
    const suffix = new URL(route.request().url()).pathname.split(`/devices/${id}`)[1];

    switch (suffix) {
      case "/users":
        return fulfillJson(route, { users: [] });
      case "/health":
        return fulfillJson(route, {
          health: { level: "healthy", reasons: [], lastSeenAt: at, stale: false },
          declarations: [],
          certificates: [],
          managedCertificates: [],
          push: { configured: false, consecutiveFailures: 0, invalidToken: false },
        });
      case "/applications":
        return fulfillJson(route, { applications: [] });
      case "/apple-users":
        return fulfillJson(route, { users: [], enrollmentMode: "device" });
      case "/activity":
        return fulfillJson(route, { events: [], hasMore: false });
      case "/commands":
        return fulfillJson(route, { commands: [] });
      case "/effective-policy":
        return fulfillJson(route, {
          deviceId: id,
          configurations: [],
          policies: [],
          overridden: [],
          exclusions: [],
        });
      case "/restricted-software":
        return fulfillJson(route, { violations: [], rules: [] });
      case "/attributes/collection":
        return fulfillJson(route, { collection: {} });
      case "/windows-security":
        return fulfillJson(route, {
          platformSupported: true,
          laps: { supported: true, configured: false, retrievable: false },
          bitlocker: {
            encrypted: false,
            joined: false,
            rotationInProgress: false,
            keys: [],
            escrowMissing: false,
          },
        });
      case "/diagnostics":
        return fulfillJson(route, { supported: true, archives: [] });
      default:
        throw new Error(`Unmocked device detail endpoint: ${suffix}`);
    }
  });
  await page.route(`${base}/devices/handover-impact`, (route) =>
    fulfillJson(route, { devices: [], canExport: true }),
  );
  await page.route(`${base}/devices/search*`, (route) =>
    fulfillJson(route, { devices: [row], total: 1 }),
  );
  await page.route(`${base}/groups`, (route) => fulfillJson(route, { rows: [] }));
  await page.route(`${base}/directory`, (route) => fulfillJson(route, { users: [], groups: [] }));
  await page.route(`${base}/attributes`, (route) => fulfillJson(route, { rows: [] }));
  await page.route(`${base}/scope-tags`, (route) => fulfillJson(route, { tags: [] }));
  await page.route(`${base}/scope-tags/**`, (route) => fulfillJson(route, { assignments: [] }));
  await page.route(`${base}/abm`, (route) =>
    fulfillJson(route, {
      configured: false,
      status: "unconfigured",
      deviceCount: 0,
      assignedCount: 0,
    }),
  );
  await page.route(`${base}/windows/failures*`, (route) =>
    fulfillJson(route, { retentionDays: 30, count: 0, failures: [] }),
  );

  return id;
}

test.describe("device fleet management", () => {
  test("searches, filters and exports the device list", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Fleet Tenant");

    // The filter bar is rendered and paginates even with no devices.
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
    await expect(page.getByText("Page 1 of 1")).toBeVisible();
    await expect(page.getByRole("button", { name: /previous/i })).toBeDisabled();

    // The search endpoint is tenant-scoped and returns the agreed shape.
    const found = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?limit=10`,
    );

    expect(found).toEqual({ devices: [], total: 0 });

    // Filtering and sorting compile against MySQL even with no matching rows.
    const filtered = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?status=enrolled&proto=apple&staleDays=30&sort=lastSeenAt&direction=desc&limit=10&offset=0`,
    );

    expect(filtered).toEqual({ devices: [], total: 0 });

    // Group filters use a SQL subquery scoped to the tenant.
    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Field Ops" }),
    });

    const inGroup = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?groupId=${group.id}`,
    );

    expect(inGroup).toEqual({ devices: [], total: 0 });

    // A tenant id the caller cannot see is rejected rather than leaking rows.
    const missing = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/devices/search?limit=10",
    );

    expect(missing.status()).toBe(404);

    // Export responds with an attachment and RFC 4180 CSV.
    const response = await page.request.get(`/api/v1/tenants/${tenant.id}/devices/export`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(await response.text()).toBe(
      "Name,Serial,Model,Platform,Status,OS version,OS build,Last seen,Enrolled at,Asset tag,Model number,FileVault,Activation,Battery health,Capabilities,Inventory updated,Notes,Groups,Local accounts\r\n",
    );

    // The toolbar action downloads a dated CSV file.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    expect((await download).suggestedFilename()).toMatch(/^devices-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("drives the table from the keyboard and advertises the shortcuts", async ({ page }) => {
    // The table's shortcuts register from `onSettled`, which can run after the
    // hydration flag; press until the shortcut lands instead of racing it.
    const focusSearch = async (search: Locator) => {
      await expect
        .poll(
          async () => {
            await page.keyboard.press("/");

            return search.evaluate((element) => element === document.activeElement);
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    };

    const tenant = await bootstrapTenant(page, "Keyboard Tenant");

    const alpha = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Keyboard Alpha" }),
    });

    const beta = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Keyboard Beta" }),
    });

    await gotoHydrated(page, `/t/${tenant.slug}/groups`);
    const search = page.getByLabel("Search table");

    await focusSearch(search);
    await expect(search).toBeFocused();
    await search.fill("Keyboard");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");

    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+f`);
    await expect(search).toBeFocused();

    // Arrow keys move a roving tabindex between rows; Enter opens the row.
    const activeText = () => page.evaluate(() => document.activeElement?.textContent ?? "");
    await page.getByRole("link", { name: "Keyboard Alpha" }).focus();
    const start = await activeText();
    await page.keyboard.press("ArrowDown");
    let moved = await activeText();

    if (moved === start) {
      await page.keyboard.press("ArrowUp");
      moved = await activeText();
    }

    expect(moved).not.toBe(start);
    expect(moved).toContain("Keyboard");
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TR");

    // Select every row on the page, then Escape clears the selection.
    await page.keyboard.press(`${mod}+a`);
    await expect(page.getByRole("group", { name: "Bulk actions" })).toContainText("2 selected");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Bulk actions" })).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/groups/(${alpha.id}|${beta.id})$`));
  });

  test("keeps arrow-focused rows visible in the default 50-row fleet table", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Fifty Row Fleet");

    await mockFleetSearch(page, tenant.id, 50);
    await gotoHydrated(page, `/t/${tenant.slug}/devices`);

    const viewport = page.getByRole("region", { name: "Data table" });
    const rows = viewport.locator("tbody tr[data-row-id]");

    await expect(viewport).not.toHaveAttribute("data-virtualized", "true");
    await expect(rows).toHaveCount(50);
    await rows.first().focus();

    for (let index = 0; index < 35; index++) await page.keyboard.press("ArrowDown");

    const active = page.locator('tr[data-row-id="device-35"]');
    await expect(active).toBeFocused();
    await expect(active).toBeInViewport();
    // The dashboard shell scrolls inside `#main`, not the document, so that is
    // the scrollport that must have moved to keep the focused row visible.
    await expect
      .poll(() =>
        page.evaluate(() => document.getElementById("main")?.scrollTop ?? window.scrollY),
      )
      .toBeGreaterThan(0);
  });

  test("virtualizes wide fleet tables while preserving keyboard and range selection", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = await bootstrapTenant(page, "Virtual Fleet");
    await mockFleetSearch(page, tenant.id, 200, 24);

    await gotoHydrated(page, `/t/${tenant.slug}/devices?pageSize=200`);

    const viewport = page.getByRole("region", { name: "Data table" });
    const table = page.getByRole("table", { name: "Data table" });
    const rows = viewport.locator("tbody tr[data-row-id]");

    await expect(viewport).toHaveAttribute("data-virtualized", "true");
    await expect(viewport).toHaveAttribute("data-columns-virtualized", "true");
    await expect(table).toHaveAttribute("aria-rowcount", "201");
    await expect(table).toHaveAttribute("aria-colcount", "34");
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-0");
    expect(await rows.count()).toBeGreaterThan(0);
    expect(await rows.count()).toBeLessThanOrEqual(40);
    expect(await viewport.locator("tbody td").count()).toBeLessThanOrEqual(650);
    expect(await viewport.locator("thead th").count()).toBeLessThanOrEqual(16);

    const firstHeader = viewport.getByRole("columnheader", { name: "Custom attribute 1" });
    const secondRowCell = rows.nth(1).locator("td").first();
    await expect(firstHeader).toHaveCSS("border-bottom-width", "1px");
    await expect(secondRowCell).toHaveCSS("border-top-width", "1px");
    await expect(viewport.locator("tr[data-table-spacer] td").first()).toHaveCSS(
      "border-top-width",
      "0px",
    );

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        document.documentElement.classList.toggle("dark", value === "dark");
        document.documentElement.style.colorScheme = value;
      }, theme);
      await expect(firstHeader).not.toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
      await expect(secondRowCell).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    }

    await scrollColumnHeaderIntoView(viewport, "Last seen");
    expect(await viewport.locator("thead th").count()).toBeLessThanOrEqual(16);

    await viewport.evaluate((element) => {
      element.scrollTop = 1_200;
    });
    await expect(rows.first()).not.toHaveAttribute("data-row-id", "device-0");
    expect(await rows.count()).toBeLessThanOrEqual(40);

    const viewportBox = await viewport.boundingBox();
    const headerBox = await viewport.locator("thead").boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(Math.abs((headerBox?.y ?? 0) - (viewportBox?.y ?? 0))).toBeLessThanOrEqual(2);

    await viewport.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-0");
    await rows.first().focus();

    for (let index = 0; index < 35; index++) await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-row-id")))
      .toBe("device-35");
    expect(await rows.count()).toBeLessThanOrEqual(40);

    const wheelBox = await viewport.boundingBox();
    expect(wheelBox).not.toBeNull();
    await page.mouse.move(
      (wheelBox?.x ?? 0) + (wheelBox?.width ?? 0) / 2,
      (wheelBox?.y ?? 0) + (wheelBox?.height ?? 0) / 2,
    );
    await page.mouse.wheel(0, 5_000);
    await expect(page.locator('tr[data-row-id="device-35"]')).toHaveCount(0);
    await expect(viewport).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() =>
        page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          id: document.activeElement?.getAttribute("data-row-id"),
        })),
      )
      .toMatchObject({ tag: "TR" });
    const resumedRowId = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-row-id"),
    );
    expect(resumedRowId).not.toBeNull();
    await expect(page.locator(`tr[data-row-id="${resumedRowId}"]`)).toBeInViewport();

    await viewport.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-0");
    const descendantFocus = page.getByRole("checkbox", { name: /Select Virtual Device 001/ });
    await descendantFocus.focus();
    await expect(rows.first()).toHaveAttribute("tabindex", "0");
    await page.mouse.move(
      (wheelBox?.x ?? 0) + (wheelBox?.width ?? 0) / 2,
      (wheelBox?.y ?? 0) + (wheelBox?.height ?? 0) / 2,
    );
    await page.mouse.wheel(0, 5_000);
    await expect(page.locator('tr[data-row-id="device-0"]')).toHaveCount(0);
    await expect(viewport).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("TR");

    await viewport.evaluate((element) => {
      element.scrollTop = 0;
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-0");
    await expect(table).toHaveAttribute("aria-colcount", "33");
    await expect(page.getByRole("columnheader", { name: "Row", exact: true })).toHaveCount(0);
    expect(await rows.first().locator("td").count()).toBe(
      await viewport.locator("thead th").count(),
    );
    await expect
      .poll(async () => {
        const colspan = Number(
          await viewport
            .locator('tr[data-table-spacer="bottom"] td')
            .first()
            .getAttribute("colspan"),
        );

        return colspan === (await viewport.locator("thead th").count());
      })
      .toBe(true);

    const swipeHint = page.getByText("Swipe the table sideways to see more columns.");
    await expect(swipeHint).toBeInViewport();
    await rows.first().focus();
    for (let index = 0; index < 35; index++) await page.keyboard.press("ArrowDown");
    await expect(page.locator('tr[data-row-id="device-35"]')).toBeFocused();
    await expect(page.locator('tr[data-row-id="device-35"]')).toBeInViewport();
    await expect(swipeHint).toBeInViewport();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(table).toHaveAttribute("aria-colcount", "34");
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-0");

    /**
     * Playwright's stability gate never settles for this row even though the
     * input does not move or detach (verified with a MutationObserver and
     * repeated bounding boxes), so force the click and keep the selection
     * assertion that makes it meaningful.
     */
    const firstVirtualCheckbox = page.getByRole("checkbox", {
      name: /Select Virtual Device 001/,
    });
    await firstVirtualCheckbox.check({ force: true });
    await expect(firstVirtualCheckbox).toBeChecked();
    const rangeTarget = await scrollRowCheckboxIntoView(viewport, /Select Virtual Device 035/);
    await expect(page.locator('tr[data-row-id="device-0"]')).toHaveCount(0);
    await rangeTarget.focus();
    await page.keyboard.press("Shift+Space");
    await expect(page.getByRole("group", { name: "Bulk actions" })).toContainText("35 selected");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Bulk actions" })).toHaveCount(0);

    await viewport.evaluate((element) => {
      element.scrollTop = 0;
    });
    await firstVirtualCheckbox.check({ force: true });
    await expect(firstVirtualCheckbox).toBeChecked();
    const farRangeTarget = await scrollRowCheckboxIntoView(viewport, /Select Virtual Device 081/);
    await expect(page.locator('tr[data-row-id="device-0"]')).toHaveCount(0);
    await farRangeTarget.focus();
    await page.keyboard.press("Shift+Space");
    await expect(page.getByRole("group", { name: "Bulk actions" })).toContainText("81 selected");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Bulk actions" })).toHaveCount(0);

    await viewport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const nameHeader = await scrollColumnHeaderIntoView(viewport, "Name");
    const nameSort = nameHeader.getByRole("button", { name: "Name", exact: true });
    // Same actionability false-positive as the row checkbox: the header is
    // present and stable, but Playwright's gate never settles. The order
    // assertions prove the click landed.
    await nameSort.click({ force: true });
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-199");
    expect(await rows.count()).toBeLessThanOrEqual(40);
    // Sorting can reset the horizontal window, so bring the header back before
    // toggling the direction.
    const nameHeaderAgain = await scrollColumnHeaderIntoView(viewport, "Name");
    await nameHeaderAgain
      .getByRole("button", { name: "Name", exact: true })
      .click({ force: true });
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-0");

    const search = page.getByLabel("Search table");
    await search.fill("Virtual Device 199");
    await expect(rows).toHaveCount(1);
    // The fixture names rows one-based ("Virtual Device 199") but ids are
    // zero-based ("device-198").
    await expect(rows.first()).toHaveAttribute("data-row-id", "device-198");
    await expect(viewport).not.toHaveAttribute("data-virtualized", "true");

    await search.fill("no-such-device");
    await expect(page.getByText(/No matches for/)).toBeVisible();
    await search.fill("");
    await expect(viewport).toHaveAttribute("data-virtualized", "true");
    expect(await rows.count()).toBeLessThanOrEqual(40);
  });

  test("keeps typed device search and sends it to the search endpoint", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Search Tenant");
    const search = page.getByPlaceholder(/search name/i);

    const request = page.waitForResponse((response) => {
      if (!response.url().includes(`/api/v1/tenants/${tenant.id}/devices/search`)) return false;

      return new URL(response.url()).searchParams.get("q") === "abc";
    });

    await search.fill("abc");
    await expect(search).toHaveValue("abc");
    expect((await request).ok()).toBe(true);
    // The URL mirror only writes after the debounce, but the input must still
    // hold the typed value before and after that write.
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("abc");
    await expect(search).toHaveValue("abc");

    // Additional keystrokes are not reverted to the last URL value.
    const extended = page.waitForResponse((response) => {
      if (!response.url().includes(`/api/v1/tenants/${tenant.id}/devices/search`)) return false;

      return new URL(response.url()).searchParams.get("q") === "abcd";
    });

    await search.fill("abcd");
    await expect(search).toHaveValue("abcd");
    expect((await extended).ok()).toBe(true);
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("abcd");

    // Other controls still round-trip through the URL.
    await addFilter(page, "Status", "Enrolled");
    await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("enrolled");
    await addFilter(page, "Platform", "Apple");
    await expect.poll(() => new URL(page.url()).searchParams.get("proto")).toBe("apple");
    await expect(page.getByRole("button", { name: /Status is Enrolled/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Platform is Apple/ })).toBeVisible();

    // A group created after mount only appears in the select after a reload.
    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Field Ops" }),
    });

    await gotoHydrated(page, page.url());
    await addFilter(page, "Group", "Field Ops");
    await expect.poll(() => new URL(page.url()).searchParams.get("groupId")).toBe(group.id);
    await addFilter(page, "Health", "Critical");
    await expect.poll(() => new URL(page.url()).searchParams.get("health")).toBe("critical");
    await addFilter(page, "Push delivery", "Failing");
    await expect.poll(() => new URL(page.url()).searchParams.get("push")).toBe("failing");
    await addFilter(page, "Last seen", "Not in 7 days");
    await expect.poll(() => new URL(page.url()).searchParams.get("staleDays")).toBe("7");

    // The URL is the source of truth after a reload.
    await gotoHydrated(page, page.url());
    await expect(search).toHaveValue("abcd");
    await expect(page.getByRole("button", { name: /Status is Enrolled/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Platform is Apple/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Group is Field Ops/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Health is Critical/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Push delivery is Failing/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Last seen is Not in 7 days/ })).toBeVisible();

    // Clearing filters clears both the controls and the URL.
    await page
      .getByRole("button", { name: /clear filters/i })
      .first()
      .click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.toString()).toBe("");
  });

  test("shows the tenant health rollup and exposes device health", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Health Tenant");

    const summary = await api<{
      counts: {
        total: number;
        healthy: number;
        attention: number;
        critical: number;
        missing: number;
        stale: number;
        unknown: number;
      };
      reasons: unknown[];
      devices: unknown[];
    }>(page, `/api/v1/tenants/${tenant.id}/device-health`);

    expect(summary.counts).toEqual({
      total: 0,
      healthy: 0,
      attention: 0,
      critical: 0,
      missing: 0,
      stale: 0,
      unknown: 0,
    });
    expect(summary.reasons).toEqual([]);
    expect(summary.devices).toEqual([]);

    await gotoHydrated(page, `/t/${tenant.slug}`);
    await expect(page.getByRole("heading", { name: "Fleet overview", exact: true })).toBeVisible();

    for (const label of [
      "Managed devices",
      "Devices needing attention",
      "Critical devices",
      "Stale devices",
    ])
      await expect(page.getByRole("heading", { name: label, exact: true }).first()).toBeVisible();

    // Credential monitoring is tenant-scoped too.
    const credentials = await api<{
      apns: { configured: boolean; level: string };
      scepCa: { configured: boolean; level: string };
      deviceCertificates: { total: number };
    }>(page, `/api/v1/tenants/${tenant.id}/credential-health`);

    expect(credentials.apns).toMatchObject({ configured: false, level: "missing" });
    expect(credentials.scepCa.level).toMatch(/missing|ok/);
    expect(credentials.deviceCertificates.total).toBe(0);

    // APNs delivery health is a settings diagnostic, not overview content.
    const pushHealth = await api<{
      counts: {
        configured: number;
        attempted: number;
        succeeded: number;
        failing: number;
        invalidToken: number;
      };
      recentFailures: unknown[];
    }>(page, `/api/v1/tenants/${tenant.id}/push-health`);

    expect(pushHealth.counts).toEqual({
      configured: 0,
      attempted: 0,
      succeeded: 0,
      failing: 0,
      invalidToken: 0,
    });
    expect(pushHealth.recentFailures).toEqual([]);
    await expect(page.getByText("No data to chart.")).toBeVisible();
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
    await gotoHydrated(page, `/t/${tenant.id}/settings/delivery`);
    await expect(
      page.getByRole("heading", { name: "Apple push delivery", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent failures", exact: true })).toBeVisible();

    // Device activity is tenant-scoped and missing devices are a 404.
    const missingActivity = await page.request.get(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/activity`,
    );

    expect(missingActivity.status()).toBe(404);

    const missingPushHealth = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/push-health",
    );

    expect(missingPushHealth.status()).toBe(404);

    const missingCredentials = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/credential-health",
    );

    expect(missingCredentials.status()).toBe(404);

    // A tenant the caller cannot see is rejected rather than leaking counts.
    const missing = await page.request.get("/api/v1/tenants/not-a-real-tenant/device-health");
    expect(missing.status()).toBe(404);

    // Unknown devices do not expose health or identity actions.
    const unknownHealth = await page.request.get(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/health`,
    );

    expect(unknownHealth.status()).toBe(404);

    const unknownRevoke = await page.request.post(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/revoke-identity`,
      { headers: { origin: "http://localhost:9050", "x-effect-auth-csrf": "1" } },
    );

    expect(unknownRevoke.status()).toBe(404);
  });

  test("imports pre-registered devices from a CSV with preview validation", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Import Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Staff" }),
    });
    await gotoHydrated(page, `/t/${tenant.id}/devices`);

    await page.getByRole("button", { name: /import csv/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Import pre-registered devices")).toBeVisible();
    const input = page.locator('input[type="file"]');

    // A row without a serial is surfaced before anything is sent.
    await input.setInputFiles({
      name: "invalid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("serial,name\n,Missing serial\n"),
    });
    await expect(dialog.getByText(/serial is required/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^import 0 devices$/i })).toBeDisabled();

    await input.setInputFiles({
      name: "devices.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "serial,name,asset_tag,group,notes\r\nC02IMPORT,Campus Mac,AT-900,Staff,Imported by e2e\r\n",
      ),
    });
    await expect(dialog.getByText(/1\s+row ready/i)).toBeVisible();
    await expect(dialog.getByText("C02IMPORT")).toBeVisible();
    await dialog.getByRole("button", { name: /^import 1 device$/i }).click();
    await expect(dialog.getByText("Created")).toBeVisible();
    await dialog.getByRole("button", { name: /^done$/i }).click();

    const registrations = await api<{
      rows: Array<{ serial: string; name: string; assetTag: string; groupName: string }>;
    }>(page, `/api/v1/tenants/${tenant.id}/device-pre-registrations`);

    expect(registrations.rows).toEqual([
      expect.objectContaining({
        serial: "C02IMPORT",
        name: "Campus Mac",
        assetTag: "AT-900",
        groupName: "Staff",
      }),
    ]);
  });

  for (const fixture of deviceDetailFixtures) {
    test(`device detail async routes render ${fixture.proto} without an untracked pending read`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      const tenant = await bootstrapTenant(page, `Detail ${fixture.proto}`);
      const id = await mockDeviceDetail(page, tenant.id, fixture);

      await gotoHydrated(page, `/t/${tenant.id}/devices/${id}`);

      await expect(page.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
      await expect(page.getByRole("table", { name: "Device inventory" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Remote actions" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sync device now" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: fixture.actionLabel, exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Check your details")).toHaveCount(0);

      await page.getByRole("button", { name: "Edit device details" }).click();
      await expect(
        page.getByRole("dialog").getByRole("heading", { name: "Edit device details" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      /**
       * The detail page keeps loading cards while the tab row is already
       * interactive, and a layout shift between the mouse down and up swallows
       * the click entirely. Click again until the tab reports that it was
       * activated; the assertion below still has to pass.
       */
      const scopeTab = page.getByRole("tab", { name: "Scope", exact: true });
      await expect
        .poll(
          async () => {
            if ((await scopeTab.getAttribute("aria-selected")) === "true") return true;

            await scopeTab.click();

            return (await scopeTab.getAttribute("aria-selected")) === "true";
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Effective policy" })).toBeVisible();

      expect(errors.some((message) => message.includes("PENDING_ASYNC_UNTRACKED_READ"))).toBe(
        false,
      );
    });
  }

  test("a held Devices search keeps the heading and table loading state visible", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Held Search");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route(`**/api/v1/tenants/${tenant.id}/devices/search*`, async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "held") {
        await route.continue();

        return;
      }

      await held;
      await fulfillJson(route, { devices: [], total: 0 });
    });

    try {
      const request = page.waitForRequest((candidate) => {
        if (!candidate.url().includes(`/api/v1/tenants/${tenant.id}/devices/search`)) return false;

        return new URL(candidate.url()).searchParams.get("q") === "held";
      });
      await page.goto(`/t/${tenant.id}/devices?q=held`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => document.documentElement.dataset.hydrated === "true",
        undefined,
        { timeout: 20_000 },
      );
      await request;

      await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
      await expect(page.getByText("Loading rows…")).toBeAttached();
      await expect(page.getByText("No matches for “held”", { exact: true })).toHaveCount(0);
    } finally {
      release();
    }

    await expect(page.getByText("No matches for “held”", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
  });
});
