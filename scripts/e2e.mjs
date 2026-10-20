// Headless proof: build, serve with `vite preview`, drive the real UI in the
// system Chrome, and verify the downloaded share card is a real PNG.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, copyFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { resolveBase, resolveSiteName, resolveSlug, resolveWatermark } from '../src/config/site.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const CHROME = '/usr/bin/google-chrome';
const siteConfig = JSON.parse(await readFile(path.join(root, 'src', 'config', 'site.json'), 'utf8'));
const PARODY = 'Parody. Not affiliated with or endorsed by Rosetta Stone.';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {Promise<number>} a free TCP port on 127.0.0.1 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Poll until the URL answers or time runs out.
 * @param {string} url
 * @param {number} timeoutMs
 */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not answer at ${url} within ${timeoutMs}ms`);
}

/** @param {boolean} cond @param {string} message */
function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

/**
 * Parse width/height from the IHDR chunk that must follow the PNG signature.
 * @param {Buffer} buf
 */
function readPngSize(buf) {
  assert(buf.subarray(0, 8).equals(PNG_SIGNATURE), 'file starts with the PNG signature');
  assert(buf.toString('ascii', 12, 16) === 'IHDR', 'first chunk is IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  console.log('e2e: vite build');
  const build = spawnSync(process.execPath, [viteBin, 'build'], { cwd: root, stdio: 'inherit' });
  assert(build.status === 0, `vite build exited ${build.status}`);

  const port = await freePort();
  // The default build uses the deploy base (e.g. /<repo>/), and so does preview.
  const base = resolveBase(siteConfig, process.env);
  const url = `http://127.0.0.1:${port}${base}`;
  console.log(`e2e: vite preview on ${url}`);
  const preview = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
  const killPreview = () => {
    if (preview.exitCode === null && preview.pid) {
      try {
        process.kill(-preview.pid, 'SIGTERM');
      } catch {
        preview.kill('SIGTERM');
      }
    }
  };
  process.on('exit', killPreview);

  let browser;
  try {
    await waitForServer(url, 15000);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const page = await context.newPage();
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });
    // Record every request; anything not on localhost is a failure.
    /** @type {string[]} */
    const requests = [];
    page.on('request', (req) => requests.push(req.url()));
    const isLocal = (/** @type {string} */ u) => {
      if (u.startsWith('data:') || u.startsWith('blob:')) return true;
      const { hostname } = new URL(u);
      return hostname === '127.0.0.1' || hostname === 'localhost';
    };

    await page.goto(url);
    const title = await page.title();
    console.log(`e2e: page title = ${title}`);
    const siteName = resolveSiteName(siteConfig);
    assert(title === siteName, `page title is "${siteName}" from site.json`);
    assert((await page.locator('h1').textContent()) === siteName, 'header shows the site name');
    const tagline = (await page.getByTestId('tagline').textContent()) ?? '';
    console.log(`e2e: tagline = ${tagline}`);
    assert(tagline === siteConfig.site.tagline, 'tagline comes from site.json');
    const footerDisclaimer = await page.locator('footer [data-testid="parody-disclaimer"]').textContent();
    assert(footerDisclaimer === PARODY, 'footer carries the parody disclaimer');
    const assetUrls = await page.evaluate(() =>
      [...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map(
        (el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '',
      ),
    );
    console.log(`e2e: asset URLs = ${assetUrls.join(', ')}`);
    assert(assetUrls.length > 0 && assetUrls.every((u) => u.startsWith(`${base}assets/`)), `assets load from ${base}assets/`);

    // The ad slot container comes after the output and its action buttons.
    const slotAfterOutput = await page.evaluate(() => {
      const slot = document.querySelector('[data-testid="ad-slot"]');
      if (!slot) return false;
      return ['output', 'copy', 'download'].every((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return Boolean(el && el.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
    });
    assert(slotAfterOutput, 'ad slot container follows the output and actions in document order');
    const adCount = await page.locator('ins.adsbygoogle, script[src*="googlesyndication"]').count();
    assert(adCount === 0, 'no ad element or ad script with the default config');

    const privacy = await fetch(new URL('privacy.html', url));
    const privacyHtml = privacy.ok ? await privacy.text() : '';
    assert(privacyHtml.includes('privacy policy') && privacyHtml.includes(siteName), 'privacy.html is served with the site name');
    assert(privacyHtml.includes(PARODY), 'privacy.html carries the parody disclaimer');
    assert((await page.getByTestId('privacy-link').getAttribute('href')) === 'privacy.html', 'footer links privacy.html');
    const sample = 'OMG this brunch is lit lol. My bestie is literally on fleek, haha we need to do this again';
    await page.getByTestId('from-select').selectOption('millennial');
    await page.getByTestId('input').fill(sample);
    await page.getByTestId('to-select').selectOption('genz');
    const output = page.getByTestId('output');
    await page.waitForFunction(
      (s) => {
        const text = document.querySelector('[data-testid="output"]')?.textContent ?? '';
        return text !== '' && text !== s;
      },
      sample,
    );
    const converted = (await output.textContent()) ?? '';
    console.log(`e2e: input  = ${sample}`);
    console.log(`e2e: output = ${converted}`);
    assert(converted !== sample, 'output differs from input');
    assert(/💀|😭/u.test(converted), 'Gen Z output contains 💀 or 😭');

    // Copy writes the output to the clipboard.
    await page.getByTestId('copy').click();
    await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Copied!');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    console.log(`e2e: clipboard = ${clipboard}`);
    assert(clipboard === converted, 'Copy puts the output on the clipboard');

    // Swap exchanges the selects and re-converts the output back.
    await page.getByTestId('swap').click();
    const swapped = await page.evaluate(() => ({
      from: /** @type {HTMLSelectElement} */ (document.querySelector('[data-testid="from-select"]')).value,
      to: /** @type {HTMLSelectElement} */ (document.querySelector('[data-testid="to-select"]')).value,
      input: /** @type {HTMLTextAreaElement} */ (document.querySelector('[data-testid="input"]')).value,
    }));
    assert(swapped.from === 'genz' && swapped.to === 'millennial', `swap exchanges the selects (got ${swapped.from} -> ${swapped.to})`);
    assert(swapped.input === converted, 'swap moves the output into the input');
    await page.waitForFunction(
      (c) => (document.querySelector('[data-testid="output"]')?.textContent ?? c) !== c,
      converted,
    );
    const back = (await output.textContent()) ?? '';
    console.log(`e2e: after swap = ${back}`);
    assert(!/💀|😭/u.test(back), 'swap re-converts the Gen Z text to Millennial');

    // Plain English is the last of six options in both selects, and it
    // decodes Gen Z slang and laughs into plain words.
    for (const id of ['from-select', 'to-select']) {
      const labels = await page.getByTestId(id).locator('option').allTextContents();
      assert(labels.length === 6 && labels.at(-1) === 'Plain English', `${id} lists Plain English last of 6 (got ${labels.join(', ')})`);
    }
    const genzInput = "no bc it's giving main character, real 💀";
    await page.getByTestId('from-select').selectOption('genz');
    await page.getByTestId('to-select').selectOption('plain');
    await page.getByTestId('input').fill(genzInput);
    await page.waitForFunction(
      (s) => {
        const text = document.querySelector('[data-testid="output"]')?.textContent ?? '';
        return text !== '' && text !== s;
      },
      genzInput,
    );
    const plain = (await output.textContent()) ?? '';
    console.log(`e2e: Gen Z -> Plain English = ${plain}`);
    assert(/\bthe star of the show\b/.test(plain), 'Plain English output contains the decoded plain word');
    assert(!/💀|😭/u.test(plain), 'Plain English output has no 💀 or 😭');

    // Example cycles the input through different seed samples.
    const seen = new Set();
    for (let i = 0; i < 3; i += 1) {
      const before = await page.getByTestId('input').inputValue();
      await page.getByTestId('example').click();
      const next = await page.getByTestId('input').inputValue();
      assert(next !== '' && next !== before, `Example changes the input (click ${i + 1})`);
      seen.add(next);
      await page.waitForFunction(() => (document.querySelector('[data-testid="output"]')?.textContent ?? '') !== '');
    }
    console.log(`e2e: example cycled ${seen.size} distinct samples`);
    assert(seen.size === 3, 'Example cycles to a different sample each click');
    const adChildren = await page.getByTestId('ad-slot').evaluate((el) => el.children.length);
    assert(adChildren <= 1, `ad slot holds at most one child after Swap/Example (got ${adChildren})`);

    // Back to the reference conversion for the share card.
    await page.getByTestId('from-select').selectOption('millennial');
    await page.getByTestId('to-select').selectOption('genz');
    await page.getByTestId('input').fill(sample);
    await page.waitForFunction(
      (c) => document.querySelector('[data-testid="output"]')?.textContent === c,
      converted,
    );

    // Capture the card's watermark as soon as the card is attached, before export.
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      new MutationObserver(() => {
        const mark = document.querySelector('[data-testid="share-card-watermark"]');
        if (mark && w.__e2eWatermark === undefined) {
          w.__e2eWatermark = mark.textContent;
          w.__e2eCardTitle = document.querySelector('.share-card__title')?.textContent;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    const watermark = await page.evaluate(() => /** @type {any} */ (window).__e2eWatermark);
    const cardTitle = await page.evaluate(() => /** @type {any} */ (window).__e2eCardTitle);
    console.log(`e2e: card title = ${cardTitle}`);
    assert(cardTitle === siteName, `card title is "${siteName}"`);
    const expectedWatermark = resolveWatermark(siteConfig);
    console.log(`e2e: card watermark = ${watermark}`);
    assert(Boolean(expectedWatermark) && watermark === expectedWatermark, `card watermark is "${expectedWatermark}"`);
    const suggested = download.suggestedFilename();
    console.log(`e2e: download suggested name = ${suggested}`);
    assert(suggested === `${resolveSlug(siteConfig)}-millennial-to-genz.png`, 'download file name');
    const downloadedPath = await download.path();
    assert(Boolean(downloadedPath), 'download saved');

    await mkdir(artifacts, { recursive: true });
    const cardPath = path.join(artifacts, 'share-card.png');
    await copyFile(/** @type {string} */ (downloadedPath), cardPath);
    const { width, height } = readPngSize(await readFile(cardPath));
    console.log(`e2e: PNG IHDR width=${width} height=${height}`);
    assert(width > 0 && height > 0, 'PNG dimensions are positive');

    const appPath = path.join(artifacts, 'app.png');
    await page.screenshot({ path: appPath, fullPage: true });
    for (const p of [cardPath, appPath]) console.log(`e2e: wrote ${path.relative(root, p)} (${(await stat(p)).size} bytes)`);

    assert(pageErrors.length === 0, `no page errors (got: ${pageErrors.join(' | ')})`);
    const external = requests.filter((u) => !isLocal(u));
    console.log(`e2e: ${requests.length} requests recorded, ${external.length} to non-localhost hosts`);
    assert(external.length === 0, `no external requests (got: ${external.join(', ')})`);
    assert(!requests.some((u) => u.includes('googlesyndication')), 'no request to googlesyndication');
    console.log('e2e: PASS');
  } finally {
    if (browser) await browser.close();
    killPreview();
  }
}

main().catch((err) => {
  console.error(`e2e: FAIL ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
});
