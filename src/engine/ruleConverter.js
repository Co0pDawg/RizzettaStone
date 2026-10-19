import { CONCEPTS, DICTIONARIES, GENERATION_IDS, LAUGH_TOKENS, entryText, pickPrimary } from './dictionaries.js';
import {
  applyCase,
  isClauseEnd,
  isSentenceStart,
  isStandalone,
  isWordChar,
  joinsWordAfter,
  joinsWordBefore,
  normalizeForMatch,
} from './tokenize.js';

/**
 * @typedef {import('./dictionaries.js').GenerationDictionary} GenerationDictionary
 * @typedef {import('./dictionaries.js').Concepts} Concepts
 * @typedef {import('./dictionaries.js').LaughToken} LaughTokenData
 * @typedef {import('./index.js').Change} Change
 * @typedef {import('./index.js').ConvertResult} ConvertResult
 * @typedef {{ start: number, end: number, intense: boolean }} LaughToken
 * @typedef {{ start: number, end: number, tokens: LaughToken[] }} LaughEvent
 * @typedef {'trailing' | 'mid' | 'intense'} LaughClass
 * @typedef {{ start: number, end: number, text: string, from: string, kind: Change['kind'] }} Replacement
 */

/** Pseudo-generation for concepts.json `plain` words in the decode table. */
const PLAIN = '(plain)';

// Word edges: no word character next to the match, and no hyphen or dot that
// joins it to one ("mid-century", "lol-worthy", "lol.com" are single words).
const BEFORE = '(?<![\\p{L}\\p{N}_])(?<![\\p{L}\\p{N}_][-.])';
const AFTER = '(?![\\p{L}\\p{N}_])(?![-.][\\p{L}\\p{N}_])';

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap a pattern source with word-boundary guards on whichever edges are
 * letters or digits, and compile it as a sticky, case-insensitive regex.
 * @param {string} source
 * @param {string} firstChar representative first character of a match
 * @param {string} lastChar representative last character of a match
 * @returns {RegExp}
 */
function bounded(source, firstChar, lastChar) {
  const pre = isWordChar(firstChar) ? BEFORE : '';
  const post = isWordChar(lastChar) ? AFTER : '';
  return new RegExp(`${pre}(?:${source})${post}`, 'iuy');
}

/**
 * Per-UTF-16-unit lower-casing, so indexes stay aligned with the input.
 * @param {string} text
 * @returns {string}
 */
function lowerAligned(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const lower = text[i].toLowerCase();
    out += lower.length === 1 ? lower : text[i];
  }
  return out;
}

/**
 * Build the rule-based converter.
 * @param {{
 *   dictionaries?: Record<string, GenerationDictionary>,
 *   concepts?: Concepts,
 *   laughTokens?: LaughTokenData[],
 * }} [options]
 * @returns {import('./index.js').Converter}
 */
