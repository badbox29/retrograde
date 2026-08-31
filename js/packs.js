/**
 * packs.js — what the home screen offers.
 *
 * A pack is data, never code. Nothing anywhere else in the app knows
 * whether it is running a newborn log or a dementia log; it only knows
 * about tiles. Enable several at once — someone caring for a parent with
 * dementia and diabetes turns on two and gets one merged grid.
 *
 * Tile shape
 *   id        stored as entry.kind — never change one after it ships
 *   label     what the button says
 *   icon      sprite id from index.html
 *   tone      'good' | 'hard' | undefined — colour and behaviour
 *   pool      hard tiles sharing a pool share their "what worked" history,
 *             because whatever settles him during sundowning usually
 *             settles him when he's agitated too
 *   quick     one-tap detail chips, written into entry.fields.detail
 *   prompt    placeholder for the free-text box
 */
const Packs = (() => {

  const ALL = [
    {
      id: 'basics',
      label: 'The basics',
      note: 'Always on. Eating, medicine, sleep, bathroom.',
      locked: true,
      tiles: [
        { id: 'meal',    label: 'Meal',     icon: 'i-meal',
          quick: ['Ate it all', 'Most of it', 'A few bites', 'Refused'],
          prompt: 'What did they have?' },
        { id: 'drink',   label: 'Drink',    icon: 'i-drink',
          quick: ['Good amount', 'A little', 'Refused'] },
        { id: 'meds',    label: 'Medicine', icon: 'i-meds',
          quick: ['Took it', 'Refused', 'Spat it out', 'Given late'],
          prompt: 'Which one, and anything unusual?' },
        { id: 'sleep',   label: 'Sleep',    icon: 'i-sleep',
          quick: ['Slept through', 'Woke once', 'Up a lot', 'Barely slept'] },
        { id: 'bath',    label: 'Bathroom', icon: 'i-bath',
          quick: ['Fine', 'Needed help', 'Accident'] },
        { id: 'note',    label: 'Note',     icon: 'i-note',
          prompt: 'Anything worth writing down.' },
      ],
    },

    {
      id: 'memory',
      label: 'Memory & mood',
      note: 'Confusion, agitation, sundowning, and the good hours too.',
      tiles: [
        { id: 'confused',   label: 'Confused',    icon: 'i-fog',    tone: 'hard', pool: 'distress',
          quick: ['About where', 'About when', "Didn't know someone", 'Looking for someone'],
          prompt: 'What was going on?' },
        { id: 'agitated',   label: 'Agitated',    icon: 'i-storm',  tone: 'hard', pool: 'distress',
          quick: ['Restless', 'Angry', 'Shouting', 'Wouldn\u2019t settle'],
          prompt: 'What seemed to set it off?' },
        { id: 'sundown',    label: 'Sundowning',  icon: 'i-dusk',   tone: 'hard', pool: 'distress',
          prompt: 'What was it like this evening?' },
        { id: 'repeating',  label: 'Repeating',   icon: 'i-repeat', tone: 'hard', pool: 'distress',
          prompt: 'What was on their mind?' },
        { id: 'wandering',  label: 'Wandering',   icon: 'i-wander', tone: 'hard', pool: 'distress',
          quick: ['Around the house', 'Tried to go out', 'Got outside'],
          prompt: 'Where were they trying to go?' },
        { id: 'goodmoment', label: 'Good moment', icon: 'i-sun',    tone: 'good',
          prompt: 'Worth keeping. What happened?' },
      ],
    },

    {
      id: 'body',
      label: 'Body & safety',
      note: 'Pain, temperature, falls, moving around.',
      tiles: [
        { id: 'pain',  label: 'Pain',   icon: 'i-pain', tone: 'hard', pool: 'body',
          quick: ['Mild', 'Bad', 'Very bad'], prompt: 'Where, and how long?' },
        { id: 'temp',  label: 'Temp',   icon: 'i-temp', prompt: 'Reading, and how they seemed.' },
        { id: 'fall',  label: 'Fall',   icon: 'i-fall', tone: 'hard', pool: 'body',
          quick: ['No injury', 'Bruised', 'Cut', 'Called someone'],
          prompt: 'What happened, and what did you do?' },
        { id: 'walk',  label: 'Walk',   icon: 'i-walk',
          quick: ['On their own', 'With an arm', 'Used the walker'] },
      ],
    },

    {
      id: 'social',
      label: 'People & outings',
      note: 'Visits, trips out, phone calls.',
      tiles: [
        { id: 'visit',  label: 'Visit',  icon: 'i-visit',  prompt: 'Who came by?' },
        { id: 'outing', label: 'Outing', icon: 'i-outing', prompt: 'Where did you go?' },
        { id: 'mood',   label: 'Mood',   icon: 'i-mood',
          quick: ['Bright', 'Quiet', 'Flat', 'Tearful', 'Anxious'] },
      ],
    },

    {
      id: 'infant',
      label: 'Baby care',
      note: 'Feeds, nappies, naps, firsts. Turn this on instead of the others.',
      tiles: [
        { id: 'feed',      label: 'Feed',      icon: 'i-drink',
          quick: ['Breast', 'Bottle', 'Solids'], prompt: 'How much, how long?' },
        { id: 'diaper',    label: 'Nappy',     icon: 'i-bath',
          quick: ['Wet', 'Dirty', 'Both', 'Dry'] },
        { id: 'nap',       label: 'Nap',       icon: 'i-sleep', prompt: 'How long?' },
        { id: 'milestone', label: 'First',     icon: 'i-sun', tone: 'good',
          prompt: 'What did they do for the first time?' },
      ],
    },
  ];

  const DEFAULT_PACKS = ['basics', 'memory'];

  function byId(packId) { return ALL.find(p => p.id === packId) || null; }

  /** Every tile from the enabled packs, in pack order, deduped. */
  function tilesFor(enabled) {
    // A brand new log arrives with packs: []. That means "nobody has chosen
    // yet", not "show nothing" — an empty home screen would be a dead end.
    const chosen = enabled?.length ? enabled : DEFAULT_PACKS;
    const on     = new Set([...chosen, 'basics']);
    const seen = new Set();
    const out  = [];
    for (const pack of ALL) {
      if (!on.has(pack.id)) continue;
      for (const t of pack.tiles) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(t);
      }
    }
    return out;
  }

  /** Tile definition for a kind, from any pack, enabled or not — old
   *  entries must keep rendering after a pack is switched off. */
  function tile(kind) {
    for (const p of ALL) {
      const t = p.tiles.find(x => x.id === kind);
      if (t) return t;
    }
    return { id: kind, label: kind, icon: 'i-note' };
  }

  function label(kind) { return tile(kind).label; }
  function tone(kind)  { return tile(kind).tone || null; }

  /** Kinds whose "what worked" notes are worth showing on this one. */
  function poolFor(kind) {
    const t = tile(kind);
    if (!t.pool) return [kind];
    const out = [];
    for (const p of ALL) for (const x of p.tiles) if (x.pool === t.pool) out.push(x.id);
    return out;
  }

  return { ALL, DEFAULT_PACKS, byId, tilesFor, tile, label, tone, poolFor };
})();
