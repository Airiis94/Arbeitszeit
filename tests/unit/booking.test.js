import { work, pause, pauseMin, settings, dayWithNet, at, addDays } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bookStamp, bookDuration, bookInterval, bookDay, suggestLeave, gridOptions, stampChoices, bookingInterval } from '../../app/js/core/booking.js';
import { computeAccount, computeDay, dayRow, activityCheck, periodBalance } from '../../app/js/core/calc.js';
import { newRecord, newInterval, touch, normalizeSettings } from '../../app/js/core/model.js';
import { timeOfDay } from '../../app/js/core/time.js';

const MON = '2026-03-02';
const t = (hhmm, day = MON) => at(day, hhmm);
const booked = (hhmm, dir = null, day = MON) => timeOfDay(bookStamp(t(hhmm, day), dir).booked);

function account(intervals, today, extra = {}) {
  return computeAccount({ intervals, settings: settings(extra.start || MON, extra.settings), today, now: t(extra.now || '23:00', today), ...extra });
}

describe('Buchung auf die nächstgelegene Viertelstunde', () => {
  test('Stempelzeiten', () => {
    assert.equal(booked('08:50'), '08:45');
    assert.equal(booked('08:42'), '08:45');
    assert.equal(booked('08:52'), '08:45');
    assert.equal(booked('08:53'), '09:00');
    assert.equal(booked('17:49'), '17:45');
    assert.equal(booked('23:55'), '00:00');
    assert.equal(bookStamp(t('08:45')).dir, 'exact');
  });

  test('Kontowirkung je Stempel (Beispiele aus der Anforderung)', () => {
    const w = bookInterval(work(MON, '08:50', '17:49'));
    assert.equal(timeOfDay(w.start), '08:45');
    assert.equal(timeOfDay(w.end), '17:45');
    assert.deepEqual(w.stamps.map((s) => [s.label, s.effect]), [['Kommen', -5], ['Gehen', 4]]);
    assert.deepEqual(bookInterval(work(MON, '08:42', '17:00')).stamps.map((s) => s.effect), [3, 0]);
    // Pause 12:03–12:31 → 12:00–12:30: +3 (früher gebucht) und −1
    const p = bookInterval(pause(MON, '12:03', '12:31'));
    assert.deepEqual([timeOfDay(p.start), timeOfDay(p.end)], ['12:00', '12:30']);
    assert.deepEqual(p.stamps.map((s) => s.effect), [3, -1]);
  });

  test('andere Viertelstunde wählen (umschalten)', () => {
    const s = bookStamp(t('08:50'), 'up');
    assert.equal(timeOfDay(s.booked), '09:00');
    assert.equal(s.manual, true);
    assert.equal(timeOfDay(s.alt), '08:45');
    const rec = { ...work(MON, '08:50', '17:49'), startRound: 'up', endRound: 'up' };
    assert.deepEqual(bookInterval(rec).stamps.map((x) => x.effect), [10, -11]);
  });

  test('Pausen nur mit Dauer', () => {
    assert.equal(bookDuration(20).booked, 15);
    assert.equal(bookDuration(23).booked, 30);
    assert.equal(bookInterval(pauseMin(MON, 20)).stamps[0].effect, -5);
    assert.equal(bookInterval(pauseMin(MON, 23)).stamps[0].effect, 7);
    assert.equal(bookDuration(30).dir, 'exact');
  });

  test('Tag: gebuchte Arbeitszeit ist ein Viertelstundenwert; Differenz = gestempelt − gebucht', () => {
    const ivs = [work(MON, '08:50', '17:49'), pause(MON, '12:03', '12:31')];
    const b = bookDay(ivs);
    const d = computeDay(ivs);
    assert.equal(b.bookedNetMin, 510); // 08:45–17:45 − 0:30
    assert.equal(b.bookedNetMin % 15, 0);
    assert.equal(d.netMin, 511);
    assert.equal(b.effect, -5 + 4 + 3 - 1);
    assert.equal(d.netMin - b.bookedNetMin, b.effect);
  });

  test('gebuchtes Ende nie vor gebuchtem Beginn', () => {
    const rec = { ...work(MON, '08:50', '08:52'), startRound: 'up', endRound: 'down' };
    const b = bookInterval(rec);
    assert.equal(b.end, b.start);
  });

  test('Sommerzeit: Raster folgt der lokalen Uhrzeit', () => {
    assert.equal(booked('03:10', null, '2026-03-29'), '03:15');
    assert.equal(booked('02:20', null, '2026-10-25'), '02:15');
    assert.equal(gridOptions(t('08:50'), 30).offset, 20);
  });
});

