// Sicherung: Export als JSON-Datei, Teilen (z. B. an Google Drive), Import mit Prüfung und Vorschau.

import { h, formDialog, toast, downloadFile, pickFile, readFileAsText } from './dom.js';
import { buildBackup, parseBackup, backupSummary } from '../core/backup-format.js';
import { fmtDateTime, fmtDate, todayKey, timeOfDay } from '../core/time.js';
import { buildTextBackup } from '../core/textreport.js';
import { COLLECTIONS, normalizeSettings } from '../core/model.js';
import { buildNachweisXlsx, weeksInRange } from '../core/nachweis.js';
import { isValidDayKey, isoWeek } from '../core/time.js';
import { ValidationError } from '../db/repo.js';

function fileName(now = Date.now()) {
  return `arbeitszeit-sicherung-${todayKey(now)}-${timeOfDay(now).replace(':', '')}.json`;
}

/** Dateiname der lesbaren Text-Sicherung, z. B. „Arbeitszeit-Sicherung_13.10.2026_23-38.txt“. */
function textFileName(now = Date.now()) {
  return `Arbeitszeit-Sicherung_${fmtDate(todayKey(now), { weekday: false })}_${timeOfDay(now).replace(':', '-')}.txt`;
}

async function createBackupFile(app) {
  const raw = await app.repo.exportData();
  const { meta, ...data } = raw;
  const now = Date.now();
  const backup = await buildBackup(data, { deviceId: meta.deviceId, now });
  const name = fileName(now);
  return { name, text: JSON.stringify(backup, null, 1), now, backup, data };
}

/** Eine automatische Sicherungskopie als normale Sicherungsdatei (JSON) herunterladen. */
export async function downloadSnapshot(app, key) {
  const snap = await app.repo.getSnapshot(key);
  if (!snap) throw new ValidationError(['Diese Sicherungskopie gibt es nicht mehr.']);
  const meta = (await app.repo.loadAll()).meta;
  const backup = await buildBackup({ ...snap.data, settings: normalizeSettings(snap.data.settings) }, { deviceId: meta.deviceId, now: snap.at });
  const name = fileName(snap.at).replace('.json', '-kopie.json');
  downloadFile(name, JSON.stringify(backup, null, 1), 'application/json');
  toast(`„${name}“ wird heruntergeladen.`, { type: 'success' });
}

/** Lädt die Sicherung als Datei herunter (landet unter Android im Ordner „Downloads“). */
export async function exportBackup(app, { silent = false } = {}) {
  const { name, text, now } = await createBackupFile(app);
  downloadFile(name, text, 'application/json');
  await app.repo.updateMeta({ lastExportAt: now, lastExportName: name, lastExportMethod: 'download' });
  if (!silent) toast(`Sicherung „${name}“ wird heruntergeladen.`, { type: 'success', timeout: 7000 });
  return name;
}

// Chrome (Android) teilt nur bestimmte Dateitypen – JSON gehört nicht dazu und wird mit
// „Permission denied“ abgelehnt. Geteilt wird deshalb eine lesbare Text-Sicherung (.txt):
// oben die Zeiten als Text, unten ein Datenblock, mit dem die Datei wieder importiert werden kann.
const SHARE_TYPE = 'text/plain';

export function canShareFiles() {
  try {
    const f = new File(['{}'], 'test.txt', { type: SHARE_TYPE });
    return !!(navigator.canShare && navigator.canShare({ files: [f] }));
  } catch { return false; }
}

/** Übergibt die Sicherung an das Android-Teilen-Menü (z. B. Google Drive, E-Mail, Nextcloud). */
export async function shareBackup(app) {
  const { name: jsonName, text, now, backup, data } = await createBackupFile(app);
  const name = textFileName(now);
  const file = new File([buildTextBackup({ data, backup, now })], name, { type: SHARE_TYPE });
  try {
    await navigator.share({ files: [file], title: 'Arbeitszeit-Sicherung' });
  } catch (e) {
    if (e?.name === 'AbortError') { toast('Teilen abgebrochen – keine Sicherung gespeichert.'); return; }
    // Teilen vom Browser abgelehnt (z. B. Dateityp nicht erlaubt): stattdessen herunterladen,
    // damit die Sicherung nicht verloren geht.
    downloadFile(jsonName, text, 'application/json');
    await app.repo.updateMeta({ lastExportAt: now, lastExportName: jsonName, lastExportMethod: 'download' });
    toast(`Teilen wurde vom Browser abgelehnt (${e?.message || e?.name || 'unbekannter Fehler'}). Die Sicherung wurde stattdessen in „Downloads“ gespeichert – von dort kannst du sie z. B. in Google Drive hochladen.`, { type: 'info', timeout: 12000 });
    return;
  }
  // Ob das Ziel die Datei wirklich gespeichert hat, kann der Browser nicht prüfen.
  await app.repo.updateMeta({ lastExportAt: now, lastExportName: name, lastExportMethod: 'share' });
  toast('Sicherung wurde zum Teilen übergeben. Bitte im Zielordner prüfen, ob sie angekommen ist.', { type: 'success', timeout: 8000 });
}

