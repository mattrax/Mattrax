import { describe, expect, it } from "vitest";
import { clearsSsrShell, ssrShellClearCookies, withClearedSsrShell } from "./sessionShell.js";

const request = (path: string, method = "POST") =>
  new Request(`https://app.test${path}`, { method });

describe("SSR shell invalidation paths", () => {
  it("clears the shell after a session revoke, sign-out or credential change", () => {
    expect(clearsSsrShell(request("/api/v1/signOut"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/account/sessions/session-1", "DELETE"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/account/passkeys/credential-1", "DELETE"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/account/email-change/verify"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/disableTotp"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/confirmTotpEnrollment"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/me", "DELETE"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/me", "PATCH"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/ME/", "PATCH"))).toBe(true);
  });

  it("normalises case and a trailing slash the way the router does", () => {
    expect(clearsSsrShell(request("/api/v1/SIGNOUT"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/signOut/"))).toBe(true);
    expect(clearsSsrShell(request("/api/v1/account/sessions/abc/", "DELETE"))).toBe(true);
  });

  it("leaves harmless requests alone", () => {
    for (const [path, method] of [
      ["/api/v1/signOut", "GET"],
      ["/api/v1/me", "GET"],
      ["/api/v1/me", "POST"],
      ["/api/v1/me/extra", "PATCH"],
      ["/api/v1/bootstrap", "GET"],
      ["/api/v1/account/sessions", "GET"],
      ["/api/v1/account/sessions", "DELETE"],
      ["/api/v1/account/email-change", "POST"],
      ["/api/v1/account/email-change/verify", "GET"],
      ["/api/v1/tenants/acme/devices", "DELETE"],
      // Prefix and suffix decoys must not match the exact routes.
      ["/api/v1/account/sessions/abc/extra", "DELETE"],
      ["/api/v1/signOutx", "POST"],
    ] as const) {
      expect(clearsSsrShell(request(path, method)), `${method} ${path}`).toBe(false);
    }
  });
});

describe("SSR shell clearing response", () => {
  const setCookies = (response: Response) => response.headers.getSetCookie();

  it("expires both shell cookies on a successful response", () => {
    const response = withClearedSsrShell(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const cookies = setCookies(response);

    expect(response.status).toBe(200);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-mattrax_ssr=;");
    expect(cookies[1]).toContain("__Host-mattrax_ssr_rev=;");

    for (const cookie of cookies) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Path=/");
    }
  });

  it("preserves existing cookies and body", async () => {
    const original = new Response("deleted", {
      status: 200,
      headers: { "set-cookie": "__Host-mattrax_session=; Max-Age=0; Path=/" },
    });

    const response = withClearedSsrShell(original);

    expect(await response.text()).toBe("deleted");
    expect(setCookies(response)).toHaveLength(3);
  });

  it("does not clear the shell when the action failed", () => {
    const response = withClearedSsrShell(
      new Response(JSON.stringify({ error: "step_up_required" }), { status: 403 }),
    );

    expect(setCookies(response)).toHaveLength(0);
    expect(ssrShellClearCookies()).toHaveLength(2);
  });
});
