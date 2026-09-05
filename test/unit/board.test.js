import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../js/board.js';
import { generatePuzzle } from '../../js/generator.js';
import { genOptionsFor } from '../../js/config.js';
import { buildHintTutorial } from '../../js/hinttutor.js';
import { nextTrainingStep } from '../../js/training.js';

// 8 - □ = 5 (waagerecht) kreuzt □ + 2 = 5 (senkrecht) im Ergebnisfeld.
function fixture() {
  return {
    rows: 3, cols: 3,
    slots: [
      [{ v: 8, given: true }, { v: 3, given: false }, { v: 5, given: false }],
      [null, null, { v: 2, given: true }],
      [null, null, { v: 7, given: true }],
    ],
    equations: [
      { dir: 'h', r: 0, c: 0, n: 2, ops: ['-'] },
      { dir: 'v', r: 0, c: 2, n: 2, ops: ['+'] },
    ],
    tray: [3, 5],
  };
}

test('buildDisplay setzt Zahlen auf gerade, Operatoren auf ungerade Felder', () => {
  const p = fixture();
  const d = B.buildDisplay(p);
  assert.equal(d.rows, 5);
  assert.equal(d.cols, 5);
  assert.deepEqual(d.cells[0][0], { t: 'num', r: 0, c: 0, given: true });
  assert.equal(d.cells[0][1].sym, '−');
  assert.equal(d.cells[0][3].sym, '=');
  assert.equal(d.cells[1][4].sym, '+');
  assert.equal(d.cells[1][0], null, 'zwischen zwei Gleichungen bleibt es leer');
});

test('Vorrat: benutzte Steine hinterlassen eine Lücke, Sortieren rückt auf', () => {
  let tray = [5, 1, 9, 1].map((v, i) => ({ id: i, v, used: false }));
  B.takeFromTray(tray, 9);
  assert.equal(B.trayLeft(tray), 3);
  assert.equal(tray[2].used, true, 'der Platz bleibt als Lücke stehen');
  tray = B.sortTray(tray);
  assert.deepEqual(tray.map(t => t.v), [1, 1, 5]);
  B.returnToTray(tray, 9);
  assert.deepEqual(tray.map(t => t.v), [1, 1, 5, 9], 'zurückgelegte Steine kommen hinten dazu');
});

test('Fehler nur bei einer VOLLSTÄNDIGEN, falschen Rechnung', () => {
  const p = fixture();
  const placed = B.emptyPlaced(p);
  // 5 auf das mittlere Feld: „8 − 5 = □" ist noch offen → kein Urteil, kein Fehler.
  assert.equal(B.placementBreaksEquation(p, placed, 0, 1, 5), false);
  placed[0][1] = 5;
  // Der Abschluss deckt es auf: 8 − 5 = 5 ist falsch.
  assert.equal(B.placementBreaksEquation(p, placed, 0, 2, 5), true);
  // Auch die KREUZENDE Rechnung zählt: 3 + 2 = 7 stimmt nicht.
  assert.equal(B.placementBreaksEquation(p, placed, 0, 2, 3), true);
  // Mit der richtigen 3 links geht beides auf: 8 − 3 = 5 und 5 + 2 = 7.
  placed[0][1] = 3;
  assert.equal(B.placementBreaksEquation(p, placed, 0, 2, 5), false);
});

test('falsch platziert, aber alle vollen Rechnungen stimmen → kein Fehler', () => {
  const p = fixture();
  const placed = B.emptyPlaced(p);
  // 5 auf das erste Feld: die Rechnung 8 - 5 = □ bleibt offen und geht auf.
  assert.equal(B.placementBreaksEquation(p, placed, 0, 1, 5), false);
});

test('isBoardSolved verlangt volles Brett und stimmige Rechnungen', () => {
  const p = fixture();
  const placed = B.emptyPlaced(p);
  assert.equal(B.isBoardSolved(p, placed), false);
  placed[0][1] = 3;
  assert.equal(B.progressOf(p, placed), 0.5);
  placed[0][2] = 5;
  assert.equal(B.isBoardSolved(p, placed), true);
  assert.equal(B.progressOf(p, placed), 1);
});

test('solvedEquationSet erkennt fertige Rechnungen', () => {
  const p = fixture();
  const placed = B.emptyPlaced(p);
  assert.equal(B.solvedEquationSet(p, placed).size, 0);
  placed[0][1] = 3; placed[0][2] = 5;
  assert.deepEqual([...B.solvedEquationSet(p, placed)].sort(), [0, 1]);
});

test('Tipp-Tutor führt jedes Rätsel bis zum Ende', () => {
  for (const id of ['sehrleicht', 'mittel', 'extrem']) {
    const p = generatePuzzle({ ...genOptionsFor(id), seed: 31 });
    const placed = B.emptyPlaced(p);
    const tray = p.tray.slice();
    let guard = 0;
    while (guard++ < 300) {
      const tut = buildHintTutorial(p, placed, tray);
      if (!tut) break;
      const last = tut.steps[tut.steps.length - 1];
      assert.ok(last.final && last.action.length, 'letzter Schritt führt den Zug aus');
      assert.ok(tut.steps.every(s => s.key && s.cells.length), 'jeder Schritt hat Text + Fokus');
      for (const a of last.action) { placed[a.r][a.c] = a.v; tray.splice(tray.indexOf(a.v), 1); }
    }
    assert.equal(B.isBoardSolved(p, placed), true, `${id}: Tutor bleibt stecken`);
  }
});

test('Trainingsschritt nutzt nur die einfachste Stufe', () => {
  const p = generatePuzzle({ ...genOptionsFor('sehrleicht'), seed: 12 });
  const st = nextTrainingStep(p, B.emptyPlaced(p), p.tray.slice());
  assert.ok(st, 'kein Trainingsschritt gefunden');
  assert.equal(p.slots[st.r][st.c].v, st.v);
  assert.equal(st.key, 'training.step.direct');
  assert.ok(st.params.eq.includes('='));
});
