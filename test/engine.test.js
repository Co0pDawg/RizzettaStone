import { describe, expect, it } from 'vitest';
import { createConverter, GENERATION_IDS, LANGUAGE_IDS, DICTIONARIES } from '../src/engine/index.js';
import { entryText, CONCEPTS } from '../src/engine/dictionaries.js';
import { SEED_SAMPLES, sampleFor } from '../src/samples.js';

const rules = createConverter({ mode: 'rules' });
const convert = async (text, from, to) => (await rules.convert(text, { from, to })).text;

/** Whole-word, case-insensitive presence check. */
function containsPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

describe('laughter classification', () => {
  it('trailing and mid-sentence lol differ for Gen Z', async () => {
    expect(await convert("that's so funny lol", 'millennial', 'genz')).toBe("that's so funny 💀");
    expect(await convert('lol what happened', 'millennial', 'genz')).toBe('😭 what happened');
  });

  it('uses commas and sentence boundaries for position', async () => {
    expect(await convert('so funny lol, anyway', 'millennial', 'genz')).toBe('so funny 💀, anyway');
    expect(await convert('wait. lol what? why', 'millennial', 'genz')).toBe('wait. 😭 what? why');
    expect(await convert('that is so funny lol\nlol who said that', 'millennial', 'genz')).toBe(
      'that is so funny 💀\n😭 who said that',
    );
  });

  it('treats lmao and repeated laughs as intense', async () => {
    expect(await convert("that's wild lmao", 'millennial', 'genz')).toBe("that's wild HELPPP 😭😭");
    expect(await convert('stop lol lol', 'millennial', 'genz')).toBe('stop HELPPP 😭😭');
    expect(await convert('he fell 💀💀', 'genz', 'millennial')).toBe('he fell lmao 😂');
  });

  it('drops a trailing laugh for Gen X and tidies the space', async () => {
    expect(await convert("that's wild lol.", 'millennial', 'genx')).toBe("that's wild.");
    expect(await convert('so funny lol, anyway', 'millennial', 'genx')).toBe('so funny, anyway');
  });

  it('only counts HELP as a laugh when standalone', async () => {
    expect(await convert('HELPPP 😭', 'genz', 'millennial')).toBe('LMAO 😂');
    expect(await convert('please help me move', 'genz', 'millennial')).toBe('please help me move');
  });

  it('counts dying, I\'m dying, and ded as laughs only when standalone', async () => {
    expect(await convert("I'm dying 💀", 'genz', 'millennial')).toBe('Lmao 😂');
    expect(await convert('that video, dying', 'genz', 'millennial')).toBe('that video, lol');
    expect(await convert('ded.', 'genz', 'millennial')).toBe('haha.');
    expect(await convert("so funny, i'm ded", 'genz', 'millennial')).toBe('so funny, lol');
    for (const text of ['my dying plants and a dead battery', 'the plant is dying.', "I'm dying my hair"]) {
      expect(await convert(text, 'genz', 'millennial')).toBe(text);
    }
  });
});

describe('matching', () => {
  it('never matches inside words', async () => {
    const text = 'I want a lollipop by the fireplace in the capital';
    for (const [from, to] of [['genz', 'millennial'], ['millennial', 'genz'], ['genz', 'genalpha']]) {
      expect(await convert(text, from, to)).toBe(text);
    }
  });

  it('preserves ALL CAPS and Capitalized case and untouched punctuation', async () => {
    expect(await convert('Dope party, TBH it was LIT!', 'millennial', 'genz')).toBe(
      'Valid party, NGL it was VALID!',
    );
    expect(await convert('Ngl (really), that slaps... right?', 'genz', 'millennial')).toBe(
      'Tbh (really), that on fleek... right?',
    );
  });

  it('treats hyphen and dot joins as part of a word', async () => {
    expect(await convert('a mid-century chair', 'genz', 'millennial')).toBe('a mid-century chair');
    expect(await convert('the lol-worthy part', 'millennial', 'genz')).toBe('the lol-worthy part');
    expect(await convert('visit lol.com today', 'millennial', 'genz')).toBe('visit lol.com today');
    expect(await convert('so mid - lol', 'genz', 'millennial')).toBe('so mediocre - lol');
    expect(await convert('that was mid. lol', 'genz', 'millennial')).toBe('that was mediocre. haha');
  });

  it('reads "cap" as a lie only when it stands alone', async () => {
    expect(await convert('I lost my cap', 'genz', 'millennial')).toBe('I lost my cap');
    expect(await convert('my cap is red', 'genz', 'boomer')).toBe('my cap is red\nLove, Mom');
    expect(await convert('cap.', 'genz', 'millennial')).toBe('trolling.');
  });

  it('decodes a standalone plain word, so Gen X says "k."', async () => {
    expect(await convert('okay!', 'millennial', 'genx')).toBe('k.');
    expect(await convert('kk', 'millennial', 'genx')).toBe('k');
    expect(await convert('it is okay with me', 'millennial', 'genx')).toBe('it is okay with me');
  });

  it('applies the standalone rule', async () => {
    expect(await convert('a real problem', 'genz', 'millennial')).toBe('a real problem');
    expect(await convert('real.', 'genz', 'millennial')).toBe('100%.');
    expect(await convert('Real, she said', 'genz', 'millennial')).toBe('100%, she said');
  });

  it('matches curly apostrophes like straight ones', async () => {
    expect(await convert('it’s giving drama', 'genz', 'boomer')).toBe('reminds me of hullabaloo\nLove, Mom');
  });
});

