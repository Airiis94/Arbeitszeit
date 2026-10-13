// Gemeinsame Bausteine der Ansichten.

import { h } from './dom.js';
import { STATUS_LABELS } from '../core/calc.js';
import { fmtDuration, timeOfDay, fmtTimeRel, DAY_MS } from '../core/time.js';
import { DAY_TYPES } from '../core/model.js';

export function statusBadge(status, dayType) {
  if (status === 'empty' && dayType && dayType !== 'arbeit') {
    return h('span', { class: 'badge badge-absence' }, DAY_TYPES[dayType]?.label || dayType);
  }
  return h('span', { class: `badge badge-${status}` }, STATUS_LABELS[status] || status);
}

export function diffClass(min) {
  if (min == null || min === 0) return 'neutral';
  return min > 0 ? 'pos' : 'neg';
}

export function signed(min) {
  return h('span', { class: `num ${diffClass(min)}` }, fmtDuration(min, { sign: true }));
}

export function stat(label, value, sub) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

/** Liste der Arbeitsphasen und Pausen eines Tages (chronologisch). */
export function entryList(day, dayCalc, { onEdit, onDelete } = {}) {
  const items = [
    ...dayCalc.sessions.map((s) => ({ rec: s, t: s.start ?? 0 })),
    ...dayCalc.breaks.map((b) => ({ rec: b, t: b.start ?? Number.MAX_SAFE_INTEGER })),
  ].sort((a, b) => a.t - b.t);
  const issueIds = new Set(dayCalc.issues.flatMap((i) => i.ids));
  if (!items.length) return h('p', { class: 'muted' }, 'Noch keine Buchungen.');
  return h('ul', { class: 'entries' }, items.map(({ rec }) => {
    const isWork = rec.kind === 'work';
    const range = rec.start != null
      ? `${fmtTimeRel(rec.start, day)} – ${rec.end != null ? fmtTimeRel(rec.end, day) : 'läuft'}`
      : `${fmtDuration(rec.durationMin)} (nur Dauer)`;
    const dur = rec.start != null && rec.end != null ? fmtDuration(Math.floor((rec.end - rec.start) / 60000)) : '';
    return h('li', { class: `entry entry-${rec.kind}${issueIds.has(rec.id) ? ' entry-issue' : ''}` },
      h('span', { class: 'entry-kind' }, isWork ? 'Arbeit' : 'Pause'),
      h('span', { class: 'entry-range' }, range),
      h('span', { class: 'entry-dur num' }, dur),
      h('span', { class: 'entry-src', title: rec.source === 'clock' ? 'gestempelt' : 'manuell eingetragen' }, rec.source === 'clock' ? '' : 'manuell'),
      onEdit && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Bearbeiten', onclick: () => onEdit(rec) }, '✎'),
      onDelete && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Löschen', onclick: () => onDelete(rec) }, '🗑'));
  }));
}

export function issueList(issues) {
  if (!issues.length) return null;
  return h('ul', { class: 'issues' }, issues.map((i) => h('li', { class: `issue issue-${i.severity}` }, i.message)));
}

/** Zustand der Sicherung: aktuell, veraltet oder nie erstellt. */
export function backupState(meta, settings, now = Date.now()) {
  const last = meta.lastExportAt;
  const changed = meta.lastChangeAt;
  if (!changed) return { level: 'ok', text: 'Noch keine Daten erfasst.' };
  if (!last) return { level: 'warn', text: 'Es wurde noch keine Sicherung exportiert.' };
  if (changed <= last) return { level: 'ok', text: 'Sicherung ist aktuell.' };
  const days = Math.floor((now - last) / DAY_MS);
  const limit = settings.backupReminderDays || 7;
  return {
    level: days >= limit ? 'warn' : 'info',
    text: `Seit der letzten Sicherung (vor ${days === 0 ? 'weniger als einem Tag' : `${days} Tag${days === 1 ? '' : 'en'}`}) wurden Daten geändert.`,
  };
}

export function timeOrDash(ms) {
  return ms == null ? '–' : timeOfDay(ms);
}