describe('Zeitkonto der Differenzminuten (ohne Sollzeit)', () => {
  test('8 Stunden sind kein Muss: kurze Tage erzeugen keine Minusstunden', () => {
    const acc = account([work(MON, '08:45', '12:00')], MON);
    assert.equal(acc.balance, 0);
    assert.equal(acc.rowsByDay.get(MON).bookedNetMin, 195);
  });

  test('Kommen 08:50 → −0:05 sofort, Gehen 17:49 → +0:04', () => {
    let acc = account([work(MON, '08:50', null)], MON, { now: '09:30' });
    assert.equal(acc.balance, -5);
    acc = account([work(MON, '08:50', '17:49')], MON);
    assert.equal(acc.balance, -1);
  });

  test('Ausgleich am nächsten Tag durch späteres Gehen', () => {
    const d2 = addDays(MON, 1);
    const acc = account([work(MON, '08:50', '17:45'), work(d2, '08:45', '17:20')], d2);
    assert.equal(acc.rowsByDay.get(MON).balance, -5);
    assert.equal(acc.balance, 0);
  });

  test('Verrechnung mit dem Konto durch Umschalten', () => {
    const d2 = addDays(MON, 1);
    const a = work(MON, '08:40', '17:00'); // +5 Guthaben
    const b = work(d2, '08:55', '17:00'); // nächstgelegene: 09:00 (+5) – stattdessen 08:45 buchen (−10)
    let acc = account([a, b], d2);
    assert.equal(acc.balance, 10);
    acc = account([a, touch(b, { startRound: 'down' })], d2);
    assert.equal(acc.balance, -5);
    assert.equal(timeOfDay(acc.rowsByDay.get(d2).bookedFirst), '08:45');
  });

  test('Anfangssaldo, Korrekturen und Kontobeginn', () => {
    const corrections = [
      newRecord({ day: MON, minutes: 10, reason: 'Ausgleich' }),
      newRecord({ day: '2027-01-01', minutes: 99, reason: 'Zukunft' }),
    ];
    const acc = account([work('2026-02-27', '08:50', '17:00'), work(MON, '08:50', '17:00')], MON,
      { corrections, settings: { startBalanceMin: 30 } });
    assert.equal(acc.balance, 30 - 5 + 10);
    assert.equal(acc.futureCorrections.length, 1);
    assert.equal(acc.rows[0].day, MON);
  });

  test('Invariante: Σ gestempelt − Σ gebucht = Σ Differenzen (Zufallsdaten)', () => {
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
    const ivs = [];
    let day = MON;
    for (let i = 0; i < 90; i += 1) {
      const start = t('07:00', day) + rnd(180) * 60000;
      const end = start + (240 + rnd(360)) * 60000;
      ivs.push(newInterval({ kind: 'work', day, start, end, startRound: rnd(3) === 0 ? 'up' : null }));
      const ps = start + 180 * 60000 + rnd(30) * 60000;
      ivs.push(newInterval({ kind: 'break', day, start: ps, end: ps + (15 + rnd(40)) * 60000 }));
      day = addDays(day, 1);
    }
    const acc = account(ivs, addDays(day, -1));
    const actual = acc.rows.reduce((s, r) => s + r.netMin, 0);
    const bookedSum = acc.rows.reduce((s, r) => s + r.bookedNetMin, 0);
    assert.equal(actual - bookedSum, acc.effectTotal);
    assert.equal(acc.balance, acc.effectTotal);
    assert.ok(acc.rows.every((r) => r.bookedNetMin % 15 === 0 || r.stamps.some((x) => x.isDuration)));
  });

  test('dayWithNet-Hilfstag ohne Differenz bei Beginn 08:00', () => {
    const acc = account([dayWithNet(MON, 480)], MON);
    assert.equal(acc.balance, 0);
  });
});

