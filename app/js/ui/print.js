// Druckansicht der Wochentabelle (Layout wie der Ausbildungsnachweis): am Bildschirm als Vorschau,
// über „Drucken“ auf Papier oder als PDF. Gleiche Zeilenlogik wie die Excel-Datei (dayBlockRows).

import { h } from './dom.js';
import { buildWeekReport, dayBlockRows } from '../core/nachweis.js';
import { fmtDate, addDays, startOfWeek, todayKey, isValidDayKey, isoWeek } from '../core/time.js';
import { exportReport } from './backup.js';

const dec = (min) => (min / 60).toFixed(2).replace('.', ',');

/** Wochentabelle als HTML-Blatt. */
export function weekPrintSheet(rep) {
  const head = ['', '', 'Ausgeführte Arbeiten, Unterricht, Unterweisungen usw.', 'Einzel-stunden', 'Stunden gesamt', 'Pause', 'Stunden netto', 'Ausbildungsabteilung'];
  const body = rep.days.flatMap((day) => {
    const rows = dayBlockRows(day);
    const lastIdx = rows.length - 1;
    return rows.map((r, i) => h('tr', { class: i === 0 ? 'ps-first' : null },
      i === 0 ? h('th', { rowspan: rows.length, class: 'ps-day', scope: 'rowgroup' }, h('span', null, day.label)) : null,
      i === 0 ? h('td', { rowspan: rows.length, class: 'ps-times', 'data-testid': 'print-times' }, day.times ? h('span', null, day.times.join('\n')) : null) : null,
      h('td', { class: r.info ? 'ps-text ps-info' : 'ps-text' }, r.text),
      h('td', { class: 'ps-num' }, r.minutes != null ? dec(r.minutes) : ''),
      h('td', { class: 'ps-num' }, i === lastIdx && day.worked ? dec(day.grossMin) : ''),
      h('td', { class: 'ps-num' }, i === lastIdx && day.worked ? dec(day.breakMin) : ''),
      h('td', { class: 'ps-num ps-strong' }, i === lastIdx ? dec(day.netMin) : ''),
      h('td', { class: 'ps-side' }, r.dept)));
  });
  return h('div', { class: 'print-sheet', 'data-testid': 'print-sheet' },
    h('div', { class: 'ps-name' }, `Name: ${rep.name || '______________________________'}`),
    h('div', { class: 'ps-title' },
      h('h2', null, `Ausbildungsnachweis Nr. ${rep.nr ?? '______'}`),
      h('span', null, `für die Woche vom ${fmtDate(rep.weekStart, { weekday: false })} bis ${fmtDate(rep.weekEnd, { weekday: false })}`)),
    h('div', { class: 'ps-year' }, `Ausbildungsjahr: ${rep.year ? `${rep.year}.` : '______'}   (KW ${rep.kw})`),
    h('table', { class: 'ps-table' },
      h('colgroup', null, ['4%', '4%', '41%', '8%', '8.5%', '7.5%', '8.5%', '18.5%'].map((w) => h('col', { width: w }))),
      h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))),
      h('tbody', null, body),
      h('tfoot', null,
        h('tr', null, h('th', { colspan: 4, class: 'ps-right' }, 'Summe der Woche'),
          h('td', { class: 'ps-num' }, dec(rep.totalGrossMin)), h('td', { class: 'ps-num' }, dec(rep.totalBreakMin)),
          h('td', { class: 'ps-num ps-strong' }, dec(rep.totalMin)), h('td', null, '')),
        h('tr', null, h('th', { colspan: 6, class: 'ps-right' }, 'Wochenarbeitszeit (Summe Stunden netto)'),
          h('td', { class: 'ps-num ps-strong', 'data-testid': 'print-week-total' }, dec(rep.totalMin)), h('td', null, '')))),
    h('div', { class: 'ps-sign' },
      h('div', null, h('div', { class: 'ps-line' }), 'Datum, Unterschrift des Auszubildenden'),
      h('div', null, h('div', { class: 'ps-line' }), 'Datum, Unterschrift des Ausbilders')));
}

export async function renderPrint(app, params) {
  const data = await app.load();
  const ref = isValidDayKey(params[1]) ? params[1] : todayKey();
  const weekStart = startOfWeek(ref);
  const rep = buildWeekReport({ weekStart, ...data, now: Date.now() });
  // Vorschau wie ein PDF: ganze Seitenbreite auf den Bildschirm skalieren (Druck bleibt in Originalgröße)
  const sheet = weekPrintSheet(rep);
  const SHEET_WIDTH = 760;
  const scale = Math.min(1, (Math.min(window.innerWidth, 760) - 24) / SHEET_WIDTH);
  sheet.style.width = `${SHEET_WIDTH}px`;
  if (scale < 1) sheet.style.zoom = String(Math.round(scale * 1000) / 1000);
  return h('section', { class: 'view view-print' },
    h('div', { class: 'nav-row no-print' },
      h('a', { class: 'btn btn-small', href: `#/druck/woche/${addDays(weekStart, -7)}`, 'aria-label': 'Vorwoche' }, '‹'),
      h('h1', { class: 'nav-title' }, `Wochentabelle KW ${isoWeek(weekStart)}`),
      h('a', { class: 'btn btn-small', href: `#/druck/woche/${addDays(weekStart, 7)}`, 'aria-label': 'Folgewoche' }, '›')),
    h('div', { class: 'btn-row no-print' },
      h('button', { type: 'button', class: 'btn btn-primary', 'data-testid': 'print-now', onclick: () => window.print() }, '🖨 Drucken / als PDF speichern'),
      h('button', { type: 'button', class: 'btn', onclick: () => exportReport(app, data, weekStart, addDays(weekStart, 6)).catch(app.error) }, '⬇ Excel')),
    h('p', { class: 'muted small no-print' }, 'Im Druckdialog „Als PDF speichern“ wählen, um die Tabelle als Datei zu sichern oder zu teilen. Vorschau mit zwei Fingern vergrößern.'),
    h('div', { class: 'print-wrap' }, sheet),
    h('a', { class: 'card-link no-print', href: `#/kalender/woche/${weekStart}` }, '← Zurück zur Woche'));
}
