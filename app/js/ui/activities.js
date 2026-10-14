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
    let cls;
    if (chk.gap === 0) { text = '✓ Tätigkeiten entsprechen genau der Netto-Arbeitszeit.'; cls = 'notice-ok'; }
    else if (chk.gap > 0) { text = `Noch ${fmtDuration(chk.gap)} Tätigkeiten zuordnen.`; cls = 'notice-warn'; }
    else { text = `Die Tätigkeiten sind ${fmtDuration(-chk.gap)} länger als die Netto-Arbeitszeit – bitte kürzen.`; cls = 'notice-error'; }
    status = h('div', { class: `notice ${cls}`, 'data-testid': 'activity-check' },
      h('div', null, label, ` · Tätigkeiten: ${fmtDuration(sum)}`), h('b', null, text));
  }

  return h('section', { class: 'view view-activities' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, -1)}`, 'aria-label': 'Vortag' }, '‹'),
      h('h1', { class: 'nav-title' }, fmtDate(day)),
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, 1)}`, 'aria-label': 'Folgetag' }, '›')),
    status,
    h('button', { type: 'button', class: 'btn btn-primary btn-block', 'data-testid': 'add-activity', onclick: () => editActivityDialog(app, day, null, categories, suggest) }, '+ Tätigkeit erfassen'),
    acts.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'act-table' },
      h('thead', null, h('tr', null, ['Bezeichnung', 'Dauer', 'Intensität', 'Kategorie', ''].map((t) => h('th', null, t)))),
      h('tbody', null, acts.map((a) => h('tr', null,
        h('td', null, h('div', { class: 'act-title' }, a.title), a.description ? h('div', { class: 'act-desc' }, a.description) : null),
        h('td', { class: 'num' }, fmtDuration(a.minutes)),
        h('td', null, a.intensity ? h('span', { class: `badge int-${a.intensity}` }, a.intensity) : ''),
        h('td', null, a.category || ''),
        h('td', { class: 'nowrap' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bearbeiten', onclick: () => editActivityDialog(app, day, a, categories) }, '✎'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Löschen', onclick: () => remove(a) }, '🗑'))))),
      h('tfoot', null, h('tr', null,
        h('th', null, 'Summe'), h('th', { class: 'num', 'data-testid': 'activity-sum' }, fmtDuration(sum)), h('th', { colspan: 3 }, `Netto-Arbeitszeit: ${fmtDuration(chk.target)}`)))))
      : h('p', { class: 'muted' }, 'Für diesen Tag sind noch keine Tätigkeiten dokumentiert.'),
    h('p', { class: 'muted small' }, h('a', { href: `#/tag/${day}` }, 'Zur Tagesansicht')));
}
