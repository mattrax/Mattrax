import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const beginPasskey = {
  _tag: "Success",
  value: {
    flowId: "flow-test",
    expiresAtMillis: Date.now() + 60_000,
    options: { challenge: "AAAA" },
  },
};

const reachPasskeyStep = async (page: Parameters<typeof gotoHydrated>[0]) => {
  await page.route("**/api/v1/sso/azure/start*", (route) =>
    route.fulfill({ status: 404, json: { error: "No SSO tenant found for this email" } }),
  );
  await gotoHydrated(page, "/login");
  await page.locator("#email").fill("person@example.com");
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByRole("button", { name: /passkey/i }).first()).toBeVisible();
};

test.describe("sign-in flow", () => {
  test("starts organisation sign-in automatically and never shows the old button", async ({
    page,
  }) => {
    let requests = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route("**/api/v1/sso/azure/start*", async (route) => {
      requests += 1;
      const url = new URL(route.request().url());

      expect(url.searchParams.get("email")).toBe("person@acme.com");
      expect(url.searchParams.get("returnTo")).toBe("/t/example/devices");
      await gate;
      await route.fulfill({ json: { url: "/login?sso=started" } });
    });

    await gotoHydrated(page, "/login?returnTo=%2Ft%2Fexample%2Fdevices");
    await page.locator("#email").fill("person@acme.com");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // The pending state must not fall back to the redundant organisation button.
    await expect(page.getByText("Checking your organisation…")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with your organisation/i })).toHaveCount(
      0,
    );

    release();
    await expect(page).toHaveURL(/sso=started/);
    expect(requests).toBe(1);
  });

  test("does not start a second redirect when Continue is pressed twice", async ({ page }) => {
    let requests = 0;

    await page.route("**/api/v1/sso/azure/start*", async (route) => {
      requests += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
      await route.fulfill({ json: { url: "/login?sso=started" } });
    });

    await gotoHydrated(page, "/login");
    await page.locator("#email").fill("person@acme.com");

    // Two submits in the same task exercise the in-flight guard before either
    // lookup settles, not just the disabled button state.
    await page.evaluate(() => {
      const form = document.querySelector("form");

      form?.requestSubmit();
      form?.requestSubmit();
    });

    await expect(page).toHaveURL(/sso=started/);
    expect(requests).toBe(1);
  });

  test("keeps a provider failure retryable and offers the passkey path", async ({ page }) => {
    let requests = 0;

    await page.route("**/api/v1/sso/azure/start*", async (route) => {
      requests += 1;

      if (requests === 1) {
        await route.fulfill({ status: 500, json: { error: "private provider detail" } });

        return;
      }

      await route.fulfill({ json: { url: "/login?sso=started" } });
    });

    await gotoHydrated(page, "/login");
    await page.locator("#email").fill("person@acme.com");
    await page.getByRole("button", { name: /^continue$/i }).click();

    await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
    await expect(page.getByText("private provider detail")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sign in with your organisation/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /use a passkey instead/i })).toBeVisible();

    await page.getByRole("button", { name: /try organisation sign-in again/i }).click();
    await expect(page).toHaveURL(/sso=started/);
  });

  test("does not redirect an ordinary passkey account", async ({ page }) => {
    await reachPasskeyStep(page);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sign in with a passkey/i })).toBeVisible();
  });

  test("explains a cancelled passkey prompt without blaming the credential", async ({ page }) => {
    await page.route("**/api/v1/beginPasskeySignIn", (route) =>
      route.fulfill({ json: beginPasskey }),
    );
    await reachPasskeyStep(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "get", {
        configurable: true,
        value: () =>
          Promise.reject(new DOMException("The operation was canceled.", "NotAllowedError")),
      });
    });

    await page.getByRole("button", { name: /sign in with a passkey/i }).click();

    const alert = page.getByRole("alert");

    await expect(alert).toContainText(/cancelled or timed out/i);
    await expect(alert).not.toContainText(/wasn't accepted/i);
    await expect(page.getByRole("button", { name: /try passkey again/i })).toBeVisible();
  });

  test("explains an unavailable authenticator without blaming the credential", async ({ page }) => {
    await page.route("**/api/v1/beginPasskeySignIn", (route) =>
      route.fulfill({ json: beginPasskey }),
    );
    await reachPasskeyStep(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "get", {
        configurable: true,
        value: () =>
          Promise.reject(
            new DOMException("No available authenticator was found.", "NotAllowedError"),
          ),
      });
    });

    await page.getByRole("button", { name: /sign in with a passkey/i }).click();

    const alert = page.getByRole("alert");

    await expect(alert).toContainText(/No passkey option was available/i);
    await expect(alert).not.toContainText(/wasn't accepted/i);
  });

  test("only blames the passkey when the server actually rejects it", async ({ page }) => {
    await page.route("**/api/v1/beginPasskeySignIn", (route) =>
      route.fulfill({ json: beginPasskey }),
    );
    await page.route("**/api/v1/completePasskeySignIn", (route) =>
      route.fulfill({
        status: 400,
        json: { _tag: "Failure", error: { _tag: "PasskeyRejected" } },
      }),
    );
    await reachPasskeyStep(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "get", {
        configurable: true,
        value: () => {
          const credential: Partial<PublicKeyCredential> = {
            id: "credential-test",
            rawId: new Uint8Array([1]).buffer,
            type: "public-key",
            response: {
              authenticatorData: new Uint8Array([1]).buffer,
              clientDataJSON: new Uint8Array([1]).buffer,
              signature: new Uint8Array([1]).buffer,
              userHandle: null,
            },
            getClientExtensionResults: () => ({}),
            authenticatorAttachment: "platform",
          };

          return Promise.resolve(credential as PublicKeyCredential);
        },
      });
    });

    await page.getByRole("button", { name: /sign in with a passkey/i }).click();

    const alert = page.getByRole("alert");

    await expect(alert).toContainText(/wasn't accepted/i);
    await expect(page.getByRole("button", { name: /try passkey again/i })).toBeVisible();
  });
});
