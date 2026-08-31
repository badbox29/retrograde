/**
 * sync.js — writes go local first, always.
 *
 * Tapping a tile must never wait on a network. Every write lands in
 * IndexedDB immediately and is queued; the push happens whenever it can.
 * A phone with one bar in a nursing-home corridor behaves exactly like a
 * phone on wifi, just with a cloud icon that says so.
 *
 * MERGE
 * Entries are immutable, so merging two devices is a set union keyed on
 * id. There is nothing to reconcile because nothing is ever edited in
 * place: an edit is a new entry that supersedes the old one, a delete is
 * a tombstone that supersedes it. Two people writing at once cannot
 * overwrite each other, which is what makes this safe on KV.
 *
 * CURSOR
 * The server cursor is receipt time at whichever edge location took the
 * write, so two entries seconds apart can be stamped by clocks that
 * disagree. We always re-pull the last five minutes and drop ids we
 * already hold. Refetching an immutable entry costs nothing.
 */
const Sync = (() => {

  const OVERLAP  = 5 * 60 * 1000;
  const INTERVAL = 60 * 1000;

  let rid      = null;
  let person   = null;
  let role     = 'family';
  let timer    = null;
  let running  = false;
  let listeners = [];

  const state = { status: 'idle', pending: 0, lastSync: 0, error: null };

  function on(fn) { listeners.push(fn); return () => { listeners = listeners.filter(f => f !== fn); }; }
  function emit()  { for (const f of listeners) { try { f(state); } catch {} } }

  function setStatus(s, error = null) {
    state.status = s;
    state.error  = error;
    emit();
  }

  // ── ids ───────────────────────────────────────────────────────────────

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // ── setup ─────────────────────────────────────────────────────────────

  async function init(recipientId, me, myRole) {
    rid    = recipientId;
    person = me;
    role   = myRole || 'family';
    state.pending = (await Store.pending()).length;
    emit();
    start();
  }

  function start() {
    stop();
    timer = setInterval(() => run(), INTERVAL);
    addEventListener('online',  () => run());
    addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }

  // ── writing ───────────────────────────────────────────────────────────

  /**
   * Create an entry. Returns immediately with the local record; the push
   * is fire-and-forget.
   */
  async function write({ kind, occurredAt, body, fields, whatWorked,
                         visibility, supersedes, parentId, deleted }) {
    const entry = {
      id:          uuid(),
      recipientId: rid,
      authorId:    person?.id || 'local',
      authorName:  person?.displayName || 'You',
      kind,
      occurredAt:  occurredAt ?? Date.now(),
      createdAt:   Date.now(),
      cursor:      null,
      body:        body ?? null,
      fields:      fields ?? {},
      whatWorked:  whatWorked ?? null,
      // A caregiver cannot mark anything family-only. The worker enforces
      // this too; this is only so the UI never offers something that would
      // be silently rewritten.
      visibility:  role === 'caregiver' ? 'shared' : (visibility || 'shared'),
      supersedes:  supersedes ?? null,
      parentId:    parentId   ?? null,
      deleted:     deleted ? 1 : 0,
      pending:     1,
    };

    await Store.putEntry(entry);
    state.pending++;
    emit();
    run();
    return entry;
  }

  /** An edit is a fresh entry pointing back at the old one. */
  async function edit(original, patch) {
    return write({
      kind:       original.kind,
      occurredAt: patch.occurredAt ?? original.occurredAt,
      body:       patch.body       !== undefined ? patch.body       : original.body,
      fields:     patch.fields     !== undefined ? patch.fields     : original.fields,
      whatWorked: patch.whatWorked !== undefined ? patch.whatWorked : original.whatWorked,
      visibility: patch.visibility ?? original.visibility,
      parentId:   original.parentId,
      supersedes: original.id,
    });
  }

  /** A delete is a tombstone. The original stays in the record. */
  async function remove(original) {
    return write({
      kind: original.kind, occurredAt: original.occurredAt,
      supersedes: original.id, deleted: true,
    });
  }

  /** Undo right after logging: if it never left the device, drop it. */
  async function undo(entry) {
    if (entry.pending) {
      await Store.deleteEntry(entry.id);
      state.pending = Math.max(0, state.pending - 1);
      emit();
      return;
    }
    await remove(entry);
  }

  // ── push / pull ───────────────────────────────────────────────────────

  async function push() {
    const queued = await Store.pending();
    if (!queued.length) return 0;

    // The worker caps a batch at 100.
    const batch = queued.slice(0, 100).map(e => ({
      id: e.id, kind: e.kind, occurredAt: e.occurredAt,
      body: e.body, fields: e.fields, whatWorked: e.whatWorked,
      visibility: e.visibility, supersedes: e.supersedes,
      parentId: e.parentId, deleted: e.deleted,
    }));

    const res = await Api.writeEntries(rid, batch);

    // Anything the server skipped was already there from an earlier attempt.
    // Clear its flag so it stops being resent.
    if (res.skipped?.length) {
      const rows = [];
      for (const id of res.skipped) {
        const e = await Store.getEntry(id);
        if (e) rows.push({ ...e, pending: 0 });
      }
      await Store.putEntries(rows);
    }
    await Store.markSynced(res.written || []);

    state.pending = (await Store.pending()).length;
    return (res.written?.length || 0) + (res.skipped?.length || 0);
  }

  async function pull() {
    // Per recipient. A single shared cursor let a switch to one log move
    // the other log's sync position forward, silently skipping entries.
    const ckey  = `cursor:${rid}`;
    const saved = parseInt((await Store.kvGet(ckey)) || '0', 10);
    const from  = saved ? String(Math.max(0, saved - OVERLAP)).padStart(13, '0') : '';

    let since = from;
    let guard = 0;
    let got   = 0;

    // Page until caught up. Guard so a bad cursor can't spin forever.
    while (guard++ < 25) {
      const res = await Api.sync(rid, since);
      const list = res.entries || [];
      if (list.length) {
        await Store.putEntries(list.map(e => ({ ...e, pending: 0 })));
        got += list.length;
      }
      if (res.cursor) {
        const n = parseInt(res.cursor, 10);
        if (Number.isFinite(n) && n > 0) await Store.kvSet(ckey, String(n));
        since = res.cursor;
      }
      if (!res.more) break;
    }
    return got;
  }

  async function run() {
    if (running || !rid || !Api.getSession()) return;
    running = true;
    setStatus('syncing');
    try {
      await push();
      await pull();
      state.lastSync = Date.now();
      setStatus('ok');
    } catch (e) {
      // status 0 means the request never reached anyone — that is offline,
      // not a failure worth shouting about.
      setStatus(e.status === 0 ? 'offline' : 'error', e.status === 0 ? null : e.message);
    } finally {
      running = false;
    }
  }

  /** One-time backfill of sealed months when a device is new. */
  async function loadArchives(onProgress) {
    const { months } = await Api.archives(rid);
    const akey = `archivesLoaded:${rid}`;
    const done = new Set(JSON.parse((await Store.kvGet(akey)) || '[]'));
    let n = 0;
    for (const m of months) {
      if (done.has(m)) continue;
      try {
        const { entries } = await Api.archive(rid, m);
        await Store.putEntries((entries || []).map(e => ({ ...e, pending: 0 })));
        done.add(m);
        n += entries?.length || 0;
        onProgress?.(m, n);
      } catch (e) { console.warn('[sync] archive', m, e); }
    }
    await Store.kvSet(akey, JSON.stringify([...done]));
    return n;
  }

  // ── resolution ────────────────────────────────────────────────────────

  /**
   * Turn the raw append-only pile into what the screen shows.
   *
   * Superseded entries drop out, tombstones take their targets with them,
   * and notes attach to their parent. Because an edit produces a new id,
   * a note written against the original has to follow the chain forward —
   * that is what `newest()` is for.
   */
  async function resolved() {
    // Scoped to the active recipient. One IndexedDB holds every log this
    // device has synced, so without this filter two people being cared for
    // would appear as one interleaved record.
    const all = (await Store.allEntries()).filter(e => e.recipientId === rid);

    const fwd = new Map();
    for (const e of all) if (e.supersedes) fwd.set(e.supersedes, e.id);

    const newest = id => {
      let cur = id, guard = 0;
      while (fwd.has(cur) && guard++ < 60) cur = fwd.get(cur);
      return cur;
    };

    const superseded = new Set(fwd.keys());
    const live = all.filter(e => !superseded.has(e.id) && !e.deleted);

    const roots = [];
    const notes = [];
    for (const e of live) (e.parentId ? notes : roots).push(e);

    const byId = new Map(roots.map(e => [e.id, { ...e, notes: [] }]));
    for (const n of notes) {
      const target = byId.get(newest(n.parentId));
      if (target) target.notes.push(n);
      // Parent hasn't synced yet, or was removed. Show the note on its own
      // rather than lose it — it has to go into the map, not into `roots`,
      // which has already been consumed.
      else byId.set(n.id, { ...n, notes: [] });
    }

    const out = [...byId.values()];
    for (const e of out) e.notes.sort((a, b) => a.occurredAt - b.occurredAt);
    out.sort((a, b) => b.occurredAt - a.occurredAt);
    return out;
  }

  /** Prior "what worked" notes for a kind, pooled across related kinds. */
  async function whatWorked(kind, limit = 3) {
    const pool = new Set(Packs.poolFor(kind));
    const all  = await resolved();
    return all
      .filter(e => pool.has(e.kind) && e.whatWorked && e.whatWorked.trim())
      .slice(0, limit);
  }

  async function allWhatWorked() {
    const all = await resolved();
    return all.filter(e => e.whatWorked && e.whatWorked.trim());
  }

  return {
    init, stop, run, push, pull, write, edit, remove, undo,
    resolved, whatWorked, allWhatWorked, loadArchives, on, state, uuid,
    get role() { return role; },
    set role(r) { role = r; },
  };
})();
