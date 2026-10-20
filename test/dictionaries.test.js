import { describe, expect, it } from 'vitest';
import {
  CONCEPTS,
  CONFIDENCES,
  DICTIONARIES,
  GENERATION_IDS,
  LANGUAGE_IDS,
  LAUGH_TOKENS,
  STATUSES,
  validateAll,
  validateDictionary,
  validateLaughTokens,
} from '../src/engine/dictionaries.js';

const META_FIELDS = ['text', 'weight', 'confidence', 'status', 'sources', 'notes', 'needsReview'];

/** Every reviewable entry in the shipped data, with a label for messages. */
function allEntries() {
  const out = [];
  for (const id of GENERATION_IDS) {
    const dict = DICTIONARIES[id];
    for (const [concept, entries] of Object.entries(dict.lexicon)) {
      for (const e of entries) out.push({ where: `${id} ${concept} "${e.text}"`, e, lexicon: true });
    }
    for (const [slot, e] of Object.entries(dict.laughter)) out.push({ where: `${id} laughter.${slot}`, e });
    for (const [key, e] of Object.entries(dict.styleMarkers ?? {})) out.push({ where: `${id} style ${key}`, e });
  }
  for (const e of LAUGH_TOKENS) out.push({ where: `laughToken "${e.text}"`, e });
  return out;
}

/** A valid lexicon entry, to break in fixtures. */
const entry = (over = {}) => ({
  text: 'epic',
  standalone: false,
  weight: 0.5,
  confidence: 'medium',
  status: 'current',
  sources: [{ url: 'https://example.com/epic', retrieved: '2026-10-19' }],
  notes: '',
  needsReview: false,
  ...over,
});

/** A valid laughter output. */
const laugh = (text) => {
  const { standalone, ...rest } = entry({ text });
  return rest;
};

