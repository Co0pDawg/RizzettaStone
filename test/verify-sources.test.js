import { describe, expect, it } from 'vitest';
import {
  diffLabels,
  extractLabels,
  extractWikitextLabels,
  lookupTerms,
  normalizeLabels,
} from '../scripts/verify-sources.mjs';

// Synthetic fixtures shaped like Wiktionary responses. Hand-written
// placeholder text; nothing here is copied from Wiktionary.
const restFixture = {
  en: [
    {
      partOfSpeech: 'Adjective',
      language: 'English',
      definitions: [
        {
          definition:
            '<span class="usage-label-sense"><span class="ib-brac">(</span><span class="ib-content"><a href="/wiki/Appendix:Glossary#slang">slang</a><span class="ib-comma">,</span> <a href="/wiki/Appendix:Glossary#dated">dated</a></span><span class="ib-brac">)</span></span> Placeholder sense one.',
        },
        { definition: '(Internet slang) Placeholder sense two.' },
        { definition: '<span class="usage-label-sense" typeof="mw:Transclusion"></span> Placeholder sense three.' },
        { definition: '(music) Placeholder sense four, a topical label we ignore.' },
      ],
    },
  ],
  fr: [{ partOfSpeech: 'Noun', language: 'French', definitions: [{ definition: '(archaic) Not English.' }] }],
};

const wikitextFixture = [
  '==English==',
  '===Adjective===',
  '# {{lb|en|now|outdated|_|or|humorous}} Placeholder sense.',
  '#: {{lb|en|obsolete}} a usage example line, ignored',
  '# {{lb|en|US|slang|sort=x}} Another placeholder.',
  '# {{archaic|en}} Legacy template sense.',
  '----',
  '==French==',
  '# {{lb|fr|vulgar}} Not English.',
].join('\n');

describe('verify-sources label extraction', () => {
  it('reads usage labels from REST label spans and leading qualifiers, English only', () => {
    expect(extractLabels(restFixture)).toEqual(['Internet', 'dated', 'slang']);
    expect(extractLabels({})).toEqual([]);
    expect(extractLabels({ en: [{ definitions: [{ definition: 'No labels here.' }] }] })).toEqual([]);
  });

  it('reads {{lb|en|…}} and legacy templates from English definition lines only', () => {
    expect(extractWikitextLabels(wikitextFixture)).toEqual(['US', 'archaic', 'dated', 'humorous', 'slang']);
    expect(extractWikitextLabels('==French==\n# {{lb|en|slang}} x')).toEqual([]);
  });

  it('normalizes aliases and drops non-usage labels', () => {
    expect(normalizeLabels(['Internet slang', 'old-fashioned', 'colloquial', 'transitive', 'SLANG'])).toEqual([
      'Internet',
      'colloquial',
      'dated',
      'slang',
    ]);
  });

  it('picks lookup terms from entry text', () => {
    expect(lookupTerms('haha / hahaha / ha ha')).toEqual(['haha', 'hahaha', 'ha ha']);
    expect(lookupTerms('ha. good one.')).toEqual([]);
    expect(lookupTerms("it's giving")).toEqual(["it's giving"]);
    expect(lookupTerms('💀')).toEqual([]);
    expect(lookupTerms('6-7')).toEqual([]);
    expect(lookupTerms('')).toEqual([]);
  });
});

describe('verify-sources label diff', () => {
  it('reports added and removed labels and flags new ageing labels on current entries', () => {
    expect(diffLabels(['slang'], ['dated', 'slang'], 'current')).toEqual({
      added: ['dated'],
      removed: [],
      newlyAgeing: true,
    });
    expect(diffLabels(['Internet', 'slang'], ['slang'], 'current')).toEqual({
      added: [],
      removed: ['Internet'],
      newlyAgeing: false,
    });
    expect(diffLabels(['slang'], ['obsolete', 'slang'], 'dated').newlyAgeing).toBe(false);
    expect(diffLabels(['dated'], ['dated'], 'current')).toEqual({ added: [], removed: [], newlyAgeing: false });
    expect(diffLabels(undefined, ['archaic'], 'current')).toEqual({ added: ['archaic'], removed: [], newlyAgeing: true });
  });
});