describe('Ausgleichen beim Gehen', () => {
  test('Minus ausgleichen: nach der Viertelstunde gehen', () => {
    const s = suggestLeave(t('16:10'), -5);
    assert.deepEqual([timeOfDay(s.leave), timeOfDay(s.booked), s.effect], ['16:20', '16:15', 5]);
  });
  test('Plus nutzen: vor der Viertelstunde gehen', () => {
    const s = suggestLeave(t('16:10'), 3);
    assert.deepEqual([timeOfDay(s.leave), timeOfDay(s.booked), s.effect], ['16:12', '16:15', -3]);
  });
  test('höchstens 7 Minuten je Buchung, ±0 zur vollen Viertelstunde', () => {
    assert.equal(suggestLeave(t('16:10'), -20).effect, 7);
    assert.deepEqual(timeOfDay(suggestLeave(t('16:10'), 0).leave), '16:15');
    assert.deepEqual(timeOfDay(suggestLeave(t('16:00'), 0).leave), '16:00');
  });
});

describe('Gebuchte Zeit frei wählen (auf- oder abrunden, Konto nutzen)', () => {
  const choiceFor = (rec, field) => {
    const st = bookInterval(rec).stamps.find((x) => x.field === field);
    return Object.fromEntries(stampChoices(st).map((c) => [st.isDuration ? c.booked : timeOfDay(c.booked), c]));
  };

  test('Kommen 08:52: 08:45 = −0:07 (Standard), 09:00 = +0:08', () => {
    const rec = work(MON, '08:52', '17:00');
    const c = choiceFor(rec, 'start');
    assert.equal(c['08:45'].effect, -7);
    assert.equal(c['08:45'].nearest, true);
    assert.equal(c['09:00'].effect, 8);
    assert.equal(c['09:00'].nearest, false);
    // ±2 Stunden zur Auswahl
    assert.ok(c['06:45'] && c['10:45']);
    assert.equal(c['10:45'].effect, 113);
    const chosen = bookInterval({ ...rec, startBooked: t('09:00') });
    assert.equal(timeOfDay(chosen.start), '09:00');
    assert.equal(chosen.stamps[0].effect, 8);
    assert.equal(chosen.stamps[0].manual, true);
  });

  test('Früher gehen und später buchen: Gehen 17:20 als 17:45 → −0:25 aus dem Konto', () => {
    const rec = work(MON, '08:45', '17:20');
    assert.equal(choiceFor(rec, 'end')['17:45'].effect, -25);
    assert.equal(choiceFor(rec, 'end')['17:15'].effect, 5);
    const d2 = addDays(MON, 1);
    const plus = work(MON, '08:30', '17:00'); // 08:30 → +0:00; Startsaldo bringt Guthaben
    let acc = account([plus, work(d2, '08:45', '17:20')], d2, { settings: { startBalanceMin: 30 } });
    assert.equal(acc.balance, 35);
    acc = account([plus, { ...work(d2, '08:45', '17:20'), endBooked: t('17:45', d2) }], d2, { settings: { startBalanceMin: 30 } });
    assert.equal(acc.balance, 5);
    assert.equal(acc.rowsByDay.get(d2).bookedNetMin, 9 * 60);
  });

  test('Pausen: Beginn/Ende und reine Dauer wählbar', () => {
    const p = pause(MON, '12:03', '12:31');
    assert.equal(choiceFor(p, 'start')['12:15'].effect, -12); // Pausenbeginn später gebucht = mehr Arbeit gebucht als gearbeitet
    assert.equal(choiceFor(p, 'end')['12:15'].effect, -16);
    const d = pauseMin(MON, 20);
    const c = choiceFor(d, 'start');
    assert.equal(c[15].nearest, true);
    assert.equal(c[30].effect, 10);
    assert.equal(c[0].effect, -20);
    assert.equal(bookInterval({ ...d, durationBooked: 30 }).durationMin, 30);
  });

  test('Wahl wird durch ein neues Raster nicht verworfen; Altdaten (startRound) gelten weiter', () => {
    const rec = { ...work(MON, '08:52', '17:00'), startBooked: t('09:00') };
    assert.equal(timeOfDay(bookInterval(rec, 30).start), '09:00');
    assert.equal(timeOfDay(bookInterval({ ...work(MON, '08:52', '17:00'), startRound: 'up' }).start), '09:00');
  });

  test('Raster 30 Minuten: nur halbe Stunden zur Auswahl', () => {
    const st = bookInterval(work(MON, '08:52', '17:00'), 30).stamps[0];
    const list = stampChoices(st, 30).map((c) => timeOfDay(c.booked));
    assert.ok(list.includes('08:30') && list.includes('09:00') && !list.includes('08:45'));
  });
});

