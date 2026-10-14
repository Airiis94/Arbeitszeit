import { work, pause, pauseMin, settings, at } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, planMerge, backupSummary } from '../../app/js/core/backup-format.js';
import { newRecord, touch, SCHEMA_VERSION } from '../../app/js/core/model.js';
import { computeAccount } from '../../app/js/core/calc.js';

const DAY = '2026-03-02';

function sample() {
  return {
    settings: settings(DAY, { startBalanceMin: 90 }),
    intervals: [work(DAY, '08:00', '16:40'), pause(DAY, '12:00', '12:30'), pauseMin(DAY, 15), { ...work('2026-03-03', '09:00', '10:00'), deleted: true }],
    dayInfos: [newRecord({ id: `day:${DAY}`, day: DAY, dayType: 'arbeit', targetOverrideMin: null, note: 'Notiz; mit "Zeichen"' })],
    activities: [newRecord({ day: DAY, title: 'Angebot', description: '', minutes: 90, intensity: 'hoch', category: 'Büro' })],
    corrections: [newRecord({ day: DAY, minutes: -30, reason: 'Arztbesuch' })],
    audit: [newRecord({ at: Date.now(), entity: 'interval', entityId: 'x', day: DAY, action: 'update', reason: '' })],
  };
}

describe('Export und Import', () => {
  test('Export → Import ergibt identische Daten und identisches Zeitkonto', async () => {
    const data = sample();
    const backup = await buildBackup(data, { deviceId: 'dev-1' });
    const text = JSON.stringify(backup, null, 2);
    const res = await parseBackup(text);
    assert.equal(res.ok, true, res.errors.join('\n'));
    assert.deepEqual(res.warnings, []);
    assert.deepEqual(res.backup.data, data);
    assert.equal(res.backup.schemaVersion, SCHEMA_VERSION);
    const opts = { today: DAY, now: at(DAY, '23:00') };
    const a = computeAccount({ ...data, ...opts });
    const b = computeAccount({ ...res.backup.data, ...opts });
    assert.equal(a.balance, b.balance);
    // Gehen 16:40 → gebucht 16:45 (−0:05); Anfangssaldo 1:30 − 0:05 − Korrektur 0:30
    assert.equal(b.balance, 55);
    const sum = backupSummary(res.backup);
    assert.equal(sum.intervals, 3);
    assert.equal(sum.activities, 1);
  });

  test('gewählte Buchungen und Erfassungsart überstehen Export/Import; Sicherungen älterer Versionen bleiben gültig', async () => {
    const data = sample();
    data.settings.trackingMode = 'quarter';
    data.intervals[0] = { ...data.intervals[0], startBooked: at(DAY, '08:15'), endBooked: at(DAY, '17:00') };
    data.intervals[2] = { ...data.intervals[2], durationBooked: 30 };
    const res = await parseBackup(JSON.stringify(await buildBackup(data)));
    assert.equal(res.ok, true, res.errors.join('\n'));
    assert.deepEqual(res.backup.data, data);
    // ältere Sicherung ohne die neuen Felder
    const old = sample();
    delete old.settings.trackingMode;
    const res2 = await parseBackup(JSON.stringify(await buildBackup(old)));
    assert.equal(res2.ok, true, res2.errors.join('\n'));
    // ungültige Werte werden gemeldet
    const bad = sample();
    bad.settings.trackingMode = 'stunden';
    bad.intervals[0] = { ...bad.intervals[0], startBooked: 'neun' };
    bad.intervals[2] = { ...bad.intervals[2], durationBooked: -5 };
    const all = (await parseBackup(JSON.stringify(await buildBackup(bad)))).errors.join('\n');
    assert.match(all, /intervals\[0\]: ungültige gebuchte Zeit/);
    assert.match(all, /intervals\[2\]: ungültige gebuchte Dauer/);
    assert.match(all, /ungültige Erfassungsart/);
  });

  test('abgeschnittene Datei wird erkannt', async () => {
    const text = JSON.stringify(await buildBackup(sample()));
    const res = await parseBackup(text.slice(0, text.length / 2));
    assert.equal(res.ok, false);
    assert.match(res.errors[0], /kein gültiges JSON/);
  });

  test('fremde Datei wird abgelehnt', async () => {
    const res = await parseBackup(JSON.stringify({ hello: 'world' }));
    assert.equal(res.ok, false);
    assert.match(res.errors[0], /keine Sicherung/);
  });

  test('Sicherung aus neuerer Version wird abgelehnt', async () => {
    const b = await buildBackup(sample());
    b.schemaVersion = SCHEMA_VERSION + 1;
    const res = await parseBackup(JSON.stringify(b));
    assert.equal(res.ok, false);
    assert.match(res.errors[0], /neueren App-Version/);
  });

  test('fehlerhafte Datensätze werden einzeln gemeldet', async () => {
    const data = sample();
    data.intervals[0] = { ...data.intervals[0], day: '2026-02-30' };
    data.intervals[1] = { ...data.intervals[1], kind: 'urlaub' };
    data.activities[0] = { ...data.activities[0], title: '' };
    data.corrections[0] = { ...data.corrections[0], reason: ' ' };
    data.dayInfos.push({ ...data.dayInfos[0] });
    delete data.settings.accountStart;
    const res = await parseBackup(JSON.stringify(await buildBackup(data)));
    assert.equal(res.ok, false);
    const all = res.errors.join('\n');
    assert.match(all, /intervals\[0\]: ungültiger Tag/);
    assert.match(all, /intervals\[1\]: unbekannte Art/);
    assert.match(all, /activities\[0\]: fehlende Bezeichnung/);
    assert.match(all, /corrections\[0\]: fehlende Begründung/);
    assert.match(all, /dayInfos\[1\]: doppelte ID/);
    assert.match(all, /Kontobeginn/);
  });

  test('fehlender Datenbereich wird gemeldet', async () => {
    const b = await buildBackup(sample());
    delete b.data.intervals;
    const res = await parseBackup(JSON.stringify(b));
    assert.equal(res.ok, false);
    assert.match(res.errors.join(), /intervals/);
  });

  test('nachträglich veränderte Datei erzeugt Prüfsummen-Warnung', async () => {
    const b = await buildBackup(sample());
    b.data.corrections[0].minutes = 600;
    const res = await parseBackup(JSON.stringify(b));
    assert.equal(res.ok, true);
    assert.match(res.warnings[0], /Prüfsumme/);
  });
});

