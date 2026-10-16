// Tagesansicht: Buchungen bearbeiten und Berechnung nachvollziehen.

import { h } from './dom.js';
import { computeDay, computeAccount, dayRow, activityCheck } from '../core/calc.js';
import { bookDay, bookingInterval } from '../core/booking.js';
import {
  fmtDuration, fmtDate, addDays, todayKey, isValidDayKey, fmtDateTime, timeOfDay,
} from '../core/time.js';
import { DAY_TYPES } from '../core/model.js';
import { signed, entryList, statusBadge, issueList, timeOrDash, stampText } from './common.js';
import {
  editWorkDialog, editBreakDialog, deleteIntervalFlow, editDayInfoDialog, quickBreak, chooseBookingDialog,
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
  const diffs = booking.stamps.filter((x) => x.dir !== 'exact');
  const diffCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Zeitkonto an diesem Tag')),
    diffs.length ? h('table', { class: 'calc', 'data-testid': 'deviation' }, h('tbody', null,
      diffs.map((x) => h('tr', null, h('th', { scope: 'row' }, stampText(x, day).replace(/ \([^)]*\)$/, '')), h('td', null, signed(x.effect)))),
      h('tr', { class: 'strong' }, h('th', { scope: 'row' }, 'Differenz des Tages'), h('td', null, signed(row.effect))),
      row.correction ? h('tr', null, h('th', { scope: 'row' }, 'Korrektur an diesem Tag'), h('td', null, signed(row.correction))) : null,
      row.balance != null ? h('tr', null, h('th', { scope: 'row' }, 'Zeitkonto nach dem Tag'), h('td', null, signed(row.balance))) : null))
      : h('p', { class: 'muted' }, bookingInterval(settings) === 1 ? 'Minutengenaue Erfassung: gebucht wird genau wie gestempelt, es entstehen keine Differenzminuten.' : d.sessions.length ? 'Alle Zeiten liegen genau auf der Viertelstunde – keine Differenz.' : 'Noch keine Buchungen.'),
    diffs.length ? h('p', { class: 'muted small' }, 'Die Differenz zwischen gestempelter und gebuchter Zeit geht ins Zeitkonto. In der Liste oben eine Zeit (✎) antippen, um die gebuchte Zeit zu wählen.') : null);

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
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => editWorkDialog(app, day) }, '+ Arbeitsphase'),
        h('button', { type: 'button', class: 'btn', onclick: () => editBreakDialog(app, day, null, d.sessions) }, '+ Pause')),
      h('div', { class: 'quick' },
        h('span', { class: 'quick-label' }, 'Pause ohne Uhrzeit nachtragen (Minuten):'),
        [15, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip', onclick: () => quickBreak(app, day, m) }, `${m}`)))),
    diffCard,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Gestempelt und gebucht')),
      table),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Tagesangaben'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => editDayInfoDialog(app, day, info) }, 'Bearbeiten')),
      h('p', null, `Tagesart: ${(DAY_TYPES[info?.dayType || 'arbeit'] || DAY_TYPES.arbeit).label}`),
      info?.note ? h('p', { class: 'note' }, info.note) : null),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Tätigkeiten'),
        h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${day}` }, 'Öffnen')),
      h('p', null, acts.length ? `${acts.length} Tätigkeit(en), zusammen ${fmtDuration(actSum)}.` : 'Keine Tätigkeiten dokumentiert.'),
      (() => {
        const chk = activityCheck(row, data.activities);
        if (chk.target === 0 && chk.sum === 0) return null;
        if (chk.gap === 0) return h('p', { class: 'pos small' }, '✓ entspricht genau der Netto-Arbeitszeit.');
        return h('p', { class: 'neg small' }, chk.gap > 0
          ? `Noch ${fmtDuration(chk.gap)} zuzuordnen (Netto-Arbeitszeit ${fmtDuration(chk.target)}).`
          : `${fmtDuration(-chk.gap)} mehr als die Netto-Arbeitszeit (${fmtDuration(chk.target)}).`);
      })()),
    h('details', { class: 'card' },
      h('summary', null, `Änderungsprotokoll (${audit.length})`),
      audit.length ? h('ul', { class: 'audit' }, audit.map((a) => h('li', null, auditText(a))))
        : h('p', { class: 'muted' }, 'Keine manuellen Änderungen.')),
  );
}
