import { settings, dayWithNet, at } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDuration, fmtDuration, addDays, daysBetween, dayKey, localTimestamp, isValidDayKey, weekdayIndex,
  isoWeek, addMonths, lastOfMonth, isLastDayOfMonth, floorToMinute,
} from '../../app/js/core/time.js';
import { csvCell, daysToCsv, activitiesToCsv } from '../../app/js/core/csv.js';
import { computeAccount } from '../../app/js/core/calc.js';
import { newRecord } from '../../app/js/core/model.js';

describe('Zeit-Hilfen', () => {
  test('Dauer formatieren', () => {
    assert.equal(fmtDuration(470), '7:50');
    assert.equal(fmtDuration(-20), '−0:20');
    assert.equal(fmtDuration(20, { sign: true }), '+0:20');
    assert.equal(fmtDuration(0, { sign: true }), '0:00');
    assert.equal(fmtDuration(null), '–');
  });

  test('Dauer einlesen', () => {
    assert.equal(parseDuration('90'), 90);
    assert.equal(parseDuration('1:30'), 90);
    assert.equal(parseDuration('1,5h'), 90);
    assert.equal(parseDuration('1.5'), 90);
    assert.equal(parseDuration('45 min'), 45);
    assert.equal(parseDuration('2h'), 120);
    assert.equal(parseDuration('2h15'), 135);
    assert.equal(parseDuration('-0:30'), -30);
    assert.equal(parseDuration('abc'), null);
    assert.equal(parseDuration(''), null);
  });

  test('Kalenderarithmetik über Sommerzeitwechsel', () => {
    assert.equal(addDays('2026-03-28', 1), '2026-03-29');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  test('lokaler Tag eines Zeitpunkts', () => {
    assert.equal(dayKey(localTimestamp('2026-03-29', '00:30')), '2026-03-29');
    assert.equal(dayKey(localTimestamp('2026-10-25', '23:59')), '2026-10-25');
  });

  test('Datumsprüfung und Wochentage', () => {
    assert.equal(isValidDayKey('2026-02-29'), false);
    assert.equal(isValidDayKey('2028-02-29'), true);
    assert.equal(weekdayIndex('2026-03-02'), 0);
    assert.equal(weekdayIndex('2026-03-08'), 6);
    assert.equal(isoWeek('2026-01-01'), 1);
    assert.equal(isoWeek('2026-12-31'), 53);
    assert.equal(addMonths('2026-12', 1), '2027-01');
    assert.equal(addMonths('2026-01', -1), '2025-12');
    assert.equal(lastOfMonth('2028-02'), '2028-02-29');
    assert.equal(isLastDayOfMonth('2026-04-30'), true);
  });

  test('Minuten abschneiden', () => {
    const t = at('2026-03-02', '08:00');
    assert.equal(floorToMinute(t + 59_999), t);
  });
});

describe('CSV-Export', () => {
  test('Maskierung und Schutz vor Formel-Injektion', () => {
    assert.equal(csvCell('a;b'), '"a;b"');
    assert.equal(csvCell('Er sagte "hallo"'), '"Er sagte ""hallo"""');
    assert.equal(csvCell('=SUMME(A1)', { text: true }), "'=SUMME(A1)");
    assert.equal(csvCell('-5', { text: true }), "'-5");
  });

  test('Tages-CSV enthält gebuchte und gestempelte Zeiten', () => {
    const day = '2026-03-02';
    const acc = computeAccount({ intervals: [dayWithNet(day, 460)], settings: settings(day), today: day, now: at(day, '23:00') });
    const csv = daysToCsv(acc.rows);
    assert.ok(csv.startsWith('\uFEFFDatum;Wochentag;Status'));
    const line = csv.split('\r\n')[1].split(';');
    assert.equal(line[0], '02.03.2026');
    assert.equal(line[4], '08:00'); // Kommen gebucht
    assert.equal(line[5], '15:45'); // Gehen 15:40 → gebucht 15:45
    assert.equal(line[7], '7:45'); // Arbeitszeit gebucht
    assert.equal(line[12], '7:40'); // Arbeitszeit gestempelt
    assert.equal(line[13], '−0:05'); // Differenz
    assert.equal(line[15], '−0:05'); // Zeitkonto
  });

  test('Tätigkeiten-CSV', () => {
    const csv = activitiesToCsv([newRecord({ day: '2026-03-02', title: 'Bericht; Teil 1', description: '', minutes: 75, intensity: 'mittel', category: '' })]);
    assert.match(csv, /02\.03\.2026;"Bericht; Teil 1";;75;1:15;mittel;/);
  });
});
