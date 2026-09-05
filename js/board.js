// board.js — reine Brett-Logik: Anzeige-Raster, Vorrat, Zugprüfung.
// Kein Vue, kein DOM — damit alles unit-testbar bleibt (app.js verdrahtet nur).

import { eqCells, eqIds, slotId, evalExpr, equationHolds, solutionValues, blankIds } from './model.js';

export const OP_SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/**
 * Ein Rätsel, das durch die Firebase-RTDB gereist ist, wieder DICHT machen.
 *
 * Die RTDB speichert KEINE null-Werte: `slots` ist ein 2D-Raster mit null für
 * jede tote Zelle (die Löcher und Ausläufer des Kreuzworts) und kommt deshalb
 * als Objekt mit numerischen Schlüsseln zurück — eine Zeile OHNE einzige Zelle
 * fehlt sogar komplett. `buildDisplay` greift mit `puzzle.slots[r][c]` zu und
 * warf dann einen TypeError; Vue bricht den Brett-Teilbaum ab (der bekannte
 * Blackscreen). Betroffen ist alles, was ein Rätsel über die Cloud trägt: die
 * Bibliothek gespeicherter Partien, die Aktivspiel-Slots, die Cloud-Session und
 * das Coop-INIT.
 *
 * Rein und idempotent — ein lokal erzeugtes Rätsel geht unverändert durch.
 */
export function normalizePuzzle(p) {
  if (!p || !p.rows || !p.cols) return p;
  const src = p.slots;
  if (!src) return p;
  const dense = Array.isArray(src) && src.length === p.rows
    && src.every((row) => Array.isArray(row) && row.length === p.cols);
  const eqs = p.equations;
  const eqDense = Array.isArray(eqs);
  if (dense && eqDense) return p;
  const slots = [];
  for (let r = 0; r < p.rows; r++) {
    const row = src[r] || {};
    const out = new Array(p.cols).fill(null);
    for (let c = 0; c < p.cols; c++) out[c] = row[c] != null ? row[c] : null;
    slots.push(out);
  }
  return { ...p, slots, equations: eqDense ? eqs : Object.values(eqs || {}) };
}

/**
 * Baut das ANZEIGE-Raster: (2*rows-1) × (2*cols-1). Zahl-Felder sitzen auf
 * geraden Koordinaten, Operator-/Gleichheitszeichen dazwischen.
 * @returns {{rows, cols, cells}} cells[dr][dc] = null | {t:'num',r,c,given} | {t:'op',sym}
 */
export function buildDisplay(puzzle) {
  const rows = puzzle.rows * 2 - 1, cols = puzzle.cols * 2 - 1;
  const cells = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const s = puzzle.slots[r][c];
      if (s) cells[r * 2][c * 2] = { t: 'num', r, c, given: !!s.given };
    }
  }
  for (const eq of puzzle.equations) {
    const cs = eqCells(eq);
    for (let i = 0; i < eq.n; i++) {
      const [r1, c1] = cs[i], [r2, c2] = cs[i + 1];
      const sym = i < eq.n - 1 ? OP_SYMBOL[eq.ops[i]] : '=';
      cells[r1 + r2][c1 + c2] = { t: 'op', sym, eqIndex: puzzle.equations.indexOf(eq) };
    }
  }
  return { rows, cols, cells };
}

/** Vorrat als Anzeige-Liste. Ein benutzter Stein hinterlässt eine LÜCKE. */
export function buildTray(puzzle) {
  return puzzle.tray.map((v, i) => ({ id: i, v, used: false }));
}

/**
 * Sortiert den Vorrat aufsteigend und rückt auf: benutzte Steine verschwinden,
 * die übrigen stehen lückenlos in aufsteigender Reihenfolge (Sortier-Knopf).
 */
export function sortTray(tray) {
  return tray.filter(t => !t.used).sort((a, b) => a.v - b.v || a.id - b.id).map((t, i) => ({ ...t, id: i }));
}

/** Nimmt EINEN unbenutzten Stein mit dem Wert v aus dem Vorrat (mutiert). */
export function takeFromTray(tray, v) {
  const t = tray.find(x => !x.used && x.v === v);
  if (t) { t.used = true; return t; }
  return null;
}

