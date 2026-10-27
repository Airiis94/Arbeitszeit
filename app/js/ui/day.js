// Tagesansicht: Buchungen bearbeiten und Berechnung nachvollziehen.

import { h } from './dom.js';
import { computeDay, computeAccount, dayRow, activityCheck, typicalNetMin } from '../core/calc.js';
import { bookDay, bookingInterval } from '../core/booking.js';
import {
  fmtDuration, fmtDate, addDays, todayKey, isValidDayKey, fmtDateTime, timeOfDay,
} from '../core/time.js';
import { DAY_TYPES } from '../core/model.js';
import { signed, entryList, statusBadge, issueList, timeOrDash, stampText } from './common.js';
import {
  editWorkDialog, editBreakDialog, deleteIntervalFlow, editDayInfoDialog, vacationDialog, quickBreak, chooseBookingDialog,
} from './editors.js';

const AUDIT_ACTIONS = { create: 'angelegt', update: 'geändert', delete: 'gelöscht', undo: 'rückgängig gemacht' };
const AUDIT_ENTITIES = { interval: 'Buchung', intervals: 'Buchung', dayInfo: 'Tagesangaben', activity: 'Tätigkeit', activities: 'Tätigkeit', correction: 'Korrektur' };

function auditText(a) {
  const describe = (r) => {
    if (!r) return '—';
    if (r.kind) {
      const k = r.kind === 'work' ? 'Arbeit' : 'Pause';
      if (r.deleted) return `${k} (gelöscht)`;
      return r.start != null ? `${k} ${timeOfDay(r.start)}–${r.end ? timeOfDay(r.end) : '…'}` : `${k} ${fmtDuration(r.durationMin)}`;
    }
    if (r.title) return `${r.title} (${fmtDuration(r.minutes)})`;
    if (r.dayType) return DAY_TYPES[r.dayType]?.label || r.dayType;
    return '';
  };
  const change = a.action === 'update' || a.action === 'undo' ? `${describe(a.before)} → ${describe(a.after)}` : describe(a.after || a.before);
  return `${fmtDateTime(a.at)} · ${AUDIT_ENTITIES[a.entity] || a.entity} ${AUDIT_ACTIONS[a.action] || a.action}: ${change}${a.reason ? ` · Grund: ${a.reason}` : ''}`;
}

