// Dynamic robots.txt — derives the Sitemap URL from `Astro.site` so
// there's only one place to change the production domain (astro.config.mjs).
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  if (!site) {
    throw new Error(
      'Astro `site` is not set. Define `site` in astro.config.mjs so robots.txt can advertise the sitemap absolutely.',
    );
  }
  const sitemap = new URL('/sitemap-index.xml', site).href;
  const body = [
    '# Allow all well-behaved crawlers to index the public pages.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
