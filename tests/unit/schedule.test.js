import { work, pause, planSettings, settings, at, addDays } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleFor, plannedUntil, liveDeviation, deviationBreakdown, evenOutTime, validateScheduleEntry, plannedMinutes,
} from '../../app/js/core/schedule.js';
import { computeDay, computeAccount, targetFor } from '../../app/js/core/calc.js';
import { normalizeSettings, newRecord } from '../../app/js/core/model.js';
import { timeOfDay } from '../../app/js/core/time.js';

const MON = '2026-03-02';
const S = planSettings(MON); // Mo–Fr 08:45–17:15, Pause 12:00–12:30 → Soll 8:00

function live(intervals, hhmm, day = MON, s = S) {
  const now = at(day, hhmm);
  return computeAccount({ intervals, settings: s, today: day, now }).live;
}

describe('Arbeitszeitplan', () => {
  test('Soll ergibt sich aus dem Plan', () => {
    assert.equal(plannedMinutes({ start: '08:45', end: '17:15', breakStart: '12:00', breakEnd: '12:30' }), 480);
    assert.equal(plannedMinutes({ start: '07:00', end: '12:00' }), 300);
    assert.equal(targetFor(MON, S, null), 480);
    assert.equal(targetFor('2026-03-07', S, null), 0); // Samstag: kein Plan
    assert.equal(targetFor(MON, S, { dayType: 'urlaub' }), 0);
  });

  test('Prüfung von Planeinträgen', () => {
    assert.deepEqual(validateScheduleEntry({ start: '08:45', end: '17:15', breakStart: '12:00', breakEnd: '12:30' }), []);
    assert.ok(validateScheduleEntry({ start: '17:00', end: '08:00' }).length);
    assert.ok(validateScheduleEntry({ start: '08:00', end: '17:00', breakStart: '12:00' }).length);
    assert.ok(validateScheduleEntry({ start: '08:00', end: '12:00', breakStart: '12:30', breakEnd: '13:00' }).length);
  });

  test('Plan bis zu einem Zeitpunkt (ohne feste Pause)', () => {
    const plan = scheduleFor(MON, S);
    assert.equal(plannedUntil(plan, at(MON, '08:00')), 0);
    assert.equal(plannedUntil(plan, at(MON, '08:47')), 2);
    assert.equal(plannedUntil(plan, at(MON, '12:15')), 195);
    assert.equal(plannedUntil(plan, at(MON, '12:30')), 195);
    assert.equal(plannedUntil(plan, at(MON, '20:00')), 480);
    assert.equal(scheduleFor(MON, S, { dayType: 'krank' }), null);
    assert.equal(scheduleFor(MON, S, { targetOverrideMin: 240 }), null);
  });
});

