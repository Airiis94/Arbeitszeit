// Tätigkeitsprotokoll eines Tages.

import { h, confirmDialog } from './dom.js';
import { dayRow, activityCheck } from '../core/calc.js';
import { fmtDuration, fmtDate, addDays, todayKey, isValidDayKey } from '../core/time.js';
import { editActivityDialog, undoToast } from './editors.js';

export async function renderActivities(app, params) {
  const day = isValidDayKey(params[0]) ? params[0] : todayKey();
  const data = await app.load();
  const acts = data.activities.filter((a) => a.day === day).sort((a, b) => a.createdAt - b.createdAt);
  const categories = [...new Set(data.activities.map((a) => a.category).filter(Boolean))].sort();
  const info = data.dayInfos.find((x) => x.day === day) || null;
  const row = dayRow(day, data.intervals.filter((i) => i.day === day), info, data.settings, Date.now());
  const chk = activityCheck(row, data.activities);
  const sum = chk.sum;
  const suggest = chk.gap > 0 ? chk.gap : null;

  const remove = async (a) => {
    if (!(await confirmDialog({ title: 'Tätigkeit löschen?', message: `„${a.title}“ (${fmtDuration(a.minutes)}) wird gelöscht.`, confirmText: 'Löschen', danger: true }))) return;
    try {
      const res = await app.repo.deleteActivity(a.id);
      undoToast(app, 'Tätigkeit gelöscht.', res.changes);
    } catch (e) { app.error(e); }
  };

  // Die Tätigkeiten sollen genau der festgelegten (gebuchten) Netto-Arbeitszeit entsprechen.
  let status = null;
  if (chk.target > 0 || sum > 0) {
    const label = chk.running ? `Netto-Arbeitszeit bisher (Tag läuft): ${fmtDuration(chk.target)}` : `Festgelegte Netto-Arbeitszeit: ${fmtDuration(chk.target)}`;
    let text;
    let state;
    if (chk.gap === 0) { text = '✓ Tätigkeiten entsprechen genau der Netto-Arbeitszeit.'; state = 'ok'; }
    else if (chk.gap > 0) { text = `Noch ${fmtDuration(chk.gap)} Tätigkeiten zuordnen.`; state = 'open'; }
    else { text = `Die Tätigkeiten sind ${fmtDuration(-chk.gap)} länger als die Netto-Arbeitszeit – bitte kürzen.`; state = 'over'; }
    const bar = h('div', { class: 'progress-bar' });
    // Breite per CSSOM (Inline-Stilattribute sind durch die Content-Security-Policy gesperrt)
    bar.style.width = `${chk.target > 0 ? Math.min(100, Math.round((sum / chk.target) * 100)) : 100}%`;
    status = h('div', { class: `card act-progress act-${state}`, 'data-testid': 'activity-check' },
      h('div', { class: 'act-progress-head' }, h('span', null, label), h('b', null, `${fmtDuration(sum)} / ${fmtDuration(chk.target)}`)),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': chk.target, 'aria-valuenow': sum }, bar),
      h('div', { class: 'act-progress-text' }, text));
  }

  return h('section', { class: 'view view-activities' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, -1)}`, 'aria-label': 'Vortag' }, '‹'),
      h('h1', { class: 'nav-title' }, fmtDate(day)),
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, 1)}`, 'aria-label': 'Folgetag' }, '›')),
    status,
    h('button', { type: 'button', class: 'btn btn-primary btn-block', 'data-testid': 'add-activity', onclick: () => editActivityDialog(app, day, null, categories, suggest, { activities: data.activities, settings: data.settings }) }, '+ Tätigkeit erfassen'),
    acts.length ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, `Erfasste Tätigkeiten (${acts.length})`)),
      h('ul', { class: 'act-list' }, acts.map((a) => h('li', { class: 'act-item' },
        h('div', { class: 'act-body' },
          h('div', { class: 'act-title' }, a.title),
          a.category || a.intensity ? h('div', { class: 'act-meta' },
            a.category ? h('span', { class: 'badge badge-soft' }, a.category) : null,
            a.intensity ? h('span', { class: `badge int-${a.intensity}` }, `Intensität ${a.intensity}`) : null) : null,
          a.description ? h('div', { class: 'act-desc' }, a.description) : null),
        h('div', { class: 'act-side' },
          h('span', { class: 'act-dur' }, fmtDuration(a.minutes)),
          h('div', { class: 'act-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bearbeiten', onclick: () => editActivityDialog(app, day, a, categories) }, '✎'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Löschen', onclick: () => remove(a) }, '🗑')))))),
      h('div', { class: 'act-total' },
        h('span', null, 'Summe'),
        h('span', null, h('b', { 'data-testid': 'activity-sum' }, fmtDuration(sum)), h('span', { class: 'muted' }, ` von ${fmtDuration(chk.target)} netto`))))
      : h('p', { class: 'muted' }, 'Für diesen Tag sind noch keine Tätigkeiten dokumentiert.'),
    h('a', { class: 'card-link', href: `#/tag/${day}` }, 'Zur Tagesansicht →'));
}
