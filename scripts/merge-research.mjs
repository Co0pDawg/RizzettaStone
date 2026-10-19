// One-off (re-runnable) merge of the dictionary research into src/dictionaries/.
// Usage: node scripts/merge-research.mjs <path/to/research-dictionaries.json>
//
// Rules (spec addendum 2, B1 + B1a):
// - keep/modify: apply the research metadata.
// - add: insert the entry; research `newConcepts` go into concepts.json.
// - remove: delete only when confidence is medium/high; otherwise keep it
//   with needsReview and the researcher's reason in notes.
// - conceptMismatch with a proposed concept: move the entry to that concept.
// - conceptMismatch without one (action keep/modify): keep it under its
//   concept with needsReview and a "Concept mismatch: <reason>" note. A
//   keep/modify entry missing from the dictionary (deleted by an older merge)
//   is restored. Its weight is capped at MISMATCH_WEIGHT_CAP so it decodes
//   but rarely wins encoding.
// - Notes that quoted source definitions are replaced by paraphrases
//   (NOTE_PARAPHRASES); the source URLs stay as the evidence.
// - Product-voice entries the research does not cover (EXTRA_ENTRIES) and
//   standalone overrides (STANDALONE_OVERRIDES) are applied on every run.
// - Entries the research does not cover: weight 0.5, low, no sources, review.
// - Invariant: confidence "low" => needsReview true.
// - Laughter outputs, "...", "Love, Mom", and Gen X terse keep their text
//   (product voice); only their metadata is imported.
// Re-running on already-merged files gives byte-identical output. It resets
// research-covered metadata, so re-run only to re-import the research.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictDir = path.join(root, 'src', 'dictionaries');
const GENERATIONS = ['boomer', 'genx', 'millennial', 'genz', 'genalpha'];
const SLOTS = ['trailing', 'mid', 'intense'];
const NOT_COVERED = 'not covered by research';
const MISMATCH_WEIGHT_CAP = 0.3; // keep in sync with scripts/apply-research2.mjs

/** Concept moves the researcher proposed in prose notes rather than in `proposedConcept`. */
const PROPOSED_IN_NOTES = {
  // "Consider moving to a 'dismiss' concept."
  'genx:whatever': 'dismiss',
};

/**
 * Our own paraphrases of research notes that quoted a source's definition or
 * prose. Keys: `<gen>:<text>` (lexicon), `<gen>:laughter.<slot>`,
 * `token:<text>`, `style:<gen>:<marker>`. Never store definition text.
 */
