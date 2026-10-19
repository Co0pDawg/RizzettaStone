/**
 * Pure helpers that turn `src/config/site.json` into derived values. No JSON
 * import here, so both the browser bundle and vite.config.js can use them.
 *
 * Everything name-related flows from `site.repo` (and `site.owner`), so a
 * rename is a one-field edit.
 */

/**
 * @typedef {{
 *   site: {
 *     name: string, tagline?: string, repo: string, owner: string,
 *     domain?: string, url: string, watermarkText: string,
 *   },
 *   deploy: { base: string, customDomainEnabled?: boolean, customDomain: string },
 *   ads: { provider: string, adsense: { publisherId: string, slots: Record<string, string> } },
 *   consent: { enabled: boolean, cmp: string },
 * }} SiteConfig
 */

/**
 * Ensure a base path starts and ends with "/".
 * @param {string} base
 * @returns {string}
 */
function normalizeBase(base) {
  let out = base.trim();
  if (!out.startsWith('/')) out = `/${out}`;
  if (!out.endsWith('/')) out = `${out}/`;
  return out;
}

/**
 * The custom domain the build serves from, or "" when it is off. Off by
 * default: it needs `deploy.customDomainEnabled: true` (or env
 * `CUSTOM_DOMAIN=1`) plus a non-empty `deploy.customDomain`.
 * @param {SiteConfig} config
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveCustomDomain(config, env = {}) {
  const enabled = config.deploy?.customDomainEnabled === true || env.CUSTOM_DOMAIN === '1';
  return enabled ? (config.deploy?.customDomain ?? '').trim() : '';
}

/**
 * Public base path for a production build. Precedence, first match wins:
 * 1. env `BASE_PATH`;
 * 2. custom domain enabled (see resolveCustomDomain) → `/` (it serves from the root);
 * 3. `deploy.base`;
 * 4. `/<site.repo>/` (the GitHub project-site path);
 * 5. `/`.
 * @param {SiteConfig} config
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveBase(config, env = {}) {
  if (env.BASE_PATH && env.BASE_PATH.trim()) return normalizeBase(env.BASE_PATH);
  if (resolveCustomDomain(config, env)) return '/';
  if (config.deploy?.base?.trim()) return normalizeBase(config.deploy.base);
  if (config.site?.repo?.trim()) return normalizeBase(config.site.repo);
  return '/';
}

/**
 * Public (canonical) site URL: `site.url`, else `https://<site.domain>/`, else
 * the GitHub Pages project URL `https://<owner>.github.io/<repo>/`.
 * @param {SiteConfig} config
 * @returns {string}
 */
export function resolveSiteUrl(config) {
  const { site = /** @type {any} */ ({}) } = config;
  if (site.url?.trim()) return site.url.trim();
  if (site.domain?.trim()) return `https://${site.domain.trim()}/`;
  const owner = (site.owner ?? '').trim().toLowerCase();
  const repo = (site.repo ?? '').trim();
  if (owner && repo) return `https://${owner}.github.io/${repo}/`;
  return '';
}

/**
 * Share-card watermark: `site.watermarkText`, else the host of the site URL.
 * @param {SiteConfig} config
 * @returns {string}
 */
export function resolveWatermark(config) {
  const text = config.site?.watermarkText?.trim();
  if (text) return text;
  const url = resolveSiteUrl(config);
  try {
    return url ? new URL(url).host : '';
  } catch {
    return url;
  }
}

/**
 * Display name, defaulting to "Rizzetta Stone".
 * @param {SiteConfig} config
 * @returns {string}
 */
export function resolveSiteName(config) {
  return config.site?.name?.trim() || 'Rizzetta Stone';
}

/**
 * File-name slug of the display name: "Rizzetta Stone" → "rizzetta-stone".
 * @param {SiteConfig} config
 * @returns {string}
 */
export function resolveSlug(config) {
  return (
    resolveSiteName(config)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'share-card'
  );
}
