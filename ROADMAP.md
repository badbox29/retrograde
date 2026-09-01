# Roadmap

Where this is going, and why. Written down because the plan otherwise only
exists in a long chat log.

Current shipped version: **v0.3**

---

## v0.4 – v0.6

Deliberately skipped. Version numbers are cheap; the work is not.

---

## v0.7 — Infrastructure, plus the three packs that force it

The three packs here were chosen because each one breaks something in the
current architecture. The remaining six (v0.9) are mostly content against
machinery this release has to prove out.

### Naming pass — do this first, before any code

Tile `id`s become `entry.kind` and are stored forever. The same is true of
unit-registry keys and however cycle-day gets stored. After anyone's entries
reference them they cannot be renamed without breaking history.

Budget a real session for naming alone. It is cheaper than the alternative.

### Unit registry

**Store canonical, display converted.** Stored values are always metric. The
toggle changes rendering only.

This is not a preference about storage format, it is a correctness
requirement. If Dana logs `101.2` on a device set to Fahrenheit and Marcus
reads it on a device set to Celsius, a bare number in KV is unreadable and
possibly dangerous. Store `38.4`; render `101.2 °F` for one and `38.4 °C` for
the other. Same entry, both correct.

**The preference belongs to the reader, not the record.** It is therefore
device-level, never per-recipient. A night aide and a daughter can want
different units for the same person and both be right.

One toggle (US / metric) sets sensible defaults across every unit, because
that matches how people think. It is a preset, not a lock — someone may
reasonably want °F alongside mL for medication doses.

Units in scope:

| Quantity | Canonical | Alternate | Notes |
|---|---|---|---|
| Temperature | °C | °F | |
| Weight | kg | lb | cancer, diabetes, infant |
| Fluid | mL | fl oz | |
| Length | cm | in | infant |
| Blood glucose | mmol/L | mg/dL | **not** a simple scale factor |
| Blood pressure | mmHg | — | no conversion anywhere |

Implementation notes:

- Never store a rounded value. Round at display only, or round-tripping
  drifts.
- `fields` is currently free-form JSON with a `detail` string. Numeric fields
  need real typing: a unit registry in `packs.js` declaring each field's
  canonical unit, which packs then reference by key.
- **Printouts and share links are snapshots.** Render in the creator's units,
  and print the unit explicitly next to every number. A temperature handed to
  a doctor with no unit on it is a genuine hazard.

### Cancer: the cycle-day model

Chemo logs organise around cycle day, not calendar day. "Day 3
post-infusion" is the unit that makes side effects legible; "14 March" is
not. The current schema only has `occurredAt`.

Decide: a per-recipient treatment-start anchor, or a cycle field on entries.
The anchor is simpler but breaks when treatment changes; the field is more
honest but has to be captured somewhere.

**Emergency thresholds.** Neutropenic fever is a real emergency. A
temperature tile in a cancer pack that does not say "call now if over 38 °C"
is arguably worse than no tile at all.

This is the first place the app edges toward giving medical guidance. Be
deliberate about it rather than drifting there. Whatever is decided should be
decided on purpose and written down here.

### Autism

Does not fit the same shape as the rest. The existing packs assume decline
being tracked; an autism log is usually a child, and it is pattern-hunting —
what preceded a meltdown, which sensory input, which transition, what
regulated them.

The "what helped" mechanism is arguably *more* valuable here than in
dementia, and maps cleanly. But "recipient" framing reads wrong for a parent
logging their own kid, and some copy will need to change.

### Diabetes

Carries the unit registry's hardest case (mmol/L vs mg/dL) and is otherwise
straightforward.

### Tile-grid overflow

Already tight at 12 tiles with two packs enabled. With fourteen packs
available this becomes load-bearing rather than cosmetic.

No household will run more than two or three packs at once, but the settings
screen has to make choosing them easy, and the grid must stay scannable
one-handed when someone turns on three. Options: a cap, a two-row horizontal
scroll, or per-pack sections.

