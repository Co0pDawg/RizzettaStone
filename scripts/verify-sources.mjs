// Re-check every dictionary entry against Wiktionary and report label drift.
// Usage: npm run verify-sources [-- --strict] [--write] [--limit N] [--delay MS] [--no-cache]
//
// For each entry whose text is a word or phrase (lexicon, laughter outputs,
// laugh tokens, style markers), it fetches
//   https://en.wiktionary.org/api/rest_v1/page/definition/<term>
// for existence (a 404 means the entry disappeared) and any label markup, plus
// the page wikitext from the MediaWiki API, because the REST definitions ship
// the `usage-label-sense` spans empty and the labels live in `{{lb|en|…}}`.
// Only label tokens (slang, dated, Internet, …) are kept; definition text is
// never stored or printed (Wiktionary is CC BY-SA).
//
// Output: a Markdown report on stdout and in data/verify-sources-report.md
// (git-ignored). Exit 0 by default; --strict exits 1 when anything changed.
// --write stores the fetched labels in the JSON; confidence and status stay
// human decisions. Requests are sequential with a delay (default 1000 ms),
// cached under .cache/wiktionary/ (git-ignored), time out after 15 s, and are
// retried once on 429/5xx.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictDir = path.join(root, 'src', 'dictionaries');
const cacheDir = path.join(root, '.cache', 'wiktionary');
const reportPath = path.join(root, 'data', 'verify-sources-report.md');
const GENERATIONS = ['boomer', 'genx', 'millennial', 'genz', 'genalpha'];
const USER_AGENT = 'RizzettaStone-verify-sources/0.1 (dictionary label check; https://github.com/Co0pDawg/RizzettaStone)';
const REST = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const WIKITEXT =
  'https://en.wiktionary.org/w/api.php?action=query&prop=revisions&rvslots=main&rvprop=content&format=json&formatversion=2&titles=';
const TIMEOUT_MS = 15000;
/** Labels that mean a term is on its way out. */
export const AGEING = ['dated', 'archaic', 'obsolete'];

/**
 * Usage labels we keep, keyed by the lower-cased Wiktionary label or alias.
 * Topical and grammatical labels (music, transitive, …) are ignored.
 * @type {Record<string, string[]>}
 */
const LABEL_MAP = {
  slang: ['slang'],
  'internet slang': ['Internet', 'slang'],
  internet: ['Internet'],
  informal: ['informal'],
  colloquial: ['colloquial'],
  dated: ['dated'],
  outdated: ['dated'],
  'old-fashioned': ['dated'],
  archaic: ['archaic'],
  obsolete: ['obsolete'],
  humorous: ['humorous'],
  humourous: ['humorous'],
  jocular: ['humorous'],
  ironic: ['ironic'],
  euphemistic: ['euphemistic'],
  vulgar: ['vulgar'],
  derogatory: ['derogatory'],
  offensive: ['offensive'],
  nonstandard: ['nonstandard'],
  rare: ['rare'],
  neologism: ['neologism'],
  'text messaging': ['text messaging'],
  texting: ['text messaging'],
  idiomatic: ['idiomatic'],
  'minced oath': ['minced oath'],
  pejorative: ['pejorative'],
  proscribed: ['proscribed'],
  fandom: ['fandom'],
  'gen z slang': ['Gen Z slang'],
  aave: ['AAVE'],
  'african-american vernacular': ['AAVE'],
  us: ['US'],
  uk: ['UK'],
  british: ['UK'],
  canada: ['Canada'],
  'north american': ['North American'],
  ireland: ['Ireland'],
  australia: ['Australia'],
};

/**
 * Normalize raw label strings: map aliases, drop non-usage labels, dedupe,
 * and sort (code-unit order) so the result is stable.
 * @param {Iterable<string>} raw
 * @returns {string[]}
 */
export function normalizeLabels(raw) {
  const out = new Set();
  for (const r of raw) {
    for (const label of LABEL_MAP[r.trim().toLowerCase()] ?? []) out.add(label);
  }
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** @param {string} html */
const stripTags = (html) => html.replace(/<[^>]*>/g, '');

/**
 * Inner HTML of each `usage-label-sense` span, matching nested spans.
 * @param {string} html
 * @returns {string[]}
 */
function labelSpans(html) {
  const out = [];
  const open = /<span\b[^>]*class="[^"]*\busage-label-sense\b[^"]*"[^>]*>/g;
  for (const m of html.matchAll(open)) {
    const start = /** @type {number} */ (m.index) + m[0].length;
    const tags = /<span\b[^>]*>|<\/span>/g;
    tags.lastIndex = start;
    let depth = 1;
    for (let t = tags.exec(html); t; t = tags.exec(html)) {
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        out.push(html.slice(start, t.index));
        break;
      }
    }
  }
  return out;
}

/**
 * Usage labels from a Wiktionary REST `page/definition` response: the
 * contents of `usage-label-sense` spans and leading "(…)" qualifiers of each
 * English definition. Pure; reads labels only, never definition text.
 * @param {any} restJson
 * @returns {string[]}
 */
