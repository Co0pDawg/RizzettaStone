import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { resolveBase, resolveCustomDomain, resolveSiteName, resolveSiteUrl } from './src/config/site.js';

/** @type {import('./src/config/site.js').SiteConfig} */
const siteConfig = JSON.parse(readFileSync(new URL('./src/config/site.json', import.meta.url), 'utf8'));

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Fill `{{SITE_NAME}}`, `{{SITE_TAGLINE}}`, and `{{SITE_URL}}` in the HTML
 * pages from site.json, so titles, meta tags, the header, and canonical URLs
 * follow the config.
 * @returns {import('vite').Plugin}
 */
function siteHtmlPlugin() {
  const values = {
    '{{SITE_NAME}}': escapeHtml(resolveSiteName(siteConfig)),
    '{{SITE_TAGLINE}}': escapeHtml(siteConfig.site?.tagline?.trim() ?? ''),
    '{{SITE_URL}}': escapeHtml(resolveSiteUrl(siteConfig)),
  };
  return {
    name: 'rizzetta-stone:site-html',
    transformIndexHtml: (html) =>
      Object.entries(values).reduce((out, [key, value]) => out.replaceAll(key, value), html),
  };
}

/**
 * Emit `dist/CNAME` when the custom domain is enabled (GitHub Pages reads it).
 * @returns {import('vite').Plugin}
 */
function cnamePlugin() {
  const domain = resolveCustomDomain(siteConfig, process.env);
  return {
    name: 'rizzetta-stone:cname',
    apply: 'build',
    generateBundle() {
      if (domain) this.emitFile({ type: 'asset', fileName: 'CNAME', source: domain });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // Dev (`npm start`) always serves at /. Builds and `vite preview` use the
  // deploy base: BASE_PATH env > custom domain enabled (/) > deploy.base > /<site.repo>/.
  base: command === 'build' || isPreview ? resolveBase(siteConfig, process.env) : '/',
  plugins: [siteHtmlPlugin(), cnamePlugin()],
  build: {
    rollupOptions: {
      // privacy.html is a page (not a public/ file) so it gets the same config values.
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        privacy: new URL('./privacy.html', import.meta.url).pathname,
      },
    },
  },
}));
