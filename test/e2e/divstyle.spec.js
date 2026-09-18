import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame } from './helpers.js';

// Das Geteilt-Zeichen ist reine Anzeige (gerechnet wird immer mit '/'). Der
// Obelus ist in vielen Schriften so eng gesetzt, dass er auf kleinen Feldern wie
// ein Plus aussieht (gemeldet) — deshalb selbst gezeichnet, und es gibt die
// beiden schriftunabhaengigen Alternativen ':' und '/'.
test.describe('Geteilt-Zeichen', () => {
  // Ein Brett mit garantierter Division: die leichten Stufen rechnen nur mit
  // + und -, „schwer" teilt praktisch immer (15 Rechnungen). Trifft es doch mal
  // keins, holt ein Neuladen ein frisches Brett — und bringt uns nebenbei zurueck
  // auf den Home-Screen, den startNewGame voraussetzt.
  async function spielMitDivision(page, neuLaden = false) {
    for (let versuch = 0; versuch < 4; versuch++) {
      if (versuch || neuLaden) await gotoApp(page);
      await startNewGame(page, 'schwer');
      const hatDiv = await page.evaluate(() => window.__cns.state.puzzle.equations.some((e) => (e.ops || []).includes('/')));
      if (hatDiv) return true;
    }
    return false;
  }

  test('fragt einmalig beim Spielstart und merkt sich die Wahl', async ({ page }) => {
    test.setTimeout(120000);
    await gotoApp(page);
    // gotoApp belegt divStyle fuer alle anderen Tests vor — hier den echten
    // Erstzustand wiederherstellen: noch NIE gewaehlt.
    await page.evaluate(() => window.__cns.setSetting('divStyle', null));
    expect(await spielMitDivision(page), 'kein Brett mit Division gefunden').toBe(true);

    const popup = page.locator('.modal-bg .modal', { hasText: 'Geteilt-Zeichen' });
    await expect(popup).toBeVisible();
    await popup.getByText('Doppelpunkt').click();

    expect(await page.evaluate(() => window.__cns.state.settings.divStyle)).toBe('colon');
    await expect(page.locator('.modal-bg')).toHaveCount(0);
    // Das Brett zeigt jetzt ':' und keinen gezeichneten Obelus mehr.
    await expect(page.locator('.board .opcell', { hasText: ':' }).first()).toBeVisible();
    expect(await page.locator('.board .op-obelus').count(), 'kein Obelus mehr').toBe(0);

    // Neustart der App + zweites Spiel: die Wahl haelt, keine erneute Frage.
    expect(await spielMitDivision(page, true)).toBe(true);
    expect(await page.evaluate(() => window.__cns.state.settings.divStyle), 'Wahl ueberlebt den Neustart').toBe('colon');
    await expect(page.locator('.modal-bg')).toHaveCount(0);
  });

  test('ohne Wahl zeichnet das Brett den Obelus selbst', async ({ page }) => {
    test.setTimeout(120000);
    await gotoApp(page);
    await page.evaluate(() => window.__cns.setSetting('divStyle', null));
    expect(await spielMitDivision(page)).toBe(true);
    await page.evaluate(() => { window.__cns.state.modal = null; });
    const obelus = page.locator('.board .op-obelus').first();
    await expect(obelus).toBeVisible();
    // Kein Schriftzeichen, sondern gezeichnet: die Punkte sitzen als
    // Pseudo-Elemente deutlich weiter aussen als im Font-Obelus.
    const mass = await obelus.evaluate((el) => {
      const s = getComputedStyle(el, '::before');
      return { text: el.textContent, punktOben: s.top, hoehe: el.getBoundingClientRect().height };
    });
    expect(mass.text, 'kein Textinhalt — reine Zeichnung').toBe('');
    expect(mass.hoehe).toBeGreaterThan(0);
  });

  test('die Einstellung laesst sich spaeter aendern und wirkt sofort', async ({ page }) => {
    test.setTimeout(120000);
    await gotoApp(page);
    expect(await spielMitDivision(page)).toBe(true);
    await page.evaluate(() => { window.__cns.setSetting('divStyle', 'obelus'); window.__cns.state.modal = null; });
    expect(await page.locator('.board .op-obelus').count()).toBeGreaterThan(0);

    await page.evaluate(() => window.__cns.setSetting('divStyle', 'slash'));
    expect(await page.locator('.board .op-obelus').count(), 'Umschalten wirkt am laufenden Brett').toBe(0);
    await expect(page.locator('.board .opcell', { hasText: '/' }).first()).toBeVisible();
  });
});