describe('Zusammenführen', () => {
  test('neu, identisch, neuer, lokal neuer und Löschungen', () => {
    const a = work(DAY, '08:00', '16:00');
    const b = work('2026-03-03', '08:00', '16:00');
    const c = work('2026-03-04', '08:00', '16:00');
    const local = [a, b, touch(c, { end: at('2026-03-04', '17:00') }, Date.now() + 1000)];
    const incoming = [
      a, // identisch
      touch(b, { deleted: true }, Date.now() + 500), // in der Sicherung gelöscht (neuer)
      c, // lokal neuer → bleibt
      work('2026-03-05', '08:00', '12:00'), // neu
    ];
    const { puts, stats } = planMerge(local, incoming);
    assert.deepEqual(stats, { added: 1, updated: 1, unchanged: 1, keptLocal: 1 });
    assert.equal(puts.length, 2);
    assert.ok(puts.some((p) => p.id === b.id && p.deleted));
  });
});

describe('Lesbare Text-Sicherung (.txt)', async () => {
  const { buildTextBackup, extractBackupJson, DATA_BEGIN } = await import('../../app/js/core/textreport.js');

  test('Text enthält Datum, gebuchte/gestempelte Zeiten, Pausen, Tätigkeiten; Rück-Import ergibt identische Daten', async () => {
    const data = sample();
    const backup = await buildBackup(data, { deviceId: 'dev-1' });
    const text = buildTextBackup({ data, backup, now: at(DAY, '18:05') });
    assert.match(text, /^ARBEITSZEIT – Sicherung vom Mo, 02\.03\.2026 18:05/);
    assert.match(text, /Zeitkonto: \+0:55/);
    assert.match(text, /Mo, 02\.03\.2026\r\n  Arbeit: 08:00–16:45 \(gestempelt 08:00–16:40\)/);
    assert.match(text, /  Pause:  12:00–12:30\r\n/);
    assert.match(text, /  Pause:  0:15\r\n/);
    assert.match(text, /Arbeitszeit 8:00 · Pausen 0:45 · Differenz −0:05 · Korrektur −0:30 · Zeitkonto \+0:55/);
    assert.match(text, /    - Angebot \(1:30, Büro, Intensität hoch\)/);
    assert.match(text, /Notiz: Notiz; mit "Zeichen"/);
    assert.match(text, /02\.03\.2026  −0:30  Arztbesuch/);
    // gelöschte Einträge erscheinen nicht im Text
    assert.doesNotMatch(text, /Di, 03\.03\.2026/);
    assert.ok(text.indexOf(DATA_BEGIN) > text.indexOf('Arztbesuch'));
    const res = await parseBackup(text);
    assert.equal(res.ok, true, res.errors.join('\n'));
    assert.deepEqual(res.warnings, []);
    assert.deepEqual(res.backup.data, data);
  });

  test('Umlaute und Sonderzeichen überstehen den Datenblock', async () => {
    const data = sample();
    data.activities[0].title = 'Prüfung „Öl“ – ß & <x> 😀';
    const text = buildTextBackup({ data, backup: await buildBackup(data), now: at(DAY, '18:05') });
    const res = await parseBackup(text);
    assert.equal(res.backup.data.activities[0].title, 'Prüfung „Öl“ – ß & <x> 😀');
  });

  test('Text ohne Datenblock bzw. beschädigter Block wird abgelehnt', async () => {
    let res = await parseBackup('Nur ein Text ohne Daten');
    assert.equal(res.ok, false);
    assert.match(res.errors[0], /keine Sicherungsdaten/);
    const text = buildTextBackup({ data: sample(), backup: await buildBackup(sample()), now: at(DAY, '18:05') });
    const broken = text.replace(/(AZB1:.{20})/, '$1###');
    res = await parseBackup(broken);
    assert.equal(res.ok, false);
    assert.equal(extractBackupJson('{"a":1}'), '{"a":1}');
  });
});
