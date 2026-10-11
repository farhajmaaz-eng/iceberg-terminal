import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end smoke tests.
 *
 * These run against the production build and exercise the flows a user
 * actually performs: navigate, open the command palette, run a command, search,
 * watch a token, and hit the settings screen.
 *
 * They do NOT assert on live market values, which change constantly. They
 * assert on structure, routing and the data-integrity guarantees the app makes.
 */

const MINT = 'So11111111111111111111111111111111111111112';
const WALLET = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

async function goto(page: Page, hash = '#/') {
  await page.goto(`/${hash}`);
  await page.waitForLoadState('domcontentloaded');
}

/** Accept the app even when a provider is unreachable — demo mode is valid. */
async function waitForShell(page: Page) {
  await expect(page.getByRole('banner')).toBeVisible({ timeout: 20_000 });
}

/** Palette locators are intentionally strict-mode safe. */
const cmdInput = (page: Page) => page.getByLabel('Command input');
const anyText = (page: Page, re: RegExp) => page.getByText(re).first();

test.describe('Iceberg Terminal', () => {
  test('loads the workstation with the shell, nav and header', async ({ page }, testInfo) => {
    await goto(page);
    await waitForShell(page);

    await expect(page.getByLabel('Global search')).toBeVisible();
    await expect(page.getByLabel('Open command palette')).toBeVisible();

    // The wordmark lives in the desktop sidebar, which is intentionally hidden
    // on mobile in favour of the bottom navigation.
    if (testInfo.project.name === 'mobile') {
      await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'MKT' })).toBeVisible();
    } else {
      await expect(anyText(page, /^ICEBERG$/)).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    }
  });

  test('navigates between primary modules', async ({ page }) => {
    await goto(page);
    await waitForShell(page);

    for (const [label, marker] of [
      ['Screener', 'Token screener'],
      ['Activity', 'On-chain activity'],
      ['Flows', 'Market signals'],
      ['News', 'News & research'],
      ['Watchlist', 'Watched public wallets'],
      ['Settings', 'Data providers'],
    ] as const) {
      const nav = page.getByRole('navigation').first().getByRole('link', { name: label });
      if (await nav.isVisible().catch(() => false)) {
        await nav.click();
      } else {
        await page.goto(`/#/${label.toLowerCase()}`);
      }
      await expect(anyText(page, new RegExp(marker))).toBeVisible({ timeout: 20_000 });
    }
  });

  test('opens the command palette with the keyboard and lists commands', async ({ page }) => {
    await goto(page);
    await waitForShell(page);

    await page.keyboard.press('Control+k');
    const input = cmdInput(page);
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', /Type a command/i);

    await input.fill('SCRE');
    await expect(page.getByRole('option').filter({ hasText: 'SCREENER' }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/screener/);
  });

  test('runs TOKEN with a real mint and lands on the token view', async ({ page }) => {
    await goto(page);
    await waitForShell(page);

    await page.keyboard.press('Control+k');
    await cmdInput(page).fill(`TOKEN ${MINT}`);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/#/token/${MINT}`));
    await expect(anyText(page, /Token metadata/)).toBeVisible({ timeout: 20_000 });
    await expect(anyText(page, /Risk indicators/)).toBeVisible();
  });

  test('rejects a malformed TOKEN argument with a helpful message', async ({ page }) => {
    await goto(page);
    await waitForShell(page);

    await page.keyboard.press('Control+k');
    await cmdInput(page).fill('TOKEN NOT_A_MINT');
    await page.keyboard.press('Enter');

    await expect(anyText(page, /mint-address/i)).toBeVisible();
    await expect(page).not.toHaveURL(/token/);
  });

  test('toggles a token onto the watchlist from the command line', async ({ page }) => {
    await goto(page);
    await waitForShell(page);

    // USDC mint (44 base58 chars) — a real, valid mint that also exercises the
    // "symbol resolved from the provider" path.
    const target = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(target).toHaveLength(44);
    await page.keyboard.press('Control+k');
    await cmdInput(page).fill(`WATCH ${target}`);
    await page.keyboard.press('Enter');
    await expect(anyText(page, /Added to the active watchlist/i)).toBeVisible();

    await page.goto('/#/watchlist');
    // On mobile the desktop sidebar is hidden, so assert on the module itself.
    await expect(anyText(page, /Watched public wallets/i)).toBeVisible({ timeout: 15_000 });

    // The row must exist in the watchlist table and link to the token view.
    // Assert on the mint-derived link rather than a ticker, so the test does
    // not depend on which providers happened to resolve a symbol.
    const row = page.locator('table tbody tr', { has: page.locator(`a[href="#/token/${target}"]`) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator(`a[href="#/token/${target}"]`)).toBeVisible();
  });

  test('opens the wallet view for a public address', async ({ page }) => {
    await goto(page, `#/wallet/${WALLET}`);
    await expect(anyText(page, /SOL balance/)).toBeVisible({ timeout: 20_000 });
    await expect(anyText(page, /What this view does not show/)).toBeVisible();
  });

  test('renders the demo banner and DEMO badge when demo mode is forced', async ({ page }) => {
    await goto(page);
    await waitForShell(page);

    await page.keyboard.press('Control+k');
    await cmdInput(page).fill('DEMO ON');
    await page.keyboard.press('Enter');

    await expect(anyText(page, /Demo data/i)).toBeVisible({ timeout: 15_000 });
    await expect(anyText(page, /^demo mode$/)).toBeVisible();
  });

  test('settings page lists providers and BYOK affordances', async ({ page }) => {
    await goto(page, '#/settings');
    await expect(anyText(page, /^DexScreener$/)).toBeVisible({ timeout: 15_000 });
    await expect(anyText(page, /^GeckoTerminal$/)).toBeVisible();
    await expect(anyText(page, /^Birdeye$/)).toBeVisible();
    await expect(anyText(page, /^CryptoPanic$/)).toBeVisible();
    await expect(anyText(page, /^Solana JSON-RPC$/)).toBeVisible();
    await expect(anyText(page, /BYOK REQUIRED/i)).toBeVisible();
  });

  test('news shows a setup empty state rather than fabricated headlines', async ({ page }) => {
    await goto(page, '#/news');
    await expect(anyText(page, /No news provider configured/i)).toBeVisible({ timeout: 15_000 });
    await expect(anyText(page, /never invent them/i)).toBeVisible();
  });

  test('token logos load from the provider instead of falling back to identicons', async ({ page }) => {
    await goto(page, `#/token/${MINT}`);
    await expect(anyText(page, /Token metadata/)).toBeVisible({ timeout: 25_000 });

    // Regression: info.imageUrl is a plain string; reading it as an array made
    // every logo null, so only the generated identicon ever rendered.
    const img = page.locator('img').first();
    await expect(img).toBeVisible({ timeout: 25_000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^https:\/\//);
    expect(src).toContain('dexscreener.com');

    const loaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
    expect(loaded).toBe(true);
  });

  test('no storage warning appears in a healthy browser', async ({ page }) => {
    await goto(page, '#/');
    await waitForShell(page);
    await page.waitForTimeout(3000);
    // A blocked or full database raises this banner; a healthy one must not.
    await expect(page.getByText(/Local storage .*(unavailable|full)/i)).toHaveCount(0);
  });

  test('a locked credential vault blocks key entry', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Vault state is shared storage; desktop-only to keep the run isolated.');
    await goto(page, '#/settings');
    await expect(anyText(page, /^Birdeye$/)).toBeVisible({ timeout: 20_000 });

    const card = page.locator('div.border', { hasText: 'Birdeye' }).last();
    await card.scrollIntoViewIfNeeded();

    const keyInput = card.locator('input[type=password]').first();
    await keyInput.fill('e2e-test-key');
    await card.getByLabel(/passphrase/i).fill('e2e-passphrase');
    await card.getByRole('button', { name: /save key/i }).click();
    await expect(anyText(page, /vault unlocked/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /lock vault/i }).click();
    await expect(anyText(page, /vault locked/i)).toBeVisible({ timeout: 10_000 });

    // Regression: storing a key used to silently reopen a locked vault, so the
    // field must now be disabled and the reason shown.
    await card.scrollIntoViewIfNeeded();
    await expect(keyInput).toBeDisabled();
    await expect(card.getByText(/vault is locked/i)).toBeVisible();
    await expect(card.getByRole('button', { name: /save key/i })).toBeDisabled();

    // Clean up the credential this test created.
    await page.getByRole('button', { name: /clear vault/i }).click();
    await page.waitForTimeout(600);
  });
});