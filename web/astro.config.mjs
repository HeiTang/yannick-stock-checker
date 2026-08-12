// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { DEV_API_PROXY_TARGET, SITE_URL } from './src/config.ts';

// https://astro.build/config
export default defineConfig({
  // Public site URL — drives sitemap.xml, canonical URLs, and the
  // og:url / og:image absolute paths in the page heads.
  site: SITE_URL,

  integrations: [
    sitemap({
      // The homepage contains the complete query experience. Keep the lean
      // utility route usable without asking search engines to index a duplicate.
      filter: (page) => page !== new URL('/query/', SITE_URL).href,
    }),
  ],

  vite: {
    server: {
      proxy: {
        '/api': {
          target: DEV_API_PROXY_TARGET,
          changeOrigin: true,
        },
      },
    },
  },
});
