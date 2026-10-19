// @vitest-environment happy-dom
// UI wiring with ads switched on: the slot is mounted once at startup, and the
// Swap/Example handlers never mount another unit.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mountCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/config/site.json', async (importOriginal) => {
  const config = structuredClone(/** @type {any} */ (await importOriginal()).default);
  config.ads.provider = 'adsense';
  config.ads.adsense.publisherId = 'ca-pub-1234567890123456';
  config.ads.adsense.slots.belowOutput = '9876543210';
  return { default: config };
});

vi.mock('../src/ads.js', async (importOriginal) => {
  const actual = /** @type {typeof import('../src/ads.js')} */ (await importOriginal());
  return {
    ...actual,
    mountAdSlot: (/** @type {Parameters<typeof actual.mountAdSlot>} */ ...args) => {
      mountCalls.count += 1;
      return actual.mountAdSlot(...args);
    },
  };
});

describe('main.js with an AdSense config', () => {
  it('mounts one ad unit, however often Swap and Example are clicked', async () => {
    const html = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    document.body.innerHTML = body.replace(/<script\b[^>]*><\/script>/g, '');
    // happy-dom has no Option constructor; main.js uses it to fill the selects.
    if (typeof globalThis.Option !== 'function') {
      /** @type {any} */ (globalThis).Option = function Option(/** @type {string} */ text, /** @type {string} */ value) {
        const option = document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
      };
    }
    await import('../src/main.js');

    const slot = /** @type {HTMLElement} */ (document.querySelector('[data-testid="ad-slot"]'));
    await vi.waitFor(() => expect(slot.querySelectorAll('ins.adsbygoogle')).toHaveLength(1));

    const click = (/** @type {string} */ id) =>
      /** @type {HTMLElement} */ (document.querySelector(`[data-testid="${id}"]`)).click();
    for (let i = 0; i < 3; i += 1) {
      click('swap');
      click('example');
    }
    await new Promise((r) => setTimeout(r, 50));

    expect(mountCalls.count).toBe(1);
    expect(slot.children).toHaveLength(1);
    // Consent stays denied in the stub, so no loader script is added.
    expect(document.querySelectorAll('script[src*="googlesyndication"]')).toHaveLength(0);
  });
});