---

## v0.8 — Export and backups

Schema is locked by now, so the export can be written against the final shape
rather than needing a second pass. Export is also a useful forcing function
for the naming decisions: you cannot write a clean CSV header for a badly
named field.

**Export.** JSON and CSV. A 1.0 that cannot hand someone their own data is
not a 1.0.

One thing to hold onto: hospice logs get read afterwards, sometimes years
afterwards. The export should be something a family would want to keep, not
a database dump.

**Backups.** KV is durable, but nothing today protects against a bad deploy,
a mistaken seal, or an accidentally deleted namespace. A scheduled snapshot
to R2 covers it.

---

## v0.9 — The remaining packs

Content release against proven machinery. Schema locked, export exists.

- Hospice / palliative
- Stroke / rehab
- Parkinson's
- Heart failure / COPD
- Post-surgical recovery
- Mental health (bipolar, schizophrenia)

**Hospice tone.** The tiles are about comfort, not decline: Comfortable,
Restless, Breathing changed, Pain, Awake and talking, Family time, Ate
something. It is a log of what the day was like, not a countdown.

"What helped" is at its most useful here — position, timing, who was in the
room — because it is what one family member hands to the next at 4am. Good
moments should be prominent in this pack specifically.

**Deliberate delay.** These six were held back so they could be written after
watching the v0.7 packs meet real use. Whatever that teaches should change
how these get built. If it doesn't, the delay was wasted.

---

## v1.0 — Close the verification gaps

The bar shifts here. Not "does it work" but "can this hold someone's medical
record for three years without being touched."

### Caregiver visibility, verified against the real worker

Still never tested end to end. The filter is enforced server-side in
`handleSync`, and the client-side resolution is covered by tests, but nobody
has signed in as a caregiver and confirmed a family-only entry is genuinely
absent from their sync payload.

The mock server used in development is a separate reimplementation and
therefore proves nothing about `worker.js`.

Needs: a real invite, a real second account, a real payload inspected. This
is the one guarantee in the app where a bug is quiet and harmful rather than
obvious.

### Archive sealing, exercised with real data

The monthly cron has never fired. The whole archive path is untested against
real KV:

- sealing a closed month
- the resumable partial case (`complete: false`, re-run until done)
- backfill on a fresh device

This is what keeps year two from breaking. Force a run with real data rather
than waiting for the cron.

### Permanence audit

Last chance to rename anything before ids are locked by real history.

---

## Standing constraints

Things that must stay true regardless of version.

- **Entries are write-once.** An edit is a new entry superseding the old; a
  delete is a tombstone. This is what makes concurrent writes safe on KV and
  gives an audit trail for free. Never introduce an in-place update.
- **Tile ids are permanent.** Once shipped and referenced by real entries,
  they cannot be renamed.
- **Family-only content leaves no trace for caregivers.** No count, no
  placeholder, no gap. A visible "2 notes hidden" marker is worse than either
  extreme: the aide then knows the family is talking about them and cannot
  see it. Absence must be indistinguishable from nothing existing.
- **A tap is not a commit.** Opening the form writes nothing. Save commits.
  A care record must not accumulate phantom entries from pocket taps.
- **Writes resolve on transaction commit**, never on request success, or a
  reload can lose an acknowledged write.
- **Only shell paths are cached** by the service worker. Never API responses:
  a cache hit looks like a healthy 200, so a stale `/sync` would freeze the
  log with no error anywhere.
- **Days are computed in the recipient's time zone**, never the device's.
- **Bump `CACHE` in `sw.js` on every deploy**, or returning devices keep
  running old code.

---

## Open questions

- Cancer: treatment-start anchor, or cycle field on entries?
- Cancer: how far does the app go in naming emergency thresholds?
- Autism: how much copy changes when the subject is the user's own child?
- Photos (R2) are still unbuilt. Which release?
- Medication schedule / MAR grid — deliberately deferred until a household
  asks for it. Still deferred?
