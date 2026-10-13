// Einstellungen und Sicherung.

import { h, field, toast, confirmDialog, formDialog, downloadFile } from './dom.js';
import { computeAccount } from '../core/calc.js';
import { daysToCsv, activitiesToCsv } from '../core/csv.js';
import { ROUNDING_MODES, CARRY_RULES } from '../core/rounding.js';
import {
  fmtDuration, parseDuration, fmtDateTime, fmtDate, todayKey, isValidDayKey, WEEKDAYS_LONG, monthKey,
  firstOfMonth, lastOfMonth,
} from '../core/time.js';
import { APP_VERSION, SCHEMA_VERSION, uuid } from '../core/model.js';
import { backupState } from './common.js';
import { exportBackup, shareBackup, importFlow, canShareFiles } from './backup.js';
import { ValidationError } from '../db/repo.js';

const err = (m) => new ValidationError([m]);

async function storageInfo() {
  const info = { persisted: null, usage: null, quota: null, supported: !!navigator.storage };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage;
      info.quota = e.quota;
    }
  } catch { /* nicht unterstützt */ }
  return info;
}

const mb = (b) => (b == null ? '?' : `${(b / 1024 / 1024).toFixed(1)} MB`);

function section(title, ...children) {
  return h('div', { class: 'card' }, h('h2', null, title), ...children);
}

