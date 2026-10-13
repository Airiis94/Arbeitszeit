// Datenzugriff der App. Jede Änderung läuft in genau einer IndexedDB-Transaktion:
// lesen → prüfen → schreiben → Änderungsprotokoll → Metadaten. Schlägt etwas fehl, wird nichts geschrieben.

import { openDb, transact, getAll, get, put, clear, STORES } from './db.js';
import { planClockAction } from '../core/state.js';
import { validateIntervalChange } from '../core/validate.js';
import { planMerge } from '../core/backup-format.js';
import {
  newRecord, touch, uuid, defaultSettings, normalizeSettings, COLLECTIONS,
} from '../core/model.js';
import { todayKey } from '../core/time.js';

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

  async deleteInterval(id, { reason = '', now = Date.now() } = {}) {
    const rec = await transact(this.db, ['intervals'], 'readonly', (tx) => get(tx, 'intervals', id));
    if (!rec || rec.deleted) throw new ValidationError(['Eintrag nicht gefunden.']);
    return this.saveIntervals([touch(rec, { deleted: true }, now)], { reason, now });
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

  /** Löscht alle Daten unwiderruflich (Einstellungen werden auf Standard zurückgesetzt). */
  async wipe(now = Date.now()) {
    await transact(this.db, STORES, 'readwrite', async (tx) => {
      for (const name of COLLECTIONS) await clear(tx, name);
      await put(tx, 'kv', { key: 'settings', value: { ...defaultSettings(todayKey(now)), updatedAt: now } });
      const m = await get(tx, 'kv', 'meta');
      await put(tx, 'kv', { key: 'meta', value: { ...(m?.value || {}), lastChangeAt: now } });
    });
    this.onChange();
  }
}