export async function importFlow(app) {
  const file = await pickFile('application/json,.json,text/plain,.txt');
  if (!file) return;
  let text;
  try {
    text = await readFileAsText(file);
  } catch (e) { app.error(e); return; }
  const res = await parseBackup(text);
  if (!res.ok) {
    await formDialog({
      title: 'Import nicht möglich',
      submitText: 'OK',
      build: () => [
        h('p', null, `Die Datei „${file.name}“ wurde geprüft und NICHT importiert. Deine Daten sind unverändert.`),
        h('ul', { class: 'issues' }, res.errors.map((e) => h('li', { class: 'issue issue-error' }, e))),
      ],
      onSubmit: () => true,
    });
    return;
  }
  const sum = backupSummary(res.backup);
  const mergeStats = await app.repo.importMerge(res.backup.data, Date.now(), { dryRun: true });
  const statLine = (name, label) => {
    const s = mergeStats[name];
    return h('li', null, `${label}: ${s.added} neu, ${s.updated} aktualisiert, ${s.keptLocal} lokal neuer (bleiben), ${s.unchanged} identisch`);
  };

  await formDialog({
    title: 'Sicherung importieren',
    submitText: 'Importieren',
    danger: true,
    build: () => [
      h('p', null, `Datei: ${file.name}`),
      h('ul', null,
        h('li', null, `Erstellt: ${sum.exportedAt ? fmtDateTime(Date.parse(sum.exportedAt)) : 'unbekannt'} (App ${sum.appVersion || '?'})`),
        h('li', null, `${sum.intervals} Buchungen an ${sum.days} Tagen${sum.firstDay ? ` (${sum.firstDay} bis ${sum.lastDay})` : ''}`),
        h('li', null, `${sum.activities} Tätigkeiten, ${sum.corrections} Korrekturen`)),
      res.warnings.length ? h('ul', { class: 'issues' }, res.warnings.map((w) => h('li', { class: 'issue issue-warn' }, w))) : null,
      h('fieldset', { class: 'radio-group' },
        h('legend', null, 'Wie importieren?'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'mode', value: 'merge', checked: true }),
          ' Zusammenführen: neue Einträge übernehmen, je Eintrag gewinnt die neuere Version. Lokale Einstellungen bleiben.'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'mode', value: 'replace' }),
          ' Ersetzen: ALLE aktuellen Daten und Einstellungen werden durch die Sicherung ersetzt.')),
      h('details', null, h('summary', null, 'Vorschau Zusammenführen'),
        h('ul', { class: 'small' },
          statLine('intervals', 'Buchungen'), statLine('activities', 'Tätigkeiten'),
          statLine('corrections', 'Korrekturen'), statLine('dayInfos', 'Tagesangaben'))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'backupFirst', checked: true }),
        ' Vorher eine Sicherung der aktuellen Daten herunterladen (empfohlen)'),
    ],
    onSubmit: async (form) => {
      const f = new FormData(form);
      if (f.get('backupFirst')) await exportBackup(app, { silent: true });
      await app.repo.saveSnapshot('vor Import');
      if (f.get('mode') === 'replace') {
        await app.repo.importReplace(res.backup.data);
        toast('Import abgeschlossen: Daten wurden ersetzt.', { type: 'success' });
      } else {
        const stats = await app.repo.importMerge(res.backup.data);
        const added = COLLECTIONS.reduce((s, n) => s + stats[n].added + stats[n].updated, 0);
        toast(`Import abgeschlossen: ${added} Einträge übernommen.`, { type: 'success' });
      }
    },
  });
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Ausbildungsnachweis als Excel-Datei (ein Blatt pro Woche) herunterladen. */
export async function exportReport(app, data, from, to, report = null) {
  if (!isValidDayKey(from) || !isValidDayKey(to) || to < from) throw new ValidationError(['Bitte einen gültigen Zeitraum wählen („bis“ nach „von“).']);
  const settings = report ? { ...data.settings, report } : data.settings;
  const bytes = buildNachweisXlsx({ from, to, data: { ...data, settings } });
  const weeks = weeksInRange(from, to);
  const kw = (w) => `KW${String(isoWeek(w)).padStart(2, '0')}`;
  const label = weeks.length === 1 ? `${kw(weeks[0])}-${weeks[0].slice(0, 4)}` : `${kw(weeks[0])}-bis-${kw(weeks[weeks.length - 1])}-${weeks[weeks.length - 1].slice(0, 4)}`;
  const name = `Ausbildungsnachweis_${label}.xlsx`;
  downloadFile(name, new Blob([bytes], { type: XLSX_TYPE }));
  toast(`„${name}“ wird heruntergeladen (${weeks.length} Woche${weeks.length === 1 ? '' : 'n'}).`, { type: 'success', timeout: 7000 });
  return name;
}
