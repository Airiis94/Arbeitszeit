// Tätigkeitsprotokoll eines Tages.

import { h, confirmDialog } from './dom.js';
import { computeDay } from '../core/calc.js';
import { fmtDuration, fmtDate, addDays, todayKey, isValidDayKey } from '../core/time.js';
import { editActivityDialog, undoToast } from './editors.js';

export async function renderActivities(app, params) {
  const day = isValidDayKey(params[0]) ? params[0] : todayKey();
  const data = await app.load();
  const acts = data.activities.filter((a) => a.day === day).sort((a, b) => a.createdAt - b.createdAt);
  const categories = [...new Set(data.activities.map((a) => a.category).filter(Boolean))].sort();
  const d = computeDay(data.intervals.filter((i) => i.day === day), { now: Date.now(), autoBreak: data.settings.autoBreak });
  const sum = acts.reduce((s, a) => s + a.minutes, 0);
  const gap = d.netMin - sum;

  const remove = async (a) => {
    if (!(await confirmDialog({ title: 'Tätigkeit löschen?', message: `„${a.title}“ (${fmtDuration(a.minutes)}) wird gelöscht.`, confirmText: 'Löschen', danger: true }))) return;
    try {
      const res = await app.repo.deleteActivity(a.id);
      undoToast(app, 'Tätigkeit gelöscht.', res.changes);
    } catch (e) { app.error(e); }
  };

  let hint = null;
  if (acts.length && d.netMin > 0 && gap !== 0) {
    hint = h('p', { class: 'notice notice-info' }, gap > 0
      ? `Hinweis: ${fmtDuration(gap)} der Nettoarbeitszeit (${fmtDuration(d.netMin)}) sind keiner Tätigkeit zugeordnet. Das ist kein Fehler.`
      : `Hinweis: Die Tätigkeiten ergeben ${fmtDuration(-gap)} mehr als die Nettoarbeitszeit (${fmtDuration(d.netMin)}). Das ist kein Fehler, bitte ggf. prüfen.`);
  }

  return h('section', { class: 'view view-activities' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, -1)}`, 'aria-label': 'Vortag' }, '‹'),
      h('h1', { class: 'nav-title' }, fmtDate(day)),
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, 1)}`, 'aria-label': 'Folgetag' }, '›')),
    h('button', { type: 'button', class: 'btn btn-primary btn-block', 'data-testid': 'add-activity', onclick: () => editActivityDialog(app, day, null, categories) }, '+ Tätigkeit erfassen'),
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
        h('th', null, 'Summe'), h('th', { class: 'num', 'data-testid': 'activity-sum' }, fmtDuration(sum)), h('th', { colspan: 3 }, `Netto-Arbeitszeit: ${fmtDuration(d.netMin)}`)))))
      : h('p', { class: 'muted' }, 'Für diesen Tag sind noch keine Tätigkeiten dokumentiert.'),
    hint,
    h('p', { class: 'muted small' }, h('a', { href: `#/tag/${day}` }, 'Zur Tagesansicht')));
}
