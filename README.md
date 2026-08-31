# Care log

A shared care journal for the people who actually do the caring — a spouse,
adult children, a couple of friends, sometimes a paid aide. Built for a
household caring for someone with early-onset dementia, but the entry
templates are data, so the same app runs a newborn log.

Static HTML, CSS and JavaScript. No build step, no framework, no bundler.
Sync is one Cloudflare Worker backed by KV.

---

## What it does

**Two taps is a complete entry.** The home screen is a grid of large buttons.
Tapping one opens a form stamped with the current time; the Save button
commits it. Everything on the form is optional, so tap-then-Save is a valid
whole entry and someone who never types still produces a useful log.

The tap deliberately writes nothing on its own. An earlier version committed
on tap and offered an undo, which meant a pocket tap or a mis-hit on a 3-wide
grid left a phantom meal in the record — invisible precisely because nobody
meant to make it. A care record is the wrong place for that trade. Dismissing
the form by any route (X, scrim, Escape, Cancel) discards it, and if you have
typed something it asks first.

**Hard moments show you what helped last time.** Tap *Agitated* and the sheet
that slides up does not lead with a form. It leads with what settled him
before, pulled from whoever wrote it down, newest first. Related kinds share a
pool — whatever helps during sundowning surfaces under agitation too, because
in practice it is usually the same thing.

**Good moments are a first-class entry type.** A log that only records decline
is one nobody keeps up. The gold accent is reserved for these and used nowhere
else, so it stays meaningful.

**Family notes are invisible to caregivers.** Not greyed out, not collapsed,
not counted. A visible "2 notes hidden" marker would be worse than either
extreme: now the aide knows the family is talking about them and cannot see
it. Absence is indistinguishable from nothing existing.

**It works with no signal.** Everything writes to IndexedDB first and queues.
A phone with one bar in a nursing-home corridor behaves like a phone on wifi,
just with a different cloud icon.

**Print is a real output.** Day-by-day or a 24-hour sheet, with page-break
control. Share links are snapshots, not live views, so what you handed the
neurologist does not shift between visits.

---

## Setup

### 1. The worker

Create a KV namespace and bind it as `CARELOG`.

Vars:

    ALLOWED_ORIGINS   https://you.github.io,http://localhost:8788
    GOOGLE_CLIENT_ID  xxxx.apps.googleusercontent.com     (optional)

Secret (encrypted, not a plain var):

    BOOTSTRAP_TOKEN   a long random string

Optional cron trigger, `0 4 1 * *`, to seal last month's entries into a single
archive key.

Paste `worker.js` into the Cloudflare editor and deploy.

### 2. The client

Serve the files from anywhere static — GitHub Pages, a bucket, `python3 -m
http.server`. The client asks for the worker address on first run and stores
it on the device.

### 3. First account

    curl -X POST https://your-worker.workers.dev/auth/bootstrap \
      -H 'Content-Type: application/json' \
      -d '{"bootstrapToken":"...","displayName":"Your name",
           "recipientName":"Dad","timezone":"America/New_York"}'

Or use **Start a new log** in the app and paste the token there. Either way
you become owner. Rotate or delete `BOOTSTRAP_TOKEN` afterwards.

Everyone else joins from **People → Create invite link**. They tap it, type
their name, and they are in. No password, no signup form.

---

## Roles

| | owner | family | caregiver |
|---|---|---|---|
| Read and write shared entries | ✓ | ✓ | ✓ |
| See "what helped" | ✓ | ✓ | ✓ |
| Family-only entries and notes | ✓ | ✓ | — |
| Invite and remove people | ✓ | — | — |
| Rename, change time zone | ✓ | — | — |

Removing someone never deletes what they wrote. Their shift notes stay in the
record, attributed to them. Reinstating is flipping a status back.

The caregiver role exists so a paid night aide can be useful without being
handed the family's private conversation — sibling friction, money, legal,
"I can't do this anymore". That is the only thing the role is for.

---

## How it works

### Append-only

Entries are **write-once**. An edit is a new entry pointing at the old one; a
delete is a tombstone. Nothing is ever overwritten.

That single property is what makes this safe on KV despite last-write-wins
semantics: two caregivers writing at the same moment write to two different
keys, so there is nothing to reconcile. Merging two devices is a set union.
It also gives you a complete audit trail for free, which matters more than you
would expect — these logs get read by doctors, case managers, and occasionally
in guardianship proceedings.

### Identity

A **person** has zero or more **credentials**. Someone joins by invite and
exists as a person. Later they tap "sign in with Google" while already signed
in, and a second credential attaches to the same person. No data is copied, no
entries move, nothing is migrated — entries were always attributed to
`person.id`, never to a credential.

Google's `sub` is the join key, never email. Email changes; `sub` does not.

### Sync

The cursor is server receipt time, zero-padded to 13 digits so lexicographic
key order is chronological. The client always re-pulls the last five minutes
and drops ids it already holds, which absorbs both clock skew between edge
locations and KV's list-consistency lag. Refetching an immutable entry costs
nothing.

Closed months fold into a single archive key. Without that, a fresh device
pulling a year of history would make roughly 5,500 subrequests against a
1,000-per-invocation cap.