describe('Erfassungsart', () => {
  test('Standard ist Viertelstunden; minutengenau bucht ohne Differenzen', () => {
    assert.equal(bookingInterval(settings(MON)), 15);
    assert.equal(bookingInterval(settings(MON, { rounding: { interval: 30 } })), 30);
    const exact = settings(MON, { trackingMode: 'exact' });
    assert.equal(bookingInterval(exact), 1);
    const rec = { ...work(MON, '08:52', '17:23'), endBooked: t('17:45') };
    const b = bookInterval(rec, 1);
    assert.deepEqual([timeOfDay(b.start), timeOfDay(b.end)], ['08:52', '17:23']); // Wahl ruht im Minutenmodus
    assert.deepEqual(b.stamps.map((x) => x.effect), [0, 0]);
    assert.deepEqual(stampChoices(b.stamps[0], 1), []);
    const acc = computeAccount({ intervals: [rec], settings: { ...exact, startBalanceMin: 12 }, today: MON, now: t('23:00') });
    assert.equal(acc.balance, 12);
  });

  test('Altdaten ohne Erfassungsart → Viertelstunden; ungültige Werte werden ersetzt', () => {
    assert.equal(normalizeSettings({ accountStart: MON }).trackingMode, 'quarter');
    assert.equal(normalizeSettings({ accountStart: MON, trackingMode: 'foo' }).trackingMode, 'quarter');
    assert.equal(normalizeSettings({ accountStart: MON, trackingMode: 'exact' }).trackingMode, 'exact');
  });
});

describe('Tätigkeiten = festgelegte Netto-Arbeitszeit', () => {
  const act = (minutes, day = MON) => newRecord({ day, title: 'x', minutes, intensity: null, category: null });

  test('Ziel ist die gebuchte (gerundete) Netto-Arbeitszeit, nicht die gestempelte', () => {
    const iv = [work(MON, '08:52', '17:20'), pause(MON, '12:00', '12:30')];
    const row = dayRow(MON, iv, null, settings(MON), t('23:00'));
    assert.equal(row.bookedNetMin, 8 * 60); // 08:45–17:15 − 0:30
    assert.deepEqual(activityCheck(row, [act(240), act(180)]), { target: 480, sum: 420, gap: 60, running: false });
    assert.equal(activityCheck(row, [act(240), act(240), act(30, addDays(MON, 1))]).gap, 0);
    assert.equal(activityCheck(row, [act(500)]).gap, -20);
    assert.equal(activityCheck(row, [{ ...act(500), deleted: true }]).sum, 0);
    // Gewählte Buchung ändert das Ziel
    const later = dayRow(MON, [{ ...iv[0], endBooked: t('17:45') }, iv[1]], null, settings(MON), t('23:00'));
    assert.equal(activityCheck(later, []).target, 8 * 60 + 30);
  });

  test('minutengenau: Ziel ist die gestempelte Netto-Arbeitszeit; laufender Tag', () => {
    const exact = settings(MON, { trackingMode: 'exact' });
    const row = dayRow(MON, [work(MON, '08:52', '17:20'), pause(MON, '12:00', '12:30')], null, exact, t('23:00'));
    assert.equal(activityCheck(row, []).target, 478);
    const run = dayRow(MON, [work(MON, '08:00', null)], null, settings(MON), t('10:00'));
    const chk = activityCheck(run, []);
    assert.equal(chk.running, true);
    assert.equal(chk.target, 120);
  });
});

