/**
 * ui.js — rendering only. No network, no storage.
 *
 * Days are computed in the RECIPIENT'S time zone, never the device's, so
 * "yesterday" means the same thing to a daughter three states away as it
 * does to whoever is in the house.
 */
const UI = (() => {

  let TZ = 'UTC';
  function setTz(tz) { TZ = tz || 'UTC'; }

  // ── dom ───────────────────────────────────────────────────────────────

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  function icon(id, cls = 'ic') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls);
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.append(use);
    return svg;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // ── time ──────────────────────────────────────────────────────────────

  const fmtCache = new Map();
  function fmt(opts) {
    const key = JSON.stringify(opts) + TZ;
    if (!fmtCache.has(key)) {
      fmtCache.set(key, new Intl.DateTimeFormat(undefined, { timeZone: TZ, ...opts }));
    }
    return fmtCache.get(key);
  }

  const time    = ts => fmt({ hour: 'numeric', minute: '2-digit' }).format(ts);
  const dayLong = ts => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(ts);
  const dayShort= ts => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(ts);

  /** YYYY-MM-DD in the recipient's zone. en-CA gives that ordering. */
  function dayKey(ts) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(ts);
  }

  function todayKey() { return dayKey(Date.now()); }

  function relativeDay(key) {
    const t = todayKey();
    if (key === t) return 'Today';
    const y = dayKey(Date.now() - 86400000);
    if (key === y) return 'Yesterday';
    return null;
  }

  /** ms at local-midnight boundaries for a YYYY-MM-DD, good enough for
   *  grouping and range filters without pulling in a date library. */
  function dayRange(key) {
    const start = Date.parse(key + 'T00:00:00Z');
    return [start, start + 86400000];
  }

  // ── toast ─────────────────────────────────────────────────────────────

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const n = document.getElementById('toast');
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { n.hidden = true; }, ms);
  }

  // ── sheet ─────────────────────────────────────────────────────────────

  let sheetOnClose = null;
  let sheetGuard   = null;

  /**
   * `guard` runs before the sheet closes and returns false to keep it open.
   * Dismissing a sheet must never quietly discard something the person
   * typed, and must never quietly commit something they didn't.
   */
  function openSheet(title, bodyNode, { onClose, guard } = {}) {
    const sheet = document.getElementById('sheet');
    const scrim = document.getElementById('scrim');
    document.getElementById('sheetTitle').textContent = title;
    clear(document.getElementById('sheetBody')).append(bodyNode);
    sheet.hidden = false;
    scrim.hidden = false;
    sheetOnClose = onClose || null;
    sheetGuard   = guard   || null;
    document.body.style.overflow = 'hidden';
    const first = sheet.querySelector('textarea, input, button:not(#sheetClose)');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  }

  function closeSheet(force = false) {
    if (!force && sheetGuard && sheetGuard() === false) return;
    document.getElementById('sheet').hidden = true;
    document.getElementById('scrim').hidden = true;
    document.body.style.overflow = '';
    const fn = sheetOnClose;
    sheetOnClose = null;
    sheetGuard   = null;
    fn?.();
  }

  // ── tiles ─────────────────────────────────────────────────────────────

  function renderTiles(host, tiles, onTap) {
    clear(host);
    for (const t of tiles) {
      const b = el('button', {
        class: 'tile', type: 'button', 'data-tone': t.tone || '',
        'data-kind': t.id,
        // No confirmation wash here. A tap opens the form; it does not
        // write anything. The wash fires from flashTile() after a save.
        onClick: () => onTap(t, b),
      }, icon(t.icon), el('span', { text: t.label }));
      host.append(b);
    }
  }

  // ── entries ───────────────────────────────────────────────────────────

  function entryRow(e, onOpen, cycle) {
    const tone = Packs.tone(e.kind);
    const detail = e.fields?.detail;

    // Readings are stored canonical and rendered in whoever is looking.
    const quantity = Packs.field(e.kind);
    const reading = quantity && e.fields?.[quantity] != null
      ? Units.format(quantity, e.fields[quantity])
      : null;

    const main = el('div', { class: 'ent-main' },
      el('div', {},
        el('span', { class: 'ent-k', 'data-tone': tone || '', text: Packs.label(e.kind) }),
        reading ? el('span', { class: 'ent-read' }, reading) : null,
        detail ? el('span', { class: 'ent-b', text: ' \u00b7 ' + detail }) : null,
      ),
      e.body ? el('div', { class: 'ent-b', text: e.body }) : null,
    );

    if (e.fields?.crossed) {
      main.append(el('div', { class: 'ent-crossed' },
        icon('i-alert', 'ic'), 'Past the threshold they were given'));
    }

    const row = el('div', {
      class: 'ent', role: 'button', tabindex: '0',
      onClick: () => onOpen(e),
      onKeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e); } },
    },
      el('div', { class: 'ent-t', text: time(e.occurredAt) }),
      main,
    );

    if (e.whatWorked) {
      row.append(el('div', { class: 'ent-worked' },
        el('b', { text: 'What helped' }), e.whatWorked));
    }

    if (e.notes?.length) {
      const box = el('div', { class: 'ent-notes' });
      for (const n of e.notes) {
        box.append(el('div', { class: 'note' + (n.visibility === 'family' ? ' is-private' : '') },
          el('div', { text: n.body || '' }),
          el('div', { class: 'note-who', text: `${n.authorName || 'Someone'} \u00b7 ${time(n.occurredAt)}` }),
        ));
      }
      row.append(box);
    }

    row.append(el('div', { class: 'ent-meta',
      text: (e.authorName || 'Someone') + (e.visibility === 'family' ? ' \u00b7 private to family' : '') }));

    return row;
  }

  function renderLog(host, entries, { emptyTitle, emptyBody, onOpen, cycle }) {
    clear(host);
    if (!entries.length) {
      host.append(el('div', { class: 'empty' },
        el('strong', { text: emptyTitle }), emptyBody));
      return;
    }

    const groups = new Map();
    for (const e of entries) {
      const k = dayKey(e.occurredAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }

    for (const [key, list] of groups) {
      const rel = relativeDay(key);
      const box = el('section', {});
      box.append(el('div', { class: 'day-h' },
        rel || dayLong(list[0].occurredAt),
        rel ? el('em', { text: dayShort(list[0].occurredAt) }) : null,
      ));
      // Chemo logs read by cycle day, not calendar day. "Day 3" is the unit
      // that makes a side effect legible; "14 March" is not.
      const cd = cycle?.get(list[0].id);
      if (cd) box.querySelector('.day-h').append(
        el('span', { class: 'day-cycle', text: `Day ${cd.day}` }));

      for (const e of list) box.append(entryRow(e, onOpen, cycle));
      host.append(box);
    }
  }

  // ── what works ────────────────────────────────────────────────────────

  function renderWorks(host, list, onOpen) {
    clear(host);
    if (!list.length) {
      host.append(el('div', { class: 'empty' },
        el('strong', { text: 'Nothing here yet' }),
        'When something settles a hard moment, write it in the "What helped" box. It shows up here, and again on the next hard moment as it happens.'));
      return;
    }
    for (const e of list) {
      host.append(el('div', { class: 'work', role: 'button', tabindex: '0',
        onClick: () => onOpen(e) },
        el('p', { class: 'work-x', text: e.whatWorked }),
        el('div', { class: 'work-m' },
          el('b', { text: Packs.label(e.kind) }),
          ` \u00b7 ${dayShort(e.occurredAt)} \u00b7 ${e.authorName || 'someone'}`),
      ));
    }
  }

  // ── prior-what-worked block, the one that shows up unasked ────────────

  function priorBlock(kind, priors) {
    if (!priors.length) return null;
    const ul = el('ul', {});
    for (const p of priors) {
      ul.append(el('li', {}, p.whatWorked,
        el('small', { text: `${dayShort(p.occurredAt)} \u00b7 ${p.authorName || 'someone'}` })));
    }
    return el('div', { class: 'prior' },
      el('h3', { text: 'What helped before' }), ul);
  }

  // ── members ───────────────────────────────────────────────────────────

  function initials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  function renderMembers(host, members, { canManage, meId, onRevoke }) {
    clear(host);
    for (const m of members) {
      const revoked = m.status !== 'active';
      const row = el('div', { class: 'member' + (revoked ? ' is-revoked' : '') },
        el('div', { class: 'avatar', text: initials(m.displayName) }),
        el('div', { class: 'member-n' },
          el('strong', { text: m.displayName + (m.personId === meId ? ' (you)' : '') }),
          el('span', { text: revoked ? 'no longer has access' : m.role }),
        ),
      );
      if (canManage && !revoked && m.personId !== meId) {
        row.append(el('button', { class: 'linky', type: 'button',
          onClick: () => onRevoke(m) }, 'Remove'));
      }
      host.append(row);
    }
  }

  /** The green wash on a tile, fired only once an entry really exists. */
  function flashTile(kind) {
    const b = document.querySelector(`.tile[data-kind="${kind}"]`);
    if (!b) return;
    b.classList.remove('just-logged');
    void b.offsetWidth;                       // restart the animation
    b.classList.add('just-logged');
  }

  return {
    setTz, el, icon, clear, toast, openSheet, closeSheet, flashTile,
    time, dayLong, dayShort, dayKey, todayKey, relativeDay, dayRange,
    renderTiles, entryRow, renderLog, renderWorks, priorBlock, renderMembers, initials,
  };
})();
