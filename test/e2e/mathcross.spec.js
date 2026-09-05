import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame, playOneMove, commitMistakes } from './helpers.js';

// Kern des Spiels: Steine per Drag & Drop ins Rechennetz, Tausch bei Kollision,
// Zurücklegen in den Vorrat — und die Fehler-Regel (nur eine vollständig
// falsche Rechnung zählt).
test.describe('Rechenkreuz: Steine legen', () => {
  // Der gezogene Stein schwebt ÜBER dem Finger (DRAG_LIFT) — abgelegt wird
  // dort, wo der STEIN liegt. Der Zeiger muss also um genau diesen Betrag
  // TIEFER stehen als das Zielfeld, so wie es ein Daumen auch täte.
  async function dragTo(page, from, to) {
    const lift = await page.evaluate(() => window.__cns.dragLift);
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    const tx = b.x + b.width / 2, ty = b.y + b.height / 2 + lift;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
    await page.mouse.move(tx, ty, { steps: 8 });
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
    // ZWEI Felder wählen, deren Rechnungen auch nach dem Tausch noch offen
    // bleiben — sonst wäre der Tausch ein echter Fehler (vollständige, falsche
    // Rechnung) und würde zu Recht abgelehnt.
    const pair = await page.evaluate(() => {
      const { state, placeAt } = window.__cns;
      const p = state.puzzle;
      const cellsOf = (eq) => { const out = []; for (let i = 0; i <= eq.n; i++) out.push(eq.dir === 'h' ? [eq.r, eq.c + i] : [eq.r + i, eq.c]); return out; };
      const eqsAt = (r, c) => p.equations.filter((e) => cellsOf(e).some(([rr, cc]) => rr === r && cc === c));
      const openBlanks = (eq) => cellsOf(eq).filter(([r, c]) => !p.slots[r][c].given && state.placed[r][c] == null).length;
      const safe = [];
      for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
        const sl = p.slots[r][c];
        if (!sl || sl.given) continue;
        if (eqsAt(r, c).every((e) => openBlanks(e) >= 2)) safe.push({ r, c, v: sl.v });
      }
      for (const x of safe) for (const y of safe) {
        if (x === y || x.v === y.v) continue;
        const shared = eqsAt(x.r, x.c).some((e) => eqsAt(y.r, y.c).includes(e));
        if (shared) continue;
        placeAt(x.r, x.c, x.v); placeAt(y.r, y.c, y.v);
        return { a: x, b: y };
      }
      return null;
    });
    expect(pair, 'kein tauschbares Feldpaar gefunden').not.toBeNull();
    const { a, b } = pair;
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

// Reichweite beim Ziehen (settings.dragScale): der Stein folgt der Bewegung
// verstärkt, damit man den oberen Brettrand erreicht, ohne den Finger über den
// ganzen Bildschirm zu ziehen. Abgelegt wird IMMER dort, wo der Stein zu sehen
// ist — genau das prüft der Test: eine um den Faktor GETEILTE Zeigerbewegung
// muss dieselbe Zelle treffen wie die volle Bewegung ohne Verstärkung.
test.describe('Reichweite beim Ziehen', () => {
  test('bei Faktor 3 legt ein Drittel der Bewegung den Stein aufs Ziel', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    await page.evaluate(() => window.__cns.setSetting('dragScale', 3));
    const lift = await page.evaluate(() => window.__cns.dragLift);
    const target = await page.evaluate(() => window.__cns.firstBlank());
    const tileIndex = await page.evaluate((v) => window.__cns.state.tray.findIndex((t) => !t.used && t.v === v), target.v);
    const tile = page.locator('.tray .tile').nth(tileIndex);
    const cell = page.locator(`.board .cell[data-r="${target.r}"][data-c="${target.c}"]`);
    const a = await tile.boundingBox();
    const b = await cell.boundingBox();
    const sx = a.x + a.width / 2, sy = a.y + a.height / 2;
    // Zielpunkt des STEINS (inkl. Lift) …
    const gx = b.x + b.width / 2, gy = b.y + b.height / 2 + lift;
    // … und der Zeigerweg dorthin ist bei Faktor 3 nur ein Drittel so lang.
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + (gx - sx) / 3, sy + (gy - sy) / 3, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(({ r, c }) => window.__cns.state.placed[r][c], target)).toBe(target.v);
  });

  test('Standard ist 1 — die Bewegung wird nicht verstärkt', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    expect(await page.evaluate(() => window.__cns.state.settings.dragScale)).toBe(1);
  });
});

// Der Vorrat ist eine einzige, waagerecht scrollbare Reihe. Ein Zug beginnt
// deshalb erst nach einer echten Bewegung (DRAG_SLOP) — sonst nahm jede
// Beruehrung sofort den Stein auf und die Leiste liess sich nie scrollen.
test.describe('Vorrat scrollen statt ziehen', () => {
  test('eine winzige Bewegung nimmt den Stein nur auf, sie zieht ihn nicht', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    const tile = page.locator('.tray .tile').first();
    const v = await page.evaluate(() => window.__cns.state.tray.find((t) => !t.used).v);
    const a = await tile.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 3, a.y + a.height / 2, { steps: 2 });  // unter der Schwelle
    await page.mouse.up();
    // Unter der Schwelle = Tipp: der Stein ist AUSGEWAEHLT, nicht gezogen.
    expect(await page.evaluate(() => window.__cns.state.pick && window.__cns.state.pick.v)).toBe(v);
    expect(await page.evaluate(() => document.querySelectorAll('.drag-ghost[style*="display: block"]').length)).toBe(0);
  });

  test('die Steine geben waagerechte Wische an den Browser ab (touch-action)', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'rip');   // viele Steine -> die Reihe laeuft ueber
    const ta = await page.evaluate(() => getComputedStyle(document.querySelector('.tray .tile')).touchAction);
    expect(ta).toBe('pan-x');
    const scrollable = await page.evaluate(() => {
      const t = document.querySelector('.tray');
      return t.scrollWidth > t.clientWidth && getComputedStyle(t).overflowX === 'auto';
    });
    expect(scrollable).toBe(true);
  });
});
