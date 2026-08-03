/* Screenshots the control-room mocks with the repo's playwright-core.
   Uses the full cached chromium (not the headless shell, which may be absent).
   Usage: node capture-control-room.mjs [name ...]   (default: all three) */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['fleet-map', 'fleet-strips', 'mission-control', 'fleet-hexmap'];

const fullChromium = path.join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
);

const launchOpts = existsSync(fullChromium)
  ? { executablePath: fullChromium, headless: true }
  : existsSync('/Applications/Google Chrome.app')
    ? { channel: 'chrome', headless: true }
    : { headless: true };
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
for (const name of names) {
  const file = path.join(here, `${name}.html`);
  if (!existsSync(file)) {
    console.error(`skip ${name}: no ${file}`);
    continue;
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${file}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(here, `${name}.png`) });
  console.log(`${name}.png captured${errors.length ? ` — PAGE ERRORS: ${errors.join(' | ')}` : ''}`);
  errors.length = 0;
}
await browser.close();
