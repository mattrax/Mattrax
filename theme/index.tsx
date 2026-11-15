// Docs live under `/docs/`, which Rspress prepends to `logoHref` when it builds
// the nav link. The wordmark belongs to the product rather than the docs, so
// the nav title is overridden with one plain anchor to the site root; every
// other component still comes from the default theme.
//
// `Layout` is wrapped rather than replaced: the wrapper adds the per-page
// `BreadcrumbList` JSON-LD before delegating to the default theme.

export * from "@rspress/core/theme-original";

export { NavTitle } from "./components/NavTitle";

export { Layout } from "./components/Layout";
