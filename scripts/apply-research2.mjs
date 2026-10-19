// Apply the Wiktionary re-vet (research pass 2) to src/dictionaries/.
// Usage: node scripts/apply-research2.mjs <path/to/research2-updates.json>
//
// Each update names generation, kind (lexicon|laughter|laughToken|styleMarker),
// concept or slot, and text. The matching entry gets:
// - confidence/status/weight/needsReview from `new`;
// - `sourcesAdd` appended (deduped by url);
// - the update's notes appended to its notes;
// - `labels`: the usage labels, normalized like `npm run verify-sources`.
// Categories and Urban Dictionary signals are not stored, nor is any
// definition text.
//
// needsReview stays true when confidence is low, and when an earlier decision
// forced it (concept mismatch, or a research "remove" kept for review).
// An update that matches no entry is an error: nothing is written and the
// script exits 1. Re-running gives byte-identical files. Run it after
// scripts/merge-research.mjs, which resets research-covered metadata.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLabels } from './verify-sources.mjs';
// Same cap as scripts/merge-research.mjs (a concept-mismatch entry decodes but rarely wins encoding).
const MISMATCH_WEIGHT_CAP = 0.3;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictDir = path.join(root, 'src', 'dictionaries');
const GENERATIONS = ['boomer', 'genx', 'millennial', 'genz', 'genalpha'];
const NOTE_PREFIX = 'Wiktionary re-vet:';

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/[’‘]/g, "'");

/** @param {string} file */
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

/**
 * True when an earlier merge decision requires review regardless of the
 * re-vet: a concept mismatch, or a research "remove" kept because it was low.
 * @param {any} entry
 */
const forcedReview = (entry) =>
  entry.conceptMismatch === true || /^Research recommends removal\b/.test(entry.notes) || /Merge: Dictionary\.com says the meaning is ambiguous/.test(entry.notes);

/**
 * Find the entry an update refers to.
 * @param {any} u update
 * @param {Record<string, any>} dicts
 * @param {any[]} tokens
 * @returns {any | null}
 */
function locate(u, dicts, tokens) {
  const dict = dicts[u.generation];
  switch (u.kind) {
    case 'lexicon': {
      if (!dict) return null;
      for (const [concept, entries] of Object.entries(dict.lexicon)) {
        for (const e of /** @type {any[]} */ (entries)) {
          if (norm(e.text) !== norm(u.text)) continue;
          // The merge may have moved the entry; its note records the old concept.
          if (concept === u.concept || e.notes.includes(`moved from "${u.concept}"`)) return e;
        }
      }
      return null;
    }
    case 'laughter': {
      const e = dict?.laughter?.[u.slot];
      return e && e.text === u.text ? e : null;
    }
    case 'styleMarker':
      return Object.values(dict?.styleMarkers ?? {}).find((m) => m.text === u.text) ?? null;
    case 'laughToken':
      return tokens.find((t) => t.text === u.text && t.primaryGeneration === u.generation) ?? null;
    default:
      return null;
  }
}

/**
 * Apply one update to its entry, in place. Idempotent.
 * @param {any} entry
 * @param {any} u
 */
export function applyUpdate(entry, u) {
  const { confidence, status, weight } = u.new;
  // Concept-mismatch entries keep the merge cap so they decode but rarely win encoding.
  entry.weight = entry.notes.startsWith('Concept mismatch:') ? Math.min(weight, MISMATCH_WEIGHT_CAP) : weight;
  entry.confidence = confidence;
  entry.status = status;
  const seen = new Set(entry.sources.map((/** @type {{ url: string }} */ s) => s.url));
  for (const s of u.sourcesAdd ?? []) {
    if (seen.has(s.url)) continue;
    entry.sources.push({ url: s.url, retrieved: s.retrieved });
    seen.add(s.url);
  }
  const note = u.notes?.trim() ? `${NOTE_PREFIX} ${u.notes.trim()}` : '';
  if (note && !entry.notes.includes(note)) entry.notes = entry.notes ? `${entry.notes} ${note}` : note;
  entry.needsReview = Boolean(u.new.needsReview) || confidence === 'low' || forcedReview(entry);
  entry.labels = normalizeLabels(u.labels ?? []);
}

async function main() {
  const updatesPath = process.argv[2];
  if (!updatesPath) {
    console.error('usage: node scripts/apply-research2.mjs <research2-updates.json>');
    process.exit(2);
  }
  const { updates } = await readJson(updatesPath);
  /** @type {Record<string, any>} */
  const dicts = {};
  for (const gen of GENERATIONS) dicts[gen] = await readJson(path.join(dictDir, `${gen}.json`));
  const tokensFile = path.join(dictDir, 'laughTokens.json');
  const tokens = await readJson(tokensFile);

  /** @type {string[]} */
  const errors = [];
  let applied = 0;
  for (const u of updates) {
    const entry = locate(u, dicts, tokens);
    if (!entry) {
      errors.push(`no entry for ${u.generation} ${u.kind} ${u.concept ?? u.slot ?? ''} "${u.text}"`);
      continue;
    }
    applyUpdate(entry, u);
    applied += 1;
  }
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`apply-research2: ${errors.length} unmatched update(s); nothing written`);
    process.exit(1);
  }
  for (const gen of GENERATIONS) await writeFile(path.join(dictDir, `${gen}.json`), `${JSON.stringify(dicts[gen], null, 2)}\n`);
  await writeFile(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`);
  console.log(`applied ${applied} research2 updates to ${path.relative(root, dictDir)}/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
