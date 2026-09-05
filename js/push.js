/**
 * push.js — waking the household when someone checks in.
 *
 * The notification carries no payload. The push is a tickle; the service
 * worker wakes, fetches what is unanswered, and builds the text locally.
 * Nothing about the log passes through a third-party push service.
 *
 * iOS only delivers web push to an INSTALLED pwa. On iPhone, "Add to Home
 * Screen" is not a nicety here — without it nothing arrives at all, and the
 * permission prompt will not even appear.
 */
const Push = (() => {

  function supported() {
    return 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window;
  }

  /** iOS Safari in a tab: the API exists but will never deliver anything. */
  function needsInstall() {
    const iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    const installed = window.matchMedia('(display-mode: standalone)').matches
                   || navigator.standalone === true;
    return iOS && !installed;
  }

  function permission() {
    return supported() ? Notification.permission : 'unsupported';
  }

  function urlB64ToUint8(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function current() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  /**
   * Ask, subscribe, and register with the worker. Returns a plain reason
   * string on failure so the caller can say something useful rather than
   * "something went wrong".
   */
  async function enable(rid, vapidPublicKey) {
    if (!supported())      return { ok: false, reason: 'This browser cannot do notifications.' };
    if (needsInstall())    return { ok: false, reason: 'On iPhone, add the app to your home screen first — notifications only work from there.' };
    if (!vapidPublicKey)   return { ok: false, reason: 'Notifications are not set up on the server yet.' };

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return { ok: false, reason: perm === 'denied'
        ? 'Notifications are blocked for this site. You can turn them back on in your browser settings.'
        : 'Notifications were not turned on.' };
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(vapidPublicKey),
      });
    }

    await Api.pushSubscribe(rid, sub.toJSON().endpoint);
    // The service worker needs these to fetch after a push wakes it.
    await Store.kvSet('pushCtx', {
      base: Api.getBase(), session: Api.getSession(), rid,
    });
    return { ok: true };
  }

  async function disable(rid) {
    const sub = await current();
    if (!sub) return { ok: true };
    try { await Api.pushUnsubscribe(rid, sub.toJSON().endpoint); } catch {}
    await sub.unsubscribe();
    await Store.kvDel('pushCtx');
    return { ok: true };
  }

  /** Keep the stored context fresh — the session token rotates on sign-in. */
  async function refreshContext(rid) {
    if (!(await current())) return;
    await Store.kvSet('pushCtx', {
      base: Api.getBase(), session: Api.getSession(), rid,
    });
  }

  return { supported, needsInstall, permission, current, enable, disable, refreshContext };
})();
