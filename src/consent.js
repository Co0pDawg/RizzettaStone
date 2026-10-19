/**
 * Consent hook (stub). It never loads a vendor script.
 *
 * Where a real CMP goes: before any ad code runs, load a Google-certified CMP
 * (Google "Privacy & messaging" / Funding Choices, or a certified third-party
 * CMP that speaks IAB TCF v2.2) from this function. Then wait for its consent
 * signal (for TCF, `__tcfapi('addEventListener', 2, cb)` until
 * `tcData.eventStatus` is `tcloaded` or `useractioncomplete`) and resolve
 * `adsAllowed` from it. The order is fixed: CMP first, then the consent
 * signal, then the ad script (see `mountAdSlot` in ads.js). Personalized vs.
 * non-personalized ads are decided by the CMP signal that AdSense reads itself.
 *
 * Until that exists, ads stay off: with `consent.enabled` false, or with the
 * `"placeholder"` CMP, this resolves `{ adsAllowed: false }`.
 *
 * @param {import('./config/site.js').SiteConfig} config
 * @returns {Promise<{ adsAllowed: boolean }>}
 */
export async function ensureConsent(config) {
  if (!config.consent?.enabled) return { adsAllowed: false };
  // consent.enabled is true but no real CMP is wired in yet.
  return { adsAllowed: false };
}
