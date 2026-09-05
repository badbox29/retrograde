/**
 * store.js — local record. IndexedDB, offline-first.
 *
 * Entries live here, not in localStorage. localStorage caps around 5 MB,
 * is synchronous, and would fall over the first time someone attaches a
 * photo. It holds nothing but the sync cursor and the active log id.
 *
 * AT-REST ENCRYPTION
 * ------------------
 * Free text is encrypted with an AES-GCM key created by WebCrypto with
 * `extractable: false`, then stored as a live CryptoKey object in IDB.
 * The browser will hand that object back and use it, but no script can
 * read the raw bytes out of it — not ours, not anything that gets injected.
 *
 * Be clear about what that buys: it protects the log from other scripts on
 * the origin and from casual inspection of the profile directory. It does
 * NOT protect against someone using the unlocked device. There is no
 * passphrase on purpose, because a passphrase on a caregiving app means a
 * locked-out sibling at 3am, which is a worse failure than the one it fixes.
 *
 * Indexed fields (occurredAt, kind, pending) stay in the clear so queries
 * still work. Body, whatWorked and fields do not.
 */
const Store = (() => {
  const DB      = 'carelog';
  const VERSION = 1;
  const ENTRIES = 'entries';
  const KV      = 'kv';
  const CK      = 'cryptoKey';

  let _db = null;
  let _dbPromise = null;
  let _key = null;

  // ── plumbing ──────────────────────────────────────────────────────────

  function open() {
    if (_db) return Promise.resolve(_db);
    // Same reasoning as getKey: several callers can arrive before the first
    // open resolves, and each would start its own upgrade.
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(ENTRIES)) {
          const s = db.createObjectStore(ENTRIES, { keyPath: 'id' });
          s.createIndex('occurredAt', 'occurredAt');
          s.createIndex('kind',       'kind');
          s.createIndex('pending',    'pending');
          s.createIndex('parentId',   'parentId');
        }
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => { _dbPromise = null; reject(e.target.error); };
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return open().then(db => db.transaction(store, mode).objectStore(store));
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = e  => reject(e.target.error);
    });
  }

  // ── key/value ─────────────────────────────────────────────────────────

  async function kvGet(k) {
    try { return await wrap((await tx(KV, 'readonly')).get(k)); }
    catch { return null; }
  }

  /**
   * Resolves on transaction COMMIT, not on request success.
   *
   * The difference matters: callers that write a key and then immediately
   * call location.reload() — switching recipients does exactly this — were
   * tearing the page down between the two, so the write silently never
   * landed and the app booted with the old value.
   */
  function kvSet(k, v) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(KV, 'readwrite');
      t.objectStore(KV).put(v, k);
      t.oncomplete = () => resolve(v);
      t.onerror    = e => reject(e.target.error);
      t.onabort    = e => reject(e.target.error);
    }));
  }

  function kvDel(k) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(KV, 'readwrite');
      t.objectStore(KV).delete(k);
      t.oncomplete = () => resolve();
      t.onerror    = e => reject(e.target.error);
    }));
  }

  // ── crypto ────────────────────────────────────────────────────────────

  // Memoised as a PROMISE, not just a value. A batch write calls seal()
  // through Promise.all, so without this every concurrent call sees _key
  // still null, generates its own key, and races to store it. Last write
  // wins and the rest of the batch is encrypted under keys that no longer
  // exist anywhere — silently unreadable forever. Found the hard way.
  let _keyPromise = null;

  function getKey() {
    if (_key) return Promise.resolve(_key);
    if (!_keyPromise) {
      _keyPromise = (async () => {
        let k = await kvGet(CK);
        if (!k) {
          k = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,                     // <- non-extractable, the whole point
            ['encrypt', 'decrypt']
          );
          await kvSet(CK, k);
        }
        _key = k;
        return k;
      })();
    }
    return _keyPromise;
  }

  const te = new TextEncoder();
  const td = new TextDecoder();

  async function seal(obj) {
    const key = await getKey();
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const ct  = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))
    );
    return { iv, ct: new Uint8Array(ct) };
  }

  async function unseal(sealed) {
    if (!sealed?.ct) return {};
    try {
      const key = await getKey();
      const pt  = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv }, key, sealed.ct
      );
      return JSON.parse(td.decode(pt));
    } catch (e) {
      console.warn('[store] could not decrypt an entry', e);
      return { body: null, whatWorked: null, fields: {} };
    }
  }

  // Split an entry into the part that stays readable (so it can be indexed)
  // and the part that gets sealed.
  async function pack(e) {
    const sealed = await seal({
      body:       e.body       ?? null,
      whatWorked: e.whatWorked ?? null,
      fields:     e.fields     ?? {},
    });
    return {
      id:          e.id,
      recipientId: e.recipientId,
      authorId:    e.authorId,
      authorName:  e.authorName,
      kind:        e.kind,
      occurredAt:  e.occurredAt,
      createdAt:   e.createdAt,
      cursor:      e.cursor     ?? null,
      visibility:  e.visibility ?? 'shared',
      supersedes:  e.supersedes ?? null,
      parentId:    e.parentId   ?? null,
      ackFor:      e.ackFor     ?? null,
      deleted:     e.deleted ? 1 : 0,
      pending:     e.pending ? 1 : 0,
      sealed,
    };
  }

  async function unpack(row) {
    if (!row) return null;
    const { sealed, ...rest } = row;
    const text = await unseal(sealed);
    return { ...rest, ...text };
  }

  // ── entries ───────────────────────────────────────────────────────────

  // Both of these resolve on COMMIT for the same reason kvSet does: an
  // entry that is only "requested" is an entry that can vanish if the page
  // goes away, and a care record must not lose a write it acknowledged.
  function commit(rows) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(ENTRIES, 'readwrite');
      const s = t.objectStore(ENTRIES);
      for (const r of rows) s.put(r);
      t.oncomplete = () => resolve(rows.length);
      t.onerror    = e => reject(e.target.error);
      t.onabort    = e => reject(e.target.error);
    }));
  }

  async function putEntry(e) {
    await commit([await pack(e)]);
    return e;
  }

  async function putEntries(list) {
    if (!list?.length) return 0;
    return commit(await Promise.all(list.map(pack)));
  }

  async function getEntry(id) {
    try { return await unpack(await wrap((await tx(ENTRIES, 'readonly')).get(id))); }
    catch { return null; }
  }

  async function allEntries() {
    try {
      const rows = await wrap((await tx(ENTRIES, 'readonly')).getAll());
      return await Promise.all((rows || []).map(unpack));
    } catch (e) {
      console.warn('[store] allEntries', e);
      return [];
    }
  }

  async function pending() {
    try {
      const s    = await tx(ENTRIES, 'readonly');
      const rows = await wrap(s.index('pending').getAll(1));
      return await Promise.all((rows || []).map(unpack));
    } catch { return []; }
  }

  // Server has accepted these. Stamp the authoritative cursor and clear the
  // pending flag so they stop being resent.
  async function markSynced(serverEntries) {
    if (!serverEntries?.length) return;
    const merged = serverEntries.map(e => ({ ...e, pending: 0 }));
    return putEntries(merged);
  }

  async function deleteEntry(id) {
    const s = await tx(ENTRIES, 'readwrite');
    return wrap(s.delete(id));
  }

  async function count() {
    try { return await wrap((await tx(ENTRIES, 'readonly')).count()); }
    catch { return 0; }
  }

  // Wipes the log but keeps the crypto key, so a re-sync can decrypt nothing
  // it doesn't re-download. Used on sign-out.
  async function clearAll() {
    try {
      const s = await tx(ENTRIES, 'readwrite');
      await wrap(s.clear());
      for (const k of ['session', 'recipient', 'recipientId', 'person', 'role', 'workerUrl']) {
        await kvDel(k);
      }
      // Cursors and archive markers are keyed per recipient, so they have
      // to be swept rather than named.
      const kv = await tx(KV, 'readonly');
      const keys = await wrap(kv.getAllKeys());
      for (const k of keys || []) {
        if (typeof k === 'string' && (k.startsWith('cursor:') || k.startsWith('archivesLoaded:'))) {
          await kvDel(k);
        }
      }
    } catch (e) { console.warn('[store] clear', e); }
  }

  async function estimate() {
    if (!navigator.storage?.estimate) return null;
    try { return await navigator.storage.estimate(); } catch { return null; }
  }

  return {
    open, kvGet, kvSet, kvDel,
    putEntry, putEntries, getEntry, allEntries, pending,
    markSynced, deleteEntry, count, clearAll, estimate,
  };
})();
