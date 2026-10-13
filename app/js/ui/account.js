// Zeitkonto: Differenzminuten zwischen gestempelten und gebuchten Zeiten, Korrekturen und Verlauf.

import { h, confirmDialog } from './dom.js';
import { computeAccount } from '../core/calc.js';
import {
  fmtDuration, fmtDate, fmtMonth, addMonths, monthKey, todayKey, firstOfMonth, lastOfMonth, timeOfDay,
} from '../core/time.js';
import { signed, statusBadge } from './common.js';
import { editCorrectionDialog, undoToast } from './editors.js';

export async function renderAccount(app, params) {
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const acc = computeAccount({ ...data, today, now });
  const mk = /^\d{4}-\d{2}$/.test(params[0] || '') ? params[0] : monthKey(today);
  const monthRows = acc.rows.filter((r) => r.day >= firstOfMonth(mk) && r.day <= lastOfMonth(mk) && (r.status !== 'empty' || r.correction));
  const grid = acc.interval;

  const removeCorrection = async (c) => {
    if (!(await confirmDialog({ title: 'Korrektur löschen?', message: `${fmtDuration(c.minutes, { sign: true })} am ${fmtDate(c.day)} („${c.reason}“)`, confirmText: 'Löschen', danger: true }))) return;
    try {
      const res = await app.repo.deleteCorrection(c.id);
      undoToast(app, 'Korrektur gelöscht.', res.changes);
    } catch (e) { app.error(e); }
  };

  const corrections = [...data.corrections].sort((a, b) => b.day.localeCompare(a.day));
  const range = (r) => (r.bookedFirst == null ? '–' : `${timeOfDay(r.bookedFirst)}–${r.bookedLast != null ? timeOfDay(r.bookedLast) : '…'}`);

  return h('section', { class: 'view view-account' },
    h('div', { class: 'card balance-card' },
      h('div', { class: 'stat-label' }, 'Zeitkonto'),
      h('div', { class: 'balance-big', 'data-testid': 'account-balance' }, signed(acc.balance)),
      h('div', { class: 'muted' }, `Differenzminuten zur gebuchten ${grid === 15 ? 'Viertelstunde' : `${grid}-Minuten-Zeit`}`)),

    acc.problems.length ? h('div', { class: 'notice notice-warn' },
      h('b', null, `${acc.problems.length} Tag(e) sind unvollständig oder fehlerhaft:`),
      h('ul', null, acc.problems.map((p) => h('li', null, h('a', { href: `#/tag/${p.day}` }, fmtDate(p.day)), ' – ', p.issues[0]?.message || '')))) : null,

    h('div', { class: 'card' },
      h('h2', null, 'Herleitung'),
      h('table', { class: 'calc' }, h('tbody', null,
        h('tr', null, h('th', null, `Anfangssaldo (${fmtDate(acc.start)})`), h('td', null, signed(acc.startBalance))),
        h('tr', null, h('th', null, '+ Differenzminuten'), h('td', null, signed(acc.effectTotal))),
        h('tr', null, h('th', null, '+ Korrekturen'), h('td', null, signed(acc.correctionsTotal))),
        h('tr', { class: 'strong' }, h('th', null, '= Zeitkonto'), h('td', null, signed(acc.balance))))),
      h('details', null,
        h('summary', null, 'Wie wird gerechnet?'),
        h('ul', { class: 'explain' },
          h('li', null, `Gestempelt wird minutengenau. Gebucht wird jede Zeit auf die nächstgelegene volle ${grid === 15 ? 'Viertelstunde' : `${grid}-Minuten-Marke`}.`),
          h('li', null, 'Die Differenz geht ins Zeitkonto: Kommen 08:50 → gebucht 08:45 = −0:05; Gehen 17:49 → gebucht 17:45 = +0:04. Für Pausen umgekehrt.'),
          h('li', null, 'In der Buchungsliste kann jede Zeit auf die andere Viertelstunde umgeschaltet werden (z. B. 08:50 → 09:00 = +0:10), um gezielt mit dem Konto zu verrechnen.'),
          h('li', null, 'Es gibt keine Sollzeit: Kürzere oder längere Tage verändern das Konto nicht.'),
          h('li', null, 'Korrekturen wirken direkt auf das Konto.')))),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Korrekturen'),
        h('button', { type: 'button', class: 'btn btn-small', 'data-testid': 'add-correction', onclick: () => editCorrectionDialog(app) }, '+ Korrektur')),
      corrections.length ? h('ul', { class: 'corr-list' }, corrections.map((c) => h('li', null,
        h('span', null, fmtDate(c.day)),
        signed(c.minutes),
        h('span', { class: 'corr-reason' }, c.reason, c.day > today ? ' (zukünftig – noch nicht berücksichtigt)' : ''),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Löschen', onclick: () => removeCorrection(c) }, '🗑'))))
        : h('p', { class: 'muted' }, 'Keine Korrekturen.')),

    h('div', { class: 'card' },
      h('div', { class: 'nav-row' },
        h('a', { class: 'btn btn-small', href: `#/konto/${addMonths(mk, -1)}`, 'aria-label': 'Vormonat' }, '‹'),
        h('h2', { class: 'nav-title' }, `Verlauf ${fmtMonth(mk)}`),
        h('a', { class: 'btn btn-small', href: `#/konto/${addMonths(mk, 1)}`, 'aria-label': 'Folgemonat' }, '›')),
      monthRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'ledger' },
        h('thead', null, h('tr', null, ['Tag', 'Gebucht', 'Arbeit', 'Diff.', 'Konto'].map((t) => h('th', null, t)))),
        h('tbody', null, monthRows.map((r) => h('tr', { class: 'clickable', onclick: () => app.navigate(`#/tag/${r.day}`) },
          h('td', null, fmtDate(r.day, { year: false })),
          h('td', { class: 'num' }, range(r)),
          h('td', { class: 'num' }, r.bookedNetMin == null ? statusBadge(r.status) : fmtDuration(r.bookedNetMin)),
          h('td', null, signed(r.effect), r.correction ? h('div', { class: 'small' }, 'Korr. ', signed(r.correction)) : null),
          h('td', null, signed(r.balance))))))) : h('p', { class: 'muted' }, `Keine Buchungen in diesem Monat (Konto beginnt am ${fmtDate(acc.start)}).`)),
  );
}
