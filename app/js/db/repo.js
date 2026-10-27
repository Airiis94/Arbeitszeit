// Datenzugriff der App. Jede Änderung läuft in genau einer IndexedDB-Transaktion:
// lesen → prüfen → schreiben → Änderungsprotokoll → Metadaten. Schlägt etwas fehl, wird nichts geschrieben.

import { openDb, transact, getAll, get, put, clear, del, getAllPrefix, STORES } from './db.js';
import { planClockAction } from '../core/state.js';
import { validateIntervalChange, breaksOfWork } from '../core/validate.js';
import { planMerge } from '../core/backup-format.js';
import {
  newRecord, touch, uuid, defaultSettings, normalizeSettings, COLLECTIONS, APP_VERSION,
} from '../core/model.js';
import { todayKey } from '../core/time.js';

const SNAPSHOT_PREFIX = 'snapshot:';
// Aufbewahrung: die 5 neuesten täglichen Kopien und die 5 neuesten Kopien vor Update/Import/Wiederherstellen
const SNAPSHOT_KEEP_DAILY = 5;
const SNAPSHOT_KEEP_EVENTS = 5;

export class ValidationError extends Error {
  constructor(messages) {
    super(messages.join('\n'));
    this.name = 'ValidationError';
    this.messages = messages;
  }
}

const live = (list) => list.filter((r) => !r.deleted);

function auditEntry({ entity, before, after, action, reason, now }) {
  const rec = after || before;
  return newRecord({
    at: now,
    entity,
    entityId: rec.id,
    day: rec.day || null,
    action,
    reason: reason || '',
    before: before || null,
    after: after || null,
  }, now);
}

export class Repo {
  constructor(db, { onChange } = {}) {
    this.db = db;
    this.onChange = onChange || (() => {});
  }

  static async open(opts = {}) {
    const db = await openDb(opts);
    const repo = new Repo(db, opts);
    await repo.init();
    return repo;
  }

  close() {
    this.db.close();
  }

  async init(now = Date.now()) {
    await transact(this.db, ['kv'], 'readwrite', async (tx) => {
      const s = await get(tx, 'kv', 'settings');
      if (!s) await put(tx, 'kv', { key: 'settings', value: { ...defaultSettings(todayKey(now)), updatedAt: now } });
      const m = await get(tx, 'kv', 'meta');
      if (!m) {
        await put(tx, 'kv', { key: 'meta', value: {
          deviceId: uuid(), createdAt: now, lastChangeAt: null, lastExportAt: null, lastExportName: null, lastImportAt: null,
        } });
      }
    });
  }

  // ---------- Lesen ----------

  async loadAll() {
    return transact(this.db, STORES, 'readonly', async (tx) => {
      const [intervals, dayInfos, activities, corrections, s, m] = await Promise.all([
        getAll(tx, 'intervals'), getAll(tx, 'dayInfos'), getAll(tx, 'activities'), getAll(tx, 'corrections'),
        get(tx, 'kv', 'settings'), get(tx, 'kv', 'meta'),
      ]);
      return {
        intervals: live(intervals),
        dayInfos: live(dayInfos),
        activities: live(activities),
        corrections: live(corrections),
        settings: normalizeSettings(s?.value),
        meta: m?.value || {},
      };
    });
  }

  async auditForDay(day) {
    const all = await transact(this.db, ['audit'], 'readonly', (tx) => getAll(tx, 'audit'));
    return all.filter((a) => a.day === day).sort((a, b) => b.at - a.at);
  }

  /** Rohdaten inkl. gelöschter Datensätze (Tombstones) für die Sicherung. */
  async exportData() {
    return transact(this.db, STORES, 'readonly', async (tx) => {
      const out = {};
      for (const name of COLLECTIONS) out[name] = await getAll(tx, name);
      out.settings = normalizeSettings((await get(tx, 'kv', 'settings'))?.value);
      out.meta = (await get(tx, 'kv', 'meta'))?.value || {};
      return out;
    });
  }

  // ---------- Schreiben ----------

