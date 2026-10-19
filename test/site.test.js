// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import siteConfig from '../src/config/site.json' with { type: 'json' };
import {
  resolveBase,
  resolveCustomDomain,
  resolveSiteName,
  resolveSiteUrl,
  resolveSlug,
  resolveWatermark,
} from '../src/config/site.js';
import { mountAdSlot, renderAdSlot } from '../src/ads.js';
import { ensureConsent } from '../src/consent.js';
import { buildShareCard, shareCardFilename } from '../src/shareCard.js';

/** Deep copy of the shipped config with overrides applied by `edit`. */
function configWith(edit = (c) => c) {
  const copy = structuredClone(siteConfig);
  edit(copy);
  return copy;
}

const adsenseConfig = (consentEnabled = false) =>
  configWith((c) => {
    c.ads.provider = 'adsense';
    c.ads.adsense.publisherId = 'ca-pub-1234567890123456';
    c.ads.adsense.slots.belowOutput = '9876543210';
    c.consent.enabled = consentEnabled;
  });

describe('ad slot', () => {
  it('renders nothing and injects no script with the shipped config', async () => {
    expect(siteConfig.ads.provider).toBe('none');
    expect(renderAdSlot(siteConfig, 'belowOutput')).toBeNull();
    const container = document.createElement('aside');
    const inject = vi.fn();
    const consent = vi.fn(async () => ({ adsAllowed: true }));
    expect(await mountAdSlot(siteConfig, 'belowOutput', container, { inject, consent })).toEqual({
      mounted: false,
      scriptInjected: false,
    });
    expect(container.childNodes).toHaveLength(0);
    expect(inject).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('renders nothing for unknown providers or placeholder IDs', () => {
    expect(renderAdSlot(configWith((c) => (c.ads.provider = 'mystery')), 'belowOutput')).toBeNull();
    expect(renderAdSlot(configWith((c) => (c.ads.provider = 'adsense')), 'belowOutput')).toBeNull();
    expect(renderAdSlot(adsenseConfig(), 'noSuchSlot')).toBeNull();
  });

  it('renders ins.adsbygoogle for AdSense but injects no script when consent is denied', async () => {
    const config = adsenseConfig();
    const el = renderAdSlot(config, 'belowOutput');
    expect(el?.tagName).toBe('INS');
    expect(el?.className).toBe('adsbygoogle');
    expect(el?.getAttribute('data-ad-client')).toBe('ca-pub-1234567890123456');
    expect(el?.getAttribute('data-ad-slot')).toBe('9876543210');

    const container = document.createElement('aside');
    const inject = vi.fn();
    const result = await mountAdSlot(config, 'belowOutput', container, { inject });
    expect(result).toEqual({ mounted: true, scriptInjected: false });
    expect(container.querySelector('ins.adsbygoogle')).not.toBeNull();
    expect(inject).not.toHaveBeenCalled();
  });

  it('loads the script only after the consent hook allows it', async () => {
    const config = adsenseConfig(true);
    const order = [];
    const consent = vi.fn(async () => {
      order.push('consent');
      return { adsAllowed: true };
    });
    const inject = vi.fn(() => order.push('inject'));
    const container = document.createElement('aside');
    expect(await mountAdSlot(config, 'belowOutput', container, { inject, consent })).toEqual({
      mounted: true,
      scriptInjected: true,
    });
    expect(order).toEqual(['consent', 'inject']);
    expect(inject).toHaveBeenCalledWith(
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456',
    );
  });

  it('mounts at most one ad unit and injects the script at most once', async () => {
    const config = adsenseConfig(true);
    const container = document.createElement('aside');
    document.body.append(container);
    const consent = vi.fn(async () => ({ adsAllowed: true }));
    const inject = vi.fn();
    const first = await mountAdSlot(config, 'belowOutput', container, { inject, consent });
    const second = await mountAdSlot(config, 'belowOutput', container, { inject, consent });
    expect(first).toEqual({ mounted: true, scriptInjected: true });
    expect(second).toEqual({ mounted: true, scriptInjected: false, reused: true });
    expect(container.querySelectorAll('ins.adsbygoogle')).toHaveLength(1);
    expect(inject).toHaveBeenCalledTimes(1);

    // With the loader already on the page, a fresh slot pushes but does not re-inject.
    const script = document.createElement('script');
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456';
    script.type = 'text/plain';
    document.head.append(script);
    const other = document.createElement('aside');
    expect(await mountAdSlot(config, 'belowOutput', other, { inject, consent })).toEqual({
      mounted: true,
      scriptInjected: false,
    });
    expect(inject).toHaveBeenCalledTimes(1);
    script.remove();
    container.remove();
  });

  it('keeps ads off in the consent stub', async () => {
    expect(await ensureConsent(siteConfig)).toEqual({ adsAllowed: false });
    expect(await ensureConsent(adsenseConfig(true))).toEqual({ adsAllowed: false });
  });

  it('places the slot container after the output and its actions', () => {
    // Strip <link>/<script> so the parser does not try to load them.
    const html = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8').replace(
      /<link\b[^>]*>|<script\b[^>]*><\/script>/g,
      '',
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const slot = doc.querySelector('[data-testid="ad-slot"]');
    const input = doc.querySelector('[data-testid="input"]');
    expect(slot).not.toBeNull();
    for (const id of ['input', 'output', 'copy', 'download']) {
      const el = doc.querySelector(`[data-testid="${id}"]`);
      expect(el?.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING, `${id} precedes slot`).toBeTruthy();
    }
    expect(slot?.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeFalsy();
  });
});

describe('share card', () => {
  const content = { from: 'millennial', to: 'genz', input: 'that was lit lol', output: 'that was valid 💀' };

  it('shows the before/after text, labels, and the configured watermark', () => {
    const card = buildShareCard({ ...content, config: configWith((c) => (c.site.watermarkText = 'genconv.example')) });
    expect(card.querySelector('[data-testid="share-card-watermark"]')?.textContent).toBe('genconv.example');
    expect(card.textContent).toContain('Millennial');
    expect(card.textContent).toContain('Gen Z');
    expect(card.textContent).toContain('that was lit lol');
    expect(card.textContent).toContain('that was valid 💀');
    expect(card.querySelector('.share-card__title')?.textContent).toBe('Rizzetta Stone');
  });

  it('follows the config: watermark text, URL host fallback, and site name', () => {
    const watermark = (config) =>
      buildShareCard({ ...content, config }).querySelector('[data-testid="share-card-watermark"]')?.textContent;
    expect(watermark(siteConfig)).toBe('rizzettastone.app');
    const noMark = (/** @type {(c: any) => void} */ edit) =>
      configWith((c) => {
        c.site.watermarkText = '';
        edit(c);
      });
    expect(watermark(noMark((c) => (c.site.url = 'https://slang.example/app/')))).toBe('slang.example');
    expect(watermark(noMark((c) => ((c.site.url = ''), (c.site.domain = 'genconv.fun'))))).toBe('genconv.fun');
    expect(watermark(noMark((c) => ((c.site.url = ''), (c.site.domain = ''))))).toBe('co0pdawg.github.io');
    const renamed = buildShareCard({ ...content, config: configWith((c) => (c.site.name = 'Slang Swap')) });
    expect(renamed.querySelector('.share-card__title')?.textContent).toBe('Slang Swap');
  });
});

describe('site config', () => {
  it('ships the Rizzetta Stone name, the .app domain, and the custom domain off', () => {
    expect(siteConfig.site.name).toBe('Rizzetta Stone');
    expect(siteConfig.site.tagline).toBe("Fluent in 💀, 😂, and 'Love, Mom.'");
    expect(siteConfig.site.repo).toBe('RizzettaStone');
    expect(resolveSiteUrl(siteConfig)).toBe('https://rizzettastone.app/');
    expect(resolveWatermark(siteConfig)).toBe('rizzettastone.app');
    expect(siteConfig.deploy.customDomainEnabled).toBe(false);
    expect(siteConfig.deploy.customDomain).toBe('rizzettastone.app');
    expect(resolveBase(siteConfig, {})).toBe('/RizzettaStone/');
    expect(shareCardFilename('millennial', 'genz', siteConfig)).toBe('rizzetta-stone-millennial-to-genz.png');
    expect(resolveSlug(configWith((c) => (c.site.name = 'Slang Swap!')))).toBe('slang-swap');
  });

  it('turns the custom domain on only by flag or CUSTOM_DOMAIN=1', () => {
    const enabled = configWith((c) => (c.deploy.customDomainEnabled = true));
    expect(resolveCustomDomain(siteConfig, {})).toBe('');
    expect(resolveCustomDomain(siteConfig, { CUSTOM_DOMAIN: '1' })).toBe('rizzettastone.app');
    expect(resolveCustomDomain(enabled, {})).toBe('rizzettastone.app');
    expect(resolveCustomDomain(configWith((c) => ((c.deploy.customDomainEnabled = true), (c.deploy.customDomain = ''))), {})).toBe('');
    expect(resolveBase(siteConfig, { CUSTOM_DOMAIN: '1' })).toBe('/');
    expect(resolveBase(enabled, {})).toBe('/');
    expect(resolveBase(enabled, { BASE_PATH: '/x' })).toBe('/x/');
  });

  it('carries the parody disclaimer in the footer and the privacy page', () => {
    const sentence = 'Parody. Not affiliated with or endorsed by Rosetta Stone.';
    for (const file of ['index.html', 'privacy.html']) {
      const html = readFileSync(path.join(process.cwd(), file), 'utf8').replace(/<link\b[^>]*>|<script\b[^>]*><\/script>/g, '');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      expect(doc.querySelector('[data-testid="parody-disclaimer"]')?.textContent, file).toBe(sentence);
    }
    const index = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    expect(/<footer[\s\S]*Parody\. Not affiliated with or endorsed by Rosetta Stone\.[\s\S]*<\/footer>/.test(index)).toBe(true);
  });

  it('derives the base path with the documented precedence', () => {
    const repo = siteConfig.site.repo;
    expect(resolveBase(siteConfig, {})).toBe(`/${repo}/`);
    expect(resolveBase(configWith((c) => (c.site.repo = 'SlangSwap')), {})).toBe('/SlangSwap/');
    expect(resolveBase(configWith((c) => (c.deploy.base = 'custom-path')), {})).toBe('/custom-path/');
    expect(resolveBase(configWith((c) => (c.deploy.customDomain = 'genconv.fun')), {})).toBe(`/${repo}/`);
    expect(resolveBase(siteConfig, { BASE_PATH: '/' })).toBe('/');
    expect(resolveBase(configWith((c) => (c.site.repo = '')), {})).toBe('/');
  });

  it('derives the site URL and name from the repo', () => {
    const bare = (/** @type {(c: any) => void} */ edit) =>
      configWith((c) => {
        c.site.url = '';
        c.site.domain = '';
        c.site.watermarkText = '';
        edit(c);
      });
    expect(resolveSiteUrl(bare((c) => (c.site.repo = 'SlangSwap')))).toBe('https://co0pdawg.github.io/SlangSwap/');
    expect(resolveWatermark(bare((c) => (c.site.repo = 'SlangSwap')))).toBe('co0pdawg.github.io');
    expect(resolveSiteUrl(configWith((c) => (c.site.url = '')))).toBe('https://rizzettastone.app/');
    expect(resolveSiteName(configWith((c) => (c.site.name = '')))).toBe('Rizzetta Stone');
  });
});
