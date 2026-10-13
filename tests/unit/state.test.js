import { work, at } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveState, planClockAction, ClockError } from '../../app/js/core/state.js';
import { computeDay } from '../../app/js/core/calc.js';

const DAY = '2026-03-02';

/** Simuliert die Datenbank: wendet geplante Änderungen an (wie repo.clock in einer Transaktion). */
function apply(db, plan) {
  for (const rec of plan.puts) {
    const i = db.findIndex((r) => r.id === rec.id);
    if (i >= 0) db[i] = rec; else db.push(rec);
  }
  return db;
}

function act(db, action, hhmm) {
  return apply(db, planClockAction(db, action, at(DAY, hhmm) + 42_000));
}

describe('Stempeluhr-Zustandsautomat', () => {
  test('vollständiger Ablauf: Beginn → Pause → Fortsetzen → Feierabend', () => {
    const db = [];
    assert.equal(deriveState(db).mode, 'idle');
    act(db, 'start', '08:00');
    assert.equal(deriveState(db).mode, 'working');
    act(db, 'pause', '12:00');
    assert.equal(deriveState(db).mode, 'break');
    act(db, 'resume', '12:30');
    assert.equal(deriveState(db).mode, 'working');
    act(db, 'end', '16:30');
    assert.equal(deriveState(db).mode, 'idle');
    const d = computeDay(db.filter((r) => r.day === DAY));
    assert.equal(d.status, 'complete');
    assert.equal(d.netMin, 480);
  });

  test('Zeitstempel werden auf die Minute abgeschnitten', () => {
    const db = act([], 'start', '08:00');
    assert.equal(db[0].start, at(DAY, '08:00'));
    assert.equal(db[0].source, 'clock');
  });

  test('Verhinderung doppelter Buchungen', () => {
    const db = act([], 'start', '08:00');
    assert.throws(() => planClockAction(db, 'start', at(DAY, '08:01')), (e) => e instanceof ClockError && e.code === 'already-running');
    act(db, 'pause', '10:00');
    assert.throws(() => planClockAction(db, 'pause', at(DAY, '10:01')), { code: 'already-break' });
    assert.throws(() => planClockAction(db, 'start', at(DAY, '10:02')), { code: 'already-running' });
  });

  test('ungültige Zustandswechsel im Leerlauf', () => {
    assert.throws(() => planClockAction([], 'pause', at(DAY, '09:00')), { code: 'not-working' });
    assert.throws(() => planClockAction([], 'resume', at(DAY, '09:00')), { code: 'no-break' });
    assert.throws(() => planClockAction([], 'end', at(DAY, '09:00')), { code: 'not-working' });
  });

  test('Feierabend während der Pause beendet beide', () => {
    const db = act([], 'start', '08:00');
    act(db, 'pause', '12:00');
    const plan = planClockAction(db, 'end', at(DAY, '12:20'));
    assert.equal(plan.puts.length, 2);
    apply(db, plan);
    assert.equal(deriveState(db).mode, 'idle');
    const d = computeDay(db);
    assert.equal(d.breakMin, 20);
    assert.equal(d.netMin, 240);
    assert.match(plan.message, /Pause/);
  });

  test('Neuladen während laufender Arbeitsphase stellt den Zustand wieder her', () => {
    const db = act([], 'start', '08:00');
    act(db, 'pause', '12:00');
    // „Neustart“: nur die gespeicherten Daten überleben (Serialisierung wie in IndexedDB)
    const reloaded = JSON.parse(JSON.stringify(db));
    const st = deriveState(reloaded);
    assert.equal(st.mode, 'break');
    assert.equal(st.session.start, at(DAY, '08:00'));
    assert.equal(st.brk.start, at(DAY, '12:00'));
    const d = computeDay(reloaded, { now: at(DAY, '12:30') });
    assert.equal(d.netMin, 240);
    act(reloaded, 'resume', '12:30');
    assert.equal(deriveState(reloaded).mode, 'working');
  });

  test('Mitternacht: Feierabend am Folgetag bleibt am Starttag', () => {
    const db = act([], 'start', '22:00');
    apply(db, planClockAction(db, 'end', at('2026-03-03', '06:00')));
    assert.equal(db[0].day, DAY);
    assert.equal(computeDay(db).netMin, 480);
  });

  test('Arbeitsbeginn vor dem Ende einer vorhandenen Phase wird abgelehnt', () => {
    const db = [work(DAY, '08:00', '18:00')];
    assert.throws(() => planClockAction(db, 'start', at(DAY, '17:00')), { code: 'overlap' });
  });

  test('Gerätezeit vor Beginn wird abgelehnt', () => {
    const db = act([], 'start', '08:00');
    assert.throws(() => planClockAction(db, 'end', at(DAY, '07:00')), { code: 'clock' });
  });

  test('inkonsistente Daten blockieren Stempelaktionen mit Hinweis', () => {
    const db = [work(DAY, '08:00', null), work('2026-03-03', '08:00', null)];
    assert.throws(() => planClockAction(db, 'end', at('2026-03-03', '09:00')), { code: 'inconsistent' });
  });
});
