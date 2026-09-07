import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame, solveActivePuzzle, playOneMove, commitMistakes, dismissStreakModal } from './helpers.js';

test.describe('gameplay', () => {
  // Regression: the player's chosen color (settings.coopMyColor) used to only
  // tint marks during an active coop session (cellStyle()/cellClasses() were
  // gated on state.coop.active). It must now also tint your own marks in solo,
  // since the setting was generalized from "coop color" to "my color".
  test('the chosen player color tints a placed tile even outside coop', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => { window.__cns.state.settings.coopMyColor = '#ff00aa'; });
    await startNewGame(page, 'sehrleicht');
    const move = await playOneMove(page);
    expect(move).not.toBeNull();

    const result = await page.evaluate(({ r, c }) => {
      const { cellStyle, cellClasses } = window.__cns;
      const cell = { r, c, t: 'num', given: false };
      return { markedColor: cellStyle(cell)['--markcol'], coopMark: !!cellClasses(cell)['coop-mark'] };
    }, move);

    expect(result.coopMark).toBe(true);
    expect(result.markedColor).toBe('#ff00aa');
  });

  // Der „Zufall"-Knopf im Solo-Setup würfelt NICHT nur die Schwierigkeit, sondern
  // startet die Runde sofort (kein Zwischenschritt „schau, was gewählt wurde").
  test('the random button starts the game immediately with the rolled difficulty', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.home-actions .btn-primary').click();
    await page.waitForSelector('.screen.setup');
    await page.evaluate(() => { window.__cns.state.sel.difficulty = 'sehrleicht'; });
    // Zufall drücken → direkt im Spiel, ohne den Start-Knopf zu berühren.
    await page.locator('.diff-random').click();
    await page.waitForSelector('.screen.game');
    await page.waitForFunction(() => window.__cns && window.__cns.state.puzzle && !window.__cns.state.generating);
    // Die gestartete Schwierigkeit ist eine ANDERE als die vorgewählte (immer verschieden).
    expect(await page.evaluate(() => window.__cns.state.puzzle.difficulty)).not.toBe('sehrleicht');
    expect(await page.evaluate(() => window.__cns.state.status)).toBe('playing');
  });

  test('solving the puzzle shows the win screen and records a highscore', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'sehrleicht');
    await solveActivePuzzle(page);
    await dismissStreakModal(page);

    await expect(page.locator('.result-card.win')).toBeVisible();
    await expect(page.locator('.highscore-badge')).toBeVisible();

    await page.locator('.result-card.win .btn-ghost', { hasText: '' }).last().click(); // "Zum Menü"
    await expect(page.locator('.screen.home')).toBeVisible();

    await page.locator('.home-grid .btn-ghost').nth(0).click();
    // Die per-Level-Tabelle steckt jetzt im "Solo"-Reiter (Stats öffnen auf "Allgemein").
    await page.locator('.stats-tabs button').nth(1).click();
    await expect(page.locator('.diff-row').first().locator('.chip').first()).toContainText('1 / 1');
  });

  // Graded win animation (Punkt 10): ein makelloser Sieg (0 Fehler, 0 Hinweise)
  // bekommt zusätzlich zum normalen Konfetti einen goldenen Schimmer + Badge --
  // ein Sieg MIT Fehler bekommt explizit keines von beidem.
  test('a flawless win shows the perfect-win badge and shine, a win with a mistake does not', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'sehrleicht');
    await solveActivePuzzle(page);
    await dismissStreakModal(page);

    await expect(page.locator('.result-card.win.perfect')).toBeVisible();
    await expect(page.locator('.perfect-badge')).toBeVisible();

    await page.locator('.result-card.win .btn-ghost', { hasText: '' }).last().click();
    await expect(page.locator('.screen.home')).toBeVisible();
    await startNewGame(page, 'sehrleicht');

    await commitMistakes(page, 1);
    await solveActivePuzzle(page);

    await expect(page.locator('.result-card.win')).toBeVisible();
    await expect(page.locator('.result-card.win.perfect')).toHaveCount(0);
    await expect(page.locator('.perfect-badge')).toHaveCount(0);
  });

  test('three deliberate mistakes (lives enabled) trigger the loss screen', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'sehrleicht');
    await commitMistakes(page, 3);

    await expect(page.locator('.result-card.lose')).toBeVisible();
  });

  test('the lives HUD shows one fewer heart after each mistake', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'sehrleicht');

    const emptyHeartsBefore = await page.locator('.heart.empty').count();
    await commitMistakes(page, 1);
    await expect.poll(() => page.locator('.heart.empty').count()).toBe(emptyHeartsBefore + 1);
  });

  test('the zoom reset button appears only after zooming and restores the default zoom', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'sehrleicht');
    // Bei Standardzoom (1) ist der Reset-Knopf ausgeblendet.
    await expect(page.locator('.zoom-reset')).toHaveCount(0);
    await page.locator('.zoomctl .zoom-btn', { hasText: '+' }).click();
    await expect(page.locator('.zoom-reset')).toBeVisible();
    await page.locator('.zoom-reset').click();
    await expect(page.locator('.zoom-reset')).toHaveCount(0);
    expect(await page.evaluate(() => window.__cns.state.zoom)).toBe(1);
  });

  // Unter dem Vorrat gibt es KEINE Knopfleiste mehr: der Hinweis ist entfallen
  // und der Vorrat sortiert sich von selbst. Der Platz gehoert dem Brett.
  test('there is no button bar below the tray', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'sehrleicht');
    await expect(page.locator('.screen.game .toolbar')).toHaveCount(0);
    await expect(page.locator('.screen.game .round-btn')).toHaveCount(0);
  });

  // Der Vorrat ist IMMER aufsteigend sortiert und rueckt von selbst auf —
  // gelegte Steine verschwinden ohne Luecke, ganz ohne Knopf.
  test('the tray stays sorted ascending and closes gaps by itself', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'mittel');
    const snap = async () => page.evaluate(() => ({
      open: window.__cns.state.tray.filter((t) => !t.used).map((t) => t.v),
      kacheln: document.querySelectorAll('.tray .tile').length,
    }));
    const s1 = await snap();
    expect(s1.open).toEqual([...s1.open].sort((a, b) => a - b));
    expect(s1.kacheln).toBe(s1.open.length);
    await playOneMove(page);
    const s2 = await snap();
    expect(s2.open).toEqual([...s2.open].sort((a, b) => a - b));
    expect(s2.open.length).toBe(s1.open.length - 1);
    expect(s2.kacheln).toBe(s2.open.length);   // keine Luecke zurueckgeblieben
  });

  test('resuming from pause runs a 1.5s bar countdown before the game continues', async ({ page }) => {
    await gotoApp(page);
    await startNewGame(page, 'sehrleicht');
    // Pausieren → Fortsetzen tippen.
    await page.locator('.game-top .icon-btn').first().click();
    await page.waitForSelector('.pause-overlay');
    await page.locator('.pause-overlay .btn-primary').click();
    // Countdown läuft: Karte NUR mit „Weiter geht's"-Text + Balken (keine Ziffer),
    // Spiel bleibt PAUSIERT (kein versehentlicher Tap ins Brett, Timer eingefroren).
    await expect(page.locator('.resume-count-card')).toBeVisible();
    await expect(page.locator('.resume-count-digit')).toHaveCount(0);
    await expect(page.locator('.resume-count-bar span')).toBeVisible();
    expect(await page.evaluate(() => window.__cns.state.paused)).toBe(true);
    expect(await page.evaluate(() => window.__cns.state.resumeCountdown)).toBe(1);
    // Countdown zu Ende → Spiel läuft wieder, Overlay weg.
    await page.waitForFunction(() => !window.__cns.state.paused, null, { timeout: 6000 });
    await expect(page.locator('.pause-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__cns.state.resumeCountdown)).toBe(null);
    expect(await page.evaluate(() => window.__cns.state.status)).toBe('playing');
  });
});