const NOTE_PARAPHRASES = {
  'boomer:groovy':
    'Wikipedia dates its popularity to the late 1950s through the early 1970s (boomer youth); RD pairs groovy with boomers. Now dated/ironic; best boomer \'cool\' word. Should be primary for cool.',
  'genx:gnarly': 'RD contrasts the boomers\' groovy with Gen X\'s gnarly. Single source but explicit about the generation.',
  'genx:all that':
    'Dictionary.com: modern slang sense exploded in the 90s; it says the phrase now mostly turns up when an older millennial or Gen Xer gets nostalgic. Fits \'excellent\'/\'cool\' (as in the catchphrase all that and a bag of chips).',
  'genx:talk to the hand':
    'Dictionary.com: started in the 1990s, popularised by Martin (1992-97); it calls the phrase uncommon today. New concept \'dismiss\'.',
  'genx:rad':
    'Refog quotes a Syracuse linguist who lists rad among a series of in-group approval words (with cool, fly, hip, and lit); no generation named. Strong 80s association is UNVERIFIED.',
  'genx:phat':
    'Wiktionary glosses it as a general term of approval (excellent, cool). 90s hip-hop era association is UNVERIFIED (no page fetched dates it). Likely shared with early millennials.',
  'millennial:on fleek':
    'Dictionary.com: coined June 2014 by Chicago teen Kayla Newman via Vine; RD jokes that millennials used it only briefly before it turned cringe. Peak ~2014-15; now dated/ironic. Coiner was a teen in 2014 (born ~late 90s), so generational attribution is blurry.',
  'millennial:laughter.trailing':
    'LadBible (millennial author) describes millennials as LOL/LMAO users, in contrast with the Gen Z skull. Wikipedia LOL page fetched but has no generational claims. NewsNation/Fast Company pages 403\'d. Fading as Gen Z moves on.',
  'millennial:lit':
    'SOURCES DISAGREE: Dictionary.com (2018) ties it to youth slang (hashtag data for under-35s), while RD files it under Gen Z and calls it borderline cheugy; Wikipedia lists it in the 2020s glossary. Shared millennial/Gen Z, now fading.',
  'genz:hits different':
    'RD: describes something that feels unusually striking or impactful. Slight meaning drift vs \'cool\' (it means \'better in the moment\'), but okay.',
  'genz:it\'s giving':
    'Dictionary.com (June 2026): from Black/Latine ballroom culture, mainstream ~2020-21; it says both Gen Z and Gen Alpha use it, and older people say it too (\'unc status\' joke).',
  'genz:slayed':
    'Dictionary.com: from Black/gay culture; RD traces it to drag culture and notes wide use across Gen Z and beyond. Natural form is \'slay\'/\'slayed\'/\'you slayed that\'.',
  'genz:fire':
    'Dictionary.com: the 🔥 emoji is used across generations; Wikipedia lists it. Cross-generational, so weight is generic (primary-selection should avoid it).',
  'genz:mid':
    'Dictionary.com (2023): mediocre; popularised on TikTok; 2000s marijuana-grade origin. RD ranks it among the harshest Gen Z put-downs. New concept \'mediocre\'.',
  'genz:laughter.trailing':
    'Dictionary.com (2022): Gen Z sends lines of skulls to say they are laughing hard; Wikipedia: especially popular with Gen Z and Gen Alpha; LadBible agrees. Shared with Alpha.',
  'genalpha:sigma':
    'SOURCES DISAGREE on generation and meaning: Dictionary.com = manosphere term for a lone-wolf man; RD says Gen Z reclaimed it as a meme; Refog calls it everyday Alpha (\'so sigma\'); Fox5 cites Merriam-Webster for a self-reliant, successful-man sense (MW 403\'d). Often ironic.',
  'genalpha:so ohio':
    'Fox5 (citing Merriam-Webster; MW page 403\'d) describes it as calling something odd, awkward, or cringe; Refog: \'that\'s so Ohio\'; Wikipedia: \'only in Ohio\' meme. Iconic Alpha word.',
  'genalpha:crashout':
    'Dictionary.com (July 2026): lose emotional control; AAVE, online since 2013, NBA YoungBoy 2017; ADS 2024 runner-up; it notes the word is most common with Gen Z and Gen Alpha. MEANING MISMATCH: a meltdown, not gossip/drama. Move to new concept \'overreacting\'.',
  'genalpha:tweaking':
    'Wikipedia: drug-derived slang for behaving erratically or seeming to imagine things. MEANING MISMATCH: not jealousy. Move to \'overreacting\'.',
  'genalpha:aura farming':
    'Dictionary.com (Oct 2025): performing coolness for status; viral mid-2025 via the \'boat kid\'; it names Gen Z and Gen Alpha as the users. Looser than \'main character\'.',
  'genalpha:laughter.trailing':
    'Wikipedia\'s skull-emoji page says it is especially popular with Gen Z and Gen Alpha. Same token as Gen Z (0.95), so weight is shared.',
  'token:💀': 'Wikipedia\'s skull-emoji page says it is especially popular with Gen Z and Gen Alpha.',
  'token:i\'m dead / ded':
    'Wikipedia glossary (dead/ded): finding something so funny you are figuratively dying; the skull emoji stands for \'I\'m dying\'. Engine regex has \'dead\' but NOT \'dying\' or \'ded\'; evidence supports adding both.',
  "style:boomer:ellipsis ('...')":
    'PureWow, citing linguist Gretchen McCulloch: the trailing dots are meant to sound casual, an offline habit carried online; Gen Z reads them as passive-aggressive (TikTok examples of professor/manager emails). Page read to the truncation point only.',
};

/** Standalone-only overrides for research entries (literal senses stay literal). */
const STANDALONE_OVERRIDES = {
  // "I lost my cap" is a hat; only a standalone "cap" / "cap." means a lie.
  'genz:cap': true,
};