/** Legt einen Stein mit Wert v zurück. Fehlt sein Platz (nach dem Sortieren), kommt er hinten dazu. */
export function returnToTray(tray, v) {
  const t = tray.find(x => x.used && x.v === v);
  if (t) { t.used = false; return t; }
  const fresh = { id: tray.length ? Math.max(...tray.map(x => x.id)) + 1 : 0, v, used: false };
  tray.push(fresh);
  return fresh;
}

/** Wie viele Steine liegen noch im Vorrat? */
export function trayLeft(tray) { return tray.reduce((n, t) => n + (t.used ? 0 : 1), 0); }

/** Leeres Platzierungs-Raster (nur Lücken sind belegbar). */
export function emptyPlaced(puzzle) {
  return Array.from({ length: puzzle.rows }, () => new Array(puzzle.cols).fill(null));
}

/** Vorgaben + bereits gelegte Steine als flache Wertetabelle (für den Solver). */
export function currentValues(puzzle, placed) {
  const out = new Array(puzzle.rows * puzzle.cols).fill(null);
  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const s = puzzle.slots[r][c];
      if (!s) continue;
      out[slotId(r, c, puzzle.cols)] = s.given ? s.v : (placed[r][c] ?? null);
    }
  }
  return out;
}

/** Indizes der Gleichungen, die dieses Feld enthalten. */
export function equationsAt(puzzle, r, c) {
  const id = slotId(r, c, puzzle.cols);
  const out = [];
  puzzle.equations.forEach((eq, i) => { if (eqIds(eq, puzzle.cols).includes(id)) out.push(i); });
  return out;
}

/**
 * Prüft, ob das Legen von `v` auf (r,c) eine Gleichung VOLLSTÄNDIG macht, die
 * dann nicht aufgeht. Genau das — und nur das — ist ein Fehler: eine Zahl an
 * der falschen Stelle, bei der alle vollen Rechnungen weiter stimmen, ist kein
 * Fehler, sondern fällt dem Spieler erst am Ende auf (übrige Steine).
 */
export function placementBreaksEquation(puzzle, placed, r, c, v) {
  const values = currentValues(puzzle, placed);
  values[slotId(r, c, puzzle.cols)] = v;
  for (const i of equationsAt(puzzle, r, c)) {
    if (equationHolds(puzzle.equations[i], values, puzzle.cols) === false) return true;
  }
  return false;
}

/** Gleichungen, die aktuell vollständig UND korrekt sind (grüne Hervorhebung). */
export function solvedEquationSet(puzzle, placed) {
  const values = currentValues(puzzle, placed);
  const set = new Set();
  puzzle.equations.forEach((eq, i) => { if (equationHolds(eq, values, puzzle.cols) === true) set.add(i); });
  return set;
}

/** Gelöst = jede Lücke gefüllt und jede Gleichung geht auf. */
export function isBoardSolved(puzzle, placed) {
  const values = currentValues(puzzle, placed);
  if (values.some((v, id) => v == null && puzzle.slots[Math.floor(id / puzzle.cols)][id % puzzle.cols])) return false;
  return puzzle.equations.every(eq => equationHolds(eq, values, puzzle.cols) === true);
}

/** Anzahl gefüllter Lücken / Anzahl Lücken. */
export function progressOf(puzzle, placed) {
  const blanks = blankIds(puzzle);
  if (!blanks.length) return 1;
  let filled = 0;
  for (const id of blanks) if (placed[Math.floor(id / puzzle.cols)][id % puzzle.cols] != null) filled++;
  return filled / blanks.length;
}

/** Der korrekte Wert eines Feldes (für Hinweise/Trainings-Schritte). */
export function solutionAt(puzzle, r, c) {
  const s = puzzle.slots[r][c];
  return s ? s.v : null;
}

/** Liegt auf (r,c) ein FALSCH platzierter Stein? (nur für die Auswertung am Ende) */
export function misplacedCells(puzzle, placed) {
  const out = [];
  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const s = puzzle.slots[r][c];
      if (s && !s.given && placed[r][c] != null && placed[r][c] !== s.v) out.push([r, c]);
    }
  }
  return out;
}

export { solutionValues, evalExpr };
