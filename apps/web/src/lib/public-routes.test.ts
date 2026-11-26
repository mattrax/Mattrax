import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCS_PATH_PREFIX,
  SITE_ROUTES,
  docsRouteFromBuildFile,
  docsRouteFromSourceFile,
  docsRoutesFromBuildFiles,
  docsRoutesFromSourceFiles,
  isSitemapExcluded,
  requiresJavaScript,
  sitemapEntries,
} from "./public-routes";

const docsDirectory = fileURLToPath(new URL("../../../../docs/", import.meta.url));

const landingRoutesDirectory = fileURLToPath(new URL("../routes/(landing)/", import.meta.url));

/** Files below a directory, relative and forward-slashed. */
function listFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
}

const docsRoutes = docsRoutesFromSourceFiles(listFiles(docsDirectory));

/** The markdown file a clean documentation URL is served from. */
function sourceFileForRoute(route: string): string {
  const relative = route.slice(DOCS_PATH_PREFIX.length);

  if (relative === "") return "index.md";

  return relative.endsWith("/") ? `${relative}index.md` : `${relative}.md`;
}

describe("documentation routes", () => {
  it("maps markdown sources to clean URLs", () => {
    expect(docsRouteFromSourceFile("index.md")).toBe("/docs/");
    expect(docsRouteFromSourceFile("admin/index.md")).toBe("/docs/admin/");
    expect(docsRouteFromSourceFile("manage/devices.md")).toBe("/docs/manage/devices");
    expect(docsRouteFromSourceFile("reference/glossary.mdx")).toBe("/docs/reference/glossary");
    expect(docsRouteFromSourceFile("./getting-started/concepts.md")).toBe(
      "/docs/getting-started/concepts",
    );
  });

  it("ignores non-pages and rspress private files", () => {
    expect(docsRouteFromSourceFile("notes.txt")).toBeUndefined();
    expect(docsRouteFromSourceFile("_partials/example.md")).toBeUndefined();
    expect(docsRouteFromSourceFile("reference/_draft.md")).toBeUndefined();
  });

  it("matches the rspress build output to the same URLs", () => {
    expect(docsRouteFromBuildFile("index.html")).toBe("/docs/");
    expect(docsRouteFromBuildFile("admin/index.html")).toBe("/docs/admin/");
    expect(docsRouteFromBuildFile("admin/identity.html")).toBe("/docs/admin/identity");
    expect(docsRouteFromBuildFile("404.html")).toBeUndefined();
    expect(docsRouteFromBuildFile("static/index.js")).toBeUndefined();
  });

  it("derives the same route set from either source", () => {
    const pages = listFiles(docsDirectory).filter((file) => /\.mdx?$/i.test(file));
    const builtPages = pages.map((file) => file.replace(/\.mdx?$/i, ".html"));

    expect(docsRoutesFromBuildFiles(builtPages)).toEqual(docsRoutesFromSourceFiles(pages));
  });
});

describe("the real documentation tree", () => {
  it("lists every page exactly once", () => {
    expect(docsRoutes.length).toBeGreaterThan(40);
    expect(new Set(docsRoutes).size).toBe(docsRoutes.length);
    expect(docsRoutes.every((route) => route.startsWith(DOCS_PATH_PREFIX))).toBe(true);
  });

  it("maps every listed URL to a real markdown file", () => {
    const files = new Set(listFiles(docsDirectory));
    const pageFiles = [...files].filter((file) => /\.mdx?$/i.test(file));

    for (const route of docsRoutes) {
      const source = sourceFileForRoute(route);
      const exists = files.has(source) || files.has(source.replace(/\.md$/, ".mdx"));

      expect(exists, `${route} -> ${source}`).toBe(true);
    }

    // And the reverse: a new markdown page cannot be omitted from the sitemap.
    expect(docsRoutes).toHaveLength(pageFiles.length);
  });
});

describe("sitemap entries", () => {
  const entries = sitemapEntries(docsRoutes);
  const paths = entries.map((entry) => entry.path);

  it("starts with the site pages and then the docs", () => {
    expect(paths.slice(0, SITE_ROUTES.length)).toEqual(SITE_ROUTES.map((route) => route.path));
    expect(paths).toContain("/");
    expect(paths).toContain("/privacy");
    expect(paths).toContain("/terms");
    expect(paths).toContain("/docs/");
    expect(paths).toContain("/docs/getting-started/quick-start");
  });

  it("is unique and free of authentication and API routes", () => {
    expect(new Set(paths).size).toBe(paths.length);

    for (const path of paths) {
      expect(isSitemapExcluded(path), path).toBe(false);
      expect(path).not.toMatch(/^\/(dashboard|account|t\/|api\/|mdm\/|scim\/|mcp|sso)/);
    }
  });

  it("treats the bare /t landing route as dashboard, not public", () => {
    expect(isSitemapExcluded("/t")).toBe(true);
    expect(requiresJavaScript("/t")).toBe(true);
    expect(() => sitemapEntries(["/t"])).toThrow(/non-public/);
  });

  it("refuses to publish an excluded path", () => {
    expect(() => sitemapEntries(["/dashboard"])).toThrow(/non-public/);
    expect(() => sitemapEntries(["/t/acme/devices"])).toThrow(/non-public/);
    expect(() => sitemapEntries(["/api/v1/health"])).toThrow(/non-public/);
    expect(() => sitemapEntries(["/private"])).toThrow(/must live under \/docs\//);
    expect(() => sitemapEntries(["/docs/", "/docs/"])).toThrow(/Duplicate/);
  });
});

describe("site pages", () => {
  it("exist as routes in the landing router", () => {
    const files = new Set(listFiles(landingRoutesDirectory));

    expect(files.has("index.tsx")).toBe(true);
    expect(files.has("privacy.tsx")).toBe(true);
    expect(files.has("terms.tsx")).toBe(true);
  });
});

describe("requiresJavaScript", () => {
  it("is true only for the client-rendered application", () => {
    for (const path of [
      "/dashboard",
      "/account",
      "/t",
      "/t/acme/devices",
      "/tenants/new",
      "/login",
      "/register",
      "/verify-email",
      "/accept-invitation",
      "/reset-password",
      "/sso/complete",
      "/enroll/abc",
      "/designer",
    ])
      expect(requiresJavaScript(path), path).toBe(true);

    for (const path of ["/", "/privacy", "/terms", "/docs/", "/docs/api/", "/missing-page"])
      expect(requiresJavaScript(path), path).toBe(false);
  });
});
