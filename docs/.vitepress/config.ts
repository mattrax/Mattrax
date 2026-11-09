import { defineConfig } from "vitepress";

const origin = "https://mattrax.cloud";

export default defineConfig({
  title: "Mattrax",
  description: "Mobile device management solution",
  base: "/docs/",
  cleanUrls: true,
  head: [["style", {}, "html { scrollbar-gutter: stable; }"]],

  sitemap: {
    hostname: origin,
  },

  vite: {
    clearScreen: false,
    server: {
      port: 9060,
    },
  },

  themeConfig: {
    search: {
      provider: "local",
    },

    nav: [
      { text: "Overview", link: "/" },
      { text: "Quick start", link: "/quick-start" },
      { text: "Self-hosting", link: "/self-hosting" },
      { text: "Enterprise", link: "/enterprise/overview" },
      { text: "Whitelabel", link: "/whitelabel/" },
      { text: "Landing", link: `${origin}`, target: "_self" },
    ],

    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Overview", link: "/" },
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
          { text: "Self-hosted instances", link: "/enterprise/instances" },
          {
            text: "OpenAPI reference",
            link: `${origin}/api/docs`,
            target: "_self",
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
          { text: "Testing", link: "/testing" },
        ],
      },
    ],
  },
});
