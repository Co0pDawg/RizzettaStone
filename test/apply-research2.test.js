import { describe, expect, it } from 'vitest';
import { applyUpdate } from '../scripts/apply-research2.mjs';

const entry = (over = {}) => ({
  text: 'swell',
  standalone: false,
  weight: 0.5,
  confidence: 'low',
  status: 'dated',
  sources: [{ url: 'https://a.example/swell', retrieved: '2026-10-19' }],
  notes: 'Earlier note.',
  needsReview: true,
  ...over,
});

const update = (over = {}) => ({
  new: { confidence: 'medium', status: 'dated', weight: 0.6, needsReview: false },
  labels: ['Internet slang', 'dated', 'texting'],
  sourcesAdd: [
    { url: 'https://a.example/swell', retrieved: '2026-10-19' },
    { url: 'https://en.wiktionary.org/api/rest_v1/page/definition/swell', retrieved: '2026-10-19' },
  ],
  notes: 'Labelled slang and dated.',
  ...over,
});

describe('apply research2', () => {
  it('applies metadata, dedupes sources, appends notes, and normalizes labels, idempotently', () => {
    const e = entry();
    applyUpdate(e, update());
    const once = structuredClone(e);
    expect(e).toMatchObject({ weight: 0.6, confidence: 'medium', status: 'dated', needsReview: false });
    expect(e.sources.map((s) => s.url)).toEqual([
      'https://a.example/swell',
      'https://en.wiktionary.org/api/rest_v1/page/definition/swell',
    ]);
    expect(e.notes).toBe('Earlier note. Wiktionary re-vet: Labelled slang and dated.');
    expect(e.labels).toEqual(['Internet', 'dated', 'slang', 'text messaging']);
    applyUpdate(e, update());
    expect(e).toEqual(once);
  });

  it('keeps needsReview for low confidence and for earlier forced reviews', () => {
    const low = entry();
    applyUpdate(low, update({ new: { confidence: 'low', status: 'current', weight: 0.5, needsReview: false } }));
    expect(low.needsReview).toBe(true);
    const mismatch = entry({ conceptMismatch: true });
    applyUpdate(mismatch, update());
    expect(mismatch.needsReview).toBe(true);
    const removal = entry({ notes: 'Research recommends removal (action "remove"); kept because confidence is low.' });
    applyUpdate(removal, update());
    expect(removal.needsReview).toBe(true);
  });
});
