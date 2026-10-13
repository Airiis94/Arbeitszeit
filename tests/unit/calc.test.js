import { work, pause, pauseMin, at } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeDay, calcAutoBreak } from '../../app/js/core/calc.js';

const MON = '2026-03-02'; // Montag

describe('Tagesberechnung', () => {
  test('normaler Arbeitstag mit einer Pause', () => {
    const d = computeDay([work(MON, '08:00', '16:30'), pause(MON, '12:00', '12:30')]);
    assert.equal(d.status, 'complete');
    assert.equal(d.grossMin, 510);
    assert.equal(d.breakMin, 30);
    assert.equal(d.netMin, 480);
    assert.equal(d.firstStart, at(MON, '08:00'));
    assert.equal(d.lastEnd, at(MON, '16:30'));
  });

  test('mehrere Pausen (mit Uhrzeit und nur Dauer)', () => {
    const d = computeDay([
      work(MON, '08:00', '17:00'),
      pause(MON, '10:00', '10:15'),
      pause(MON, '12:00', '12:45'),
      pause(MON, '15:00', '15:10'),
      pauseMin(MON, 5),
    ]);
    assert.equal(d.status, 'complete');
    assert.equal(d.breakMin, 15 + 45 + 10 + 5);
    assert.equal(d.netMin, 540 - 75);
  });

  test('mehrere Arbeitsphasen am selben Tag', () => {
    const d = computeDay([work(MON, '07:00', '11:00'), work(MON, '18:00', '20:30')]);
    assert.equal(d.netMin, 240 + 150);
    assert.equal(d.lastEnd, at(MON, '20:30'));
  });

  test('Arbeit über Mitternacht gehört zum Tag des Beginns', () => {
    const night = work(MON, '22:00', '06:00');
    assert.equal(night.day, MON);
    const d = computeDay([night, pause(MON, '02:00', '02:30', true)]);
    assert.equal(d.status, 'complete');
    assert.equal(d.grossMin, 480);
    assert.equal(d.netMin, 450);
  });

  test('Sommerzeit-Beginn: Nachtschicht ist eine Stunde kürzer', () => {
    // 29.03.2026 02:00 → 03:00 (Europe/Berlin)
    const d = computeDay([work('2026-03-28', '22:00', '06:00')]);
    assert.equal(d.netMin, 7 * 60);
  });

  test('Sommerzeit-Ende: Nachtschicht ist eine Stunde länger', () => {
    // 25.10.2026 03:00 → 02:00
    const d = computeDay([work('2026-10-24', '22:00', '06:00')]);
    assert.equal(d.netMin, 9 * 60);
  });

  test('laufender Tag wird live aus dem Zeitstempel berechnet', () => {
    const now = at(MON, '12:45') + 30_000; // 12:45:30
    const d = computeDay([work(MON, '08:00', null), pause(MON, '12:00', '12:30')], { now });
    assert.equal(d.status, 'running');
    assert.equal(d.grossMin, 285);
    assert.equal(d.netMin, 255);
  });

  test('laufende Pause zählt bis jetzt', () => {
    const now = at(MON, '12:20');
    const d = computeDay([work(MON, '08:00', null), pause(MON, '12:00', null)], { now });
    assert.equal(d.breakMin, 20);
    assert.equal(d.netMin, 240);
    assert.ok(d.openBreak);
  });

  test('überlappende Arbeitsphasen werden nicht doppelt gezählt, sondern als Fehler markiert', () => {
    const d = computeDay([work(MON, '08:00', '12:00'), work(MON, '11:00', '16:00')]);
    assert.equal(d.status, 'conflict');
    assert.ok(d.issues.some((i) => i.code === 'overlap-work'));
  });

  test('Pause außerhalb der Arbeitszeit ist ein Fehler', () => {
    const d = computeDay([work(MON, '08:00', '12:00'), pause(MON, '12:30', '13:00')]);
    assert.equal(d.status, 'conflict');
    assert.ok(d.issues.some((i) => i.code === 'break-outside'));
  });

  test('Pausen länger als Anwesenheit → Netto 0 und Fehler', () => {
    const d = computeDay([work(MON, '08:00', '08:20'), pauseMin(MON, 30)]);
    assert.equal(d.netMin, 0);
    assert.equal(d.status, 'conflict');
  });

  test('gelöschte Einträge (Tombstones) zählen nicht', () => {
    const w = work(MON, '08:00', '16:00');
    const p = { ...pause(MON, '12:00', '13:00'), deleted: true };
    assert.equal(computeDay([w, p]).netMin, 480);
  });
});

describe('Automatische Pause', () => {
  const rules = [{ afterMin: 360, breakMin: 30 }, { afterMin: 540, breakMin: 45 }];
  test('nur bei ausdrücklicher Aktivierung', () => {
    const d = computeDay([work(MON, '08:00', '18:00')]);
    assert.equal(d.autoBreakMin, 0);
    assert.equal(d.netMin, 600);
  });
  test('kappt den Abzug an der Schwelle', () => {
    assert.equal(calcAutoBreak(370, 0, rules), 10);
    assert.equal(calcAutoBreak(600, 0, rules), 45);
    assert.equal(calcAutoBreak(570, 30, rules), 15);
    assert.equal(calcAutoBreak(360, 0, rules), 0);
    assert.equal(calcAutoBreak(500, 30, rules), 0);
  });
  test('wird separat ausgewiesen', () => {
    const d = computeDay([work(MON, '08:00', '18:00')], { autoBreak: { enabled: true, rules } });
    assert.equal(d.breakMin, 0);
    assert.equal(d.autoBreakMin, 45);
    assert.equal(d.netMin, 555);
  });
});

