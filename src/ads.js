/**
 * Config-driven ad slot. Off by default (`ads.provider: "none"`).
 *
 * main.js imports this module lazily, only when a provider other than "none"
 * is configured, so the default build never loads it.
 */
import { ensureConsent } from './consent.js';

const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const PUBLISHER_ID = /^ca-pub-\d{16}$/;
const SLOT_ID = /^\d{6,}$/;

/**
 * True when the AdSense config holds a real-looking publisher and slot ID
 * (not the shipped `ca-pub-XXXX…` / `0000000000` placeholders).
 * @param {import('./config/site.js').SiteConfig} config
 * @param {string} slotName
 * @returns {boolean}
 */
function adsenseReady(config, slotName) {
  const adsense = config.ads?.adsense;
  const slot = adsense?.slots?.[slotName];
  return (
    typeof adsense?.publisherId === 'string' &&
    PUBLISHER_ID.test(adsense.publisherId) &&
    typeof slot === 'string' &&
    SLOT_ID.test(slot) &&
    !/^0+$/.test(slot)
  );
}

/**
 * Build the ad element for a slot. Pure apart from creating the node.
 * Returns null, and creates nothing, for provider "none", an unknown provider,
 * or a placeholder/misconfigured AdSense ID.
 * @param {import('./config/site.js').SiteConfig} config
 * @param {string} slotName key in `ads.adsense.slots`, e.g. "belowOutput"
 * @param {Document} [doc]
 * @returns {HTMLElement | null}
 */
export function renderAdSlot(config, slotName, doc = globalThis.document) {
  if (config.ads?.provider !== 'adsense' || !adsenseReady(config, slotName)) return null;
  const { publisherId, slots } = config.ads.adsense;
  const ins = doc.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.setAttribute('data-ad-client', publisherId);
  ins.setAttribute('data-ad-slot', slots[slotName]);
  ins.setAttribute('data-ad-format', 'auto');
  ins.setAttribute('data-full-width-responsive', 'true');
  return ins;
}

/**
 * True when the AdSense loader is already in the document (any `?client=`).
 * @param {Document} doc
 * @returns {boolean}
 */
function adScriptPresent(doc) {
  return doc.querySelector(`script[src^="${ADSENSE_SRC}"]`) !== null;
}

/**
 * Default script injector: appends the AdSense loader once.
 * @param {string} src
 * @param {Document} [doc]
 */
export function injectScript(src, doc = globalThis.document) {
  if (src.startsWith(ADSENSE_SRC) ? adScriptPresent(doc) : doc.querySelector(`script[src="${src}"]`)) return;
  const script = doc.createElement('script');
  script.async = true;
  script.src = src;
  script.crossOrigin = 'anonymous';
  doc.head.append(script);
}

/**
 * Mount a slot into its container. Order: render the slot, then wait for the
 * consent hook, and only then load the ad script. Idempotent: a container that
 * already holds an `ins.adsbygoogle` is reused (no new element, no second
 * push), and the loader script is never injected twice.
 * @param {import('./config/site.js').SiteConfig} config
 * @param {string} slotName
 * @param {HTMLElement} container
 * @param {{
 *   consent?: (config: import('./config/site.js').SiteConfig) => Promise<{ adsAllowed: boolean }>,
 *   inject?: (src: string) => void,
 * }} [deps] overridable for tests
 * @returns {Promise<{ mounted: boolean, scriptInjected: boolean, reused?: boolean }>}
 */
export async function mountAdSlot(config, slotName, container, deps = {}) {
  const { consent = ensureConsent, inject = injectScript } = deps;
  const doc = container.ownerDocument;
  if (container.querySelector('ins.adsbygoogle')) return { mounted: true, scriptInjected: false, reused: true };
  const el = renderAdSlot(config, slotName, doc);
  if (!el) return { mounted: false, scriptInjected: false };
  container.append(el);
  container.hidden = false;
  const { adsAllowed } = await consent(config);
  if (!adsAllowed) return { mounted: true, scriptInjected: false };
  // Another slot may already have loaded the script; each new unit still needs its push.
  const scriptInjected = !adScriptPresent(doc);
  if (scriptInjected) inject(`${ADSENSE_SRC}?client=${encodeURIComponent(config.ads.adsense.publisherId)}`);
  const win = /** @type {any} */ (doc.defaultView ?? globalThis);
  (win.adsbygoogle = win.adsbygoogle || []).push({});
  return { mounted: true, scriptInjected };
}
