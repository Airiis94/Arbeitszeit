// Einstellungen und Sicherung.

import { h, field, toast, confirmDialog, formDialog, downloadFile } from './dom.js';
import { computeAccount } from '../core/calc.js';
import { daysToCsv, activitiesToCsv } from '../core/csv.js';
import { GRID_OPTIONS, TRACKING_MODES } from '../core/booking.js';
import {
  fmtDuration, parseDuration, fmtDateTime, todayKey, isValidDayKey, monthKey,
  firstOfMonth, lastOfMonth, startOfWeek, addDays,
} from '../core/time.js';
import { APP_VERSION, SCHEMA_VERSION } from '../core/model.js';
import { backupState } from './common.js';
import { exportBackup, shareBackup, importFlow, canShareFiles, exportReport, downloadSnapshot } from './backup.js';
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
  const id = `sec-${title.toLowerCase().replace(/[^a-zäöü]+/g, '-').replace(/-+$/, '')}`;
  return h('div', { class: 'card', id }, h('h2', null, title), ...children);
}

/** Sprungmarken zu den Abschnitten der (langen) Einstellungsseite. */
function jumpNav(sections) {
  return h('nav', { class: 'jump', 'aria-label': 'Abschnitte' }, sections.map(([label, el]) => h('button', {
    type: 'button', class: 'chip', onclick: () => el.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  }, label)));
}