describe('every generation pair', () => {
  it('has a seed sample per generation and for Plain English', () => {
    expect(SEED_SAMPLES.map((s) => s.from).sort()).toEqual([...LANGUAGE_IDS].sort());
  });

  // All 30 ordered pairs, Plain English included: no pair leaves its seed unchanged.
  for (const from of LANGUAGE_IDS) {
    it(`converts the ${from} seed to every other option, all distinct`, async () => {
      const input = sampleFor(from);
      const outputs = [];
      for (const to of LANGUAGE_IDS.filter((g) => g !== from)) {
        const out = await convert(input, from, to);
        expect(out, `${from} -> ${to}`).not.toBe(input);
        outputs.push(out);
      }
      expect(new Set(outputs).size).toBe(LANGUAGE_IDS.length - 1);
    });
  }
});

describe('Plain English', () => {
  it('decodes Gen Z slang and laughs into plain words', async () => {
    const plain = await convert("no bc it's giving main character, real 💀", 'genz', 'plain');
    expect(plain).toBe('seriously it looks like the star of the show, agreed (laughing)');
    expect(plain).not.toContain('💀');
    for (const entries of Object.values(DICTIONARIES.genz.lexicon)) {
      for (const entry of entries) {
        expect(containsPhrase(plain, entryText(entry)), `leaked Gen Z "${entryText(entry)}"`).toBe(false);
      }
    }
  });

  it('writes laughs as words, never emoji or slang', async () => {
    expect(await convert("that's so funny lol", 'millennial', 'plain')).toBe("that's so funny (laughing)");
    expect(await convert('lol what happened', 'millennial', 'plain')).toBe('haha what happened');
    expect(await convert("that's wild lmao", 'millennial', 'plain')).toBe("that's wild (laughing hard)");
    expect(await convert('so funny 💀', 'genz', 'plain')).toBe('so funny (laughing)');
    expect(await convert('😭 what happened', 'genz', 'plain')).toBe('haha what happened');
    expect(await convert('so funny 😂', 'boomer', 'plain')).toBe('so funny (laughing)');
    expect(await convert('so funny 🤣', 'boomer', 'plain')).toBe('so funny (laughing hard)');
  });

  it('adds no style flourish or signoff', async () => {
    expect(await convert('that was dope. bye!', 'millennial', 'plain')).toBe('that was cool. bye!');
  });

  it('converts plain words mid-sentence when Plain English is the source', async () => {
    expect(await convert('that party was excellent, honestly', 'plain', 'genz')).toBe('that party was bussin, ngl');
    expect(await convert('my friend is okay with it', 'plain', 'millennial')).toBe('my bestie is kk with it');
  });

  it('keeps plain words standalone-only for any other source', async () => {
    expect(await convert('that party was excellent', 'genz', 'millennial')).toBe('that party was excellent');
    expect(await convert('my friend is okay with it', 'genx', 'millennial')).toBe('my friend is okay with it');
  });

  it('still decodes slang in Plain English input', async () => {
    expect(await convert('my friend was on fleek lol', 'plain', 'genz')).toBe('my twin was bussin 💀');
  });

  it('returns the input unchanged from Plain English to Plain English', async () => {
    const input = sampleFor('plain');
    expect(await rules.convert(input, { from: 'plain', to: 'plain' })).toEqual({ text: input, changes: [] });
  });
});