export async function renderSettings(app) {
  const data = await app.load();
  const { settings, meta } = data;
  const now = Date.now();
  const today = todayKey(now);
  const bs = backupState(meta, settings, now);
  const st = await storageInfo();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const save = async (next, msg = 'Einstellungen gespeichert.') => {
    try {
      await app.repo.saveSettings(next);
      toast(msg, { type: 'success' });
    } catch (e) { app.error(e); }
  };

  // ----- Sicherung -----
  const csvMonth = h('input', { type: 'month', class: 'input', value: monthKey(today) });
  const csvAll = h('input', { type: 'checkbox' });
  const exportCsv = (kind) => {
    const acc = computeAccount({ ...data, today, now });
    const mk = csvMonth.value || monthKey(today);
    const inRange = (day) => csvAll.checked || (day >= firstOfMonth(mk) && day <= lastOfMonth(mk));
    const suffix = csvAll.checked ? 'gesamt' : mk;
    if (kind === 'days') {
      const infoByDay = new Map(data.dayInfos.map((d) => [d.day, d]));
      downloadFile(`arbeitszeit-tage-${suffix}.csv`, daysToCsv(acc.rows.filter((r) => inRange(r.day)), infoByDay), 'text/csv;charset=utf-8');
    } else {
      downloadFile(`arbeitszeit-taetigkeiten-${suffix}.csv`, activitiesToCsv(data.activities.filter((a) => inRange(a.day))), 'text/csv;charset=utf-8');
    }
  };

  const backupSection = section('Sicherung',
    h('div', { class: `notice notice-${bs.level === 'ok' ? 'ok' : bs.level}`, 'data-testid': 'backup-state' }, bs.text),
    h('p', { class: 'small' },
      `Letzter Export: ${meta.lastExportAt ? `${fmtDateTime(meta.lastExportAt)} (${meta.lastExportName || ''})` : 'noch nie'}`,
      h('br'),
      `Letzter Import: ${meta.lastImportAt ? fmtDateTime(meta.lastImportAt) : 'noch nie'}`,
      h('br'),
      `Letzte Änderung: ${meta.lastChangeAt ? fmtDateTime(meta.lastChangeAt) : '–'}`),
    h('div', { class: 'btn-col' },
      h('button', { type: 'button', class: 'btn btn-primary', 'data-testid': 'export', onclick: () => exportBackup(app).catch(app.error) }, '⬇ Sicherung herunterladen (JSON)'),
      canShareFiles() ? h('button', { type: 'button', class: 'btn', onclick: () => shareBackup(app).catch(app.error) }, '↗ Sicherung teilen (z. B. Google Drive)') : null,
      h('button', { type: 'button', class: 'btn', 'data-testid': 'import', onclick: () => importFlow(app).catch(app.error) }, '⬆ Sicherung importieren …')),
    h('p', { class: 'muted small' },
      'Die Datei landet im Download-Ordner. Bitte zusätzlich an einen sicheren Ort kopieren (z. B. Google Drive, PC, USB-Stick). ',
      'Eine automatische Hintergrund-Sicherung gibt es bewusst nicht – der Browser kann sie nicht zuverlässig garantieren.'),
    h('h3', null, 'CSV-Export (Auswertung)'),
    h('div', { class: 'row-2' }, field('Monat', csvMonth), h('label', { class: 'check' }, csvAll, ' gesamter Zeitraum')),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => exportCsv('days') }, 'Arbeitstage (CSV)'),
      h('button', { type: 'button', class: 'btn', onclick: () => exportCsv('activities') }, 'Tätigkeiten (CSV)')));

  // ----- Speicher -----
  const storageSection = section('Lokaler Speicher',
    h('ul', { class: 'kv' },
      h('li', null, h('span', null, 'Datenbank (IndexedDB)'), h('b', { class: 'pos' }, 'verfügbar')),
      h('li', null, h('span', null, 'Dauerhafter Speicher'), st.persisted == null ? h('b', null, 'nicht unterstützt')
        : st.persisted ? h('b', { class: 'pos', 'data-testid': 'persisted' }, 'gewährt') : h('b', { class: 'neg', 'data-testid': 'persisted' }, 'nicht gewährt')),
      h('li', null, h('span', null, 'Belegt / verfügbar'), h('b', null, `${mb(st.usage)} / ${mb(st.quota)}`)),
      h('li', null, h('span', null, 'Als App installiert'), h('b', null, standalone ? 'ja' : 'nein (im Browser geöffnet)'))),
    st.persisted === false ? h('div', { class: 'notice notice-warn' },
      'Ohne dauerhaften Speicher darf der Browser die Daten bei Speichermangel löschen. Installiere die App auf dem Startbildschirm, ',
      'fordere dauerhaften Speicher an und exportiere regelmäßig eine Sicherung.') : null,
    h('p', { class: 'muted small' },
      'Die Daten liegen ausschließlich in diesem Browser auf diesem Gerät. „Browserdaten löschen“ oder das Deinstallieren ',
      'der App bzw. des Browsers entfernt sie unwiderruflich – nur eine exportierte Sicherung schützt davor.'),
    navigator.storage?.persist ? h('button', {
      type: 'button', class: 'btn', onclick: async () => {
        const ok = await navigator.storage.persist();
        toast(ok ? 'Dauerhafter Speicher wurde gewährt.' : 'Der Browser hat dauerhaften Speicher (noch) nicht gewährt. Tipp: App installieren und regelmäßig nutzen.', { type: ok ? 'success' : 'info', timeout: 8000 });
        app.rerender();
      },
    }, 'Dauerhaften Speicher anfordern') : null);

  // ----- Sollzeit -----
  const rules = [...settings.targetRules].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const current = rules.find((r) => r.validFrom <= today) || rules[rules.length - 1];
  const targetInputs = WEEKDAYS_LONG.map((_, i) => h('input', { type: 'text', class: 'input input-short', inputmode: 'numeric', value: fmtDuration(current.minutes[i]), 'aria-label': WEEKDAYS_LONG[i] }));
  const validFrom = h('input', { type: 'date', class: 'input', value: today });
  const weekSum = () => targetInputs.reduce((s, inp) => s + (parseDuration(inp.value) || 0), 0);
  const sumLabel = h('span', { class: 'num' }, fmtDuration(weekSum()));
  targetInputs.forEach((inp) => inp.addEventListener('input', () => { sumLabel.textContent = fmtDuration(weekSum()); }));

  const saveTargets = async () => {
    try {
      const minutes = targetInputs.map((inp, i) => {
        const m = parseDuration(inp.value || '0');
        if (m == null || m < 0 || m > 1440) throw err(`Ungültige Sollzeit für ${WEEKDAYS_LONG[i]}.`);
        return m;
      });
      if (!isValidDayKey(validFrom.value)) throw err('Bitte ein gültiges „Gültig ab“-Datum angeben.');
      const others = settings.targetRules.filter((r) => r.validFrom !== validFrom.value);
      const ok = await confirmDialog({
        title: 'Sollzeit speichern?',
        message: `Die neue Sollzeit (Woche ${fmtDuration(minutes.reduce((a, b) => a + b, 0))}) gilt ab ${fmtDate(validFrom.value)}. Frühere Tage behalten ihre bisherige Sollzeit.`,
        confirmText: 'Speichern',
      });
      if (!ok) return;
      await save({ ...settings, targetRules: [...others, { id: uuid(), validFrom: validFrom.value, minutes }] }, 'Sollzeit gespeichert.');
    } catch (e) { app.error(e); }
  };

  const targetSection = section('Sollarbeitszeit',
    h('div', { class: 'target-grid' }, WEEKDAYS_LONG.map((w, i) => field(w, targetInputs[i]))),
    h('p', null, 'Wochensumme: ', sumLabel),
    field('Gültig ab', validFrom, 'Änderungen gelten ab diesem Datum; frühere Tage bleiben unverändert.'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: saveTargets }, 'Sollzeit speichern'),
    rules.length > 1 ? h('details', null, h('summary', null, `Verlauf (${rules.length} Regeln)`),
      h('ul', { class: 'small' }, rules.map((r) => h('li', null,
        `ab ${fmtDate(r.validFrom)}: ${r.minutes.map(fmtDuration).join(' · ')} `,
        rules.length > 1 ? h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': 'Regel löschen', onclick: async () => {
            if (await confirmDialog({ title: 'Regel löschen?', message: `Sollzeit-Regel ab ${fmtDate(r.validFrom)} löschen? Betroffene Tage werden neu berechnet.`, confirmText: 'Löschen', danger: true })) {
              await save({ ...settings, targetRules: settings.targetRules.filter((x) => x.id !== r.id) });
            }
          },
        }, '🗑') : null)))) : null);

  // ----- Zeitkonto -----
  const accountSection = section('Zeitkonto und Verrechnung',
    h('form', {
      class: 'stack',
      onsubmit: async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        try {
          const start = f.get('accountStart');
          if (!isValidDayKey(start)) throw err('Ungültiger Kontobeginn.');
          const bal = parseDuration(f.get('startBalance') || '0');
          if (bal == null) throw err('Ungültiger Anfangssaldo (z. B. +12:30 oder -3:15).');
          const interval = Number(f.get('interval'));
          if (!Number.isInteger(interval) || interval < 1 || interval > 240) throw err('Das Intervall muss zwischen 1 und 240 Minuten liegen.');
          const next = {
            ...settings,
            accountStart: start,
            startBalanceMin: bal,
            rounding: { mode: f.get('mode'), interval, carryRule: f.get('carryRule') },
            countEmptyDays: !!f.get('countEmptyDays'),
            autoBreak: { ...settings.autoBreak, enabled: !!f.get('autoBreak') },
            backupReminderDays: Math.max(1, Number(f.get('reminder')) || 7),
          };
          const ok = await confirmDialog({
            title: 'Regeln übernehmen?',
            message: 'Alle Werte werden aus den gespeicherten Zeitstempeln neu berechnet – auch für vergangene Tage. Die erfassten Zeiten selbst bleiben unverändert.',
            confirmText: 'Übernehmen',
          });
          if (ok) await save(next);
        } catch (e) { app.error(e); }
      },
    },
    h('div', { class: 'row-2' },
      field('Kontobeginn', h('input', { type: 'date', name: 'accountStart', class: 'input', value: settings.accountStart })),
      field('Anfangssaldo', h('input', { type: 'text', name: 'startBalance', class: 'input', value: fmtDuration(settings.startBalanceMin, { sign: true }) }), 'z. B. +12:30 oder -3:15')),
    field('Verrechnungsart', h('select', { name: 'mode', class: 'input' },
      Object.entries(ROUNDING_MODES).map(([k, v]) => h('option', { value: k, selected: settings.rounding.mode === k }, v.label)))),
    h('div', null,
      field('Intervall (Minuten)', h('input', { type: 'number', name: 'interval', class: 'input', min: 1, max: 240, value: settings.rounding.interval })),
      field('Rest am Monatsende', h('select', { name: 'carryRule', class: 'input' },
        Object.entries(CARRY_RULES).map(([k, v]) => h('option', { value: k, selected: settings.rounding.carryRule === k }, v))))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'countEmptyDays', checked: settings.countEmptyDays }),
      ' Vergangene Tage ohne Buchung mit −Soll zählen (empfohlen; Urlaub etc. im Tag eintragen)'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'autoBreak', checked: settings.autoBreak.enabled }),
      ' Automatische Mindestpause abziehen (> 6 h: 30 min, > 9 h: 45 min; wird separat als „automatisch“ ausgewiesen)'),
    field('Sicherungs-Erinnerung nach (Tagen)', h('input', { type: 'number', name: 'reminder', class: 'input input-short', min: 1, max: 365, value: settings.backupReminderDays })),
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Regeln speichern')));

  // ----- Darstellung -----
  const themeSection = section('Darstellung',
    field('Farbschema', h('select', {
      class: 'input',
      onchange: (ev) => save({ ...settings, theme: ev.target.value }, 'Farbschema gespeichert.'),
    },
    [['system', 'Wie System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => h('option', { value: k, selected: settings.theme === k }, l)))));

  // ----- Gefahrenzone -----
  const dangerSection = section('Alle Daten löschen',
    h('p', { class: 'muted small' }, 'Löscht alle Buchungen, Tätigkeiten, Korrekturen und Einstellungen auf diesem Gerät.'),
    h('button', {
      type: 'button', class: 'btn btn-danger', onclick: () => formDialog({
        title: 'Wirklich ALLE Daten löschen?',
        danger: true,
        submitText: 'Endgültig löschen',
        build: () => [
          h('p', null, 'Dies kann nicht rückgängig gemacht werden. Vorher wird automatisch eine Sicherung heruntergeladen.'),
          field('Zur Bestätigung „LÖSCHEN“ eingeben', h('input', { name: 'confirm', class: 'input', autocomplete: 'off' })),
        ],
        onSubmit: async (form) => {
          if (new FormData(form).get('confirm') !== 'LÖSCHEN') throw err('Bitte genau „LÖSCHEN“ eingeben.');
          await exportBackup(app, { silent: true });
          await app.repo.wipe();
          toast('Alle Daten wurden gelöscht. Eine Sicherung wurde vorher heruntergeladen.', { type: 'success', timeout: 8000 });
        },
      }),
    }, 'Alle Daten löschen …'));

  return h('section', { class: 'view view-settings' },
    h('a', { class: 'btn btn-block', href: '#/hilfe' }, '❓ Hilfe & Installationsanleitung'),
    backupSection, storageSection, targetSection, accountSection, themeSection, dangerSection,
    h('p', { class: 'muted small center' }, `Arbeitszeit v${APP_VERSION} · Datenformat ${SCHEMA_VERSION} · Gerät ${String(meta.deviceId || '').slice(0, 8)}`,
      h('br'), 'Keine Werbung, kein Tracking, keine Server – alle Daten bleiben auf diesem Gerät.'));
}
