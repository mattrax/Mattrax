import { describe, expect, it } from "vitest";
import { SESSION_PRESENCE_COOKIE, withSessionPresence } from "./sessionPresence.js";

const responseWithCookies = (cookies: ReadonlyArray<string>) => {
  const headers = new Headers({ "content-type": "application/json" });

  for (const cookie of cookies) headers.append("set-cookie", cookie);

  return new Response("{}", { headers });
};

const setCookies = (response: Response) => response.headers.getSetCookie();

describe("session presence cookie", () => {
  it("mirrors an issued session cookie without making it HttpOnly", () => {
    const response = withSessionPresence(
      responseWithCookies([
        "__Host-mattrax_session=abc123; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
        "other=value; Path=/",
      ]),
      { sessionCookieName: "__Host-mattrax_session", secure: true },
    );

    const cookies = setCookies(response);
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toContain("__Host-mattrax_session=abc123");
    expect(cookies[1]).toBe("other=value; Path=/");
    const presence = cookies[2];
    expect(presence).toContain(`${SESSION_PRESENCE_COOKIE}=v1.`);
    expect(presence).toContain("Path=/");
    expect(presence).toContain("SameSite=Lax");
    expect(presence).toContain("Secure");
    expect(presence).not.toContain("HttpOnly");
    const expiresAt = Number(/v1\.(\d+)/.exec(presence)?.[1]);
    expect(expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    expect(expiresAt).toBeLessThan(Date.now() + 3_700_000);
  });

  it("clears the shadow when the session cookie is cleared", () => {
    const response = withSessionPresence(
      responseWithCookies(["__Host-mattrax_session=; Path=/; Max-Age=0; HttpOnly"]),
      { sessionCookieName: "__Host-mattrax_session", secure: false },
    );

    const presence = setCookies(response).at(-1)!;
    expect(presence).toContain(`${SESSION_PRESENCE_COOKIE}=;`);
    expect(presence).toContain("Max-Age=0");
    expect(presence).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(presence).not.toContain("Secure");
  });

  it("leaves responses that do not touch the session alone", () => {
    const original = responseWithCookies(["theme=dark; Path=/"]);

    const response = withSessionPresence(original, {
      sessionCookieName: "__Host-mattrax_session",
      secure: true,
    });

    expect(response).toBe(original);
  });

  it("uses the auth library's session lifetime when Max-Age is absent", () => {
    const response = withSessionPresence(
      responseWithCookies(["__Host-mattrax_session=abc; Path=/; HttpOnly"]),
      { sessionCookieName: "__Host-mattrax_session", secure: true },
    );

    const presence = setCookies(response).at(-1)!;
    const expiresAt = Number(/v1\.(\d+)/.exec(presence)?.[1]);
    expect(expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });
});
