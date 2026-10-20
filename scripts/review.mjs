// Generate the dictionary review artifact: data/REVIEW.md and data/review.csv.
// Usage: npm run review [-- --date YYYY-MM-DD]
//
// Output is deterministic. The only date in it comes from --date, or else the
// latest `retrieved` date in the data, so re-runs produce no diff.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIDENCES, DICTIONARIES, GENERATION_IDS, LAUGH_TOKENS, PLAIN_ID } from '../src/engine/dictionaries.js';

/**
 * @typedef {{
 *   generation: string,
 *   kind: 'lexicon' | 'laughter' | 'laughToken' | 'style',
 *   concept: string,
 *   text: string,
 *   weight: number,
 *   confidence: string,
 *   status: string,
 *   needsReview: boolean,
 *   labels: string[],
 *   sources: string[],
 *   notes: string,
 * }} ReviewRow
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
export const COLUMNS = [
  'generation',
  'kind',
  'concept',
  'text',
  'weight',
  'confidence',
  'status',
  'needsReview',
  'labels',
  'sources',
  'notes',
];

/**
 * @param {string} kind
 * @param {string} generation
 * @param {string} concept
 * @param {any} e
 * @returns {ReviewRow}
 */
function row(kind, generation, concept, e) {
  return /** @type {ReviewRow} */ ({
    generation,
    kind,
    concept,
    text: e.text,
    weight: e.weight,
    confidence: e.confidence,
    status: e.status,
    needsReview: e.needsReview,
    labels: e.labels ?? [],
    sources: e.sources.map((/** @type {{ url: string }} */ s) => s.url),
    notes: e.notes,
  });
}

/**
 * Every reviewable entry: lexicon, laughter outputs, laugh tokens, style markers.
 * Plain English is left out: it is built from concepts.json and has no
 * research signal to review.
 * @param {Record<string, any>} [dictionaries]
 * @param {any[]} [laughTokens]
 * @returns {ReviewRow[]}
 */
export function collectRows(dictionaries = DICTIONARIES, laughTokens = LAUGH_TOKENS) {
  /** @type {ReviewRow[]} */
  const rows = [];
  for (const [gen, dict] of Object.entries(dictionaries)) {
    if (gen === PLAIN_ID) continue;
    for (const [concept, entries] of Object.entries(dict.lexicon)) {
      for (const e of /** @type {any[]} */ (entries)) rows.push(row('lexicon', gen, concept, e));
    }
    for (const [slot, e] of Object.entries(dict.laughter)) rows.push(row('laughter', gen, slot, e));
    for (const [key, e] of Object.entries(dict.styleMarkers ?? {})) rows.push(row('style', gen, key, e));
  }
  for (const t of laughTokens) rows.push(row('laughToken', t.primaryGeneration, t.standalone ? 'standalone' : 'any', t));
  return rows;
}

/** @param {string} gen */
const genRank = (gen) => {
  const i = GENERATION_IDS.indexOf(gen);
  return i === -1 ? GENERATION_IDS.length : i;
};

/** Code-unit string comparison: locale-independent, so output is stable. */
const cmp = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Review order: needsReview first, then confidence low → medium → high, then
 * weight ascending, then generation (oldest first, then others by name),
 * concept, and text.
 * @param {ReviewRow[]} rows
 * @returns {ReviewRow[]} a new sorted array
 */
export function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      Number(b.needsReview) - Number(a.needsReview) ||
      CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
      a.weight - b.weight ||
      genRank(a.generation) - genRank(b.generation) ||
      cmp(a.generation, b.generation) ||
      cmp(a.concept, b.concept) ||
      cmp(a.text, b.text),
  );
}

/**
 * RFC 4180: every field quoted, quotes doubled, CRLF line breaks. Sources are
 * space-separated; labels (which may contain spaces) are "; "-separated.
 * @param {ReviewRow[]} rows sorted
 * @returns {string}
 */
