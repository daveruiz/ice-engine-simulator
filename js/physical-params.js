/**
 * PhysicalParams — parameter schema + presets for the physically informed
 * engine sound model (see js/physical-worklet.js).
 *
 * Every parameter here shows up automatically in the tuner page
 * (tuner.html) and is sent to the DSP worklet. Defaults describe a
 * cross-plane V8 muscle-car engine.
 *
 * Values live in localStorage under STORAGE_KEY so a set tuned in
 * tuner.html is picked up by the main simulator (even live, across tabs).
 */
window.PhysicalParams = (function () {
  'use strict';

  const STORAGE_KEY = 'ice-physical-params-v1';

  const GROUPS = [
    { id: 'engine',  name: 'Engine block & combustion' },
    { id: 'intake',  name: 'Intake' },
    { id: 'exhaust', name: 'Exhaust & muffler' },
    { id: 'mech',    name: 'Mechanical / valvetrain' },
    { id: 'turbo',   name: 'Turbocharger' },
    { id: 'pops',    name: 'Overrun pops' },
    { id: 'starter', name: 'Starter & ignition' },
    { id: 'out',     name: 'Output' },
    { id: 'fx',      name: 'FX bus (EQ & saturation)' },
  ];

  /**
   * type: 'range' (default) | 'select' | 'bool'
   * Physical meanings are in the `info` strings (shown as tooltips).
   */
  const SCHEMA = [
    // ---- Engine block & combustion ----
    { key: 'cylinders', group: 'engine', label: 'Cylinders',
      min: 1, max: 12, step: 1, def: 8,
      info: 'Number of cylinders. Firing is evenly spaced over the 720° four-stroke cycle.' },
    { key: 'firingPattern', group: 'engine', label: 'Exhaust bank pattern', type: 'select',
      def: 'v8-crossplane',
      options: [
        ['v8-crossplane', 'V8 cross-plane (uneven banks — burble)'],
        ['alternating', 'Alternating banks (flat-plane V)'],
        ['single', 'Single bank (inline engine)'],
        ['paired', 'Paired banks (boxer-4: 1-3 / 2-4)'],
      ],
      info: 'Which exhaust manifold each cylinder fires into. A cross-plane V8 sends an irregular pulse train down each bank — that IS the V8 burble.' },
    { key: 'fireWidth', group: 'engine', label: 'Combustion pulse width', unit: 'cycle',
      min: 0.01, max: 0.20, step: 0.005, def: 0.045,
      info: 'Duration of the exhaust blow-down pulse as a fraction of the 720° cycle. Shorter = harder, more percussive bang.' },
    { key: 'fireNoise', group: 'engine', label: 'Combustion noise mix',
      min: 0, max: 1, step: 0.01, def: 0.40,
      info: 'Turbulent noise inside each combustion pulse (vs. pure pressure bump).' },
    { key: 'variability', group: 'engine', label: 'Cycle variability',
      min: 0, max: 0.5, step: 0.01, def: 0.10,
      info: 'Random per-cylinder, per-cycle combustion strength variation. Makes idle sound alive and uneven.' },
    { key: 'idleLevel', group: 'engine', label: 'Closed-throttle combustion',
      min: 0.02, max: 0.6, step: 0.01, def: 0.22,
      info: 'Combustion amplitude at zero load (idle). Full load is always 1.' },
    { key: 'idleWobble', group: 'engine', label: 'Idle RPM wobble',
      min: 0, max: 0.06, step: 0.002, def: 0.02,
      info: 'Slow random crank-speed wobble at idle (dies out with revs/load).' },

    // ---- Intake ----
    { key: 'intakeGain', group: 'intake', label: 'Intake level',
      min: 0, max: 1.5, step: 0.01, def: 0.5,
      info: 'Loudness of induction noise (air rushing past the throttle/valves).' },
    { key: 'intakeLength', group: 'intake', label: 'Intake runner length', unit: 'm',
      min: 0.1, max: 2.0, step: 0.01, def: 0.42,
      info: 'Acoustic length of the intake tract waveguide — sets its resonance pitch.' },
    { key: 'intakeFb', group: 'intake', label: 'Intake resonance',
      min: 0, max: 0.95, step: 0.01, def: 0.5,
      info: 'How strongly the intake pipe resonates (reflection coefficient).' },
    { key: 'intakeColor', group: 'intake', label: 'Intake noise color', unit: 'Hz',
      min: 500, max: 8000, step: 50, def: 2200,
      info: 'Lowpass on the induction noise source; lower = deeper whoosh.' },

    // ---- Exhaust & muffler ----
    { key: 'runnerLength', group: 'exhaust', label: 'Header runner length', unit: 'm',
      min: 0.2, max: 1.5, step: 0.01, def: 0.55,
      info: 'Length of the exhaust manifold runners (one waveguide per bank).' },
    { key: 'runnerFb', group: 'exhaust', label: 'Header resonance',
      min: 0, max: 0.9, step: 0.01, def: 0.25,
      info: 'Reflections inside the headers. High values ring like open headers.' },
    { key: 'runnerImbalance', group: 'exhaust', label: 'Header length imbalance', unit: '×',
      min: 1.0, max: 2.5, step: 0.01, def: 1.07,
      info: 'Length of the right-bank header relative to the left. 1 = equal-length headers; large values make pulses reach the collector out of step — the unequal-length boxer rumble.' },
    { key: 'exhaustLength', group: 'exhaust', label: 'Exhaust pipe length', unit: 'm',
      min: 0.5, max: 6.0, step: 0.05, def: 2.7,
      info: 'Main exhaust pipe waveguide length — the biggest factor in the exhaust note pitch/body.' },
    { key: 'exhaustFb', group: 'exhaust', label: 'Pipe reflection',
      min: 0, max: 0.95, step: 0.01, def: 0.60,
      info: 'Energy reflected back up the pipe from the open tail (resonance strength).' },
    { key: 'exhaustLp', group: 'exhaust', label: 'Pipe damping', unit: 'Hz',
      min: 300, max: 6000, step: 50, def: 1500,
      info: 'High frequencies are absorbed by pipe walls; cutoff of the reflection lowpass.' },
    { key: 'mufflerCutoff', group: 'exhaust', label: 'Muffler cutoff', unit: 'Hz',
      min: 200, max: 4000, step: 25, def: 850,
      info: 'Absorption muffler lowpass. Lower = quiet stock exhaust, higher = sports exhaust.' },
    { key: 'straightMix', group: 'exhaust', label: 'Straight-pipe mix',
      min: 0, max: 1, step: 0.01, def: 0.30,
      info: 'Blend of unmuffled tailpipe sound. 0 = fully muffled, 1 = straight pipes.' },
    { key: 'exhaustGain', group: 'exhaust', label: 'Exhaust level',
      min: 0, max: 2, step: 0.01, def: 1.0,
      info: 'Overall exhaust loudness in the mix.' },

    // ---- Mechanical / valvetrain ----
    { key: 'mechGain', group: 'mech', label: 'Mechanical level',
      min: 0, max: 1, step: 0.01, def: 0.35,
      info: 'Piston slap / valve impacts exciting the block resonances.' },
    { key: 'tickDecay', group: 'mech', label: 'Impact ring time', unit: 'ms',
      min: 1, max: 20, step: 0.5, def: 5,
      info: 'How long each mechanical impact rings.' },
    { key: 'res1Freq', group: 'mech', label: 'Block resonance 1', unit: 'Hz',
      min: 200, max: 2000, step: 10, def: 780,
      info: 'First structural resonance of the block (dull metallic knock).' },
    { key: 'res1Gain', group: 'mech', label: 'Resonance 1 level',
      min: 0, max: 1.5, step: 0.01, def: 0.6 },
    { key: 'res2Freq', group: 'mech', label: 'Block resonance 2', unit: 'Hz',
      min: 1500, max: 8000, step: 25, def: 3900,
      info: 'Second, brighter resonance (valvetrain clatter).' },
    { key: 'res2Gain', group: 'mech', label: 'Resonance 2 level',
      min: 0, max: 1.5, step: 0.01, def: 0.25 },
    { key: 'chainGain', group: 'mech', label: 'Chain / accessory rattle',
      min: 0, max: 1, step: 0.01, def: 0.15,
      info: 'Timing chain & accessory drive rattle — random high ticks at camshaft speed, loudest off-load.' },
    { key: 'chainFreq', group: 'mech', label: 'Rattle brightness', unit: 'Hz',
      min: 2000, max: 10000, step: 100, def: 6200 },
    { key: 'chainDensity', group: 'mech', label: 'Rattle density',
      min: 0, max: 1, step: 0.01, def: 0.5 },

    // ---- Turbocharger ----
    { key: 'turbo', group: 'turbo', label: 'Turbo fitted', type: 'bool', def: 0,
      info: 'Enable the turbocharger model (off for a classic naturally aspirated V8).' },
    { key: 'whineMin', group: 'turbo', label: 'Whine at rest', unit: 'Hz',
      min: 200, max: 3000, step: 50, def: 600,
      info: 'Turbine whine frequency at zero boost.' },
    { key: 'whineMax', group: 'turbo', label: 'Whine at full spool', unit: 'Hz',
      min: 3000, max: 16000, step: 100, def: 9500,
      info: 'Turbine whine frequency at full spool (blade-pass frequency).' },
    { key: 'spoolTime', group: 'turbo', label: 'Spool-up time', unit: 's',
      min: 0.1, max: 2.0, step: 0.05, def: 0.5,
      info: 'Turbine inertia — lag between exhaust energy and boost.' },
    { key: 'whineGain', group: 'turbo', label: 'Whine level',
      min: 0, max: 1, step: 0.01, def: 0.25 },
    { key: 'hissGain', group: 'turbo', label: 'Boost hiss level',
      min: 0, max: 1, step: 0.01, def: 0.2,
      info: 'Broadband intake hiss that grows with boost.' },
    { key: 'blowoffGain', group: 'turbo', label: 'Blow-off level',
      min: 0, max: 1.5, step: 0.01, def: 0.5,
      info: 'The "psshh" when the throttle closes under boost.' },

    // ---- Overrun pops ----
    { key: 'popChance', group: 'pops', label: 'Pop probability',
      min: 0, max: 1, step: 0.01, def: 0.15,
      info: 'Chance that a cylinder cycle on overrun (closed throttle, revs up) ignites unburnt mixture in the exhaust. 0 disables pops.' },
    { key: 'popGain', group: 'pops', label: 'Pop intensity',
      min: 1, max: 6, step: 0.1, def: 3.0,
      info: 'How much louder a pop is than a normal closed-throttle pulse.' },

    // ---- Output ----
    { key: 'drive', group: 'out', label: 'Drive / saturation',
      min: 0.3, max: 6, step: 0.05, def: 1.6,
      info: 'Soft-clip drive on the mix — adds grit and glues components together.' },
    { key: 'masterLp', group: 'out', label: 'Master lowpass', unit: 'Hz',
      min: 1000, max: 16000, step: 100, def: 7500,
      info: 'Final tone control (listener distance / cabin filtering).' },
    { key: 'masterGain', group: 'out', label: 'Master level',
      min: 0, max: 2, step: 0.01, def: 1.0 },

    // ---- Starter motor & ignition (synthesized engine start) ----
    // Used when Settings → Start sound is "Synthesized": the key engages a
    // solenoid, the starter pinion meshes with the flywheel ring gear and
    // spins the crank without combustion (it slows into every compression
    // stroke), until the first cylinders fire and the engine catches.
    { key: 'crankRpm', group: 'starter', label: 'Cranking speed', unit: 'rpm',
      min: 100, max: 600, step: 10, def: 200,
      info: 'How fast the starter turns the engine over. Heavy, high-compression engines (diesels) crank slower.' },
    { key: 'crankTime', group: 'starter', label: 'Cranking time', unit: 's',
      min: 0.2, max: 3, step: 0.05, def: 0.9,
      info: 'Time on the starter before the engine catches (varies ±15% each start, like a real one).' },
    { key: 'compressionDip', group: 'starter', label: 'Compression drag',
      min: 0, max: 0.7, step: 0.01, def: 0.28,
      info: 'How much the crank slows into each compression stroke while cranking — the "rur-rur-rur". Big for few cylinders / high compression, small for V12s whose strokes overlap. Also gives the last shudder when the engine stops.' },
    { key: 'pumpLevel', group: 'starter', label: 'Unfired cylinder level',
      min: 0, max: 0.3, step: 0.005, def: 0.07,
      info: 'Air pushed through the exhaust by a cylinder that does not fire (cranking, misfires, key-off spin-down).' },
    { key: 'ringTeeth', group: 'starter', label: 'Ring gear teeth',
      min: 80, max: 220, step: 1, def: 153,
      info: 'Flywheel ring gear tooth count: the starter gear whine sits at teeth × crank revolutions per second.' },
    { key: 'starterGain', group: 'starter', label: 'Starter motor level',
      min: 0, max: 1.5, step: 0.01, def: 0.6,
      info: 'Electric motor whine, commutator buzz and gear mesh of the starter.' },
    { key: 'solenoidGain', group: 'starter', label: 'Solenoid clack level',
      min: 0, max: 1.5, step: 0.01, def: 0.7,
      info: 'Solenoid pull-in, pinion clank onto the ring gear and the release click.' },

    // ---- FX bus (post-synthesis EQ + parallel saturation) ----
    // Runs as native WebAudio nodes after the worklet (see physical.js):
    // low shelf -> mid peak -> high shelf -> parallel tanh saturation.
    { key: 'bassFreq', group: 'fx', label: 'Bass shelf frequency', unit: 'Hz',
      min: 40, max: 300, step: 5, def: 120,
      info: 'Everything below this gets the bass boost — the felt rumble lives at 50–150 Hz.' },
    { key: 'bassGain', group: 'fx', label: 'Bass boost', unit: 'dB',
      min: 0, max: 18, step: 0.5, def: 7,
      info: 'Low-shelf gain. Exaggerates the cycle-rate rumble the muffler eats.' },
    { key: 'midFreq', group: 'fx', label: 'Mid EQ frequency', unit: 'Hz',
      min: 200, max: 4000, step: 25, def: 500,
      info: 'Center of the mid peaking band.' },
    { key: 'midGain', group: 'fx', label: 'Mid EQ gain', unit: 'dB',
      min: -12, max: 12, step: 0.5, def: 0,
      info: 'Cut to remove boxiness (400–800 Hz), boost for growl.' },
    { key: 'trebleGain', group: 'fx', label: 'Treble shelf gain', unit: 'dB',
      min: -24, max: 12, step: 0.5, def: 0,
      info: 'High shelf at 4.5 kHz — tame hiss/rattle or add edge.' },
    { key: 'satDrive', group: 'fx', label: 'Saturation drive',
      min: 1, max: 10, step: 0.1, def: 2.5,
      info: 'tanh drive of the saturated path. Adds harmonics that make the bass audible on small speakers.' },
    { key: 'satMix', group: 'fx', label: 'Saturation mix',
      min: 0, max: 1, step: 0.01, def: 0.35,
      info: 'Parallel blend: 0 = clean, 1 = fully saturated. Parallel keeps combustion transients punchy.' },
  ];

  /**
   * Listening positions: where the listener's ears are relative to the
   * engine. Each one is a set of *relative* modifiers layered on top of
   * whatever engine parameters are active (a preset or a tuned set), so
   * the same position works for every engine automatically:
   *
   *   mods  — per-parameter { mul, add } applied to the engine params
   *           (which sources reach the ear, how bright, how much bass);
   *           results are clamped to the schema range.
   *   space — the acoustic path after synthesis (native WebAudio nodes in
   *           physical.js): a transmission lowpass, a low "boom"
   *           resonance and a generated room/street impulse response.
   *
   * 'original' is the untouched model (as heard next to the engine).
   */
  const LISTENERS = [
    {
      id: 'original', name: 'Original', short: 'ORIGINAL',
      desc: 'The raw engine model, as tuned — like standing right next to the engine.',
      mods: {},
      space: null,
    },
    {
      id: 'cabin', name: 'Inside the car', short: 'CABIN',
      desc: 'Driver’s seat: the body filters out the highs, the cabin booms ' +
        'with the firing rumble, intake noise comes through the firewall and ' +
        'the exhaust arrives muffled from behind.',
      mods: {
        // Sources: intake/firewall dominate, tailpipe and hiss are muffled
        intakeGain: { mul: 1.25 },
        straightMix: { mul: 0.5 },
        mufflerCutoff: { mul: 0.8 },
        mechGain: { mul: 0.7 },
        res2Gain: { mul: 0.5 },
        chainGain: { mul: 0.35 },
        whineGain: { mul: 0.75 },
        hissGain: { mul: 0.4 },
        blowoffGain: { mul: 0.6 },
        popGain: { mul: 0.85 },
        starterGain: { mul: 0.8 },
        solenoidGain: { mul: 0.7 },
        // Tone: bodywork transmission loss (highs) + cabin bass build-up
        masterLp: { mul: 0.5 },
        bassFreq: { mul: 0.9 },
        bassGain: { add: 4 },
        midGain: { add: -1.5 },
        trebleGain: { add: -6 },
        satMix: { mul: 0.85 },
        masterGain: { mul: 0.9 },
      },
      space: {
        lowpass: 2600, lowpassQ: 0.8,   // panels/glass: steep high-frequency loss
        boomFreq: 68, boomGain: 6, boomQ: 1.1, // first cabin mode
        mix: 0.22,                       // small, damped room
        ir: { decay: 0.14, predelay: 0.002, tone: 1800, width: 0.35,
          early: [[0.0035, 0.5], [0.0062, 0.35], [0.0091, 0.25]] },
      },
    },
    {
      id: 'outside', name: 'Outside the car', short: 'OUTSIDE',
      desc: 'Standing a few metres away: the tailpipe dominates with a rawer, ' +
        'brighter bark, the engine bay is muted, and the sound bounces off ' +
        'the ground and the street around you.',
      mods: {
        exhaustGain: { mul: 1.15 },
        straightMix: { add: 0.15 },
        mufflerCutoff: { mul: 1.25 },
        intakeGain: { mul: 0.45 },
        mechGain: { mul: 0.5 },
        res1Gain: { mul: 0.8 },
        chainGain: { mul: 0.4 },
        whineGain: { mul: 0.5 },
        hissGain: { mul: 0.6 },
        blowoffGain: { mul: 1.1 },
        popGain: { mul: 1.15 },
        starterGain: { mul: 0.6 },
        solenoidGain: { mul: 0.6 },
        bassGain: { add: -3 },
        trebleGain: { add: 1 },
      },
      space: {
        lowpass: 9000, lowpassQ: 0.6,    // a little air absorption
        boomFreq: 68, boomGain: 0, boomQ: 1,
        mix: 0.28,                       // ground bounce + street reflections
        ir: { decay: 0.75, predelay: 0.008, tone: 3200, width: 0.85,
          early: [[0.008, 0.8], [0.021, 0.45], [0.034, 0.35], [0.052, 0.25]] },
      },
    },
  ];

  function listener(id) {
    return LISTENERS.find((l) => l.id === id) || LISTENERS[0];
  }

  /** Engine params as heard from listening position `id` (new object). */
  function applyListener(params, id) {
    const L = listener(id);
    const out = Object.assign({}, params);
    for (const key of Object.keys(L.mods)) {
      const s = SCHEMA.find((x) => x.key === key);
      if (!s || typeof out[key] !== 'number') continue;
      const m = L.mods[key];
      let v = out[key] * (m.mul !== undefined ? m.mul : 1) + (m.add || 0);
      if (s.min !== undefined) v = Math.max(s.min, v);
      if (s.max !== undefined) v = Math.min(s.max, v);
      out[key] = v;
    }
    return out;
  }

  function defaults() {
    const p = {};
    for (const s of SCHEMA) p[s.key] = s.def;
    return p;
  }

  /** Defaults overridden by whatever the tuner saved. */
  function load() {
    const p = defaults();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const s of SCHEMA) {
          if (saved[s.key] !== undefined) p[s.key] = saved[s.key];
        }
      }
    } catch (e) { /* private mode / bad JSON */ }
    return p;
  }

  function save(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }
    catch (e) { /* ignore */ }
  }

  return {
    STORAGE_KEY, GROUPS, SCHEMA, LISTENERS,
    defaults, load, save, listener, applyListener,
  };
})();
