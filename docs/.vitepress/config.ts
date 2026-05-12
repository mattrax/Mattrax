import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Mattrax',
  description: 'Mobile device management solution',
  base: "/docs/",

  vite: {
    clearScreen: false
  },

  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Home', link: '/' }
    ],

    sidebar: [
      { text: 'Overview', link: '/' },
      { text: 'Pricing', link: '/pricing' },
      {
        text: 'Whitelabel',
        items: [
          { text: 'Whitelabel', link: '/whitelabel' }
        ]
      }
    ]
  }
})