### Encryption at rest

Free text is encrypted with an AES-GCM key generated `extractable: false` and
stored as a live `CryptoKey` in IndexedDB. The browser hands the object back
and uses it, but no script can read the raw bytes out — not this app's, not
anything injected.

Be clear about what that buys. It protects the log from other scripts on the
origin and from casual inspection of the browser profile. It does **not**
protect against someone using the unlocked device. There is no passphrase on
purpose: a passphrase on a caregiving app means a locked-out sibling at 3am,
which is a worse failure than the one it fixes.

Indexed fields (`occurredAt`, `kind`, `pending`) stay in the clear so queries
still work. Body, "what helped", and custom fields do not.

### Time zones

Days are computed in the **recipient's** time zone, never the device's, so
"yesterday" means the same thing to a daughter three states away as it does to
whoever is in the house.

---

## Caring for more than one person

Tap the name in the top bar. The sheet lists every log you belong to and lets
you create another. Creating one makes you its owner; everyone else joins by
invite as usual.

Logs are fully separate — own people, own buttons, own history, own print
range. Nothing is shared between them. One device can hold several locally;
the display list, the sync cursor and the archive backfill are all scoped per
recipient.

## Files

    index.html              shell, SVG icon sprite, all views
    css/app.css             design system, light and dark
    js/store.js             IndexedDB, non-extractable key, seal/unseal
    js/api.js               worker client
    js/packs.js             entry templates — pure data
    js/sync.js              offline queue, cursor, supersede resolution
    js/ui.js                renderers, timezone-aware day grouping
    js/app.js               controller, sign-in flows, print and share
    sw.js                   offline shell cache
    manifest.webmanifest    installable to home screen
    worker.js               Cloudflare Worker (deploy separately)

## Adding entry types

Everything lives in `js/packs.js`. Nothing else in the app knows whether it is
running a dementia log or a newborn log.

    { id: 'seizure', label: 'Seizure', icon: 'i-storm',
      tone: 'hard', pool: 'distress',
      quick: ['Under a minute', '1-3 min', 'Over 3 min'],
      prompt: 'What did it look like, and how long?' }

`id` becomes `entry.kind` and is stored forever — never change one after it
ships. `tone: 'hard'` turns on the what-helped behaviour. `pool` shares that
history with other kinds. Add the icon as a `<g>` in the sprite in
`index.html`.

Old entries keep rendering after a pack is switched off, so turning packs on
and off is always safe.

---

## Known limits

- **No photos yet.** The schema has room; R2 is not wired up.
- **No medication schedule.** A MAR-style grid is a real feature with real
  complexity, and it should wait until you know whether the household wants it.
- `parentId` is validated but not verified server-side — checking the parent
  exists would cost a KV read per entry, and the client can only build a
  threaded note from an entry it already holds. Deliberate, not an oversight.
- Bump the `CACHE` string in `sw.js` on every deploy or returning devices keep
  the stale shell.
- Invite links embed `location.origin + location.pathname`, so generate them
  from the hosted URL, not from a `file://` page.

---

## Tested

Driven end to end in headless Chromium at 390px, light and dark:

- bootstrap, tile logging, detail sheet, log, people, print, settings
- 20/20 unit assertions on supersede chains, tombstones, concurrent writes,
  notes following an edit to a new id, seal/unseal round-trip, raw rows
  holding no readable text, and `exportKey` refusing the crypto key
- offline: writes queue, the app reloads and stays readable with no network,
  and the queue drains on reconnect

Plus 13 assertions on the commit behaviour: dismissing a tapped tile by X,
scrim, Escape or Cancel writes nothing; Save with an untouched form does
write; a half-typed form asks before discarding; and editing an existing entry
still supersedes rather than duplicating.

Five bugs worth naming, all found by testing rather than by reading:

**The key race.** `getKey()` memoised a value, not a promise. A batch write
calls `seal()` through `Promise.all`, so every concurrent call saw the key as
missing, generated its own, and raced to store it. Last write won and the rest
of the batch was encrypted under keys that no longer existed anywhere —
silently unreadable forever. It would have corrupted a new device's first
sync. `getKey()` and `open()` now memoise the in-flight promise.

**Dropped orphan notes.** A note whose parent had not synced yet was appended
to an array that had already been consumed, so it vanished instead of being
shown on its own.

**Service worker caching the API.** The fetch handler was cache-first for
every same-origin GET, which included `/auth/me` and `/sync` if the worker is
ever routed under the app's own domain. A cache hit looks like a healthy 200,
so the log would have quietly stopped updating with no error anywhere. Only
shell paths are cached now; everything else goes straight to the network.

**Writes that resolved before they committed.** `kvSet` and the entry writes
resolved on IndexedDB *request success*, not on *transaction commit*. Any
caller that wrote and then immediately called `location.reload()` — switching
recipients does exactly that — tore the page down in between, so the write
silently never landed. A care record must not lose a write it acknowledged.

**The guard that never ran.** `$('sheetClose').onclick = UI.closeSheet` passes
the click Event as the first argument. Since `closeSheet(force)` reads that
argument as truthy, the discard guard was skipped on every close. Handlers
that take arguments must be wrapped, not passed by reference.
