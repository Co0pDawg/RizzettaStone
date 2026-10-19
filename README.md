# Rizzetta Stone

*Fluent in 💀, 😂, and 'Love, Mom.'*

A small, offline web toy that rewrites a text message from one generation's style into another's — Boomer, Gen X, Millennial, Gen Z, and Gen Alpha — and exports a before/after PNG share card. It is rule-based: editable JSON dictionaries, no AI, no network calls.

```
lol what happened, my bestie is on fleek     (Millennial)
😭 what happened, my twin is bussin          (Gen Z)
```

## Run it

```sh
npm install      # once
npm start        # → http://127.0.0.1:5173
```

`npm start` runs the Vite dev server on `127.0.0.1:5173` with `--strictPort` (it fails rather than picking another port). The dev server always serves at `/`. Only production builds use the deploy base path (see [Site config](#site-config-and-deploy-base)).

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev server on http://127.0.0.1:5173 |
| `npm test` | Unit tests (vitest; the DOM tests use happy-dom) |
| `npm run build` | Production build into `dist/` |
| `npm run e2e` | Builds, starts `vite preview` on a free port at the deploy base, and drives the UI in headless system Chrome (`/usr/bin/google-chrome`, via `playwright-core`). It checks the site name, tagline, parody disclaimer, asset base path, ad-slot DOM order, and the privacy page; drives Copy (reads the clipboard back), Swap, and Example; checks the card title and watermark; downloads the share card, checks the PNG signature and IHDR size, and asserts that no request leaves localhost. It writes `artifacts/share-card.png` and `artifacts/app.png`. No Playwright browser download is needed. |
| `npm run samples` | Prints a Markdown table converting sample messages to every generation. `npm run samples -- out.md` writes it to a file. |
| `npm run review` | Regenerates `data/REVIEW.md` and `data/review.csv`, the dictionary review artifact. |
| `npm run verify-sources` | Re-checks every entry's Wiktionary labels and writes a report (see [Data provenance & licensing](#data-provenance--licensing)). Makes network requests; not part of `npm test`. |
| `node scripts/merge-research.mjs <research.json>` | Re-imports a dictionary research file (see [Dictionary data and research](#dictionary-data-and-research)). |
| `node scripts/apply-research2.mjs <research2-updates.json>` | Applies the Wiktionary re-vet on top of the merged data (run it after `merge-research.mjs`). |

## How it works

Conversion is **decode → canonical concepts → encode**, not pairwise tables.

1. **Laughs** are found first (see below).
2. **Decode:** slang from *any* generation is found with whole-word, case-insensitive, longest-match-first matching ("lollipop", "fireplace", "capital" are never touched). A hyphen or dot between letters joins a word, so "mid-century", "lol-worthy", and "lol.com" are left alone. Every entry is matched, whatever its weight. When two generations spell the same phrase, the source generation wins ties. A concept's `plain` word is decoded too, but only when it stands alone ("okay!", "Seriously?"), so the plain fallback round-trips; slang with the same spelling wins. Curly apostrophes match straight ones.
3. **Encode:** each concept becomes the target's **highest-weight** entry for that concept. Ties go to array order (the earlier entry wins). If the target has no entry for the concept, the concept's `plain` fallback is used. A phrase the target already uses for that concept is kept as-is. `status` (`current`/`fading`/`dated`/`ironic`) is informational only and never affects selection, so Boomer can deliberately sound dated. Entries flagged `needsReview` remain selectable; weight alone decides.
4. **Case:** a replacement copies the original's case pattern: ALL CAPS → ALL CAPS, Capitalized → Capitalized. Lower-case (or an exact dictionary spelling such as `OMG`) gives the target's dictionary spelling. Emoji are unaffected. Everything else in the message survives byte-for-byte.
5. **Style flourishes** from the target's `style` flags, each applied at most once:
   - `ellipsis` (Boomer): a lone sentence-final `.` becomes `...` (skips `...`, `3.5`, `site.com`); the `signoff` ("Love, Mom") is appended on a new line unless the text already ends with it (trailing `.`, `!`, `…`, and spaces are ignored, so "Love, Mom." counts). Trailing whitespace before the signoff is trimmed.
   - `terse` (Gen X): a sentence-ending run of `!` becomes `.`. Gen X's `okay` is a standalone `k`, so "okay!" becomes "k.".

Converting a generation to itself returns the input unchanged. Output is deterministic.

### Laughter classification

Laughter is its own pipeline. The tokens it detects live in `src/dictionaries/laughTokens.json`, each with a regex `pattern` plus review metadata: `lol`/`lolol`/`LOOOL`, `lmao`, `lmfao`, `rofl`, `haha`/`hahaha`/`ha ha`, `hehe`/`heh`, 😂 🤣 💀 😭 👍, and `Ha ha!`. Every generation's own laughter outputs (`skull emoji`, `💀💀💀 I'm crine`, …) are also recognized, so converted text decodes again. Tokens marked `standalone` count only when they form their own clause: `HELP`/`HELPPP`, `I'm dead`/`im dead`/`ded`, `dying`/`I'm dying`, `I'm crying`, `I'm crine`, `I'm weak`, and `I'm deceased`. So "please help me move", "dying plants", "the plant is dying.", and "a dead battery" are untouched. A token's `word: true` guards both edges against in-word matches; emoji tokens use `word: false`.

Adjacent tokens separated only by spaces collapse into one laugh event, which is classified:

- **intense** — the event has 2+ tokens (`lol lol`, `💀💀`, `lmao 😂`), or contains a token with `intense: true` (lmao, lmfao, rofl, 🤣, HELP+), or reaches `intenseMinBeats` (`hahaha`, 3+ "ha" beats). Intensity overrides position.
- **trailing** — the laugh is the last thing in its clause: followed only by spaces and then the message end, a newline, or `. ! ? , ; : )`. It softens tone: "that's so funny lol" → Gen Z "that's so funny 💀".
- **mid** — anything else: a sentence opener ("lol what happened" → "😭 what happened"), an interjection inside a sentence, or a laugh that is its whole sentence.

Each generation's `laughter` gives the output for each class in its `text`. An empty `text` drops the laugh and the space before it ("that's wild lol." → Gen X "that's wild."). Punctuation after a laugh always stays where it was ("wild lol." → "wild 💀."); punctuation baked into a decoded laugh ("Ha ha!") is carried over when the replacement has none.

## Dictionary data and research

Data lives in `src/dictionaries/`:

- `concepts.json` — concept ids, each with a `plain` fallback and a `description`.
- `boomer.json`, `genx.json`, `millennial.json`, `genz.json`, `genalpha.json` — `id`, `label`, `years`, `laughter` (`trailing`, `mid`, `intense`), `lexicon`, optional `style` flags, optional `signoff`, and `styleMarkers` (review metadata for the style flags and signoff).
- `laughTokens.json` — the laugh detector's token list (see above).

Every lexicon entry, laughter output, laugh token, and style marker is an object:

```json
{ "text": "bussin", "standalone": false, "weight": 0.85, "confidence": "high",
  "status": "current", "sources": [{ "url": "https://...", "retrieved": "2026-10-19" }],
  "notes": "...", "needsReview": false }
```

- `weight` (0–1): how strongly the expression belongs to that generation. The encoder writes the highest weight.
- `confidence`: `high` (two or more fetched sources agree), `medium` (one solid source), or `low` (no fetched source, or a definition-only source). `low` always requires `needsReview: true`.
- `status`: `current`, `fading`, `dated`, or `ironic`. It is informational.
- `sources`: `{ url, retrieved }` pairs; `url` must be `http(s)://` and `retrieved` must be `YYYY-MM-DD`.
- `standalone` (lexicon and laugh tokens, default false): see below.
- Optional `conceptMismatch: true` marks an entry whose meaning only loosely fits its concept. Optional `proposedText` holds a researcher's suggested alternative; it is not used.
- Optional `labels`: Wiktionary usage labels (`slang`, `dated`, `Internet`, …) written by `npm run verify-sources -- --write`. Never definition text.

**Add a slang phrase:** append an object to the concept's array in that generation's file. Give it a `weight` above the current top entry if you want the converter to write it; otherwise it is only recognized.

**Add a concept:** add an id to `concepts.json` with `plain` and `description`, then add `lexicon` entries for it in each generation that has a word for it. Generations without one fall back to `plain`.

**Standalone entries:** some words are only slang when they form their own clause. Set `"standalone": true`: `real` is decoded only between clause boundaries (message edges, `. ! ? , ; :`, newline), emoji, or laughs. So "real." and "real 💀" decode, and "a real problem" stays unchanged.

`validateDictionary(dict, concepts)` and `validateLaughTokens(tokens)` in `src/engine/dictionaries.js` check required keys, the laughter shape, style flags, unknown concept ids, duplicate expressions within a generation, every metadata field's type and range, and the low-confidence ⇒ needsReview rule. `npm test` fails if shipped data is invalid.

### Review artifact

`npm run review` writes `data/REVIEW.md` (a readable table with source links) and `data/review.csv` (RFC 4180, every field quoted). Both list every entry: lexicon, laughter, laugh tokens, and style markers. They sort `needsReview` first, then confidence low → high, then weight ascending. The header date is the latest `retrieved` date in the data, or `--date YYYY-MM-DD`, so re-runs give byte-identical files. To change an entry, edit the JSON and re-run `npm run review`.

### Research method and caveats

The metadata came from a researched review dated 2026-10-19. Every cited URL was fetched and read that day, and Urban Dictionary was never used as evidence. Keep these limits in mind:

- **Merriam-Webster** returned HTTP 403 on every page, so its claims appear only second-hand (via Fox5 and Yahoo), and no entry cites a Merriam-Webster URL.
- **No Pew Research data** on slang or emoji by generation was available, and the one academic hit could not be fetched.
- Several other sites (NewsNation, Fast Company, Inc., Parade) returned 403 and are not cited.
- Older-generation slang is thinly documented online, so most Boomer, Gen X, and Millennial entries are `low` confidence and `needsReview`. They stay selectable; holding them out would empty those lexicons.
- The product voice overrides the research for Boomer 👍, the Boomer "..." and "Love, Mom", the Gen X terse style, Millennial 😂, and Gen Z 💀/😭. Their outputs are kept and the research metadata shows the evidence gap.

`scripts/merge-research.mjs` is the re-runnable import of that research. `keep`/`modify` apply metadata; `add` inserts entries and new concepts. `remove` deletes only `medium`/`high`-confidence entries; `low` ones are kept with `needsReview` and the reason in `notes`. A concept mismatch with a proposed concept moves the entry; without one, the entry stays under its concept with `needsReview` and a `Concept mismatch:` note and its weight capped at 0.3, so it still decodes but rarely wins encoding (a mismatch is not a removal). Entries the research does not cover get weight 0.5, `low`, and `needsReview`. The script also re-applies our paraphrases of notes that quoted a source (`NOTE_PARAPHRASES`), standalone overrides (`cap`), and product-voice entries the research lacks (Gen X `k`). Re-running it on merged files changes nothing, but it does reset research-covered metadata (and drops stored `labels`), so run it only to re-import research, and follow it with `apply-research2.mjs`.

`scripts/apply-research2.mjs` applies the second research pass, a Wiktionary re-vet of every low-confidence entry. Each update is matched by generation, kind, concept or slot, and text. It sets `confidence`/`status`/`weight`/`needsReview`, appends new sources (deduped by URL) and the researcher's note, and stores the usage `labels` (normalized like `verify-sources`). Categories and Urban Dictionary signals are not stored. `needsReview` stays true for low confidence and for entries an earlier decision flagged (concept mismatch, or a research "remove" kept for review). An update that matches no entry is an error: nothing is written. Re-running it changes nothing. The review artifact has a `labels` column.

## Data provenance & licensing

**Sources.** Entry metadata comes from fetched pages of Dictionary.com, Wikipedia, Wiktionary, Know Your Meme, Reader's Digest, Fox5, LadBible, Refog, PureWow, and similar outlets, each cited per entry in `sources` with its retrieved date. `npm run verify-sources` re-checks usage labels against Wiktionary.

**What is stored.** Only usage **labels** (for example `slang`, `dated`, `Internet`), our own paraphrased `notes`, and source **URLs**. Definition and example text is never stored, in the JSON or anywhere else in the repo:

- Wiktionary text is licensed CC BY-SA, which would carry share-alike terms into the data, so we keep labels and links, not wording.
- Urban Dictionary content is not licensed for reuse; it was never used as evidence or copied.
- `npm test` fails if a note quotes more than five words in a row.

**Why not Merriam-Webster.** Its free API key is for non-commercial use only, and this site may carry ads. Its website also returned HTTP 403 to every fetch, so the few Merriam-Webster claims in the notes are second-hand (via Fox5 or Yahoo) and paraphrased.

**Refreshing the data.**

1. `npm run verify-sources` checks every word-like entry against `https://en.wiktionary.org/api/rest_v1/page/definition/<term>` (existence; a 404 means the entry vanished) and the page's wikitext (the REST HTML ships its label spans empty, so `{{lb|en|…}}` labels come from the MediaWiki API). It prints a Markdown report and writes `data/verify-sources-report.md` (git-ignored): added/removed labels per entry, 404s, and entries newly labelled `dated`/`archaic`/`obsolete` while their status is `current`. Labels are the union over every English sense of the page, so a dated sense may belong to a meaning we do not use.
   Options: `--limit N`, `--delay MS` (default 1000; requests are sequential), `--no-cache` (responses are cached in `.cache/wiktionary/`, git-ignored), `--strict` (exit 1 when anything changed), `--write` (store the fetched `labels` in the JSON; it never touches `confidence` or `status`, which stay human decisions). It sends a descriptive User-Agent, times out after 15 s, and retries once on 429/5xx.
2. Review the report.
3. Edit the JSON in `src/dictionaries/` (status, confidence, weight, notes).
4. `npm run review` to regenerate `data/REVIEW.md` and `data/review.csv`.

## Site config and deploy base

Everything site-specific lives in `src/config/site.json`:

| Key | Default | Meaning |
|---|---|---|
| `site.name` | `Rizzetta Stone` | Display name: page `<title>`, header, meta/og tags, privacy page, share-card title, and the download file prefix (`rizzetta-stone-<from>-to-<to>.png`). |
| `site.tagline` | `Fluent in 💀, 😂, and 'Love, Mom.'` | Header tagline and meta descriptions. |
| `site.repo` | `RizzettaStone` | GitHub repo name (`Co0pDawg/RizzettaStone`). The deploy base is `/<repo>/`. |
| `site.owner` | `Co0pDawg` | GitHub owner, used for the fallback URL `https://<owner>.github.io/<repo>/`. |
| `site.domain` | `rizzettastone.app` | Primary domain. Used for the URL when `site.url` is empty. |
| `site.url` | `https://rizzettastone.app/` | Canonical URL: `<link rel="canonical">`, `og:url`, privacy page links. Empty means `https://<site.domain>/`, else the GitHub Pages URL. |
| `site.watermarkText` | `rizzettastone.app` | Share-card watermark. Empty means the host of the site URL. |
| `deploy.base` | `""` | Explicit base path override. |
| `deploy.customDomainEnabled` | `false` | Serve from the custom domain. Off by default: the build serves from `/RizzettaStone/` and writes no `CNAME`. Env `CUSTOM_DOMAIN=1` also turns it on. |
| `deploy.customDomain` | `rizzettastone.app` | The custom domain. When enabled, the build writes `dist/CNAME` (exactly this domain) and serves from `/`. |
| `ads` | `provider: "none"` | See [Ads and consent](#ads-and-consent). |
| `consent` | `enabled: false` | See [Ads and consent](#ads-and-consent). |

Base path precedence for `npm run build` and `vite preview` (first match wins; `resolveBase` in `src/config/site.js`):

1. env `BASE_PATH` (for example `BASE_PATH=/ npm run build`);
2. custom domain enabled (`deploy.customDomainEnabled: true` or `CUSTOM_DOMAIN=1`, with `deploy.customDomain` set) → `/`;
3. `deploy.base`;
4. `/<site.repo>/`;
5. `/`.

`npm start` always serves at `/`. A tiny Vite plugin in `vite.config.js` emits `dist/CNAME` when the custom domain is enabled; another fills `{{SITE_NAME}}`, `{{SITE_TAGLINE}}`, and `{{SITE_URL}}` in `index.html` and `privacy.html` (both are Vite pages).

## Ads and consent

Ads are **off by default**. The shipped defaults (`ads.provider: "none"`, `consent.enabled: false`) make zero third-party requests, and `npm run e2e` asserts that.

- `src/ads.js` exports `renderAdSlot(config, slotName)` and `mountAdSlot(config, slotName, container)`. `renderAdSlot` returns `null` and creates nothing for provider `"none"`, an unknown provider, or the placeholder IDs (`ca-pub-XXXXXXXXXXXXXXXX`, `0000000000`). For `"adsense"` with real IDs, it returns `<ins class="adsbygoogle" data-ad-client=… data-ad-slot=…>`. `mountAdSlot` loads the AdSense script only after the consent hook allows it. `main.js` imports `ads.js` lazily, and only when a provider is set, so the default page never loads it.
- The slot container (`#ad-slot`) sits after the output panel and the download button, never between input and result.
- `src/consent.js` exports `ensureConsent(config)`, a stub that never loads a vendor. It resolves `{ adsAllowed: false }` until a real CMP is wired in. To wire one in, load a Google-certified CMP (Google Privacy & messaging, formerly Funding Choices, or a certified third-party CMP that speaks IAB TCF v2.2) inside `ensureConsent`, wait for its consent signal, and resolve from it. The order is fixed: CMP first, then the consent signal, then the ad script.

### Privacy policy and ads.txt

- `privacy.html` is the privacy policy, a Vite page next to `index.html` so it gets the configured name and URLs, linked from the page footer. It covers local text processing, cookies, Google AdSense and personalized ads, opting out via Google Ads Settings, and consent. The "Last updated" date and contact email are placeholders.
- `public/ads.txt.template` holds the AdSense `ads.txt` line with a placeholder publisher ID. It is deliberately **not** named `ads.txt`, so the site never serves placeholder data. Rename it after you set the real ID.

## Going live

The shipped defaults make zero third-party requests (ads off, consent off). Cooper does these steps:

1. Create the GitHub repo `Co0pDawg/RizzettaStone` and push.
2. Under **Settings → Pages**, set **Source** to **GitHub Actions**. `.github/workflows/deploy.yml` then tests, builds, and deploys on every push to `main` (or run it manually with `workflow_dispatch`). Until the custom domain is on, the site appears at `https://co0pdawg.github.io/RizzettaStone/`.
3. Point the custom domain at it (see [Custom domain](#custom-domain-rizzettastoneapp) below).
4. Update `site.url`/`site.watermarkText` if they should differ from `https://rizzettastone.app/` and `rizzettastone.app`.
5. Apply to AdSense once the site has content.
6. Set `ads.adsense.publisherId` and `ads.adsense.slots.belowOutput`, set `ads.provider` to `"adsense"`, and rename `public/ads.txt.template` to `public/ads.txt` with the real ID (drop the `ca-` prefix and the comment line).
7. Set up a Google-certified CMP, wire it in `src/consent.js`, and set `consent.enabled` to `true`.
8. Update the privacy policy's contact and "Last updated" date.

**Renaming** the site or repo is a one-field edit: change `site.repo` (and `site.name` for the display name) in `src/config/site.json`. The base path, the fallback URL, the title, and the download file name all follow.

### Custom domain (rizzettastone.app)

`rizzettastone.app` is the primary domain. `rizzettastone.com` is also registered (Porkbun) and only redirects to `.app` at the registrar, so the app has no `.com` handling. Do these steps in order:

1. **Verify the domain first.** In GitHub **account settings → Pages → verified domains**, add and verify `rizzettastone.app` *before* pointing DNS at GitHub. That stops anyone else from claiming it (domain takeover).
2. **Porkbun DNS for the `.app` apex.** Add GitHub Pages' `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` and `AAAA` records `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`, plus a `www` `CNAME` → `co0pdawg.github.io`. These are from GitHub's docs, "Managing a custom domain for your GitHub Pages site" (https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site); re-check the IPs there before you enter them.
3. Set `deploy.customDomainEnabled: true` in `src/config/site.json` (or set the custom domain under the repo's **Settings → Pages**), then push. The build then writes `dist/CNAME` with `rizzettastone.app` and serves from `/`.
4. **`.com` redirect.** In Porkbun, set URL forwarding for `rizzettastone.com` and `www.rizzettastone.com` to `https://rizzettastone.app` as a permanent (301) redirect.
5. **HTTPS.** `.app` is on the HSTS preload list, so browsers only ever load it over HTTPS. Expect the site to be unreachable until GitHub issues the certificate; once it has, turn on **Enforce HTTPS** in **Settings → Pages**.

## About

Rizzetta Stone is a joke translator for texts between generations. Parody. Not affiliated with or endorsed by Rosetta Stone.

## Code map

```
index.html, src/main.js, src/style.css   UI (main.js is wiring only)
src/config/site.json, src/config/site.js site config + pure resolvers (base, custom domain, URL, watermark, name, slug)
src/ads.js, src/consent.js               config-driven ad slot + consent stub
src/engine/index.js                      createConverter({ mode }) + Converter typedefs
src/engine/ruleConverter.js              laugh pipeline, decode/encode, style
src/engine/tokenize.js                   boundary, clause, and case helpers
src/engine/dictionaries.js               loads + validates the JSON, weight-based pickPrimary
src/engine/llmConverter.js               LLM-mode stub
src/samples.js                           seed messages (Example button, tests, samples)
src/shareCard.js                         buildShareCard (pure DOM) + html-to-image export
privacy.html, public/ads.txt.template    privacy page (Vite page) + ads.txt template
scripts/e2e.mjs, scripts/samples.mjs     proofs and sample table
scripts/review.mjs, scripts/merge-research.mjs, scripts/apply-research2.mjs   review artifact + research imports
scripts/verify-sources.mjs               Wiktionary label check (npm run verify-sources)
data/REVIEW.md, data/review.csv          generated review artifact
vite.config.js                           base path, pages, CNAME + site-HTML plugins
.github/workflows/deploy.yml             GitHub Pages deploy
test/                                    vitest suites
```

## LLM mode hook

`createConverter({ mode: 'rules' | 'llm', ...options })` returns `{ mode, convert(text, { from, to }) }`, where `convert` resolves to `{ text, changes }` and each change is `{ from, to, kind: 'laugh' | 'lexicon' | 'style' }`.

`mode: 'llm'` is a stub today: `convert` rejects with `LLM mode is not implemented yet` and makes no network call. The UI shows a disabled "AI mode (coming soon)" box. A real implementation must:

- keep the same async `convert` signature and result shape;
- take the provider, model, and API key from `createConverter` options — never hard-coded;
- receive the generation dictionaries and pass them to the model as style guidance;
- fall back to the rules converter on any error.

## Known limitations

- Word-for-word substitution: no grammar repair, so "a wonderful party" can become "a on fleek party".
- Literal senses: common words that double as slang are decoded everywhere ("fire", "lame", "drama", "super"), so "the house is on fire" becomes "the house is on outta sight". Rules cannot tell senses apart; mark such entries `standalone` if that bothers you. `cap` already is standalone-only, so "I lost my cap" stays put, but so does "that's cap" (only a standalone "cap" or "cap." means a lie).
- Concept-mismatch entries (`conceptMismatch: true`, e.g. Gen Z "hits different" under `cool`) stay selectable by weight, so some outputs read oddly ("this brunch is hits different") until their weights are reviewed.
- A standalone plain word is decoded, so "Seriously?" or "Cool." alone gets rewritten into the target's slang.
- Only a target's highest-weight expression survives a round trip. Other expressions come back as that one ("no bc" → Millennial → "frfr").
- Many Boomer, Gen X, and Millennial weights rest on no fetched source (`needsReview`), so their chosen expressions are provisional until reviewed.
- Boomer's `👍` is treated as a laugh when decoding, because it is Boomer's trailing laugh.
- The dictionary metadata (notes, sources) ships in the JS bundle (~24 kB gzipped total).
- Emoji render in whatever emoji font the browser has; on a machine without a color emoji font, the share card shows monochrome glyphs.
