import { ROBOTS_DISALLOW_PREFIXES, sitemapEntries } from "../lib/public-routes";

/**
 * `robots.txt` and `sitemap.xml`, generated per request.
 *
 * Both files need an absolute origin and the origin belongs to the deployment,
 * not to the build: the hosted site, a preview and a self-hosted install all
 * serve the same bundle from different hosts. Deriving the origin from the
 * request keeps every host advertising itself.
 */

export const SITEMAP_PATH = "/sitemap.xml";

export const ROBOTS_PATH = "/robots.txt";

/** Crawlers re-fetch rarely; an hour keeps a deploy visible without per-request XML. */
const CACHE_CONTROL = "public, max-age=3600";

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const absoluteUrl = (path: string, origin: string): string => {
  try {
    return new URL(path, origin).href;
  } catch {
    throw new Error(`Sitemap origin must be an absolute URL: ${origin}`);
  }
};

/**
 * A sitemap covering the landing page, the legal pages and every documentation
 * page. `docsRoutes` comes from the rspress route list, so a new doc page is
 * listed without editing this module.
 */
export function renderSitemap(origin: string, docsRoutes: readonly string[]): string {
  const urls = sitemapEntries(docsRoutes).map(
    (entry) =>
      `  <url>\n    <loc>${escapeXml(absoluteUrl(entry.path, origin))}</loc>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`,
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * The crawler policy. The disallow list is derived from the sitemap exclusion
 * set (plus bearer-token enrollment links), so the two cannot drift; the
 * sitemap line points at the same origin the visitor used.
 */
export function renderRobots(origin: string): string {
  return [
    "# Mattrax crawlers",
    "User-agent: *",
    "Allow: /",
    "",
    "# Authenticated application, machine endpoints and bearer links are not public content.",
    ...ROBOTS_DISALLOW_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    "",
    "# Generated from the request origin so self-hosted deployments stay correct.",
    `Sitemap: ${absoluteUrl(SITEMAP_PATH, origin)}`,
    "",
  ].join("\n");
}

export type SeoHandler = (request: Request) => Response | undefined;

/**
 * Answer `/robots.txt` and `/sitemap.xml`, or return `undefined` so the SSR
 * router handles the request. The Worker entry runs this before rendering; the
 * asset layer sends only these two paths here (`assets.runWorkerFirst`).
 */
export function createSeoHandler(docsRoutes: readonly string[]): SeoHandler {
  return (request) => {
    const url = new URL(request.url);

    if (url.pathname !== SITEMAP_PATH && url.pathname !== ROBOTS_PATH) return undefined;

    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          allow: "GET, HEAD",
          "content-type": "text/plain; charset=utf-8",
        },
      });

    const isSitemap = url.pathname === SITEMAP_PATH;
    const body = isSitemap ? renderSitemap(url.origin, docsRoutes) : renderRobots(url.origin);

    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type": isSitemap ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8",
        // Lighthouse fetches these while rendering; an explicit length lets
        // the Node host finish the response without chunked framing.
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "cache-control": CACHE_CONTROL,
      },
    });
  };
}
