/* Captures fleet-tiles at its three zoom bands (far/mid/near) by dispatching
   pinch-wheel events. Usage: node capture-tiles-bands.mjs */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const launchOpts = existsSync('/Applications/Google Chrome.app')
  ? { channel: 'chrome', headless: true }
  : { headless: true };

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

async function zoomUntil(band, deltaY, maxTicks = 80) {
  for (let i = 0; i < maxTicks; i++) {
    const current = await page.evaluate((dy) => {
      const stage = document.querySelector('.stage');
      stage.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: dy, ctrlKey: true, clientX: 620, clientY: 500,
          bubbles: true, cancelable: true,
        }),
      );
      return stage.dataset.zoom;
    }, deltaY);
    if (current === band) return current;
  }
  return page.evaluate(() => document.querySelector('.stage').dataset.zoom);
}

for (const [name, band, deltaY] of [
  ['fleet-tiles-far', 'far', 60],
  ['fleet-tiles-near', 'near', -60],
]) {
  await page.goto(`file://${path.join(here, 'fleet-tiles.html')}`);
  await page.waitForTimeout(900);
  const reached = await zoomUntil(band, deltaY);
  await page.waitForTimeout(band === 'near' ? 2200 : 400);
  await page.screenshot({ path: path.join(here, `${name}.png`) });
  console.log(`${name}.png captured (band: ${reached})`);
}
await browser.close();