/** Product-voice lexicon entries the research does not cover; re-added on every run. */
const EXTRA_ENTRIES = [
  {
    gen: 'genx',
    concept: 'okay',
    entry: {
      text: 'k',
      standalone: true,
      weight: 0.8,
      confidence: 'low',
      status: 'current',
      sources: [],
      notes:
        'Product voice from the original brief: Gen X answers with a terse "k." (the terse flourish adds the period). The research suggests "k" is younger usage that older readers find curt (see styleMarkers.terse), so it stays under review.',
      needsReview: true,
    },
  },
];

/**
 * Research notes with quoted source text swapped for our paraphrase.
 * @param {string} key see NOTE_PARAPHRASES
 * @param {string | undefined} notes
 * @returns {string}
 */
const researchNotes = (key, notes) => NOTE_PARAPHRASES[key] ?? notes ?? '';

/**
 * Engine-facing fields for each laugh token in the research `laughTokens`
 * list, keyed by its `text`. `word` guards both edges against in-word
 * matches; `standalone` tokens count only when they form their own clause.
 */
const TOKEN_ENGINE = {
  lol: { pattern: 'l+o+l+(?:o+l+)*', word: true, intense: false },
  'lmao / lmfao': { pattern: 'lmf?ao+', word: true, intense: true },
  'rofl / roflmao': { pattern: 'rofl(?:mao)?', word: true, intense: true },
  'haha / hahaha / ha ha': {
    pattern: '(?:ha){2,}h?|(?:ah){2,}h?|ha(?:[ \\t]ha)+',
    word: true,
    intense: false,
    intenseMinBeats: 3,
  },
  'heh / hehe': { pattern: 'he(?:he)+h?|heh', word: true, intense: false },
  '😂': { pattern: '😂', word: false, intense: false },
  '🤣': { pattern: '🤣', word: false, intense: true },
  '💀': { pattern: '💀', word: false, intense: false },
  '😭': { pattern: '😭', word: false, intense: false },
  '👍': { pattern: '👍', word: false, intense: false },
  'Ha ha!': { pattern: 'ha ha!', word: true, intense: false },
  'help+ (HELPPP)': { pattern: 'help+', word: true, intense: true, standalone: true },
  "i'm dead / ded": { pattern: "i'?m (?:dead|ded)|ded", word: true, intense: false, standalone: true },
  "i'm crying": { pattern: "i'?m crying", word: true, intense: false, standalone: true },
  "i'm crine": { pattern: "i'?m crine", word: true, intense: false, standalone: true },
  "i'm weak": { pattern: "i'?m weak", word: true, intense: false, standalone: true },
};

/** Tokens the engine detects that the research list does not cover. */
const EXTRA_TOKENS = [
  {
    text: 'dying / i\'m dying',
    primaryGeneration: 'genz',
    pattern: "(?:i'?m )?dying",
    word: true,
    intense: false,
    standalone: true,
    extraNote: 'Added by orchestrator decision B1a; the research notes for "i\'m dead / ded" cite Dictionary.com for "I\'m dying".',
  },
  {
    text: "i'm deceased",
    primaryGeneration: 'genz',
    pattern: "i'?m deceased",
    word: true,
    intense: false,
    standalone: true,
  },
];

/** Research style markers, mapped to the dictionary flag they describe. */
const STYLE_MARKER_KEYS = {
  "boomer:ellipsis ('...')": 'ellipsis',
  "boomer:'Love, Mom' signoff": 'signoff',
  "genx:terse 'k.' / 'whatever'": 'terse',
};

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/[’‘]/g, "'");