export function extractLabels(restJson) {
  /** @type {string[]} */
  const raw = [];
  for (const section of restJson?.en ?? []) {
    for (const def of section?.definitions ?? []) {
      const html = typeof def?.definition === 'string' ? def.definition : '';
      for (const inner of labelSpans(html)) raw.push(...splitLabelList(stripTags(inner)));
      const lead = /^\s*\(([^()]{1,80})\)/.exec(stripTags(html));
      if (lead) raw.push(...splitLabelList(lead[1]));
    }
  }
  return normalizeLabels(raw);
}

/**
 * "(slang, dated)" / "Internet slang" → ["slang", "dated"] / ["Internet slang"].
 * @param {string} list
 * @returns {string[]}
 */
function splitLabelList(list) {
  return list
    .replace(/^[\s(]+|[\s)]+$/g, '')
    .split(/\s*[,;]\s*|\s+(?:and|or)\s+/)
    .filter(Boolean);
}

/**
 * Usage labels from page wikitext: `{{lb|en|…}}` (and aliases) plus legacy
 * `{{slang|en}}`-style templates on English definition lines. Pure.
 * @param {string} wikitext
 * @returns {string[]}
 */
export function extractWikitextLabels(wikitext) {
  const start = wikitext.indexOf('==English==');
  if (start === -1) return [];
  const next = /\n==[^=]/.exec(wikitext.slice(start + 11));
  const english = wikitext.slice(start, next ? start + 11 + next.index : undefined);
  /** @type {string[]} */
  const raw = [];
  for (const line of english.split('\n')) {
    if (!/^#+\s/.test(line)) continue; // definition lines only, not #: / #* quotes
    for (const m of line.matchAll(/\{\{\s*(?:lb|lbl|label|tlb|term-label|cx|context)\s*\|\s*en\s*\|([^{}]*)\}\}/gi)) {
      raw.push(...m[1].split('|').filter((p) => !p.includes('=')));
    }
    for (const m of line.matchAll(/\{\{\s*([A-Za-z -]+?)\s*\|\s*en\s*[|}]/g)) raw.push(m[1]);
  }
  return normalizeLabels(raw);
}

/**
 * Compare stored and fetched labels.
 * @param {string[] | undefined} stored
 * @param {string[]} fetched
 * @param {string} status stored entry status
 * @returns {{ added: string[], removed: string[], newlyAgeing: boolean }}
 */
export function diffLabels(stored, fetched, status) {
  const before = new Set(stored ?? []);
  const after = new Set(fetched);
  const added = fetched.filter((l) => !before.has(l));
  const removed = [...before].filter((l) => !after.has(l)).sort();
  const newlyAgeing = status === 'current' && added.some((l) => AGEING.includes(l));
  return { added, removed, newlyAgeing };
}

/**
 * Wiktionary page titles to look up for an entry text: each " / "
 * alternative that is a word or short phrase. Emoji, numbers, and empty
 * outputs are skipped.
 * @param {string} text
 * @returns {string[]}
 */
export function lookupTerms(text) {
  return text
    .split(' / ')
    .map((t) => t.trim().replace(/[.!?]+$/, ''))
    .filter((t) => /^\p{L}[\p{L}'’ -]*$/u.test(t) && t.split(/\s+/).length <= 4);
}

/**
 * Every checkable entry, with where it lives so --write can update it.
 * @param {Record<string, any>} dicts generation id -> dictionary
 * @param {any[]} tokens
 */
function collectEntries(dicts, tokens) {
  /** @type {{ where: string, entry: any, terms: string[] }[]} */
  const out = [];
  const add = (/** @type {string} */ where, /** @type {any} */ entry) => {
    const terms = lookupTerms(entry.text);
    if (terms.length) out.push({ where, entry, terms });
  };
  for (const gen of GENERATIONS) {
    const d = dicts[gen];
    for (const [concept, entries] of Object.entries(d.lexicon)) {
      for (const e of /** @type {any[]} */ (entries)) add(`${gen} lexicon ${concept} "${e.text}"`, e);
    }
    for (const [slot, e] of Object.entries(d.laughter)) add(`${gen} laughter.${slot} "${e.text}"`, e);
    for (const [key, e] of Object.entries(d.styleMarkers ?? {})) add(`${gen} styleMarkers.${key} "${e.text}"`, e);
  }
  for (const t of tokens) add(`laughToken "${t.text}"`, t);
  return out;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET with cache, timeout, and one retry on 429/5xx.
 * @param {string} url
 * @param {{ delay: number, useCache: boolean }} opts
 * @returns {Promise<{ status: number, body: string, cached: boolean }>}
 */
async function get(url, opts) {
  const file = path.join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (opts.useCache) {
    try {
      const hit = JSON.parse(await readFile(file, 'utf8'));
      return { status: hit.status, body: hit.body, cached: true };
    } catch {
      // miss
    }
  }
  let res;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await sleep(opts.delay);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      res = { status: r.status, body: await r.text() };
    } catch (err) {
      res = { status: 0, body: err instanceof Error ? err.message : String(err) };
    }
    if (!(res.status === 0 || res.status === 429 || res.status >= 500)) break;
  }
  const result = /** @type {{ status: number, body: string }} */ (res);
  if (result.status === 200 || result.status === 404) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify({ url, status: result.status, body: result.body }));
  }
  return { ...result, cached: false };
}

/**
 * Fetch labels for one lookup term.
 * @param {string} term
 * @param {{ delay: number, useCache: boolean }} opts
 * @returns {Promise<{ found: boolean, labels: string[], error?: string }>}
 */
async function fetchTerm(term, opts) {
  const title = term.replace(/’/g, "'").replace(/ /g, '_');
  for (const candidate of title === title.toLowerCase() ? [title] : [title, title.toLowerCase()]) {
    const rest = await get(REST + encodeURIComponent(candidate), opts);
    if (rest.status === 404) continue;
    if (rest.status !== 200) return { found: false, labels: [], error: `HTTP ${rest.status} for ${candidate}` };
    let labels = [];
    try {
      labels = extractLabels(JSON.parse(rest.body));
    } catch {
      return { found: false, labels: [], error: `bad JSON for ${candidate}` };
    }
    // The REST HTML currently ships the label spans empty, so read the wikitext too.
    const wt = await get(WIKITEXT + encodeURIComponent(candidate), opts);
    if (wt.status !== 200) return { found: true, labels, error: `HTTP ${wt.status} for wikitext of ${candidate}` };
    const page = JSON.parse(wt.body)?.query?.pages?.[0];
    const text = page?.revisions?.[0]?.slots?.main?.content ?? '';
    return { found: true, labels: normalizeLabels([...labels, ...extractWikitextLabels(text)]) };
  }
  return { found: false, labels: [] };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = { strict: false, write: false, limit: Infinity, delay: 1000, useCache: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--write') opts.write = true;
    else if (a === '--no-cache') opts.useCache = false;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--delay') opts.delay = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!(opts.limit > 0) || !(opts.delay >= 0)) throw new Error('--limit must be > 0 and --delay >= 0');
  return opts;
}

/** @param {string} file */
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  /** @type {Record<string, any>} */
  const dicts = {};
  for (const gen of GENERATIONS) dicts[gen] = await readJson(path.join(dictDir, `${gen}.json`));
  const tokens = await readJson(path.join(dictDir, 'laughTokens.json'));
  const entries = collectEntries(dicts, tokens).slice(0, opts.limit);

  /** @type {string[]} */
  const changed = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const ageing = [];
  /** @type {string[]} */
  const errors = [];
  let unchanged = 0;
  for (const { where, entry, terms } of entries) {
    const results = [];
    for (const term of terms) results.push(await fetchTerm(term, opts));
    const failed = results.filter((r) => r.error);
    if (failed.length) {
      errors.push(`- ${where}: ${failed.map((r) => r.error).join('; ')}`);
      continue;
    }
    if (!results.some((r) => r.found)) {
      missing.push(`- ${where}: no Wiktionary entry for ${terms.map((t) => `"${t}"`).join(', ')}`);
      continue;
    }
    const fetched = normalizeLabels(results.flatMap((r) => r.labels));
    const { added, removed, newlyAgeing } = diffLabels(entry.labels, fetched, entry.status);
    if (newlyAgeing) ageing.push(`- ${where}: now labelled ${added.filter((l) => AGEING.includes(l)).join(', ')} (status is current)`);
    if (added.length || removed.length || entry.labels === undefined) {
      const parts = [];
      if (added.length) parts.push(`+${added.join(' +')}`);
      if (removed.length) parts.push(`-${removed.join(' -')}`);
      changed.push(`- ${where}: ${parts.join(' ') || 'no labels'}${entry.labels === undefined ? ' (none stored yet)' : ''}`);
      if (opts.write) entry.labels = fetched;
    } else {
      unchanged += 1;
    }
  }

  const changes = changed.length + missing.length;
  const lines = [
    '# Wiktionary label check',
    '',
    `Checked ${entries.length} entries: ${changed.length} with label changes, ${missing.length} missing, ${ageing.length} newly dated/archaic/obsolete, ${errors.length} errors, ${unchanged} unchanged.`,
    'Labels come from every English sense of the page, so a dated sense can belong to a meaning we do not use. Review before editing the JSON.',
    '',
    '## Newly dated / archaic / obsolete (stored status: current)',
    ...(ageing.length ? ageing : ['- none']),
    '',
    '## Missing on Wiktionary (404)',
    ...(missing.length ? missing : ['- none']),
    '',
    '## Label changes (+added -removed)',
    ...(changed.length ? changed : ['- none']),
    '',
    '## Errors',
    ...(errors.length ? errors : ['- none']),
    '',
  ];
  const report = lines.join('\n');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report);
  process.stdout.write(report);

  if (opts.write) {
    for (const gen of GENERATIONS) await writeFile(path.join(dictDir, `${gen}.json`), `${JSON.stringify(dicts[gen], null, 2)}\n`);
    await writeFile(path.join(dictDir, 'laughTokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);
    console.error('verify-sources: wrote labels to src/dictionaries/');
  }
  if (opts.strict && changes > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`verify-sources: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 2;
  });
}
