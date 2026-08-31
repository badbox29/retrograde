/**
 * ============================================================
 * worker.js — Caregiver Journal sync worker
 * ============================================================
 *
 * KV-backed, append-only care log. Entries are WRITE-ONCE: an edit is a
 * new entry pointing at the old one, a delete is a tombstone. Nothing is
 * ever overwritten, so two caregivers writing at the same moment cannot
 * clobber each other. That property is the whole reason this is safe on
 * KV despite last-write-wins semantics.
 *
 * ── SETUP ────────────────────────────────────────────────────
 *
 * 1. KV NAMESPACE — create one, bind it as: CARELOG
 *
 * 2. VARS (Settings → Variables):
 *      ALLOWED_ORIGINS   https://you.github.io,http://localhost:8788
 *      GOOGLE_CLIENT_ID  xxxx.apps.googleusercontent.com   (optional)
 *
 * 3. SECRETS (encrypt these, don't use plain vars):
 *      BOOTSTRAP_TOKEN   a long random string, used ONCE to create the
 *                        first owner account. Rotate or delete after.
 *
 * 4. CRON (optional, Settings → Trigger Events): "0 4 1 * *"
 *      Seals last month's loose entry keys into one archive key.
 *      Can also be run by hand: POST /r/:rid/seal
 *
 * ── KEY LAYOUT ───────────────────────────────────────────────
 *
 *   p:<personId>                  person record
 *   c:<provider>:<subject>        → personId  (credential → person)
 *   pr:<personId>                 → [recipientId, ...]  (reverse index)
 *   s:<sessionId>                 session        (TTL)
 *   i:<inviteToken>               invite         (TTL)
 *   sh:<shareId>                  share snapshot (TTL)
 *
 *   r:<rid>:meta                  recipient record
 *   r:<rid>:m:<personId>          membership { role, status }
 *   r:<rid>:e:<ts13>:<uuid>       entry — WRITE ONCE
 *   r:<rid>:eid:<uuid>            → full entry key (idempotency index)
 *   r:<rid>:arch:<YYYY-MM>        sealed month, array of entries
 *
 * ts13 is SERVER RECEIPT time, zero-padded to 13 digits so lexicographic
 * key order is chronological. It is a sync cursor, not a timestamp anyone
 * displays — `occurredAt` lives inside the value and is what the UI shows.
 *
 * ── ROLES ────────────────────────────────────────────────────
 *   owner      — everything, plus invites and member management
 *   family     — read/write all entries including visibility:'family'
 *   caregiver  — read/write visibility:'shared' only. Family-only entries
 *                are filtered server-side and leave NO trace: no count,
 *                no placeholder, no gap. Absence must be indistinguishable
 *                from nothing existing.
 * ============================================================
 */

const KV_BINDING = 'CARELOG';

const SESSION_TTL     = 60 * 60 * 24 * 180;  // 180d — no 3am re-auth walls
const INVITE_TTL      = 60 * 60 * 24 * 14;   // 14d
const SHARE_TTL       = 60 * 60 * 24 * 30;   // 30d
const AUTH_RATE_LIMIT = 30;                  // auth attempts per IP per window
const AUTH_RATE_WIN   = 60 * 15;             // 15 min
const WRITE_RATE_LIMIT= 300;                 // entry writes per session per window
const WRITE_RATE_WIN  = 60 * 5;
const MAX_BODY        = 512 * 1024;
const MAX_ENTRY_TEXT  = 8000;
const MAX_FIELDS_JSON = 8000;
const SYNC_PAGE       = 400;                 // keys per sync page (subrequest budget)
const SEAL_PAGE       = 350;                 // entries sealed per invocation

const ROLES       = ['owner', 'family', 'caregiver'];
const VISIBILITIES= ['shared', 'family'];

// ── Response helpers ───────────────────────────────────────────────────────

function respond(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function err(msg, status, cors, extra = {}) {
  return respond(JSON.stringify({ error: msg }), status, { ...cors, ...extra });
}

function ok(obj, cors, extra = {}) {
  return respond(JSON.stringify(obj), 200, { ...cors, ...extra });
}

function buildCors(origin) {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin':      origin,
    'Access-Control-Allow-Methods':     'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age':           '86400',
    'Vary':                             'Origin',
  };
}

function getAllowedOrigin(request, env) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

// ── Id generation ──────────────────────────────────────────────────────────

