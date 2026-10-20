import concepts from '../dictionaries/concepts.json' with { type: 'json' };
import laughTokens from '../dictionaries/laughTokens.json' with { type: 'json' };
import boomer from '../dictionaries/boomer.json' with { type: 'json' };
import genx from '../dictionaries/genx.json' with { type: 'json' };
import millennial from '../dictionaries/millennial.json' with { type: 'json' };
import genz from '../dictionaries/genz.json' with { type: 'json' };
import genalpha from '../dictionaries/genalpha.json' with { type: 'json' };

/**
 * @typedef {{ plain: string, description: string }} Concept
 * @typedef {Record<string, Concept>} Concepts
 * @typedef {'high' | 'medium' | 'low'} Confidence
 * @typedef {'current' | 'fading' | 'dated' | 'ironic'} Status
 * @typedef {{ url: string, retrieved: string }} Source
 * @typedef {{
 *   weight: number,
 *   confidence: Confidence,
 *   status: Status,
 *   sources: Source[],
 *   notes: string,
 *   needsReview: boolean,
 *   conceptMismatch?: boolean,
 *   proposedText?: string,
 *   labels?: string[],
 * }} EntryMeta
 * @typedef {EntryMeta & { text: string, standalone?: boolean }} LexiconEntry
 * @typedef {EntryMeta & { text: string }} LaughOutput
 * @typedef {{ trailing: LaughOutput, mid: LaughOutput, intense: LaughOutput }} Laughter
 * @typedef {{ ellipsis?: boolean, terse?: boolean }} StyleFlags
 * @typedef {EntryMeta & {
 *   text: string,
 *   primaryGeneration: string,
 *   pattern: string,
 *   word: boolean,
 *   standalone: boolean,
 *   intense: boolean,
 *   intenseMinBeats?: number,
 * }} LaughToken
 * @typedef {{
 *   id: string,
 *   label: string,
 *   years?: string,
 *   laughter: Laughter,
 *   lexicon: Record<string, LexiconEntry[]>,
 *   style?: StyleFlags,
 *   signoff?: string,
 *   styleMarkers?: Record<string, EntryMeta & { text: string }>,
 * }} GenerationDictionary
 */

/** Generation ids in display order (oldest first). */
export const GENERATION_IDS = ['boomer', 'genx', 'millennial', 'genz', 'genalpha'];

/** Id of the synthetic Plain English generation (see buildPlainDictionary). */
export const PLAIN_ID = 'plain';

/** Every selectable source/target id in display order: the generations, then Plain English. */
export const LANGUAGE_IDS = [...GENERATION_IDS, PLAIN_ID];

/** @type {Concepts} */
export const CONCEPTS = concepts;

/** @type {LaughToken[]} */
export const LAUGH_TOKENS = /** @type {LaughToken[]} */ (laughTokens);

const PLAIN_META = {
  weight: 1,
  confidence: /** @type {Confidence} */ ('high'),
  status: /** @type {Status} */ ('current'),
  sources: [],
  notes: 'plain English baseline',
  needsReview: false,
};

/**
 * Plain English, built from each concept's `plain` word rather than stored in
 * its own file, so it can never drift from concepts.json. Laughter becomes
 * words; there is no style flourish or signoff. Its lexicon entries are
 * `standalone`: from another generation a plain word decodes only on its own,
 * but the engine matches them anywhere when Plain English is the source.
 * @param {Concepts} conceptList
 * @returns {GenerationDictionary}
 */
export function buildPlainDictionary(conceptList) {
  return {
    id: PLAIN_ID,
    label: 'Plain English',
    laughter: {
      trailing: { text: '(laughing)', ...PLAIN_META, sources: [] },
      mid: { text: 'haha', ...PLAIN_META, sources: [] },
      intense: { text: '(laughing hard)', ...PLAIN_META, sources: [] },
    },
    lexicon: Object.fromEntries(
      Object.entries(conceptList).map(([id, { plain }]) => [id, [{ text: plain, standalone: true, ...PLAIN_META, sources: [] }]]),
    ),
  };
}

/** @type {Record<string, GenerationDictionary>} */
export const DICTIONARIES = /** @type {any} */ ({
  boomer,
  genx,
  millennial,
  genz,
  genalpha,
  [PLAIN_ID]: buildPlainDictionary(concepts),
});

