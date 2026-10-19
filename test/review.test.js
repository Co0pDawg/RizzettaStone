import { describe, expect, it } from 'vitest';
import { collectRows, sortRows, toCsv } from '../scripts/review.mjs';

/** @param {Partial<import('../scripts/review.mjs').ReviewRow>} over */
const r = (over) => ({
  generation: 'genz',
  kind: 'lexicon',
  concept: 'cool',
  text: 'x',
  weight: 0.5,
  confidence: 'medium',
  status: 'current',
  needsReview: false,
  labels: [],
  sources: [],
  notes: '',
  ...over,
});

describe('review artifact', () => {
  it('sorts needsReview first, then confidence low to high, weight, generation, concept, text', () => {
    const rows = [
      r({ text: 'high-ok', confidence: 'high' }),
      r({ text: 'med-ok-0.9', weight: 0.9 }),
      r({ text: 'med-ok-0.2', weight: 0.2 }),
      r({ text: 'shared-tie', generation: 'shared' }),
      r({ text: 'med-review', needsReview: true }),
      r({ text: 'b', concept: 'agree' }),
      r({ text: 'low-review', confidence: 'low', needsReview: true }),
      r({ text: 'boomer-tie', generation: 'boomer' }),
      r({ text: 'a', concept: 'agree' }),
    ];
    expect(sortRows(rows).map((x) => x.text)).toEqual([
      'low-review',
      'med-review',
      'med-ok-0.2',
      'boomer-tie',
      'a',
      'b',
      'shared-tie',
      'med-ok-0.9',
      'high-ok',
    ]);
  });

  it('writes RFC 4180 CSV with quoted commas, quotes, labels, and space-separated sources', () => {
    const csv = toCsv([
      r({
        text: 'say "less"',
        notes: 'one, two',
        labels: ['Internet', 'text messaging'],
        sources: ['https://a.example/x', 'https://b.example/y'],
      }),
    ]);
    expect(csv).toBe(
      '"generation","kind","concept","text","weight","confidence","status","needsReview","labels","sources","notes"\r\n' +
        '"genz","lexicon","cool","say ""less""","0.5","medium","current","false","Internet; text messaging","https://a.example/x https://b.example/y","one, two"\r\n',
    );
  });

  it('includes stored labels in the rows', () => {
    const swell = collectRows().find((x) => x.generation === 'boomer' && x.text === 'swell');
    expect(swell?.labels).toEqual(expect.arrayContaining(['dated']));
  });

  it('covers lexicon, laughter, laugh tokens, and style markers', () => {
    const kinds = new Set(collectRows().map((x) => x.kind));
    expect([...kinds].sort()).toEqual(['laughToken', 'laughter', 'lexicon', 'style']);
  });
});
