import { describe, expect, it } from "vitest";
import { isSitemapExcluded } from "../lib/public-routes";
import {
  SITE_DESCRIPTION,
  SITE_SAME_AS,
  SITE_TITLE,
  organizationStructuredData,
} from "../lib/site";
import { SITEMAP_PATH, createSeoHandler, renderRobots, renderSitemap } from "./seo";

const origin = "https://e.mattrax.app";

const docsRoutes = ["/docs/", "/docs/api/", "/docs/getting-started/quick-start"];

const locs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);

describe("sitemap.xml", () => {
  const xml = renderSitemap(origin, docsRoutes);

  it("is a well-formed urlset with absolute URLs", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml.endsWith("</urlset>\n")).toBe(true);
    expect(xml).not.toContain("<script");

    const urls = locs(xml);

    expect(urls.length).toBe(3 + docsRoutes.length);

    for (const url of urls) {
      const parsed = new URL(url);

      expect(parsed.origin).toBe(origin);
      expect(isSitemapExcluded(parsed.pathname), url).toBe(false);
    }
  });

  it("lists the landing page, legal pages and every documentation page", () => {
    const urls = locs(xml);

    expect(urls).toContain(`${origin}/`);
    expect(urls).toContain(`${origin}/privacy`);
    expect(urls).toContain(`${origin}/terms`);
    expect(urls).toContain(`${origin}/docs/`);
    expect(urls).toContain(`${origin}/docs/getting-started/quick-start`);

    for (const path of ["/dashboard", "/t/acme", "/api/v1/health"])
      expect(urls.join("\n")).not.toContain(path);
  });

  it("follows the deployment origin instead of a hard-coded host", () => {
    const selfHosted = locs(renderSitemap("https://mdm.example.test", docsRoutes));

    expect(selfHosted).toContain("https://mdm.example.test/docs/");
    expect(selfHosted.join("\n")).not.toContain("mattrax.app");
  });

  it("rejects origins that are not absolute URLs", () => {
    expect(() => renderSitemap("/relative", docsRoutes)).toThrow(/absolute URL/);
  });
});

describe("robots.txt", () => {
  const body = renderRobots(origin);

  it("allows crawling, hides the application and points at the sitemap", () => {
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Disallow: /dashboard");
    expect(body).toContain("Disallow: /t/");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain(`Sitemap: ${origin}${SITEMAP_PATH}`);
  });

  it("uses the origin of the deployment it is served from", () => {
    expect(renderRobots("http://localhost:9050")).toContain(
      "Sitemap: http://localhost:9050/sitemap.xml",
    );
  });
});

describe("createSeoHandler", () => {
  const handler = createSeoHandler(docsRoutes);

  const request = (path: string, init?: RequestInit) => new Request(new URL(path, origin), init);

  it("serves both files with cacheable, explicit content types", async () => {
    const sitemap = handler(request("/sitemap.xml"))!;

    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(sitemap.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await sitemap.text()).toContain(`<loc>${origin}/docs/</loc>`);

    const robots = handler(request("/robots.txt"))!;

    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
  });

  it("answers HEAD without a body and rejects other methods", () => {
    expect(handler(request("/sitemap.xml", { method: "HEAD" }))?.body).toBeNull();

    const rejected = handler(request("/sitemap.xml", { method: "POST" }))!;

    expect(rejected.status).toBe(405);
    expect(rejected.headers.get("allow")).toBe("GET, HEAD");
  });

  it("leaves every other path to the router", () => {
    expect(handler(request("/"))).toBeUndefined();
    expect(handler(request("/docs/"))).toBeUndefined();
    expect(handler(request("/robots.txt.bak"))).toBeUndefined();
  });
});

describe("Organization structured data", () => {
  it("reuses the site constants and the serving origin", () => {
    const data = organizationStructuredData(origin);

    expect(data["@type"]).toBe("Organization");
    expect(data.name).toBe(SITE_TITLE);
    expect(data.description).toBe(SITE_DESCRIPTION);
    expect(data.url).toBe(`${origin}/`);
    expect(data.logo.url.startsWith(`${origin}/`)).toBe(true);
    expect(data.sameAs).toEqual([...SITE_SAME_AS]);
    expect(data.sameAs).toContain("https://github.com/oscartbeaumont/mattraxe");
  });
});
