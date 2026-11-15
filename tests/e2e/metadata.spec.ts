import { expect, test } from "@playwright/test";

const SITE_DESCRIPTION =
  "Enrollment, policy, inventory and remote actions for Apple, Windows and Android fleets, with a clean API, a real audit trail and a deployment model that fits how you work.";

type ArdEntry = {
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: object;
  representativeQueries: string[];
};

type ArdManifest = { entries: ArdEntry[] };

/** Validate the discovery-critical terms before the assertions narrow the payload. */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isArdEntry(value: unknown): value is ArdEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "identifier" in value &&
    isString(value.identifier) &&
    "displayName" in value &&
    isString(value.displayName) &&
    "type" in value &&
    isString(value.type) &&
    "representativeQueries" in value &&
    Array.isArray(value.representativeQueries) &&
    value.representativeQueries.every(isString)
  );
}

function isArdManifest(value: unknown): value is ArdManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries) &&
    value.entries.every(isArdEntry)
  );
}

function metaTags(html: string) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]!);
}

function metaContent(tags: string[], attribute: "name" | "property", key: string) {
  const tag = tags.find((candidate) => candidate.includes(`${attribute}="${key}"`));

  return tag && /content="([^"]*)"/.exec(tag)?.[1];
}

test.describe("social metadata", () => {
  test("serves Open Graph tags and a touch icon in the unauthenticated HTML", async ({
    request,
  }) => {
    const response = await request.get("/");

    expect(response.ok()).toBe(true);
    const html = await response.text();
    const tags = metaTags(html);

    expect(metaContent(tags, "name", "description")).toBe(SITE_DESCRIPTION);
    expect(metaContent(tags, "property", "og:title")).toBe("Mattrax");
    expect(metaContent(tags, "property", "og:description")).toBe(SITE_DESCRIPTION);
    expect(metaContent(tags, "property", "og:type")).toBe("website");
    expect(metaContent(tags, "property", "og:url")).toMatch(/^https?:\/\/.+\/$/);
    expect(metaContent(tags, "property", "og:image")).toContain("/assets/brand/og-image.jpg");
    expect(metaContent(tags, "name", "twitter:card")).toBe("summary_large_image");

    const canonical = /<link\b[^>]*rel="canonical"[^>]*>/i.exec(html);
    expect(canonical?.[0]).toMatch(/href="https?:\/\/[^"]+\/"/);

    const touchIcon = /<link\b[^>]*rel="apple-touch-icon"[^>]*>/i.exec(html);
    expect(touchIcon?.[0]).toContain("/assets/brand/apple-touch-icon.png");

    // The dashboard is client-rendered; static HTML must explain that.
    expect(html).toContain("<noscript>");
    expect(html).toContain("Mattrax needs JavaScript");
  });

  test("gives public pages exactly one main landmark", async ({ request }) => {
    for (const path of ["/", "/login", "/register", "/designer", "/terms", "/privacy"]) {
      const response = await request.get(path);

      expect(response.ok(), path).toBe(true);
      const html = await response.text();

      expect([...html.matchAll(/<main\b/g)], path).toHaveLength(1);
    }
  });

  test("serves a valid robots.txt", async ({ request }) => {
    const response = await request.get("/robots.txt");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/plain\b/);
    const body = await response.text();

    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toMatch(/^Disallow: \//m);
    expect(body).not.toContain("<html");
    expect(body).not.toContain("Cloudflare Managed");
  });

  test("serves an llms.txt with a heading and links", async ({ request }) => {
    const response = await request.get("/llms.txt");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/plain\b/);
    const body = await response.text();

    expect(body.length).toBeGreaterThan(50);
    expect(body).toMatch(/^\s*#\s+Mattrax/m);
    expect(body).toMatch(/\[[^\]]+\]\([^)]+\)/);
    expect(body).not.toContain("<html");
  });

  test("serves a valid security.txt", async ({ request }) => {
    const response = await request.get("/.well-known/security.txt");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/plain\b/);
    const body = await response.text();

    expect(body).not.toContain("<html");
    expect(body).toMatch(/^Contact: mailto:[^\s]+$/m);
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/m);
    expect(body).toMatch(/^Canonical: https:\/\/[^\s]+$/m);

    const expires = /^Expires: (.+)$/m.exec(body)?.[1];
    expect(expires).toBeTruthy();

    // RFC 9116 requires an expiry less than a year in the future.
    const remaining = Date.parse(expires!) - Date.now();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(366 * 24 * 60 * 60 * 1000);
  });

  test("serves a conformant ARD manifest as JSON", async ({ request }) => {
    const response = await request.get("/.well-known/ard.json");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^application\/json\b/);
    const body: unknown = await response.json();

    if (!isArdManifest(body)) throw new Error("ARD manifest did not match the expected shape");

    expect(body.entries.length).toBeGreaterThan(0);

    for (const entry of body.entries) {
      expect(entry.identifier).toMatch(/^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/);
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.type).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      // ARD requires exactly one of url or data.
      expect("url" in entry).toBe(!("data" in entry));
    }
  });
});