export function toCsv(rows) {
  const q = (/** @type {unknown} */ v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [COLUMNS.map(q).join(',')];
  for (const r of rows) {
    const field = (/** @type {string} */ c) =>
      c === 'sources' ? r.sources.join(' ') : c === 'labels' ? r.labels.join('; ') : r[/** @type {keyof ReviewRow} */ (c)];
    lines.push(COLUMNS.map((c) => q(field(c))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** @param {string} s */
const mdCell = (s) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** @param {string} url */
function linkLabel(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * @param {ReviewRow[]} rows sorted
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
export function toMarkdown(rows, date) {
  const gens = [...new Set(rows.map((r) => r.generation))].sort((a, b) => genRank(a) - genRank(b) || cmp(a, b));
  const review = rows.filter((r) => r.needsReview).length;
  const lines = [
    '# Dictionary review',
    '',
    `Generated ${date} by \`npm run review\` (scripts/review.mjs). ${rows.length} entries, ${review} need review.`,
    '',
    'To edit: change the JSON in `src/dictionaries/` (generation files and `laughTokens.json`), then re-run `npm run review`. Rows are sorted needsReview first, then confidence low → high, then weight ascending.',
    '',
    'Research method and caveats: every cited URL was fetched and read on the retrieved date; Urban Dictionary was never used. Merriam-Webster returned HTTP 403 on every page, so Merriam-Webster claims appear only second-hand (via Fox5 and Yahoo). No Pew Research data on slang or emoji by generation was available. Older-generation slang is thinly documented online, so Boomer, Gen X, and Millennial entries are mostly low confidence. Entries under review stay selectable; weight decides what the converter writes.',
    '',
    'Wiktionary re-vet (research pass 2): low-confidence entries were re-checked against Wiktionary usage labels; `labels` lists them (register such as slang or dated, not which generation uses a word). Only labels, our own notes, and URLs are stored, never definition text. `npm run verify-sources` re-checks them.',
    '',
    '| generation | low | medium | high | needsReview | total |',
    '|---|---|---|---|---|---|',
  ];
  for (const gen of gens) {
    const mine = rows.filter((r) => r.generation === gen);
    const counts = [...CONFIDENCES].reverse().map((c) => mine.filter((r) => r.confidence === c).length);
    lines.push(`| ${gen} | ${counts.join(' | ')} | ${mine.filter((r) => r.needsReview).length} | ${mine.length} |`);
  }
  lines.push('', `| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`);
  for (const r of rows) {
    const cells = [
      r.generation,
      r.kind,
      r.concept,
      r.text === '' ? '*(empty: drop)*' : mdCell(r.text),
      String(r.weight),
      r.confidence,
      r.status,
      r.needsReview ? '**yes**' : 'no',
      mdCell(r.labels.join(', ')),
      r.sources.map((u) => `[${linkLabel(u)}](${u})`).join(' '),
      mdCell(r.notes),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Latest `retrieved` date across all sources.
 * @returns {string}
 */
function latestRetrieved() {
  const dates = [];
  for (const dict of Object.values(DICTIONARIES)) {
    const groups = [...Object.values(dict.lexicon).flat(), ...Object.values(dict.laughter), ...Object.values(dict.styleMarkers ?? {})];
    for (const e of groups) for (const s of e.sources) dates.push(s.retrieved);
  }
  for (const t of LAUGH_TOKENS) for (const s of t.sources) dates.push(s.retrieved);
  return dates.sort().at(-1) ?? '1970-01-01';
}

async function main() {
  const i = process.argv.indexOf('--date');
  const date = i !== -1 ? process.argv[i + 1] : latestRetrieved();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('--date must be YYYY-MM-DD');
  const rows = sortRows(collectRows());
  const dir = path.join(root, 'data');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'REVIEW.md'), toMarkdown(rows, date));
  await writeFile(path.join(dir, 'review.csv'), toCsv(rows));
  console.log(`wrote data/REVIEW.md and data/review.csv (${rows.length} rows, date ${date})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