/** @param {string} file */
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** @param {string} file @param {unknown} data */
async function writeJson(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Metadata in canonical field order, enforcing low => needsReview.
 * @param {any} src
 * @param {{ notes?: string, needsReview?: boolean, weight?: number }} [override]
 */
function meta(src, override = {}) {
  const confidence = src.confidence;
  const out = {
    weight: override.weight ?? src.weight,
    confidence,
    status: src.status,
    sources: (src.sources ?? []).map((/** @type {any} */ s) => ({ url: s.url, retrieved: s.retrieved })),
    notes: override.notes ?? src.notes ?? '',
    needsReview: Boolean(override.needsReview ?? src.needsReview) || confidence === 'low',
  };
  return out;
}

const DEFAULT_META = { weight: 0.5, confidence: 'low', status: 'current', sources: [], notes: NOT_COVERED, needsReview: true };

/** @param {any} entry */
const textOf = (entry) => (typeof entry === 'string' ? entry : entry.text);

async function main() {
  const researchPath = process.argv[2];
  if (!researchPath) {
    console.error('usage: node scripts/merge-research.mjs <research-dictionaries.json>');
    process.exit(2);
  }
  let research;
  try {
    research = await readJson(researchPath);
  } catch (err) {
    console.error(`BLOCKED: cannot read research file ${researchPath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const conceptsFile = path.join(dictDir, 'concepts.json');
  const concepts = await readJson(conceptsFile);
  for (const c of research.newConcepts ?? []) {
    if (!concepts[c.id]) concepts[c.id] = { plain: c.plain, description: c.description };
  }
  await writeJson(conceptsFile, concepts);
  const conceptOrder = Object.keys(concepts);

  /** @type {string[]} */
  const log = [];
  for (const gen of GENERATIONS) {
    const file = path.join(dictDir, `${gen}.json`);
    const dict = await readJson(file);
    const r = research.generations?.[gen] ?? { entries: [], laughter: {} };
    /** @type {Map<string, any>} */
    const byText = new Map(r.entries.map((/** @type {any} */ e) => [norm(e.text), e]));
    /** @type {Map<string, any[]>} */
    const lexicon = new Map();
    const push = (/** @type {string} */ concept, /** @type {any} */ entry) => {
      if (!lexicon.has(concept)) lexicon.set(concept, []);
      lexicon.get(concept).push(entry);
    };

    /**
     * @param {any} re research entry
     * @returns {{ concept: string, entry: any } | null}
     */
    const decide = (re) => {
      const key = `${gen}:${norm(re.text)}`;
      const proposed = re.proposedConcept ?? PROPOSED_IN_NOTES[key];
      const reason = researchNotes(key, re.notes);
      const wantsRemoval = re.action === 'remove';
      let concept = re.concept;
      /** @type {{ notes?: string, needsReview?: boolean, weight?: number }} */
      const override = {};
      let mismatch = re.conceptMismatch === true;
      if (proposed) {
        concept = proposed;
        mismatch = false;
        override.notes = `${reason} Merge: moved from "${re.concept}" to "${proposed}" (researcher's proposed concept).`;
      } else if (wantsRemoval) {
        if (re.confidence === 'medium' || re.confidence === 'high') {
          log.push(`removed ${gen} ${re.concept} "${re.text}" (${re.action}${re.conceptMismatch ? ', conceptMismatch' : ''}, ${re.confidence})`);
          return null;
        }
        override.notes = `Research recommends removal (action "remove"); kept because confidence is low. Reason: ${reason}`;
        override.needsReview = true;
      } else if (mismatch) {
        // No better concept proposed: keep it where it was, flagged for review.
        override.notes = `Concept mismatch: ${reason}`;
        override.needsReview = true;
        // Still decodable, but should not win encoding over a proper fit.
        override.weight = Math.min(re.weight, MISMATCH_WEIGHT_CAP);
      }
      if (gen === 'genalpha' && norm(re.text) === 'skibidi') {
        override.needsReview = true;
        override.weight = Math.min(re.weight, 0.5);
        override.notes = `${reason} Merge: Dictionary.com says the meaning is ambiguous (cool, bad, or weird), so the weight is capped at 0.5 and the entry stays under review.`;
      }
      if (!concepts[concept]) throw new Error(`unknown concept "${concept}" for ${key}`);
      const standalone = STANDALONE_OVERRIDES[key] ?? Boolean(re.standalone);
      const entry = { text: re.text, standalone, ...meta(re, { notes: reason, ...override }) };
      if (mismatch) entry.conceptMismatch = true;
      if (re.proposedText) entry.proposedText = re.proposedText;
      return { concept, entry };
    };

    const extras = EXTRA_ENTRIES.filter((x) => x.gen === gen);
    const matched = new Set();
    for (const [concept, entries] of Object.entries(dict.lexicon)) {
      for (const current of entries) {
        const text = textOf(current);
        if (extras.some((x) => x.concept === concept && norm(x.entry.text) === norm(text))) continue;
        const re = byText.get(norm(text));
        if (!re) {
          const standalone = typeof current === 'object' && current.standalone === true;
          push(concept, { text, standalone, ...DEFAULT_META });
          log.push(`not covered: ${gen} ${concept} "${text}"`);
          continue;
        }
        matched.add(re);
        if (re.text !== text) log.push(`text change ${gen}: "${text}" -> "${re.text}"`);
        const result = decide(re);
        if (result) push(result.concept, result.entry);
      }
    }
    for (const re of r.entries) {
      if (matched.has(re)) continue;
      // "add" inserts; a keep/modify entry missing here was deleted by an
      // older merge and is restored; "remove" stays gone.
      if (re.action === 'remove') {
        log.push(`not in dictionary, stays removed: ${gen} "${re.text}"`);
        continue;
      }
      const result = decide(re);
      if (!result) continue;
      if (re.action !== 'add') log.push(`restored ${gen} ${result.concept} "${re.text}" (${re.action})`);
      push(result.concept, result.entry);
    }
    for (const x of extras) {
      if (!concepts[x.concept]) throw new Error(`unknown concept "${x.concept}" for extra ${gen} "${x.entry.text}"`);
      push(x.concept, { ...x.entry, sources: [...x.entry.sources] });
    }

    const laughter = {};
    for (const slot of SLOTS) {
      const current = dict.laughter[slot];
      const text = textOf(current);
      const re = r.laughter?.[slot];
      // Product voice: laughter output text never changes here.
      const entry = re ? { text, ...meta(re, { notes: researchNotes(`${gen}:laughter.${slot}`, re.notes) }) } : { text, ...DEFAULT_META };
      if (re?.conceptMismatch) entry.conceptMismatch = true;
      if (re?.proposedText) entry.proposedText = re.proposedText;
      laughter[slot] = entry;
    }

    /** @type {Record<string, any>} */
    const styleMarkers = {};
    for (const m of research.styleMarkers ?? []) {
      if (m.generation !== gen) continue;
      const flag = STYLE_MARKER_KEYS[`${gen}:${m.marker}`];
      if (!flag) throw new Error(`unmapped style marker ${gen}: ${m.marker}`);
      styleMarkers[flag] = { text: m.marker, ...meta(m, { notes: researchNotes(`style:${gen}:${m.marker}`, m.notes) }) };
    }
    for (const flag of [...Object.keys(dict.style ?? {}), ...(dict.signoff ? ['signoff'] : [])]) {
      if (!styleMarkers[flag]) styleMarkers[flag] = { text: flag, ...DEFAULT_META };
    }

    const out = { id: dict.id, label: dict.label, years: dict.years, laughter };
    if (dict.style) out.style = dict.style;
    if (dict.signoff) out.signoff = dict.signoff;
    if (Object.keys(styleMarkers).length) out.styleMarkers = styleMarkers;
    out.lexicon = Object.fromEntries(conceptOrder.filter((c) => lexicon.has(c)).map((c) => [c, lexicon.get(c)]));
    await writeJson(file, out);
  }

  const tokens = [];
  for (const t of research.laughTokens ?? []) {
    const engine = TOKEN_ENGINE[t.text];
    if (!engine) throw new Error(`no engine pattern for laugh token "${t.text}"`);
    tokens.push({
      text: t.text,
      primaryGeneration: t.primaryGeneration,
      pattern: engine.pattern,
      word: engine.word,
      standalone: Boolean(engine.standalone),
      intense: engine.intense,
      ...(engine.intenseMinBeats ? { intenseMinBeats: engine.intenseMinBeats } : {}),
      ...meta(t, { notes: researchNotes(`token:${t.text}`, t.notes) }),
    });
  }
  for (const t of EXTRA_TOKENS) {
    tokens.push({
      text: t.text,
      primaryGeneration: t.primaryGeneration,
      pattern: t.pattern,
      word: t.word,
      standalone: t.standalone,
      intense: t.intense,
      ...DEFAULT_META,
      notes: t.extraNote ? `${NOT_COVERED}. ${t.extraNote}` : NOT_COVERED,
    });
  }
  await writeJson(path.join(dictDir, 'laughTokens.json'), tokens);

  for (const line of log) console.log(line);
  console.log(`merged research into ${path.relative(root, dictDir)}/ (${tokens.length} laugh tokens)`);
}

await main();
