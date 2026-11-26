import { usePage, usePages, useSite } from "@rspress/core/runtime";

/**
 * `BreadcrumbList` structured data for documentation pages.
 *
 * The crumbs follow the page's route (`/platforms/apple/ddm`), and each
 * ancestor's label comes from the rspress page index rather than the sidebar,
 * so the trail is real navigation a crawler can follow. The origin is the
 * deployment's `siteOrigin`, the same constant used for canonical URLs.
 */
export function DocsBreadcrumbJsonLd() {
  const { page } = usePage();
  const { site } = useSite();
  const { pages } = usePages();

  // Layout renders for home, custom and 404 pages too; only documentation
  // pages have a breadcrumb trail.
  if (page.pageType !== "doc" && page.pageType !== "doc-wide") return null;

  const origin = site.siteOrigin.replace(/\/+$/, "");
  const docsRoot = `${origin}${site.base.replace(/\/+$/, "")}/`;
  const titles = new Map(pages.map((candidate) => [candidate.routePath, candidate.title]));

  const crumbs = [
    { name: "Home", item: `${origin}/` },
    { name: "Docs", item: docsRoot },
  ];

  const segments = page.routePath.split("/").filter(Boolean);

  for (let index = 1; index <= segments.length; index++) {
    const isCurrentPage = index === segments.length;

    // Ancestors are index pages, so they keep the trailing slash. The current
    // page keeps whatever route rspress built (`cleanUrls` removes `.html`).
    const route = isCurrentPage ? page.routePath : `/${segments.slice(0, index).join("/")}/`;

    const name = isCurrentPage ? page.title : titles.get(route);

    // A route segment without a page (for example the `platforms` grouping) is
    // not a URL, so it is not a crumb.
    if (!name) continue;

    crumbs.push({ name, item: `${docsRoot.replace(/\/$/, "")}${route}` });
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.item,
    })),
  };

  return (
    <script
      type="application/ld+json"
      // `<` is escaped so a title can never close the script element.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replaceAll("<", String.raw`\u003c`),
      }}
    />
  );
}
