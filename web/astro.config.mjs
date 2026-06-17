// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Public site URL — drives sitemap.xml, canonical URLs, and the
  // og:url / og:image absolute paths in the page heads.
  site: 'https://yannick.purr.tw',

  integrations: [sitemap()],

  vite: {
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8088',
          changeOrigin: true,
        },
      },
    },
  },
});
