import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame } from './helpers.js';

// Kern des Features: ein NEUES Spiel darf einen alten Stand nicht mehr
// ueberschreiben. Frueher gab es genau einen Solo-Slot — wer ein neues Spiel
// anfing, verlor den vorherigen Fortschritt ersatzlos.
// Legt ein paar Steine — aber NIE alle: ein fertig gelöstes Rätsel beendet die
// Partie, und eine beendete Partie räumt ihren Spielstand ab (genau das prüft
// home.spec.js). Der Stand muss hier fortsetzbar BLEIBEN.
async function playAFewCells(page, n = 3) {
  const left = await page.evaluate(() => window.__cns.state.tray.filter((t) => !t.used).length);
  const moves = Math.max(1, Math.min(n, left - 2));
  await page.evaluate((count) => {
    for (let i = 0; i < count; i++) if (!window.__cns.placeOne()) break;
  }, moves);
  // Autosave ist auf 400 ms gedrosselt — ein weiterer Zug DANACH schreibt sicher.
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__cns.placeOne());
  await page.waitForTimeout(250);
  const gid = await page.evaluate(() => window.__cns.state.gameId);
  await page.waitForFunction((id) => {
    const g = JSON.parse(localStorage.getItem('cmc_active_game') || 'null');
    return !!g && g.gameId === id;
  }, gid, { timeout: 5000 });
}

