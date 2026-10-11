import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Regenerates the README screenshots from a running build.
 *
 *   npm run build && npm run preview      # in one shell
 *   node scripts/capture-screenshots.mjs  # in another
 *
 * Screenshots contain live market data — they are point-in-time.
 */

const base = process.env.BASE ?? 'http://127.0.0.1:4173';
const outDir = 'docs/screenshots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function shot(name, route, opts = {}) {
  const { width = 1600, height = 1000, wait = 20000, action } = opts;
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${base}/${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(wait);
  if (action) await action(page);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await page.close();
  console.log(`✓ ${name}`);
}

await shot('markets', '#/', { wait: 24_000 });
await shot('screener', '#/screener', { wait: 20_000 });
await shot('token', '#/token/So11111111111111111111111111111111111111112', { wait: 22_000 });
await shot('flows', '#/flows', { wait: 22_000 });
await shot('wallet', '#/wallet/5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', { wait: 22_000 });
await shot('settings', '#/settings', { wait: 12_000 });
await shot('markets-mobile', '#/', { width: 430, height: 880, wait: 24_000 });
await shot('palette', '#/', {
  wait: 20_000,
  action: async (page) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(600);
    await page.getByLabel('Command input').fill('TOK');
    await page.waitForTimeout(800);
  },
});

await browser.close();
console.log('done');