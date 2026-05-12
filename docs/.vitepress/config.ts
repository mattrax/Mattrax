import { defineConfig } from 'vitepress'

const origin = 'https://mattrax.cloud';

export default defineConfig({
  title: 'Mattrax',
  description: 'Mobile device management solution',
  base: "/docs/",
  cleanUrls: true,
  head: [
    ['style', {}, 'html { scrollbar-gutter: stable; }']
  ],

  sitemap: {
    hostname: origin,
  },

  vite: {
    clearScreen: false,
    server: {
      port: 9060,
    }
  },

  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Landing', link: `${origin}`, target: "_self" }
    ],

    sidebar: [
      { text: 'Overview', link: '/' },
      { text: 'Pricing', link: '/pricing' },
      {
        text: 'Enterprise',
        items: [
          { text: 'Overview', link: '/enterprise/overview' },
          { text: 'Self-hosting', link: '/enterprise/self-hosting' },
          { text: 'OpenAPI', link: `${origin}/api/docs#tag/mattrax-enterprise-api`, target: "_self" }
        ]
      },
      {
        text: 'Whitelabel',
        items: [
          { text: 'Overview', link: '/whitelabel' },
          { text: 'Server Overview', link: '/whitelabel/server' },
          { text: 'Running Locally', link: '/whitelabel/running' },
          { text: 'HTTP Surface', link: '/whitelabel/endpoints' },
          { text: 'Management Webhooks', link: '/whitelabel/webhooks' },
          { text: 'Deployment', link: '/whitelabel/deployment' }
        ]
      },
    ]
  }
})