describe('emoji names', () => {
  // Laugh-heavy inputs on top of the seed samples. "skull emoji" is still read
  // as a laugh, but no output may spell an emoji name the input did not have.
  const LAUGHS = [
    'lol', 'lmao', '💀', '😭', '😂', 'haha', "I'm dead", 'HELPPP',
    "that's so funny lol", 'lol what happened', 'wait 💀 what', 'so funny 😭', 'ok 😂 sure',
    'haha we need to go', "no way. I'm dead.", 'HELPPP 😭😭', 'lol lol', 'skull emoji that is wild',
  ];
  const inputs = [...SEED_SAMPLES.map((s) => s.text), ...LAUGHS];

  it('never writes "emoji" unless the input had it, for every ordered pair', async () => {
    for (const from of LANGUAGE_IDS) {
      for (const to of LANGUAGE_IDS.filter((g) => g !== from)) {
        for (const input of inputs) {
          const out = await convert(input, from, to);
          if (!/\bemoji\b/i.test(input)) expect(/\bemoji\b/i.test(out), `${from} -> ${to}: ${input} => ${out}`).toBe(false);
        }
      }
    }
  });

  it('writes a mid-sentence laugh as 💀 in Gen Alpha', async () => {
    expect(await convert('lol what happened', 'millennial', 'genalpha')).toBe('💀 what happened');
    expect(await convert('skull emoji what happened', 'genalpha', 'genz')).toBe('😭 what happened');
  });
});

describe('decode and round trips', () => {
  it('Gen Z to Millennial removes Gen Z slang and round-trips exactly', async () => {
    const sample = "no bc it's giving main character, real 💀";
    const millennial = await convert(sample, 'genz', 'millennial');
    expect(millennial).toBe("literally it's very much living my best life, 100% lol");
    const millennialNorms = new Set(
      Object.values(DICTIONARIES.millennial.lexicon).flat().map((e) => entryText(e).toLowerCase()),
    );
    for (const entries of Object.values(DICTIONARIES.genz.lexicon)) {
      for (const entry of entries) {
        const phrase = entryText(entry);
        if (millennialNorms.has(phrase.toLowerCase())) continue;
        expect(containsPhrase(millennial, phrase), `leaked Gen Z "${phrase}"`).toBe(false);
      }
    }
    // Coming back, each concept is written as Gen Z's highest-weight entry
    // ("frfr" outweighs "no bc"), and that form round-trips exactly.
    const original = "frfr it's giving main character energy, real 💀";
    expect(await convert(millennial, 'millennial', 'genz')).toBe(original);
    expect(await convert(original, 'genz', 'millennial')).toBe(millennial);
  });

  it('Millennial to Gen Z round-trips exactly', async () => {
    const original = 'OMG haha that party was dope lol, tbh my bestie was literally on fleek';
    const genz = await convert(original, 'millennial', 'genz');
    expect(genz).toBe('sheesh 😭 that party was valid 💀, ngl my twin was frfr bussin');
    expect(await convert(genz, 'genz', 'millennial')).toBe(original);
  });

  it('Gen Alpha to Gen Z round-trips exactly', async () => {
    const original = 'ayo gng that edit was goated fr fr 💀';
    const genz = await convert(original, 'genalpha', 'genz');
    expect(await convert(genz, 'genz', 'genalpha')).toBe(original);
  });

  it('keeps a phrase the target generation already uses', async () => {
    // "honestly" is Millennial slang for the same concept, so it is not rewritten.
    expect(await convert('honestly ngl', 'genz', 'millennial')).toBe('honestly tbh');
  });
});

