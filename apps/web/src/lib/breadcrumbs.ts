/**
 * Build the dashboard breadcrumb trail from the URL.
 *
 * The trail is intentionally derived rather than hand-maintained: every page
 * renders `PageHeader`, so adding a route should not require remembering to
 * add a crumb. Rules:
 *
 * - Only tenant routes get a trail; account and marketing pages do not.
 * - Settings pages start at `Settings` (the tenant is already the page frame),
 *   every other tenant page starts at `Tenant`.
 * - Known route segments use the dashboard's label. An opaque trailing id is
 *   replaced with the loaded resource name, then suppressed when the page's
 *   own `<h1>` already says the same thing.
 * - A page with no ancestor (a section landing page) shows nothing.
 */
export type BreadcrumbTrailItem = { label: string; href: string };

const ROUTE_LABELS = new Map<string, string>([
  ["devices", "Devices"],
  ["groups", "Groups"],
  ["policies", "Policies"],
  ["assignments", "Assignments"],
  ["design", "Design"],
  ["editor", "Editor"],
  ["applications", "Applications"],
  ["dashboards", "Dashboards"],
  ["software", "Software"],
  ["enrollment", "Enrollment"],
  ["settings", "Settings"],
  ["identity", "Identity"],
  ["domains", "Domains"],
  ["directory", "Directory"],
  ["management", "Management"],
  ["integration", "Integrations"],
  ["integrations", "Integrations"],
  ["delivery", "Delivery"],
  ["audit", "Audit log"],
  ["billing", "Billing"],
  ["administrators", "Members"],
]);

const normalise = (value: string) => value.trim().toLocaleLowerCase();

export function buildBreadcrumbs(input: {
  pathname: string;
  title?: string;
}): BreadcrumbTrailItem[] {
  const pathname = input.pathname.split(/[?#]/, 1)[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "t" || !segments[1]) return [];

  const tenantBase = `/${segments[0]}/${segments[1]}`;
  const content = segments.slice(2);

  if (content.length < 2) return [];

  const settingsRoute = content[0] === "settings";

  const crumbs: BreadcrumbTrailItem[] = settingsRoute
    ? []
    : [{ label: "Tenant", href: tenantBase }];

  let href = tenantBase;

  for (const [index, segment] of content.entries()) {
    href += `/${segment}`;
    const label = ROUTE_LABELS.get(segment);

    if (label) {
      crumbs.push({ label, href });
      continue;
    }

    // An opaque id in the middle of the path is the object the next segment
    // belongs to (for example `/policies/:id/assignments`); the loaded page
    // title names the leaf, so the id itself adds no information.
    if (index < content.length - 1) continue;

    crumbs.push({ label: input.title?.trim() || "Details", href });
  }

  if (crumbs.length < 2) return [];

  // The page's own heading is the leaf. Showing the same text twice was the
  // reason the legacy breadcrumb attempt was abandoned.
  const leaf = crumbs.at(-1);

  if (leaf && input.title && normalise(leaf.label) === normalise(input.title)) crumbs.pop();

  return crumbs.length >= 2 ? crumbs : [];
}
