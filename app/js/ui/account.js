// Zeitkonto: Saldo, Herleitung, Korrekturen und Tagesverlauf.

import { h, confirmDialog } from './dom.js';
import { computeAccount } from '../core/calc.js';
import { ROUNDING_MODES, CARRY_RULES } from '../core/rounding.js';
import {
  fmtDuration, fmtDate, fmtMonth, addMonths, monthKey, todayKey, firstOfMonth, lastOfMonth,
} from '../core/time.js';
import { signed, statusBadge } from './common.js';
import { editCorrectionDialog, undoToast } from './editors.js';

export async function renderAccount(app, params) {
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const { settings } = data;
  const acc = computeAccount({ ...data, today, now });
  const mk = /^\d{4}-\d{2}$/.test(params[0] || '') ? params[0] : monthKey(today);
  const monthRows = acc.rows.filter((r) => r.day >= firstOfMonth(mk) && r.day <= lastOfMonth(mk));
  const { mode, interval, carryRule } = settings.rounding;
  const usesCarry = ROUNDING_MODES[mode]?.usesCarry;

  const removeCorrection = async (c) => {
    if (!(await confirmDialog({ title: 'Korrektur löschen?', message: `${fmtDuration(c.minutes, { sign: true })} am ${fmtDate(c.day)} („${c.reason}“)`, confirmText: 'Löschen', danger: true }))) return;
    try {
      const res = await app.repo.deleteCorrection(c.id);
      undoToast(app, 'Korrektur gelöscht.', res.changes);
    } catch (e) { app.error(e); }
  };

  const corrections = [...data.corrections].sort((a, b) => b.day.localeCompare(a.day));

  return h('section', { class: 'view view-account' },
    h('div', { class: 'card balance-card' },
      h('div', { class: 'stat-label' }, 'Zeitkonto (Saldo)'),
      h('div', { class: 'balance-big', 'data-testid': 'account-balance' }, signed(acc.balance)),
      usesCarry ? h('div', { class: 'muted', 'data-testid': 'account-carry' }, `Restguthaben (noch nicht angerechnet): ${fmtDuration(acc.carry)}`) : null,
      h('div', { class: 'muted', 'data-testid': 'account-minutes' }, `Verrechnungskonto minutengenau: ${fmtDuration(acc.minuteBalance, { sign: true })}`),
      acc.live?.deviation != null ? h('div', { class: 'muted' }, `inklusive heute bis jetzt (gegen Plan): ${fmtDuration(acc.live.minuteBalance, { sign: true })}`) : null),

    acc.problems.length ? h('div', { class: 'notice notice-warn' },
      h('b', null, `${acc.problems.length} Tag(e) werden nicht gezählt, weil sie unvollständig oder fehlerhaft sind:`),
      h('ul', null, acc.problems.map((p) => h('li', null, h('a', { href: `#/tag/${p.day}` }, fmtDate(p.day)), ' – ', p.issues[0]?.message || '')))) : null,

    h('div', { class: 'card' },
      h('h2', null, 'Herleitung'),
      h('table', { class: 'calc' }, h('tbody', null,
        h('tr', null, h('th', null, `Anfangssaldo (${fmtDate(acc.start)})`), h('td', null, signed(acc.startBalance))),
        h('tr', null, h('th', null, '+ Summe Tagesdifferenzen'), h('td', null, signed(acc.diffTotal))),
        h('tr', null, h('th', null, '+ Korrekturen'), h('td', null, signed(acc.correctionsTotal))),
        acc.flushCreditTotal ? h('tr', null, h('th', null, '+ Monatsabschluss-Gutschriften'), h('td', null, signed(acc.flushCreditTotal))) : null,
        h('tr', { class: 'strong' }, h('th', null, '= Saldo'), h('td', null, signed(acc.balance))),
        usesCarry ? h('tr', null, h('th', null, 'Restguthaben (separat)'), h('td', { class: 'num' }, fmtDuration(acc.carry))) : null,
        acc.forfeitedTotal ? h('tr', { class: 'neg' }, h('th', null, 'Verfallen (laut gewählter Regel)'), h('td', { class: 'num' }, fmtDuration(acc.forfeitedTotal))) : null)),
      h('details', null,
        h('summary', null, 'Wie wird gerechnet?'),
        h('ul', { class: 'explain' },
          h('li', null, `Verrechnung: ${ROUNDING_MODES[mode]?.label}${mode !== 'exact' ? `, Intervall ${interval} min` : ''}.`),
          usesCarry ? h('li', null, `Nicht angerechnete Minuten bleiben als Rest erhalten und werden am nächsten gezählten Tag zur Nettozeit addiert. Sobald der Rest zusammen mit der Tageszeit einen vollen ${interval}-Minuten-Block ergibt, wird dieser angerechnet. Restregel: ${CARRY_RULES[carryRule]}.`) : null,
          h('li', null, 'Tagesdifferenz = angerechnete Zeit − Soll. Die tatsächliche Nettozeit bleibt unverändert gespeichert.'),
          h('li', null, settings.countEmptyDays ? 'Vergangene Tage ohne Buchung zählen mit 0 Stunden (also −Soll). Urlaub/Krank/Feiertag/Frei im Tag eintragen.' : 'Tage ohne Buchung werden nicht gezählt.'),
          h('li', null, 'Laufende, unvollständige und fehlerhafte Tage werden erst nach Korrektur gezählt.'),
          h('li', null, 'Korrekturen wirken direkt auf den Saldo, ohne Rundung.')))),

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
        h('thead', null, h('tr', null, ['Tag', 'Netto', 'Soll', 'Abw.', usesCarry ? '+Rest' : null, 'Angerechnet', usesCarry ? 'Rest→' : null, 'Diff.', 'Saldo', 'Minuten']
          .filter(Boolean).map((t) => h('th', null, t)))),
        h('tbody', null, monthRows.map((r) => h('tr', { class: 'clickable', onclick: () => app.navigate(`#/tag/${r.day}`) },
          h('td', null, fmtDate(r.day, { year: false })),
          h('td', { class: 'num' }, r.status === 'empty' ? '–' : fmtDuration(r.netMin)),
          h('td', { class: 'num' }, fmtDuration(r.target)),
          h('td', null, r.counted ? signed(r.exactDiff) : ''),
          usesCarry ? h('td', { class: 'num muted' }, r.counted ? fmtDuration(r.carryIn) : '') : null,
          h('td', { class: 'num' }, r.counted ? fmtDuration(r.credited) : statusBadge(r.status)),
          usesCarry ? h('td', { class: 'num muted' }, fmtDuration(r.carryOut)) : null,
          h('td', null, r.counted ? signed(r.diff) : '', r.correction ? h('div', { class: 'small' }, 'Korr. ', signed(r.correction)) : null, r.flushCredit ? h('div', { class: 'small' }, 'Rest ', signed(r.flushCredit)) : null),
          h('td', null, signed(r.balance)),
          h('td', null, signed(r.minuteBalance))))))) : h('p', { class: 'muted' }, 'Keine Einträge in diesem Monat (Konto beginnt am ' + fmtDate(acc.start) + ').')),
  );
}
