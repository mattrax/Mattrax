import { expect, test } from "@playwright/test";

/**
 * Edge behaviour of the public Worker: security headers, private HTML caching,
 * the path guard and the static redirect/header rules.
 *
 * `_headers` only applies to the asset layer. The dev server emulates it when
 * `experimental.headersAndRedirectsDevModeSupport` is on, but hashed build
 * assets only exist after a production build, so those assertions are gated on
 * `E2E_CDN_HEADERS=1` (a build + `cf preview` or deployed environment).
 */
test.describe("worker security and caching", () => {
  test("HTML responses are private and carry the security policy", async ({ request }) => {
    const response = await request.get("/login");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");

    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(headers["permissions-policy"]).toContain("publickey-credentials-get=(self)");

    const policy = headers["content-security-policy"];

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    // The resource policy stays report-only until nonces are wired.
    expect(policy).not.toContain("default-src");
    expect(headers["content-security-policy-report-only"]).toContain("default-src 'self'");

    // Authenticated shells must never be cached by the CDN or a shared cache.
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["cdn-cache-control"]).toBe("no-store");
    expect(headers.vary.toLowerCase()).toContain("cookie");
  });

  test("API responses keep their own caching and gain no CSP", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    // The API Worker chooses its own content type and cache policy; the web
    // Worker only adds the shared hardening headers.
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["content-security-policy"]).toBeUndefined();
    expect(response.headers()["content-security-policy-report-only"]).toBeUndefined();
    expect(response.headers()["cross-origin-resource-policy"]).toBeUndefined();
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("dotfiles and CMS probes are 404, not rendered HTML", async ({ request }) => {
    for (const pathname of ["/.git/config", "/.env", "/.DS_Store", "/wp-admin", "/xmlrpc.php"]) {
      const response = await request.get(pathname);

      expect(response.status(), pathname).toBe(404);
      expect(response.headers()["content-type"], pathname).toContain("text/plain");
    }
  });

  test("unknown app routes report a 404 status", async ({ request }) => {
    const response = await request.get("/this-page-definitely-does-not-exist");

    expect(response.status()).toBe(404);
    expect(await response.text()).toContain("404");
  });

  test("docs paths that are not in the asset layer are 404", async ({ request }) => {
    const response = await request.get("/docs/does-not-exist");

    expect(response.status()).toBe(404);
  });

  test("legacy dashboard paths redirect permanently", async ({ request }) => {
    for (const pathname of ["/app", "/instances", "/admin"]) {
      const response = await request.get(pathname, { maxRedirects: 0 });

      expect(response.status(), pathname).toBe(308);
      expect(response.headers().location, pathname).toBe("/dashboard");
    }
  });

  test("Worker-owned prefixes are never redirected", async ({ request }) => {
    for (const pathname of ["/api/health", "/.well-known/oauth-authorization-server"]) {
      const response = await request.get(pathname, { maxRedirects: 0 });

      expect(response.status(), pathname).toBeLessThan(400);
    }
  });

  test("static assets use the CDN cache policy", async ({ request }) => {
    test.skip(
      process.env.E2E_CDN_HEADERS !== "1",
      "hashed assets and built docs only exist in a production-like run",
    );

    const page = await request.get("/login");
    const html = await page.text();
    const hashedAsset = html.match(/\/assets\/[^"'\\\s]+\.(?:js|css)/)?.[0];

    if (!hashedAsset) throw new Error("the shell does not reference a hashed asset");

    const asset = await request.get(hashedAsset);

    expect(asset.status()).toBe(200);
    expect(asset.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");

    const docs = await request.get("/docs/");

    expect(docs.status()).toBe(200);
    expect(docs.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(docs.headers()["content-security-policy"]).toContain("'unsafe-inline'");

    const icon = await request.get("/favicon.ico");

    expect(icon.status()).toBe(200);
    expect(icon.headers()["cache-control"]).toBe("public, max-age=86400");
  });
});
