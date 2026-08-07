// storage/db.js
// Thin IndexedDB wrapper. One database, versioned schema, promise-based helpers.
// Object stores map 1:1 to the schema agreed in the architecture review.

const DB_NAME = 'planning-comparator';
// IMPORTANT: bump this any time a new object store (or index) is added to
// the schema below. IndexedDB only re-runs onupgradeneeded when the
// requested version is HIGHER than what's already stored in the browser —
// forgetting to bump this means every store-creation block below still
// exists in code but never actually runs for anyone who already has a
// database, causing "object store was not found" errors at first use.
const DB_VERSION = 7;

let dbInstance = null;

export function openDatabase() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;

      if (!db.objectStoreNames.contains('reports')) {
        const reports = db.createObjectStore('reports', { keyPath: 'id', autoIncrement: true });
        reports.createIndex('factory', 'factory', { unique: false });
        reports.createIndex('printedDate', 'printedDate', { unique: false });
        reports.createIndex('status', 'status', { unique: false });
        reports.createIndex('filename', 'filename', { unique: false });
      }

      if (!db.objectStoreNames.contains('contMrpRecords')) {
        const cm = db.createObjectStore('contMrpRecords', { keyPath: 'id', autoIncrement: true });
        cm.createIndex('reportId', 'reportId', { unique: false });
        cm.createIndex('styleNo', 'styleNo', { unique: false });
        cm.createIndex('detailKey', 'detailKey', { unique: false });
      }

      if (!db.objectStoreNames.contains('styleRecords')) {
        const sr = db.createObjectStore('styleRecords', { keyPath: 'id', autoIncrement: true });
        sr.createIndex('reportId', 'reportId', { unique: false });
        sr.createIndex('styleKey', 'styleKey', { unique: false });
      }

      if (!db.objectStoreNames.contains('comparisons')) {
        const cmp = db.createObjectStore('comparisons', { keyPath: 'id', autoIncrement: true });
        cmp.createIndex('prevReportId', 'prevReportId', { unique: false });
        cmp.createIndex('currReportId', 'currReportId', { unique: false });
        cmp.createIndex('detailKey', 'detailKey', { unique: false });
        cmp.createIndex('styleKey', 'styleKey', { unique: false });
        cmp.createIndex('severity', 'severity', { unique: false });
        cmp.createIndex('level', 'level', { unique: false }); // 'style' | 'contmrp'
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('auditLog')) {
        const audit = db.createObjectStore('auditLog', { keyPath: 'id', autoIncrement: true });
        audit.createIndex('comparisonId', 'comparisonId', { unique: false });
      }

      if (!db.objectStoreNames.contains('seenFiles')) {
        // Tracks filename + size + lastModified so the watcher can dedupe.
        db.createObjectStore('seenFiles', { keyPath: 'filename' });
      }

      if (!db.objectStoreNames.contains('deliveryCorrections')) {
        const dc = db.createObjectStore('deliveryCorrections', { keyPath: 'id', autoIncrement: true });
        dc.createIndex('styleNo', 'styleNo', { unique: false });
      }

      if (!db.objectStoreNames.contains('washTypeMapping')) {
        const wt = db.createObjectStore('washTypeMapping', { keyPath: 'id', autoIncrement: true });
        wt.createIndex('styleNo', 'styleNo', { unique: false });
      }

      if (!db.objectStoreNames.contains('splOpeMapping')) {
        // Special Operations master data: SPL OPE code -> Wash Status.
        // Replaces styleNo-based Wash Type lookup with a code-based one,
        // matched against the SPL OPE value extracted from the PDF.
        const so = db.createObjectStore('splOpeMapping', { keyPath: 'id', autoIncrement: true });
        so.createIndex('splOpeCode', 'splOpeCode', { unique: false });
      }

      if (!db.objectStoreNames.contains('changedStyleHistory')) {
        const csh = db.createObjectStore('changedStyleHistory', { keyPath: 'id', autoIncrement: true });
        csh.createIndex('factory', 'factory', { unique: false });
        csh.createIndex('uid', 'uid', { unique: true }); // cross-machine identity for folder-sync import
        csh.createIndex('reportId', 'reportId', { unique: false });
      }

      if (!db.objectStoreNames.contains('commentHistory')) {
        // Persistent, cross-report comment log — replaces the earlier
        // report-scoped comment field. Matched by Style+Tracking+Line
        // (the existing combined factoryLine value), never by report, so
        // a comment survives regardless of which PDF is currently loaded.
        const ch = db.createObjectStore('commentHistory', { keyPath: 'id', autoIncrement: true });
        ch.createIndex('matchKey', 'matchKey', { unique: false });
        ch.createIndex('uid', 'uid', { unique: true }); // cross-machine identity for folder-sync import
      }
    };

    req.onsuccess = (evt) => {
      dbInstance = evt.target.result;
      resolve(dbInstance);
    };
    req.onerror = (evt) => reject(evt.target.error);
  });
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function dbAdd(storeName, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').add(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function dbPut(storeName, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function dbGet(storeName, key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function dbGetAll(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function dbGetAllByIndex(storeName, indexName, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const idx = tx(db, storeName, 'readonly').index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function dbDelete(storeName, key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function dbClearStore(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function dbClearAll() {
  const db = await openDatabase();
  // Deliberately excludes 'deliveryCorrections', 'washTypeMapping',
  // 'splOpeMapping', 'changedStyleHistory', and 'commentHistory' — those
  // are manually curated/saved datasets the user builds up over time, not
  // ingested report data, so a general reset shouldn't wipe them out.
  const names = ['reports', 'contMrpRecords', 'styleRecords', 'comparisons', 'auditLog', 'seenFiles'];
  await Promise.all(names.map((name) => new Promise((resolve, reject) => {
    const req = tx(db, name, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  })));
}