describe('validateDictionary', () => {
  it('accepts every shipped dictionary and the laugh tokens', () => {
    expect(validateAll()).toEqual([]);
    for (const id of LANGUAGE_IDS) expect(validateDictionary(DICTIONARIES[id], CONCEPTS)).toEqual([]);
    expect(validateLaughTokens(LAUGH_TOKENS)).toEqual([]);
  });

  it('gives every entry every field, a weight in range, and review for low confidence', () => {
    const entries = allEntries();
    expect(entries.length).toBeGreaterThan(150);
    for (const { where, e, lexicon } of entries) {
      for (const field of META_FIELDS) expect(Object.hasOwn(e, field), `${where} has ${field}`).toBe(true);
      if (lexicon) expect(typeof e.standalone, `${where} standalone`).toBe('boolean');
      expect(e.weight, where).toBeGreaterThanOrEqual(0);
      expect(e.weight, where).toBeLessThanOrEqual(1);
      expect(CONFIDENCES, where).toContain(e.confidence);
      expect(STATUSES, where).toContain(e.status);
      if (e.confidence === 'low') expect(e.needsReview, where).toBe(true);
    }
  });

  it('keeps notes in our own words: no quoted passage longer than five words', () => {
    // A quote opens after a non-word character and closes before one, so
    // apostrophes inside words ("403'd", "it's") do not count.
    const quote = /(?<![\p{L}\p{N}])(['"‘“])(.+?)['"’”](?![\p{L}\p{N}])/gu;
    for (const { where, e } of allEntries()) {
      for (const m of e.notes.matchAll(quote)) {
        expect(m[2].trim().split(/\s+/).length, `${where} quotes ${m[0]}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('ships a concept list with plain fallbacks', () => {
    const ids = Object.keys(CONCEPTS);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(ids.length).toBeLessThanOrEqual(40);
    for (const id of ids) expect(typeof CONCEPTS[id].plain).toBe('string');
  });

  it('reports errors for a broken dictionary', () => {
    const broken = {
      id: 'broken',
      label: '',
      years: ' ',
      laughter: { trailing: laugh('lol'), mid: 'haha' },
      style: { sparkle: true },
      lexicon: {
        excellent: [entry(), entry({ text: 'EPIC' })],
        not_a_concept: [entry({ text: 'zzz' })],
        cool: [],
        wow: ['plain string'],
      },
    };
    const errors = validateDictionary(broken, CONCEPTS);
    expect(errors).toEqual(
      expect.arrayContaining([
        'broken: "label" must be a non-empty string',
        'broken: "years" must be a non-empty string',
        'broken: "laughter.mid" must be an object (use "text": "" to drop the laugh)',
        'broken: "laughter.intense" must be an object (use "text": "" to drop the laugh)',
        'broken: unknown style flag "sparkle"',
        'broken: duplicate expression "EPIC" (in "excellent" and "excellent")',
        'broken: unknown concept id "not_a_concept"',
        'broken: lexicon "cool" must be a non-empty array',
        'broken: lexicon "wow"[0] must be an object',
      ]),
    );
    expect(validateDictionary(null, CONCEPTS)).toEqual(['dictionary must be an object']);
  });

  it('rejects bad entry metadata', () => {
    const withEntry = (e) => ({ ...DICTIONARIES.genz, lexicon: { excellent: [e] } });
    const errorsFor = (e) => validateDictionary(withEntry(e), CONCEPTS);
    const where = 'genz: lexicon "excellent"[0]';

    expect(errorsFor(entry())).toEqual([]);
    expect(errorsFor(entry({ weight: 1.5 }))).toEqual([`${where}: "weight" must be a number in [0, 1]`]);
    const { confidence, ...noConfidence } = entry();
    expect(confidence).toBe('medium');
    expect(errorsFor(noConfidence)).toEqual([`${where}: "confidence" must be one of high|medium|low`]);
    expect(errorsFor(entry({ status: 'retro' }))).toEqual([
      `${where}: "status" must be one of current|fading|dated|ironic`,
    ]);
    expect(errorsFor(entry({ confidence: 'low', needsReview: false }))).toEqual([
      `${where}: low confidence requires "needsReview": true`,
    ]);
    expect(errorsFor(entry({ sources: [{ url: 'ftp://x', retrieved: '2026-13-01' }] }))).toEqual([
      `${where}: sources[0].url must start with https:// or http://`,
      `${where}: sources[0].retrieved must be a YYYY-MM-DD date`,
    ]);
    expect(errorsFor(entry({ labels: ['slang', 'dated'] }))).toEqual([]);
    expect(errorsFor(entry({ labels: 'slang' }))).toEqual([`${where}: "labels" must be an array of non-empty strings`]);
    expect(errorsFor(entry({ labels: ['slang', 3] }))).toEqual([`${where}: "labels" must be an array of non-empty strings`]);
    expect(errorsFor(entry({ needsReview: 'yes', notes: 3 }))).toEqual([
      `${where}: "notes" must be a string`,
      `${where}: "needsReview" must be a boolean`,
    ]);
  });

  it('rejects bad laugh tokens', () => {
    const good = LAUGH_TOKENS[0];
    expect(validateLaughTokens([good])).toEqual([]);
    expect(validateLaughTokens([{ ...good, pattern: '(', word: 'yes' }])).toEqual([
      'laughTokens[0]: "word" must be a boolean',
      'laughTokens[0]: "pattern" is not a valid regular expression',
    ]);
  });
});

describe('concept-mismatch entries', () => {
  it('are capped at weight 0.3 and flagged for review (they lose to any better-weighted fit)', () => {
    const mismatched = Object.values(DICTIONARIES).flatMap((/** @type {any} */ g) =>
      Object.values(g.lexicon).flat().filter((/** @type {any} */ e) => e.notes.startsWith('Concept mismatch:')));
    expect(mismatched.length).toBeGreaterThan(0);
    for (const e of mismatched) {
      expect(e.weight).toBeLessThanOrEqual(0.3);
      expect(e.needsReview).toBe(true);
    }
  });
});

describe('Plain English', () => {
  it('is built from every concept plain word with baseline metadata and no years', () => {
    const plain = DICTIONARIES.plain;
    expect(plain.label).toBe('Plain English');
    expect(plain.years).toBeUndefined();
    expect(plain.signoff).toBeUndefined();
    expect(plain.style).toBeUndefined();
    expect(Object.keys(plain.lexicon)).toEqual(Object.keys(CONCEPTS));
    for (const [id, [e]] of Object.entries(plain.lexicon)) {
      expect(e).toEqual({
        text: CONCEPTS[id].plain,
        standalone: true,
        weight: 1,
        confidence: 'high',
        status: 'current',
        sources: [],
        notes: 'plain English baseline',
        needsReview: false,
      });
    }
    expect(Object.values(plain.laughter).map((e) => e.text)).toEqual(['(laughing)', 'haha', '(laughing hard)']);
  });

  it('allows a missing years range, and every generation ships one', () => {
    const { years, ...noYears } = DICTIONARIES.genz;
    expect(validateDictionary(noYears, CONCEPTS)).toEqual([]);
    expect(GENERATION_IDS.every((id) => typeof DICTIONARIES[id].years === 'string')).toBe(true);
  });
});

describe('output slots', () => {
  it('never spell an emoji name: no laughter output or lexicon text contains "emoji"', () => {
    for (const id of LANGUAGE_IDS) {
      const dict = DICTIONARIES[id];
      const outputs = [...Object.values(dict.laughter), ...Object.values(dict.lexicon).flat()];
      for (const e of outputs) expect(/\bemoji\b/i.test(e.text), `${id} "${e.text}"`).toBe(false);
    }
  });
});
