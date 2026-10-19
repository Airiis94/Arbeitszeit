// Dünne Promise-Schicht über IndexedDB mit versionierten Migrationen.

export const DB_NAME = 'arbeitszeit';
/** IndexedDB-Schemaversion. Bei Änderungen: Version erhöhen und Migration in MIGRATIONS ergänzen. */
export const DB_VERSION = 1;

export const STORES = ['intervals', 'dayInfos', 'activities', 'corrections', 'audit', 'kv'];

/**
 * MIGRATIONS[v] hebt die Datenbank von Version v-1 auf v. Migrationen laufen innerhalb der
 * versionchange-Transaktion: Bricht eine ab, bleibt die alte Version vollständig erhalten.
 */
const MIGRATIONS = {
  1(db) {
    const iv = db.createObjectStore('intervals', { keyPath: 'id' });
    iv.createIndex('day', 'day');
    db.createObjectStore('dayInfos', { keyPath: 'id' });
    const ac = db.createObjectStore('activities', { keyPath: 'id' });
    ac.createIndex('day', 'day');
    db.createObjectStore('corrections', { keyPath: 'id' });
    const au = db.createObjectStore('audit', { keyPath: 'id' });
    au.createIndex('day', 'day');
    db.createObjectStore('kv', { keyPath: 'key' });
  },
  // 2(db, tx) { … },
};

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

export function describeStorageError(err) {
  const name = err?.name || '';
  if (name === 'QuotaExceededError') {
    return 'Der Speicherplatz des Browsers ist voll. Die letzte Änderung wurde NICHT gespeichert. Bitte Sicherung exportieren und Speicher freigeben.';
  }
  if (name === 'InvalidStateError' || name === 'UnknownError') {
    return 'Die lokale Datenbank ist nicht verfügbar (z. B. privater Modus oder Browser-Fehler). Die Änderung wurde NICHT gespeichert.';
  }
  if (name === 'VersionError') return 'Die gespeicherten Daten stammen aus einer neueren App-Version. Bitte Seite neu laden.';
  return `Speichern fehlgeschlagen: ${err?.message || name || 'unbekannter Fehler'}. Die Änderung wurde NICHT gespeichert.`;
}

function wrap(err) {
  if (err instanceof StorageError) return err;
  if (err && err.name === 'ClockError') return err;
  if (err && (err.name === 'ValidationError')) return err;
  return new StorageError(describeStorageError(err), err);
}

export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDb({ onVersionChange } = {}) {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis) || !globalThis.indexedDB) {
      reject(new StorageError('Dieser Browser stellt keine IndexedDB-Datenbank bereit. Ohne sie kann die App keine Daten speichern.'));
      return;
    }
    let open;
    try {
      open = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(wrap(e));
      return;
    }
    open.onupgradeneeded = (ev) => {
      const db = open.result;
      const tx = open.transaction;
      for (let v = ev.oldVersion + 1; v <= DB_VERSION; v += 1) {
        if (MIGRATIONS[v]) MIGRATIONS[v](db, tx);
      }
    };
    open.onblocked = () => {
      reject(new StorageError('Die Datenbank wird gerade von einem anderen Tab mit älterer Version verwendet. Bitte andere Tabs dieser App schließen und neu laden.'));
    };
    open.onerror = () => reject(wrap(open.error));
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => {
        db.close();
        onVersionChange?.();
      };
      resolve(db);
    };
  });
}

/**
 * Führt `fn(tx)` in einer Transaktion aus. Das Promise erfüllt sich erst, wenn die Transaktion
 * dauerhaft abgeschlossen ist (oncomplete) – bei readwrite mit durability "strict".
 * Wirft `fn`, wird die Transaktion abgebrochen: Es wird dann nichts geschrieben.
 * Innerhalb von `fn` nur IndexedDB-Anfragen awaiten (keine fremden Promises), sonst endet die Transaktion.
 */
export function transact(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = mode === 'readwrite' ? db.transaction(stores, mode, { durability: 'strict' }) : db.transaction(stores, mode);
    } catch (e) {
      reject(wrap(e));
      return;
    }
    let result;
    let failure = null;
    tx.oncomplete = () => (failure ? reject(wrap(failure)) : resolve(result));
    tx.onabort = () => reject(wrap(failure || tx.error || new Error('Transaktion abgebrochen')));
    tx.onerror = (ev) => { failure = failure || ev.target?.error || tx.error; };
    Promise.resolve()
      .then(() => fn(tx))
      .then((r) => { result = r; }, (err) => {
        failure = err;
        try { tx.abort(); } catch { /* bereits beendet */ }
      });
  });
}

export const store = (tx, name) => tx.objectStore(name);
export const getAll = (tx, name) => req(store(tx, name).getAll());
export const get = (tx, name, key) => req(store(tx, name).get(key));
export const put = (tx, name, value) => req(store(tx, name).put(value));
export const clear = (tx, name) => req(store(tx, name).clear());
export const del = (tx, name, key) => req(store(tx, name).delete(key));
/** Alle Einträge, deren Schlüssel mit `prefix` beginnt (Text-Schlüssel). */
export const getAllPrefix = (tx, name, prefix) => req(store(tx, name).getAll(globalThis.IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
