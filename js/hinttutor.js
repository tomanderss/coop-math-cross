// hinttutor.js — der Tipp-Tutor: erklärt EINEN erzwungenen Schritt in kleinen,
// bestätigten Häppchen statt einfach die Lösung hinzuklatschen.
//
// Reine Logik (keine UI, kein Vue): `buildHintTutorial(puzzle, placed, tray)`
// sucht die am einfachsten erklärbare Deduktion, die aus der AKTUELLEN Lage
// erzwungen ist (Solver-Stufen T1 → T2 → T2.5 → T3), und gibt eine Kette
// kleiner Schritte mit den KONKRETEN Zahlen des Bretts zurück.
//
// Schritt-Form: { cells, key, params, final?, action? }
//   cells   Felder, die die UI hervorheben soll ([[r,c], …])
//   key     i18n-Schlüssel des Erklärtexts
//   params  Platzhalter für t(key, params)
//   final   letzter Schritt der Kette
//   action  [{ r, c, v }, …] — die Züge, die der letzte Schritt ausführt (eine
//           Deduktion kann mehrere Felder auf einmal erzwingen)

import { eqCells, evalExpr } from './model.js';
import { OP_SYMBOL, currentValues, equationsAt } from './board.js';
import { logicalSolve, TIER } from './solver.js';

/** Eine Gleichung als Text, mit „?" für noch leere Felder. */
export function equationText(puzzle, eq, values, highlight = null) {
  const cells = eqCells(eq);
  const cols = puzzle.cols;
  const parts = [];
  for (let i = 0; i <= eq.n; i++) {
    const [r, c] = cells[i];
    const v = values[r * cols + c];
    const isTarget = highlight && highlight[0] === r && highlight[1] === c;
    parts.push(v == null ? (isTarget ? '?' : '□') : String(v));
    if (i < eq.n - 1) parts.push(OP_SYMBOL[eq.ops[i]]);
    else if (i === eq.n - 1) parts.push('=');
  }
  return parts.join(' ');
}

function eqIndexOf(puzzle, eq) {
  return puzzle.equations.findIndex(e => e.dir === eq.dir && e.r === eq.r && e.c === eq.c && e.n === eq.n);
}

/**
 * Nächster erzwungener Schritt aus der laufenden Partie.
 * @param {object} puzzle
 * @param {Array<Array<number|null>>} placed
 * @param {number[]} restTray  noch nicht gelegte Zahlen
 */
export function nextForcedStep(puzzle, placed, restTray, opts = {}) {
  const values = currentValues(puzzle, placed);
  const res = logicalSolve(puzzle, { maxTier: opts.maxTier ?? 3, from: { values, pool: restTray } });
  return res.steps.length ? { step: res.steps[0], values } : null;
}

/**
 * Baut die Erklärkette für den nächsten erzwungenen Schritt.
 * @returns {{steps, target}|null}
 */
export function buildHintTutorial(puzzle, placed, restTray, opts = {}) {
  const found = nextForcedStep(puzzle, placed, restTray, opts);
  if (!found) return null;
  const { step, values } = found;
  const [r, c] = step.cells[0];
  const v = step.values[0];
  const steps = [];
  const cellsOf = eq => eqCells(eq).map(([rr, cc]) => [rr, cc]);

  if (step.eq && step.tier === TIER.DIRECT) {
    // Genau eine Lücke in dieser Rechnung → direkt ausrechnen.
    steps.push({ cells: cellsOf(step.eq), key: 'tutor.direct.look', params: { eq: equationText(puzzle, step.eq, values, [r, c]) } });
    steps.push({ cells: [[r, c]], key: 'tutor.direct.solve', params: { eq: equationText(puzzle, step.eq, values, [r, c]) } });
  } else if (step.eq && step.tier === TIER.COMBO) {
    // Mehrere Lücken, aber der Vorrat lässt nur EINE Belegung zu.
    steps.push({ cells: cellsOf(step.eq), key: 'tutor.combo.look', params: { eq: equationText(puzzle, step.eq, values, null) } });
    steps.push({ cells: step.cells.map(([rr, cc]) => [rr, cc]), key: 'tutor.combo.only', params: { n: step.cells.length } });
  } else if (step.tier === TIER.CROSS) {
    // Kreuzungsfeld: waagerechte UND senkrechte Rechnung zusammen lassen nur eine Zahl zu.
    const idxs = equationsAt(puzzle, r, c);
    const cells = [];
    for (const i of idxs) for (const cell of cellsOf(puzzle.equations[i])) cells.push(cell);
    steps.push({ cells, key: 'tutor.cross.look', params: { n: idxs.length } });
    steps.push({
      cells: [[r, c]], key: 'tutor.cross.only',
      params: {
        a: idxs[0] != null ? equationText(puzzle, puzzle.equations[idxs[0]], values, [r, c]) : '',
        b: idxs[1] != null ? equationText(puzzle, puzzle.equations[idxs[1]], values, [r, c]) : '',
      },
    });
  } else {
    // Zählargument: der Wert kommt genau so oft im Vorrat vor, wie es Felder gibt.
    const n = restTray.filter(x => x === v).length;
    steps.push({ cells: step.cells.map(([rr, cc]) => [rr, cc]), key: 'tutor.pool.look', params: { v, n } });
    steps.push({ cells: [[r, c]], key: 'tutor.pool.only', params: { v, n } });
  }

  // Eine einzige Deduktion kann mehrere Felder erzwingen (z.B. das
  // Zählargument) — dann legt der Abschluss-Schritt sie alle.
  const action = step.cells.map(([rr, cc], i) => ({ r: rr, c: cc, v: step.values[i] }));
  steps.push({
    cells: action.map(a => [a.r, a.c]),
    key: action.length > 1 ? 'tutor.placeMulti' : 'tutor.place',
    params: { v, n: action.length },
    final: true, action,
  });
  return { steps, target: { r, c }, tier: step.tier, value: v };
}
