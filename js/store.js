// IndexedDB: "jobs" (keyPath id) and "kv" (cv, settings). Falls back to memory if IndexedDB is unavailable.
const DB_NAME = "expat-job-tracker", VERSION = 1;
let dbp = null;
const mem = { jobs: new Map(), kv: new Map() };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then((db) => {
    const val = (r) => (r && typeof r === "object" && "result" in r ? r.result : undefined);
    if (!db) return val(fn(null));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(val(r));
      tx.onerror = () => reject(tx.error);
    });
  });
}

export const persistent = () => open().then((db) => !!db);

export function allJobs() {
  return run("jobs", "readonly", (s) => (s ? s.getAll() : { result: [...mem.jobs.values()] })).then((r) => r || []);
}
export function putJobs(list) {
  return run("jobs", "readwrite", (s) => { list.forEach((j) => (s ? s.put(j) : mem.jobs.set(j.id, j))); });
}
export const putJob = (j) => putJobs([j]);
export function deleteJobs(ids) {
  return run("jobs", "readwrite", (s) => { ids.forEach((id) => (s ? s.delete(id) : mem.jobs.delete(id))); });
}
export function getKV(key) {
  return run("kv", "readonly", (s) => (s ? s.get(key) : { result: mem.kv.get(key) }));
}
export function setKV(key, val) {
  return run("kv", "readwrite", (s) => (s ? s.put(val, key) : mem.kv.set(key, val)));
}
export function wipe() {
  return Promise.all([
    run("jobs", "readwrite", (s) => (s ? s.clear() : mem.jobs.clear())),
    run("kv", "readwrite", (s) => (s ? s.clear() : mem.kv.clear())),
  ]);
}
// Ask the browser not to evict data under storage pressure.
export function requestPersist() { try { navigator.storage?.persist?.(); } catch {} }
