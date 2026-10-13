// Kalender: Monats- und Wochenansicht mit Zusammenfassung. Antippen eines Tages öffnet die Tagesansicht.

import { h } from './dom.js';
import { computeAccount, dayRow, summarize } from '../core/calc.js';
import {
  fmtDuration, fmtDate, fmtMonth, addDays, addMonths, todayKey, monthKey, firstOfMonth, lastOfMonth,
  startOfWeek, weekdayIndex, isoWeek, WEEKDAYS_SHORT, isValidDayKey,
} from '../core/time.js';
import { DAY_TYPES } from '../core/model.js';
import { signed, timeOrDash, statusBadge } from './common.js';
import { exportReport } from './backup.js';

/** Liefert für jeden Tag des Zeitraums eine Zeile: aus dem Zeitkonto oder (außerhalb) direkt berechnet. */
function rowsFor(from, to, data, acc, now) {
  const { settings } = data;
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    let row = acc.rowsByDay.get(day);
    const info = data.dayInfos.find((x) => x.day === day) || null;
    if (!row) row = { ...dayRow(day, data.intervals.filter((i) => i.day === day), info, settings, now), outside: true };
    out.push(row);
  }
  return out;
}

function summaryCard(title, rows, endBalance) {
  const s = summarize(rows);
  return h('div', { class: 'card summary' },
    h('h2', null, title),
    h('div', { class: 'summary-grid' },
      h('div', null, h('span', null, 'Arbeitszeit (gebucht)'), h('b', { class: 'num' }, fmtDuration(s.bookedNetMin))),
      h('div', null, h('span', null, 'gestempelt'), h('b', { class: 'num' }, fmtDuration(s.netMin))),
      h('div', null, h('span', null, 'Pausen (gebucht)'), h('b', { class: 'num' }, fmtDuration(s.bookedBreakMin))),
      h('div', null, h('span', null, 'Differenzminuten'), h('b', null, signed(s.effect))),
      h('div', null, h('span', null, 'Zeitkonto am Ende'), h('b', null, endBalance == null ? '–' : signed(endBalance))),
      h('div', null, h('span', null, 'Arbeitstage'), h('b', { class: 'num' }, String(s.workedDays))),
      s.open ? h('div', { class: 'neg' }, h('span', null, 'Offen/fehlerhaft'), h('b', { class: 'num' }, String(s.open))) : null));
}

function lastBalance(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].balance != null) return rows[i].balance;
  return null;
}

function legend() {
  return h('div', { class: 'legend' },
    ['complete', 'running', 'incomplete', 'conflict'].map((s) => statusBadge(s)),
    h('span', { class: 'badge badge-absence' }, 'Abwesenheit'));
}

function cellClass(r, today) {
  const c = ['cal-cell', `st-${r.status}`];
  if (r.status === 'empty' && r.dayType && r.dayType !== 'arbeit') c.push('st-absence');
  if (r.day === today) c.push('is-today');
  if (r.day > today) c.push('is-future');
  return c.join(' ');
}

function monthView(app, mk, data, acc, now, today) {
  const from = firstOfMonth(mk);
  const to = lastOfMonth(mk);
  const rows = rowsFor(from, to, data, acc, now);
  const lead = weekdayIndex(from);
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(h('div', { class: 'cal-cell cal-pad' }));
  for (const r of rows) {
    const dayNum = Number(r.day.slice(8));
    cells.push(h('a', { class: cellClass(r, today), href: `#/tag/${r.day}`, 'aria-label': fmtDate(r.day) },
      h('span', { class: 'cal-num' }, String(dayNum)),
      r.status !== 'empty' ? h('span', { class: 'cal-net num' }, fmtDuration(r.bookedNetMin ?? r.netMin)) : null,
      r.effect ? h('span', { class: `cal-diff num ${r.effect > 0 ? 'pos' : 'neg'}` }, fmtDuration(r.effect, { sign: true })) : null,
      r.status === 'empty' && r.dayType && r.dayType !== 'arbeit' ? h('span', { class: 'cal-type' }, DAY_TYPES[r.dayType]?.label.slice(0, 6)) : null));
  }
  return [
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/kalender/monat/${addMonths(mk, -1)}`, 'aria-label': 'Vormonat' }, '‹'),
      h('h1', { class: 'nav-title' }, fmtMonth(mk)),
      h('a', { class: 'btn btn-small', href: `#/kalender/monat/${addMonths(mk, 1)}`, 'aria-label': 'Folgemonat' }, '›')),
    h('div', { class: 'cal-grid' },
      WEEKDAYS_SHORT.map((w) => h('div', { class: 'cal-head' }, w)),
      cells),
    legend(),
    summaryCard(`Monatsübersicht ${fmtMonth(mk)}`, rows, lastBalance(rows)),
  ];
}

