// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
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
