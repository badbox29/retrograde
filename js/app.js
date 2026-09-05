/**
 * app.js — wiring.
 *
 * Boot order: local state → worker → screen. The app is usable from
 * IndexedDB before the network answers, and never blocks on it.
 */
const App = (() => {

  const $ = id => document.getElementById(id);

  const S = {
    workerUrl: '',
    session:   '',
    person:    null,
    recipient: null,
    role:      'family',
    view:      'today',
    filter:    null,
    printFmt:  'log',
  };

  // ── boot ──────────────────────────────────────────────────────────────

  async function boot() {
    await Store.open();
    await Units.load();

    S.workerUrl = (await Store.kvGet('workerUrl')) || '';
    S.session   = (await Store.kvGet('session'))   || '';
    if (S.workerUrl) Api.setBase(S.workerUrl);
    if (S.session)   Api.setSession(S.session);

    const invite = new URLSearchParams(location.search).get('invite');

    if (invite) return gateInvite(invite);
    if (!S.workerUrl) return gateWorker();
    if (!S.session)   return gateChoose();

    try {
      const me = await Api.me();
      return enter(me);
    } catch (e) {
      if (e.status === 0) {
        // Offline with a stored session. Trust it and run on cache.
        const cached = await Store.kvGet('person');
        const rec    = await Store.kvGet('recipient');
        if (cached && rec) return enter({ person: cached, recipients: [rec] }, true);
      }
      S.session = '';
      await Store.kvDel('session');
      return gateChoose();
    }
  }

  function showGate(node) {
    $('shell').hidden = true;
    $('gate').hidden  = false;
    UI.clear($('gateBody')).append(node);
  }

  // ── gate: where is the worker ─────────────────────────────────────────

  function gateWorker() {
    const input = UI.el('input', {
      class: 'field', type: 'url', placeholder: 'https://your-worker.workers.dev',
      autocomplete: 'url', spellcheck: 'false',
    });
    const msg = UI.el('p', { class: 'gate-or' });
    const go  = UI.el('button', { class: 'btn', type: 'button' }, 'Connect');

    go.onclick = async () => {
      const url = input.value.trim();
      if (!url) return;
      go.disabled = true; msg.textContent = 'Checking\u2026';
      const r = await Api.ping(url);
      if (!r.ok) { msg.textContent = r.error; go.disabled = false; return; }
      S.workerUrl = url.replace(/\/+$/, '');
      Api.setBase(S.workerUrl);
      await Store.kvSet('workerUrl', S.workerUrl);
      gateChoose();
    };

    showGate(UI.el('div', {},
      UI.el('label', { class: 'sheet-lab', text: 'Sync address' }),
      input, go, msg,
      UI.el('p', { class: 'gate-sub',
        text: 'This is the worker address whoever set up the log gave you. It is stored on this device only.' }),
    ));
  }

  // ── gate: sign in ─────────────────────────────────────────────────────

  function gateChoose() {
    const box = UI.el('div', {});
    const gbtn = UI.el('div', { id: 'gbtn' });

    box.append(gbtn);
    box.append(UI.el('button', { class: 'btn btn-quiet', type: 'button',
      onClick: gateInvitePaste }, 'I have an invite link'));
    box.append(UI.el('p', { class: 'gate-or', text: 'or' }));
    box.append(UI.el('button', { class: 'btn btn-quiet', type: 'button',
      onClick: gateBootstrap }, 'Start a new log'));
    box.append(UI.el('button', { class: 'linky', type: 'button',
      onClick: async () => { await Store.kvDel('workerUrl'); location.reload(); } },
      'Use a different sync address'));

    showGate(box);
    setupGoogle(gbtn);
  }

  async function setupGoogle(host) {
    let cfg;
    try { cfg = await Api.config(); } catch { return; }
    if (!cfg?.googleEnabled) return;

    await new Promise(res => {
      if (window.google?.accounts?.id) return res();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.onload = res; s.onerror = res;
      document.head.append(s);
    });
    if (!window.google?.accounts?.id) return;

    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: async ({ credential }) => {
        try {
          const r = await Api.googleSignIn(credential);
          await afterSignIn(r);
        } catch (e) {
          UI.toast(e.status === 404
            ? 'No log is linked to that Google account yet. Ask for an invite link.'
            : e.message);
        }
      },
    });
    google.accounts.id.renderButton(host, {
      theme: 'outline', size: 'large', width: 320, text: 'continue_with',
    });
  }

  function gateInvitePaste() {
    const input = UI.el('input', { class: 'field', type: 'text',
      placeholder: 'Paste the whole link', spellcheck: 'false' });
    const go = UI.el('button', { class: 'btn', type: 'button' }, 'Continue');
    go.onclick = () => {
      const v = input.value.trim();
      const m = v.match(/invite=([A-Za-z0-9_-]{16,})/) || v.match(/^([A-Za-z0-9_-]{16,})$/);
      if (!m) return UI.toast('That does not look like an invite link.');
      gateInvite(m[1]);
    };
    showGate(UI.el('div', {},
      UI.el('label', { class: 'sheet-lab', text: 'Invite link' }),
      input, go,
      UI.el('button', { class: 'linky', type: 'button', onClick: gateChoose }, 'Back')));
  }

  function gateInvite(token) {
    const input = UI.el('input', { class: 'field', type: 'text',
      placeholder: 'Your name', autocomplete: 'name', maxlength: '80' });
    const go  = UI.el('button', { class: 'btn', type: 'button' }, 'Join the log');
    const msg = UI.el('p', { class: 'gate-or' });

    go.onclick = async () => {
      const name = input.value.trim();
      if (!name) return UI.toast('Please add your name so entries are attributed.');
      go.disabled = true; msg.textContent = 'Joining\u2026';
      try {
        const r = await Api.redeemInvite(token, name);
        history.replaceState(null, '', location.pathname);
        await afterSignIn(r);
      } catch (e) { msg.textContent = e.message; go.disabled = false; }
    };

    showGate(UI.el('div', {},
      UI.el('p', { class: 'gate-sub',
        text: 'Your name goes on everything you write, so whoever reads it later knows who was there.' }),
      input, go, msg));
  }

  function gateBootstrap() {
    const tok  = UI.el('input', { class: 'field', type: 'password',
      placeholder: 'Setup key', spellcheck: 'false' });
    const you  = UI.el('input', { class: 'field', type: 'text', placeholder: 'Your name', maxlength: '80' });
    const them = UI.el('input', { class: 'field', type: 'text',
      placeholder: 'Who are you caring for?', maxlength: '80' });
    const tz   = UI.el('input', { class: 'field', type: 'text',
      value: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
    const go   = UI.el('button', { class: 'btn', type: 'button' }, 'Create the log');
    const msg  = UI.el('p', { class: 'gate-or' });

    go.onclick = async () => {
      if (!tok.value || !you.value.trim() || !them.value.trim()) {
        return UI.toast('Fill in all three, then try again.');
      }
      go.disabled = true; msg.textContent = 'Setting up\u2026';
      try {
        const r = await Api.bootstrap({
          bootstrapToken: tok.value,
          displayName:    you.value.trim(),
          recipientName:  them.value.trim(),
          timezone:       tz.value.trim() || 'UTC',
        });
        await afterSignIn(r);
      } catch (e) { msg.textContent = e.message; go.disabled = false; }
    };

    showGate(UI.el('div', {},
      UI.el('p', { class: 'gate-sub',
        text: 'This is a one-time setup, using the key from the worker settings.' }),
      UI.el('label', { class: 'sheet-lab', text: 'Setup key' }), tok,
      UI.el('label', { class: 'sheet-lab', text: 'Your name' }), you,
      UI.el('label', { class: 'sheet-lab', text: 'Their name' }), them,
      UI.el('label', { class: 'sheet-lab', text: 'Their time zone' }), tz,
      go, msg,
      UI.el('button', { class: 'linky', type: 'button', onClick: gateChoose }, 'Back')));
  }

  async function afterSignIn(r) {
    S.session = r.sessionId;
    Api.setSession(S.session);
    await Store.kvSet('session', S.session);
    const me = await Api.me();
    return enter(me);
  }

  // ── enter the app ─────────────────────────────────────────────────────

  async function enter(me, offline = false) {
    S.person = me.person;
    await Store.kvSet('person', me.person);

    const list = me.recipients || [];
    if (!list.length) {
      return showGate(UI.el('div', {},
        UI.el('p', { class: 'gate-sub',
          text: 'You are signed in, but not part of any log yet. Ask whoever set it up for an invite link.' }),
        UI.el('button', { class: 'btn btn-quiet', type: 'button', onClick: signOut }, 'Sign out')));
    }

    const savedId = await Store.kvGet('recipientId');
    S.recipient = list.find(r => r.id === savedId) || list[0];
    S.role      = S.recipient.role || 'family';
    await Store.kvSet('recipient', S.recipient);
    await Store.kvSet('recipientId', S.recipient.id);

    Packs.setActive(S.recipient.packs);
    UI.setTz(S.recipient.timezone);
    document.title = `${S.recipient.displayName} \u00b7 Care log`;

    $('gate').hidden = true;

    // A different app entirely for the person being cared for.
    if (S.role === 'self') {
      await Sync.init(S.recipient.id, S.person, S.role);
      Sync.on(s => {
        const u = $('selfSync').querySelector('use');
        u.setAttribute('href', s.status === 'offline' || s.status === 'error'
          ? '#i-cloud-off' : '#i-cloud-ok');
      });
      $('selfShell').hidden = false;
      wireSelf();
      if (!offline) Sync.run().then(renderSelf);
      return renderSelf();
    }

    $('shell').hidden = false;
    document.body.dataset.view = 'today';

    $('recipientName').textContent = S.recipient.displayName;
    $('myRole').textContent = S.role === 'caregiver' ? 'caregiver'
                            : S.role === 'owner' ? 'owner' : 'family';

    // The People tab is only meaningful to an owner; everyone else still
    // sees who is here, they just cannot invite or remove.
    $('inviteBox').hidden = S.role !== 'owner';

    wire();
    await Sync.init(S.recipient.id, S.person, S.role);
    Push.refreshContext(S.recipient.id).catch(() => {});
    Sync.on(renderSyncState);
    if (!offline) Sync.run().then(refresh);
    refresh();
  }


  // ── The self-report screen ────────────────────────────────────────────

  let selfWired = false;
  function wireSelf() {
    if (selfWired) return;
    selfWired = true;
    $('selfSync').onclick = () => { Sync.run().then(renderSelf); };
    $('selfHistoryBtn').onclick = openSelfHistory;
    $('selfGreeting').textContent = firstName(S.person.displayName)
      ? `Hi ${firstName(S.person.displayName)} \u2014 how are you?`
      : 'How are you?';
    // Poll for acknowledgements so "Dad saw it" arrives without a refresh.
    setInterval(() => { if (!document.hidden) Sync.run().then(renderSelf); }, 30000);
  }

  function firstName(n) { return (n || '').trim().split(/\s+/)[0] || ''; }

  async function renderSelf() {
    const groups = Packs.checkinGroups(S.recipient.tiles);
    const host = UI.clear($('selfGrid'));

    for (const g of groups) {
      const sec = UI.el('section', { class: 'selfgroup' },
        UI.el('h2', { class: 'selfgroup-h', text: g.label }));
      const grid = UI.el('div', { class: 'selftiles' });
      for (const t of g.tiles) {
        const b = UI.el('button', {
          class: 'selftile', type: 'button', 'data-kind': t.id,
          'data-tone': t.tone || '',
        }, UI.icon(t.icon, 'ic bigic'), UI.el('span', { text: t.label }));
        // A tap commits, immediately, with no form and no confirmation.
        // This reverses the rule everywhere else in the app on purpose:
        // somebody pressing this is dysregulated, and friction costs more
        // here than a spurious entry does.
        b.onclick = () => sendCheckin(t, b);
        grid.append(b);
      }
      sec.append(grid);
      host.append(sec);
    }

    await renderSelfSent();
  }

  async function sendCheckin(tileDef, btn) {
    btn.classList.remove('just-logged');
    void btn.offsetWidth;
    btn.classList.add('just-logged');
    if (navigator.vibrate) navigator.vibrate(12);
    await Sync.write({ kind: tileDef.id });
    await renderSelfSent();
    Sync.run().then(renderSelfSent);
  }

  /** What they sent recently, and who has seen it. */
  async function renderSelfSent() {
    const all = await Sync.resolved();
    const mine = all
      .filter(e => Packs.isCheckin(e.kind))
      .slice(0, 3);
    const acks = ackIndex(all);

    const box = $('selfSent');
    if (!mine.length) { box.hidden = true; return; }
    UI.clear(box);
    box.hidden = false;

    for (const e of mine) {
      const seen = acks.get(e.id);
      box.append(UI.el('div', { class: 'sent' + (seen ? ' is-seen' : '') },
        UI.el('span', { class: 'sent-k', text: Packs.label(e.kind) }),
        UI.el('span', { class: 'sent-t', text: UI.time(e.occurredAt) }),
        seen
          ? UI.el('span', { class: 'sent-ack' }, UI.icon('i-check', 'ic'),
              `${firstName(seen.authorName) || 'Someone'} saw it`)
          : UI.el('span', { class: 'sent-wait', text: 'Sent' }),
      ));
    }
  }

  /** entryId -> the ack that answered it. First one wins. */
  function ackIndex(entries) {
    const m = new Map();
    for (const e of entries) {
      if (e.kind !== 'ack' || !e.ackFor) continue;
      const prev = m.get(e.ackFor);
      if (!prev || e.occurredAt < prev.occurredAt) m.set(e.ackFor, e);
    }
    return m;
  }

  async function openSelfHistory() {
    const all = await Sync.resolved();
    const acks = ackIndex(all);
    const mine = all.filter(e => Packs.isCheckin(e.kind));

    const box = UI.el('div', {});
    if (!mine.length) {
      box.append(UI.el('div', { class: 'empty' },
        UI.el('strong', { text: 'Nothing yet' }),
        'Anything you send shows up here.'));
    }

    // Read-only. No editing, no deleting, no tapping through to a form —
    // an accidental delete from this screen would be invisible to everyone.
    let lastDay = null;
    for (const e of mine) {
      const day = UI.dayKey(e.occurredAt);
      if (day !== lastDay) {
        lastDay = day;
        box.append(UI.el('div', { class: 'day-h' },
          UI.relativeDay(day) || UI.dayLong(e.occurredAt)));
      }
      const seen = acks.get(e.id);
      box.append(UI.el('div', { class: 'histrow' },
        UI.el('span', { class: 'ent-t', text: UI.time(e.occurredAt) }),
        UI.el('span', { class: 'hist-k', text: Packs.label(e.kind) }),
        seen ? UI.el('span', { class: 'sent-ack' }, UI.icon('i-check', 'ic'),
                 `${firstName(seen.authorName) || 'Someone'} saw it`) : null,
      ));
    }

    UI.openSheet('What you sent', box);
  }

  // ── chrome ────────────────────────────────────────────────────────────

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;

    for (const b of $('tabbar').querySelectorAll('.tab')) {
      b.onclick = () => go(b.dataset.go);
    }
    // Wrapped, not passed directly: a handler receives the click Event as
    // its first argument, which would arrive as force=true and skip the
    // discard guard entirely.
    $('sheetClose').onclick = () => UI.closeSheet();
    $('scrim').onclick      = () => UI.closeSheet();
    addEventListener('keydown', e => { if (e.key === 'Escape') UI.closeSheet(); });

    $('btnSyncState').onclick = () => { Sync.run().then(refresh); UI.toast('Syncing\u2026'); };
    $('btnRecipient').onclick = switchRecipient;
    $('btnMakeInvite').onclick = makeInvite;
    $('btnSaveRecip').onclick  = saveRecipient;
    $('btnSignOut').onclick    = signOut;
    $('btnLoadArchive').onclick = loadOlder;

    for (const b of $('prFormat').querySelectorAll('.seg-b')) {
      b.onclick = () => {
        for (const x of $('prFormat').querySelectorAll('.seg-b')) x.classList.remove('is-on');
        b.classList.add('is-on');
        S.printFmt = b.dataset.fmt;
        renderPrint();
      };
    }
    $('prFrom').onchange = renderPrint;
    $('prTo').onchange   = renderPrint;
    $('btnPrint').onclick = () => window.print();
    $('btnShare').onclick = makeShare;

    const today = new Date();
    const back  = new Date(Date.now() - 13 * 86400000);
    $('prTo').value   = today.toISOString().slice(0, 10);
    $('prFrom').value = back.toISOString().slice(0, 10);
  }

  function go(name) {
    S.view = name;
    document.body.dataset.view = name;
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.name !== name;
    for (const t of $('tabbar').querySelectorAll('.tab')) {
      t.classList.toggle('is-on', t.dataset.go === name);
    }
    scrollTo({ top: 0 });
    refresh();
  }

  function renderSyncState(state) {
    const btn = $('btnSyncState');
    const use = btn.querySelector('use');
    const off = state.status === 'offline' || state.status === 'error';
    use.setAttribute('href', off ? '#i-cloud-off' : '#i-cloud-ok');
    btn.classList.toggle('is-offline', off);
    btn.classList.toggle('is-syncing', state.status === 'syncing');
    btn.title = off
      ? (state.pending ? `${state.pending} waiting to sync` : 'Not connected')
      : 'Everything is synced';
  }

  // ── refresh ───────────────────────────────────────────────────────────

  async function refresh() {
    if (S.view === 'today')    return renderToday();
    if (S.view === 'log')      return renderFullLog();
    if (S.view === 'works')    return renderWorks();
    if (S.view === 'people')   return renderPeople();
    if (S.view === 'print')    return renderPrint();
    if (S.view === 'settings') return renderSettings();
  }

  // ── today ─────────────────────────────────────────────────────────────

  async function renderToday() {
    const tiles = Packs.withOverrides(
      Packs.tilesFor(S.recipient.packs), S.recipient.tiles);
    UI.renderTiles($('tiles'), tiles, logTile);

    const all = (await Sync.resolved()).filter(e => e.kind !== 'ack');
    const key = UI.todayKey();
    const today = all.filter(e => UI.dayKey(e.occurredAt) === key);

    UI.renderLog($('todayLog'), today, {
      emptyTitle: 'Nothing logged today',
      emptyBody:  'Tap a button above. Tap, then Save \u2014 everything on the form is optional.',
      onOpen: openEntry,
      cycle:  Sync.cycleDays(all),
    });
  }

  // ── the logging moment ────────────────────────────────────────────────
  //
  // A tap opens the form. It does NOT write anything: a pocket tap or a
  // mis-hit on a 3-wide grid must not leave a phantom meal in the record,
  // and a phantom is invisible precisely because nobody meant to make it.
  // The Save button is the commit.
  //
  // For a hard moment the form still leads with what helped last time,
  // because that is what the person holding the phone needs before they
  // need a text box.

  async function logTile(tileDef) {
    const draft = {
      kind:       tileDef.id,
      occurredAt: Date.now(),
      body:       null,
      fields:     {},
      whatWorked: null,
      visibility: 'shared',
    };

    const body = UI.el('div', {});

    body.append(UI.el('p', { class: 'viewnote',
      text: `${UI.relativeDay(UI.dayKey(draft.occurredAt)) || UI.dayLong(draft.occurredAt)} at ${UI.time(draft.occurredAt)}` }));

    if (tileDef.tone === 'hard') {
      const priors = await Sync.whatWorked(tileDef.id, 3);
      const block  = UI.priorBlock(tileDef.id, priors);
      if (block) body.append(block);
    }

    const form = entryForm(draft, tileDef, {
      mode: 'create',
      saveLabel: `Save ${tileDef.label.toLowerCase()}`,
      done: () => {
        UI.closeSheet(true);
        UI.flashTile(tileDef.id);
        UI.toast('Logged');
        refresh();
      },
    });

    body.append(form.node);
    UI.openSheet(tileDef.label, body, { guard: form.guard });
  }

  /**
   * The detail form, used both for a new draft and for editing an existing
   * entry. Returns the node plus a guard the sheet calls before closing.
   */
  function entryForm(entry, tileDef, { mode, done, saveLabel } = {}) {
    const wrap = UI.el('div', {});
    let detail = entry.fields?.detail || null;
    let dirty  = false;
    let saved  = false;
    const touch = () => { dirty = true; };

    if (tileDef.quick?.length) {
      const row = UI.el('div', { class: 'quickrow' });
      for (const q of tileDef.quick) {
        const c = UI.el('button', { class: 'chip' + (detail === q ? ' is-on' : ''),
          type: 'button' }, q);
        c.onclick = () => {
          detail = detail === q ? null : q;
          for (const x of row.querySelectorAll('.chip')) x.classList.remove('is-on');
          if (detail) c.classList.add('is-on');
          touch();
        };
        row.append(c);
      }
      wrap.append(row);
    }

    // Numeric field with units. What gets typed is in the reader's unit;
    // what gets stored is always canonical.
    let numIn = null, numUnit = null;
    const quantity = tileDef.field;
    if (quantity) {
      numUnit = Units.get(quantity);
      const def = Units.unitDef(quantity, numUnit);
      const current = entry.fields?.[quantity];
      numIn = UI.el('input', {
        class: 'field num', type: 'number', inputmode: 'decimal',
        step: String(def?.step ?? 0.1), onInput: touch,
        placeholder: Units.REGISTRY[quantity]?.label || '',
      });
      if (current != null) {
        numIn.value = Units.toDisplay(quantity, current, numUnit)
                           .toFixed(def?.decimals ?? 1);
      }

      const alertBox = UI.el('div', { class: 'threshold', hidden: true });
      const thr = tileDef.threshold;

      const checkThreshold = () => {
        if (!thr) return;
        const canon = Units.toCanonical(quantity, numIn.value, numUnit);
        const hit = Units.crosses(thr, canon);
        UI.clear(alertBox);
        alertBox.hidden = !hit;
        if (!hit) return;
        // Guidance, never instruction. The number came from their own care
        // team; the app is repeating it, not deciding anything.
        alertBox.append(
          UI.el('div', { class: 'threshold-h' }, UI.icon('i-alert', 'ic'),
            UI.el('span', { text: 'Worth a call' })),
          UI.el('p', { text: thr.note }),
          thr.source ? UI.el('small', { text: thr.source }) : null,
        );
      };
      numIn.addEventListener('input', checkThreshold);
      checkThreshold();

      wrap.append(
        UI.el('label', { class: 'sheet-lab' },
          `${Units.REGISTRY[quantity]?.label || 'Reading'} (${Units.symbol(quantity, numUnit)})`),
        numIn, alertBox);
    }

    const bodyIn = UI.el('textarea', { class: 'field', onInput: touch,
      placeholder: tileDef.prompt || 'Anything worth writing down.' });
    bodyIn.value = entry.body || '';
    wrap.append(UI.el('label', { class: 'sheet-lab', text: 'Notes' }), bodyIn);

    let workedIn = null;
    if (tileDef.tone === 'hard') {
      workedIn = UI.el('textarea', { class: 'field', onInput: touch,
        placeholder: 'If anything settled it \u2014 write it here so it is there next time.' });
      workedIn.value = entry.whatWorked || '';
      wrap.append(UI.el('label', { class: 'sheet-lab', text: 'What helped' }), workedIn);
    }

    let visIn = null;
    if (S.role !== 'caregiver') {
      visIn = UI.el('input', { type: 'checkbox', onChange: touch });
      visIn.checked = entry.visibility === 'family';
      wrap.append(UI.el('label', { class: 'vis' }, visIn,
        UI.el('div', {},
          UI.el('strong', { text: 'Keep this to family' }),
          UI.el('em', { text: 'Caregivers will not see it, and it never goes into a printout or a shared link.' }))));
    }

    const save = UI.el('button', { class: 'btn', type: 'button' },
      saveLabel || 'Save');
    save.onclick = async () => {
      save.disabled = true;
      const fields = { ...(entry.fields || {}), detail };

      if (quantity && numIn) {
        const canon = Units.toCanonical(quantity, numIn.value, numUnit);
        if (canon == null) {
          delete fields[quantity];
          delete fields.crossed;
        } else {
          // Canonical, unrounded. Rounding here is what makes a value drift
          // a little further every time somebody edits it.
          fields[quantity] = canon;
          // Recorded even if the alert was dismissed, because the printout
          // is what a doctor actually reads.
          if (Units.crosses(tileDef.threshold, canon)) fields.crossed = quantity;
          else delete fields.crossed;
        }
      }

      const patch = {
        body:       bodyIn.value.trim() || null,
        whatWorked: workedIn ? (workedIn.value.trim() || null) : entry.whatWorked,
        fields,
        visibility: visIn ? (visIn.checked ? 'family' : 'shared') : entry.visibility,
      };
      if (mode === 'create') {
        await Sync.write({ kind: entry.kind, occurredAt: entry.occurredAt, ...patch });
      } else {
        await Sync.edit(entry, patch);
      }
      saved = true;
      done();
    };
    wrap.append(save);

    if (mode === 'create') {
      wrap.append(UI.el('button', { class: 'linky', type: 'button',
        onClick: () => { dirty = false; UI.closeSheet(true); } }, 'Cancel'));
    }

    // Returning false keeps the sheet open. Only ever asks when there is
    // something real to lose; an untouched form closes without a word.
    const guard = () => {
      if (saved || !dirty) return true;
      return confirm('Discard this entry?');
    };

    return { node: wrap, guard };
  }

  // ── entry detail ──────────────────────────────────────────────────────

  async function openEntry(e) {
    if (e.kind === 'ack') return;      // nothing to open on an acknowledgement
    const tileDef = Packs.tile(e.kind);
    const body = UI.el('div', {});

    body.append(UI.el('p', { class: 'viewnote',
      text: `${UI.dayLong(e.occurredAt)} at ${UI.time(e.occurredAt)} \u00b7 ${e.authorName || 'someone'}` }));

    const form = entryForm(e, tileDef, {
      mode: 'edit',
      saveLabel: 'Save changes',
      done: () => { UI.closeSheet(true); refresh(); },
    });
    body.append(form.node);

    // Threaded family note. Rides the same append-only stream as everything
    // else: it is just an entry with a parent.
    if (S.role !== 'caregiver') {
      const note = UI.el('textarea', { class: 'field',
        placeholder: 'A note for family only, kept with this entry.' });
      const add = UI.el('button', { class: 'btn btn-quiet', type: 'button' }, 'Add family note');
      add.onclick = async () => {
        const t = note.value.trim();
        if (!t) return;
        add.disabled = true;
        // 'thread_note', not 'note'. They were the same kind, distinguishable
        // only by parentId being set, which made "how many notes were
        // logged" unanswerable without a join.
        await Sync.write({ kind: 'thread_note', body: t, parentId: e.id,
                           visibility: 'family' });
        UI.closeSheet(true); refresh(); UI.toast('Note added');
      };
      body.append(UI.el('div', { class: 'panel' },
        UI.el('h3', { class: 'subtitle', text: 'Family note' }), note, add));
    }

    // Acknowledging is the whole point of the check-in pack: without it the
    // person is pressing a button into a void, and the second time they
    // will not bother. The first ack closes it for the whole household.
    if (Packs.isCheckin(e.kind) && S.role !== 'self') {
      const all  = await Sync.resolved();
      const seen = ackIndex(all).get(e.id);
      if (seen) {
        body.append(UI.el('p', { class: 'viewnote' },
          `${seen.authorName || 'Someone'} already let them know this was seen.`));
      } else {
        const ackBtn = UI.el('button', { class: 'btn', type: 'button' },
          'Let them know I saw this');
        ackBtn.onclick = async () => {
          ackBtn.disabled = true;
          await Sync.write({ kind: 'ack', ackFor: e.id, occurredAt: Date.now() });
          UI.closeSheet(true); refresh(); UI.toast('They will see that you saw it');
        };
        body.append(UI.el('div', { class: 'panel' }, ackBtn));
      }
    }

    const del = UI.el('button', { class: 'linky', type: 'button' }, 'Remove this entry');
    del.onclick = async () => {
      if (!confirm('Remove this entry from the log?')) return;
      await Sync.remove(e);
      UI.closeSheet(true); refresh(); UI.toast('Removed from the log');
    };
    body.append(del);

    UI.openSheet(tileDef.label, body, { guard: form.guard });
  }

  // ── full log ──────────────────────────────────────────────────────────

  async function renderFullLog() {
    const all   = (await Sync.resolved()).filter(e => e.kind !== 'ack');
    const kinds = [...new Set(all.map(e => e.kind))];

    const bar = UI.clear($('logFilter'));
    const mk = (label, val) => {
      const c = UI.el('button', { class: 'chip' + (S.filter === val ? ' is-on' : ''),
        type: 'button' }, label);
      c.onclick = () => { S.filter = val; renderFullLog(); };
      return c;
    };
    bar.append(mk('Everything', null));
    for (const k of kinds) bar.append(mk(Packs.label(k), k));

    const list = S.filter ? all.filter(e => e.kind === S.filter) : all;
    UI.renderLog($('fullLog'), list, {
      emptyTitle: 'The log is empty',
      emptyBody:  'Anything logged on the Today screen shows up here.',
      onOpen: openEntry,
      cycle:  Sync.cycleDays(all),
    });

    $('btnLoadArchive').hidden = false;
  }

  async function loadOlder() {
    const b = $('btnLoadArchive');
    b.disabled = true; b.textContent = 'Loading\u2026';
    try {
      const n = await Sync.loadArchives();
      UI.toast(n ? `Loaded ${n} older entries` : 'Nothing older to load');
      b.hidden = true;
    } catch (e) { UI.toast(e.message); }
    finally { b.disabled = false; b.textContent = 'Load older months'; }
  }

  // ── what works ────────────────────────────────────────────────────────

  async function renderWorks() {
    UI.renderWorks($('worksList'), await Sync.allWhatWorked(), openEntry);
  }

  // ── people ────────────────────────────────────────────────────────────

  async function renderPeople() {
    try {
      const { members } = await Api.members(S.recipient.id);
      UI.renderMembers($('membersList'), members, {
        canManage: S.role === 'owner',
        meId: S.person.id,
        onRevoke: async m => {
          if (!confirm(`Remove ${m.displayName}? Everything they wrote stays in the log.`)) return;
          try { await Api.revoke(S.recipient.id, m.personId); renderPeople(); UI.toast('Access removed'); }
          catch (e) { UI.toast(e.message); }
        },
      });
    } catch (e) {
      UI.clear($('membersList')).append(UI.el('div', { class: 'empty' },
        UI.el('strong', { text: 'Could not load' }), e.message));
    }
  }

  async function makeInvite() {
    const role  = document.querySelector('input[name="invrole"]:checked')?.value;
    const label = $('inviteLabel').value.trim();
    const btn   = $('btnMakeInvite');
    btn.disabled = true;
    try {
      const { invite } = await Api.createInvite(S.recipient.id, role, label);
      const url = `${location.origin}${location.pathname}?invite=${invite.token}`;
      const box = $('inviteResult');
      UI.clear(box).append(
        UI.el('strong', { text: 'Send this to them' }),
        UI.el('code', { text: url }),
        UI.el('div', { class: 'btn-row' },
          UI.el('button', { class: 'btn', type: 'button', onClick: async () => {
            if (navigator.share) {
              try { await navigator.share({ title: 'Care log invite', url }); return; } catch {}
            }
            await navigator.clipboard.writeText(url);
            UI.toast('Link copied');
          } }, navigator.share ? 'Share' : 'Copy link')),
        UI.el('p', { class: 'work-m', text: 'Good for 14 days, and only works once.' }),
      );
      box.hidden = false;
      $('inviteLabel').value = '';
    } catch (e) { UI.toast(e.message); }
    finally { btn.disabled = false; }
  }

  // ── print & share ─────────────────────────────────────────────────────

  async function buildDays() {
    const from = Date.parse($('prFrom').value + 'T00:00:00Z');
    const to   = Date.parse($('prTo').value   + 'T00:00:00Z') + 86400000;
    const all  = await Sync.resolved();

    // Family-only content is excluded from every printout and every link,
    // for everyone, including family. A shared page is exactly the wrong
    // place for it to leak.
    const list = all
      .filter(e => e.visibility !== 'family')
      .filter(e => e.occurredAt >= from && e.occurredAt < to)
      .sort((a, b) => a.occurredAt - b.occurredAt);

    const days = new Map();
    for (const e of list) {
      const k = UI.dayKey(e.occurredAt);
      if (!days.has(k)) days.set(k, []);
      // The unit is never optional on a printout. A temperature handed to a
      // doctor with no unit next to it is a genuine hazard.
      const q = Packs.field(e.kind);
      const reading = q && e.fields?.[q] != null ? Units.format(q, e.fields[q]) : null;
      const bits = [reading, e.fields?.detail, e.body].filter(Boolean);
      if (e.fields?.crossed) bits.push('(past the threshold given)');
      if (e.whatWorked) bits.push('What helped: ' + e.whatWorked);
      days.get(k).push({
        time: UI.time(e.occurredAt),
        kind: Packs.label(e.kind),
        text: bits.join(' \u2014 '),
        ts:   e.occurredAt,
      });
    }
    return [...days.entries()].map(([k, items]) => ({
      date: UI.dayLong(items[0].ts), key: k, items,
    }));
  }

  async function renderPrint() {
    const host = UI.clear($('printPreview'));
    const days = await buildDays();

    host.append(UI.el('div', { class: 'pv-head' },
      UI.el('h1', { text: S.recipient.displayName }),
      UI.el('p', { text: `Care log \u00b7 ${$('prFrom').value} to ${$('prTo').value}` })));

    if (!days.length) {
      host.append(UI.el('div', { class: 'empty' },
        UI.el('strong', { text: 'Nothing in that range' }), 'Try widening the dates.'));
      return;
    }

    if (S.printFmt === 'log') {
      for (const d of days) {
        const sec = UI.el('section', { class: 'pv-day' }, UI.el('h2', { text: d.date }));
        for (const i of d.items) {
          sec.append(UI.el('div', { class: 'pv-i' },
            UI.el('span', { class: 'a', text: i.time }),
            UI.el('span', { class: 'b', text: i.kind }),
            UI.el('span', { class: 'c', text: i.text })));
        }
        host.append(sec);
      }
      return;
    }

    // 24-hour sheet: one row per hour, the shape a nurse or a relieving
    // caregiver reads at a glance.
    for (const d of days) {
      const rows = new Map();
      for (const i of d.items) {
        const h = new Intl.DateTimeFormat('en-GB', {
          timeZone: S.recipient.timezone || 'UTC', hour: '2-digit', hour12: false,
        }).format(i.ts);
        if (!rows.has(h)) rows.set(h, []);
        rows.get(h).push(i);
      }
      const table = UI.el('table', { class: 'pv-sheet' },
        UI.el('thead', {}, UI.el('tr', {},
          UI.el('th', { text: 'Hour' }), UI.el('th', { text: 'What happened' }))));
      const tb = UI.el('tbody', {});
      for (let h = 0; h < 24; h++) {
        const key = String(h).padStart(2, '0');
        const items = rows.get(key) || [];
        tb.append(UI.el('tr', {},
          UI.el('td', { text: `${key}:00` }),
          UI.el('td', { text: items.map(i => `${i.kind}${i.text ? ' \u2014 ' + i.text : ''}`).join('; ') })));
      }
      table.append(tb);
      host.append(UI.el('section', { class: 'pv-day' },
        UI.el('h2', { text: d.date }), table));
    }
  }

  async function makeShare() {
    const btn = $('btnShare');
    btn.disabled = true;
    try {
      const days = await buildDays();
      const { url } = await Api.createShare(S.recipient.id, {
        title:    S.recipient.displayName,
        subtitle: `Care log \u00b7 ${$('prFrom').value} to ${$('prTo').value}`,
        days: days.map(d => ({ date: d.date, items: d.items.map(i => ({
          time: i.time, kind: i.kind, text: i.text })) })),
      });
      const box = $('shareResult');
      UI.clear(box).append(
        UI.el('strong', { text: 'Link ready' }),
        UI.el('code', { text: url }),
        UI.el('button', { class: 'btn', type: 'button', onClick: async () => {
          if (navigator.share) { try { await navigator.share({ url }); return; } catch {} }
          await navigator.clipboard.writeText(url); UI.toast('Link copied');
        } }, navigator.share ? 'Share' : 'Copy link'),
        UI.el('p', { class: 'work-m',
          text: 'A snapshot, not a live view \u2014 it will not change under them. Expires in 30 days.' }),
      );
      box.hidden = false;
    } catch (e) { UI.toast(e.message); }
    finally { btn.disabled = false; }
  }

  // ── settings ──────────────────────────────────────────────────────────

  async function renderSettings() {
    const on = new Set(S.recipient.packs?.length ? S.recipient.packs : Packs.DEFAULT_PACKS);
    const host = UI.clear($('packList'));

    for (const p of Packs.ALL) {
      const cb = UI.el('input', { type: 'checkbox' });
      cb.checked  = p.locked || on.has(p.id);
      cb.disabled = !!p.locked || S.role === 'caregiver';
      cb.onchange = async () => {
        cb.checked ? on.add(p.id) : on.delete(p.id);
        S.recipient.packs = [...on];
        Packs.setActive(S.recipient.packs);
        await Store.kvSet('recipient', S.recipient);
        try { await Api.updateRecip(S.recipient.id, { packs: S.recipient.packs }); }
        catch { UI.toast('Saved on this device. Will sync when connected.'); }
      };
      host.append(UI.el('div', { class: 'pack' },
        UI.el('label', { class: 'pack-h' }, cb, UI.el('strong', { text: p.label })),
        UI.el('p', { class: 'pack-d', text: p.note })));
    }

    renderUnits();
    renderNotifications();
    renderTileEditor();

    $('setRecipName').textContent = S.recipient.displayName;
    $('setName').value = S.recipient.displayName;
    $('setTz').value   = S.recipient.timezone || 'UTC';
    $('setName').disabled = $('setTz').disabled = S.role !== 'owner';
    $('btnSaveRecip').hidden = S.role !== 'owner';

    // account
    const acc = UI.clear($('accountBox'));
    acc.append(UI.el('div', { class: 'accrow' },
      UI.el('div', { class: 'avatar', text: UI.initials(S.person.displayName) }),
      UI.el('div', { class: 'accrow-t' },
        UI.el('strong', { text: S.person.displayName }),
        UI.el('small', { text: S.person.email || 'No email linked' }))));

    if (S.person.googleSub) {
      acc.append(UI.el('p', { class: 'viewnote',
        text: 'Google is linked. You can sign in on a new device without an invite.' }));
    } else {
      acc.append(UI.el('p', { class: 'viewnote',
        text: 'Link Google and you can sign in on any device. Nothing in the log moves or changes \u2014 it is only another way in.' }));
      const host2 = UI.el('div', {});
      acc.append(host2);
      linkGoogleButton(host2);
    }

    const dev = UI.clear($('deviceBox'));
    const n   = await Store.count();
    const est = await Store.estimate();
    dev.append(UI.el('div', {}, 'Entries on this device: ', UI.el('b', { text: String(n) })));
    if (est?.usage) {
      dev.append(UI.el('div', {}, 'Storage used: ',
        UI.el('b', { text: (est.usage / 1048576).toFixed(1) + ' MB' })));
    }
    dev.append(UI.el('div', { text: 'Notes are encrypted on this device with a key the browser will not let any script read.' }));
    if (Sync.state.pending) {
      dev.append(UI.el('div', {}, UI.el('b', { text: `${Sync.state.pending} waiting to sync` })));
    }
  }

  /**
   * Units are a device preference, never a per-recipient one — the night
   * aide and the daughter can want different units for the same person and
   * both be right.
   */
  function renderUnits() {
    const preset = Units.currentPreset();
    for (const b of $('unitPreset').querySelectorAll('.seg-b')) {
      b.classList.toggle('is-on', b.dataset.preset === preset);
      b.onclick = async () => {
        await Units.applyPreset(b.dataset.preset);
        renderUnits();
    renderNotifications();
    renderTileEditor();
        refresh();
      };
    }

    const host = UI.clear($('unitList'));
    for (const [key, q] of Object.entries(Units.REGISTRY)) {
      const choices = Object.keys(q.units);
      if (choices.length < 2) continue;      // pressure has nowhere to go

      const row = UI.el('div', { class: 'unitrow' },
        UI.el('span', { text: q.label }));
      const seg = UI.el('div', { class: 'seg seg-sm' });
      for (const u of choices) {
        const b = UI.el('button', {
          class: 'seg-b' + (Units.get(key) === u ? ' is-on' : ''),
          type: 'button', text: q.units[u].symbol,
        });
        b.onclick = async () => { await Units.set(key, u); renderUnits(); refresh(); };
        seg.append(b);
      }
      row.append(seg);
      host.append(row);
    }
  }


  /**
   * Notifications. Only meaningful once somebody on the log can check in,
   * so the panel says so rather than offering a switch that does nothing.
   */
  async function renderNotifications() {
    const host = UI.clear($('pushBox'));
    let cfg = {};
    try { cfg = await Api.config(); } catch {}

    if (!cfg.pushEnabled) {
      host.append(UI.el('p', { class: 'viewnote',
        text: 'Notifications are not set up on the server yet. See tools/vapid-keys.js in the repo.' }));
      return;
    }
    if (!Push.supported()) {
      host.append(UI.el('p', { class: 'viewnote',
        text: 'This browser cannot do notifications.' }));
      return;
    }
    if (Push.needsInstall()) {
      host.append(UI.el('p', { class: 'viewnote',
        text: 'On iPhone, notifications only work once the app is on your home screen. Tap the share icon, then Add to Home Screen, and open it from there.' }));
      return;
    }

    const sub = await Push.current();
    if (sub) {
      host.append(UI.el('p', { class: 'viewnote',
        text: 'On for this device. You will be told when someone checks in, and told nothing once anyone has answered it.' }));
      const off = UI.el('button', { class: 'btn btn-quiet', type: 'button' }, 'Turn off on this device');
      off.onclick = async () => { await Push.disable(S.recipient.id); renderNotifications(); };
      host.append(off);
      return;
    }

    const on = UI.el('button', { class: 'btn', type: 'button' }, 'Turn on notifications');
    on.onclick = async () => {
      on.disabled = true;
      const r = await Push.enable(S.recipient.id, cfg.vapidPublicKey);
      if (!r.ok) UI.toast(r.reason);
      renderNotifications();
    };
    host.append(on);
  }

  /**
   * Rename and hide tiles. Ids are permanent; labels are not — so a family
   * can put their own words on the buttons without breaking a single
   * historical entry.
   *
   * Per recipient, not per device: everyone reading the log should see the
   * same words, which is the opposite of the units preference.
   */
  function renderTileEditor() {
    const host = UI.clear($('tileEditor'));
    if (S.role === 'caregiver' || S.role === 'self') {
      host.append(UI.el('p', { class: 'viewnote',
        text: 'Only the family can change the buttons.' }));
      return;
    }

    const overrides = new Map((S.recipient.tiles || []).map(o => [o.id, { ...o }]));
    const packs = Packs.tilesFor(S.recipient.packs);
    const checkin = Packs.byId('checkin');
    const onCheckin = (S.recipient.packs || []).includes('checkin');
    const list = onCheckin ? [...packs, ...checkin.tiles] : packs;

    const save = async () => {
      S.recipient.tiles = [...overrides.values()]
        .filter(o => o.label || o.hidden || o.order != null);
      await Store.kvSet('recipient', S.recipient);
      try { await Api.updateRecip(S.recipient.id, { tiles: S.recipient.tiles }); }
      catch { UI.toast('Saved here. Will sync when connected.'); }
    };

    for (const t of list) {
      const o = overrides.get(t.id) || { id: t.id };
      overrides.set(t.id, o);

      const name = UI.el('input', { class: 'field tinyfield', type: 'text',
        maxlength: '40', placeholder: t.label });
      name.value = o.label || '';
      name.onchange = async () => {
        const v = name.value.trim();
        if (v && v !== t.label) o.label = v; else delete o.label;
        await save(); refresh();
      };

      const hide = UI.el('input', { type: 'checkbox' });
      hide.checked = !!o.hidden;
      hide.onchange = async () => {
        if (hide.checked) o.hidden = true; else delete o.hidden;
        await save(); refresh();
      };

      host.append(UI.el('div', { class: 'tilerow' },
        UI.icon(t.icon, 'ic'),
        UI.el('span', { class: 'tilerow-n', text: t.label }),
        name,
        UI.el('label', { class: 'tilerow-h', title: 'Hide' }, hide, 'Hide'),
      ));
    }
  }

  async function linkGoogleButton(host) {
    let cfg;
    try { cfg = await Api.config(); } catch { return; }
    if (!cfg?.googleEnabled) return;

    await new Promise(res => {
      if (window.google?.accounts?.id) return res();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.onload = res; s.onerror = res;
      document.head.append(s);
    });
    if (!window.google?.accounts?.id) return;

    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: async ({ credential }) => {
        try {
          const r = await Api.googleLink(credential);
          S.person = r.person;
          await Store.kvSet('person', r.person);
          UI.toast('Google linked');
          renderSettings();
        } catch (e) { UI.toast(e.message); }
      },
    });
    google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', text: 'signin_with' });
  }

  async function saveRecipient() {
    try {
      const { recipient } = await Api.updateRecip(S.recipient.id, {
        displayName: $('setName').value.trim(),
        timezone:    $('setTz').value.trim(),
      });
      S.recipient = { ...recipient, role: S.role };
      await Store.kvSet('recipient', S.recipient);
      Packs.setActive(S.recipient.packs);
    UI.setTz(S.recipient.timezone);
      $('recipientName').textContent = S.recipient.displayName;
      UI.toast('Saved');
      renderSettings();
    } catch (e) { UI.toast(e.message); }
  }

  async function switchRecipient() {
    let me;
    try { me = await Api.me(); }
    catch { return UI.toast('Need a connection to switch logs.'); }

    const list = me.recipients || [];
    const box  = UI.el('div', {});

    for (const r of list) {
      const isNow = r.id === S.recipient.id;
      box.append(UI.el('button', {
        class: 'btn ' + (isNow ? '' : 'btn-quiet'), type: 'button',
        style: 'margin-bottom:.5rem',
        onClick: async () => {
          if (isNow) return UI.closeSheet(true);
          await Store.kvSet('recipientId', r.id);
          location.reload();
        },
      }, r.displayName + (isNow ? '  \u00b7  open' : '')));
    }

    if (S.role === 'owner' || list.length) {
      box.append(UI.el('div', { class: 'panel' },
        UI.el('h3', { class: 'subtitle', text: 'Someone else to care for' }),
        UI.el('p', { class: 'viewnote',
          text: 'A separate log with its own people, buttons and history. Nothing is shared between them.' }),
        addRecipientForm()));
    }

    UI.openSheet('Switch log', box);
  }

  /** Creating a recipient makes you its owner. Everyone else joins by invite. */
  function addRecipientForm() {
    const name = UI.el('input', { class: 'field', type: 'text', maxlength: '80',
      placeholder: 'Their name' });
    const tz = UI.el('input', { class: 'field', type: 'text', maxlength: '64',
      value: S.recipient?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
    const go = UI.el('button', { class: 'btn btn-quiet', type: 'button' }, 'Create the log');

    go.onclick = async () => {
      const n = name.value.trim();
      if (!n) return UI.toast('Give the log a name first.');
      go.disabled = true;
      try {
        const { recipientId } = await Api.addRecipient({
          displayName: n, timezone: tz.value.trim() || 'UTC',
        });
        await Store.kvSet('recipientId', recipientId);
        location.reload();
      } catch (e) {
        UI.toast(e.status === 0 ? 'Need a connection to do that.' : e.message);
        go.disabled = false;
      }
    };

    return UI.el('div', {},
      UI.el('label', { class: 'sheet-lab', text: 'Name' }), name,
      UI.el('label', { class: 'sheet-lab', text: 'Time zone' }), tz,
      go);
  }

  async function signOut() {
    try { await Api.signOut(); } catch {}
    await Store.clearAll();
    location.reload();
  }

  // ── go ────────────────────────────────────────────────────────────────

  addEventListener('DOMContentLoaded', () => {
    boot().catch(e => {
      console.error('[boot]', e);
      document.body.innerHTML =
        '<p style="padding:2rem;font:16px system-ui">Something went wrong starting up. Reload to try again.</p>';
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  });

  return { S, refresh, go };
})();