describe('Zeitkonto läuft über Wochen, Monate und Jahre weiter', () => {
  // Kontobeginn 28.12.2026 (Mo), Anfangssaldo +0:25; Stempel mit Differenzen an mehreren Tagen
  const days = [
    work('2026-12-28', '08:50', '17:00'), // −0:05
    work('2026-12-31', '08:42', '15:00'), // +0:03
    work('2027-01-04', '08:52', '17:20'), // −0:07, +0:05
    work('2027-01-29', '08:45', '17:49'), // +0:04
    work('2027-02-01', '08:40', '16:00'), // +0:05
  ];
  const corrections = [newRecord({ day: '2027-01-15', minutes: -30, reason: 'Arzt' })];
  const acc = computeAccount({ intervals: days, corrections, settings: settings('2026-12-28', { startBalanceMin: 25 }), today: '2027-02-03', now: at('2027-02-03', '23:00') });

  test('kein Zurücksetzen an Wochen-, Monats- oder Jahresgrenzen', () => {
    assert.equal(acc.rowsByDay.get('2026-12-31').balance, 25 - 5 + 3);
    assert.equal(acc.rowsByDay.get('2027-01-01').balance, 23); // Jahreswechsel: Stand bleibt
    assert.equal(acc.rowsByDay.get('2027-01-04').balance, 23 - 7 + 5);
    assert.equal(acc.rowsByDay.get('2027-01-31').balance, 21 - 30 + 4);
    assert.equal(acc.balance, -5 + 5);
  });

  test('Übertrag + Veränderung = Ende; das Ende ist der Übertrag des nächsten Zeitraums', () => {
    const dec = periodBalance(acc, '2026-12-01', '2026-12-31');
    assert.deepEqual(dec, { carryIn: 25, change: -2, end: 23, counted: 4 }); // Konto beginnt am 28.12.
    const jan = periodBalance(acc, '2027-01-01', '2027-01-31');
    assert.deepEqual(jan, { carryIn: 23, change: -7 + 5 - 30 + 4, end: -5, counted: 31 });
    const feb = periodBalance(acc, '2027-02-01', '2027-02-28');
    assert.equal(feb.carryIn, jan.end);
    assert.equal(feb.end, acc.balance);
    // Wochen über den Monatswechsel hinweg
    const w1 = periodBalance(acc, '2027-01-25', '2027-01-31');
    const w2 = periodBalance(acc, '2027-02-01', '2027-02-07');
    assert.equal(w2.carryIn, w1.end);
    assert.equal(w1.end, acc.rowsByDay.get('2027-01-31').balance);
    // Zeitraum in der Zukunft: Übertrag = aktueller Stand
    assert.deepEqual(periodBalance(acc, '2027-03-01', '2027-03-31'), { carryIn: acc.balance, change: 0, end: acc.balance, counted: 0 });
    // Zeitraum vor dem Kontobeginn: kein Konto
    assert.equal(periodBalance(acc, '2026-11-01', '2026-11-30'), null);
    // Kontobeginn in der Zukunft: kein Konto
    assert.equal(periodBalance(computeAccount({ intervals: [], settings: settings('2027-05-01'), today: '2027-02-03' }), '2027-02-01', '2027-02-28'), null);
  });
});

describe('Übernahme alter Einstellungen', () => {
  test('Sollzeit-Felder früherer Versionen werden entfernt', () => {
    const n = normalizeSettings({ accountStart: MON, startBalanceMin: 0, targetRules: [{ validFrom: MON, minutes: [480, 480, 480, 480, 480, 0, 0] }], countEmptyDays: true, rounding: { mode: 'carry', interval: 15, carryRule: 'keep' } });
    assert.equal(n.targetRules, undefined);
    assert.equal(n.countEmptyDays, undefined);
    assert.deepEqual(n.rounding, { interval: 15 });
  });
});
