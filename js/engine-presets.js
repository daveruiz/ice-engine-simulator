/**
 * EnginePresets — complete engines for the physically modeled sound:
 * each preset sets BOTH the physical sound model (js/physical-params.js:
 * cylinders, firing pattern, pipes, turbo…) AND the drivetrain the
 * simulator runs (rev range, idle, gearbox, top speed, rev response), so
 * one pick turns the whole car into that engine.
 *
 * `physical` lists only what differs from the schema defaults (the
 * cross-plane muscle V8); `engine` uses the simulator's settings keys.
 * The figures follow the real cars (redline, gears, top speed); the
 * acoustic values are tuned by ear to evoke each engine's character —
 * they are not measurements.
 *
 * Shared by the simulator (main.js) and the tuner page (tuner.js).
 */
window.EnginePresets = (function () {
  'use strict';

  // Must match the simulator's settings key (main.js uses this constant).
  const SETTINGS_KEY = 'ice-simulator-settings-v1';
  const DEFAULT_ID = 'v8-muscle';

  const GROUPS = [
    { id: 'street', name: 'Street' },
    { id: 'sports', name: 'Sports & supercars' },
    { id: 'racing', name: 'Racing' },
  ];

  // Drivetrain keys a preset controls (and that "modified" compares).
  const ENGINE_KEYS = [
    'maxRpm', 'idleRpm', 'gears', 'shiftUpRpm', 'shiftDownRpm',
    'maxSpeed', 'revUpTime', 'revDownTime', 'shiftTime',
  ];

  const PRESETS = [
    // ------------------------------------------------------------ Street
    {
      id: 'golf-tdi', group: 'street',
      name: 'VW Golf TDI — 2.0 inline-4 turbodiesel',
      desc: 'Diesel clatter at idle, low redline, torquey turbo hum. 5,000 rpm · 6 gears.',
      engine: { maxRpm: 5000, idleRpm: 800, gears: 6, shiftUpRpm: 4200,
        shiftDownRpm: 1300, maxSpeed: 220, revUpTime: 0.6, revDownTime: 0.9,
        shiftTime: 0.3, cylinders: 4 },
      physical: {
        cylinders: 4, firingPattern: 'single', fireWidth: 0.03, fireNoise: 0.55,
        variability: 0.05, idleLevel: 0.35, idleWobble: 0.008,
        intakeGain: 0.35, intakeLength: 0.5,
        runnerLength: 0.45, runnerFb: 0.2, runnerImbalance: 1.03,
        exhaustLength: 3.5, exhaustFb: 0.5, exhaustLp: 1300,
        mufflerCutoff: 650, straightMix: 0.1, exhaustGain: 0.8,
        mechGain: 0.75, tickDecay: 3, res1Freq: 1100, res1Gain: 0.9,
        res2Freq: 3200, res2Gain: 0.6, chainGain: 0.2,
        turbo: 1, whineMin: 700, whineMax: 8500, spoolTime: 0.7,
        whineGain: 0.3, hissGain: 0.2, blowoffGain: 0,
        popChance: 0, drive: 2.0, masterLp: 6500,
        bassFreq: 110, bassGain: 5, midFreq: 1200, midGain: 2, satMix: 0.4,
        // Texture & overrun bangs
        phaseJitter: 1.2, cylImbalance: 0.08, vibration: 1.5,
        // Starter & ignition
        crankRpm: 180, crankTime: 1.3, compressionDip: 0.5, pumpLevel: 0.09, ringTeeth: 135, starterGain: 0.7,
      },
    },
    {
      id: 'golf-gti', group: 'street',
      name: 'VW Golf GTI — 2.0 inline-4 turbo',
      desc: 'Smooth turbo four with intake whoosh and DSG-quick shifts. 6,800 rpm · 7 gears.',
      engine: { maxRpm: 6800, idleRpm: 750, gears: 7, shiftUpRpm: 6300,
        shiftDownRpm: 1500, maxSpeed: 250, revUpTime: 0.4, revDownTime: 0.6,
        shiftTime: 0.12, cylinders: 4 },
      physical: {
        cylinders: 4, firingPattern: 'single', fireWidth: 0.05, fireNoise: 0.35,
        variability: 0.06, idleLevel: 0.18, idleWobble: 0.01,
        intakeGain: 0.7, intakeLength: 0.35, intakeColor: 2800,
        runnerLength: 0.4, runnerFb: 0.2, runnerImbalance: 1.04,
        exhaustLength: 3.2, exhaustFb: 0.5, exhaustLp: 1800,
        mufflerCutoff: 900, straightMix: 0.2, exhaustGain: 0.9,
        mechGain: 0.3, res1Freq: 900, res2Freq: 4200, chainGain: 0.12,
        turbo: 1, whineMin: 800, whineMax: 10000, spoolTime: 0.45,
        whineGain: 0.2, hissGain: 0.25, blowoffGain: 0.4,
        popChance: 0.12, popGain: 2.5, drive: 1.8,
        bassFreq: 100, bassGain: 6, midFreq: 700, midGain: 1.5,
        // Texture & overrun bangs
        bangLevel: 0.75, crackle: 0.3, vibration: 1.0,
        // Starter & ignition
        crankRpm: 260, crankTime: 0.6, compressionDip: 0.34, ringTeeth: 135,
      },
    },
    {
      id: 'gr-yaris', group: 'street',
      name: 'Toyota GR Yaris — 1.6 inline-3 turbo',
      desc: 'Three-cylinder thrum: odd, gravelly pulse train plus turbo whistle. 7,000 rpm · 6 gears.',
      engine: { maxRpm: 7000, idleRpm: 800, gears: 6, shiftUpRpm: 6500,
        shiftDownRpm: 1800, maxSpeed: 230, revUpTime: 0.35, revDownTime: 0.6,
        shiftTime: 0.3, cylinders: 3 },
      physical: {
        cylinders: 3, firingPattern: 'single', fireWidth: 0.05, fireNoise: 0.4,
        variability: 0.08, idleLevel: 0.22, idleWobble: 0.015,
        intakeGain: 0.6, intakeLength: 0.38,
        runnerLength: 0.45, runnerFb: 0.25, runnerImbalance: 1.0,
        exhaustLength: 3.0, exhaustFb: 0.55, exhaustLp: 1900,
        mufflerCutoff: 1000, straightMix: 0.3,
        turbo: 1, whineMin: 700, whineMax: 10500, spoolTime: 0.5,
        whineGain: 0.25, hissGain: 0.3, blowoffGain: 0.6,
        popChance: 0.15, drive: 1.9,
        bassFreq: 110, bassGain: 7, midFreq: 600, midGain: 2,
        // Texture & overrun bangs
        bangLevel: 0.9, crackle: 0.4, vibration: 1.6,
        // Starter & ignition
        crankRpm: 250, crankTime: 0.6, compressionDip: 0.45, ringTeeth: 120,
      },
    },
    {
      id: 'subaru-wrx', group: 'street',
      name: 'Subaru WRX STI — 2.5 boxer-4 turbo',
      desc: 'Unequal-length headers: the lumpy boxer rumble, laggy turbo and a loud blow-off. 7,000 rpm · 6 gears.',
      engine: { maxRpm: 7000, idleRpm: 800, gears: 6, shiftUpRpm: 6500,
        shiftDownRpm: 1800, maxSpeed: 255, revUpTime: 0.45, revDownTime: 0.75,
        shiftTime: 0.3, cylinders: 4 },
      physical: {
        cylinders: 4, firingPattern: 'paired', fireWidth: 0.05, fireNoise: 0.4,
        variability: 0.1, idleLevel: 0.24, idleWobble: 0.02,
        intakeGain: 0.55,
        runnerLength: 0.6, runnerFb: 0.3, runnerImbalance: 1.9,
        exhaustLength: 3.0, exhaustFb: 0.55,
        mufflerCutoff: 800, straightMix: 0.3,
        mechGain: 0.3,
        turbo: 1, whineMin: 600, whineMax: 9000, spoolTime: 0.7,
        whineGain: 0.2, hissGain: 0.3, blowoffGain: 0.9,
        popChance: 0.15,
        bassFreq: 110, bassGain: 8,
        // Texture & overrun bangs
        bangLevel: 1.1, crackle: 0.5, vibration: 0.8,
        // Starter & ignition
        crankRpm: 230, crankTime: 0.8, compressionDip: 0.36, ringTeeth: 130,
      },
    },
    {
      id: 'bmw-m3', group: 'street',
      name: 'BMW M3 (E46) — 3.2 inline-6 NA',
      desc: 'Silky straight-six with individual-throttle-body intake howl. 8,000 rpm · 6 gears.',
      engine: { maxRpm: 8000, idleRpm: 850, gears: 6, shiftUpRpm: 7600,
        shiftDownRpm: 2000, maxSpeed: 280, revUpTime: 0.35, revDownTime: 0.55,
        shiftTime: 0.18, cylinders: 6 },
      physical: {
        cylinders: 6, firingPattern: 'single', fireWidth: 0.04, fireNoise: 0.35,
        variability: 0.06, idleLevel: 0.2, idleWobble: 0.012,
        intakeGain: 0.9, intakeLength: 0.3, intakeFb: 0.6, intakeColor: 3200,
        runnerLength: 0.6, runnerFb: 0.3, runnerImbalance: 1.02,
        exhaustLength: 3.0, exhaustFb: 0.55, exhaustLp: 2200,
        mufflerCutoff: 1200, straightMix: 0.3,
        mechGain: 0.3, res2Freq: 4500, chainGain: 0.1,
        popChance: 0.08, drive: 1.7, masterLp: 9000,
        bassGain: 5, midFreq: 900, midGain: 2,
        // Texture & overrun bangs
        vibration: 0.6,
        // Starter & ignition
        crankRpm: 240, crankTime: 0.75, compressionDip: 0.26, ringTeeth: 135,
      },
    },
    {
      id: 'v8-muscle', group: 'street',
      name: 'V8 muscle car — 5.0 cross-plane',
      desc: 'The classic American burble: uneven pulses down each bank. 7,000 rpm · 6 gears. (Original default.)',
      engine: { maxRpm: 7000, idleRpm: 850, gears: 6, shiftUpRpm: 6200,
        shiftDownRpm: 1800, maxSpeed: 250, revUpTime: 0.55, revDownTime: 0.85,
        shiftTime: 0.3, cylinders: 8 },
      physical: {},
    },
    // ------------------------------------------------- Sports & supercars
    {
      id: 'porsche-gt3', group: 'sports',
      name: 'Porsche 911 GT3 — 4.0 flat-6 NA',
      desc: 'Hard-edged boxer six that screams to 9,000 rpm. 7-speed PDK.',
      engine: { maxRpm: 9000, idleRpm: 900, gears: 7, shiftUpRpm: 8800,
        shiftDownRpm: 2500, maxSpeed: 318, revUpTime: 0.28, revDownTime: 0.45,
        shiftTime: 0.1, cylinders: 6 },
      physical: {
        cylinders: 6, firingPattern: 'alternating', fireWidth: 0.038, fireNoise: 0.3,
        variability: 0.05, idleLevel: 0.2, idleWobble: 0.012,
        intakeGain: 0.8, intakeLength: 0.38, intakeFb: 0.55, intakeColor: 3500,
        runnerLength: 0.5, runnerFb: 0.3, runnerImbalance: 1.03,
        exhaustLength: 2.2, exhaustFb: 0.55, exhaustLp: 2600,
        mufflerCutoff: 1500, straightMix: 0.45,
        mechGain: 0.4, res1Freq: 950, res2Freq: 5200, res2Gain: 0.35, chainGain: 0.12,
        popChance: 0.12, popGain: 2.5, drive: 1.9, masterLp: 10000,
        bassGain: 5, midFreq: 1500, midGain: 2.5, trebleGain: 1,
        // Texture & overrun bangs
        phaseJitter: 1.8, bangLevel: 1.1, vibration: 0.9,
        // Starter & ignition
        crankRpm: 250, crankTime: 0.7, compressionDip: 0.26, ringTeeth: 140,
      },
    },
    {
      id: 'ferrari-458', group: 'sports',
      name: 'Ferrari 458 Italia — 4.5 flat-plane V8',
      desc: 'Flat-plane crank: even pulses per bank, a high, racy wail instead of a burble. 9,000 rpm · 7 gears.',
      engine: { maxRpm: 9000, idleRpm: 1000, gears: 7, shiftUpRpm: 8800,
        shiftDownRpm: 2500, maxSpeed: 325, revUpTime: 0.28, revDownTime: 0.45,
        shiftTime: 0.08, cylinders: 8 },
      physical: {
        cylinders: 8, firingPattern: 'alternating', fireWidth: 0.035, fireNoise: 0.3,
        variability: 0.05, idleLevel: 0.2, idleWobble: 0.01,
        intakeGain: 0.75, intakeLength: 0.32, intakeColor: 3500,
        runnerLength: 0.45, runnerFb: 0.35, runnerImbalance: 1.0,
        exhaustLength: 2.0, exhaustFb: 0.5, exhaustLp: 3000,
        mufflerCutoff: 1800, straightMix: 0.5,
        mechGain: 0.3, res2Freq: 5500,
        popChance: 0.15, drive: 2.0, masterLp: 11000,
        bassGain: 4, midFreq: 1800, midGain: 3, trebleGain: 1.5,
        // Texture & overrun bangs
        phaseJitter: 1.8, bangLevel: 1.2, crackle: 0.6, vibration: 1.1,
        // Starter & ignition
        crankRpm: 280, crankTime: 0.6, compressionDip: 0.2, ringTeeth: 140,
      },
    },
    {
      id: 'huracan-v10', group: 'sports',
      name: 'Lamborghini Huracán — 5.2 V10 NA',
      desc: 'Ten cylinders, thunderous and crackly on the overrun. 8,500 rpm · 7 gears.',
      engine: { maxRpm: 8500, idleRpm: 1000, gears: 7, shiftUpRpm: 8300,
        shiftDownRpm: 2500, maxSpeed: 325, revUpTime: 0.3, revDownTime: 0.5,
        shiftTime: 0.1, cylinders: 10 },
      physical: {
        cylinders: 10, firingPattern: 'alternating', fireWidth: 0.035, fireNoise: 0.35,
        variability: 0.06, idleLevel: 0.22,
        intakeGain: 0.7,
        runnerLength: 0.5, runnerFb: 0.3, runnerImbalance: 1.04,
        exhaustLength: 2.2, exhaustLp: 2600,
        mufflerCutoff: 1400, straightMix: 0.45,
        popChance: 0.25, popGain: 3.5, drive: 2.1, masterLp: 10000,
        bassGain: 6, midFreq: 1200, midGain: 2,
        // Texture & overrun bangs
        bangLevel: 1.3, crackle: 0.8, bangDrive: 6, vibration: 0.8,
        // Starter & ignition
        crankRpm: 270, crankTime: 0.7, compressionDip: 0.17, ringTeeth: 145,
      },
    },
    {
      id: 'ferrari-v12', group: 'sports',
      name: 'Ferrari 812 Superfast — 6.5 V12 NA',
      desc: 'Twelve tightly spaced pulses: smooth, dense and shrieking near 9,000 rpm. 7 gears.',
      engine: { maxRpm: 9000, idleRpm: 1000, gears: 7, shiftUpRpm: 8700,
        shiftDownRpm: 2600, maxSpeed: 340, revUpTime: 0.3, revDownTime: 0.5,
        shiftTime: 0.08, cylinders: 12 },
      physical: {
        cylinders: 12, firingPattern: 'alternating', fireWidth: 0.03, fireNoise: 0.3,
        variability: 0.04, idleLevel: 0.2, idleWobble: 0.008,
        intakeGain: 0.8, intakeLength: 0.3, intakeColor: 4000,
        runnerLength: 0.42, runnerFb: 0.3, runnerImbalance: 1.02,
        exhaustLength: 2.3, exhaustLp: 3200,
        mufflerCutoff: 1700, straightMix: 0.45,
        mechGain: 0.3, res2Freq: 6000,
        popChance: 0.1, drive: 2.0, masterLp: 12000,
        bassGain: 4, midFreq: 2000, midGain: 3, trebleGain: 1.5,
        // Texture & overrun bangs
        phaseJitter: 1.6, cylImbalance: 0.06, vibration: 0.4,
        // Starter & ignition
        crankRpm: 260, crankTime: 0.8, compressionDip: 0.12, ringTeeth: 150,
      },
    },
    {
      id: 'mazda-rotary', group: 'sports',
      name: 'Mazda RX-8 — 1.3 twin-rotor Wankel',
      desc: 'Rotary "brap": two rotors fire like a four, with sharp port pulses and a lumpy idle. No valvetrain. 9,000 rpm · 6 gears.',
      engine: { maxRpm: 9000, idleRpm: 850, gears: 6, shiftUpRpm: 8500,
        shiftDownRpm: 2500, maxSpeed: 240, revUpTime: 0.25, revDownTime: 0.4,
        shiftTime: 0.25, cylinders: 4 },
      physical: {
        // 2 rotors × 1 power pulse per eccentric-shaft turn = 4 per 720°
        cylinders: 4, firingPattern: 'single', fireWidth: 0.07, fireNoise: 0.6,
        variability: 0.3, idleLevel: 0.26, idleWobble: 0.05,
        intakeGain: 0.6, intakeLength: 0.45,
        runnerLength: 0.5, runnerFb: 0.35, runnerImbalance: 1.0,
        exhaustLength: 2.8, exhaustFb: 0.55, exhaustLp: 2400,
        mufflerCutoff: 1300, straightMix: 0.5,
        mechGain: 0.15, res2Gain: 0.1, chainGain: 0,
        popChance: 0.35, popGain: 3.5, drive: 2.4, masterLp: 9000,
        bassGain: 6, midFreq: 800, midGain: 2, satMix: 0.45,
        // Texture & overrun bangs
        phaseJitter: 3.5, cylImbalance: 0.14, bangLevel: 1.3, crackle: 0.7, vibration: 0.45,
        // Starter & ignition
        crankRpm: 260, crankTime: 0.9, compressionDip: 0.2, ringTeeth: 110, solenoidGain: 0.6,
      },
    },
    // ------------------------------------------------------------ Racing
    {
      id: 'f1-v10', group: 'racing',
      name: 'Formula 1 V10 (2005) — 3.0 NA',
      desc: 'The screaming era: no muffler, 19,000 rpm, seamless 7-speed shifts. Idles at 4,000 rpm.',
      engine: { maxRpm: 19000, idleRpm: 4000, gears: 7, shiftUpRpm: 18500,
        shiftDownRpm: 6500, maxSpeed: 350, revUpTime: 0.12, revDownTime: 0.2,
        shiftTime: 0.04, cylinders: 10 },
      physical: {
        cylinders: 10, firingPattern: 'alternating', fireWidth: 0.03, fireNoise: 0.3,
        variability: 0.03, idleLevel: 0.25, idleWobble: 0.005,
        intakeGain: 0.9, intakeLength: 0.25, intakeFb: 0.6, intakeColor: 5000,
        runnerLength: 0.35, runnerFb: 0.4, runnerImbalance: 1.0,
        exhaustLength: 0.9, exhaustFb: 0.45, exhaustLp: 4500,
        mufflerCutoff: 4000, straightMix: 1.0,
        mechGain: 0.35, res1Freq: 1400, res2Freq: 6500, res2Gain: 0.35,
        chainGain: 0.1, chainFreq: 8000,
        popChance: 0.08, popGain: 2, drive: 2.2, masterLp: 14000,
        bassFreq: 150, bassGain: 3, midFreq: 2500, midGain: 3, trebleGain: 2,
        satDrive: 3, satMix: 0.4,
        // Texture & overrun bangs
        phaseJitter: 0.8, cylImbalance: 0.04, bangLevel: 0.8, crackle: 0.3, vibration: 1.4,
        // Starter & ignition
        crankRpm: 450, crankTime: 0.5, compressionDip: 0.14, ringTeeth: 210, starterGain: 0.8, solenoidGain: 0.25,
      },
    },
    {
      id: 'f1-v6-hybrid', group: 'racing',
      name: 'Formula 1 V6 turbo hybrid (2014+) — 1.6',
      desc: 'Buzzy turbo V6: the turbine (kept spinning by the MGU-H) muffles the pulses and adds a constant whine. 15,000 rpm · 8 gears.',
      engine: { maxRpm: 15000, idleRpm: 4000, gears: 8, shiftUpRpm: 12000,
        shiftDownRpm: 6500, maxSpeed: 350, revUpTime: 0.15, revDownTime: 0.25,
        shiftTime: 0.04, cylinders: 6 },
      physical: {
        cylinders: 6, firingPattern: 'alternating', fireWidth: 0.035, fireNoise: 0.35,
        variability: 0.04, idleLevel: 0.2, idleWobble: 0.005,
        intakeGain: 0.4,
        runnerLength: 0.4, runnerFb: 0.35, runnerImbalance: 1.0,
        exhaustLength: 1.0, exhaustFb: 0.5, exhaustLp: 3500,
        mufflerCutoff: 2200, straightMix: 0.55, exhaustGain: 0.9,
        mechGain: 0.3, res2Freq: 6000, chainGain: 0.08,
        turbo: 1, whineMin: 1500, whineMax: 14000, spoolTime: 0.2,
        whineGain: 0.4, hissGain: 0.25, blowoffGain: 0.15,
        popChance: 0.05, drive: 2.0, masterLp: 13000,
        bassGain: 3, midFreq: 2000, midGain: 2, trebleGain: 1,
        // Texture & overrun bangs
        phaseJitter: 0.8, cylImbalance: 0.04, bangLevel: 0.6, crackle: 0.2, vibration: 1.4,
        // Starter & ignition
        crankRpm: 450, crankTime: 0.5, compressionDip: 0.2, ringTeeth: 210, starterGain: 0.8, solenoidGain: 0.25,
      },
    },
  ];

  function get(id) {
    return PRESETS.find((p) => p.id === id) || null;
  }

  /** Full physical parameter set for a preset (defaults + overrides). */
  function physicalParams(id) {
    const p = get(id);
    return Object.assign(window.PhysicalParams.defaults(), p ? p.physical : {});
  }

  /**
   * True if the live engine still matches preset `id`: every drivetrain
   * key in `settings` and every physical parameter in `params`.
   */
  function matches(id, settings, params) {
    const p = get(id);
    if (!p) return false;
    for (const k of ENGINE_KEYS) {
      if (p.engine[k] !== undefined && settings[k] !== undefined &&
          Math.abs(settings[k] - p.engine[k]) > 1e-6) return false;
    }
    const ref = physicalParams(id);
    for (const s of window.PhysicalParams.SCHEMA) {
      const a = params[s.key], b = ref[s.key];
      if (typeof b === 'number') {
        if (Math.abs(Number(a) - b) > 1e-6) return false;
      } else if (a !== b) return false;
    }
    return true;
  }

  // --- Simulator settings storage (shared with main.js) ---
  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {};
    } catch (e) { return {}; }
  }

  /** Merge `patch` into the stored simulator settings (other tabs follow). */
  function patchSettings(patch) {
    try {
      const s = Object.assign(readSettings(), patch);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }

  /** Fill a <select> with the presets, grouped. */
  function fillSelect(sel) {
    sel.innerHTML = '';
    for (const g of GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g.name;
      for (const p of PRESETS) {
        if (p.group !== g.id) continue;
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
  }

  return {
    SETTINGS_KEY, DEFAULT_ID, GROUPS, PRESETS, ENGINE_KEYS,
    get, physicalParams, matches, readSettings, patchSettings, fillSelect,
  };
})();