  async #write(stores, fn) {
    const all = [...new Set([...stores, 'kv'])];
    const res = await transact(this.db, all, 'readwrite', async (tx) => {
      const r = await fn(tx);
      const m = await get(tx, 'kv', 'meta');
      await put(tx, 'kv', { key: 'meta', value: { ...(m?.value || {}), lastChangeAt: Date.now() } });
      return r;
    });
    this.onChange();
    return res;
  }

  /** Stempelaktion (start | pause | resume | end). Zustand wird in derselben Transaktion gelesen. */
  async clock(action, now = Date.now()) {
    return this.#write(['intervals', 'audit'], async (tx) => {
      const intervals = await getAll(tx, 'intervals');
      const plan = planClockAction(intervals, action, now);
      const changes = [];
      for (const rec of plan.puts) {
        const before = intervals.find((i) => i.id === rec.id) || null;
        await put(tx, 'intervals', rec);
        changes.push({ store: 'intervals', before, after: rec });
      }
      return { message: plan.message, stamp: plan.stamp, changes };
    });
  }

  /**
   * Speichert neue/geänderte/gelöschte Intervalle nach Prüfung gegen den gesamten Bestand.
   * @param records vollständige Datensätze (bereits mit touch()/newInterval() erzeugt)
   */
  async saveIntervals(records, { reason = '', now = Date.now() } = {}) {
    return this.#write(['intervals', 'audit'], async (tx) => {
      const all = await getAll(tx, 'intervals');
      const errors = validateIntervalChange(all, records, now);
      if (errors.length) throw new ValidationError(errors);
      const changes = [];
      for (const rec of records) {
        const before = all.find((i) => i.id === rec.id) || null;
        await put(tx, 'intervals', rec);
        const action = !before ? 'create' : rec.deleted ? 'delete' : 'update';
        await put(tx, 'audit', auditEntry({ entity: 'interval', before, after: rec, action, reason, now }));
        changes.push({ store: 'intervals', before, after: rec });
      }
      return { changes };
    });
  }

  /** Löscht eine Buchung; bei einer Arbeitsphase auch deren Pausen (siehe breaksOfWork) – gemeinsam rückgängig zu machen. */
  async deleteInterval(id, { reason = '', now = Date.now() } = {}) {
    const all = await transact(this.db, ['intervals'], 'readonly', (tx) => getAll(tx, 'intervals'));
    const rec = all.find((i) => i.id === id);
    if (!rec || rec.deleted) throw new ValidationError(['Eintrag nicht gefunden.']);
    const withBreaks = [rec, ...breaksOfWork(all, rec, now)];
    return this.saveIntervals(withBreaks.map((r) => touch(r, { deleted: true }, now)), { reason, now });
  }

  /** Macht eine Änderung rückgängig, sofern der Datensatz seitdem nicht erneut geändert wurde. */
  async undo(changes, now = Date.now()) {
    const stores = [...new Set(changes.map((c) => c.store)), 'audit'];
    return this.#write(stores, async (tx) => {
      for (const c of changes) {
        const cur = await get(tx, c.store, c.after.id);
        if (!cur || cur.rev !== c.after.rev) {
          throw new ValidationError(['Rückgängig nicht möglich: Der Eintrag wurde inzwischen erneut geändert.']);
        }
        const restored = c.before ? touch(cur, { ...c.before, id: cur.id }, now) : touch(cur, { deleted: true }, now);
        await put(tx, c.store, restored);
        await put(tx, 'audit', auditEntry({ entity: c.store, before: cur, after: restored, action: 'undo', reason: 'Rückgängig', now }));
      }
    });
  }

  async saveDayInfo(day, fields, now = Date.now()) {
    return this.#write(['dayInfos', 'audit'], async (tx) => {
      const id = `day:${day}`;
      const before = await get(tx, 'dayInfos', id);
      const rec = before ? touch(before, { ...fields, deleted: false }, now)
        : newRecord({ id, day, dayType: 'arbeit', targetOverrideMin: null, note: '', ...fields }, now);
      await put(tx, 'dayInfos', rec);
      await put(tx, 'audit', auditEntry({ entity: 'dayInfo', before, after: rec, action: before ? 'update' : 'create', reason: '', now }));
    });
  }

  async #saveSimple(storeName, entity, rec, now) {
    return this.#write([storeName, 'audit'], async (tx) => {
      const before = rec.id ? await get(tx, storeName, rec.id) : null;
      if (!before && rec.deleted) throw new ValidationError(['Eintrag nicht gefunden.']);
      const next = before ? touch(before, rec, now) : newRecord(rec, now);
      await put(tx, storeName, next);
      const action = !before ? 'create' : next.deleted ? 'delete' : 'update';
      await put(tx, 'audit', auditEntry({ entity, before, after: next, action, reason: next.reason || '', now }));
      return { changes: [{ store: storeName, before: before || null, after: next }] };
    });
  }

  saveActivity(rec, now = Date.now()) {
    const title = (rec.title || '').trim();
    if (!title) throw new ValidationError(['Bitte eine Bezeichnung eingeben.']);
    if (!Number.isInteger(rec.minutes) || rec.minutes <= 0 || rec.minutes > 1440) {
      throw new ValidationError(['Bitte eine Dauer zwischen 1 Minute und 24 Stunden angeben.']);
    }
    return this.#saveSimple('activities', 'activity', { ...rec, title }, now);
  }

  deleteActivity(id, now = Date.now()) {
    return this.#saveSimple('activities', 'activity', { id, deleted: true }, now);
  }

  saveCorrection(rec, now = Date.now()) {
    if (!(rec.reason || '').trim()) throw new ValidationError(['Eine Korrektur braucht eine Begründung.']);
    if (!Number.isInteger(rec.minutes) || rec.minutes === 0) throw new ValidationError(['Bitte eine Korrektur ungleich 0 angeben.']);
    return this.#saveSimple('corrections', 'correction', { ...rec, reason: rec.reason.trim() }, now);
  }

  deleteCorrection(id, now = Date.now()) {
    return this.#saveSimple('corrections', 'correction', { id, deleted: true }, now);
  }

  /**
   * Einzelne Einstellungen ändern: Lesen und Schreiben in derselben Transaktion, damit schnell
   * aufeinanderfolgende Änderungen sich nicht gegenseitig überschreiben.
   * @param patch Objekt mit den geänderten Feldern oder (aktuelle Einstellungen) => Objekt
   */
  async updateSettings(patch, now = Date.now()) {
    return this.#write(['kv'], async (tx) => {
      const cur = normalizeSettings((await get(tx, 'kv', 'settings'))?.value);
      const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: now };
      await put(tx, 'kv', { key: 'settings', value: next });
      return next;
    });
  }

  async saveSettings(settings, now = Date.now()) {
    return this.#write(['kv'], async (tx) => {
      await put(tx, 'kv', { key: 'settings', value: { ...settings, updatedAt: now } });
    });
  }

  async updateMeta(patch) {
    await transact(this.db, ['kv'], 'readwrite', async (tx) => {
      const m = await get(tx, 'kv', 'meta');
      await put(tx, 'kv', { key: 'meta', value: { ...(m?.value || {}), ...patch } });
    });
    this.onChange();
  }

  // ---------- Import ----------

  /** Ersetzt ALLE Daten atomar durch die Sicherung. Bei einem Fehler bleibt alles unverändert. */
  async importReplace(data, now = Date.now()) {
    await transact(this.db, STORES, 'readwrite', async (tx) => {
      for (const name of COLLECTIONS) {
        await clear(tx, name);
        for (const rec of data[name] || []) await put(tx, name, rec);
      }
      await put(tx, 'kv', { key: 'settings', value: normalizeSettings(data.settings) });
      const m = await get(tx, 'kv', 'meta');
      await put(tx, 'kv', { key: 'meta', value: { ...(m?.value || {}), lastImportAt: now, lastChangeAt: now } });
    });
    this.onChange();
  }

  /** Führt die Sicherung mit den vorhandenen Daten zusammen (neuere Version je Datensatz gewinnt). */
  async importMerge(data, now = Date.now(), { dryRun = false } = {}) {
    const run = async (tx) => {
      const stats = {};
      for (const name of COLLECTIONS) {
        const local = await getAll(tx, name);
        const plan = planMerge(local, data[name] || []);
        stats[name] = plan.stats;
        if (!dryRun) for (const rec of plan.puts) await put(tx, name, rec);
      }
      if (!dryRun) {
        const m = await get(tx, 'kv', 'meta');
        await put(tx, 'kv', { key: 'meta', value: { ...(m?.value || {}), lastImportAt: now, lastChangeAt: now } });
      }
      return stats;
    };
    const stats = await transact(this.db, STORES, dryRun ? 'readonly' : 'readwrite', run);
    if (!dryRun) this.onChange();
    return stats;
  }

  // ---------- Automatische Sicherungskopien (Sicherheitsnetz auf dem Gerät) ----------
  // Vollständige Kopie aller Daten im Schlüsselspeicher „kv“ unter „snapshot:<Zeitpunkt>“ – vor jedem
  // Update, vor jedem Import und einmal täglich. Keine Änderung am Datenbankaufbau; Anzeige, Export und
  // Import lesen diese Schlüssel nicht. Aufbewahrt werden höchstens 5 tägliche und 5 anlassbezogene Kopien.

  /** Legt eine Sicherungskopie an. @returns Schlüssel oder null (keine Daten vorhanden) */
  async saveSnapshot(reason, now = Date.now()) {
    return transact(this.db, STORES, 'readwrite', async (tx) => {
      const data = {};
      for (const name of COLLECTIONS) data[name] = await getAll(tx, name);
      data.settings = (await get(tx, 'kv', 'settings'))?.value || null;
      const records = COLLECTIONS.reduce((s, n) => s + data[n].length, 0);
      if (!records) return null;
      const key = `${SNAPSHOT_PREFIX}${String(now).padStart(15, '0')}-${uuid().slice(0, 8)}`; // eindeutig, auch bei gleicher Zeit
      const counts = Object.fromEntries(COLLECTIONS.map((n) => [n, data[n].filter((r) => !r.deleted).length]));
      await put(tx, 'kv', { key, value: { at: now, reason, appVersion: APP_VERSION, counts, data } });
      const all = (await getAllPrefix(tx, 'kv', SNAPSHOT_PREFIX)).sort((a, b) => b.value.at - a.value.at);
      const daily = all.filter((x) => x.value.reason === 'täglich');
      const events = all.filter((x) => x.value.reason !== 'täglich');
      for (const old of [...daily.slice(SNAPSHOT_KEEP_DAILY), ...events.slice(SNAPSHOT_KEEP_EVENTS)]) await del(tx, 'kv', old.key);
      return key;
    });
  }

  /** Tägliche Kopie, falls die letzte älter als 20 Stunden ist. */
  async dailySnapshot(now = Date.now()) {
    const list = await this.listSnapshots();
    if (list.length && now - list[0].at < 20 * 3600000) return null;
    return this.saveSnapshot('täglich', now);
  }

  /** Übersicht der Sicherungskopien (neueste zuerst), ohne die Daten selbst. */
  async listSnapshots() {
    const all = await transact(this.db, ['kv'], 'readonly', (tx) => getAllPrefix(tx, 'kv', SNAPSHOT_PREFIX));
    return all.map((x) => ({ key: x.key, at: x.value.at, reason: x.value.reason, appVersion: x.value.appVersion, counts: x.value.counts }))
      .sort((a, b) => b.at - a.at);
  }

  async getSnapshot(key) {
    const rec = await transact(this.db, ['kv'], 'readonly', (tx) => get(tx, 'kv', key));
    return rec?.value || null;
  }

  /** Stellt eine Sicherungskopie wieder her; der aktuelle Stand wird vorher selbst gesichert. */
  async restoreSnapshot(key, now = Date.now()) {
    const snap = await this.getSnapshot(key);
    if (!snap) throw new ValidationError(['Diese Sicherungskopie gibt es nicht mehr.']);
    await this.saveSnapshot('vor Wiederherstellen', now);
    await this.importReplace(snap.data, now + 1);
  }

  /** Löscht alle Daten unwiderruflich (Einstellungen werden auf Standard zurückgesetzt). */
  async wipe(now = Date.now()) {
    await transact(this.db, STORES, 'readwrite', async (tx) => {
      for (const name of COLLECTIONS) await clear(tx, name);
      for (const s of await getAllPrefix(tx, 'kv', SNAPSHOT_PREFIX)) await del(tx, 'kv', s.key);
      await put(tx, 'kv', { key: 'settings', value: { ...defaultSettings(todayKey(now)), updatedAt: now } });
      const m = await get(tx, 'kv', 'meta');
      await put(tx, 'kv', { key: 'meta', value: { ...(m?.value || {}), lastChangeAt: now } });
    });
    this.onChange();
  }
}
