import { createConverter, DICTIONARIES, LANGUAGE_IDS } from './engine/index.js';
import { SEED_SAMPLES } from './samples.js';
import { downloadShareCard } from './shareCard.js';
import siteConfig from './config/site.json' with { type: 'json' };

const converter = createConverter({ mode: 'rules' });

/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const input = /** @type {HTMLTextAreaElement} */ ($('input'));
const output = $('output');
const fromSelect = /** @type {HTMLSelectElement} */ ($('from'));
const toSelect = /** @type {HTMLSelectElement} */ ($('to'));
const changesEl = $('changes');
const statusEl = $('status');

for (const select of [fromSelect, toSelect]) {
  for (const id of LANGUAGE_IDS) {
    const { label, years } = DICTIONARIES[id];
    select.append(new Option(years ? `${label} (${years})` : label, id));
  }
}
fromSelect.value = 'millennial';
toSelect.value = 'genz';

let latest = 0;
let exampleIndex = -1;

/** @param {string} message */
function setStatus(message) {
  statusEl.textContent = message;
}

async function render() {
  const run = (latest += 1);
  try {
    const { text, changes } = await converter.convert(input.value, { from: fromSelect.value, to: toSelect.value });
    if (run !== latest) return;
    output.textContent = text;
    const count = changes.length;
    changesEl.textContent = input.value.trim() ? `${count} change${count === 1 ? '' : 's'}` : '';
  } catch (err) {
    if (run !== latest) return;
    output.textContent = '';
    changesEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

input.addEventListener('input', render);
fromSelect.addEventListener('change', render);
toSelect.addEventListener('change', render);

$('swap').addEventListener('click', () => {
  const converted = output.textContent ?? '';
  [fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value];
  if (converted) input.value = converted;
  render();
});

$('example').addEventListener('click', () => {
  exampleIndex = (exampleIndex + 1) % SEED_SAMPLES.length;
  const sample = SEED_SAMPLES[exampleIndex];
  input.value = sample.text;
  fromSelect.value = sample.from;
  if (toSelect.value === sample.from) {
    toSelect.value = LANGUAGE_IDS.find((id) => id !== sample.from) ?? 'genz';
  }
  render();
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.textContent ?? '');
    setStatus('Copied!');
  } catch {
    setStatus('Copy failed. Select the text and copy it manually.');
  }
});

$('download').addEventListener('click', async () => {
  setStatus('Rendering card…');
  try {
    const name = await downloadShareCard({
      from: fromSelect.value,
      to: toSelect.value,
      input: input.value,
      output: output.textContent ?? '',
      config: siteConfig,
    });
    setStatus(`Saved ${name}`);
  } catch (err) {
    setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

render();

// Ads are off by default; the ad module is only fetched when a provider is set.
if (siteConfig.ads.provider !== 'none') {
  import('./ads.js')
    .then(({ mountAdSlot }) => mountAdSlot(siteConfig, 'belowOutput', $('ad-slot')))
    .catch(() => {});
}