test.describe('Spielstand-Bibliothek', () => {
  test('ein zweites Spiel ueberschreibt den ersten Stand NICHT', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page);
    await playAFewCells(page);
    const first = await page.evaluate(() => window.__cns.state.gameId);

    // Zurueck ins Hauptmenue (wie App schliessen/oeffnen) und ein ZWEITES Spiel starten.
    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await startNewGame(page);
    await playAFewCells(page);
    const second = await page.evaluate(() => window.__cns.state.gameId);
    expect(second).not.toBe(first);

    const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('cmc_saves') || '[]').map((g) => g.id));
    expect(ids, 'beide Partien muessen in der Bibliothek liegen').toContain(first);
    expect(ids).toContain(second);
  });

  test('die Liste zeigt Fortschritt und laesst einen Stand loeschen', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page);
    await playAFewCells(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await startNewGame(page);
    await playAFewCells(page);

    // Ins Hauptmenue und die Bibliothek oeffnen.
    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await page.locator('.saves-expand').click();
    await expect(page.locator('.saves-modal')).toBeVisible();

    const rows = page.locator('.save-row');
    await expect(rows).toHaveCount(2);
    // Jede Zeile traegt einen Fortschrittsbalken mit echter Breite.
    const pct = await page.evaluate(() => Array.from(document.querySelectorAll('.save-bar i')).map((el) => el.style.width));
    expect(pct.every((w) => /^\d+%$/.test(w))).toBe(true);

    // Die Zeile zeigt die verbleibenden LEBEN als Herzen — nicht die Fehlerzahl
    // (Nutzerwunsch): drei Herzen insgesamt, die verbrauchten als leere Kontur.
    const hearts = await page.evaluate(() => {
      const row = document.querySelector('.save-row');
      const hs = Array.from(row.querySelectorAll('.save-hearts .heart'));
      const g = window.__cns.state.saves[0];
      return { total: hs.length, full: hs.filter((h) => !h.classList.contains('empty')).length, lives: g.lives, max: g.maxLives };
    });
    expect(hearts.total).toBe(hearts.max);
    expect(hearts.full).toBe(hearts.lives);
    // Und die Fehlerzahl steht NICHT mehr in der Zeile.
    await expect(page.locator('.save-row').first().locator('.save-mistakes')).toHaveCount(0);

    // Loeschen fragt nach und entfernt danach genau EINEN Eintrag.
    await rows.first().locator('.save-del').click();
    await expect(page.locator('.modal-bg', { hasText: 'Spielstand löschen?' })).toBeVisible();
    await page.locator('.modal .btn-danger').first().click();
    await expect(page.locator('.save-row')).toHaveCount(1);
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem('cmc_saves') || '[]').length);
    expect(left).toBe(1);
  });

  test('ein gespeicherter Stand laesst sich gezielt fortsetzen', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page);
    await playAFewCells(page);
    const older = await page.evaluate(() => window.__cns.state.gameId);
    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await startNewGame(page);
    await playAFewCells(page);

    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await page.locator('.saves-expand').click();
    // Den AELTEREN Stand waehlen (er steht hinten, weil neueste zuerst kommen).
    await page.locator('.save-row').last().locator('.save-main').click();
    await page.waitForSelector('.screen.game');
    expect(await page.evaluate(() => window.__cns.state.gameId)).toBe(older);
  });

  // Regression (gemeldet, reproduzierbar): mit zwei Staenden genau den loeschen,
  // der gerade im Aktivspiel-Slot liegt — also den, den der Fortsetzen-Knopf
  // anbietet. Der Knopf verschwand danach KOMPLETT, obwohl der zweite Stand noch
  // da war; erst ein Neustart brachte ihn zurueck. Ursache: refreshResume las nur
  // den Slot und fiel nicht auf die Bibliothek zurueck.
  test('nach dem Loeschen des aktiven Stands bleibt der Fortsetzen-Knopf — mit dem naechsten Stand', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page);
    await playAFewCells(page);
    const first = await page.evaluate(() => window.__cns.state.gameId);

    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await startNewGame(page);
    await playAFewCells(page);
    const second = await page.evaluate(() => window.__cns.state.gameId);

    // Zurueck ins Menue: der Knopf bietet den zuletzt gespielten Stand an.
    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await expect(page.locator('.btn-resume').first()).toBeVisible();
    expect(await page.evaluate(() => window.__cns.state.resumeAvailable.gameId)).toBe(second);

    // Genau diesen Stand ueber die echte Oberflaeche loeschen (ohne Neuladen!).
    await page.locator('.saves-expand').click();
    await expect(page.locator('.saves-modal')).toBeVisible();
    // Der laufende/juengste Stand steht oben.
    await page.locator('.save-row').first().locator('.save-del').click();
    await page.locator('.confirm-actions .btn-danger').click();
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => ({
      resume: window.__cns.state.resumeAvailable && window.__cns.state.resumeAvailable.gameId,
      saves: window.__cns.state.saves.map((g) => g.id),
    }));
    expect(after.saves, 'der geloeschte Stand ist weg').not.toContain(second);
    expect(after.saves, 'der andere Stand bleibt').toContain(first);
    expect(after.resume, 'der Knopf muss sofort den verbliebenen Stand anbieten').toBe(first);
    await expect(page.locator('.btn-resume').first()).toBeVisible();
  });

  // Regression (gemeldet): mit GENAU EINEM Stand war die Liste gar nicht
  // erreichbar — der Zugang erschien erst ab zwei Staenden, also liess sich der
  // eine vorhandene Stand nicht loeschen, ohne vorher einen zweiten anzulegen.
  test('mit nur EINEM Stand ist die Liste erreichbar und der Stand loeschbar', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page);
    await playAFewCells(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.__cns);
    await page.waitForSelector('.screen.home');
    expect(await page.evaluate(() => window.__cns.state.saves.length)).toBe(1);

    const open = page.locator('.saves-expand');
    await expect(open).toBeVisible();
    await open.click();
    await expect(page.locator('.saves-modal')).toBeVisible();
    await expect(page.locator('.save-row')).toHaveCount(1);

    await page.locator('.save-row').first().locator('.save-del').click();
    await page.locator('.confirm-actions .btn-danger').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__cns.state.saves.length)).toBe(0);
    expect(await page.evaluate(() => window.__cns.state.resumeAvailable)).toBe(null);
  });
});
