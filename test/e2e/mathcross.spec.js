import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame, playOneMove, commitMistakes } from './helpers.js';

// Kern des Spiels: Steine per Drag & Drop ins Rechennetz, Tausch bei Kollision,
// Zurücklegen in den Vorrat — und die Fehler-Regel (nur eine vollständig
// falsche Rechnung zählt).
test.describe('Rechenkreuz: Steine legen', () => {
  async function dragTo(page, from, to) {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  }

  test('ein Stein lässt sich aus dem Vorrat auf ein Feld ziehen', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    const target = await page.evaluate(() => window.__cns.firstBlank());
    const tileIndex = await page.evaluate((v) => window.__cns.state.tray.findIndex((t) => !t.used && t.v === v), target.v);
    const tile = page.locator('.tray .tile').nth(tileIndex);
    const cell = page.locator(`.board .cell[data-r="${target.r}"][data-c="${target.c}"]`);
    await dragTo(page, tile, cell);
    expect(await page.evaluate(({ r, c }) => window.__cns.state.placed[r][c], target)).toBe(target.v);
    await expect(cell).toHaveClass(/filled/);
  });

  test('ein Stein lässt sich zurück in den Vorrat ziehen', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    const move = await playOneMove(page);
    const before = await page.evaluate(() => window.__cns.state.tray.filter((t) => !t.used).length);
    const cell = page.locator(`.board .cell[data-r="${move.r}"][data-c="${move.c}"]`);
    await dragTo(page, cell, page.locator('.tray'));
    expect(await page.evaluate(({ r, c }) => window.__cns.state.placed[r][c], move)).toBeNull();
    expect(await page.evaluate(() => window.__cns.state.tray.filter((t) => !t.used).length)).toBe(before + 1);
  });

  test('zwei Steine tauschen den Platz', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    const a = await playOneMove(page);
    const b = await playOneMove(page);
    const cellA = page.locator(`.board .cell[data-r="${a.r}"][data-c="${a.c}"]`);
    const cellB = page.locator(`.board .cell[data-r="${b.r}"][data-c="${b.c}"]`);
    await dragTo(page, cellA, cellB);
    const after = await page.evaluate(({ a, b }) => ({
      a: window.__cns.state.placed[a.r][a.c], b: window.__cns.state.placed[b.r][b.c],
    }), { a, b });
    expect(after).toEqual({ a: b.v, b: a.v });
  });

  test('eine falsch platzierte Zahl ist KEIN Fehler, solange keine Rechnung falsch wird', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    // Einen Stein auf ein Feld legen, dessen Rechnungen danach noch offen sind.
    const ok = await page.evaluate(() => {
      const { state, placeAt } = window.__cns;
      const p = state.puzzle;
      const cellsOf = (eq) => { const out = []; for (let i = 0; i <= eq.n; i++) out.push(eq.dir === 'h' ? [eq.r, eq.c + i] : [eq.r + i, eq.c]); return out; };
      const openBlanks = (eq) => cellsOf(eq).filter(([r, c]) => !p.slots[r][c].given && state.placed[r][c] == null).length;
      for (const eq of p.equations) {
        for (const [r, c] of cellsOf(eq)) {
          if (p.slots[r][c].given || state.placed[r][c] != null) continue;
          // ALLE Rechnungen dieses Feldes müssen danach noch offen bleiben —
          // sonst wäre der Zug ein echter Fehler (vollständig + falsch).
          const eqs = p.equations.filter((e) => cellsOf(e).some(([rr, cc]) => rr === r && cc === c));
          if (!eqs.every((e) => openBlanks(e) >= 2)) continue;
          const right = p.slots[r][c].v;
          const wrong = state.tray.filter((t) => !t.used && t.v !== right).map((t) => t.v)[0];
          if (wrong == null) continue;
          return { placed: placeAt(r, c, wrong), lives: state.lives, r, c, wrong };
        }
      }
      return null;
    });
    expect(ok).not.toBeNull();
    expect(ok.placed).toBe(true);          // Zug angenommen
    expect(ok.lives).toBe(3);              // kein Leben verloren
  });

  test('eine vollständig falsche Rechnung kostet ein Leben', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    await commitMistakes(page, 1);
    expect(await page.evaluate(() => window.__cns.state.lives)).toBe(2);
    expect(await page.evaluate(() => window.__cns.state.mistakes)).toBe(1);
  });
});

// Tipp-Tutor: erklärt Schritt für Schritt mit den KONKRETEN Zahlen des Bretts,
// warum der nächste Zug zwingend ist; der letzte Schritt führt ihn aus.
test.describe('Tipp-Tutor', () => {
  test('erklärt den nächsten Zug in Schritten und legt am Ende den Stein', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    await page.locator('.toolbar .round-btn').last().click();
    // Einmalige Bestzeit-Warnung bestätigen.
    await page.locator('.modal .btn-danger').click();
    await expect(page.locator('.tutor-card')).toBeVisible();
    const steps = await page.evaluate(() => window.__cns.state.hintTutor.steps.length);
    expect(steps).toBeGreaterThan(1);
    // Jeder Schritt zeigt echten Text und hebt Felder hervor.
    await expect(page.locator('.tutor-card .hint-text > span')).not.toBeEmpty();
    expect(await page.locator('.board .cell.hint-group').count()).toBeGreaterThan(0);
    const target = await page.evaluate(() => window.__cns.state.hintTutor.target);
    // Jeder Klick bestätigt einen Schritt; der letzte führt den Zug aus.
    for (let i = 0; i < steps; i++) await page.locator('.tutor-card .btn-primary').click();
    await expect(page.locator('.tutor-card')).toHaveCount(0);
    expect(await page.evaluate(({ r, c }) => window.__cns.state.placed[r][c], target)).not.toBeNull();
    expect(await page.evaluate(() => window.__cns.state.hintsUsed)).toBe(1);
  });
});
