import { toPng } from 'html-to-image';
import { DICTIONARIES } from './engine/dictionaries.js';
import { resolveSiteName, resolveSlug, resolveWatermark } from './config/site.js';

/**
 * @typedef {{
 *   from: string,
 *   to: string,
 *   input: string,
 *   output: string,
 *   config: import('./config/site.js').SiteConfig,
 * }} CardContent
 */

/**
 * Build the before/after share card DOM node. Pure apart from creating
 * nodes: no network and no globals besides the document. It uses classes and
 * system fonts only, so the PNG export never needs a fetch.
 * @param {CardContent} content
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function buildShareCard({ from, to, input, output, config }, doc = globalThis.document) {
  const card = doc.createElement('div');
  card.className = 'share-card';
  card.setAttribute('data-testid', 'share-card');

  const title = doc.createElement('div');
  title.className = 'share-card__title';
  title.textContent = resolveSiteName(config);
  card.append(title);

  for (const [gen, text, variant] of [
    [from, input, 'before'],
    [to, output, 'after'],
  ]) {
    const block = doc.createElement('div');
    block.className = `share-card__block share-card__block--${variant}`;
    const tag = doc.createElement('div');
    tag.className = 'share-card__label';
    tag.textContent = DICTIONARIES[gen]?.label ?? gen;
    const body = doc.createElement('div');
    body.className = 'share-card__text';
    body.textContent = text;
    block.append(tag, body);
    card.append(block);
  }

  const footer = doc.createElement('div');
  footer.className = 'share-card__footer';
  footer.setAttribute('data-testid', 'share-card-watermark');
  footer.textContent = resolveWatermark(config) || resolveSiteName(config);
  card.append(footer);
  return card;
}

/**
 * File name for a card, prefixed with the site-name slug, e.g.
 * rizzetta-stone-millennial-to-genz.png.
 * @param {string} from
 * @param {string} to
 * @param {import('./config/site.js').SiteConfig} config
 * @returns {string}
 */
export function shareCardFilename(from, to, config) {
  return `${resolveSlug(config)}-${from}-to-${to}.png`;
}

/**
 * Render the card off-screen, export it as a PNG, and trigger a download.
 * @param {CardContent} content
 * @returns {Promise<string>} the downloaded file name
 */
export async function downloadShareCard(content) {
  const card = buildShareCard(content);
  const stage = document.createElement('div');
  stage.className = 'share-card-stage';
  stage.append(card);
  document.body.append(stage);
  try {
    const dataUrl = await toPng(card, { pixelRatio: 2, cacheBust: false, skipFonts: true });
    const filename = shareCardFilename(content.from, content.to, content.config);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    return filename;
  } finally {
    stage.remove();
  }
}