function randomId(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 13-digit zero-padded ms timestamp. Lexicographic order == chronological
// order, which is what makes `list({ start })` a usable sync cursor.
function ts13(ms = Date.now()) {
  return String(ms).padStart(13, '0');
}

function isId(s, min = 8, max = 128) {
  return typeof s === 'string' && new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`).test(s);
}

// ── Rate limiting ──────────────────────────────────────────────────────────

async function rateLimit(env, bucket, limit, windowSecs) {
  const kv    = env[KV_BINDING];
  const key   = `rl:${bucket}`;
  const raw   = await kv.get(key, { type: 'text' });
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return false;
  await kv.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSecs) });
  return true;
}

// ── Google JWT (RS256) ─────────────────────────────────────────────────────
// Same verification as the Refectory worker — full signature check against
// JWKS, plus aud/iss/exp. The one change is caching the cert fetch: the
// previous version hit Google's endpoint on every single verify.

let _jwksCache = { keys: null, fetchedAt: 0 };

async function getJwks() {
  const now = Date.now();
  if (_jwksCache.keys && now - _jwksCache.fetchedAt < 60 * 60 * 1000) {
    return _jwksCache.keys;
  }
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) return _jwksCache.keys;  // serve stale rather than fail
  const jwks = await res.json();
  _jwksCache = { keys: jwks.keys || [], fetchedAt: now };
  return _jwksCache.keys;
}

function b64urlJson(part) {
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
}

async function verifyGoogleJWT(idToken, clientId) {
  if (!clientId || typeof idToken !== 'string') return null;
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    const header  = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    const now     = Math.floor(Date.now() / 1000);

    if (!payload.exp || payload.exp < now)  return null;
    if (payload.aud !== clientId)           return null;
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return null;
    if (!payload.sub)                       return null;

    const keys = await getJwks();
    const jwk  = keys?.find(k => k.kid === header.kid);
    if (!jwk) return null;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, signingInput);
    if (!valid) return null;

    return {
      sub:     payload.sub,
      email:   payload.email   || null,
      name:    payload.name    || null,
      picture: payload.picture || null,
    };
  } catch (e) {
    console.error('[auth] verifyGoogleJWT:', e);
    return null;
  }
}

// ── Sessions ───────────────────────────────────────────────────────────────
// Opaque 256-bit tokens, NOT Google ID tokens. A Google idToken expires in
// about an hour; using it as the session credential is what forced the
// re-auth screen in Refectory. Exchange it once, here, for one of these.

async function createSession(env, personId, request) {
  const id = randomId(32);
  await env[KV_BINDING].put(`s:${id}`, JSON.stringify({
    personId,
    createdAt: Date.now(),
    userAgent: (request.headers.get('User-Agent') || '').slice(0, 200),
  }), { expirationTtl: SESSION_TTL });
  return id;
}

async function resolveSession(request, env) {
  const hdr = request.headers.get('Authorization') || '';
  const sid = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (!isId(sid, 16, 128)) return null;

  const raw = await env[KV_BINDING].get(`s:${sid}`, { type: 'json' });
  if (!raw?.personId) return null;

  const person = await env[KV_BINDING].get(`p:${raw.personId}`, { type: 'json' });
  if (!person || person.active === false) return null;

  return { sessionId: sid, personId: raw.personId, person };
}

// ── Membership / authorization ─────────────────────────────────────────────

async function getMembership(env, rid, personId) {
  const m = await env[KV_BINDING].get(`r:${rid}:m:${personId}`, { type: 'json' });
  if (!m || m.status !== 'active') return null;
  return m;
}

// Every recipient-scoped route goes through this. Role checks live here and
// nowhere else — do not re-derive them inside handlers.
async function requireAccess(request, env, rid, cors, minRole = null) {
  const sess = await resolveSession(request, env);
  if (!sess) return { ok: false, res: err('Sign in required', 401, cors) };

  const m = await getMembership(env, rid, sess.personId);
  if (!m) return { ok: false, res: err('No access to this log', 403, cors) };

  if (minRole === 'owner' && m.role !== 'owner') {
    return { ok: false, res: err('Only the owner can do that', 403, cors) };
  }
  if (minRole === 'family' && m.role === 'caregiver') {
    return { ok: false, res: err('Not permitted', 403, cors) };
  }

  return { ok: true, sess, role: m.role, membership: m };
}

// The single place visibility is enforced. A caregiver never receives a
// family-only entry, and receives no indication that one exists.
function visibleTo(role, entry) {
  if (entry.visibility === 'family') return role !== 'caregiver';
  return true;
}

// ── Person / recipient index helpers ───────────────────────────────────────

async function addRecipientToPerson(env, personId, rid) {
  const key  = `pr:${personId}`;
  const list = (await env[KV_BINDING].get(key, { type: 'json' })) || [];
  if (!list.includes(rid)) {
    list.push(rid);
    await env[KV_BINDING].put(key, JSON.stringify(list));
  }
}

async function createPerson(env, displayName, profile = {}) {
  const id = randomId(16);
  const person = {
    id,
    displayName: String(displayName || 'Someone').slice(0, 80),
    email:       profile.email   || null,
    avatarUrl:   profile.picture || null,
    createdAt:   Date.now(),
    active:      true,
  };
  await env[KV_BINDING].put(`p:${id}`, JSON.stringify(person));
  return person;
}

// ── Auth routes ────────────────────────────────────────────────────────────

async function handleAuth(url, method, request, env, cors, ip) {
  const kv   = env[KV_BINDING];
  const path = url.pathname;

  // GET /auth/config — client never hardcodes the Google client id
  if (path === '/auth/config' && method === 'GET') {
    return ok({
      googleClientId: env.GOOGLE_CLIENT_ID || '',
      googleEnabled:  !!env.GOOGLE_CLIENT_ID,
    }, cors);
  }

  if (!(await rateLimit(env, `ip:${ip}`, AUTH_RATE_LIMIT, AUTH_RATE_WIN))) {
    return err('Too many attempts — try again in a few minutes', 429, cors,
      { 'Retry-After': String(AUTH_RATE_WIN) });
  }

  // ── POST /auth/bootstrap ────────────────────────────────────
  // One-time: creates the first owner + their first recipient. Requires the
  // BOOTSTRAP_TOKEN secret. Everyone after this joins by invite.
  if (path === '/auth/bootstrap' && method === 'POST') {
    if (!env.BOOTSTRAP_TOKEN) return err('Bootstrap not configured', 403, cors);
    const body = await readJson(request);
    if (!body) return err('Invalid body', 400, cors);
    if (body.bootstrapToken !== env.BOOTSTRAP_TOKEN) {
      return err('Invalid bootstrap token', 403, cors);
    }
    if (!body.displayName || !body.recipientName) {
      return err('displayName and recipientName required', 400, cors);
    }

    const person = await createPerson(env, body.displayName);
    const rid    = randomId(12);
    const now    = Date.now();

    await kv.put(`r:${rid}:meta`, JSON.stringify({
      id:          rid,
      displayName: String(body.recipientName).slice(0, 80),
      timezone:    body.timezone || 'UTC',
      packs:       [],
      tiles:       [],
      createdAt:   now,
      createdBy:   person.id,
    }));
    await kv.put(`r:${rid}:m:${person.id}`, JSON.stringify({
      personId: person.id, recipientId: rid, role: 'owner',
      status: 'active', createdAt: now,
    }));
    await addRecipientToPerson(env, person.id, rid);

    const sid = await createSession(env, person.id, request);
    return ok({ sessionId: sid, person, recipientId: rid }, cors);
  }

  // ── POST /auth/invite/redeem ────────────────────────────────
  // The entire onboarding flow. Tap link, type your name, you're in.
  if (path === '/auth/invite/redeem' && method === 'POST') {
    const body = await readJson(request);
    if (!body?.inviteToken || !body?.displayName) {
      return err('inviteToken and displayName required', 400, cors);
    }
    if (!isId(body.inviteToken, 16, 128)) return err('Invalid invite', 400, cors);

    const invite = await kv.get(`i:${body.inviteToken}`, { type: 'json' });
    if (!invite)             return err('This invite has expired or was already used', 404, cors);
    if (invite.redeemedAt)   return err('This invite has already been used', 409, cors);

    const person = await createPerson(env, body.displayName);
    const now    = Date.now();

    await kv.put(`r:${invite.recipientId}:m:${person.id}`, JSON.stringify({
      personId:    person.id,
      recipientId: invite.recipientId,
      role:        invite.role,
      status:      'active',
      invitedBy:   invite.createdBy,
      createdAt:   now,
    }));
    await addRecipientToPerson(env, person.id, invite.recipientId);

    // Single-use. Keep the record briefly so the owner can see it landed.
    await kv.put(`i:${body.inviteToken}`, JSON.stringify({
      ...invite, redeemedAt: now, redeemedBy: person.id,
    }), { expirationTtl: 60 * 60 * 24 * 7 });

    const sid = await createSession(env, person.id, request);
    return ok({ sessionId: sid, person, recipientId: invite.recipientId }, cors);
  }

  // ── POST /auth/google — sign in with an existing linked account ─────
  if (path === '/auth/google' && method === 'POST') {
    const body = await readJson(request);
    if (!body?.idToken) return err('idToken required', 400, cors);

    const p = await verifyGoogleJWT(body.idToken, env.GOOGLE_CLIENT_ID);
    if (!p) return err('Invalid or expired Google token', 401, cors);

    // Keyed on `sub`, never email. Email changes; sub does not.
    const personId = await kv.get(`c:google:${p.sub}`, { type: 'text' });
    if (!personId) {
      return err('No account is linked to this Google login. Ask for an invite link.', 404, cors);
    }

    const person = await kv.get(`p:${personId}`, { type: 'json' });
    if (!person || person.active === false) return err('Account is inactive', 403, cors);

    // Refresh display metadata opportunistically.
    if (p.picture && p.picture !== person.avatarUrl) {
      person.avatarUrl = p.picture;
      person.email     = p.email || person.email;
      await kv.put(`p:${personId}`, JSON.stringify(person));
    }

    const sid = await createSession(env, personId, request);
    return ok({ sessionId: sid, person }, cors);
  }

  // ── POST /auth/google/link — attach Google to the CURRENT person ────
  // This is the whole upgrade path. One credential row. Nothing is copied,
  // nothing is migrated, no entries move, because entries were always
  // attributed to person.id and never to a credential.
  if (path === '/auth/google/link' && method === 'POST') {
    const sess = await resolveSession(request, env);
    if (!sess) return err('Sign in required', 401, cors);

    const body = await readJson(request);
    if (!body?.idToken) return err('idToken required', 400, cors);

    const p = await verifyGoogleJWT(body.idToken, env.GOOGLE_CLIENT_ID);
    if (!p) return err('Invalid or expired Google token', 401, cors);

    const existing = await kv.get(`c:google:${p.sub}`, { type: 'text' });
    if (existing && existing !== sess.personId) {
      return err('That Google account is already linked to someone else', 409, cors);
    }

    await kv.put(`c:google:${p.sub}`, sess.personId);

    const person = sess.person;
    person.email     = p.email   || person.email;
    person.avatarUrl = p.picture || person.avatarUrl;
    person.googleSub = p.sub;
    await kv.put(`p:${sess.personId}`, JSON.stringify(person));

    return ok({ ok: true, person }, cors);
  }

  // ── POST /auth/signout ──────────────────────────────────────
  if (path === '/auth/signout' && method === 'POST') {
    const hdr = request.headers.get('Authorization') || '';
    const sid = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
    if (isId(sid, 16, 128)) await kv.delete(`s:${sid}`);
    return ok({ ok: true }, cors);
  }

  // ── GET /auth/me — session + every log this person can see ──
  if (path === '/auth/me' && method === 'GET') {
    const sess = await resolveSession(request, env);
    if (!sess) return err('Not signed in', 401, cors);

    const rids = (await kv.get(`pr:${sess.personId}`, { type: 'json' })) || [];
    const recipients = [];
    for (const rid of rids) {
      const m = await getMembership(env, rid, sess.personId);
      if (!m) continue;
      const meta = await kv.get(`r:${rid}:meta`, { type: 'json' });
      if (meta) recipients.push({ ...meta, role: m.role });
    }

    return ok({
      person:     sess.person,
      recipients,
      hasGoogle:  !!sess.person.googleSub,
    }, cors);
  }

  return null;
}

// ── Entry writes ───────────────────────────────────────────────────────────

function validateEntry(e) {
  if (!e || typeof e !== 'object')                 return 'entry must be an object';
  if (!isId(e.id, 8, 64))                          return 'entry id must be a client-generated uuid';
  if (typeof e.kind !== 'string' || !e.kind || e.kind.length > 40) return 'invalid kind';
  if (!Number.isFinite(e.occurredAt))              return 'occurredAt must be a timestamp';
  if (e.body != null && (typeof e.body !== 'string' || e.body.length > MAX_ENTRY_TEXT))
    return 'body too long';
  if (e.whatWorked != null && (typeof e.whatWorked !== 'string' || e.whatWorked.length > MAX_ENTRY_TEXT))
    return 'whatWorked too long';
  if (e.visibility != null && !VISIBILITIES.includes(e.visibility))
    return 'invalid visibility';
  if (e.fields != null) {
    if (typeof e.fields !== 'object') return 'fields must be an object';
    if (JSON.stringify(e.fields).length > MAX_FIELDS_JSON) return 'fields too large';
  }
  if (e.supersedes != null && !isId(e.supersedes, 8, 64)) return 'invalid supersedes';
  if (e.parentId   != null && !isId(e.parentId,   8, 64)) return 'invalid parentId';
  return null;
}

// POST /r/:rid/entries   body: { entries: [...] }
//
// Write-once. Retries are idempotent via the r:<rid>:eid:<uuid> index, so a
// flaky connection on a phone in a nursing home can resend the whole batch
// safely.
async function handleWriteEntries(request, env, rid, cors, access) {
  const kv = env[KV_BINDING];

  if (!(await rateLimit(env, `w:${access.sess.sessionId}`, WRITE_RATE_LIMIT, WRITE_RATE_WIN))) {
    return err('Too many writes — slow down', 429, cors);
  }

  const body = await readJson(request);
  const list = body?.entries;
  if (!Array.isArray(list) || list.length === 0) return err('entries[] required', 400, cors);
  if (list.length > 100) return err('Too many entries in one batch (max 100)', 400, cors);

  const written = [];
  const skipped = [];

  for (const raw of list) {
    const problem = validateEntry(raw);
    if (problem) return err(`Entry ${raw?.id || '?'}: ${problem}`, 400, cors);

    // A caregiver cannot create a family-only entry, whatever the client sends.
    const visibility = access.role === 'caregiver'
      ? 'shared'
      : (raw.visibility || 'shared');

    const idxKey   = `r:${rid}:eid:${raw.id}`;
    const existing = await kv.get(idxKey, { type: 'text' });
    if (existing) { skipped.push(raw.id); continue; }

    const cursor   = ts13();
    const entryKey = `r:${rid}:e:${cursor}:${raw.id}`;

    const entry = {
      id:          raw.id,
      recipientId: rid,
      authorId:    access.sess.personId,
      authorName:  access.sess.person.displayName,
      kind:        raw.kind,
      occurredAt:  raw.occurredAt,
      createdAt:   Date.now(),
      cursor,
      body:        raw.body       ?? null,
      fields:      raw.fields     ?? {},
      whatWorked:  raw.whatWorked ?? null,
      visibility,
      supersedes:  raw.supersedes ?? null,
      parentId:    raw.parentId   ?? null,
      deleted:     raw.deleted ? 1 : 0,
    };

    await kv.put(entryKey, JSON.stringify(entry));
    await kv.put(idxKey, entryKey);
    written.push(entry);
  }

  return ok({ written, skipped, cursor: ts13() }, cors);
}

// ── Sync ───────────────────────────────────────────────────────────────────
//
// GET /r/:rid/sync?since=<cursor>
//
// Clients should pull from (lastCursor - 5 minutes) and drop ids they
// already hold. That overlap absorbs both clock skew between the edge
// locations that assigned the cursors and KV's list consistency lag.
// Entries are immutable, so refetching one costs nothing.
async function handleSync(request, env, rid, cors, access) {
  const url   = new URL(request.url);
  const since = url.searchParams.get('since') || '';
  const start = /^\d{13}$/.test(since)
    ? `r:${rid}:e:${since}`
    : `r:${rid}:e:`;

  const listed = await env[KV_BINDING].list({
    prefix: `r:${rid}:e:`,
    start,
    limit:  SYNC_PAGE,
  });

  const entries = [];
  for (const k of listed.keys) {
    const v = await env[KV_BINDING].get(k.name, { type: 'json' });
    if (!v) continue;
    if (!visibleTo(access.role, v)) continue;   // silent, no placeholder
    entries.push(v);
  }

  const lastKey = listed.keys.length ? listed.keys[listed.keys.length - 1].name : null;
  const cursor  = lastKey ? lastKey.split(':')[3] : since;

  return ok({
    entries,
    cursor,
    more: !listed.list_complete,
  }, cors);
}

// GET /r/:rid/archives — list sealed months
async function handleListArchives(env, rid, cors) {
  const listed = await env[KV_BINDING].list({ prefix: `r:${rid}:arch:` });
  return ok({
    months: listed.keys.map(k => k.name.slice(`r:${rid}:arch:`.length)).sort(),
  }, cors);
}

// GET /r/:rid/archive/:month — one sealed month
async function handleGetArchive(env, rid, month, cors, access) {
  if (!/^\d{4}-\d{2}$/.test(month)) return err('Bad month', 400, cors);
  const arr = await env[KV_BINDING].get(`r:${rid}:arch:${month}`, { type: 'json' });
  if (!arr) return err('Not found', 404, cors);
  return ok({ month, entries: arr.filter(e => visibleTo(access.role, e)) }, cors);
}

// ── Archive sealing ────────────────────────────────────────────────────────
//
// A closed month can never receive new entries, so it folds into a single
// key. This is what keeps a fresh device from making 5,000 subrequests to
// pull a year of history. Idempotent and resumable: re-run until complete.
async function sealMonth(env, rid, month) {
  const kv     = env[KV_BINDING];
  const prefix = `r:${rid}:e:`;

  const startMs = Date.parse(`${month}-01T00:00:00Z`);
  const [y, m]  = month.split('-').map(Number);
  const endMs   = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);

  const listed = await kv.list({
    prefix,
    start: `${prefix}${ts13(startMs)}`,
    limit: SEAL_PAGE,
  });

  const inMonth = listed.keys.filter(k => {
    const cur = k.name.slice(prefix.length).split(':')[0];
    const ms  = parseInt(cur, 10);
    return ms >= startMs && ms < endMs;
  });

  if (!inMonth.length) return { month, sealed: 0, complete: true };

  const existing = (await kv.get(`r:${rid}:arch:${month}`, { type: 'json' })) || [];
  const byId     = new Map(existing.map(e => [e.id, e]));

  for (const k of inMonth) {
    const v = await kv.get(k.name, { type: 'json' });
    if (v) byId.set(v.id, v);
  }

  const merged = [...byId.values()].sort((a, b) => a.cursor.localeCompare(b.cursor));
  await kv.put(`r:${rid}:arch:${month}`, JSON.stringify(merged));

  // Only after the archive write lands.
  for (const k of inMonth) await kv.delete(k.name);

  const complete = inMonth.length < SEAL_PAGE;
  return { month, sealed: inMonth.length, total: merged.length, complete };
}

function lastMonthKey(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();  // 0-based
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Members and invites ────────────────────────────────────────────────────

async function handleListMembers(env, rid, cors) {
  const listed  = await env[KV_BINDING].list({ prefix: `r:${rid}:m:` });
  const members = [];
  for (const k of listed.keys) {
    const m = await env[KV_BINDING].get(k.name, { type: 'json' });
    if (!m) continue;
    const p = await env[KV_BINDING].get(`p:${m.personId}`, { type: 'json' });
    members.push({
      personId:    m.personId,
      displayName: p?.displayName || 'Unknown',
      avatarUrl:   p?.avatarUrl   || null,
      role:        m.role,
      status:      m.status,
      createdAt:   m.createdAt,
    });
  }
  return ok({ members }, cors);
}

async function handleCreateInvite(request, env, rid, cors, access) {
  const body = await readJson(request);
  const role = body?.role;
  if (!ROLES.includes(role)) return err('role must be owner, family, or caregiver', 400, cors);

  const token  = randomId(24);
  const invite = {
    token,
    recipientId: rid,
    role,
    label:       (body.label || '').slice(0, 80),
    createdBy:   access.sess.personId,
    createdAt:   Date.now(),
    expiresAt:   Date.now() + INVITE_TTL * 1000,
  };
  await env[KV_BINDING].put(`i:${token}`, JSON.stringify(invite), { expirationTtl: INVITE_TTL });

  return ok({ invite }, cors);
}

// Revoke, never delete. Their shift notes stay in the record, attributed to
// them. Reinstating is flipping status back.
async function handleRevokeMember(env, rid, personId, cors, access) {
  if (personId === access.sess.personId) {
    return err('You cannot revoke your own access', 400, cors);
  }
  const key = `r:${rid}:m:${personId}`;
  const m   = await env[KV_BINDING].get(key, { type: 'json' });
  if (!m) return err('Not a member', 404, cors);

  m.status    = 'revoked';
  m.revokedAt = Date.now();
  await env[KV_BINDING].put(key, JSON.stringify(m));

  return ok({ ok: true }, cors);
}

// ── Recipient settings ─────────────────────────────────────────────────────

async function handleUpdateRecipient(request, env, rid, cors) {
  const body = await readJson(request);
  if (!body) return err('Invalid body', 400, cors);

  const meta = await env[KV_BINDING].get(`r:${rid}:meta`, { type: 'json' });
  if (!meta) return err('Not found', 404, cors);

  if (body.displayName) meta.displayName = String(body.displayName).slice(0, 80);
  if (body.timezone)    meta.timezone    = String(body.timezone).slice(0, 64);
  if (Array.isArray(body.packs)) meta.packs = body.packs.slice(0, 40);
  if (Array.isArray(body.tiles)) meta.tiles = body.tiles.slice(0, 60);
  meta.updatedAt = Date.now();

  await env[KV_BINDING].put(`r:${rid}:meta`, JSON.stringify(meta));
  return ok({ recipient: meta }, cors);
}

// ── Share snapshots ────────────────────────────────────────────────────────
//
// The client posts an ALREADY-RENDERED range. Reconstructing it server-side
// would mean hundreds of KV reads per page view, and a snapshot is what you
// want anyway when handing something to a doctor: it doesn't shift under
// them between visits.

async function handleCreateShare(request, env, rid, cors, access) {
  const body = await readJson(request);
  if (!body?.days || !Array.isArray(body.days)) return err('days[] required', 400, cors);

  const id  = randomId(9);
  const doc = {
    id,
    recipientId: rid,
    title:       String(body.title    || 'Care log').slice(0, 120),
    subtitle:    String(body.subtitle || '').slice(0, 200),
    // Belt and braces: family-only content should never have been sent, but
    // a share link is exactly the wrong place to trust the client.
    days:        body.days.slice(0, 200).map(d => ({
      date:  String(d.date || '').slice(0, 40),
      items: (d.items || []).slice(0, 200).map(i => ({
        time: String(i.time || '').slice(0, 20),
        kind: String(i.kind || '').slice(0, 40),
        text: String(i.text || '').slice(0, 2000),
      })),
    })),
    createdBy: access.sess.personId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SHARE_TTL * 1000,
  };

  await env[KV_BINDING].put(`sh:${id}`, JSON.stringify(doc), { expirationTtl: SHARE_TTL });
  return ok({ id, url: `${new URL(request.url).origin}/share/${id}` }, cors);
}

function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function sharePage(doc) {
  if (!doc) {
    return `<!doctype html><meta charset="utf-8"><title>Link expired</title>
<style>body{font:16px/1.6 system-ui;margin:4rem auto;max-width:32rem;padding:0 1rem;color:#333}</style>
<h1>This link has expired</h1><p>Ask whoever shared it for a new one.</p>`;
  }

  const days = doc.days.map(d => `
    <section class="day">
      <h2>${escHtml(d.date)}</h2>
      ${d.items.map(i => `
        <div class="item">
          <span class="t">${escHtml(i.time)}</span>
          <span class="k">${escHtml(i.kind)}</span>
          <span class="x">${escHtml(i.text)}</span>
        </div>`).join('')}
    </section>`).join('');

  return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escHtml(doc.title)}</title>
<style>
  :root { --ink:#1a1a1a; --mute:#666; --rule:#e2e2e2; }
  body { font:16px/1.55 system-ui,-apple-system,sans-serif; color:var(--ink);
         max-width:44rem; margin:2.5rem auto; padding:0 1.25rem; }
  h1 { font-size:1.5rem; margin:0 0 .25rem; }
  .sub { color:var(--mute); margin:0 0 2rem; }
  .day { margin-bottom:1.75rem; break-inside:avoid; }
  .day h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em;
            color:var(--mute); border-bottom:1px solid var(--rule);
            padding-bottom:.35rem; margin:0 0 .6rem; }
  .item { display:grid; grid-template-columns:4.5rem 7rem 1fr; gap:.6rem;
          padding:.3rem 0; align-items:baseline; }
  .t { color:var(--mute); font-variant-numeric:tabular-nums; font-size:.875rem; }
  .k { font-weight:600; font-size:.875rem; }
  .x { white-space:pre-wrap; }
  footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--rule);
           color:var(--mute); font-size:.8rem; }
  @media print {
    body { margin:0; max-width:none; font-size:11pt; }
    .day { page-break-inside:avoid; }
    footer { position:fixed; bottom:0; }
  }
  @media (max-width:36rem) { .item { grid-template-columns:4rem 1fr; }
    .k { grid-column:2; } .x { grid-column:1/-1; } }
</style>
<h1>${escHtml(doc.title)}</h1>
<p class="sub">${escHtml(doc.subtitle)}</p>
${days}
<footer>Shared care log. This link expires automatically.</footer>
</html>`;
}

async function handleSharePage(id, env) {
  const html = (h, status = 200) => new Response(h, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });

  if (!isId(id, 8, 32)) return html(sharePage(null), 404);
  const doc = await env[KV_BINDING].get(`sh:${id}`, { type: 'json' });
  if (!doc) return html(sharePage(null), 404);
  return html(sharePage(doc));
}

// ── Body reading ───────────────────────────────────────────────────────────

async function readJson(request) {
  try {
    const len = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (len > MAX_BODY) return null;
    const text = await request.text();
    if (text.length > MAX_BODY) return null;
    return JSON.parse(text);
  } catch { return null; }
}

// ── Router ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method;
    const origin = getAllowedOrigin(request, env);
    const cors   = buildCors(origin);
    const ip     = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Health check — auth.js's testWorkerUrl() hits this
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/ping')) {
      return ok({ ok: true, service: 'carelog', time: Date.now() }, cors);
    }

    // Public share pages: no CORS, no auth, own HTML response
    if (method === 'GET' && url.pathname.startsWith('/share/')) {
      try { return await handleSharePage(url.pathname.slice('/share/'.length), env); }
      catch (e) { console.error('[share]', e); return new Response('Error', { status: 500 }); }
    }

    if (!env[KV_BINDING]) return err('KV namespace not bound', 500, cors);

    try {
      // ── /auth/* ──────────────────────────────────────────────
      if (url.pathname.startsWith('/auth/')) {
        const res = await handleAuth(url, method, request, env, cors, ip);
        if (res) return res;
        return err('Not found', 404, cors);
      }

      // ── POST /recipients — add another person to care for ────
      if (url.pathname === '/recipients' && method === 'POST') {
        const sess = await resolveSession(request, env);
        if (!sess) return err('Sign in required', 401, cors);

        const body = await readJson(request);
        if (!body?.displayName) return err('displayName required', 400, cors);

        const rid = randomId(12);
        const now = Date.now();
        await env[KV_BINDING].put(`r:${rid}:meta`, JSON.stringify({
          id: rid, displayName: String(body.displayName).slice(0, 80),
          timezone: body.timezone || 'UTC', packs: [], tiles: [],
          createdAt: now, createdBy: sess.personId,
        }));
        await env[KV_BINDING].put(`r:${rid}:m:${sess.personId}`, JSON.stringify({
          personId: sess.personId, recipientId: rid, role: 'owner',
          status: 'active', createdAt: now,
        }));
        await addRecipientToPerson(env, sess.personId, rid);

        return ok({ recipientId: rid }, cors);
      }

      // ── /r/:rid/* ────────────────────────────────────────────
      if (url.pathname.startsWith('/r/')) {
        const parts = url.pathname.split('/').filter(Boolean);  // ['r', rid, ...]
        const rid   = parts[1];
        const tail  = parts.slice(2);
        if (!isId(rid, 8, 64)) return err('Invalid log id', 400, cors);

        const needsOwner  = ['invites', 'seal'].includes(tail[0])
                         || (tail[0] === 'members' && tail[2] === 'revoke')
                         || (tail[0] === 'settings' && method === 'PUT');
        const access = await requireAccess(request, env, rid, cors, needsOwner ? 'owner' : null);
        if (!access.ok) return access.res;

        // GET /r/:rid  — recipient meta + your role
        if (tail.length === 0 && method === 'GET') {
          const meta = await env[KV_BINDING].get(`r:${rid}:meta`, { type: 'json' });
          if (!meta) return err('Not found', 404, cors);
          return ok({ recipient: meta, role: access.role }, cors);
        }

        if (tail[0] === 'settings' && method === 'PUT') {
          return await handleUpdateRecipient(request, env, rid, cors);
        }

        if (tail[0] === 'entries' && method === 'POST') {
          return await handleWriteEntries(request, env, rid, cors, access);
        }

        if (tail[0] === 'sync' && method === 'GET') {
          return await handleSync(request, env, rid, cors, access);
        }

        if (tail[0] === 'archives' && method === 'GET') {
          return await handleListArchives(env, rid, cors);
        }

        if (tail[0] === 'archive' && tail[1] && method === 'GET') {
          return await handleGetArchive(env, rid, tail[1], cors, access);
        }

        if (tail[0] === 'seal' && method === 'POST') {
          const body  = await readJson(request);
          const month = body?.month || lastMonthKey();
          if (!/^\d{4}-\d{2}$/.test(month)) return err('Bad month', 400, cors);
          return ok(await sealMonth(env, rid, month), cors);
        }

        if (tail[0] === 'members' && tail.length === 1 && method === 'GET') {
          return await handleListMembers(env, rid, cors);
        }

        if (tail[0] === 'members' && tail[2] === 'revoke' && method === 'POST') {
          return await handleRevokeMember(env, rid, tail[1], cors, access);
        }

        if (tail[0] === 'invites' && method === 'POST') {
          return await handleCreateInvite(request, env, rid, cors, access);
        }

        if (tail[0] === 'share' && method === 'POST') {
          return await handleCreateShare(request, env, rid, cors, access);
        }

        return err('Not found', 404, cors);
      }

      return err('Not found', 404, cors);

    } catch (e) {
      console.error('[worker]', e);
      return err('Internal error', 500, cors);
    }
  },

  // Monthly seal across every recipient. Safe to run repeatedly.
  async scheduled(event, env, ctx) {
    const month  = lastMonthKey();
    const listed = await env[KV_BINDING].list({ prefix: 'r:' });
    const rids   = new Set();
    for (const k of listed.keys) {
      if (k.name.endsWith(':meta')) rids.add(k.name.split(':')[1]);
    }
    for (const rid of rids) {
      try { await sealMonth(env, rid, month); }
      catch (e) { console.error('[seal]', rid, e); }
    }
  },
};
