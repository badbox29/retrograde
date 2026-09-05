/**
 * units.js — one number, two readers, no ambiguity.
 *
 * STORE CANONICAL, DISPLAY CONVERTED.
 *
 * This is a correctness rule, not a formatting preference. If Dana types
 * 101.2 on a device set to Fahrenheit and the app stores 101.2, then when
 * Marcus opens the same entry on a device set to Celsius there is nothing
 * in the record that says which one it was. A bare number in a care log is
 * unreadable and occasionally dangerous.
 *
 * So: stored values are always canonical (metric). The toggle changes
 * rendering only. Store 38.4; show Dana 101.2 °F and Marcus 38.4 °C. Same
 * entry, both correct, neither of them thinking about it.
 *
 * THE PREFERENCE BELONGS TO THE READER.
 *
 * Device-level, never per-recipient. A night aide and a daughter can want
 * different units for the same person and both be right.
 *
 * NEVER STORE A ROUNDED VALUE.
 *
 * Round at display only. 101.2 °F is 38.444… °C; store that, and it comes
 * back as 101.2. Store 38.4 and it comes back as 101.1, and it will drift
 * a little further every time somebody edits it.
 */
const Units = (() => {

  /**
   * A quantity, not a unit. Packs declare `{ field: 'temperature' }` and
   * never mention °F anywhere — that is what keeps conversion in one place.
   *
   * Keys here are as permanent as tile ids: they end up in entry.fields.
   */
  const REGISTRY = {
    temperature: {
      label: 'Temperature',
      canonical: 'C',
      units: {
        C: { symbol: '°C', to: v => v,                from: v => v,                step: 0.1, decimals: 1 },
        F: { symbol: '°F', to: v => v * 9 / 5 + 32,   from: v => (v - 32) * 5 / 9, step: 0.1, decimals: 1 },
      },
    },

    mass: {
      label: 'Weight',
      canonical: 'kg',
      units: {
        kg: { symbol: 'kg', to: v => v,          from: v => v,          step: 0.1,  decimals: 1 },
        lb: { symbol: 'lb', to: v => v * 2.20462, from: v => v / 2.20462, step: 0.1, decimals: 1 },
      },
    },

    volume: {
      label: 'Fluid',
      canonical: 'mL',
      units: {
        mL:   { symbol: 'mL',    to: v => v,           from: v => v,           step: 5, decimals: 0 },
        floz: { symbol: 'fl oz', to: v => v / 29.5735, from: v => v * 29.5735, step: 1, decimals: 1 },
      },
    },

    length: {
      label: 'Length',
      canonical: 'cm',
      units: {
        cm: { symbol: 'cm', to: v => v,        from: v => v,        step: 0.5, decimals: 1 },
        in: { symbol: 'in', to: v => v / 2.54, from: v => v * 2.54, step: 0.25, decimals: 2 },
      },
    },

    // The hard one. mmol/L and mg/dL are not two names for the same habit,
    // they are two clinical worlds — and the conversion factor is specific
    // to glucose's molar mass, not a general rule. Anyone reading a log in
    // the wrong one will misjudge it badly, because 5 and 90 are both
    // normal and 5 mg/dL is not a number a living person produces.
    glucose: {
      label: 'Blood glucose',
      canonical: 'mmol/L',
      units: {
        'mmol/L': { symbol: 'mmol/L', to: v => v,          from: v => v,          step: 0.1, decimals: 1 },
        'mg/dL':  { symbol: 'mg/dL',  to: v => v * 18.0182, from: v => v / 18.0182, step: 1, decimals: 0 },
      },
    },

    // No conversion exists. mmHg everywhere, and the field is a pair.
    pressure: {
      label: 'Blood pressure',
      canonical: 'mmHg',
      units: {
        mmHg: { symbol: 'mmHg', to: v => v, from: v => v, step: 1, decimals: 0 },
      },
    },
  };

  /**
   * The US/metric toggle is a PRESET, not a lock. It sets every quantity at
   * once because that matches how people think, but each one can then be
   * changed on its own — somebody may reasonably want °F alongside mL for
   * medication doses.
   */
  const PRESETS = {
    metric: { temperature: 'C', mass: 'kg', volume: 'mL',   length: 'cm', glucose: 'mmol/L', pressure: 'mmHg' },
    us:     { temperature: 'F', mass: 'lb', volume: 'floz', length: 'in', glucose: 'mg/dL',  pressure: 'mmHg' },
  };

  let prefs = { ...PRESETS.metric };

  async function load() {
    const saved = await Store.kvGet('units');
    if (saved) { prefs = { ...PRESETS.metric, ...saved }; return prefs; }
    // First run: guess from the device, because the person who has to
    // correct it is the one least likely to know where the setting is.
    const region = (Intl.DateTimeFormat().resolvedOptions().locale || '').toUpperCase();
    const isUS = /-US$|^EN-US/.test(region) || /US|LR|MM/.test(region.split('-')[1] || '');
    prefs = { ...PRESETS[isUS ? 'us' : 'metric'] };
    await save();
    return prefs;
  }

  async function save() { await Store.kvSet('units', prefs); }

  function get(quantity)      { return prefs[quantity] || REGISTRY[quantity]?.canonical; }
  function all()              { return { ...prefs }; }

  async function set(quantity, unit) {
    if (!REGISTRY[quantity]?.units[unit]) return false;
    prefs[quantity] = unit;
    await save();
    return true;
  }

  async function applyPreset(name) {
    if (!PRESETS[name]) return false;
    prefs = { ...PRESETS[name] };
    await save();
    return true;
  }

  /** Which preset the current settings match, or null if they are mixed. */
  function currentPreset() {
    for (const [name, p] of Object.entries(PRESETS)) {
      if (Object.keys(p).every(k => prefs[k] === p[k])) return name;
    }
    return null;
  }

  function unitDef(quantity, unit) {
    const q = REGISTRY[quantity];
    if (!q) return null;
    return q.units[unit || get(quantity)] || q.units[q.canonical];
  }

  function symbol(quantity, unit) { return unitDef(quantity, unit)?.symbol || ''; }

  /** Canonical → the reader's unit. Unrounded; round only when formatting. */
  function toDisplay(quantity, canonicalValue, unit) {
    if (canonicalValue == null || !Number.isFinite(canonicalValue)) return null;
    const d = unitDef(quantity, unit);
    return d ? d.to(canonicalValue) : canonicalValue;
  }

  /** What the person typed → canonical, for storage. Never rounded. */
  function toCanonical(quantity, displayValue, unit) {
    if (displayValue == null || displayValue === '') return null;
    const n = typeof displayValue === 'number' ? displayValue : parseFloat(displayValue);
    if (!Number.isFinite(n)) return null;
    const d = unitDef(quantity, unit);
    return d ? d.from(n) : n;
  }

  /**
   * The string that appears in the log, on a printout, and in an export.
   * The symbol is never optional — a temperature handed to a doctor with no
   * unit next to it is a genuine hazard.
   */
  function format(quantity, canonicalValue, unit) {
    const v = toDisplay(quantity, canonicalValue, unit);
    if (v == null) return '';
    const d = unitDef(quantity, unit);
    return `${v.toFixed(d?.decimals ?? 1)} ${d?.symbol || ''}`.trim();
  }

  /**
   * Threshold comparison happens in CANONICAL units, always.
   *
   * Comparing against a converted display value is the bug that works fine
   * until somebody changes their toggle: 38 °C is 100.4 °F, and a threshold
   * written as "38" tested against a Fahrenheit reading would fire on
   * essentially every entry.
   */
  function crosses(threshold, canonicalValue) {
    if (!threshold || canonicalValue == null) return false;
    if (threshold.above != null && canonicalValue >= threshold.above) return true;
    if (threshold.below != null && canonicalValue <= threshold.below) return true;
    return false;
  }

  return {
    REGISTRY, PRESETS,
    load, save, get, all, set, applyPreset, currentPreset,
    symbol, unitDef, toDisplay, toCanonical, format, crosses,
  };
})();
