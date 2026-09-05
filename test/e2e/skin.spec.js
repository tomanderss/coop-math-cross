import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame } from './helpers.js';

// Verifies the 1.0 "dynamic skin": unlock via the secret code, then the
// rotating gradient ring/outline actually renders (conic-gradient background on
// the marked cell's ::after, board carries the skin-dynamic/style classes).

test.describe('dynamic skin', () => {
  test('the secret code unlocks the skin and the editor appears', async ({ page }) => {
    await gotoApp(page);
    // EXKLUSIVITÄT: Neuinstallationen bekommen den Skin NICHT mehr automatisch —
    // nur Bestandsspieler mit 1.0-Versionssprung (bzw. Code/Admin-Geschenk).
    expect(await page.evaluate(() => !!window.__cns.state.inventory.dynamicColor)).toBe(false);

    await page.evaluate(() => { const s = window.__cns.state; s.screen = 'settings'; s.settingsTab = 'farbe'; });
    const codeInput = page.getByPlaceholder('Freischaltcode');
    await expect(codeInput).toBeVisible();

    // A wrong code does not unlock.
    await codeInput.fill('nope');
    await page.locator('.account-search .btn-primary').click();
    expect(await page.evaluate(() => !!window.__cns.state.inventory.dynamicColor)).toBe(false);

    // The real code (case/space-insensitive) unlocks it.
    await codeInput.fill('  supporter SEIT tag 1 ');
    await page.locator('.account-search .btn-primary').click();
    await expect.poll(() => page.evaluate(() => !!window.__cns.state.inventory.dynamicColor)).toBe(true);

    // Editor + live preview now render.
    await expect(page.locator('.skin-preview')).toBeVisible();
  });

  test('the unlocked skin renders a conic-gradient ring on a placed tile in-game', async ({ page }) => {
    await gotoApp(page);
    // Unlock directly (equivalent to the version-jump/code path) and start a game.
    await page.evaluate(() => {
      const s = window.__cns.state;
      s.inventory = { dynamicColor: { acquiredAt: 1, source: 'test' } };
      s.settings.skinEnabled = true; s.settings.skinStyle = 'gradient'; s.settings.skinSpeed = 2;
    });
    await startNewGame(page, 'sehrleicht');

    // Einen Stein legen — er trägt den Skin.
    await page.evaluate(() => window.__cns.placeOne());

    // Board carries the skin classes.
    await expect(page.locator('.board.skin-dynamic.skin-style-gradient')).toBeVisible();

    // Das ::after des gelegten Steins malt einen conic-gradient (der Ring).
    const bg = await page.evaluate(() => {
      const cell = document.querySelector('.board .cell.filled.coop-mark');
      return cell ? getComputedStyle(cell, '::after').backgroundImage : null;
    });
    expect(bg).toContain('conic-gradient');
  });
});
