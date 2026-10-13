import { work, pause, at } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekReport, buildNachweisXlsx, reportNumber, trainingYear, weekSheet } from '../../app/js/core/nachweis.js';
import { crc32, colName, parseRef } from '../../app/js/core/xlsx.js';
import { newRecord, defaultSettings } from '../../app/js/core/model.js';

const MON = '2026-10-12';
const act = (day, title, minutes, category = null, description = '') => newRecord({ day, title, description, minutes, intensity: null, category });

function settings() {
  const s = defaultSettings('2026-09-01');
  s.report = { name: 'Max Mustermann', trainingStart: '2026-09-01' };
  return s;
}

function data() {
  return {
    intervals: [work(MON, '08:47', '17:17'), pause(MON, '12:00', '12:30'), work('2026-10-13', '07:30', '13:00')],
    activities: [
      act(MON, 'Löten', 240, 'Werkstatt'),
      act(MON, 'Messen', 150, 'Werkstatt', 'Oszilloskop <RC> & Co'),
      act(MON, 'Unterweisung', 90, 'Ausbildungsleitung'),
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((t) => act('2026-10-14', `Aufgabe ${t}`, 30, 'Werkstatt')),
    ],
    dayInfos: [newRecord({ id: 'day:2026-10-15', day: '2026-10-15', dayType: 'krank', targetOverrideMin: null, note: '' })],
    settings: settings(),
  };
}

/** Minimaler Leser für unkomprimierte ZIP-Dateien (prüft auch die CRC32-Prüfsummen). */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let p = 0;
  const dec = new TextDecoder();
  while (dv.getUint32(p, true) === 0x04034b50) {
    assert.equal(dv.getUint16(p + 8, true), 0, 'nur unkomprimiert erwartet');
    const crc = dv.getUint32(p + 14, true);
    const size = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nlen));
    const data = bytes.subarray(p + 30 + nlen, p + 30 + nlen + size);
    assert.equal(crc32(data), crc, `CRC ${name}`);
    files[name] = dec.decode(data);
    p += 30 + nlen + size;
  }
  assert.equal(dv.getUint32(p, true), 0x02014b50, 'Zentralverzeichnis folgt');
  return files;
}

describe('Ausbildungsnachweis', () => {
  test('Nachweis-Nr. und Ausbildungsjahr aus dem Ausbildungsbeginn', () => {
    assert.equal(reportNumber('2026-08-31', '2026-09-01'), 1); // Woche des Beginns
    assert.equal(reportNumber(MON, '2026-09-01'), 7);
    assert.equal(reportNumber(MON, null), null);
    assert.equal(trainingYear(MON, '2026-09-01'), 1);
    assert.equal(trainingYear('2027-08-30', '2026-09-01'), 1);
    assert.equal(trainingYear('2027-09-06', '2026-09-01'), 2);
    assert.equal(trainingYear('2026-08-24', '2026-09-01'), null);
  });

  test('Woche: Arbeitszeitzeile, Tätigkeiten, Netto als Gesamtstunden, Abteilung = Kategorie', () => {
    const rep = buildWeekReport({ weekStart: '2026-10-14', ...data(), now: at('2026-10-20', '12:00') });
    assert.equal(rep.weekStart, MON);
    assert.equal(rep.weekEnd, '2026-10-17');
    assert.equal(rep.kw, 42);
    assert.equal(rep.nr, 7);
    assert.equal(rep.name, 'Max Mustermann');
    assert.equal(rep.days.length, 6); // Sonntag ohne Einträge entfällt
    const mon = rep.days[0];
    assert.equal(mon.label, 'Montag');
    assert.equal(mon.lines[0].text, 'Arbeitszeit 08:47–17:17, Pause 0:30');
    assert.equal(mon.lines[0].minutes, null);
    assert.deepEqual(mon.lines.slice(1).map((l) => [l.text, l.minutes, l.dept]), [
      ['Löten', 240, 'Werkstatt'], ['Messen – Oszilloskop <RC> & Co', 150, 'Werkstatt'], ['Unterweisung', 90, 'Ausbildungsleitung']]);
    assert.equal(mon.netMin, 480);
    assert.equal(rep.days[1].lines[0].text, 'Arbeitszeit 07:30–13:00, Pause 0:00');
    assert.equal(rep.days[2].lines.length, 6); // mehr als 5 Einträge → Block wächst
    assert.equal(rep.days[3].lines[0].text, 'Krank');
    assert.equal(rep.totalMin, 480 + 330);
  });

  test('Tabellenblatt: Block wächst, Summenformel, Layout der Vorlage', () => {
    const rep = buildWeekReport({ weekStart: MON, ...data(), now: at('2026-10-20', '12:00') });
    const sh = weekSheet(rep, 'KW42');
    const cell = (ref) => sh.cells.filter((c) => c.ref === ref).pop();
    assert.equal(cell('A3').v, 'Ausbildungsnachweis Nr. 7');
    assert.equal(cell('B7').v, 'Ausgeführte Arbeiten, Unterricht, Unterweisungen usw.');
    assert.equal(cell('A8').v, 'Montag');
    assert.equal(cell('B8').v, 'Arbeitszeit 08:47–17:17, Pause 0:30');
    assert.equal(cell('D9').v, 4);
    assert.equal(cell('D10').v, 2.5);
    assert.equal(cell('F9').v, 'Werkstatt');
    assert.equal(cell('E12').v, 8); // Gesamtstunden Montag (unterste Zeile des Blocks)
    assert.ok(sh.merges.includes('A8:A12'));
    assert.ok(sh.merges.includes('A18:A23')); // Mittwoch: 6 Zeilen statt 5
    const total = sh.cells.find((c) => c.f);
    assert.match(total.f, /^SUM\(E12,E17,E23,E28,E33,E36\)$/);
    assert.equal(total.v, 13.5);
  });

  test('Excel-Datei: gültiges ZIP, ein Blatt pro Woche, Sonderzeichen maskiert', () => {
    const bytes = buildNachweisXlsx({ from: '2026-10-14', to: '2026-10-21', data: data(), now: at('2026-10-22', '12:00') });
    const files = unzip(bytes);
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      assert.ok(files[f], f);
    }
    assert.match(files['xl/workbook.xml'], /<sheet name="KW42" sheetId="1"/);
    assert.match(files['xl/workbook.xml'], /<sheet name="KW43" sheetId="2"/);
    const s1 = files['xl/worksheets/sheet1.xml'];
    assert.match(s1, /Arbeitszeit 08:47–17:17, Pause 0:30/);
    assert.match(s1, /Messen – Oszilloskop &lt;RC&gt; &amp; Co/);
    assert.match(s1, /<f>SUM\(E12,E17,E23,E28,E33,E36\)<\/f><v>13.5<\/v>/);
    assert.match(s1, /<mergeCell ref="A8:A12"\/>/);
    assert.match(s1, /paperSize="9"/);
  });

  test('Zeitraum über einen Jahreswechsel: eindeutige Blattnamen', () => {
    const bytes = buildNachweisXlsx({ from: '2026-12-21', to: '2027-01-10', data: data(), now: at('2027-01-11', '12:00') });
    const wb = unzip(bytes)['xl/workbook.xml'];
    assert.match(wb, /name="KW52 2026"/);
    assert.match(wb, /name="KW53 2026"/);
    assert.match(wb, /name="KW01 2027"/);
  });

  test('Hilfsfunktionen', () => {
    assert.equal(colName(1), 'A');
    assert.equal(colName(27), 'AA');
    assert.deepEqual(parseRef('E36'), { c: 5, r: 36 });
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  });
});
