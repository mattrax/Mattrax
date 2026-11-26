import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HTML_CONTENT_SECURITY_POLICY,
  compilePagePattern,
  compilePagePatterns,
  guardPath,
  isBootstrapPath,
  isKnownPagePath,
  isPassthroughPath,
  isProfileUpdatePath,
  mergeVary,
  canonicalHostUrl,
  normalisePath,
  securityHeaders,
  withSecurityHeaders,
} from "./security";

const httpsHtml = {
  url: "https://e.mattrax.app/dashboard",
  contentType: "text/html; charset=utf-8",
};

describe("securityHeaders", () => {
  it("hardens every response and advertises HSTS over HTTPS", () => {
    const headers = securityHeaders(httpsHtml);

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["permissions-policy"]).toContain("publickey-credentials-get=(self)");
    expect(headers["x-permitted-cross-domain-policies"]).toBe("none");
    expect(headers["x-dns-prefetch-control"]).toBe("off");
    expect(headers["origin-agent-cluster"]).toBe("?1");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("does not send HSTS from local HTTP", () => {
    const headers = securityHeaders({ ...httpsHtml, url: "http://localhost:9050/login" });

    expect(headers["strict-transport-security"]).toBeUndefined();
  });

  it("keeps the enforcing policy narrow and the resource policy report-only", () => {
    const headers = securityHeaders(httpsHtml);

    expect(headers["content-security-policy"]).toBe(HTML_CONTENT_SECURITY_POLICY);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("base-uri 'self'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
    // The full resource policy must stay report-only: Solid hydration and
    // PostHog both need inline scripts and a second origin.
    expect(headers["content-security-policy"]).not.toContain("default-src");
    expect(headers["content-security-policy-report-only"]).toContain("default-src 'self'");
    expect(headers["content-security-policy-report-only"]).toContain("'unsafe-inline'");
  });

  it("makes authenticated HTML private and keeps it out of the CDN cache", () => {
    const headers = securityHeaders(httpsHtml);

    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["cdn-cache-control"]).toBe("no-store");
    expect(headers.vary).toBe("Cookie");
  });

  it('lets the shared cache keep the signed-out shell for "/"', () => {
    const pathname = "/";

    const headers = securityHeaders({
      ...httpsHtml,
      url: `https://e.mattrax.app${pathname}`,
    });

    expect(headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
    );
    expect(headers["cdn-cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(headers.vary).toBe("Accept-Encoding");
  });

  it('lets the shared cache keep the signed-out shell for "/privacy"', () => {
    const pathname = "/privacy";

    const headers = securityHeaders({
      ...httpsHtml,
      url: `https://e.mattrax.app${pathname}`,
    });

    expect(headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
    );
    expect(headers["cdn-cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(headers.vary).toBe("Accept-Encoding");
  });

  it('lets the shared cache keep the signed-out shell for "/terms"', () => {
    const pathname = "/terms";

    const headers = securityHeaders({
      ...httpsHtml,
      url: `https://e.mattrax.app${pathname}`,
    });

    expect(headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
    );
    expect(headers["cdn-cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(headers.vary).toBe("Accept-Encoding");
  });

  it("does not cache a public path that sets a cookie", () => {
    const headers = securityHeaders({
      ...httpsHtml,
      url: "https://e.mattrax.app/",
      hasSetCookie: true,
    });

    expect(headers["cache-control"]).toBe("private, no-store");
  });

  it("does not cache a public path that failed", () => {
    const headers = securityHeaders({
      ...httpsHtml,
      url: "https://e.mattrax.app/privacy",
      status: 404,
    });

    expect(headers["cache-control"]).toBe("private, no-store");
  });

  it("leaves JSON caching and CSP to the owning layer", () => {
    const headers = securityHeaders({
      url: "https://e.mattrax.app/api/health",
      contentType: "application/json",
    });

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    expect(headers["cross-origin-resource-policy"]).toBeUndefined();
    expect(headers["cache-control"]).toBeUndefined();
    expect(headers.vary).toBeUndefined();
  });

  it("advertises the build serving the response", () => {
    const headers = securityHeaders({ ...httpsHtml, buildId: "commit-abc123" });

    expect(headers["x-mattrax-build"]).toBe("commit-abc123");
  });
});

describe("normalisePath", () => {
  it('normalises "/api/v1/bootstrap"', () => {
    const pathname = "/api/v1/bootstrap";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/api/v1/bootstrap/"', () => {
    const pathname = "/api/v1/bootstrap/";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/api//v1//bootstrap"', () => {
    const pathname = "/api//v1//bootstrap";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "//api/v1/bootstrap"', () => {
    const pathname = "//api/v1/bootstrap";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/API/V1/BOOTSTRAP"', () => {
    const pathname = "/API/V1/BOOTSTRAP";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/api/v1/%62ootstrap"', () => {
    const pathname = "/api/v1/%62ootstrap";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/api%2Fv1%2Fbootstrap"', () => {
    const pathname = "/api%2Fv1%2Fbootstrap";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/api/v1/bootstrap%2F"', () => {
    const pathname = "/api/v1/bootstrap%2F";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/api/v1/bootstrap/;jsessionid=abc"', () => {
    const pathname = "/api/v1/bootstrap/;jsessionid=abc";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/%61pi/v1/bootstrap"', () => {
    const pathname = "/%61pi/v1/bootstrap";
    const expected = "/api/v1/bootstrap";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/"', () => {
    const pathname = "/";
    const expected = "/";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it('normalises "/docs/"', () => {
    const pathname = "/docs/";
    const expected = "/docs";

    expect(normalisePath(pathname)).toBe(expected);
  });

  it("leaves a malformed escape undecoded instead of throwing", () => {
    expect(normalisePath("/api/v1/%E0%A4%A")).toBe("/api/v1/%e0%a4%a");
  });

  it('recognises "/api/v1/bootstrap" as the bootstrap endpoint', () => {
    const pathname = "/api/v1/bootstrap";

    expect(isBootstrapPath(pathname)).toBe(true);
  });

  it('recognises "/api/v1/bootstrap/" as the bootstrap endpoint', () => {
    const pathname = "/api/v1/bootstrap/";

    expect(isBootstrapPath(pathname)).toBe(true);
  });

  it('recognises "/api//v1/bootstrap" as the bootstrap endpoint', () => {
    const pathname = "/api//v1/bootstrap";

    expect(isBootstrapPath(pathname)).toBe(true);
  });

  it('recognises "/api/v1/%62ootstrap" as the bootstrap endpoint', () => {
    const pathname = "/api/v1/%62ootstrap";

    expect(isBootstrapPath(pathname)).toBe(true);
  });

  it('recognises "/API/V1/BOOTSTRAP" as the bootstrap endpoint', () => {
    const pathname = "/API/V1/BOOTSTRAP";

    expect(isBootstrapPath(pathname)).toBe(true);
  });

  it('recognises "/api%2Fv1%2Fbootstrap" as the bootstrap endpoint', () => {
    const pathname = "/api%2Fv1%2Fbootstrap";

    expect(isBootstrapPath(pathname)).toBe(true);
  });

  it('does not treat "/api/v1/me" as the bootstrap endpoint', () => {
    const pathname = "/api/v1/me";

    expect(isBootstrapPath(pathname)).toBe(false);
  });

  it('does not treat "/api/v1/bootstrap/x" as the bootstrap endpoint', () => {
    const pathname = "/api/v1/bootstrap/x";

    expect(isBootstrapPath(pathname)).toBe(false);
  });

  it('does not treat "/apifoo/v1/bootstrap" as the bootstrap endpoint', () => {
    const pathname = "/apifoo/v1/bootstrap";

    expect(isBootstrapPath(pathname)).toBe(false);
  });

  it('does not treat "/bootstrap" as the bootstrap endpoint', () => {
    const pathname = "/bootstrap";

    expect(isBootstrapPath(pathname)).toBe(false);
  });

  it('recognises "/api/v1/me" as the profile update endpoint', () => {
    const pathname = "/api/v1/me";

    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it('recognises "/api/v1/me/" as the profile update endpoint', () => {
    const pathname = "/api/v1/me/";

    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it('recognises "/api//v1//me" as the profile update endpoint', () => {
    const pathname = "/api//v1//me";

    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it('recognises "/API/V1/ME" as the profile update endpoint', () => {
    const pathname = "/API/V1/ME";

    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it('recognises "/api/v1/%6de" as the profile update endpoint', () => {
    const pathname = "/api/v1/%6de";

    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it('recognises "/api%2Fv1%2Fme" as the profile update endpoint', () => {
    const pathname = "/api%2Fv1%2Fme";

    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it('recognises "/api/v1/me/;jsessionid=abc" as the profile update endpoint', () => {
    const pathname = "/api/v1/me/;jsessionid=abc";

    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it('does not treat "/api/v1/me/email" as the profile update endpoint', () => {
    const pathname = "/api/v1/me/email";

    expect(isProfileUpdatePath(pathname)).toBe(false);
  });

  it('does not treat "/api/v1/members" as the profile update endpoint', () => {
    const pathname = "/api/v1/members";

    expect(isProfileUpdatePath(pathname)).toBe(false);
  });

  it('does not treat "/apifoo/v1/me" as the profile update endpoint', () => {
    const pathname = "/apifoo/v1/me";

    expect(isProfileUpdatePath(pathname)).toBe(false);
  });

  it('does not treat "/me" as the profile update endpoint', () => {
    const pathname = "/me";

    expect(isProfileUpdatePath(pathname)).toBe(false);
  });
});

describe("mergeVary", () => {
  it("appends Cookie without duplicating existing values", () => {
    expect(mergeVary("Accept-Encoding", "Cookie")).toBe("Accept-Encoding, Cookie");
    expect(mergeVary("accept-encoding, cookie", "Cookie")).toBe("accept-encoding, cookie");
    expect(mergeVary(null, "Cookie")).toBe("Cookie");
  });
});

describe("withSecurityHeaders", () => {
  it("preserves the response status, body and existing Vary values", async () => {
    const request = new Request("https://e.mattrax.app/login");

    const response = withSecurityHeaders(
      request,
      new Response("hello", {
        status: 200,
        headers: { "content-type": "text/html", vary: "Accept-Encoding" },
      }),
    );

    expect(await response.text()).toBe("hello");
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Cookie");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});

describe("guardPath", () => {
  it('rejects "//evil.example/"', () => {
    const pathname = "//evil.example/";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/%2F%2Fevil.example/"', () => {
    const pathname = "/%2F%2Fevil.example/";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/.git/config"', () => {
    const pathname = "/.git/config";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/.env"', () => {
    const pathname = "/.env";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/.svn/entries"', () => {
    const pathname = "/.svn/entries";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/.DS_Store"', () => {
    const pathname = "/.DS_Store";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/%2eenv"', () => {
    const pathname = "/%2eenv";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/wp-admin"', () => {
    const pathname = "/wp-admin";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/wp-admin/setup.php"', () => {
    const pathname = "/wp-admin/setup.php";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/wp-login.php"', () => {
    const pathname = "/wp-login.php";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/xmlrpc.php"', () => {
    const pathname = "/xmlrpc.php";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/phpmyadmin"', () => {
    const pathname = "/phpmyadmin";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/phpmyadmin/index.php"', () => {
    const pathname = "/phpmyadmin/index.php";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/docs"', () => {
    const pathname = "/docs";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/docs/"', () => {
    const pathname = "/docs/";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/docs/missing-page"', () => {
    const pathname = "/docs/missing-page";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/docs/assets/app.js"', () => {
    const pathname = "/docs/assets/app.js";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('rejects "/%E0%A4%A"', () => {
    const pathname = "/%E0%A4%A";

    expect(guardPath(pathname)).toBe("not-found");
  });

  it('allows "/"', () => {
    const pathname = "/";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/dashboard"', () => {
    const pathname = "/dashboard";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/login"', () => {
    const pathname = "/login";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/t/acme/devices"', () => {
    const pathname = "/t/acme/devices";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/assets/brand/logo.png"', () => {
    const pathname = "/assets/brand/logo.png";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/favicon.ico"', () => {
    const pathname = "/favicon.ico";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/api/health"', () => {
    const pathname = "/api/health";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/api"', () => {
    const pathname = "/api";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/mdm/apple/scep"', () => {
    const pathname = "/mdm/apple/scep";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/scim/v2/Users"', () => {
    const pathname = "/scim/v2/Users";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/mcp"', () => {
    const pathname = "/mcp";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/cdn-cgi/trace"', () => {
    const pathname = "/cdn-cgi/trace";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/.well-known/oauth-authorization-server"', () => {
    const pathname = "/.well-known/oauth-authorization-server";

    expect(guardPath(pathname)).toBe("allow");
  });

  it('allows "/.well-known/oauth-protected-resource/mcp"', () => {
    const pathname = "/.well-known/oauth-protected-resource/mcp";

    expect(guardPath(pathname)).toBe("allow");
  });

  it("treats exact prefixes as owned by their layer", () => {
    expect(isPassthroughPath("/api")).toBe(true);
    expect(isPassthroughPath("/api/health")).toBe(true);
    expect(isPassthroughPath("/apifoo")).toBe(false);
  });
});

describe("page route matching", () => {
  const patterns = compilePagePatterns([
    "/(landing)",
    "/(landing)/*404",
    "/(dashboard)",
    "/(dashboard)/dashboard",
    "/(dashboard)/t/:tenantId",
    "/(dashboard)/t/:tenantId/devices/:deviceId",
    "/(dashboard)/t/:tenantId/settings/",
    "/enroll/:id",
    "/login",
    "/docs/*docs",
  ]);

  it("drops the catch-all 404 route from the known set", () => {
    expect(compilePagePattern("/(landing)/*404")).toBeUndefined();
  });

  it("matches static, parameter and grouped routes", () => {
    expect(isKnownPagePath("/", patterns)).toBe(true);
    expect(isKnownPagePath("/dashboard", patterns)).toBe(true);
    expect(isKnownPagePath("/dashboard/", patterns)).toBe(true);
    expect(isKnownPagePath("/t/acme", patterns)).toBe(true);
    expect(isKnownPagePath("/t/acme/devices/device-1", patterns)).toBe(true);
    expect(isKnownPagePath("/t/acme/settings", patterns)).toBe(true);
    expect(isKnownPagePath("/enroll/token-123", patterns)).toBe(true);
    expect(isKnownPagePath("/login", patterns)).toBe(true);
  });

  it("rejects unknown app paths", () => {
    expect(isKnownPagePath("/does-not-exist", patterns)).toBe(false);
    expect(isKnownPagePath("/t/acme/devices/device-1/extra", patterns)).toBe(false);
    expect(isKnownPagePath("/dashboard/extra", patterns)).toBe(false);
  });
});

describe("static asset header rules", () => {
  const source = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");

  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;

  for (const line of source.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed.startsWith("!")) {
      current?.set(`! ${trimmed.slice(1).trim().toLowerCase()}`, "");
      continue;
    }

    const separator = line.indexOf(":");

    if (current && separator !== -1)
      current.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  it("caches hashed build assets immutably", () => {
    expect(rules.get("/assets/*.js")?.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(rules.get("/assets/*.css")?.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(rules.get("/assets/*.woff2")?.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(rules.get("/assets/*.wasm")?.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(rules.get("/docs/static/*")?.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(rules.get("/docs/static/*")?.has("! cache-control")).toBe(true);
    expect(rules.get("/*")?.get("x-content-type-options")).toBe("nosniff");
    expect(rules.get("/*")?.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("revalidates docs HTML and applies its own CSP", () => {
    const docs = rules.get("/docs/*");

    expect(docs?.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(docs?.get("cdn-cache-control")).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    expect(docs?.get("content-security-policy")).toContain("'unsafe-inline'");
  });

  it("does not blanket-cache unhashed brand or catalog assets", () => {
    expect(rules.has("/assets/brand/*")).toBe(false);
    expect(rules.has("/assets/*")).toBe(false);
    expect(rules.has("/catalog/*")).toBe(false);
    expect(rules.get("/*.ico")?.get("cache-control")).toBe("public, max-age=86400");
  });
});

describe("redirect rules", () => {
  const source = readFileSync(new URL("../../public/_redirects", import.meta.url), "utf8");

  const rules = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));

  it("canonicalises the docs entry files", () => {
    expect(rules).toContainEqual(["/docs", "/docs/", "308"]);
    expect(rules).toContainEqual(["/docs/index.html", "/docs/", "308"]);
    expect(rules).toContainEqual(["/docs/404.html", "/docs/", "308"]);
  });

  it("canonicalises static .html spellings", () => {
    expect(rules).toContainEqual(["/index.html", "/", "308"]);
    expect(rules).toContainEqual(["/privacy.html", "/privacy", "308"]);
    expect(rules).toContainEqual(["/terms.html", "/terms", "308"]);
  });

  it("moves legacy dashboard paths", () => {
    for (const source of ["/app", "/app/*", "/instances", "/instances/*", "/admin"]) {
      expect(rules).toContainEqual([source, "/dashboard", "308"]);
    }
  });

  it("never redirects a Worker-owned prefix", () => {
    const owned = ["/api", "/mdm", "/scim", "/mcp", "/.well-known", "/assets"];

    for (const [source] of rules)
      expect(owned.some((prefix) => source === prefix || source.startsWith(`${prefix}/`))).toBe(
        false,
      );
  });
});

describe("canonicalHostUrl", () => {
  it("moves a www host to the apex and preserves the path", () => {
    expect(canonicalHostUrl(new URL("https://www.e.mattrax.app/privacy?x=1"))).toBe(
      "https://e.mattrax.app/privacy?x=1",
    );
  });

  it("leaves the canonical host alone", () => {
    expect(canonicalHostUrl(new URL("https://e.mattrax.app/"))).toBeUndefined();
  });
});