describe('Verrechnungskonto: Abweichung vom Plan (Beispiel 08:47 statt 08:45)', () => {
  test('2 Minuten zu spät → −0:02 direkt beim Ankommen', () => {
    const l = live([work(MON, '08:47', null)], '08:47');
    assert.equal(l.deviation, -2);
    assert.equal(l.minuteBalance, -2);
  });

  test('noch nicht eingestempelt: Rückstand wächst ab Planbeginn', () => {
    assert.equal(live([], '08:40').deviation, 0);
    assert.equal(live([], '08:50').deviation, -5);
  });

  test('kein Rückstand mitten am Tag, wenn pünktlich (früher: −5:00 gegen das volle Tagessoll)', () => {
    const l = live([work(MON, '08:45', null)], '11:45');
    assert.equal(l.deviation, 0);
    assert.equal(l.netMin, 180);
  });

  test('2 Minuten länger bleiben gleicht aus → ±0 und Tag abgeschlossen', () => {
    const iv = [work(MON, '08:47', '17:17'), pause(MON, '12:00', '12:30')];
    const acc = computeAccount({ intervals: iv, settings: S, today: MON, now: at(MON, '18:00') });
    const r = acc.rowsByDay.get(MON);
    assert.equal(r.netMin, 480);
    assert.equal(r.exactDiff, 0);
    assert.equal(acc.minuteBalance, 0);
    assert.equal(acc.balance, 0);
    const items = deviationBreakdown(scheduleFor(MON, S), computeDay(iv));
    assert.deepEqual(items.map((i) => [i.key, i.minutes]), [['start', -2], ['end', 2], ['break', 0]]);
  });

  test('feste Pausenzeit: verschobene Pause zählt sofort', () => {
    const iv = [work(MON, '08:45', null), pause(MON, '12:10', null)];
    assert.equal(live([work(MON, '08:45', null)], '12:05').deviation, 5); // Plan hat Pause, ich arbeite noch
    assert.equal(live(iv, '12:20').deviation, 10); // 10 min später in die Pause gegangen
    assert.equal(live(iv, '12:35').deviation, 5); // Plan arbeitet wieder, ich bin noch in Pause
    const done = [work(MON, '08:45', null), pause(MON, '12:10', '12:40')];
    assert.equal(live(done, '12:40').deviation, 0);
  });

  test('Pause überzogen → Minusminuten in der Aufschlüsselung', () => {
    const iv = [work(MON, '08:45', '17:15'), pause(MON, '12:00', '12:40')];
    const items = deviationBreakdown(scheduleFor(MON, S), computeDay(iv));
    assert.deepEqual(items.map((i) => [i.key, i.minutes]), [['start', 0], ['end', 0], ['break', -10]]);
  });

  test('Minusminuten häufen sich kumulativ an; Saldo in Viertelstunden + Rest', () => {
    const days = [MON, addDays(MON, 1), addDays(MON, 2)];
    const iv = days.flatMap((d) => [work(d, '08:47', '17:15'), pause(d, '12:00', '12:30')]); // je 2 min zu spät
    const acc = computeAccount({ intervals: iv, settings: S, today: days[2], now: at(days[2], '18:00') });
    assert.deepEqual(days.map((d) => acc.rowsByDay.get(d).exactDiff), [-2, -2, -2]);
    assert.deepEqual(days.map((d) => acc.rowsByDay.get(d).minuteBalance), [-2, -4, -6]);
    assert.equal(acc.minuteBalance, -6);
    // Viertelstunden: 7:58 → 7:45 (−0:15, Rest 0:13), 7:58+0:13 → 8:00 (Rest 0:11), 7:58+0:11 → 8:00 (Rest 0:09)
    assert.equal(acc.balance, -15);
    assert.equal(acc.carry, 9);
    assert.equal(acc.balance + acc.carry, acc.minuteBalance);
  });

  test('Ausgleich am Folgetag bringt beide Konten auf ±0', () => {
    const d2 = addDays(MON, 1);
    const iv = [work(MON, '08:47', '17:15'), pause(MON, '12:00', '12:30'), work(d2, '08:45', '17:17'), pause(d2, '12:00', '12:30')];
    const acc = computeAccount({ intervals: iv, settings: S, today: d2, now: at(d2, '18:00') });
    assert.equal(acc.minuteBalance, 0);
    assert.equal(acc.balance, 0);
    assert.equal(acc.carry, 0);
  });

  test('„Für ±0 gehen um“ berücksichtigt heutigen Rückstand und Konto', () => {
    const plan = scheduleFor(MON, S);
    const now = at(MON, '10:00');
    const d = computeDay([work(MON, '08:47', null)], { now });
    const dev = liveDeviation(plan, d.netMin, now);
    assert.equal(dev, -2);
    assert.equal(timeOfDay(evenOutTime(plan, dev, now)), '17:17');
    assert.equal(timeOfDay(evenOutTime(plan, dev, now, -6)), '17:23');
    assert.equal(timeOfDay(evenOutTime(plan, 0, at(MON, '07:00'))), '17:15');
  });

  test('Tage ohne Plan (Abwesenheit) haben keine Live-Abweichung', () => {
    const info = newRecord({ day: MON, dayType: 'urlaub', targetOverrideMin: null, note: '' });
    const acc = computeAccount({ intervals: [], dayInfos: [info], settings: S, today: MON, now: at(MON, '10:00') });
    assert.equal(acc.live.deviation, null);
  });
});

describe('Übernahme bestehender Einstellungen', () => {
  test('unveränderte Standardregel bekommt den Standardplan, eigene Regeln bleiben', () => {
    const old = settings(MON, 480);
    assert.equal(old.targetRules[0].schedule, undefined);
    const n = normalizeSettings(old);
    assert.equal(n.targetRules[0].schedule[0].start, '08:45');
    assert.equal(targetFor(MON, n, null), 480);
    const custom = normalizeSettings(settings(MON, 450));
    assert.equal(custom.targetRules[0].schedule, undefined);
    assert.equal(targetFor(MON, custom, null), 450);
    assert.deepEqual(n.report, { name: '', trainingStart: null });
  });
});
