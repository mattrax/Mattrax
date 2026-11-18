/**
 * The public route surface.
 *
 * Everything a crawler is told about — the sitemap, `robots.txt`, the
 * BreadcrumbList and the no-JavaScript shell — is derived from this module so
 * the rules cannot disagree with each other.
 */

export const DOCS_PATH_PREFIX = "/docs/";

/**
 * Public, signed-out HTML surfaces whose shell contains no per-user state.
 *
 * These pages render without a session preload, so their HTML is safe to keep
 * in the shared CDN cache. The client loads the session after hydration when
 * the visitor is signed in. Dashboard, auth and tenant routes must never be
 * added here.
 */
export const CACHEABLE_PUBLIC_PATHS = ["/", "/privacy", "/terms"] as const;

/** True when a pathname may be served from a shared CDN cache. */
export function isCacheablePublicPage(pathname: string): boolean {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  return CACHEABLE_PUBLIC_PATHS.some((path) => path === normalised);
}

export type SitemapChangefreq = "daily" | "weekly" | "monthly" | "yearly";

export type SitemapEntry = {
  readonly path: string;
  readonly changefreq: SitemapChangefreq;
  readonly priority: string;
};

/**
 * Pages outside `/docs/` worth advertising. Pricing lives in the landing page
 * (`/#pricing`), so the landing page itself is the crawlable URL.
 */
export const SITE_ROUTES: readonly SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
];

const DOCS_ENTRY = { changefreq: "monthly", priority: "0.5" } as const;

/**
 * Paths that must never appear in the sitemap: the authenticated dashboard,
 * tenant-scoped routes, machine endpoints and authentication flows.
 */
export const SITEMAP_EXCLUDED_PREFIXES = [
  "/dashboard",
  "/account",
  "/t/",
  "/tenants",
  "/api/",
  "/mdm/",
  "/scim/",
  "/mcp",
  "/sso",
  "/accept-invitation",
  "/accept-ownership",
  "/reset-password",
  "/verify-email",
  "/login",
  "/register",
  "/enroll/",
  "/designer",
] as const;

/**
 * Routes whose content only exists after hydration. The server-rendered shell
 * for these paths is replaced by the `<noscript>` notice in `Document.tsx`.
 * The landing page, legal pages, 404 page and docs are readable without
 * JavaScript and are deliberately absent.
 */
export const JAVASCRIPT_REQUIRED_PREFIXES = [
  "/dashboard",
  "/account",
  "/t/",
  "/tenants",
  "/login",
  "/register",
  "/verify-email",
  "/accept-invitation",
  "/accept-ownership",
  "/reset-password",
  "/sso",
  "/enroll/",
  "/designer",
] as const;

const matchesPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);

/**
 * Paths robots.txt must not crawl. It includes every sitemap exclusion plus
 * bearer-token surfaces (an enrollment link is a credential in the URL).
 */
export const ROBOTS_DISALLOW_PREFIXES = [...SITEMAP_EXCLUDED_PREFIXES, "/enroll/"] as const;

/** True when a path belongs to the authenticated app or a machine endpoint. */
export function isSitemapExcluded(path: string): boolean {
  return SITEMAP_EXCLUDED_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

/** True when the page cannot render useful content without client JavaScript. */
export function requiresJavaScript(pathname: string): boolean {
  return JAVASCRIPT_REQUIRED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

/**
 * Assert a pathname may be published. Called while building the sitemap, so a
 * route added in the wrong place fails the build instead of leaking into
 * `sitemap.xml`.
 */
function assertSitemapPath(path: string): void {
  if (!path.startsWith("/")) throw new Error(`Sitemap path must be absolute: ${path}`);

  if (isSitemapExcluded(path))
    throw new Error(`Refusing to publish a non-public path in the sitemap: ${path}`);
}

/**
 * Map a markdown source path (`manage/devices.md`, `admin/index.md`) to the
 * clean URL rspress serves. Rspress runs with `cleanUrls`, so pages keep the
 * extensionless URL and index pages keep their trailing slash.
 */
export function docsRouteFromSourceFile(file: string): string | undefined {
  const normalised = normaliseRelative(file);

  if (!/\.mdx?$/i.test(normalised)) return undefined;

  const withoutExtension = normalised.replace(/\.mdx?$/i, "");

  if (isPrivateDocPath(withoutExtension)) return undefined;

  return docsRoute(withoutExtension.replace(/(^|\/)index$/, "$1"));
}

/** Map a built rspress page (`admin/index.html`, `admin/identity.html`). */
export function docsRouteFromBuildFile(file: string): string | undefined {
  const normalised = normaliseRelative(file);

  if (!/\.html$/i.test(normalised)) return undefined;

  const withoutExtension = normalised.replace(/\.html$/i, "");

  // Rspress writes the not-found page next to the real pages; it is not a URL
  // we want a crawler to index.
  if (withoutExtension === "404") return undefined;

  if (isPrivateDocPath(withoutExtension)) return undefined;

  return docsRoute(withoutExtension.replace(/(^|\/)index$/, "$1"));
}

/** Derive routes from rspress source files. */
export function docsRoutesFromSourceFiles(files: readonly string[]): string[] {
  return sortedUnique(flatMapRoutes(files, docsRouteFromSourceFile));
}

/** Derive routes from the rspress `doc_build` output. */
export function docsRoutesFromBuildFiles(files: readonly string[]): string[] {
  return sortedUnique(flatMapRoutes(files, docsRouteFromBuildFile));
}

/**
 * The complete, ordered sitemap: site pages first, then every documentation
 * page. Throws if a documentation route is not under `/docs/` or if any entry
 * is on an excluded path.
 */
export function sitemapEntries(docsRoutes: readonly string[]): SitemapEntry[] {
  const entries: SitemapEntry[] = [...SITE_ROUTES];

  for (const path of docsRoutes) {
    assertSitemapPath(path);

    if (!path.startsWith(DOCS_PATH_PREFIX))
      throw new Error(`Documentation route must live under ${DOCS_PATH_PREFIX}: ${path}`);

    entries.push({ path, ...DOCS_ENTRY });
  }

  const paths = new Set<string>();

  for (const entry of entries) {
    assertSitemapPath(entry.path);

    if (paths.has(entry.path)) throw new Error(`Duplicate sitemap path: ${entry.path}`);

    paths.add(entry.path);
  }

  return entries;
}

/** Map files with a possibly-empty route in one pass. */
function flatMapRoutes(
  files: readonly string[],
  routeForFile: (file: string) => string | undefined,
): string[] {
  const routes: string[] = [];

  for (const file of files) {
    const route = routeForFile(file);

    if (route !== undefined) routes.push(route);
  }

  return routes;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function normaliseRelative(file: string): string {
  return file
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
}

/** Rspress treats a leading `_` on any segment as a private file or directory. */
function isPrivateDocPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("_"));
}

function docsRoute(relative: string): string {
  // Index pages keep the slash that is left behind when `index` is removed.
  return `${DOCS_PATH_PREFIX}${relative.replace(/^\/+/, "")}`;
}
