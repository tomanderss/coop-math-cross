import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame, playOneMove } from './helpers.js';

// Regression für den KERN-PERFORMANCEFIX (BoardGrid-/TrayBar-Child-Komponenten):
// App-Renders (Sekunden-Tick, HUD, Toasts) dürfen das Brett NICHT mitrendern —
// das war die gemeldete Tap-Latenz. window.__cns.boardRenders() zählt die
// tatsächlichen Brett-Renders.
test.describe('board render isolation', () => {
  test('timer ticks do NOT re-render the board; real moves do', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');

    // Ein paar Steine legen (realistischer Brettzustand).
    for (let i = 0; i < 3; i++) await playOneMove(page);
    await page.waitForTimeout(150);
    const r0 = await page.evaluate(() => window.__cns.boardRenders());
    expect(r0).toBeGreaterThan(0);

    // 1) Sekunden-Tick simulieren → Brett rendert NICHT.
    for (let i = 0; i < 5; i++) await page.evaluate(() => { window.__cns.state.elapsed += 1000; });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__cns.boardRenders())).toBe(r0);

    // 2) ECHTER Zug → Brett rendert (Korrektheits-Gegenprobe).
    await playOneMove(page);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__cns.boardRenders())).toBeGreaterThan(r0);
  });

  test('debounced settings persist still lands in localStorage', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page);
    await page.evaluate(() => window.__cns.setSetting('coopMyColor', '#123456'));
    // Entprellt (250 ms) — nach kurzer Wartezeit MUSS der Wert persistiert sein.
    await page.waitForTimeout(600);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cmc_settings') || '{}').coopMyColor);
    expect(stored).toBe('#123456');
  });
});
