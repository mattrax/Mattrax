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
  description: "Open device management infrastructure for Apple, Windows and Android fleets.",
  lang: "en",
  logo: {
    light: "/logo.png",
    dark: "/logo.png",
    width: 36,
    height: 36,
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
        '<p>Mattrax — open device management infrastructure. <a href="https://mattrax.app">mattrax.app</a> · <a href="/docs/llms.txt">llms.txt</a></p>',
    },
    nav: [
      { text: "Overview", link: "/overview" },
      { text: "Quick start", link: "/quick-start" },
      { text: "Self-hosting", link: "/self-hosting" },
      {
        text: "Enterprise",
        items: [
          { text: "Overview", link: "/enterprise/overview" },
          { text: "API and OpenAPI", link: "/enterprise/api" },
          { text: "Outbound webhooks", link: "/enterprise/webhooks" },
          { text: "Self-hosted instances", link: "/enterprise/instances" },
          {
            text: "OpenAPI reference",
            link: `${origin}/api/docs`,
          },
        ],
      },
      {
        text: "Whitelabel",
        items: [
          { text: "Overview", link: "/whitelabel/" },
          { text: "Server overview", link: "/whitelabel/server" },
          { text: "Running locally", link: "/whitelabel/running" },
          { text: "HTTP surface", link: "/whitelabel/endpoints" },
          { text: "Management webhooks", link: "/whitelabel/webhooks" },
          { text: "Deployment", link: "/whitelabel/deployment" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Architecture and porting", link: "/porting-plan" },
          { text: "Policy catalogue", link: "/policy-catalogue" },
          { text: "Production readiness", link: "/production-readiness" },
          { text: "Testing", link: "/testing" },
        ],
      },
      { text: "mattrax.app", link: origin },
    ],
    sidebar: {
      "/": [
        {
          text: "Getting started",
          items: [
            { text: "Overview", link: "/overview" },
            { text: "Quick start", link: "/quick-start" },
            { text: "Pricing", link: "/pricing" },
          ],
        },
        {
          text: "Deployment",
          items: [{ text: "Self-hosting", link: "/self-hosting" }],
        },
        {
          text: "Enterprise",
          items: [
            { text: "Overview", link: "/enterprise/overview" },
            { text: "API and OpenAPI", link: "/enterprise/api" },
            { text: "Outbound webhooks", link: "/enterprise/webhooks" },
            { text: "Self-hosted instances", link: "/enterprise/instances" },
          ],
        },
        {
          text: "Whitelabel",
          items: [
            { text: "Overview", link: "/whitelabel/" },
            { text: "Server overview", link: "/whitelabel/server" },
            { text: "Running locally", link: "/whitelabel/running" },
            { text: "HTTP surface", link: "/whitelabel/endpoints" },
            { text: "Management webhooks", link: "/whitelabel/webhooks" },
            { text: "Deployment", link: "/whitelabel/deployment" },
          ],
        },
        {
          text: "Project",
          items: [
            { text: "Architecture and porting", link: "/porting-plan" },
            { text: "Policy catalogue", link: "/policy-catalogue" },
            { text: "Production readiness", link: "/production-readiness" },
            { text: "Testing", link: "/testing" },
          ],
        },
      ],
    },
  },
});
