/**
 * api.js — talks to the Cloudflare worker.
 *
 * The session token is opaque, server-side and long-lived. It is NOT a
 * Google ID token: those expire in about an hour, and an app someone opens
 * at 3am must never greet them with a sign-in screen.
 */
const Api = (() => {

  let base    = '';
  let session = '';

  function setBase(url) { base = (url || '').replace(/\/+$/, ''); }
  function getBase()    { return base; }
  function setSession(s){ session = s || ''; }
  function getSession() { return session; }

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function call(path, { method = 'GET', body, auth = true } = {}) {
    if (!base) throw new ApiError('No sync address set', 0);

    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth && session) headers['Authorization'] = `Bearer ${session}`;

    let res;
    try {
      res = await fetch(base + path, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Network, not server. Callers treat this as "try again later".
      throw new ApiError('offline', 0);
    }

    let data = null;
    try { data = await res.json(); } catch { /* empty body is fine */ }

    if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
    return data;
  }

  // ── connectivity ──────────────────────────────────────────────────────

  async function ping(url) {
    const clean = (url || '').replace(/\/+$/, '');
    try {
      const res = await fetch(clean + '/', { method: 'GET' });
      if (!res.ok) return { ok: false, error: `Responded ${res.status}` };
      const j = await res.json();
      return j?.service === 'carelog'
        ? { ok: true }
        : { ok: false, error: 'That address answered, but it is not a care log worker.' };
    } catch {
      return { ok: false, error: 'Could not reach that address. Check it and try again.' };
    }
  }

  // ── auth ──────────────────────────────────────────────────────────────

  const config       = ()             => call('/auth/config', { auth: false });
  const me           = ()             => call('/auth/me');
  const signOut      = ()             => call('/auth/signout', { method: 'POST' });

  const bootstrap    = (b)            => call('/auth/bootstrap',     { method: 'POST', body: b, auth: false });
  const redeemInvite = (token, name)  => call('/auth/invite/redeem', { method: 'POST', auth: false,
                                              body: { inviteToken: token, displayName: name } });
  const googleSignIn = (idToken)      => call('/auth/google',        { method: 'POST', body: { idToken }, auth: false });
  const googleLink   = (idToken)      => call('/auth/google/link',   { method: 'POST', body: { idToken } });

  // ── log ───────────────────────────────────────────────────────────────

  const recipient    = (rid)          => call(`/r/${rid}`);
  const updateRecip  = (rid, patch)   => call(`/r/${rid}/settings`, { method: 'PUT', body: patch });
  const writeEntries = (rid, entries) => call(`/r/${rid}/entries`,  { method: 'POST', body: { entries } });
  const sync         = (rid, since)   => call(`/r/${rid}/sync?since=${encodeURIComponent(since || '')}`);
  const archives     = (rid)          => call(`/r/${rid}/archives`);
  const archive      = (rid, month)   => call(`/r/${rid}/archive/${month}`);
  const seal         = (rid, month)   => call(`/r/${rid}/seal`, { method: 'POST', body: { month } });

  const members      = (rid)          => call(`/r/${rid}/members`);
  const createInvite = (rid, role, label) =>
                                         call(`/r/${rid}/invites`, { method: 'POST', body: { role, label } });
  const revoke       = (rid, pid)     => call(`/r/${rid}/members/${pid}/revoke`, { method: 'POST' });
  const createShare  = (rid, doc)     => call(`/r/${rid}/share`, { method: 'POST', body: doc });
  const addRecipient = (b)            => call('/recipients', { method: 'POST', body: b });

  return {
    ApiError, setBase, getBase, setSession, getSession, ping,
    config, me, signOut, bootstrap, redeemInvite, googleSignIn, googleLink,
    recipient, updateRecip, writeEntries, sync, archives, archive, seal,
    members, createInvite, revoke, createShare, addRecipient,
  };
})();