function weekView(app, weekStart, data, acc, now, today) {
  const to = addDays(weekStart, 6);
  const rows = rowsFor(weekStart, to, data, acc, now);
  return [
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/kalender/woche/${addDays(weekStart, -7)}`, 'aria-label': 'Vorwoche' }, '‹'),
      h('h1', { class: 'nav-title' }, `KW ${isoWeek(weekStart)} · ${fmtDate(weekStart, { weekday: false, year: false })}–${fmtDate(to, { weekday: false })}`),
      h('a', { class: 'btn btn-small', href: `#/kalender/woche/${addDays(weekStart, 7)}`, 'aria-label': 'Folgewoche' }, '›')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'week-table' },
      h('thead', null, h('tr', null, ['Tag', 'Kommen', 'Gehen', 'Pause', 'Arbeit', 'Diff.', 'Konto'].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((r) => h('tr', {
        class: `${cellClass(r, today).replace('cal-cell', 'week-row')} clickable`, tabindex: 0, role: 'link', 'data-testid': 'week-row',
        onclick: () => app.navigate(`#/tag/${r.day}`),
        onkeydown: (e) => { if (e.key === 'Enter') app.navigate(`#/tag/${r.day}`); },
      },
      h('td', null, fmtDate(r.day, { year: false }).replace(',', '')),
      h('td', { class: 'num' }, timeOrDash(r.bookedFirst)),
      h('td', { class: 'num' }, r.status === 'running' ? 'läuft' : timeOrDash(r.bookedLast)),
      h('td', { class: 'num' }, r.status === 'empty' ? '' : fmtDuration(r.bookedBreakMin)),
      h('td', { class: 'num' }, r.status === 'empty' ? '' : r.bookedNetMin == null ? statusBadge(r.status) : fmtDuration(r.bookedNetMin)),
      h('td', null, r.status === 'empty' ? '' : signed(r.effect)),
      h('td', null, r.balance == null ? '' : signed(r.balance)))))),
    ),
    legend(),
    summaryCard('Wochenübersicht', rows, lastBalance(rows)),
    h('button', {
      type: 'button', class: 'btn btn-block', 'data-testid': 'week-report', onclick: () => exportReport(app, data, weekStart, to).catch(app.error),
    }, '⬇ Ausbildungsnachweis dieser Woche (Excel)'),
  ];
}

export async function renderCalendar(app, params) {
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const acc = computeAccount({ ...data, today, now });
  const mode = params[0] === 'woche' ? 'woche' : 'monat';
  let content;
  if (mode === 'woche') {
    const ref = isValidDayKey(params[1]) ? params[1] : today;
    content = weekView(app, startOfWeek(ref), data, acc, now, today);
  } else {
    const mk = /^\d{4}-\d{2}$/.test(params[1] || '') ? params[1] : monthKey(today);
    content = monthView(app, mk, data, acc, now, today);
  }
  return h('section', { class: 'view view-calendar' },
    h('div', { class: 'segmented tabs' },
      h('a', { href: '#/kalender/monat', class: mode === 'monat' ? 'active' : '' }, 'Monat'),
      h('a', { href: '#/kalender/woche', class: mode === 'woche' ? 'active' : '' }, 'Woche'),
      h('a', { href: `#/tag/${today}` }, 'Tag')),
    content);
}
