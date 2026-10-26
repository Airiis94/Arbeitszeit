import { work, settings, at } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeAccount, dayRow, activityCheck, summarize, creditOf } from '../../app/js/core/calc.js';
import { buildWeekReport, weekSheet } from '../../app/js/core/nachweis.js';
import { parseBackup, buildBackup } from '../../app/js/core/backup-format.js';
import { newRecord } from '../../app/js/core/model.js';

const MON = '2026-10-19';
const info = (day, fields) => newRecord({ id: `day:${day}`, day, dayType: 'arbeit', targetOverrideMin: null, note: '', ...fields });
const s = settings('2026-10-01', { startBalanceMin: 25 });

describe('Urlaub zählt als Arbeitszeit', () => {
  const urlaub = info('2026-10-20', { dayType: 'urlaub', creditMin: 480, creditStart: '09:00', creditEnd: '17:00' });
  const intervals = [work(MON, '08:50', '17:00')]; // Montag gearbeitet: 08:45–17:00 gebucht = 8:15, −0:05

  test('angerechnete Zeit nur bei Abwesenheit mit Zeitangabe; ältere Tagesangaben ohne Feld → 0', () => {
    assert.equal(creditOf(urlaub), 480);
    assert.equal(creditOf(info('2026-10-21', { dayType: 'urlaub' })), 0); // ohne Stunden (ältere Daten)
    assert.equal(creditOf(info('2026-10-21', { dayType: 'arbeit', creditMin: 480 })), 0);
    assert.equal(creditOf({ ...urlaub, deleted: true }), 0);
    assert.equal(creditOf(null), 0);
  });

  test('Tag: Netto-Arbeitszeit 8:00, Zeitkonto unverändert, Tätigkeiten nicht nötig', () => {
    const row = dayRow('2026-10-20', [], urlaub, s, at('2026-10-20', '23:00'));
    assert.equal(row.bookedNetMin, 480);
    assert.equal(row.creditMin, 480);
    assert.equal(row.effect, 0);
    assert.equal(activityCheck(row, []).target, 0);
  });

  test('Woche: Urlaub ergänzt die Netto-Arbeitszeit; Zeitkonto nur aus Stempeln', () => {
    const acc = computeAccount({ intervals, dayInfos: [urlaub], settings: s, today: '2026-10-25', now: at('2026-10-25', '23:00') });
    assert.equal(acc.balance, 25 - 5); // Urlaub verändert das Konto nicht
    const week = acc.rows.filter((r) => r.day >= MON && r.day <= '2026-10-25');
    const sum = summarize(week);
    assert.equal(sum.bookedNetMin, 495 + 480);
    assert.equal(sum.creditMin, 480);
  });

  test('Ausbildungsnachweis: Urlaubstag mit 8 Std. netto, Zeiten in der schmalen Spalte', () => {
    const rep = buildWeekReport({ weekStart: MON, intervals, activities: [], dayInfos: [urlaub], settings: s, now: at('2026-10-26', '12:00') });
    const tue = rep.days[1];
    assert.equal(tue.netMin, 480);
    assert.equal(tue.grossMin, 480);
    assert.deepEqual(tue.times, ['09:00–17:00', 'Urlaub']);
    assert.equal(tue.lines[0].text, 'Urlaub (8:00 Std. angerechnet)');
    assert.equal(rep.totalMin, 495 + 480);
    const sh = weekSheet(rep, 'KW43');
    const sum = sh.cells.find((c) => c.ref.startsWith('H') && c.f && c.f.startsWith('SUM'));
    assert.equal(sum.v, (495 + 480) / 60);
  });

  test('Sicherung: neue Felder werden geprüft, ältere Sicherungen bleiben gültig', async () => {
    const data = { settings: s, intervals, dayInfos: [urlaub], activities: [], corrections: [], audit: [] };
    const ok = await parseBackup(JSON.stringify(await buildBackup(data)));
    assert.equal(ok.ok, true, ok.errors.join('\n'));
    const bad = await parseBackup(JSON.stringify(await buildBackup({ ...data, dayInfos: [{ ...urlaub, creditMin: -5, creditStart: '9 Uhr' }] })));
    assert.match(bad.errors.join('\n'), /ungültige angerechnete Zeit/);
    assert.match(bad.errors.join('\n'), /ungültige Uhrzeit/);
  });
});
