import path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginLlms } from "@rspress/plugin-llms";

const origin = "https://mattrax.cloud";

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
    outline: true,
    editLink: {
      docRepoBaseUrl: "https://github.com/oscartbeaumont/mattraxe/tree/main/docs",
      text: "Edit this page on GitHub",
    },
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/oscartbeaumont/mattraxe",
      },
    ],
    footer: {
      message:
        '<p>Mattrax — device management infrastructure. <a href="https://mattrax.app">mattrax.app</a> · <a href="/docs/llms.txt">llms.txt</a> · <a href="/docs/api/">API</a></p>',
    },
    nav: [
      { text: "Docs", link: "/" },
      {
        text: "Get started",
        items: [
          { text: "What is Mattrax?", link: "/getting-started/" },
          { text: "Quick start", link: "/getting-started/quick-start" },
          { text: "Core concepts", link: "/getting-started/concepts" },
        ],
      },
      {
        text: "Platforms",
        items: [
          { text: "Apple", link: "/platforms/apple/" },
          { text: "Apple Business Manager", link: "/platforms/apple/abm" },
          { text: "Apps & Books", link: "/platforms/apple/vpp" },
          { text: "Windows", link: "/platforms/windows/" },
          { text: "Entra ID", link: "/platforms/windows/entra-id" },
          { text: "Autopilot", link: "/platforms/windows/autopilot" },
          { text: "Android", link: "/platforms/android/" },
        ],
      },
      {
        text: "Manage",
        items: [
          { text: "Devices", link: "/manage/devices" },
          { text: "Groups", link: "/manage/groups" },
          { text: "Policies", link: "/manage/policies" },
          { text: "Applications", link: "/manage/applications" },
          { text: "Security", link: "/manage/security" },
        ],
      },
      {
        text: "Operate",
        items: [
          { text: "Configuration", link: "/operations/configuration" },
          { text: "Monitoring", link: "/operations/monitoring" },
          { text: "Troubleshooting", link: "/operations/troubleshooting" },
        ],
      },
      {
        text: "Build",
        items: [
          { text: "REST API", link: "/api/" },
          { text: "API reference", link: "/api/reference" },
          { text: "OpenAPI", link: "/api/openapi" },
        ],
      },
      {
        text: "Migrate",
        items: [
          { text: "Migration guide", link: "/migration/" },
          { text: "From Jamf", link: "/migration/jamf" },
          { text: "From Intune", link: "/migration/intune" },
          { text: "From Kandji, Mosyle or Addigy", link: "/migration/other-mdms" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Architecture", link: "/reference/architecture" },
          { text: "Production readiness", link: "/reference/production-readiness" },
          { text: "Policy catalogue", link: "/reference/policy-catalogue" },
          { text: "Glossary", link: "/reference/glossary" },
        ],
      },
      { text: "mattrax.app", link: origin },
    ],
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
            { text: "Reference", link: "/api/reference" },
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
            { text: "Production readiness", link: "/reference/production-readiness" },
            { text: "Policy catalogue", link: "/reference/policy-catalogue" },
            { text: "Glossary", link: "/reference/glossary" },
          ],
        },
      ],
    },
  },
});
