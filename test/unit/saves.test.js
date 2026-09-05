import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { pruneSaves, mergeSaves, snapshotProgress, SAVES_MAX } = await import('../../js/storage.js');

// Ein Brett aus lauter LUECKEN mit dem Wert 1 — damit lassen sich Fortschritt
// und „geloest" bequem konstruieren.
const board = (rows, cols) => ({ rows, cols, slots: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ v: 1, given: false }))) });
const placedAll = (rows, cols, v) => Array.from({ length: rows }, () => Array(cols).fill(v));
const entry = (id, ts, extra = {}) => ({ id, ts, puzzle: board(2, 2), placed: placedAll(2, 2, null), ...extra });

describe('storage.snapshotProgress', () => {
  test('zaehlt die gefuellten Luecken', () => {
    const p = board(2, 2);
    assert.equal(snapshotProgress({ puzzle: p, placed: placedAll(2, 2, null) }), 0);
    assert.equal(snapshotProgress({ puzzle: p, placed: placedAll(2, 2, 1) }), 100);
    assert.equal(snapshotProgress({ puzzle: p, placed: [[1, null], [null, null]] }), 25);
    // Auch ein falsch platzierter Stein zaehlt als Fortschritt — ob er richtig
    // liegt, entscheidet sich erst am Ende.
    assert.equal(snapshotProgress({ puzzle: p, placed: [[7, null], [null, null]] }), 25);
  });
  test('unbrauchbare Eingaben liefern 0 statt NaN', () => {
    for (const bad of [null, undefined, {}, { puzzle: null }, { puzzle: board(2, 2) }]) {
      assert.equal(snapshotProgress(bad), 0);
    }
  });
});

describe('storage.pruneSaves', () => {
  test('sortiert nach Aktualitaet und kappt', () => {
    const many = Array.from({ length: SAVES_MAX + 5 }, (_, i) => entry('g' + i, i));
    const out = pruneSaves(many);
    assert.equal(out.length, SAVES_MAX);
    assert.equal(out[0].id, 'g' + (SAVES_MAX + 4), 'neuester zuerst');
  });
  test('wirft bereits geloeste und leere Staende raus', () => {
    const solved = { id: 'solved', ts: 9, puzzle: board(2, 2), placed: placedAll(2, 2, 1) };
    const noBoard = { id: 'leer', ts: 8 };
    const ok = entry('ok', 7);
    const ids = pruneSaves([solved, noBoard, ok]).map((g) => g.id);
    assert.deepEqual(ids, ['ok']);
  });
  test('ein pending-Marker (Endlos zwischen zwei Leveln) bleibt gueltig', () => {
    // Er hat bewusst KEIN Brett — das naechste Level wird beim Fortsetzen frisch geladen.
    const pend = { id: 'e1', ts: 5, pending: true, endless: { level: 4 } };
    assert.equal(pruneSaves([pend]).length, 1);
  });
  test('doppelte ids kommen nur einmal vor, Unsinn fliegt raus', () => {
    const out = pruneSaves([entry('a', 2), entry('a', 1), null, {}, 'x']);
    assert.equal(out.length, 1);
    assert.equal(out[0].ts, 2, 'der juengere Eintrag gewinnt durch die Sortierung');
  });
});

describe('storage.mergeSaves (Geraete-Merge)', () => {
  test('vereinigt beide Seiten — nichts geht verloren', () => {
    const ids = mergeSaves([entry('a', 3)], [entry('b', 2)]).map((g) => g.id).sort();
    assert.deepEqual(ids, ['a', 'b']);
  });
  test('bei gleicher id gewinnt der juengere Stand', () => {
    const merged = mergeSaves([entry('a', 10, { elapsed: 111 })], [entry('a', 20, { elapsed: 222 })]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].elapsed, 222);
  });
  test('leere/kaputte Seiten sind unkritisch', () => {
    assert.deepEqual(mergeSaves(null, undefined), []);
    assert.equal(mergeSaves([entry('a', 1)], null).length, 1);
  });
});