// „Große Zahlen": derselbe Bauplan mit deutlich größerem Zahlenraum. Der
// Umschalter gilt für ALLE Stufen; die komplette Spiel-Schleife (generieren →
// lösen → gewinnen) muss damit genauso laufen.
test.describe('big numbers mode', () => {
  test('toggle generates a big-number board and it can be solved to a win', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.home-actions .btn-primary').click();
    await page.waitForSelector('.screen.setup');
    await page.evaluate(() => { window.__cns.state.sel.difficulty = 'sehrleicht'; });
    // „Große Zahlen"-Umschalter sichtbar (6×6 erlaubt) → einschalten. (Der Endlos-
    // Toggle ist ein zweiter .mode-toggle, daher gezielt über den Titel ansprechen.)
    const bigToggle = page.locator('.mode-toggle', { hasText: 'Große Zahlen' });
    await expect(bigToggle).toBeVisible();
    await bigToggle.click();
    expect(await page.evaluate(() => window.__cns.state.sel.bigNumbers)).toBe(true);

    await page.locator('.diff-start').click();
    await page.waitForSelector('.screen.game');
    await page.waitForFunction(() => window.__cns && window.__cns.state.puzzle && !window.__cns.state.generating);

    // Der Zahlenraum ist deutlich größer als im Normalspiel, Puzzle ist markiert.
    // Geprüft wird die HARTE Zusage des Modus: JEDER Operand liegt über der
    // Untergrenze des großen Zahlenraums (minOperand). Ein blosses „irgendein
    // Wert ist größer als 20" war eine Wette auf den Zufall der Runde — bei
    // einer kleinen 4×4-Aufgabe konnten alle Werte darunter bleiben und der
    // Test fiel gelegentlich ohne echten Fehler um.
    const info = await page.evaluate(async () => {
      const [{ eqCells }, { genOptionsFor }] = await Promise.all([import('/js/model.js'), import('/js/config.js')]);
      const p = window.__cns.state.puzzle;
      const min = genOptionsFor('sehrleicht', { bigNumbers: true }).minOperand;
      let kleinsterOperand = Infinity, max = 0;
      for (const row of p.slots) for (const sl of row) if (sl) max = Math.max(max, sl.v);
      // ERGEBNIS-Zellen ausnehmen: ein Ergebnis darf klein sein (25 − 17 = 8),
      // und im Kreuzwort ist es oft zugleich Operand der kreuzenden Rechnung.
      const ergebnis = new Set();
      for (const eq of p.equations) { const cs = eqCells(eq); const [r, c] = cs[cs.length - 1]; ergebnis.add(r + ':' + c); }
      for (const eq of p.equations) {
        const cells = eqCells(eq);
        for (let i = 0; i < cells.length - 1; i++) {
          const [r, c] = cells[i];
          if (ergebnis.has(r + ':' + c)) continue;
          kleinsterOperand = Math.min(kleinsterOperand, p.slots[r][c].v);
        }
      }
      return { big: p.bigNumbers, max, kleinsterOperand, min };
    });
    expect(info.big).toBe(true);
    expect(info.min).toBeGreaterThan(1);                       // der Modus hebt die Untergrenze überhaupt an
    expect(info.kleinsterOperand).toBeGreaterThanOrEqual(info.min);
    await expect(page.locator('.board.big-num')).toBeVisible();

    await solveActivePuzzle(page);
    await expect(page.locator('.result-card.win')).toBeVisible({ timeout: 20000 });
  });

  test('the toggle is available for large fields too (all dimensions)', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.home-actions .btn-primary').click();
    await page.waitForSelector('.screen.setup');
    await page.evaluate(() => { window.__cns.state.sel.difficulty = 'rip'; }); // größtes Brett
    await expect(page.locator('.mode-toggle', { hasText: 'Große Zahlen' })).toBeVisible();
  });
});