export const CONFIDENCES = ['high', 'medium', 'low'];
export const STATUSES = ['current', 'fading', 'dated', 'ironic'];
const LAUGH_SLOTS = ['trailing', 'mid', 'intense'];
const STYLE_FLAGS = ['ellipsis', 'terse'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Text of a lexicon entry or laugh output.
 * @param {string | { text: string }} entry
 * @returns {string}
 */
export function entryText(entry) {
  return typeof entry === 'string' ? entry : entry.text;
}

/**
 * The entry the encoder writes for a concept: highest `weight`, ties broken by
 * array order. `status` is informational only.
 * @param {LexiconEntry[]} entries non-empty
 * @returns {LexiconEntry}
 */
export function pickPrimary(entries) {
  let best = entries[0];
  for (const entry of entries) if (entry.weight > best.weight) best = entry;
  return best;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function isIsoDate(s) {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Check the shared metadata fields of one entry.
 * @param {any} entry
 * @param {string} where prefix for messages
 * @param {{ allowEmptyText?: boolean, allowStandalone?: boolean }} [opts]
 * @returns {string[]}
 */
export function validateEntry(entry, where, opts = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [`${where} must be an object`];
  const errors = [];
  if (typeof entry.text !== 'string' || (!opts.allowEmptyText && !entry.text.trim())) {
    errors.push(`${where}: "text" must be a ${opts.allowEmptyText ? '' : 'non-empty '}string`);
  }
  if (entry.standalone !== undefined && (!opts.allowStandalone || typeof entry.standalone !== 'boolean')) {
    errors.push(`${where}: "standalone" must be a boolean`);
  }
  if (typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0 || entry.weight > 1) {
    errors.push(`${where}: "weight" must be a number in [0, 1]`);
  }
  if (!CONFIDENCES.includes(entry.confidence)) {
    errors.push(`${where}: "confidence" must be one of ${CONFIDENCES.join('|')}`);
  }
  if (!STATUSES.includes(entry.status)) errors.push(`${where}: "status" must be one of ${STATUSES.join('|')}`);
  if (!Array.isArray(entry.sources)) {
    errors.push(`${where}: "sources" must be an array`);
  } else {
    entry.sources.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      if (!s || typeof s !== 'object') {
        errors.push(`${where}: sources[${i}] must be { url, retrieved }`);
        return;
      }
      if (typeof s.url !== 'string' || !/^https?:\/\/\S+$/.test(s.url)) {
        errors.push(`${where}: sources[${i}].url must start with https:// or http://`);
      }
      if (typeof s.retrieved !== 'string' || !isIsoDate(s.retrieved)) {
        errors.push(`${where}: sources[${i}].retrieved must be a YYYY-MM-DD date`);
      }
    });
  }
  if (typeof entry.notes !== 'string') errors.push(`${where}: "notes" must be a string`);
  if (typeof entry.needsReview !== 'boolean') errors.push(`${where}: "needsReview" must be a boolean`);
  if (entry.confidence === 'low' && entry.needsReview !== true) {
    errors.push(`${where}: low confidence requires "needsReview": true`);
  }
  if (entry.conceptMismatch !== undefined && typeof entry.conceptMismatch !== 'boolean') {
    errors.push(`${where}: "conceptMismatch" must be a boolean`);
  }
  if (entry.proposedText !== undefined && typeof entry.proposedText !== 'string') {
    errors.push(`${where}: "proposedText" must be a string`);
  }
  if (
    entry.labels !== undefined &&
    (!Array.isArray(entry.labels) || entry.labels.some((/** @type {unknown} */ l) => typeof l !== 'string' || !l.trim()))
  ) {
    errors.push(`${where}: "labels" must be an array of non-empty strings`);
  }
  return errors;
}

/**
 * Validate one generation dictionary against the concept list.
 * @param {any} dict
 * @param {Concepts} conceptList
 * @returns {string[]} human-readable errors; empty when valid
 */
export function validateDictionary(dict, conceptList) {
  const errors = [];
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) {
    return ['dictionary must be an object'];
  }
  const name = typeof dict.id === 'string' && dict.id ? dict.id : '(unknown)';
  for (const key of ['id', 'label', 'years']) {
    // Plain English has no birth-year range; validateAll requires one for every generation.
    if (key === 'years' && dict.years === undefined) continue;
    if (typeof dict[key] !== 'string' || !dict[key].trim()) {
      errors.push(`${name}: "${key}" must be a non-empty string`);
    }
  }

  const laughter = dict.laughter;
  if (!laughter || typeof laughter !== 'object') {
    errors.push(`${name}: "laughter" must be an object with ${LAUGH_SLOTS.join(', ')}`);
  } else {
    for (const slot of LAUGH_SLOTS) {
      if (!laughter[slot] || typeof laughter[slot] !== 'object') {
        errors.push(`${name}: "laughter.${slot}" must be an object (use "text": "" to drop the laugh)`);
      } else {
        errors.push(...validateEntry(laughter[slot], `${name}: laughter.${slot}`, { allowEmptyText: true }));
      }
    }
  }

  if (dict.style !== undefined) {
    if (!dict.style || typeof dict.style !== 'object') {
      errors.push(`${name}: "style" must be an object`);
    } else {
      for (const flag of Object.keys(dict.style)) {
        if (!STYLE_FLAGS.includes(flag)) errors.push(`${name}: unknown style flag "${flag}"`);
        else if (typeof dict.style[flag] !== 'boolean') errors.push(`${name}: style flag "${flag}" must be boolean`);
      }
    }
  }
  if (dict.signoff !== undefined && (typeof dict.signoff !== 'string' || !dict.signoff.trim())) {
    errors.push(`${name}: "signoff" must be a non-empty string when present`);
  }
  if (dict.styleMarkers !== undefined) {
    if (!dict.styleMarkers || typeof dict.styleMarkers !== 'object' || Array.isArray(dict.styleMarkers)) {
      errors.push(`${name}: "styleMarkers" must be an object`);
    } else {
      for (const [key, marker] of Object.entries(dict.styleMarkers)) {
        const known = key === 'signoff' ? dict.signoff !== undefined : dict.style?.[key] !== undefined;
        if (!known) errors.push(`${name}: styleMarkers "${key}" has no matching style flag or signoff`);
        errors.push(...validateEntry(marker, `${name}: styleMarkers.${key}`));
      }
    }
  }

  const lexicon = dict.lexicon;
  if (!lexicon || typeof lexicon !== 'object' || Array.isArray(lexicon)) {
    errors.push(`${name}: "lexicon" must be an object of concept id -> entries`);
    return errors;
  }
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const [conceptId, entries] of Object.entries(lexicon)) {
    if (!Object.hasOwn(conceptList, conceptId)) {
      errors.push(`${name}: unknown concept id "${conceptId}"`);
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      errors.push(`${name}: lexicon "${conceptId}" must be a non-empty array`);
      continue;
    }
    entries.forEach((entry, i) => {
      const entryErrors = validateEntry(entry, `${name}: lexicon "${conceptId}"[${i}]`, { allowStandalone: true });
      errors.push(...entryErrors);
      if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string' || !entry.text.trim()) return;
      const key = entry.text.trim().toLowerCase().replace(/[’‘]/g, "'");
      const prior = seen.get(key);
      if (prior !== undefined) {
        errors.push(`${name}: duplicate expression "${entry.text}" (in "${prior}" and "${conceptId}")`);
      } else {
        seen.set(key, conceptId);
      }
    });
  }
  return errors;
}

