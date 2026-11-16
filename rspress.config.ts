import path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginLlms } from "@rspress/plugin-llms";

/**
 * The docs are served by the same Worker as the app, so canonical URLs and the
 * generated `sitemap.xml` must use that deployment's origin. `SITE_ORIGIN`
 * lets a staging, preview or self-hosted docs build claim its own host instead
 * of inheriting the cloud one.
 */
const origin = process.env.SITE_ORIGIN ?? "https://e.mattrax.app";

export default defineConfig({
  root: "docs",
  outDir: "doc_build",
  base: "/docs/",
  siteOrigin: origin,
  title: "Mattrax",
  description:
    "Documentation for Mattrax device management — Apple, Windows and Android fleets, the REST API and migration.",
  lang: "en",
  logo: {
    light: "/mattrax.png",
    dark: "/mattrax-white.png",
    width: 104,
    height: 16,
  },
  // Rspress prefixes root-relative hrefs with the docs base, so the wordmark
  // link is rendered by the custom `theme/components/NavTitle` component. It
  // points at the product home in the same tab; the docs no longer need a
  // separate external "Mattrax" nav item.
  logoHref: "/",
  icon: "/favicon.ico",
  globalStyles: path.resolve("docs/styles/global.css"),
  llms: false,
  plugins: [pluginLlms()],
  route: {
    cleanUrls: true,
    cleanUrlsRedirect: true,
  },
  search: {
    codeBlocks: true,
  },
  themeConfig: {
    search: true,
    lastUpdated: true,
    enableContentAnimation: true,
    enableScrollToTop: true,
    editLink: {
      docRepoBaseUrl: "https://github.com/oscartbeaumont/mattraxe/tree/main/docs",
    },
    footer: {
      message:
        '<p>Mattrax — device management infrastructure. <a href="https://mattrax.app">mattrax.app</a> · <a href="/docs/llms.txt">llms.txt</a> · <a href="/docs/api/">API</a></p>',
    },
    nav: [],
    sidebar: {
      "/": [
        {
          text: "Getting started",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "What is Mattrax?", link: "/getting-started/" },
            { text: "Quick start", link: "/getting-started/quick-start" },
            { text: "Core concepts", link: "/getting-started/concepts" },
          ],
        },
        {
          text: "Apple",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Overview", link: "/platforms/apple/" },
            { text: "Apple Business Manager", link: "/platforms/apple/abm" },
            { text: "Apps & Books", link: "/platforms/apple/vpp" },
            { text: "DDM and profiles", link: "/platforms/apple/ddm" },
            { text: "Security and inventory", link: "/platforms/apple/security" },
          ],
        },
        {
          text: "Windows",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Overview", link: "/platforms/windows/" },
            { text: "Entra ID", link: "/platforms/windows/entra-id" },
            { text: "Autopilot", link: "/platforms/windows/autopilot" },
            { text: "Policies", link: "/platforms/windows/policies" },
          ],
        },
        {
          text: "Android",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Setup and enrollment", link: "/platforms/android/" },
            { text: "Policies", link: "/platforms/android/policies" },
          ],
        },
        {
          text: "Manage",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Devices", link: "/manage/devices" },
            { text: "Groups", link: "/manage/groups" },
            { text: "Policies", link: "/manage/policies" },
            { text: "Applications", link: "/manage/applications" },
            { text: "Scripts", link: "/manage/scripts" },
            { text: "AI agents and MCP", link: "/manage/mcp" },
            { text: "Security", link: "/manage/security" },
          ],
        },
        {
          text: "Administration",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Overview", link: "/admin/" },
            { text: "Identity and access", link: "/admin/identity" },
            { text: "Roles and permissions", link: "/admin/rbac" },
            { text: "Audit, webhooks and billing", link: "/admin/operations" },
          ],
        },
        {
          text: "Operations",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Configuration", link: "/operations/configuration" },
            { text: "Monitoring", link: "/operations/monitoring" },
            { text: "Troubleshooting", link: "/operations/troubleshooting" },
          ],
        },
        {
          text: "API",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "REST API", link: "/api/" },
            { text: "CLI", link: "/api/cli" },
            { text: "Reference", link: "/api/reference/" },
            { text: "OpenAPI", link: "/api/openapi" },
          ],
        },
        {
          text: "Migration",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Overview", link: "/migration/" },
            { text: "From Jamf", link: "/migration/jamf" },
            { text: "From Intune", link: "/migration/intune" },
            { text: "From Kandji, Mosyle or Addigy", link: "/migration/other-mdms" },
          ],
        },
        {
          text: "Reference",
          collapsible: true,
          collapsed: true,
          items: [
            { text: "Architecture", link: "/reference/architecture" },
            { text: "Performance and a11y budgets", link: "/reference/performance" },
            { text: "Threat model", link: "/reference/threat-model" },
            { text: "Production readiness", link: "/reference/production-readiness" },
            { text: "Policy catalogue", link: "/reference/policy-catalogue" },
            { text: "Catalogue sources", link: "/reference/catalogue-sources" },
            { text: "Project history", link: "/reference/history" },
            { text: "Glossary", link: "/reference/glossary" },
          ],
        },
      ],
    },
  },
});
