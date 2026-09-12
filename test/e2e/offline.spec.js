import { test, expect } from '@playwright/test';
import { gotoApp, startNewGame } from './helpers.js';

// Die PWA muss im Flugmodus voll spielbar sein: der Service-Worker liefert die
// App-Shell cache-first, Solo und Training laufen komplett lokal. Genau das
// haelt dieser Test fest — einmal online aufrufen (dabei installiert sich der
// Worker und cacht die ASSETS), dann das Netz abklemmen und KALT neu starten.
// Was dieser Test NICHT abdeckt: ein im Precache fehlendes js/-Modul. Der
// stale-while-revalidate-Handler legt jedes gleich-origin-GET beim ersten
// Online-Besuch ohnehin im Cache ab, der Offline-Start gelingt hier also auch
// ohne den Precache-Eintrag. Dafuer sorgt der Unit-Test „jedes js/-Modul steht
// in der ASSETS-Liste von sw.js" — die Luecke traefe erst den engen Moment
// direkt nach einem Versions-Swap, in dem der neue Cache nur die ASSETS haelt.
test.describe('Offline-Modus', () => {
  test('nach einem Online-Besuch startet die App ohne Netz und ist spielbar', async ({ page, context }) => {
    await gotoApp(page);
    // Auf den aktivierten Worker warten — vorher ist der Precache nicht sicher fertig.
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && reg.active);
    }, null, { timeout: 20000 });
    await page.waitForTimeout(1500);   // Promise.allSettled der ASSETS abwarten

    await context.setOffline(true);
    const fehler = [];
    page.on('pageerror', (e) => fehler.push(String(e)));

    await page.reload();
    await page.waitForSelector('#splash', { state: 'hidden', timeout: 20000 });
    await page.waitForSelector('.screen.home', { timeout: 20000 });
    expect(fehler, 'kein Modul fehlt beim Offline-Kaltstart').toEqual([]);

    // Offline ist der Coop-Knopf gesperrt, Solo laeuft.
    await expect(page.locator('.offline-chip')).toBeVisible();
    await startNewGame(page, 'leicht');
    expect(await page.evaluate(() => !!window.__cns.state.puzzle), 'ein Raetsel wurde offline erzeugt').toBe(true);

    const zug = await page.evaluate(() => {
      const z = window.__cns.firstBlank();
      window.__cns.placeAt(z.r, z.c, window.__cns.state.puzzle.slots[z.r][z.c].v);
      return window.__cns.state.placed[z.r][z.c];
    });
    expect(zug, 'ein Zug laesst sich offline setzen').not.toBeNull();

    await context.setOffline(false);
  });
});
