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
  // `ungewaehlt`: nach JEDEM gotoApp die Wahl wieder leeren. gotoApp belegt ein
  // leeres divStyle vor (sonst faengt das Pop-up in allen anderen Tests die
  // Klicks ab) — ohne das Leeren haette eine interne Wiederholung hier die Frage
  // stillschweigend abgeschaltet, und der Test waere je nach erzeugtem Brett mal
  // gruen, mal rot (genau so passiert).
  async function spielMitDivision(page, { neuLaden = false, ungewaehlt = false } = {}) {
    for (let versuch = 0; versuch < 4; versuch++) {
      if (versuch || neuLaden) await gotoApp(page);
      if (ungewaehlt) await page.evaluate(() => window.__cns.setSetting('divStyle', null));
      await startNewGame(page, 'schwer');
      const hatDiv = await page.evaluate(() => window.__cns.state.puzzle.equations.some((e) => (e.ops || []).includes('/')));
      if (hatDiv) return true;
    }
    return false;
  }

  test('fragt einmalig beim Spielstart und merkt sich die Wahl', async ({ page }) => {
    test.setTimeout(120000);
    await gotoApp(page);
    // gotoApp belegt divStyle fuer alle anderen Tests vor — hier gilt der echte
    // Erstzustand: noch NIE gewaehlt, auch ueber Wiederholungen hinweg.
    expect(await spielMitDivision(page, { ungewaehlt: true }), 'kein Brett mit Division gefunden').toBe(true);

    const popup = page.locator('.modal-bg .modal', { hasText: 'Geteilt-Zeichen' });
    await expect(popup).toBeVisible();
    await popup.getByText('Doppelpunkt').click();

    expect(await page.evaluate(() => window.__cns.state.settings.divStyle)).toBe('colon');
    await expect(page.locator('.modal-bg')).toHaveCount(0);
    // Das Brett zeigt jetzt ':' und keinen gezeichneten Obelus mehr.
    await expect(page.locator('.board .opcell', { hasText: ':' }).first()).toBeVisible();
    expect(await page.locator('.board .op-obelus').count(), 'kein Obelus mehr').toBe(0);

    // Neustart der App + zweites Spiel: die Wahl haelt, keine erneute Frage.
    expect(await spielMitDivision(page, { neuLaden: true })).toBe(true);
    expect(await page.evaluate(() => window.__cns.state.settings.divStyle), 'Wahl ueberlebt den Neustart').toBe('colon');
    await expect(page.locator('.modal-bg')).toHaveCount(0);
  });

  test('ohne Wahl zeichnet das Brett den Obelus selbst', async ({ page }) => {
    test.setTimeout(120000);
    await gotoApp(page);
    expect(await spielMitDivision(page, { ungewaehlt: true })).toBe(true);
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

  // DER Fall, auf den es ankommt: ein Bestandsnutzer, der die App AKTUALISIERT.
  // Seine gespeicherten Einstellungen kennen `divStyle` gar nicht — er hat also
  // nie aktiv gewaehlt und MUSS gefragt werden. Der Test schreibt deshalb einen
  // echten Alt-Stand in den localStorage (vor dem App-Start, via addInitScript —
  // ein Seed danach wuerde vom Settings-Persist wieder ueberschrieben).
  test('ein Bestandsnutzer ohne gespeicherte Wahl wird nach dem Update gefragt', async ({ page }) => {
    test.setTimeout(120000);
    // Ein echter Alt-Stand: gespeicherte Einstellungen, die `divStyle` gar nicht
    // kennen. Per addInitScript VOR dem App-Start — ein Seed danach wuerde vom
    // Settings-Persist ueberschrieben. Gilt auch fuer jedes Neuladen unten.
    await page.addInitScript(() => {
      if (!localStorage.getItem('cmc_settings')) {
        localStorage.setItem('cmc_settings', JSON.stringify({
          themeMode: 'dark', coopName: 'Alt', markColor: '#f2c024', dragScale: 1,
          appTheme: 'standard', numberFont: 'classic', updatedAt: Date.now() - 86400000,
        }));
      }
    });
    // Wie gotoApp, aber OHNE divStyle vorzubelegen — genau darum geht es hier.
    const startenOhneVorbelegung = async () => {
      await page.goto('/');
      await page.waitForSelector('#splash', { state: 'hidden', timeout: 10000 });
      const whatsNew = page.locator('.whatsnew-badge');
      if (await whatsNew.isVisible().catch(() => false)) await page.locator('.modal-bg .btn-primary').click();
      await page.locator('.skin-unlock-modal .btn-ghost').click({ timeout: 2000 }).catch(() => {});
      await page.waitForSelector('.screen.home');
    };

    await startenOhneVorbelegung();
    expect(await page.evaluate(() => window.__cns.state.settings.divStyle), 'Alt-Stand kennt das Feld nicht').toBeNull();
    expect(await page.evaluate(() => window.__cns.state.settings.coopName), 'der uebrige Alt-Stand bleibt erhalten').toBe('Alt');

    // „Schwer" teilt fast immer, aber nicht garantiert — sonst ein frisches Brett.
    let gefragt = false;
    for (let versuch = 0; versuch < 4 && !gefragt; versuch++) {
      if (versuch) await startenOhneVorbelegung();
      await startNewGame(page, 'schwer');
      gefragt = await page.evaluate(() => window.__cns.state.puzzle.equations.some((e) => (e.ops || []).includes('/')));
    }
    expect(gefragt, 'kein Brett mit Division gefunden').toBe(true);
    await expect(page.locator('.modal-bg .modal', { hasText: 'Geteilt-Zeichen' }), 'die Frage kommt').toBeVisible();
  });

  test('die Frage wird nachgeholt, wenn beim Start ein anderes Modal offen war', async ({ page }) => {
    test.setTimeout(120000);
    await gotoApp(page);
    expect(await spielMitDivision(page)).toBe(true);
    // Lage nachstellen: noch nichts gewaehlt, aber ein anderes Modal liegt obenauf
    // (so wuerde maybeAskDivStyle beim Laden des Bretts aussteigen).
    await page.evaluate(() => {
      window.__cns.setSetting('divStyle', null);
      window.__cns.state.modal = 'changelog';
    });
    expect(await page.evaluate(() => window.__cns.state.modal), 'solange gefragt wird nicht').toBe('changelog');

    // Modal zu → die Frage kommt nach, statt bis zum naechsten Raetsel zu warten.
    await page.evaluate(() => { window.__cns.state.modal = null; });
    await page.waitForFunction(() => window.__cns.state.modal === 'divStyle');
    await expect(page.locator('.modal-bg .modal', { hasText: 'Geteilt-Zeichen' })).toBeVisible();
  });

  // Im Mehrspieler waere ein Dialog ohne Abbrechen eine Blockade mitten in der
  // laufenden Runde des Partners — dort wird nicht gefragt, sondern erst beim
  // naechsten Solo-Raetsel.
  test('im Coop blockiert die Frage den Beitritt nicht', async ({ page }) => {
    test.setTimeout(120000);
    await gotoApp(page);
    expect(await spielMitDivision(page)).toBe(true);
    // Lage nachstellen: noch nichts gewaehlt, Runde laeuft im Coop.
    // (divStyle ERST hier auf null setzen — spielMitDivision darf zwischendurch
    // neu laden, und gotoApp belegt ein leeres divStyle wieder vor.)
    await page.evaluate(() => {
      window.__cns.setSetting('divStyle', null);
      window.__cns.state.coop.active = true;
      window.__cns.state.modal = 'changelog';
    });
    await page.evaluate(() => { window.__cns.state.modal = null; });

    expect(await page.evaluate(() => window.__cns.state.modal), 'keine Frage im Coop').toBeNull();
    expect(await page.evaluate(() => window.__cns.state.settings.divStyle), 'und weiterhin ungewaehlt').toBeNull();

    // Zurueck im Solo kommt sie nach.
    await page.evaluate(() => { window.__cns.state.coop.active = false; window.__cns.state.modal = 'changelog'; });
    await page.evaluate(() => { window.__cns.state.modal = null; });
    await page.waitForFunction(() => window.__cns.state.modal === 'divStyle');
  });
});
