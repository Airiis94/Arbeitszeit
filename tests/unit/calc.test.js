import { work, pause, pauseMin, settings, dayWithNet, at, addDays } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeDay, computeAccount, targetFor, calcAutoBreak } from '../../app/js/core/calc.js';
import { touch, newRecord } from '../../app/js/core/model.js';

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

describe('Sollzeit', () => {
  const s = settings(MON, 480);
  s.targetRules.push({ id: 'r2', validFrom: '2026-04-01', minutes: [420, 420, 420, 420, 300, 0, 0] });
  test('Wochentagsregel und Regelwechsel', () => {
    assert.equal(targetFor(MON, s, null), 480);
    assert.equal(targetFor('2026-03-07', s, null), 0); // Samstag
    assert.equal(targetFor('2026-04-03', s, null), 300); // Freitag, neue Regel
    assert.equal(targetFor('2026-01-05', s, null), 480); // vor erster Regel → erste Regel
  });
  test('Tagesart und individuelle Sollzeit', () => {
    assert.equal(targetFor(MON, s, { dayType: 'urlaub' }), 0);
    assert.equal(targetFor(MON, s, { dayType: 'ausgleich' }), 480);
    assert.equal(targetFor(MON, s, { dayType: 'arbeit', targetOverrideMin: 240 }), 240);
  });
});

function account(intervals, s, today, extra = {}) {
  return computeAccount({ intervals, dayInfos: [], corrections: [], settings: s, today, now: at(today, '23:00'), ...extra });
}

