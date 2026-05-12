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
    clearScreen: false
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
        text: 'Whitelabel',
        items: [
          { text: 'Whitelabel', link: '/whitelabel' }
        ]
      },
      { text: 'OpenAPI', link: `${origin}/api/docs`, target: "_self" }
    ]
  }
})