describe('style and identity', () => {
  it('returns the input unchanged when from === to', async () => {
    for (const gen of LANGUAGE_IDS) {
      const input = sampleFor(gen);
      expect(await rules.convert(input, { from: gen, to: gen })).toEqual({ text: input, changes: [] });
    }
  });

  it('adds the Boomer flourishes once', async () => {
    expect(await convert('that was dope. see you soon', 'millennial', 'boomer')).toBe(
      'that was groovy... see you soon\nLove, Mom',
    );
    const signed = await convert('that was dope.\nLove, Mom', 'millennial', 'boomer');
    expect(signed).toBe('that was groovy...\nLove, Mom');
    // A signoff with trailing punctuation still counts as signed.
    expect(await convert('Love, Mom.', 'millennial', 'boomer')).toBe('Love, Mom...');
    expect(await convert('see you!\nLove, Mom!', 'millennial', 'boomer')).toBe('see you!\nLove, Mom!');
    // Case, emoji, and a question mark do not hide an existing signoff.
    expect(await convert('see you\nlove, mom', 'millennial', 'boomer')).toBe('see you\nlove, mom');
    expect(await convert('see you\nLove, Mom ❤️', 'millennial', 'boomer')).toBe('see you\nLove, Mom ❤️');
    expect(await convert('see you\nLove, Mom?', 'millennial', 'boomer')).toBe('see you\nLove, Mom?');
    const viaGenX = await convert(await convert(sampleFor('boomer'), 'boomer', 'genx'), 'genx', 'boomer');
    expect(viaGenX.match(/Love, Mom/g)).toHaveLength(1);
    expect(viaGenX).not.toContain('......');
  });

  it('makes Gen X terse', async () => {
    expect(await convert('that was lit!!!', 'millennial', 'genx')).toBe('that was da bomb.');
  });

  it('reports changes by kind', async () => {
    const { changes } = await rules.convert('that was lit lol.', { from: 'millennial', to: 'boomer' });
    expect(changes).toEqual([
      { from: 'lit', to: 'groovy', kind: 'lexicon' },
      { from: 'lol', to: '👍', kind: 'laugh' },
      { from: '.', to: '...', kind: 'style' },
      { from: '', to: 'Love, Mom', kind: 'style' },
    ]);
  });

  it('is deterministic', async () => {
    for (const { from, text } of SEED_SAMPLES) {
      const first = await convert(text, from, 'genz');
      for (let i = 0; i < 5; i += 1) expect(await convert(text, from, 'genz')).toBe(first);
    }
  });

  it('rejects unknown generations', async () => {
    await expect(rules.convert('hi', { from: 'millennial', to: 'gen-omega' })).rejects.toThrow('Unknown generation');
  });
});

describe('weighted encoding', () => {
  it('writes the highest-weight entry, ties by array order', async () => {
    // Gen X "cool": da bomb (0.65) outweighs phat, which comes first in the array.
    expect(DICTIONARIES.genx.lexicon.cool[0].text).toBe('phat');
    expect(await convert('so lit', 'millennial', 'genx')).toBe('so da bomb');
    // Millennial "cool": dope and lit tie at 0.45, so array order picks dope.
    expect(await convert('so valid', 'genz', 'millennial')).toBe('so dope');
  });

  it('follows a raised weight in a cloned dictionary', async () => {
    const dictionaries = structuredClone(DICTIONARIES);
    const phat = dictionaries.genx.lexicon.cool.find((e) => e.text === 'phat');
    phat.weight = 0.99;
    const custom = createConverter({ mode: 'rules', dictionaries, concepts: CONCEPTS });
    expect((await custom.convert('so lit', { from: 'millennial', to: 'genx' })).text).toBe('so phat');
    expect(await convert('so lit', 'millennial', 'genx')).toBe('so da bomb');
  });

  it('writes restored concept-mismatch entries instead of the plain fallback', async () => {
    expect(DICTIONARIES.genalpha.lexicon.lying.map((e) => e.text)).toEqual(['sussy', 'being sus']);
    expect(await convert('he is capping', 'genz', 'genalpha')).toBe('he is sussy');
    expect(await convert('you slayed', 'genz', 'genalpha')).toBe('you mogged it');
  });

  it('still decodes low-weight entries', async () => {
    // "rizzy" (weight 0.1, kept for review) is never written but is still read.
    expect(await convert('that fit is rizzy', 'genalpha', 'millennial')).toBe('that fit is dope');
  });
});

describe('LLM mode', () => {
  it('is a stub that rejects with a clear error', async () => {
    const llm = createConverter({ mode: 'llm', provider: 'example', apiKey: 'unused' });
    expect(llm.mode).toBe('llm');
    await expect(llm.convert('hi', { from: 'genz', to: 'boomer' })).rejects.toThrow('LLM mode is not implemented yet');
  });
});