export function createRuleConverter(options = {}) {
  const dictionaries = options.dictionaries ?? DICTIONARIES;
  const concepts = options.concepts ?? CONCEPTS;
  const laughTokens = options.laughTokens ?? LAUGH_TOKENS;
  const genIds = GENERATION_IDS.filter((id) => dictionaries[id]).concat(
    Object.keys(dictionaries).filter((id) => !GENERATION_IDS.includes(id)),
  );

  // Laugh matchers: the laugh tokens from laughTokens.json plus every
  // generation's laughter output, so converted text is recognized again.
  // `word` tokens get word-boundary guards; emoji tokens do not.
  /** @type {{ re: RegExp, intense: (m: string) => boolean, standalone: boolean }[]} */
  const laughMatchers = laughTokens.map((token) => ({
    re: bounded(token.pattern, token.word ? 'a' : '', token.word ? 'a' : ''),
    // intenseMinBeats: "hahaha" (3+ "a" beats) is intense, "haha" is not.
    intense: (/** @type {string} */ m) =>
      token.intense || (token.intenseMinBeats !== undefined && m.replace(/[^a]/gi, '').length >= token.intenseMinBeats),
    standalone: token.standalone,
  }));
  /** @type {Map<string, boolean>} literal laugh text -> intense */
  const literalLaughs = new Map();
  /** @type {Map<string, string>} lower-cased literal -> dictionary spelling, for case copying */
  const literalSpelling = new Map();
  for (const id of genIds) {
    for (const slot of /** @type {LaughClass[]} */ (['trailing', 'mid', 'intense'])) {
      const text = normalizeForMatch(dictionaries[id].laughter[slot].text);
      if (!text) continue;
      literalLaughs.set(text, (literalLaughs.get(text) ?? false) || slot === 'intense');
      literalSpelling.set(text.toLowerCase(), text);
    }
  }
  for (const [text, intense] of literalLaughs) {
    laughMatchers.push({
      re: bounded(escapeRegExp(text), text[0], text[text.length - 1]),
      intense: () => intense,
      standalone: false,
    });
  }

  // Lexicon entries from every generation, bucketed by lower-cased first char.
  /** @type {Map<string, { norm: string, stored: string, concept: string, gen: string, standalone: boolean }[]>} */
  const buckets = new Map();
  /** @type {Record<string, Record<string, Set<string>>>} */
  const ownNorms = {};
  /** @type {Record<string, Record<string, string>>} generation -> concept -> encoded text */
  const primaries = {};
  for (const gen of genIds) {
    ownNorms[gen] = {};
    primaries[gen] = {};
    for (const [concept, entries] of Object.entries(dictionaries[gen].lexicon)) {
      ownNorms[gen][concept] = new Set();
      primaries[gen][concept] = pickPrimary(entries).text;
      for (const entry of entries) {
        const stored = normalizeForMatch(entryText(entry));
        const norm = stored.toLowerCase();
        ownNorms[gen][concept].add(norm);
        const item = {
          norm,
          stored,
          concept,
          gen,
          standalone: entry.standalone === true,
        };
        const key = norm[0];
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
      }
    }
  }
  // A concept's plain word decodes too, but only standalone ("okay!", "Seriously?"),
  // so the plain fallback round-trips. Slang with the same spelling wins.
  for (const [concept, { plain }] of Object.entries(concepts)) {
    const stored = normalizeForMatch(plain);
    const norm = stored.toLowerCase();
    if (!norm) continue;
    const key = norm[0];
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ norm, stored, concept, gen: PLAIN, standalone: true });
  }
  for (const list of buckets.values()) list.sort((a, b) => b.norm.length - a.norm.length);

  /**
   * Find every laugh token. Unconditional shapes go first; standalone-only
   * shapes (HELP, I'm dead) are then accepted only when they form a clause.
   * @param {string} norm
   * @returns {LaughToken[]}
   */
  function findLaughTokens(norm) {
    /** @type {LaughToken[]} */
    const existing = [];
    const scan = (/** @type {boolean} */ conditional) => {
      const taken = (/** @type {number} */ i) => existing.some((t) => i >= t.start && i < t.end);
      let i = 0;
      while (i < norm.length) {
        if (taken(i)) {
          i += 1;
          continue;
        }
        let best = null;
        for (const m of laughMatchers) {
          if (m.standalone !== conditional) continue;
          m.re.lastIndex = i;
          const match = m.re.exec(norm);
          if (!match || match[0].length === 0) continue;
          const end = i + match[0].length;
          if (existing.some((t) => t.start < end && t.end > i)) continue;
          if (conditional) {
            const edges = {
              starts: new Set(existing.map((t) => t.start)),
              ends: new Set(existing.map((t) => t.end)),
            };
            if (!isStandalone(norm, i, end, edges)) continue;
          }
          if (!best || end > best.end) best = { start: i, end, intense: m.intense(match[0]) };
        }
        if (best) {
          existing.push(best);
          i = best.end;
        } else {
          i += 1;
        }
      }
    };
    scan(false);
    scan(true);
    return existing.sort((a, b) => a.start - b.start);
  }

  /**
   * Collapse adjacent laugh tokens (only spaces/tabs between) into events.
   * @param {string} text
   * @param {LaughToken[]} tokens
   * @returns {LaughEvent[]}
   */
  function groupLaughs(text, tokens) {
    /** @type {LaughEvent[]} */
    const events = [];
    for (const token of tokens) {
      const last = events[events.length - 1];
      if (last && /^[ \t]*$/.test(text.slice(last.end, token.start))) {
        last.end = token.end;
        last.tokens.push(token);
      } else {
        events.push({ start: token.start, end: token.end, tokens: [token] });
      }
    }
    return events;
  }

  /**
   * Classify a laugh event by intensity, then position.
   * @param {string} text
   * @param {LaughEvent} event
   * @returns {LaughClass}
   */
  function classifyLaugh(text, event) {
    if (event.tokens.length > 1 || event.tokens.some((t) => t.intense)) return 'intense';
    const atStart = isSentenceStart(text, event.start);
    const atEnd = isClauseEnd(text, event.end);
    // Last thing in its clause softens tone; a sentence opener, an interjection
    // mid-sentence, or a laugh that is its whole sentence reads as a real laugh.
    return atEnd && !atStart ? 'trailing' : 'mid';
  }

  /**
   * Find slang: whole-word, case-insensitive, longest match first; ties go to
   * the source generation, then generation order, then standalone plain words.
   * @param {string} text original text
   * @param {string} lower lower-cased, apostrophe-normalized text
   * @param {string} from source generation id
   * @param {LaughToken[]} laughs
   */
  function findLexicon(text, lower, from, laughs) {
    const edges = { starts: new Set(laughs.map((t) => t.start)), ends: new Set(laughs.map((t) => t.end)) };
    const rank = (/** @type {string} */ gen) => (gen === from ? -1 : gen === PLAIN ? genIds.length : genIds.indexOf(gen));
    const matches = [];
    let i = 0;
    while (i < lower.length) {
      const candidates = buckets.get(lower[i]);
      if (!candidates || (isWordChar(lower[i]) && joinsWordBefore(lower, i))) {
        i += 1;
        continue;
      }
      let best = null;
      for (const c of candidates) {
        if (best && c.norm.length < best.norm.length) break;
        const end = i + c.norm.length;
        if (lower.slice(i, end) !== c.norm) continue;
        if (isWordChar(c.norm[c.norm.length - 1]) && joinsWordAfter(lower, end)) continue;
        if (laughs.some((t) => t.start < end && t.end > i)) continue;
        if (c.standalone && !isStandalone(text, i, end, edges)) continue;
        if (!best || rank(c.gen) < rank(best.gen)) best = c;
      }
      if (best) {
        matches.push({ start: i, end: i + best.norm.length, entry: best });
        i += best.norm.length;
      } else {
        i += 1;
      }
    }
    return matches;
  }

  /**
   * Splice replacements into the text. An empty replacement removes the span
   * plus the horizontal space it would leave doubled.
   * @param {string} text
   * @param {Replacement[]} reps sorted, non-overlapping
   * @returns {string}
   */
  function splice(text, reps) {
    let out = '';
    let cursor = 0;
    for (const rep of reps) {
      let start = rep.start;
      let end = rep.end;
      if (rep.text === '') {
        let ls = start;
        while (ls > cursor && /[ \t]/.test(text[ls - 1])) ls -= 1;
        const atLineStart = ls === 0 || text[ls - 1] === '\n';
        if (!atLineStart) start = ls;
        else while (end < text.length && /[ \t]/.test(text[end])) end += 1;
      }
      out += text.slice(cursor, start) + rep.text;
      cursor = end;
    }
    return out + text.slice(cursor);
  }

  /**
   * Target style flourishes. Each is idempotent so it never applies twice.
   * @param {string} text
   * @param {GenerationDictionary} target
   * @param {Change[]} changes
   * @returns {string}
   */
  function applyStyle(text, target, changes) {
    if (!text.trim()) return text;
    let out = text;
    if (target.style?.terse) {
      // Gen X: an exclamation run that ends a sentence becomes a flat period.
      const next = out.replace(/(?<=[^\s!?])!+(?=[\s)"'’]|$)/gu, '.');
      if (next !== out) changes.push({ from: '!', to: '.', kind: 'style' });
      out = next;
    }
    if (target.style?.ellipsis) {
      // Boomer: a lone sentence-final period trails off. Skips "...", "3.5", "a.com".
      const next = out.replace(/(?<![.\d])\.(?![.\p{L}\p{N}])/gu, '...');
      if (next !== out) changes.push({ from: '.', to: '...', kind: 'style' });
      out = next;
    }
    // "Love, Mom." / "love, mom" / "Love, Mom ❤️" (or "Love, Mom..." after the
    // ellipsis step) is already signed off: compare case-insensitively, ignoring
    // trailing punctuation and emoji.
    const signedOff = (/** @type {string} */ s) =>
      s.replace(/[\s.!?…\p{Extended_Pictographic}\uFE0F\u200D]+$/u, '').toLowerCase();
    if (target.signoff && !signedOff(out).endsWith(signedOff(target.signoff))) {
      out = `${out.trimEnd()}\n${target.signoff}`;
      changes.push({ from: '', to: target.signoff, kind: 'style' });
    }
    return out;
  }

  /**
   * @param {string} text
   * @param {{ from: string, to: string }} opts
   * @returns {ConvertResult}
   */
  function convertSync(text, { from, to }) {
    for (const id of [from, to]) {
      if (!dictionaries[id]) throw new Error(`Unknown generation "${id}"`);
    }
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (from === to) return { text, changes: [] };

    const target = dictionaries[to];
    const norm = normalizeForMatch(text);
    const lower = lowerAligned(norm);
    /** @type {Replacement[]} */
    const reps = [];

    const laughTokens = findLaughTokens(norm);
    for (const event of groupLaughs(text, laughTokens)) {
      const cls = classifyLaugh(text, event);
      const original = text.slice(event.start, event.end);
      const spelling = literalSpelling.get(normalizeForMatch(original).toLowerCase()) ?? original.toLowerCase();
      let out = applyCase(normalizeForMatch(original), spelling, target.laughter[cls].text);
      // Punctuation baked into a laugh ("Ha ha!") stays with the sentence, and a
      // punctuated replacement does not double up with punctuation that follows.
      const tail = original.match(/[.!?]+$/)?.[0] ?? '';
      if (out && tail && !/[.!?]$/.test(out)) out += tail;
      if (/[.!?]$/.test(out) && /^[.!?]/.test(text.slice(event.end))) out = out.replace(/[.!?]+$/, '');
      if (out !== original) reps.push({ start: event.start, end: event.end, text: out, from: original, kind: 'laugh' });
    }

    for (const m of findLexicon(text, lower, from, laughTokens)) {
      const original = text.slice(m.start, m.end);
      const { concept } = m.entry;
      // A phrase the target generation already uses for this concept is kept.
      if (ownNorms[to][concept]?.has(m.entry.norm)) continue;
      // Encode: the target's highest-weight entry (ties: array order), else plain.
      const replacement = primaries[to][concept] ?? concepts[concept].plain;
      const out = applyCase(original, m.entry.stored, replacement);
      if (out !== original) reps.push({ start: m.start, end: m.end, text: out, from: original, kind: 'lexicon' });
    }

    reps.sort((a, b) => a.start - b.start);
    /** @type {Change[]} */
    const changes = reps.map((r) => ({ from: r.from, to: r.text, kind: r.kind }));
    const spliced = splice(text, reps);
    return { text: applyStyle(spliced, target, changes), changes };
  }

  return {
    mode: 'rules',
    async convert(text, opts) {
      return convertSync(text, opts);
    },
  };
}
