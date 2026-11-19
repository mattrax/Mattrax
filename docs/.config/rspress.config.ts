import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rspress/core";
import { pluginLlms } from "@rspress/plugin-llms";

/**
 * The docs are served by the same Worker as the app, so canonical URLs and the
 * generated `sitemap.xml` must use that deployment's origin. `SITE_ORIGIN`
 * lets a staging, preview or self-hosted docs build claim its own host instead
 * of inheriting the cloud one.
 */
const origin = process.env.SITE_ORIGIN ?? "https://e.mattrax.app";

/**
 * Paths are anchored to this file rather than the working directory so the
 * config can live beside the content: `root` stays `docs/` (the markdown is
 * not nested), the custom theme stays `docs/theme`, and the build output stays
 * in the repository-root `doc_build/` consumed by the web Worker.
 */
const docsRoot = fileURLToPath(new URL("..", import.meta.url));

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: docsRoot,
  outDir: path.join(repoRoot, "doc_build"),
  themeDir: fileURLToPath(new URL("./theme", import.meta.url)),
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
  globalStyles: fileURLToPath(new URL("../styles/global.css", import.meta.url)),
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
      docRepoBaseUrl: "https://github.com/mattrax/Mattrax/tree/main/docs",
    },
    footer: {
      message:
        '<p>Mattrax — device management infrastructure. <a href="https://mattrax.app">mattrax.app</a> · <a href="/docs/llms.txt">llms.txt</a> · <a href="/docs/api/">API</a></p>',
    },
    // A couple of quiet shortcuts; the sidebar carries the full tree.
    nav: [
      { text: "Get started", link: "/getting-started/" },
      { text: "API", link: "/api/" },
    ],
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/mattrax/Mattrax",
      },
    ],
    sidebar: {
      "/": [
        {
          text: "Getting started",
          collapsible: true,
          collapsed: false,
          items: [
            { text: "What is Mattrax?", link: "/getting-started/" },
            { text: "Quick start", link: "/getting-started/quick-start" },
            { text: "Core concepts", link: "/getting-started/concepts" },
          ],
        },
        {
          text: "Apple",
          collapsible: true,
          collapsed: false,
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
          collapsed: false,
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
          collapsed: false,
          items: [
            { text: "Setup and enrollment", link: "/platforms/android/" },
            { text: "Policies", link: "/platforms/android/policies" },
          ],
        },
        {
          text: "Manage",
          collapsible: true,
          collapsed: false,
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
          collapsed: false,
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
          collapsed: false,
          items: [
            { text: "Configuration", link: "/operations/configuration" },
            { text: "Deployment", link: "/operations/deployment" },
            { text: "Monitoring", link: "/operations/monitoring" },
            { text: "Troubleshooting", link: "/operations/troubleshooting" },
          ],
        },
        {
          text: "API",
          collapsible: true,
          collapsed: false,
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
          collapsed: false,
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
          collapsed: false,
          items: [
            { text: "Architecture", link: "/reference/architecture" },
            { text: "Accounts and users", link: "/reference/identity-model" },
            { text: "User-scoped policies", link: "/reference/user-scoped-policies" },
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
