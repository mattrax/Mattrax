import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

/**
 * The edge-verifiable SSR bootstrap. A signed-in HTML request must paint the
 * tenant shell and its navigation from the server render, and a warm token must
 * keep working for its five-minute window without relying on the client.
 */
test.describe("SSR bootstrap token", () => {
  test("renders the tenant shell on first paint and reuses the five-minute token", async ({
    page,
    context,
  }) => {
    const tenant = await bootstrapTenant(page, "SSR Boot");
    const path = `/t/${tenant.id}/devices`;

    await gotoHydrated(page, path);
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();

    const ssr = (await context.cookies()).find((cookie) => cookie.name === "__Host-mattrax_ssr");

    const revision = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-mattrax_ssr_rev",
    );

    expect(ssr, "the bootstrap miss should set the SSR token").toBeDefined();
    expect(ssr?.httpOnly).toBe(true);
    expect(ssr?.secure).toBe(true);
    expect(ssr?.sameSite).toBe("Lax");
    expect(ssr?.path).toBe("/");

    // `ver` is only enforceable when this signed comparison value is present.
    expect(revision, "the bootstrap miss should set the SSR revision").toBeDefined();
    expect(revision?.httpOnly).toBe(true);
    expect(revision?.secure).toBe(true);

    // Max-Age=300: allow a few seconds of clock skew between signing and the
    // cookie snapshot but never accept a longer-lived token.
    const remaining = (ssr?.expires ?? 0) - Date.now() / 1_000;

    expect(remaining).toBeGreaterThan(240);
    expect(remaining).toBeLessThanOrEqual(300);

    // Raw server HTML (no hydration) already contains the tenant shell.
    const response = await page.request.get(path, { headers: { accept: "text/html" } });

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect((response.headers().vary ?? "").toLowerCase()).toContain("cookie");

    // This request is warm (the browser context already holds the token), so
    // the Worker must answer from the edge snapshot and not mint a fresh token.
    // A new `Set-Cookie` here would mean the verifier rejected its own signer.
    const setCookies = response
      .headersArray()
      .filter(({ name }) => name.toLowerCase() === "set-cookie");

    expect(
      setCookies.some(({ value }) => value.startsWith("__Host-mattrax_ssr=")),
      "a warm navigation must not reissue the SSR token",
    ).toBe(false);

    const html = await response.text();

    expect(html).toContain("SSR Boot");
    expect(html).toContain("__MATTRAX_SESSION__");
    expect(html).toContain('"permissions"');
    expect(html).toContain(`/t/${tenant.slug}/devices`);

    // A second navigation inside the token window still renders the shell.
    await gotoHydrated(page, `/t/${tenant.id}`);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // The token is an internal service-binding artefact; the public /api proxy
    // must not hand it to the browser. The API router accepts trailing and
    // duplicate slashes, percent-encoding and any case, so every spelling of
    // the endpoint must be redacted too.
    for (const variant of [
      "/api/v1/bootstrap",
      "/api/v1/bootstrap/",
      "/api//v1/bootstrap",
      "/api/v1/%62ootstrap",
      "/api/v1/bOoTsTrAp",
      "/api/v1/bootstrap;jsessionid=x",
    ]) {
      const api = await page.request.get(variant);

      expect(api.status(), variant).toBe(200);

      const body = await api.json();

      expect(body.ssrToken, variant).toBeNull();
      expect(body.ssrTokenExpiresAt, variant).toBeNull();
      expect(body.ssrRevision, variant).toBeNull();
      expect(body.ssrRevisionExpiresAt, variant).toBeNull();
    }
  });
});