/**
 * Validate the laugh-token list.
 * @param {any} tokens
 * @returns {string[]}
 */
export function validateLaughTokens(tokens) {
  if (!Array.isArray(tokens)) return ['laughTokens must be an array'];
  const errors = [];
  tokens.forEach((t, i) => {
    const where = `laughTokens[${i}]`;
    errors.push(...validateEntry(t, where, { allowStandalone: true }));
    if (!t || typeof t !== 'object') return;
    if (typeof t.primaryGeneration !== 'string' || !t.primaryGeneration) {
      errors.push(`${where}: "primaryGeneration" must be a non-empty string`);
    }
    for (const key of ['word', 'standalone', 'intense']) {
      if (typeof t[key] !== 'boolean') errors.push(`${where}: "${key}" must be a boolean`);
    }
    if (t.intenseMinBeats !== undefined && !(Number.isInteger(t.intenseMinBeats) && t.intenseMinBeats > 0)) {
      errors.push(`${where}: "intenseMinBeats" must be a positive integer`);
    }
    if (typeof t.pattern !== 'string' || !t.pattern) {
      errors.push(`${where}: "pattern" must be a non-empty regex source`);
    } else {
      try {
        new RegExp(t.pattern, 'iu');
      } catch {
        errors.push(`${where}: "pattern" is not a valid regular expression`);
      }
    }
  });
  return errors;
}

/**
 * Validate every shipped dictionary and the laugh-token list.
 * @returns {string[]} all errors across generations
 */
export function validateAll() {
  return LANGUAGE_IDS.flatMap((id) => {
    const dict = DICTIONARIES[id];
    const errors = validateDictionary(dict, CONCEPTS);
    if (dict && dict.id !== id) errors.push(`${id}: file id "${dict.id}" does not match its registry key`);
    if (id !== PLAIN_ID && dict && dict.years === undefined) errors.push(`${id}: "years" must be a non-empty string`);
    return errors;
  }).concat(validateLaughTokens(LAUGH_TOKENS));
}