export async function renderDay(app, params) {
  const day = isValidDayKey(params[0]) ? params[0] : todayKey();
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const { settings } = data;
  const dayIntervals = data.intervals.filter((i) => i.day === day);
  const d = computeDay(dayIntervals, { now, autoBreak: settings.autoBreak });
  const booking = bookDay(dayIntervals, bookingInterval(settings));
  const info = data.dayInfos.find((x) => x.day === day) || null;
  const acc = computeAccount({ ...data, settings, today, now });
  const row = acc.rowsByDay.get(day) || dayRow(day, dayIntervals, info, settings, now);
  const acts = data.activities.filter((a) => a.day === day);
  const actSum = acts.reduce((s, a) => s + a.minutes, 0);
  const audit = await app.repo.auditForDay(day);

  const head = h('tr', null, h('th', null, ''), h('th', { class: 'num' }, 'gestempelt'), h('th', { class: 'num' }, 'gebucht'));
  const two = (label, a, b, cls = '') => h('tr', { class: cls }, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, a), h('td', { class: 'num' }, b));
  const table = h('table', { class: 'calc calc-3' }, h('thead', null, head), h('tbody', null,
    two('Kommen', timeOrDash(d.firstStart), timeOrDash(row.bookedFirst)),
    two('Gehen', d.openSession ? 'läuft' : timeOrDash(d.lastEnd), d.openSession ? 'läuft' : timeOrDash(row.bookedLast)),
    two('Pausen', fmtDuration(d.breakMin + d.autoBreakMin), fmtDuration(row.bookedBreakMin)),
    two('Arbeitszeit', fmtDuration(d.netMin), row.bookedNetMin == null ? '–' : fmtDuration(row.bookedNetMin), 'strong')));
  // Differenzen zum Zeitkonto direkt unter der Tabelle – eine Karte statt zwei
  const diffs = booking.stamps.filter((x) => x.dir !== 'exact');
  const quarter = bookingInterval(settings) > 1;
  const diffTable = quarter && d.sessions.length ? h('table', { class: 'calc calc-diff', 'data-testid': 'deviation' }, h('tbody', null,
    diffs.map((x) => h('tr', null, h('th', { scope: 'row' }, stampText(x, day).replace(/ \([^)]*\)$/, '')), h('td', null, signed(x.effect)))),
    h('tr', { class: 'strong' }, h('th', { scope: 'row' }, 'Differenz des Tages'), h('td', null, signed(row.effect))),
    row.correction ? h('tr', null, h('th', { scope: 'row' }, 'Korrektur an diesem Tag'), h('td', null, signed(row.correction))) : null,
    row.balance != null ? h('tr', null, h('th', { scope: 'row' }, 'Zeitkonto nach dem Tag'), h('td', null, signed(row.balance))) : null)) : null;

  // Tätigkeiten des Tages in einer Zeile
  const chk = activityCheck(row, data.activities);
  let actState = null;
  if (chk.target > 0 || chk.sum > 0) {
    actState = chk.gap === 0 ? h('span', { class: 'pos' }, '✓ passt')
      : chk.gap > 0 ? h('span', { class: 'neg' }, `noch ${fmtDuration(chk.gap)} offen`)
        : h('span', { class: 'neg' }, `${fmtDuration(-chk.gap)} zu viel`);
  }

  const sessionsEdit = {
    onEdit: (rec) => (rec.kind === 'work' ? editWorkDialog(app, day, rec) : editBreakDialog(app, day, rec, d.sessions)),
    onDelete: (rec) => deleteIntervalFlow(app, rec),
    booking,
    onChoose: bookingInterval(settings) > 1 ? (st) => chooseBookingDialog(app, data.intervals, st, day, bookingInterval(settings), acc.balance) : null,
  };

  return h('section', { class: 'view view-day' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/tag/${addDays(day, -1)}`, 'aria-label': 'Vortag' }, '‹'),
      h('h1', { class: 'nav-title' }, fmtDate(day)),
      h('a', { class: 'btn btn-small', href: `#/tag/${addDays(day, 1)}`, 'aria-label': 'Folgetag' }, '›')),
    h('div', { class: 'day-head' },
      statusBadge(d.status, info?.dayType),
      d.status !== 'empty' && info?.dayType && info.dayType !== 'arbeit' ? h('span', { class: 'badge badge-absence' }, DAY_TYPES[info.dayType]?.label) : null,
      day < acc.start ? h('span', { class: 'badge' }, 'vor Kontobeginn – zählt nicht') : null,
      day > today ? h('span', { class: 'badge' }, 'Zukunft') : null),
    issueList(d.issues),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Buchungen')),
      entryList(day, d, sessionsEdit),
      h('div', { class: 'btn-row btn-row-tight' },
        h('button', { type: 'button', class: 'btn', onclick: () => editWorkDialog(app, day) }, '+ Arbeitsphase'),
        h('button', { type: 'button', class: 'btn', onclick: () => editBreakDialog(app, day, null, d.sessions) }, '+ Pause')),
      h('details', { class: 'quick quick-fold' },
        h('summary', null, '+ Pause ohne Uhrzeit (nur Dauer)'),
        h('div', { class: 'quick-chips' },
          [15, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip', onclick: () => quickBreak(app, day, m) }, `${m} min`))))),
    d.sessions.length || d.breaks.length ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Gestempelt und gebucht')),
      table,
      diffTable) : null,
    h('div', { class: 'card day-facts' },
      h('div', { class: 'fact-row' },
        h('div', null, h('div', { class: 'fact-label' }, 'Tagesart'), h('div', null, (DAY_TYPES[info?.dayType || 'arbeit'] || DAY_TYPES.arbeit).label)),
        h('div', { class: 'fact-actions' },
          info?.dayType !== 'urlaub' ? h('button', {
            type: 'button', class: 'btn btn-small', 'data-testid': 'vacation-add',
            onclick: () => vacationDialog(app, day, { typicalMin: typicalNetMin(acc), dayInfos: data.dayInfos }),
          }, '🏖 Urlaub') : null,
          h('button', { type: 'button', class: 'btn btn-small', 'data-testid': 'day-info-edit', onclick: () => editDayInfoDialog(app, day, info, { typicalMin: typicalNetMin(acc) }) }, 'Bearbeiten'))),
      row.creditMin ? h('p', { class: 'small', 'data-testid': 'credit-info' }, h('b', null, `${fmtDuration(row.creditMin)} Std. als Arbeitszeit angerechnet`),
        info.creditStart && info.creditEnd ? ` (${info.creditStart}–${info.creditEnd})` : '', h('span', { class: 'muted' }, ' – zählt zur Netto-Arbeitszeit, nicht zum Zeitkonto.')) : null,
      info?.note ? h('p', { class: 'note' }, info.note) : null,
      h('a', { class: 'fact-row fact-link', href: `#/taetigkeiten/${day}` },
        h('div', null, h('div', { class: 'fact-label' }, 'Tätigkeiten'),
          h('div', null, acts.length ? `${acts.length} · ${fmtDuration(actSum)} Std.` : 'keine', actState ? [' · ', actState] : null)),
        h('span', { class: 'fact-go', 'aria-hidden': 'true' }, '›'))),
    h('details', { class: 'card' },
      h('summary', null, `Änderungsprotokoll (${audit.length})`),
      audit.length ? h('ul', { class: 'audit' }, audit.map((a) => h('li', null, auditText(a))))
        : h('p', { class: 'muted' }, 'Keine manuellen Änderungen.')),
  );
}
