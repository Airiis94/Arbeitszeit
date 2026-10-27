// Gemeinsame Bausteine der Ansichten.

import { h } from './dom.js';
import { STATUS_LABELS } from '../core/calc.js';
import { fmtDuration, timeOfDay, fmtTimeRel, DAY_MS } from '../core/time.js';
import { DAY_TYPES } from '../core/model.js';
import { icon } from './icons.js';

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

export function stat(label, value, sub, { wide = false } = {}) {
  return h('div', { class: wide ? 'stat wide' : 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

/** Kurzbeschreibung eines Stempels: „Kommen 08:50 → 08:45 (−0:05)“. */
export function stampText(st, day) {
  const fmt = (v) => (st.isDuration ? fmtDuration(v) : fmtTimeRel(v, day));
  if (st.dir === 'exact') return `${st.label} ${fmt(st.actual)} (genau)`;
  return `${st.label} ${fmt(st.actual)} → ${fmt(st.booked)} (${fmtDuration(st.effect, { sign: true })})`;
}

/**
 * Liste der Arbeitsphasen und Pausen eines Tages (chronologisch) mit gebuchten Viertelstunden.
 * @param booking Ergebnis von bookDay; @param onChoose (stamp) => …  gebuchte Zeit wählen
 */
export function entryList(day, dayCalc, { onEdit, onDelete, booking, onChoose } = {}) {
  const items = [
    ...dayCalc.sessions.map((s) => ({ rec: s, t: s.start ?? 0 })),
    ...dayCalc.breaks.map((b) => ({ rec: b, t: b.start ?? Number.MAX_SAFE_INTEGER })),
  ].sort((a, b) => a.t - b.t);
  const issueIds = new Set(dayCalc.issues.flatMap((i) => i.ids));
  const bookedById = new Map((booking?.items || []).map((it) => [it.rec.id, it]));
  if (!items.length) return h('p', { class: 'muted' }, 'Noch keine Buchungen.');
  return h('ul', { class: 'entries' }, items.map(({ rec }) => {
    const isWork = rec.kind === 'work';
    const bk = bookedById.get(rec.id);
    let range;
    let dur = '';
    if (rec.start != null) {
      const s = bk ? bk.start : rec.start;
      const e = bk ? bk.end : rec.end;
      range = `${fmtTimeRel(s, day)} – ${rec.end != null ? fmtTimeRel(e, day) : 'läuft'}`;
      if (rec.end != null) dur = fmtDuration(Math.round((e - s) / 60000));
    } else {
      range = `${fmtDuration(bk ? bk.durationMin : rec.durationMin)} (nur Dauer)`;
    }
    const stamps = bk ? bk.stamps : [];
    return h('li', { class: `entry entry-${rec.kind}${issueIds.has(rec.id) ? ' entry-issue' : ''}` },
      h('div', { class: 'entry-main' },
        h('div', { class: 'entry-head' },
          h('span', { class: 'entry-kind' }, isWork ? 'Arbeit' : 'Pause'),
          h('span', { class: 'entry-dur num' }, dur),
          h('span', { class: 'entry-src', title: rec.source === 'clock' ? 'gestempelt' : 'manuell eingetragen' }, rec.source === 'clock' ? '' : 'manuell')),
        h('div', { class: 'entry-time' },
          h('span', { class: 'entry-range', 'data-testid': 'booked-range' }, range)),
        onEdit || onDelete ? h('span', { class: 'entry-actions' },
          // eigenes Symbol (Uhr mit Stift) + Beschriftung: Beginn/Ende ändern – nicht zu verwechseln mit ✎ an den Stempeln
          onEdit && h('button', {
            class: 'entry-edit', type: 'button', 'aria-label': 'Bearbeiten', 'data-testid': `edit-${rec.kind}`,
            title: isWork ? 'Arbeitszeit ändern (Beginn/Ende)' : 'Pause ändern',
            onclick: () => onEdit(rec),
          }, icon('clockEdit', { stroke: '2' }), h('span', null, 'Ändern')),
          onDelete && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Löschen', title: 'Eintrag löschen', onclick: () => onDelete(rec) }, '🗑')) : null),
      stamps.length && onChoose ? h('div', { class: 'entry-stamps' }, stamps.map((st) => h('button', {
        type: 'button', class: `stamp stamp-btn${st.manual ? ' stamp-manual' : ''}`, 'data-testid': `stamp-${st.field}-${rec.kind}`,
        title: 'Gebuchte Zeit wählen',
        onclick: () => onChoose(st),
      }, stampText(st, day), h('span', { class: 'stamp-alt' }, ' ✎')))) : null);
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
