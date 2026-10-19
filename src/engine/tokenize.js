/**
 * Low-level text helpers shared by the laugh and lexicon passes.
 * All positions are UTF-16 indexes into the original text.
 */

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
/** Characters that end a clause: sentence punctuation, commas, and friends. */
const CLAUSE_BEFORE = /[.!?,;:\n…(]/;
const CLAUSE_AFTER = /[.!?,;:\n…)]/;
/** Characters that end a sentence. */
const SENTENCE_END = /[.!?\n…]/;
const HSPACE = /[ \t]/;

/**
 * Same-length copy of `text` with curly apostrophes straightened, so matching
 * works on "it’s" and "it's" alike while indexes stay aligned.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForMatch(text) {
  return text.replace(/[’‘]/g, "'");
}

/**
 * @param {string} ch
 * @returns {boolean}
 */
export function isWordChar(ch) {
  return ch !== undefined && ch !== '' && WORD_CHAR.test(ch);
}

/** Characters that join two word characters into one word ("mid-century", "lol.com"). */
const JOINER = /[-.]/;

/**
 * True when a span starting at `i` would continue a word to its left: a word
 * character right before it, or a hyphen/dot that itself follows one.
 * @param {string} text
 * @param {number} i
 * @returns {boolean}
 */
export function joinsWordBefore(text, i) {
  return isWordChar(text[i - 1]) || (JOINER.test(text[i - 1] ?? '') && isWordChar(text[i - 2]));
}

/**
 * True when a span ending at `end` would continue into a word on its right: a
 * word character right after it, or a hyphen/dot followed by one.
 * @param {string} text
 * @param {number} end
 * @returns {boolean}
 */
export function joinsWordAfter(text, end) {
  return isWordChar(text[end]) || (JOINER.test(text[end] ?? '') && isWordChar(text[end + 1]));
}

/**
 * Whole code point that ends just before index `i` (handles surrogate pairs and
 * skips a trailing emoji variation selector).
 * @param {string} text
 * @param {number} i
 * @returns {string}
 */
function codePointBefore(text, i) {
  let end = i;
  if (text[end - 1] === '️') end -= 1;
  const low = text.charCodeAt(end - 1);
  if (low >= 0xdc00 && low <= 0xdfff && end >= 2) return text.slice(end - 2, end);
  return text.slice(end - 1, end);
}

/**
 * @param {string} text
 * @param {number} i
 * @returns {string}
 */
function codePointAt(text, i) {
  const cp = text.codePointAt(i);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/**
 * @param {string} text
 * @param {number} i index of the first character to inspect, going left
 * @returns {number} index of the first non-horizontal-space char at or before i, or -1
 */
function skipSpaceBack(text, i) {
  let j = i;
  while (j >= 0 && HSPACE.test(text[j])) j -= 1;
  return j;
}

/**
 * @param {string} text
 * @param {number} i
 * @returns {number} index of the first non-horizontal-space char at or after i
 */
function skipSpaceForward(text, i) {
  let j = i;
  while (j < text.length && HSPACE.test(text[j])) j += 1;
  return j;
}

/**
 * True when text[start, end) forms its own clause: it sits between clause
 * boundaries (punctuation, newline, message edges), emoji, or laugh tokens.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {{ starts: Set<number>, ends: Set<number> }} [laughEdges]
 * @returns {boolean}
 */
export function isStandalone(text, start, end, laughEdges) {
  const b = skipSpaceBack(text, start - 1);
  const beforeOk =
    b < 0 ||
    CLAUSE_BEFORE.test(text[b]) ||
    EMOJI.test(codePointBefore(text, b + 1)) ||
    (laughEdges !== undefined && laughEdges.ends.has(b + 1));
  if (!beforeOk) return false;
  const a = skipSpaceForward(text, end);
  return (
    a >= text.length ||
    CLAUSE_AFTER.test(text[a]) ||
    EMOJI.test(codePointAt(text, a)) ||
    (laughEdges !== undefined && laughEdges.starts.has(a))
  );
}

/**
 * True when nothing but horizontal space separates `start` from the start of
 * the message, a newline, or sentence-ending punctuation.
 * @param {string} text
 * @param {number} start
 * @returns {boolean}
 */
export function isSentenceStart(text, start) {
  const b = skipSpaceBack(text, start - 1);
  return b < 0 || SENTENCE_END.test(text[b]);
}

/**
 * True when the span ending at `end` is the last thing in its clause: only
 * horizontal space before the message end, a newline, or clause punctuation.
 * @param {string} text
 * @param {number} end
 * @returns {boolean}
 */
export function isClauseEnd(text, end) {
  const a = skipSpaceForward(text, end);
  return a >= text.length || CLAUSE_AFTER.test(text[a]);
}

/**
 * Copy the case pattern of `original` onto `replacement`.
 * - original identical to its dictionary spelling → replacement as written
 * - ALL CAPS (2+ letters) → ALL CAPS
 * - Capitalized → first letter capitalized
 * - otherwise (lower or mixed) → replacement as written in its dictionary
 * Text without letters (emoji, "100%") is returned unchanged.
 * @param {string} original matched input text
 * @param {string} stored dictionary spelling of the matched expression
 * @param {string} replacement
 * @returns {string}
 */
export function applyCase(original, stored, replacement) {
  if (original === stored) return replacement;
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (!letters) return replacement;
  const upper = letters.toUpperCase();
  const lower = letters.toLowerCase();
  if (letters.length >= 2 && letters === upper && letters !== lower) return replacement.toUpperCase();
  const first = letters[0];
  const rest = letters.slice(1);
  if (first !== first.toLowerCase() && rest === rest.toLowerCase()) {
    return replacement.replace(/\p{L}/u, (ch) => ch.toUpperCase());
  }
  return replacement;
}