export async function renderSettings(app) {
  const data = await app.load();
  const { settings, meta } = data;
  const now = Date.now();
  const today = todayKey(now);
  const bs = backupState(meta, settings, now);
  const st = await storageInfo();
  const snapshots = await app.repo.listSnapshots();
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
      downloadFile(`arbeitszeit-tage-${suffix}.csv`, daysToCsv(acc.rows.filter((r) => inRange(r.day))), 'text/csv;charset=utf-8');
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
    h('h3', null, 'Automatische Sicherungskopien'),
    h('p', { class: 'muted small' }, 'Vor jedem Update, vor jedem Import und einmal täglich legt die App eine vollständige Kopie aller Daten auf diesem Gerät ab. ',
      'Damit lässt sich ein früherer Stand jederzeit zurückholen. Gegen das Löschen der Browserdaten oder Verlust des Handys hilft nur die heruntergeladene/geteilte Sicherung oben.'),
    snapshots.length ? h('ul', { class: 'snap-list', 'data-testid': 'snapshots' }, snapshots.map((sn) => h('li', null,
      h('div', null,
        h('b', null, fmtDateTime(sn.at)), ` · ${sn.reason}`,
        h('div', { class: 'muted small' }, `${sn.counts?.intervals ?? 0} Buchungen, ${sn.counts?.activities ?? 0} Tätigkeiten, ${sn.counts?.corrections ?? 0} Korrekturen`)),
      h('div', { class: 'snap-actions' },
        h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Kopie herunterladen', onclick: () => downloadSnapshot(app, sn.key).catch(app.error) }, '⬇'),
        h('button', {
          type: 'button', class: 'btn btn-small', 'data-testid': 'snapshot-restore', onclick: async () => {
            const ok = await confirmDialog({
              title: 'Diesen Stand wiederherstellen?',
              message: [`Alle Daten werden durch die Kopie vom ${fmtDateTime(sn.at)} (${sn.reason}) ersetzt.`, 'Der aktuelle Stand wird vorher automatisch als Kopie gesichert – das lässt sich also rückgängig machen.'],
              confirmText: 'Wiederherstellen',
              danger: true,
            });
            if (!ok) return;
            try {
              await app.repo.restoreSnapshot(sn.key);
              toast('Der frühere Stand wurde wiederhergestellt.', { type: 'success', timeout: 7000 });
            } catch (e) { app.error(e); }
          },
        }, 'Wiederherstellen'))))) : h('p', { class: 'muted small' }, 'Noch keine Kopie vorhanden (wird angelegt, sobald Daten erfasst sind).'),
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

  // ----- Ausbildungsnachweis (Excel) -----
  const report = settings.report || {};
  const repName = h('input', { type: 'text', class: 'input', value: report.name || '', maxlength: 80, autocomplete: 'name' });
  const repStart = h('input', { type: 'date', class: 'input', value: report.trainingStart || '' });
  const weekStart = startOfWeek(today);
  const repFrom = h('input', { type: 'date', class: 'input', value: weekStart, 'data-testid': 'report-from' });
  const repTo = h('input', { type: 'date', class: 'input', value: addDays(weekStart, 6), 'data-testid': 'report-to' });
  const setRange = (from, to) => { repFrom.value = from; repTo.value = to; };
  const reportSection = section('Ausbildungsnachweis (Excel)',
    h('p', { class: 'muted small' }, 'Erstellt eine Excel-Datei im Layout des Ausbildungsnachweises: ein Blatt pro Woche; neben dem Wochentag senkrecht die Tagesarbeitszeit und Pause, daneben die Tätigkeiten (Einzelstunden) und rechts die Ausbildungsabteilung (= Kategorie der Tätigkeit); je Tag Stunden gesamt (Arbeit + Pause), Pause und Stunden netto; Wochenarbeitszeit = Summe Stunden netto. Druckfertig auf einer A4-Seite. Zum direkten Drucken oder als PDF: Kalender → Woche → „Wochentabelle drucken / als PDF“.'),
    h('div', { class: 'row-2' },
      field('Name', repName),
      field('Ausbildungsbeginn', repStart, 'für Nachweis-Nr. und Ausbildungsjahr')),
    h('button', {
      type: 'button', class: 'btn', onclick: async () => {
        if (repStart.value && !isValidDayKey(repStart.value)) { app.error(err('Ungültiger Ausbildungsbeginn.')); return; }
        await save({ ...settings, report: { name: repName.value.trim(), trainingStart: repStart.value || null } }, 'Angaben gespeichert.');
      },
    }, 'Angaben speichern'),
    h('h3', null, 'Zeitraum'),
    h('div', { class: 'chips' },
      h('button', { type: 'button', class: 'chip', onclick: () => setRange(weekStart, addDays(weekStart, 6)) }, 'Diese Woche'),
      h('button', { type: 'button', class: 'chip', onclick: () => setRange(addDays(weekStart, -7), addDays(weekStart, -1)) }, 'Letzte Woche'),
      h('button', { type: 'button', class: 'chip', onclick: () => setRange(firstOfMonth(monthKey(today)), lastOfMonth(monthKey(today))) }, 'Dieser Monat')),
    h('div', { class: 'row-2' }, field('von', repFrom), field('bis', repTo)),
    h('button', {
      type: 'button', class: 'btn btn-primary btn-block', 'data-testid': 'export-report', onclick: () => {
        exportReport(app, data, repFrom.value, repTo.value, { name: repName.value.trim(), trainingStart: repStart.value || null }).catch(app.error);
      },
    }, '⬇ Ausbildungsnachweis herunterladen (Excel)'));

  // ----- Zeitkonto -----
  const accountSection = section('Zeitkonto',
    h('form', {
      class: 'stack',
      onsubmit: async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        try {
          const start = f.get('accountStart');
          if (!isValidDayKey(start)) throw err('Ungültiger Kontobeginn.');
          const bal = parseDuration(f.get('startBalance') || '0');
          if (bal == null) throw err('Ungültiger Anfangssaldo (z. B. +12:30, -3:15 oder +45 min).');
          const interval = Number(f.get('interval'));
          if (!GRID_OPTIONS.includes(interval)) throw err('Ungültiges Buchungsraster.');
          const next = {
            ...settings,
            accountStart: start,
            startBalanceMin: bal,
            rounding: { interval },
            trackingMode: f.get('trackingMode') === 'exact' ? 'exact' : 'quarter',
            autoBreak: { ...settings.autoBreak, enabled: !!f.get('autoBreak') },
            backupReminderDays: Math.max(1, Number(f.get('reminder')) || 7),
          };
          const ok = await confirmDialog({
            title: 'Regeln übernehmen?',
            message: 'Das Zeitkonto wird aus den gespeicherten Stempelzeiten neu berechnet – auch für vergangene Tage. Die gestempelten Zeiten und deine gewählten Buchungen bleiben gespeichert.',
            confirmText: 'Übernehmen',
          });
          if (ok) await save(next);
        } catch (e) { app.error(e); }
      },
    },
    h('div', { class: 'row-2' },
      field('Kontobeginn', h('input', { type: 'date', name: 'accountStart', class: 'input', value: settings.accountStart })),
      field('Anfangssaldo', h('input', { type: 'text', name: 'startBalance', class: 'input', value: fmtDuration(settings.startBalanceMin, { sign: true }) }), 'z. B. +12:30 oder -3:15')),
    field('Erfassungsart', h('select', { name: 'trackingMode', class: 'input', 'data-testid': 'tracking-mode' },
      Object.entries(TRACKING_MODES).map(([k, v]) => h('option', { value: k, selected: (settings.trackingMode || 'quarter') === k }, v))),
    'Viertelstunden: gebucht wird auf das Raster, die Differenzminuten gehen ins Zeitkonto. Minutengenau: gebucht = gestempelt. Wechsel jederzeit möglich: Die gestempelten Zeiten bleiben erhalten, nur die Berechnung ändert sich.'),
    field('Buchungsraster', h('select', { name: 'interval', class: 'input' },
      GRID_OPTIONS.map((m) => h('option', { value: m, selected: (settings.rounding?.interval || 15) === m }, m === 15 ? '15 Minuten (Viertelstunde)' : `${m} Minuten`))),
    'Stempelzeiten werden auf die nächstgelegene Marke gebucht; die Differenz geht ins Zeitkonto.'),
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
    jumpNav([['Sicherung', backupSection], ['Zeitkonto', accountSection], ['Nachweis', reportSection], ['Speicher', storageSection], ['Darstellung', themeSection], ['Löschen', dangerSection]]),
    h('a', { class: 'btn btn-block', href: '#/hilfe' }, '❓ Hilfe & Installationsanleitung'),
    backupSection, accountSection, reportSection, storageSection, themeSection, dangerSection,
    h('p', { class: 'muted small center' }, `Arbeitszeit v${APP_VERSION} · Datenformat ${SCHEMA_VERSION} · Gerät ${String(meta.deviceId || '').slice(0, 8)}`,
      h('br'), 'Keine Werbung, kein Tracking, keine Server – alle Daten bleiben auf diesem Gerät.'));
}
