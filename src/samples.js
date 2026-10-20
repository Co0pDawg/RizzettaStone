/**
 * Seed messages, one per source (each generation, then Plain English). Used by the Example button,
 * the tests, and scripts/samples.mjs.
 * @type {{ from: string, text: string }[]}
 */
export const SEED_SAMPLES = [
  { from: 'millennial', text: 'OMG this brunch is lit lol. My bestie is literally on fleek, haha we need to do this again. ttyl' },
  { from: 'genz', text: "no bc it's giving main character, real 💀 my twin was capping about the tea lmao" },
  { from: 'boomer', text: 'My goodness, what a wonderful party. Ha ha! Your uncle was telling stories again, I kid you not. Call me, pal.' },
  { from: 'genx', text: 'Whoa, that concert was rad, no joke! My dude Steve was full of it as usual heh. Whatever. Peace out.' },
  { from: 'genalpha', text: 'ayo gng that edit was goated 💀 but his aura farming is so ohio fr fr' },
  { from: 'plain', text: 'Honestly, that party was excellent haha. My friend was seriously embarrassing, no lie. Okay, goodbye!' },
];

/** First seed sample for a generation. */
export function sampleFor(/** @type {string} */ gen) {
  return SEED_SAMPLES.find((s) => s.from === gen)?.text ?? '';
}
