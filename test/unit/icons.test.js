import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { icon, hasIcon, ICON_NAMES } from '../../js/icons.js';

describe('icons', () => {
  test('every named icon renders a well-formed <svg> on a 24-grid', () => {
    assert.ok(ICON_NAMES.length >= 40, 'expected a substantial icon set');
    for (const n of ICON_NAMES) {
      assert.ok(hasIcon(n), `hasIcon('${n}') should be true`);
      const svg = icon(n);
      assert.match(svg, /^<svg /, `${n} must start with <svg`);
      assert.match(svg, /viewBox="0 0 24 24"/, `${n} must use the 24 grid`);
      assert.match(svg, /<\/svg>$/, `${n} must close its <svg>`);
      assert.ok(svg.includes(`ico-${n}`), `${n} must carry its ico-<name> class`);
    }
  });

  test('unknown / empty / foreign names render nothing (no raw string injection)', () => {
    assert.equal(hasIcon(''), false);
    assert.equal(hasIcon(null), false);
    assert.equal(hasIcon(undefined), false);
    assert.equal(hasIcon('definitely-not-an-icon'), false);
    assert.equal(icon('definitely-not-an-icon'), '');
    assert.equal(icon('<script>alert(1)</script>'), '');
  });

  test('opts: size sets width/height, title switches to labelled role', () => {
    assert.match(icon('close', { size: 20 }), /width="20" height="20"/);
    assert.match(icon('close', { title: 'Schließen' }), /role="img" aria-label="Schließen"/);
    assert.match(icon('close'), /aria-hidden="true"/);
  });

  test('stroke icons paint via currentColor; filled icons bring their own fills', () => {
    // close = Strich-Icon
    assert.match(icon('close'), /stroke="currentColor"/);
    // coin = gefüllt (bringt eigene Farbe, kein globales stroke=currentColor am <svg>)
    assert.ok(!/^<svg[^>]*stroke="currentColor"/.test(icon('coin')));
    assert.ok(icon('coin').includes('fill="#'));
  });

  test('core UI glyphs exist (the ones the chrome wires up)', () => {
    for (const n of ['close', 'gear', 'coin', 'flame', 'user', 'save', 'sound',
                     'palette', 'theme', 'controller', 'cart', 'users', 'coffee', 'heart']) {
      assert.ok(hasIcon(n), `missing core icon "${n}"`);
    }
  });
});

// ── Nur EINE Quelle fürs Markenbild ──────────────────────────────────────────
// Das Logo auf dem Home-Screen lag lange als fest einkodiertes Base64-Bild in
// app.js. Beim Icon-Wechsel blieb dort das ALTE Motiv stehen, während überall
// sonst schon das neue lag (gemeldet). Es muss deshalb auf die Icon-DATEI
// zeigen — und die muss es geben.
test('das Home-Logo verweist auf die Icon-Datei statt auf ein eingebettetes Bild', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const src = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
  const m = src.match(/const BRAND_LOGO = '([^']+)';/);
  assert.ok(m, 'BRAND_LOGO muss in app.js definiert sein');
  assert.ok(!m[1].startsWith('data:'), 'BRAND_LOGO darf kein eingebettetes Bild sein');
  const file = new URL('../../' + m[1].replace(/^\.\//, ''), import.meta.url);
  assert.ok(existsSync(file), `Datei aus BRAND_LOGO fehlt: ${m[1]}`);
  // …und sie muss im Service-Worker vorgecacht sein, sonst fehlt sie offline.
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes(m[1]), `${m[1]} fehlt in der ASSETS-Liste von sw.js`);
});

// Ein js/-Modul, das nicht in der ASSETS-Liste steht, fehlt offline: der
// Service-Worker legt es beim Precache nie an, und ein Kaltstart ohne Netz
// bricht am fehlenden Import ab. Genau so war `board.js` — das Kernmodul des
// Bretts — durchgerutscht. Die Regel steht in CLAUDE.md, ab jetzt haelt sie
// ein Test fest, nicht nur die Doku.
test('jedes js/-Modul steht in der ASSETS-Liste von sw.js', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const liste = sw.slice(sw.indexOf('ASSETS'), sw.indexOf('\n];', sw.indexOf('ASSETS')));
  const dir = new URL('../../js/', import.meta.url);
  for (const datei of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    assert.ok(liste.includes(`./js/${datei}`), `js/${datei} fehlt in der ASSETS-Liste von sw.js (offline nicht ladbar)`);
  }
  for (const datei of readdirSync(new URL('../../js/i18n/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    assert.ok(liste.includes(`./js/i18n/${datei}`), `js/i18n/${datei} fehlt in der ASSETS-Liste von sw.js`);
  }
});