describe('Zeitkonto und Viertelstundenverrechnung', () => {
  test('Beispiel: 7:40 → 7:30 angerechnet, 0:10 Rest', () => {
    const acc = account([dayWithNet(MON, 460)], settings(MON, 480), MON);
    const r = acc.rowsByDay.get(MON);
    assert.equal(r.netMin, 460);
    assert.equal(r.credited, 450);
    assert.equal(r.carryOut, 10);
    assert.equal(r.diff, -30);
    assert.equal(acc.balance, -30);
    assert.equal(acc.carry, 10);
  });

  test('negative Tagesdifferenz', () => {
    const acc = account([work(MON, '08:00', '15:00'), pause(MON, '12:00', '12:30')], settings(MON, 480), MON);
    const r = acc.rowsByDay.get(MON);
    assert.equal(r.netMin, 390);
    assert.equal(r.credited, 390);
    assert.equal(r.diff, -90);
    assert.equal(acc.balance, -90);
  });

  test('positive Tagesdifferenz', () => {
    const acc = account([dayWithNet(MON, 520)], settings(MON, 480), MON);
    const r = acc.rowsByDay.get(MON);
    assert.equal(r.credited, 510);
    assert.equal(r.carryOut, 10);
    assert.equal(r.diff, 30);
  });

  test('Übertrag von Restminuten in den Folgetag', () => {
    const d2 = addDays(MON, 1);
    const acc = account([dayWithNet(MON, 460), dayWithNet(d2, 487)], settings(MON, 480), d2);
    const r2 = acc.rowsByDay.get(d2);
    assert.equal(r2.carryIn, 10);
    assert.equal(r2.credited, 495); // 487 + 10 = 497 → 495
    assert.equal(r2.carryOut, 2);
    assert.equal(acc.balance, -30 + 15);
  });

  test('Verrechnung mehrerer Restbeträge zu einer vollen Viertelstunde', () => {
    const days = [MON, addDays(MON, 1), addDays(MON, 2)];
    const s = settings(MON, 450);
    const acc = account(days.map((d) => dayWithNet(d, 460)), s, days[2]);
    const rows = days.map((d) => acc.rowsByDay.get(d));
    assert.deepEqual(rows.map((r) => r.credited), [450, 465, 465]);
    assert.deepEqual(rows.map((r) => r.carryOut), [10, 5, 0]);
    assert.deepEqual(rows.map((r) => r.diff), [0, 15, 15]);
    assert.equal(acc.balance, 30);
    assert.equal(acc.carry, 0);
    // Keine Minute verloren, keine doppelt: 3 × 7:40 = 23:00 = 3 × 7:30 + 0:30
    assert.equal(rows.reduce((a, r) => a + r.credited, 0) + acc.carry, 3 * 460);
  });

  test('Invariante: Σ angerechnet + Rest = Σ netto (Zufallsdaten)', () => {
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const intervals = [];
    let day = MON;
    let totalNet = 0;
    for (let i = 0; i < 120; i += 1) {
      const net = Math.floor(rnd() * 600);
      totalNet += net;
      intervals.push(dayWithNet(day, net));
      day = addDays(day, 1);
    }
    const today = addDays(day, -1);
    const s = settings(MON, 480, { countEmptyDays: true });
    const acc = account(intervals, s, today);
    const credited = acc.rows.reduce((a, r) => a + (r.credited || 0), 0);
    assert.equal(credited + acc.carry, totalNet);
    assert.ok(acc.carry >= 0 && acc.carry < 15);
    const targets = acc.rows.reduce((a, r) => a + r.target, 0);
    assert.equal(acc.balance, credited - targets);
  });

  test('Modus „minutengenau“: keine Rundung, kein Rest', () => {
    const acc = account([dayWithNet(MON, 487)], settings(MON, 480, { rounding: { mode: 'exact' } }), MON);
    assert.equal(acc.rowsByDay.get(MON).credited, 487);
    assert.equal(acc.balance, 7);
    assert.equal(acc.carry, 0);
  });

  test('Modus „abrunden, Reste verfallen“ weist verfallene Minuten aus', () => {
    const d2 = addDays(MON, 1);
    const acc = account([dayWithNet(MON, 487), dayWithNet(d2, 470)], settings(MON, 480, { rounding: { mode: 'floor' } }), d2);
    assert.equal(acc.rowsByDay.get(MON).credited, 480);
    assert.equal(acc.rowsByDay.get(MON).forfeited, 7);
    assert.equal(acc.forfeitedTotal, 7 + 5);
    assert.equal(acc.carry, 0);
  });

  test('anderes Intervall (10 Minuten)', () => {
    const acc = account([dayWithNet(MON, 487)], settings(MON, 480, { rounding: { interval: 10 } }), MON);
    assert.equal(acc.rowsByDay.get(MON).credited, 480);
    assert.equal(acc.carry, 7);
  });

  test('Monatsabschluss: Rest gutschreiben bzw. verfallen lassen', () => {
    const last = '2026-03-31';
    const first = '2026-04-01';
    const iv = [dayWithNet(last, 490), dayWithNet(first, 480)];
    const credit = account(iv, settings(last, 480, { rounding: { carryRule: 'month-credit' } }), first);
    assert.equal(credit.rowsByDay.get(last).flushCredit, 10);
    assert.equal(credit.rowsByDay.get(first).carryIn, 0);
    assert.equal(credit.balance, 0 + 10 + 0);
    const forfeit = account(iv, settings(last, 480, { rounding: { carryRule: 'month-forfeit' } }), first);
    assert.equal(forfeit.rowsByDay.get(last).flushForfeit, 10);
    assert.equal(forfeit.forfeitedTotal, 10);
    assert.equal(forfeit.balance, 0);
    const keep = account(iv, settings(last, 480), first);
    assert.equal(keep.rowsByDay.get(first).carryIn, 10);
    assert.equal(keep.carry, 10);
  });

  test('Monatsabschluss erst, wenn der Monat vorbei ist', () => {
    const last = '2026-03-31';
    const acc = account([dayWithNet(last, 490)], settings(last, 480, { rounding: { carryRule: 'month-credit' } }), last);
    assert.equal(acc.carry, 10);
    assert.equal(acc.rowsByDay.get(last).flushCredit, 0);
  });

  test('Tage ohne Buchung zählen mit −Soll; Wochenende ohne Soll neutral', () => {
    const fri = '2026-03-06';
    const mon2 = '2026-03-09';
    const acc = account([dayWithNet(MON, 480)], settings(MON, 480), mon2);
    // Di–Fr fehlen je 8 h, Sa/So 0, Montag 09.03. ist heute ohne Buchung → zählt noch nicht
    assert.equal(acc.rowsByDay.get(fri).diff, -480);
    assert.equal(acc.rowsByDay.get('2026-03-07').diff, 0);
    assert.equal(acc.rowsByDay.get(mon2).counted, false);
    assert.equal(acc.balance, -4 * 480);
    const ignore = account([dayWithNet(MON, 480)], settings(MON, 480, { countEmptyDays: false }), mon2);
    assert.equal(ignore.balance, 0);
  });

  test('Abwesenheit (Urlaub) belastet das Konto nicht', () => {
    const d2 = addDays(MON, 1);
    const info = newRecord({ day: MON, dayType: 'urlaub', targetOverrideMin: null, note: '' });
    const acc = account([], settings(MON, 480), d2, { dayInfos: [info] });
    assert.equal(acc.rowsByDay.get(MON).diff, 0);
  });

  test('Anfangssaldo und Korrekturen mit Begründung', () => {
    const d2 = addDays(MON, 1);
    const corrections = [
      newRecord({ day: MON, minutes: 60, reason: 'Dienstreise nachträglich' }),
      newRecord({ day: '2026-01-10', minutes: -15, reason: 'vor Kontobeginn' }),
      newRecord({ day: '2027-01-01', minutes: 999, reason: 'Zukunft' }),
      { ...newRecord({ day: MON, minutes: 500, reason: 'gelöscht' }), deleted: true },
    ];
    const acc = account([dayWithNet(MON, 480), dayWithNet(d2, 480)], settings(MON, 480, { startBalanceMin: 120 }), d2, { corrections });
    assert.equal(acc.balance, 120 + 60 - 15);
    assert.equal(acc.correctionsTotal, 45);
    assert.equal(acc.futureCorrections.length, 1);
  });

  test('Vergessener Feierabend: Tag zählt nicht, bis er korrigiert ist', () => {
    const open = work(MON, '08:00', null);
    const d3 = addDays(MON, 2);
    const s = settings(MON, 480, { countEmptyDays: false });
    let acc = account([open], s, d3);
    assert.equal(acc.rowsByDay.get(MON).status, 'incomplete');
    assert.equal(acc.rowsByDay.get(MON).counted, false);
    assert.equal(acc.problems.length, 1);
    assert.equal(acc.balance, 0);
    // Nachträgliche Korrektur
    const fixed = touch(open, { end: at(MON, '16:45') });
    acc = account([fixed], s, d3);
    const r = acc.rowsByDay.get(MON);
    assert.equal(r.status, 'complete');
    assert.equal(r.netMin, 525);
    assert.equal(r.credited, 525);
    assert.equal(acc.balance, 45);
    assert.equal(acc.problems.length, 0);
  });

  test('laufender Tag zählt nicht zum Saldo, liefert aber eine Vorschau', () => {
    const now = at(MON, '15:10');
    const acc = computeAccount({
      intervals: [work(MON, '08:00', null)], dayInfos: [], corrections: [], settings: settings(MON, 480), today: MON, now,
    });
    assert.equal(acc.balance, 0);
    assert.equal(acc.preview.netMin, 430);
    assert.equal(acc.preview.credited, 420);
    assert.equal(acc.preview.exactDiff, -50);
    assert.equal(acc.preview.balance, -60);
  });

  test('Tage vor dem Kontobeginn zählen nicht', () => {
    const acc = account([dayWithNet('2026-02-27', 600), dayWithNet(MON, 480)], settings(MON, 480), MON);
    assert.equal(acc.rows[0].day, MON);
    assert.equal(acc.balance, 0);
  });
});
