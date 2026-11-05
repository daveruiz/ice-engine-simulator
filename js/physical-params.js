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
    { id: 'path',    name: 'Transmission path (per source)' },
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
    { key: 'cylImbalance', group: 'engine', label: 'Cylinder imbalance',
      min: 0, max: 0.3, step: 0.005, def: 0.1,
      info: 'Each cylinder burns a little differently (strength and timing, fixed per start). Adds the half-order texture of a real engine; 0 = machine-perfect, glassy tone.' },
    { key: 'phaseJitter', group: 'engine', label: 'Combustion timing jitter', unit: '°',
      min: 0, max: 6, step: 0.1, def: 2.5,
      info: 'Cycle-to-cycle scatter of when (and how fast) each combustion happens, in crank degrees. Breaks the perfectly periodic pulse train that sounds synthetic.' },
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
    { key: 'gasTemp', group: 'exhaust', label: 'Gas temperature effect',
      min: 0, max: 0.25, step: 0.005, def: 0.08,
      info: 'Hot exhaust gas carries sound faster, so pipe resonances rise as the gas heats up under load (and fall slowly as it cools). Keeps the resonances from sitting still.' },
    { key: 'turbulence', group: 'exhaust', label: 'Flow turbulence',
      min: 0, max: 0.02, step: 0.0005, def: 0.006,
      info: 'Small random wander of the pipe tuning from turbulent flow, mostly under load. Smears the comb-filter "beading" as revs sweep.' },
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
    { key: 'vibration', group: 'mech', label: 'Engine vibration',
      min: 0, max: 2, step: 0.01, def: 1.0,
      info: 'How much this engine shakes on its mounts (cylinder layout, mount stiffness): high for 3-cylinders and diesels, low for a V12. Felt as a low rumble wherever the listener picks up structure-borne sound.' },
    { key: 'vibGain', group: 'mech', label: 'Structure-borne level',
      min: 0, max: 1.5, step: 0.01, def: 0,
      info: 'How much of the engine vibration reaches the listener through the body. 0 next to or outside the car; the Inside listening position raises it.' },
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
    { key: 'whineNoise', group: 'turbo', label: 'Whine blur',
      min: 0, max: 1, step: 0.01, def: 0.1,
      info: 'How much of the turbo whistle is a blown, noisy whistle rather than a clean tone. Higher = less crisp (e.g. heard through the intake ducts inside the car).' },
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
      info: 'How much louder a pop is than a normal closed-throttle pulse (the muffled part, through the exhaust).' },
    { key: 'bangLevel', group: 'pops', label: 'Tailpipe bang level',
      min: 0, max: 2, step: 0.01, def: 1.0,
      info: 'The unmuffled crack when the mixture ignites at the tailpipe. Mixed past the compressor so it punches through.' },
    { key: 'bangDrive', group: 'pops', label: 'Bang saturation',
      min: 1, max: 12, step: 0.1, def: 5,
      info: 'How hard the bang is driven into saturation: higher = louder, dirtier, more aggressive.' },
    { key: 'bangCrack', group: 'pops', label: 'Bang crack',
      min: 0, max: 1, step: 0.01, def: 1,
      info: 'How much of the bang is the bright, noisy crack (vs. the low thump). Inside the car it is mostly a dull thump.' },
    { key: 'popDecay', group: 'pops', label: 'Pop burst length', unit: 's',
      min: 0.2, max: 5, step: 0.05, def: 1.2,
      info: 'Pulling hard builds up hot exhaust and unburnt fuel; the overrun uses it up. This is how long a lift-off keeps crackling before it fades (instead of popping on every long coast).' },
    { key: 'crackle', group: 'pops', label: 'After-crackle',
      min: 0, max: 1, step: 0.01, def: 0.45,
      info: 'Chance of smaller crackles following a bang (the burble of a sports exhaust).' },

    // ---- Transmission path: per-source lowpass to the listener ----
    // Open (20 kHz) by default; the listening positions set them.
    { key: 'exhaustTone', group: 'path', label: 'Exhaust brightness', unit: 'Hz',
      min: 300, max: 20000, step: 50, def: 20000,
      info: 'Lowpass on the exhaust on its way to the listener (body, floor, rear glass). 20 kHz = open.' },
    { key: 'intakeTone', group: 'path', label: 'Intake brightness', unit: 'Hz',
      min: 300, max: 20000, step: 50, def: 20000,
      info: 'Lowpass on the intake noise on its way to the listener (firewall).' },
    { key: 'mechTone', group: 'path', label: 'Mechanical brightness', unit: 'Hz',
      min: 300, max: 20000, step: 50, def: 20000,
      info: 'Lowpass on block resonances, valvetrain clatter and chain rattle on their way to the listener (bonnet, firewall).' },
    { key: 'turboTone', group: 'path', label: 'Turbo brightness', unit: 'Hz',
      min: 300, max: 20000, step: 50, def: 20000,
      info: 'Lowpass on the turbo whistle, hiss and blow-off on their way to the listener.' },
    { key: 'starterTone', group: 'path', label: 'Starter brightness', unit: 'Hz',
      min: 300, max: 20000, step: 50, def: 20000,
      info: 'Lowpass on the starter motor and solenoid on their way to the listener.' },
    { key: 'bangTone', group: 'path', label: 'Bang brightness', unit: 'Hz',
      min: 300, max: 20000, step: 50, def: 20000,
      info: 'Lowpass on the tailpipe bangs on their way to the listener.' },

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
      min: 0, max: 0.3, step: 0.005, def: 0.03,
      info: 'Air pushed through the exhaust by a cylinder that does not fire (cranking, misfires, key-off spin-down). Much weaker than a combustion pulse.' },
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
   *   mods  — per-parameter { mul, add } or { set } applied to the engine
   *           params (any schema key: which sources reach the ear, how
   *           bright, how much bass, even selects/switches via `set`);
   *           numeric results are clamped to the schema range.
   *   space — the acoustic path after synthesis (native WebAudio nodes in
   *           physical.js): a transmission lowpass, a low "boom"
   *           resonance and a generated room/street impulse response.
   *
   * 'original' is the untouched model (as heard next to the engine).
   */
  // Built-in definitions; the live LISTENERS below merge in the user's
  // edits from the tuner (saved under LISTENER_KEY).
  const LISTENER_DEFAULTS = [
    {
      id: 'original', name: 'Original', short: 'ORIGINAL',
      desc: 'The raw engine model, as tuned — like standing right next to the engine.',
      mods: {},
      space: null,
    },
    {
      id: 'cabin', name: 'Inside the car', short: 'CABIN',
      desc: 'Driver’s seat: you mostly get the exhaust, muffled from behind, ' +
        'and the engine’s vibration through the body (a low rumble at the ' +
        'firing rate); the intake comes through the firewall as a dull roar. ' +
        'Mechanical clatter, chain rattle and hiss stay under the bonnet.',
      // Each source gets its own transmission path (level + lowpass): the
      // highs aren't cut globally, so what really leaks through (turbo
      // whistle, the bang, some exhaust rasp) keeps its edge.
      mods: {
        // Exhaust: from behind, through floor / rear glass — loses some top
        exhaustGain: { mul: 0.9 },
        straightMix: { mul: 0.85 },     // keep the tailpipe rasp
        exhaustTone: { set: 4500 },
        fireNoise: { mul: 0.8 },
        // Intake through the firewall: a roar under load more than a hiss
        intakeGain: { mul: 0.7 },
        intakeColor: { mul: 0.65 },
        intakeTone: { set: 2200 },
        // Engine bay mechanics: bonnet + firewall block them (dull, quiet)
        mechGain: { mul: 0.3 },
        res2Gain: { mul: 0.35 },        // valvetrain clatter goes first
        chainGain: { mul: 0.05 },
        mechTone: { set: 1400 },
        // Turbo: still heard inside, but dulled and blurred by the ducts and
        // the firewall — a soft blown whistle, not a crisp tone
        whineGain: { mul: 0.95 },
        whineNoise: { set: 0.8 },
        hissGain: { mul: 0.3 },
        blowoffGain: { mul: 0.6 },
        turboTone: { set: 1800 },
        // Bangs: a hard but dull thump through the body — the noisy crack
        // of the explosion stays outside
        popGain: { mul: 0.85 },
        bangLevel: { mul: 0.85 },
        bangCrack: { mul: 0.2 },
        bangDrive: { mul: 0.6 },
        bangTone: { set: 900 },
        starterGain: { mul: 0.7 },
        solenoidGain: { mul: 0.45 },
        starterTone: { set: 3500 },
        // Structure-borne: the shake comes through seat, floor and panels
        vibGain: { add: 0.7 },
        // Overall: just a gentle tilt + cabin bass build-up
        bassFreq: { mul: 0.9 },
        bassGain: { add: 1.5 },         // the vibration already carries the lows
        midGain: { add: -1 },
        trebleGain: { add: -1 },
        masterGain: { mul: 0.9 },
      },
      space: {
        gain: 0.78,                      // post-compressor level (cabin bass boost)
        lowpass: 11000, lowpassQ: 0.5,  // only the very top is lost globally
        boomFreq: 68, boomGain: 3.5, boomQ: 1.1, // first cabin mode
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
        bangLevel: { mul: 1.3 },
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

  const LISTENER_KEY = 'ice-listener-mods-v1';
  // Editable acoustic-space fields (the impulse response shape isn't)
  const SPACE_FIELDS = [
    ['gain', 'Level after the compressor', '×', 0, 2, 0.01],
    ['lowpass', 'Global lowpass', 'Hz', 500, 20000, 50],
    ['lowpassQ', 'Lowpass Q', '', 0.3, 2, 0.05],
    ['boomFreq', 'Cabin boom frequency', 'Hz', 30, 200, 1],
    ['boomGain', 'Cabin boom gain', 'dB', -6, 12, 0.5],
    ['boomQ', 'Cabin boom Q', '', 0.3, 4, 0.05],
    ['mix', 'Room reflections', '', 0, 1, 0.01],
  ];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const LISTENERS = []; // live (defaults + user edits)

  function readListenerEdits() {
    try { return JSON.parse(localStorage.getItem(LISTENER_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  /** Rebuild LISTENERS (in place) from the defaults + saved edits. */
  function loadListeners() {
    const edits = readListenerEdits();
    LISTENERS.length = 0;
    for (const d of LISTENER_DEFAULTS) {
      const L = clone(d);
      const e = edits[d.id];
      if (e) {
        if (e.mods) L.mods = e.mods;
        if (e.space && L.space) Object.assign(L.space, e.space);
        L.custom = true;
      }
      LISTENERS.push(L);
    }
  }

  /** Save edits for a position: { mods, space } (whole mods map). */
  function saveListener(id, edit) {
    const edits = readListenerEdits();
    edits[id] = edit;
    try { localStorage.setItem(LISTENER_KEY, JSON.stringify(edits)); } catch (e) { /* ignore */ }
    loadListeners();
  }

  function resetListener(id) {
    const edits = readListenerEdits();
    delete edits[id];
    try { localStorage.setItem(LISTENER_KEY, JSON.stringify(edits)); } catch (e) { /* ignore */ }
    loadListeners();
  }

  function listenerDefaults(id) {
    return clone(LISTENER_DEFAULTS.find((l) => l.id === id) || LISTENER_DEFAULTS[0]);
  }

  loadListeners();

  function listener(id) {
    return LISTENERS.find((l) => l.id === id) || LISTENERS[0];
  }

  /** Engine params as heard from listening position `id` (new object). */
  function applyListener(params, id) {
    const L = listener(id);
    const out = Object.assign({}, params);
    for (const key of Object.keys(L.mods)) {
      const s = SCHEMA.find((x) => x.key === key);
      const m = L.mods[key];
      if (!s) continue;
      if (m.set !== undefined) { out[key] = m.set; continue; }
      if (typeof out[key] !== 'number') continue;
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
    STORAGE_KEY, GROUPS, SCHEMA, LISTENERS, LISTENER_KEY, SPACE_FIELDS,
    defaults, load, save, listener, applyListener,
    loadListeners, saveListener, resetListener, listenerDefaults,
  };
})();
