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

  it.each(["/", "/privacy", "/terms"])(
    "lets the shared cache keep the signed-out shell for %s",
    (pathname) => {
      const headers = securityHeaders({
        ...httpsHtml,
        url: `https://e.mattrax.app${pathname}`,
      });

      expect(headers["cache-control"]).toBe(
        "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
      );
      expect(headers["cdn-cache-control"]).toBe(
        "public, max-age=300, stale-while-revalidate=86400",
      );
      expect(headers.vary).toBe("Accept-Encoding");
    },
  );

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
});

describe("normalisePath", () => {
  it.each([
    ["/api/v1/bootstrap", "/api/v1/bootstrap"],
    ["/api/v1/bootstrap/", "/api/v1/bootstrap"],
    ["/api//v1//bootstrap", "/api/v1/bootstrap"],
    ["//api/v1/bootstrap", "/api/v1/bootstrap"],
    ["/API/V1/BOOTSTRAP", "/api/v1/bootstrap"],
    ["/api/v1/%62ootstrap", "/api/v1/bootstrap"],
    ["/api%2Fv1%2Fbootstrap", "/api/v1/bootstrap"],
    ["/api/v1/bootstrap%2F", "/api/v1/bootstrap"],
    ["/api/v1/bootstrap/;jsessionid=abc", "/api/v1/bootstrap"],
    ["/%61pi/v1/bootstrap", "/api/v1/bootstrap"],
    ["/", "/"],
    ["/docs/", "/docs"],
  ])("normalises %s", (pathname, expected) => {
    expect(normalisePath(pathname)).toBe(expected);
  });

  it("leaves a malformed escape undecoded instead of throwing", () => {
    expect(normalisePath("/api/v1/%E0%A4%A")).toBe("/api/v1/%e0%a4%a");
  });

  it.each([
    "/api/v1/bootstrap",
    "/api/v1/bootstrap/",
    "/api//v1/bootstrap",
    "/api/v1/%62ootstrap",
    "/API/V1/BOOTSTRAP",
    "/api%2Fv1%2Fbootstrap",
  ])("recognises %s as the bootstrap endpoint", (pathname) => {
    expect(isBootstrapPath(pathname)).toBe(true);
  });

  it.each(["/api/v1/me", "/api/v1/bootstrap/x", "/apifoo/v1/bootstrap", "/bootstrap"])(
    "does not treat %s as the bootstrap endpoint",
    (pathname) => {
      expect(isBootstrapPath(pathname)).toBe(false);
    },
  );

  it.each([
    "/api/v1/me",
    "/api/v1/me/",
    "/api//v1//me",
    "/API/V1/ME",
    "/api/v1/%6de",
    "/api%2Fv1%2Fme",
    "/api/v1/me/;jsessionid=abc",
  ])("recognises %s as the profile update endpoint", (pathname) => {
    expect(isProfileUpdatePath(pathname)).toBe(true);
  });

  it.each(["/api/v1/me/email", "/api/v1/members", "/apifoo/v1/me", "/me"])(
    "does not treat %s as the profile update endpoint",
    (pathname) => {
      expect(isProfileUpdatePath(pathname)).toBe(false);
    },
  );
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
  it.each([
    "//evil.example/",
    "/%2F%2Fevil.example/",
    "/.git/config",
    "/.env",
    "/.svn/entries",
    "/.DS_Store",
    "/%2eenv",
    "/wp-admin",
    "/wp-admin/setup.php",
    "/wp-login.php",
    "/xmlrpc.php",
    "/phpmyadmin",
    "/phpmyadmin/index.php",
    "/docs",
    "/docs/",
    "/docs/missing-page",
    "/docs/assets/app.js",
    "/%E0%A4%A",
  ])("rejects %s", (pathname) => {
    expect(guardPath(pathname)).toBe("not-found");
  });

  it.each([
    "/",
    "/dashboard",
    "/login",
    "/t/acme/devices",
    "/assets/brand/logo.png",
    "/favicon.ico",
    "/api/health",
    "/api",
    "/mdm/apple/scep",
    "/scim/v2/Users",
    "/mcp",
    "/cdn-cgi/trace",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource/mcp",
  ])("allows %s", (pathname) => {
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
