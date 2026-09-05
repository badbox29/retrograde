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
 *   help      what the term means and what to look for. Shown behind a
 *             "What is this?" link on the form, and collected into a
 *             glossary on printouts. Descriptive, never diagnostic:
 *             "look for", not "if you see this it means".
 *   field     a unit registry quantity ('temperature', 'glucose', ...).
 *             Declares the QUANTITY, never a unit — conversion lives in
 *             units.js and no pack ever mentions °F.
 *   threshold { above | below, note, source } in CANONICAL units. Shown
 *             when the entry is written, never when reading old ones.
 *   marks     'cycle_start' — this tile anchors cancer cycle-day counting
 */
const Packs = (() => {

  const ALL = [
    {
      id: 'basics',
      label: 'The basics',
      note: 'Always on. Eating, medicine, sleep, bathroom.',
      locked: true,
      tiles: [
        { id: 'meal',
          help: 'Anything they ate, and how much of it. Look for meals gradually getting smaller, food being pushed away, trouble with cutlery, or coughing while eating — that last one is worth mentioning to a doctor.',    label: 'Meal',     icon: 'i-meal',
          quick: ['Ate it all', 'Most of it', 'A few bites', 'Refused'],
          prompt: 'What did they have?' },
        { id: 'drink',
          help: 'How much they drank. Dehydration comes on quietly in older people and often shows up as new confusion, sleepiness or a dry mouth rather than thirst.',   label: 'Drink',    icon: 'i-drink',
          quick: ['Good amount', 'A little', 'Refused'] },
        { id: 'medication',
          help: 'What was taken, and anything unusual about it. Worth noting refusals, spitting out, doses given late, and any doubt about whether a dose was taken at all — uncertainty is information.', label: 'Medicine', icon: 'i-meds',
          quick: ['Took it', 'Refused', 'Spat it out', 'Given late'],
          prompt: 'Which one, and anything unusual?' },
        { id: 'sleep',
          help: 'How the night went. Look for how often they woke, whether they got up, and whether they slept during the day instead, which often explains a difficult night.',   label: 'Sleep',    icon: 'i-sleep',
          quick: ['Slept through', 'Woke once', 'Up a lot', 'Barely slept'] },
        { id: 'bathroom',
          help: 'How it went, and what help was needed. New accidents, pain or a change in pattern can be the first sign of an infection, which in older people often shows as confusion before anything else.', label: 'Bathroom', icon: 'i-bath',
          quick: ['Fine', 'Needed help', 'Accident'] },
        { id: 'note',
          help: 'Anything that does not fit another button. Use it freely — an odd detail written down now often turns out to matter later.',    label: 'Note',     icon: 'i-note',
          prompt: 'Anything worth writing down.' },
      ],
    },

    {
      id: 'memory',
      label: 'Memory & mood',
      note: 'Confusion, agitation, sundowning, and the good hours too.',
      tiles: [
        { id: 'confused',
          help: 'Not knowing where they are, what time it is, or who someone is. Look for asking the same orienting question repeatedly, mistaking one person for another, or thinking they are somewhere they lived years ago.',   label: 'Confused',    icon: 'i-fog',    tone: 'hard', pool: 'distress',
          quick: ['About where', 'About when', "Didn't know someone", 'Looking for someone'],
          prompt: 'What was going on?' },
        { id: 'agitated',
          help: 'Distress that comes out as restlessness, anger or refusal. Look for pacing, repeated attempts to leave, raised voice, pushing help away, or being unable to settle to anything.',   label: 'Agitated',    icon: 'i-storm',  tone: 'hard', pool: 'distress',
          quick: ['Restless', 'Angry', 'Shouting', 'Wouldn\u2019t settle'],
          prompt: 'What seemed to set it off?' },
        { id: 'sundowning',
          help: 'Confusion and agitation that get worse in the late afternoon and evening. Look for it starting around the same time each day, often as the light drops — restlessness, wanting to go home while already home, or looking for someone who is not there. Putting lights on before dusk rather than after often helps more than anything else.', label: 'Sundowning',  icon: 'i-dusk',   tone: 'hard', pool: 'distress',
          prompt: 'What was it like this evening?' },
        { id: 'repeating',
          help: 'The same question, story or action over and over. It usually means the underlying feeling has not been answered, even though the question has. Look for what the repetition is really asking about — often safety, or where someone is.',  label: 'Repeating',   icon: 'i-repeat', tone: 'hard', pool: 'distress',
          prompt: 'What was on their mind?' },
        { id: 'wandering',
          help: 'Moving with purpose but no safe destination. Look for going towards doors, trying to leave at a particular time of day, or setting off to somewhere from their past. Note where they were trying to get to — that is usually the useful part.',  label: 'Wandering',   icon: 'i-wander', tone: 'hard', pool: 'distress',
          quick: ['Around the house', 'Tried to go out', 'Got outside'],
          prompt: 'Where were they trying to go?' },
        { id: 'good_moment',
          help: 'A moment worth keeping. Recognising someone, finishing a story, laughing, enjoying music. Log these as deliberately as the hard ones — a record of only decline is one nobody keeps up, and these are what families reread.', label: 'Good moment', icon: 'i-sun',   tone: 'good',
          prompt: 'Worth keeping. What happened?' },
      ],
    },

    {
      id: 'body',
      label: 'Body & safety',
      note: 'Pain, temperature, falls, moving around.',
      tiles: [
        { id: 'pain',
          help: 'Where it hurts and how much. Someone with dementia may not say they are in pain. Look instead for guarding a part of the body, wincing on movement, new agitation, or refusing something they normally accept.',  label: 'Pain',   icon: 'i-pain', tone: 'hard', pool: 'body',
          quick: ['Mild', 'Bad', 'Very bad'], prompt: 'Where, and how long?' },
        { id: 'temperature', label: 'Temp', icon: 'i-temp',
          field: 'temperature',
          help: 'A temperature reading, and how they seemed in themselves. In older people a normal reading does not rule out infection — new confusion or drowsiness can appear before any fever does.',
          prompt: 'Reading, and how they seemed.' },
        { id: 'fall',
          help: 'Any fall, including ones with no injury. Log near-misses too. Look for a pattern in time of day, footwear, lighting or a particular route through the house — that pattern is what prevents the next one.',  label: 'Fall',   icon: 'i-fall', tone: 'hard', pool: 'body',
          quick: ['No injury', 'Bruised', 'Cut', 'Called someone'],
          prompt: 'What happened, and what did you do?' },
        { id: 'walk',
          help: 'How they moved about and what help was needed. Look for new unsteadiness, holding furniture, shuffling, or hesitating at thresholds and changes in floor surface.',  label: 'Walk',   icon: 'i-walk',
          quick: ['On their own', 'With an arm', 'Used the walker'] },
      ],
    },

    {
      id: 'social',
      label: 'People & outings',
      note: 'Visits, trips out, phone calls.',
      tiles: [
        { id: 'visit',
          help: 'Who came, and how it went. Worth noting whether they recognised the visitor and how they were afterwards — visits can lift a day or unsettle an evening.',  label: 'Visit',  icon: 'i-visit',  prompt: 'Who came by?' },
        { id: 'outing',
          help: 'Where you went and how it went. Note what made it easier or harder: time of day, how busy it was, how long you were out.', label: 'Outing', icon: 'i-outing', prompt: 'Where did you go?' },
        { id: 'mood',
          help: 'The overall feel of the day. Look for changes in how much they engaged rather than a single moment — flatness, withdrawal or new tearfulness are worth mentioning to a doctor if they persist.',   label: 'Mood',   icon: 'i-mood',
          quick: ['Bright', 'Quiet', 'Flat', 'Tearful', 'Anxious'] },
      ],
    },


    {
      id: 'cancer',
      label: 'Cancer treatment',
      note: 'Chemo cycles, side effects, and the symptoms that need a phone call.',
      tiles: [
        { id: 'cancer_cycle_start',
          help: 'Log this on the day of the infusion. Everything after it is counted from here, so side effects read as “day 3” rather than a calendar date — which is how the oncology team will ask about them.', label: 'Cycle start', icon: 'i-cycle',
          marks: 'cycle_start',
          prompt: 'Which cycle, and anything the team said.' },

        // Neutropenic fever. The one place this app says "consider calling",
        // and it does so because the number came from their own oncologist,
        // not from us.
        { id: 'temperature', label: 'Temp', icon: 'i-temp',
          field: 'temperature',
          help: 'A temperature reading during treatment. This matters more than usual: chemotherapy lowers the white cells that fight infection, so a fever during the low-count window is treated as an emergency rather than something to watch. Take a reading whenever they seem off, not only when they feel hot.',
          threshold: {
            above: 38,
            note: 'Chemotherapy guidance commonly treats a temperature over 38 °C as urgent, especially during the low-count window. Consider notifying their care team.',
            source: 'Standard neutropenic fever guidance',
          },
          prompt: 'How were they in themselves?' },

        { id: 'nausea',
          help: 'Sickness or queasiness. Note when it started relative to the infusion and whether anti-sickness medication helped, because the pattern is what gets the prescription adjusted.', label: 'Nausea', icon: 'i-nausea', tone: 'hard', pool: 'chemo',
          quick: ['Queasy', 'Was sick', 'Could not keep food down'],
          prompt: 'When did it start, and what had they eaten?' },
        { id: 'fatigue',
          help: 'Chemotherapy fatigue is not ordinary tiredness and does not lift with sleep. Look for needing to rest after small tasks, or a day where getting up was not possible. Note what they could still manage — that is the useful measure.', label: 'Fatigue', icon: 'i-battery', tone: 'hard', pool: 'chemo',
          quick: ['Slower than usual', 'Needed to rest', 'Could not get up'] },
        { id: 'mouth_sores',
          help: 'Soreness or ulcers in the mouth, common a few days after treatment. Look for avoiding certain foods, drinking less, or changed speech. Worth reporting early, because it is easier to treat before it stops them eating.', label: 'Mouth', icon: 'i-mouth', tone: 'hard', pool: 'chemo',
          quick: ['Sore', 'Ulcers', 'Hard to eat'] },
        { id: 'neuropathy',
          help: 'Tingling, numbness or clumsiness in the hands and feet, caused by some chemotherapy drugs. Look for dropping things, trouble with buttons, or not feeling the floor properly. Report it — doses are often adjusted based on this, and it is easier to prevent than reverse.', label: 'Hands & feet', icon: 'i-tingle', tone: 'hard', pool: 'chemo',
          quick: ['Tingling', 'Numb', 'Dropping things'],
          prompt: 'Worth reporting — this one is tracked over time.' },
        { id: 'appetite',
          help: 'How much they wanted to eat, and whether food tasted right. Taste changes are common and specific — a food they normally like tasting metallic or of nothing is worth writing down.', label: 'Appetite', icon: 'i-meal',
          quick: ['Normal', 'Poor', 'Nothing at all', 'Tastes wrong'] },
        { id: 'weight',
          help: 'Weight over time. Steady loss matters more than any single reading, and it is one of the things a team will ask about directly.', label: 'Weight', icon: 'i-scale', field: 'mass' },
        { id: 'good_moment',
          help: 'A moment worth keeping. Recognising someone, finishing a story, laughing, enjoying music. Log these as deliberately as the hard ones — a record of only decline is one nobody keeps up, and these are what families reread.', label: 'Good moment', icon: 'i-sun', tone: 'good',
          prompt: 'Worth keeping. What happened?' },
      ],
    },

    {
      id: 'diabetes',
      label: 'Diabetes',
      note: 'Blood sugar, insulin, hypos and hypers.',
      tiles: [
        { id: 'diabetes_glucose',
          help: 'A blood sugar reading. Note what was happening around it — before or after a meal, bedtime, or because they felt wrong — because a number without context is hard for anyone to act on.', label: 'Blood sugar', icon: 'i-drop',
          field: 'glucose',
          quick: ['Before a meal', 'After a meal', 'Bedtime', 'Felt wrong'],
          threshold: {
            below: 3.9,
            note: 'Below about 3.9 mmol/L (70 mg/dL) is usually treated as a hypo. Follow whatever plan their team gave, and consider notifying them if it keeps happening.',
            source: 'Common hypoglycaemia threshold',
          } },

        // Hypo and hyper are separate tiles rather than one "reading out of
        // range", because what you do about them could not be more different.
        { id: 'diabetes_hypo',
          help: 'Blood sugar too low. Look for shakiness, sweating, sudden irritability, pallor, or confusion that comes on fast. It can look like drunkenness. Treat it first, log it after, and note how long it took to lift.', label: 'Hypo', icon: 'i-down', tone: 'hard', pool: 'glycaemic',
          quick: ['Shaky', 'Sweaty', 'Confused', 'Needed help'],
          prompt: 'What did they have, and how long until it lifted?' },
        { id: 'diabetes_hyper',
          help: 'Blood sugar too high. Look for thirst, needing the toilet more, tiredness and blurred vision. It comes on over hours rather than minutes, so a pattern over several days is more telling than one reading.', label: 'High', icon: 'i-up', tone: 'hard', pool: 'glycaemic',
          quick: ['Thirsty', 'Tired', 'Up in the night'] },
        { id: 'diabetes_insulin',
          help: 'Which insulin and how many units. Note anything unusual: a missed dose, a correction, or a dose given at a different time — those are the entries that explain a strange reading later.', label: 'Insulin', icon: 'i-syringe',
          quick: ['With a meal', 'Correction', 'Long-acting'],
          prompt: 'Which one and how many units.' },
        { id: 'diabetes_feet',
          help: 'Daily foot checks are standard advice in diabetes because reduced sensation means an injury can go unnoticed. Look for redness, breaks in the skin, swelling, or anything they cannot feel. Report a sore rather than watching it.', label: 'Feet', icon: 'i-foot',
          quick: ['Checked, fine', 'Redness', 'A sore', 'Numbness'],
          prompt: 'Checked daily is the advice. Anything new?' },
      ],
    },

    {
      id: 'autism',
      label: 'Autism',
      note: 'Pattern-hunting: what came before, what helped, what changed.',
      tiles: [
        // The whole pack is built around the sequence antecedent → event →
        // what helped, because that sequence is the thing a parent is
        // actually trying to see. Every hard tile here shares one pool, so
        // whatever regulated a meltdown surfaces on a shutdown too.
        { id: 'autism_meltdown',
          help: 'An involuntary response to being overwhelmed — not a tantrum, and not something being chosen. Look for what happened in the ten minutes before: noise, a change of plan, a demand, hunger, or a build-up across the whole day. The trigger is often not the last thing that happened.', label: 'Meltdown', icon: 'i-storm',
          tone: 'hard', pool: 'dysregulation',
          quick: ['Sudden', 'Built up slowly', 'After a change', 'After a demand'],
          prompt: 'What was happening in the ten minutes before?' },
        { id: 'autism_shutdown',
          help: 'The quieter form of being overwhelmed. Instead of an outburst, everything switches off — going still, stopping speaking, hiding. Easy to read as sulking or as being fine. Look for reduced speech, not responding, or wanting to be under something.', label: 'Shutdown', icon: 'i-fog',
          tone: 'hard', pool: 'dysregulation',
          quick: ['Went quiet', 'Would not move', 'Hid'],
          prompt: 'What was happening in the ten minutes before?' },
        { id: 'autism_sensory',
          help: 'Sensory input that has become too much. Note which sense: noise, light, crowding, touch, smell, or clothing. This is often the most useful thing in the whole log, because it is the one somebody can go and change.', label: 'Too much', icon: 'i-waves',
          tone: 'hard', pool: 'dysregulation',
          quick: ['Noise', 'Light', 'Crowd', 'Touch', 'Smell', 'Clothes'],
          prompt: 'Which sense, and how bad?' },
        { id: 'autism_transition',
          help: 'Moving from one thing to another — often harder than either activity. Note whether a warning was given and how much, since that is usually the difference between a transition going well and not.', label: 'Transition', icon: 'i-arrow-swap',
          tone: 'hard', pool: 'dysregulation',
          quick: ['Went fine', 'Warning helped', 'Refused', 'No warning given'],
          prompt: 'From what, to what?' },
        { id: 'autism_stimming',
          help: 'Repetitive movement or sound that helps with regulation. Neutral by default: log it as information, not a problem. An increase often signals rising stress before anything else shows.', label: 'Stimming', icon: 'i-wave',
          quick: ['Happy', 'Regulating', 'More than usual'],
          prompt: 'Neutral by default — worth logging as information, not a problem.' },
        { id: 'autism_regulated',
          help: 'What brought them back. Position, pressure, a place, quiet, a person, a specific object. This is the entry that gets reread most — it is what one person hands to the next.', label: 'Regulated', icon: 'i-anchor', tone: 'good',
          prompt: 'What brought them back? This is the one that gets reread.' },
        { id: 'autism_communication',
          help: 'How they communicated today: speech, a device, signing, or not speaking. Note it without judgement. Speech dropping away is often a sign of load rather than of ability.', label: 'Communication', icon: 'i-speech',
          quick: ['Spoke', 'Used device', 'Signed', 'Non-speaking today'] },
        { id: 'autism_win',
          help: 'Something that went well. Worth logging as deliberately as the hard moments, both because it is a record worth keeping and because it shows what conditions were in place when things worked.', label: 'Win', icon: 'i-sun', tone: 'good',
          prompt: 'Something that went well.' },
      ],
    },


    {
      id: 'checkin',
      label: 'Check-in (self-report)',
      note: 'For the person being cared for to say how they are, in one tap. Turns on the simplified screen for anyone in the self role.',
      selfReport: true,
      tiles: [
        // FEELINGS — ordered settled to overwhelmed, not alphabetically.
        // Intensity ordering is a property of the shipped set: a family who
        // hides two thirds of a category should still find what they kept
        // in a sensible order.
        { id: 'feel_calm',        label: 'Calm',        icon: 'f-calm',        group: 'feeling', tone: 'good' },
        { id: 'feel_happy',       label: 'Happy',       icon: 'f-happy',       group: 'feeling', tone: 'good' },
        { id: 'feel_excited',     label: 'Excited',     icon: 'f-excited',     group: 'feeling', tone: 'good' },
        { id: 'feel_silly',       label: 'Silly',       icon: 'f-silly',       group: 'feeling', tone: 'good' },
        { id: 'feel_proud',       label: 'Proud',       icon: 'f-proud',       group: 'feeling', tone: 'good' },
        { id: 'feel_okay',        label: 'Okay',        icon: 'f-okay',        group: 'feeling' },
        { id: 'feel_bored',       label: 'Bored',       icon: 'f-bored',       group: 'feeling' },
        { id: 'feel_tired',       label: 'Tired',       icon: 'f-tired',       group: 'feeling' },
        { id: 'feel_confused',    label: 'Confused',    icon: 'f-confused',    group: 'feeling' },
        { id: 'feel_worried',     label: 'Worried',     icon: 'f-worried',     group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_nervous',     label: 'Nervous',     icon: 'f-nervous',     group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_sad',         label: 'Sad',         icon: 'f-sad',         group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_crying',      label: 'Crying',      icon: 'f-crying',      group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_lonely',      label: 'Lonely',      icon: 'f-lonely',      group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_embarrassed', label: 'Embarrassed', icon: 'f-embarrassed', group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_frustrated',  label: 'Frustrated',  icon: 'f-frustrated',  group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_angry',       label: 'Angry',       icon: 'f-angry',       group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_furious',     label: 'Furious',     icon: 'f-furious',     group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_scared',      label: 'Scared',      icon: 'f-scared',      group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_overwhelmed', label: 'Too much',    icon: 'f-overwhelmed', group: 'feeling', tone: 'hard', pool: 'checkin' },
        { id: 'feel_shutdown',    label: 'Shut down',   icon: 'f-shutdown',    group: 'feeling', tone: 'hard', pool: 'checkin' },

        // BODY — what the body is doing, which is often easier to name
        // than a feeling and is the thing that gets missed.
        { id: 'body_hungry',   label: 'Hungry',       icon: 'b-hungry',   group: 'body' },
        { id: 'body_thirsty',  label: 'Thirsty',      icon: 'b-thirsty',  group: 'body' },
        { id: 'body_toilet',   label: 'Toilet',       icon: 'b-toilet',   group: 'body' },
        { id: 'body_sleepy',   label: 'Sleepy',       icon: 'b-sleepy',   group: 'body' },
        { id: 'body_itchy',    label: 'Itchy',        icon: 'b-itchy',    group: 'body' },
        { id: 'body_hot',      label: 'Too hot',      icon: 'b-hot',      group: 'body' },
        { id: 'body_cold',     label: 'Too cold',     icon: 'b-cold',     group: 'body' },
        { id: 'body_buzzing',  label: 'Buzzing',      icon: 'b-buzzing',  group: 'body' },
        { id: 'body_shaky',    label: 'Shaky',        icon: 'b-shaky',    group: 'body' },
        { id: 'body_heavy',    label: 'Heavy',        icon: 'b-heavy',    group: 'body' },
        { id: 'body_move',     label: 'Need to move', icon: 'b-move',     group: 'body' },
        { id: 'body_dizzy',    label: 'Dizzy',        icon: 'b-dizzy',    group: 'body', tone: 'hard', pool: 'checkin' },
        { id: 'body_head',     label: 'Head hurts',   icon: 'b-head',     group: 'body', tone: 'hard', pool: 'checkin' },
        { id: 'body_tummy',    label: 'Tummy hurts',  icon: 'b-tummy',    group: 'body', tone: 'hard', pool: 'checkin' },
        { id: 'body_hurts',    label: 'It hurts',     icon: 'b-hurts',    group: 'body', tone: 'hard', pool: 'checkin' },
        { id: 'body_sick',     label: 'Feel sick',    icon: 'b-sick',     group: 'body', tone: 'hard', pool: 'checkin' },
        { id: 'body_chest',    label: 'Tight chest',  icon: 'b-chest',    group: 'body', tone: 'hard', pool: 'checkin' },

        // CAUSES — the group a purely emotional vocabulary would miss, and
        // often the most actionable: "the room is too bright" is something
        // somebody can go and fix.
        { id: 'cause_loud',      label: 'Too loud',      icon: 'c-loud',      group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_bright',    label: 'Too bright',    icon: 'c-bright',    group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_crowd',     label: 'Too many people', icon: 'c-crowd',   group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_busy',      label: 'Too busy',      icon: 'c-busy',      group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_smell',     label: 'Bad smell',     icon: 'c-smell',     group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_clothes',   label: 'Clothes wrong', icon: 'c-clothes',   group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_touch',     label: 'Do not touch',  icon: 'c-touch',     group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_change',    label: 'Plan changed',  icon: 'c-change',    group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_waiting',   label: 'Waiting too long', icon: 'c-waiting', group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_upset_by',  label: 'Someone upset me', icon: 'c-upset-by', group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_dont_get',  label: 'I do not understand', icon: 'c-dont-get', group: 'cause', tone: 'hard', pool: 'checkin' },
        { id: 'cause_break',     label: 'Need a break',  icon: 'c-break',     group: 'cause' },
        { id: 'cause_alone',     label: 'Need to be alone', icon: 'c-alone',  group: 'cause' },
        { id: 'cause_help',      label: 'Need help',     icon: 'c-help',      group: 'cause', tone: 'hard', pool: 'checkin' },
      ],
    },

    {
      id: 'infant',
      label: 'Baby care',
      note: 'Feeds, diapers, naps, firsts. Turn this on instead of the others.',
      tiles: [
        { id: 'feed',
          help: 'How they fed and roughly how much. Look for changes in pattern rather than any single feed — a run of short or refused feeds is what matters.',      label: 'Feed',      icon: 'i-drink',
          quick: ['Breast', 'Bottle', 'Solids'], prompt: 'How much, how long?' },
        { id: 'diaper',
          help: 'Wet, dirty, or dry. Useful mostly as a count: how many wet diapers in a day is one of the first things a health visitor or paediatrician will ask about.',    label: 'Diaper',    icon: 'i-bath',
          quick: ['Wet', 'Dirty', 'Both', 'Dry'] },
        { id: 'nap',
          help: 'When and how long. Note where they slept and what settled them — that detail is what the next person needs at 2am.',       label: 'Nap',       icon: 'i-sleep', prompt: 'How long?' },
        { id: 'milestone',
          help: 'Something for the first time. No schedule to measure against here — it is a record worth keeping.', label: 'First',     icon: 'i-sun', tone: 'good',
          prompt: 'What did they do for the first time?' },
      ],
    },
  ];

  const DEFAULT_PACKS = ['basics', 'memory'];

  /**
   * Kinds the app writes itself. They never appear as tiles, but label()
   * and tone() must still resolve them or a threaded reply renders as a raw
   * id. Kept out of ALL so they can never be enabled or curated.
   */
  const SYSTEM = [
    { id: 'thread_note', label: 'Note', icon: 'i-note' },
    // Written when somebody sees a check-in. Never a tile — nobody logs an
    // acknowledgement, they make one by responding.
    { id: 'ack',         label: 'Seen', icon: 'i-check' },
  ];

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
  /**
   * Which packs this household has on. Set once at boot.
   *
   * This matters because shared ids are deliberate: `temperature` is one id
   * whether it is logged from the body pack or the cancer pack, so switching
   * packs never fragments the record. But the two definitions differ — the
   * cancer one carries the neutropenic fever threshold — and resolving by
   * array order would either hide that threshold from a chemo household or
   * show chemo wording to a dementia one. Enabled packs win.
   */
  let ACTIVE = null;

  function setActive(enabled) {
    ACTIVE = new Set([...(enabled?.length ? enabled : DEFAULT_PACKS), 'basics']);
  }

  function tile(kind) {
    // A definition from a pack this household actually has on.
    if (ACTIVE) {
      for (const p of ALL) {
        if (!ACTIVE.has(p.id)) continue;
        const t = p.tiles.find(x => x.id === kind);
        if (t) return t;
      }
    }
    // Otherwise any definition, so an entry from a pack since switched off
    // still renders with a real label instead of a raw id.
    for (const p of ALL) {
      const t = p.tiles.find(x => x.id === kind);
      if (t) return t;
    }
    const sys = SYSTEM.find(x => x.id === kind);
    if (sys) return sys;
    // An id from a pack this build no longer ships. Render it rather than
    // lose it — ids are permanent, but the app that wrote them may not be.
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

  /** Category order for the check-in grid. Feelings first because that is
   *  what most people reach for; causes last because they are the most
   *  specific. Intensity ordering within each is the shipped tile order. */
  const GROUPS = [
    { id: 'feeling', label: 'How I feel' },
    { id: 'body',    label: 'My body' },
    { id: 'cause',   label: "What's wrong" },
  ];

  /** Tiles for the self-report screen, grouped and in shipped order. */
  function checkinGroups(overrides) {
    const pack = byId('checkin');
    if (!pack) return [];
    const tiles = withOverrides(pack.tiles, overrides);
    return GROUPS
      .map(g => ({ ...g, tiles: tiles.filter(t => t.group === g.id) }))
      .filter(g => g.tiles.length);
  }

  /** Is this kind a self-reported check-in rather than an observation? */
  function isCheckin(kind) {
    return !!byId('checkin')?.tiles.some(t => t.id === kind);
  }

  /** The unit-registry quantity this tile records, if any. */
  function field(kind) { return tile(kind).field || null; }

  /** Plain-language description of a tile, if it has one. */
  function help(kind) { return tile(kind).help || null; }

  /** Threshold declaration, in canonical units. */
  function threshold(kind) { return tile(kind).threshold || null; }

  /** Kinds that anchor cancer cycle-day counting. */
  function cycleStartKinds() {
    const out = [];
    for (const p of ALL) for (const t of p.tiles) {
      if (t.marks === 'cycle_start') out.push(t.id);
    }
    return out;
  }

  /**
   * Apply a recipient's tile overrides: rename, hide, reorder.
   *
   * Ids are permanent; labels are not. A family renaming "Bathroom" to
   * whatever they actually say breaks nothing, and hiding what they never
   * use is how the grid stays scannable rather than by capping it.
   */
  function withOverrides(tiles, overrides) {
    if (!overrides?.length) return tiles;
    const by = new Map(overrides.map(o => [o.id, o]));
    return tiles
      .filter(t => !by.get(t.id)?.hidden)
      .map(t => {
        const o = by.get(t.id);
        return o?.label ? { ...t, label: o.label } : t;
      })
      .sort((a, b) => {
        // Explicit order wins; everything else keeps its shipped position,
        // which for the check-in set is intensity within a category.
        const ao = by.get(a.id)?.order, bo = by.get(b.id)?.order;
        if (ao == null && bo == null) return 0;
        if (ao == null) return 1;
        if (bo == null) return -1;
        return ao - bo;
      });
  }

  return {
    ALL, SYSTEM, GROUPS, DEFAULT_PACKS, setActive, byId, tilesFor, tile,
    label, tone, poolFor, field, threshold, help, cycleStartKinds, withOverrides,
    checkinGroups, isCheckin,
  };
})();
