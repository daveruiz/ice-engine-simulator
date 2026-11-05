/**
 * physical-worklet.js — AudioWorkletProcessor implementing a physically
 * informed engine sound model, after Baldan, Lachambre, Delle Monache &
 * Boussard, "Physically informed car engine sound synthesis for virtual
 * and augmented environments" (IEEE SIVE 2015) and Farnell's procedural
 * engine (Designing Sound, ch. "Engines").
 *
 * Architecture (all per-sample, sample-accurate):
 *
 *   crankshaft phase (720° four-stroke cycle, from RPM)
 *     ├── per cylinder: combustion/blow-down pulse at its firing angle
 *     │   (raised-cosine pressure bump + turbulence noise, amplitude from
 *     │   load, with per-cycle random variation; overrun cycles may ignite
 *     │   late → exhaust pops)
 *     │     └──> exhaust header waveguide of its bank (L/R)
 *     │            └──> main exhaust pipe waveguide (lossy reflection at
 *     │                 the open tail) ──> absorption muffler (2-pole LP)
 *     │                 blended with straight-pipe tap ──> tailpipe out
 *     ├── per cylinder: intake-stroke noise gate (induction whoosh ∝
 *     │   throttle) ──> intake tract waveguide ──> intake out
 *     ├── per firing event: mechanical impact (piston slap / valve seat)
 *     │   ──> two resonant "engine block" modes (bandpass)
 *     ├── camshaft-rate random ticks ──> chain/accessory rattle bandpass
 *     ├── exhaust-energy-driven turbo spool state ──> turbine whine
 *     │   (blade-pass tone), boost hiss, blow-off burst on throttle lift
 *     └── starter motor (engine start): pinion meshed with the flywheel
 *         ring gear → gear-mesh whine + commutator buzz + brush noise,
 *         loaded by every compression stroke; solenoid clack / pinion
 *         clank / release click; free spin-down after disengaging
 *
 *   Ignition: `comb` (0..1) is the chance each cylinder cycle fires.
 *   Unfired cycles only pump air (pumpLevel). With combustion off and low
 *   revs the crank slows into each compression stroke (compressionDip):
 *   the cranking "rur-rur" and the final shudder when the engine dies.
 *
 *   mix ──> tanh soft clip (drive) ──> master lowpass ──> DC blocker
 *
 *   Realism (no two cycles alike): each cylinder has a fixed strength /
 *   timing offset (cylImbalance → the half orders a real engine has), every
 *   combustion is jittered in timing and duration (phaseJitter), and the
 *   exhaust waveguides are fractional delays re-tuned by the exhaust gas
 *   temperature (hotter gas → faster sound → resonances rise with load,
 *   with thermal lag) plus a little flow turbulence. Without these, a
 *   perfectly periodic pulse train through static comb resonances gives
 *   pure, glassy partials that "bead" as they sweep through the combs.
 *
 *   Structure-borne vibration: the combustion torque pulses shake the
 *   engine on its mounts and the body panels re-radiate them as a low,
 *   firing-rate rumble (lowpassed pulse train — mounts isolate the highs).
 *   `vibration` is the engine's own shake (mounts, cylinder layout);
 *   `vibGain` is how much reaches the listener (0 outside, set by the
 *   cabin listening position).
 *
 *   Transmission path: each source reaches the listener through its own
 *   one-pole lowpass (exhaustTone, intakeTone, mechTone, turboTone,
 *   starterTone, bangTone; ≥18 kHz = open). The listening positions set
 *   them, so e.g. inside the car the engine-bay clatter loses its highs
 *   through the firewall while the turbo whistle and the bang keep theirs.
 *
 *   Output 1 is the overrun bang layer: when unburnt mixture ignites it
 *   cracks at the tailpipe (unmuffled), with optional after-crackle. It's
 *   kept separate so the host can saturate it hard and mix it past the
 *   bus compressor (see physical.js).
 *
 * A digital waveguide is a delay line with a filtered, sign-inverting
 * reflection: the pressure wave travels down the pipe, loses highs to the
 * walls (one-pole LP) and partially reflects at the open end with phase
 * inversion — giving the odd-harmonic resonances of a closed/open pipe.
 * Delay length D = 2·L·sr/c for acoustic length L.
 *
 * Control: main thread posts {type:'state', rpm, load, maxRpm, comb, crank}
 * every frame (comb = combustion 0..1, crank = starter engaged) and
 * {type:'params', params} when a tuner slider moves. All
 * parameters are defined in js/physical-params.js.
 */
'use strict';

const SPEED_OF_SOUND = 343; // m/s

/** One-pole lowpass smoothing coefficient for a given cutoff. */
function lpCoef(hz, sr) {
  return 1 - Math.exp(-2 * Math.PI * hz / sr);
}

/** Smoothing coefficient for a time constant in seconds. */
function tauCoef(tau, sr) {
  return 1 - Math.exp(-1 / (tau * sr));
}

/**
 * Digital waveguide pipe: delay line, one-pole lowpass wall damping,
 * inverted partial reflection at the open end. Output is the wave
 * arriving at the open end (what radiates out).
 */
class Pipe {
  /**
   * steep: reflection loss is two-pole — the open tail radiates the highs
   * away instead of reflecting them, so resonances stay strong in the bass
   * (drone) but the comb fades out higher up (no "phaser" beading).
   */
  constructor(size, steep = false) {
    this.buf = new Float32Array(size);
    this.size = size;
    this.w = 0;
    this.D = 64;
    this.fb = 0.5;
    this.k = 0.3;
    this.lp = 0;
    this.lp2 = 0;
    this.steep = steep;
  }
  set(D, fb, k) {
    this.D = Math.max(2, Math.min(this.size - 3, D));
    this.fb = fb;
    this.k = k;
  }
  /** `scale` stretches the delay (gas temperature / turbulence), ≈1. */
  tick(x, scale = 1) {
    let d = this.D * scale;
    if (d > this.size - 3) d = this.size - 3; else if (d < 2) d = 2;
    let r = this.w - d;
    if (r < 0) r += this.size;
    const i0 = r | 0;
    const i1 = i0 + 1 === this.size ? 0 : i0 + 1;
    const y = this.buf[i0] + (this.buf[i1] - this.buf[i0]) * (r - i0);
    this.lp += (y - this.lp) * this.k;
    let refl = this.lp;
    if (this.steep) { this.lp2 += (this.lp - this.lp2) * this.k; refl = this.lp2; }
    this.buf[this.w] = x - this.fb * refl;
    if (++this.w === this.size) this.w = 0;
    return y;
  }
}

/** Smooth random signal in [-1, 1]: new target every `period` samples. */
class SmoothNoise {
  constructor(period, sr) {
    this.period = Math.max(1, Math.round(period));
    this.n = 0;
    this.v = 0;
    this.t = 0;
    this.k = 1 - Math.exp(-3 / this.period);
  }
  tick() {
    if (--this.n <= 0) { this.n = this.period; this.t = Math.random() * 2 - 1; }
    this.v += (this.t - this.v) * this.k;
    return this.v;
  }
}

/** RBJ bandpass biquad (constant peak gain), direct form 2 transposed. */
class Bandpass {
  constructor() {
    this.b0 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }
  set(f, Q, sr) {
    f = Math.max(20, Math.min(f, sr * 0.45));
    const w = 2 * Math.PI * f / sr;
    const al = Math.sin(w) / (2 * Q);
    const a0 = 1 + al;
    this.b0 = al / a0;
    this.b2 = -al / a0;
    this.a1 = -2 * Math.cos(w) / a0;
    this.a2 = (1 - al) / a0;
  }
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = -this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

const MAX_CYL = 16;
const STARTER_RATIO = 12;    // starter armature turns per crank turn
const COMMUTATOR_BARS = 21;  // brush buzz pulses per armature turn (kept off
                             // any ring-gear count: no slow mesh/buzz beating)

class PhysicalEngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.P = (options && options.processorOptions &&
      options.processorOptions.params) || {};

    // Control state (targets set via port, smoothed per-sample)
    this.rpmT = 0; this.loadT = 0; this.maxRpm = 7000;
    this.rpm = 0; this.load = 0; this.loadSlow = 0;

    // Crankshaft: phase in units of one 720° four-stroke cycle
    this.phase = 0;
    this.cycleAmp = new Float32Array(MAX_CYL).fill(1);
    this.cyclePop = new Uint8Array(MAX_CYL);
    this.cycleFire = new Uint8Array(MAX_CYL).fill(1);
    this.cycleOff = new Float32Array(MAX_CYL);   // combustion delay (cycles)
    this.cycleW = new Float32Array(MAX_CYL).fill(0.045); // pulse width
    // Fixed per-cylinder character (this engine, this start): strength and
    // combustion-phasing spread — scaled live by the cylImbalance param.
    this.cylBias = new Float32Array(MAX_CYL);
    this.cylLag = new Float32Array(MAX_CYL);
    for (let c = 0; c < MAX_CYL; c++) {
      this.cylBias[c] = Math.random() * 2 - 1;
      this.cylLag[c] = Math.random();
    }

    // Exhaust gas temperature (0..1) and flow turbulence for the pipes
    this.gasT = 0.35;
    this.turbL = new SmoothNoise(sampleRate / 3.1, sampleRate);
    this.turbR = new SmoothNoise(sampleRate / 2.7, sampleRate);
    this.turbX = new SmoothNoise(sampleRate / 1.9, sampleRate);
    this.turbI = new SmoothNoise(sampleRate / 4.3, sampleRate);
    // Turbo blade-pass wander (frequency / amplitude flutter)
    this.whFm = new SmoothNoise(sampleRate / 9, sampleRate);
    this.whAm = new SmoothNoise(sampleRate / 6, sampleRate);

    // Overrun bang layer (output 1)
    this.bangQ = [];            // pending [samplesLeft, strength]
    this.bangEnv = 0; this.bangDecay = 0.999; this.bangLp = 0;
    this.bangPipe = new Pipe(2048);
    this.bpBangLo = new Bandpass();

    // Ignition / starter state
    this.combT = 1; this.comb = 1;  // combustion (1 = running normally)
    this.stEng = 0;                 // starter pinion engaged
    this.stRps = 0;                 // starter armature speed (rev/s)
    this.stMeshPh = 0; this.stCommPh = 0; this.stArmPh = 0;
    this.solEnv = 0; this.thumpEnv = 0; this.thumpPh = 0;
    this.pinEnv = 0; this.pinDelay = 0;
    this.starterLevel = 1;
    this.bpSol = new Bandpass();
    this.bpPin = new Bandpass();
    this.bpBrush = new Bandpass();
    this.bpGrind = new Bandpass();
    this.stJit = new SmoothNoise(sampleRate / 40, sampleRate);
    this.wobble = 0; this.wobbleT = 0;

    // Waveguides (sized for ≤6 m pipe / ≤3.75 m runner at 96 kHz)
    this.runL = new Pipe(4096);
    this.runR = new Pipe(4096);
    this.exPipe = new Pipe(4096, true);
    this.inPipe = new Pipe(2048);

    // Filter/envelope state
    this.muff1 = 0; this.muff2 = 0;
    this.inCol = 0;
    this.mechEnv = 0; this.chainEnv = 0; this.chainPhase = 0;
    this.bpRes1 = new Bandpass();
    this.bpRes2 = new Bandpass();
    this.bpChain = new Bandpass();
    this.bpBlow = new Bandpass();
    this.bpWhine = new Bandpass();
    this.spool = 0; this.turboPh = 0; this.boEnv = 0; this.hissLp = 0;
    this.samplesSincePop = 1e9;
    // "Pop heat": hot exhaust + unburnt fuel built up by pulling hard. It
    // feeds the overrun pops and is used up during the overrun, so a lift
    // after a pull crackles for a second or two and then fades, instead of
    // popping endlessly on a long coast.
    this.popHeat = 0;
    this.mLp = 0; this.dcX = 0; this.dcY = 0;
    this.vib1 = 0; this.vib2 = 0; this.vibHp = 0;
    // per-source transmission-path lowpass states
    this.tEx = 0; this.tIn = 0; this.tMe = 0; this.tTu = 0; this.tSt = 0; this.tBa = 0;

    this._applyParams();

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'state') {
        this.rpmT = m.rpm;
        this.loadT = m.load;
        if (m.maxRpm) this.maxRpm = m.maxRpm;
        if (m.comb !== undefined) this.combT = m.comb;
        const eng = m.crank ? 1 : 0;
        if (eng !== this.stEng) {
          this.stEng = eng;
          if (eng) {
            // Key turned: solenoid pulls in, pinion slams onto the ring gear
            this.solEnv = 1;
            this.thumpEnv = 1;
            this.pinDelay = Math.round(0.022 * this.sr);
          } else {
            this.solEnv = 0.45; // pinion retracts: lighter release click
          }
        }
        if (m.starterLevel !== undefined) this.starterLevel = m.starterLevel;
      } else if (m.type === 'params') {
        this.P = m.params;
        this._applyParams();
      }
    };
  }

  /** Recompute everything derived from the parameter set. */
  _applyParams() {
    const P = this.P, sr = this.sr;
    const D = (L) => 2 * L * sr / SPEED_OF_SOUND;

    this.N = Math.max(1, Math.min(MAX_CYL, Math.round(P.cylinders || 8)));

    // Which exhaust bank (header) each firing slot dumps into
    this.bank = new Uint8Array(this.N);
    if (P.firingPattern === 'v8-crossplane' && this.N === 8) {
      // Firing order 1-8-4-3-6-5-7-2, cylinders 1/3/5/7 on the left bank:
      const s = 'LRRLRLLR';
      for (let i = 0; i < 8; i++) this.bank[i] = s[i] === 'R' ? 1 : 0;
    } else if (P.firingPattern === 'paired') {
      // Boxer-4 firing 1-3-2-4 with 1/3 on one side: banks go R R L L
      for (let i = 0; i < this.N; i++) this.bank[i] = (i >> 1) & 1 ? 0 : 1;
    } else if (P.firingPattern !== 'single') {
      for (let i = 0; i < this.N; i++) this.bank[i] = i & 1;
    }

    this.runL.set(D(P.runnerLength), P.runnerFb, lpCoef(3200, sr));
    // Unequal runner lengths: slightly by default (like a real manifold),
    // strongly for unequal-length headers (pulses reach the collector
    // out of step — the boxer rumble)
    const imb = P.runnerImbalance !== undefined ? P.runnerImbalance : 1.07;
    this.runR.set(D(P.runnerLength * imb), P.runnerFb, lpCoef(3200, sr));
    // The muffler sits inside the pipe's round trip, so its absorption also
    // damps the pipe resonance (a straight pipe keeps the full reflection)
    const mufflerDamp = P.straightMix + (1 - P.straightMix) * 0.6;
    this.exPipe.set(D(P.exhaustLength), P.exhaustFb * mufflerDamp, lpCoef(P.exhaustLp, sr));
    this.inPipe.set(D(P.intakeLength), P.intakeFb, lpCoef(2500, sr));

    this.muffK = lpCoef(P.mufflerCutoff, sr);
    this.inColK = lpCoef(P.intakeColor, sr);
    this.masterK = lpCoef(P.masterLp, sr);
    this.hissK = lpCoef(3500, sr);

    this.mechDecay = Math.exp(-1 / (Math.max(0.5, P.tickDecay) * 0.001 * sr));
    this.chainDecay = Math.exp(-1 / (0.0025 * sr));
    this.bpRes1.set(P.res1Freq, 6, sr);
    this.bpRes2.set(P.res2Freq, 9, sr);
    this.bpChain.set(P.chainFreq, 5, sr);

    this.kRpm = tauCoef(0.03, sr);
    this.kLoad = tauCoef(0.02, sr);
    this.kLoadSlow = tauCoef(0.25, sr);
    this.kWobble = tauCoef(0.04, sr);
    this.spoolUp = tauCoef(Math.max(0.05, P.spoolTime), sr);
    this.spoolDn = tauCoef(Math.max(0.05, P.spoolTime * 1.6), sr);
    this.boDecay = Math.exp(-1 / (0.18 * sr));
    this.popGapSamples = Math.round(0.06 * sr);
    this.kPopFill = tauCoef(0.4, sr);
    this.popBurn = Math.exp(-1 / (Math.max(0.1, P.popDecay || 1.2) * sr));

    this.driveNorm = 1 / Math.tanh(Math.max(0.3, P.drive));

    // Starter & ignition
    this.kHeat = tauCoef(1.8, sr);   // exhaust gas heats up…
    this.kCool = tauCoef(5.0, sr);   // …and cools down slower
    this.bangPipe.set(D(0.32), 0.45, lpCoef(5000, sr));
    this.bangCrackK = lpCoef(1400, sr);
    const tone = (hz) => (!hz || hz >= 18000 ? 1 : lpCoef(hz, sr));
    this.kTEx = tone(P.exhaustTone);
    this.kTIn = tone(P.intakeTone);
    this.kTMe = tone(P.mechTone);
    this.kTTu = tone(P.turboTone);
    this.kTSt = tone(P.starterTone);
    this.kTBa = tone(P.bangTone);
    this.vibK = lpCoef(110, sr);   // mounts pass the low orders only
    this.vibHpK = lpCoef(18, sr);  // (remove the pulse train's DC)
    this.kComb = tauCoef(0.04, sr);
    this.kStLock = tauCoef(0.004, sr);         // pinion locked to the ring gear
    this.stSpinDown = Math.exp(-1 / (0.22 * sr)); // free armature spin-down
    this.solDecay = Math.exp(-1 / (0.006 * sr));
    this.thumpDecay = Math.exp(-1 / (0.045 * sr));
    this.bpSol.set(2300, 4, sr);
    this.bpPin.set(3600, 7, sr);
    this.bpBrush.set(1800, 1.2, sr);
    this.bpGrind.set(900, 0.9, sr);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    const bangOut = outputs[1] ? outputs[1][0] : null;
    const P = this.P, sr = this.sr, N = this.N;
    const w = P.fireWidth, wIn = 0.28;
    const TWO_PI = 2 * Math.PI;
    const intakeNorm = 2 / Math.max(2, N);

    // Blow-off filter follows its (block-rate) envelope down in pitch
    // Blown (noisy) part of the turbo whistle tracks the blade-pass pitch
    if (P.turbo && (P.whineNoise || 0) > 0) {
      const fw = P.whineMin + (P.whineMax - P.whineMin) * this.spool;
      this.bpWhine.set(fw, 3.5, sr);
    }
    if (P.turbo && this.boEnv > 0.005) {
      this.bpBlow.set(700 + 2600 * this.boEnv, 1.5, sr);
    }

    for (let i = 0; i < out.length; i++) {
      // ---- control smoothing ----
      this.rpm += (this.rpmT - this.rpm) * this.kRpm;
      this.load += (this.loadT - this.load) * this.kLoad;
      this.loadSlow += (this.load - this.loadSlow) * this.kLoadSlow;
      const load = this.load;
      const rpmNorm = Math.min(1, this.rpm / this.maxRpm);

      // ---- ignition: combustion amount (misfiring while catching) ----
      this.comb += (this.combT - this.comb) * this.kComb;

      // ---- crankshaft (with idle wobble) ----
      // Without combustion at low revs, the crank slows into every
      // compression stroke (slowest at each TDC, i.e. phase c/N).
      this.wobble += (this.wobbleT - this.wobble) * this.kWobble;
      const crankRef = P.crankRpm || 200;
      const lowRev = Math.max(0, Math.min(1,
        (2.5 * crankRef - this.rpm) / (1.5 * crankRef)));
      const dip = (P.compressionDip || 0) * (1 - this.comb) * lowRev;
      const comp = 0.5 + 0.5 * Math.cos(TWO_PI * N * this.phase);
      const sf = 1 - dip * comp; // instantaneous crank speed factor
      const dp = this.rpm * (1 + this.wobble) * sf / (120 * sr);
      this.phase += dp;
      if (this.phase >= 1) {
        this.phase -= 1;
        const depth = P.idleWobble * (1 - load) * (1 - rpmNorm) * (1 - rpmNorm);
        this.wobbleT = (Math.random() * 2 - 1) * depth;
      }

      // ---- exhaust gas temperature → pipe tuning (+ flow turbulence) ----
      const heat = this.comb * (0.15 + 0.5 * load + 0.35 * rpmNorm);
      this.gasT += (heat - this.gasT) * (heat > this.gasT ? this.kHeat : this.kCool);
      const thermal = 1 / (1 + (P.gasTemp || 0) * (this.gasT - 0.45) * 2);
      const turb = (P.turbulence || 0) * (0.3 + 0.7 * load);
      const sL = thermal * (1 + turb * this.turbL.tick());
      const sR = thermal * (1 + turb * this.turbR.tick());
      const sX = thermal * (1 + turb * this.turbX.tick());
      const sI = 1 + turb * 0.5 * this.turbI.tick();

      // ---- cylinders: combustion pulses, intake gates, impacts ----
      const overrun = load < 0.12 && rpmNorm > 0.28;
      if (overrun) {
        this.popHeat *= this.popBurn;
      } else {
        const fill = Math.min(1, load * 1.3) * Math.max(0, Math.min(1, (rpmNorm - 0.2) * 2.2));
        this.popHeat += (fill - this.popHeat) * this.kPopFill;
      }
      const imb = P.cylImbalance || 0;
      const jit = (P.phaseJitter || 0) / 720;             // degrees → cycles
      const wJit = Math.min(0.4, 0.1 * (P.phaseJitter || 0));
      this.samplesSincePop++;
      let exL = 0, exR = 0, gate = 0;
      for (let c = 0; c < N; c++) {
        let x = this.phase - c / N;
        if (x < 0) x += 1;
        if (x < dp) {
          // New cycle for this cylinder: combustion strength varies
          // shot-to-shot (mixture/ignition dispersion, strongest at idle)
          this.cycleAmp[c] = (1 + P.variability * (Math.random() * 4 - 2)) *
            (1 + imb * this.cylBias[c]);
          // Combustion phasing: this cylinder's own lag + cycle jitter, and
          // a burn that's a little quicker or slower every time
          this.cycleOff[c] = imb * 0.05 * this.cylLag[c] + Math.random() * jit;
          this.cycleW[c] = w * (1 + wJit * (Math.random() * 2 - 1));
          // Ignition: does this cylinder fire this cycle? (always, once
          // running; sometimes while the engine is catching; never while
          // cranking or after key-off)
          const fire = this.comb > 0.995 ? 1 :
            (Math.random() < this.comb * this.comb * 1.2 ? 1 : 0);
          this.cycleFire[c] = fire;
          let pop = 0;
          // popChance sets a rate (≈ popChance × 80 pops/s with a hot
          // exhaust), spread over however many cylinder cycles there are,
          // so a V10 at 6,000 rpm doesn't pop 10× more than a four
          if (fire && overrun && this.samplesSincePop > this.popGapSamples &&
              Math.random() < P.popChance * 80 * Math.pow(this.popHeat, 1.2) /
                Math.max(1, N * this.rpm / 120)) {
            pop = 1;
            this.samplesSincePop = 0;
            // …and it bangs at the tailpipe once the pulse gets there,
            // sometimes followed by a crackle or two
            const travel = Math.round(this.runL.D + this.exPipe.D);
            const strength = 0.7 + Math.random() * 0.6;
            this.bangQ.push([travel, strength]);
            const cr = P.crackle || 0;
            for (let k = 0; k < 3; k++) {
              if (Math.random() < cr * (0.7 - 0.2 * k)) {
                this.bangQ.push([travel + Math.round((0.012 + Math.random() * 0.05 * (k + 1)) * sr),
                  strength * (0.25 + Math.random() * 0.35)]);
              }
            }
          }
          this.cyclePop[c] = pop;
          // Piston reaches TDC and fires: mechanical impact on the block
          // (piston slap is driven by combustion pressure — much softer
          // when the cylinder doesn't fire, e.g. while cranking)
          this.mechEnv += (0.5 + Math.random() * 0.8) * (fire ? 1 : 0.3);
        }
        const xe = x - this.cycleOff[c];
        const wc = this.cycleW[c];
        if (xe >= 0 && xe < wc) {
          // Exhaust blow-down pressure pulse (raised cosine squared)
          let g = 0.5 - 0.5 * Math.cos(TWO_PI * xe / wc);
          g *= g;
          let a, nMix;
          if (this.cycleFire[c]) {
            a = (P.idleLevel + (1 - P.idleLevel) * load) * this.cycleAmp[c];
            nMix = P.fireNoise;
            if (this.cyclePop[c]) { a *= P.popGain; nMix = 1; }
          } else {
            // Unfired: just the compressed charge puffing out (air noise)
            a = (P.pumpLevel || 0) * this.cycleAmp[c];
            nMix = 0.9;
          }
          const sig = a * g * (1 + nMix * (Math.random() * 2 - 1));
          if (this.bank[c]) exR += sig; else exL += sig;
        }
        // Intake stroke sits 360° after the power stroke begins
        let xi = x - 0.5;
        if (xi < 0) xi += 1;
        if (xi < wIn) gate += 0.5 - 0.5 * Math.cos(TWO_PI * xi / wIn);
      }

      // ---- exhaust tract: headers -> main pipe -> muffler ----
      const hdr = this.runL.tick(exL, sL) + this.runR.tick(exR, sR);
      const pipeOut = this.exPipe.tick(hdr * 0.8, sX);
      this.muff1 += (pipeOut - this.muff1) * this.muffK;
      this.muff2 += (this.muff1 - this.muff2) * this.muffK;
      const exhaust = (P.straightMix * pipeOut +
        (1 - P.straightMix) * this.muff2 * 1.4) * P.exhaustGain;

      // ---- intake tract ----
      const white = Math.random() * 2 - 1;
      this.inCol += (white - this.inCol) * this.inColK;
      const inExc = this.inCol * gate * (0.25 + 0.75 * load) * intakeNorm *
        (0.35 + 0.65 * this.comb); // cranking: just the starter's slow suction
      const intake = this.inPipe.tick(inExc, sI) *
        P.intakeGain * (0.35 + 0.65 * rpmNorm);

      // ---- mechanical: block modes + chain rattle ----
      this.mechEnv *= this.mechDecay;
      const strike = this.mechEnv * (Math.random() * 2 - 1);
      const mech = (this.bpRes1.tick(strike) * P.res1Gain +
        this.bpRes2.tick(strike) * P.res2Gain) *
        P.mechGain * (0.3 + 0.7 * rpmNorm);

      this.chainPhase += this.rpm / (120 * sr) * 14; // ~valve events/cycle
      if (this.chainPhase >= 1) {
        this.chainPhase -= 1;
        if (Math.random() < P.chainDensity) {
          this.chainEnv += 0.4 + Math.random() * 0.8;
        }
      }
      this.chainEnv *= this.chainDecay;
      const chain = this.bpChain.tick(this.chainEnv * (Math.random() * 2 - 1)) *
        P.chainGain * (0.25 + 0.75 * rpmNorm) * (1 - 0.5 * load);

      // ---- turbocharger ----
      let turbo = 0;
      if (P.turbo) {
        // Exhaust energy spools the turbine against its inertia
        const tgt = Math.pow(rpmNorm, 1.4) * (0.2 + 0.8 * load);
        this.spool += (tgt - this.spool) *
          (tgt > this.spool ? this.spoolUp : this.spoolDn);
        const s2 = this.spool * this.spool;
        // blade-pass frequency wanders with the airflow; level flutters
        const f = (P.whineMin + (P.whineMax - P.whineMin) * this.spool) *
          (1 + 0.006 * this.whFm.tick());
        this.turboPh += f / sr;
        if (this.turboPh >= 1) this.turboPh -= 1;
        // pure blade-pass tone, blended with narrowband "blown" noise at the
        // same pitch (whineNoise): heard through ducts it isn't a clean tone
        const wn = P.whineNoise || 0;
        const tone = Math.sin(TWO_PI * this.turboPh) * 0.75 +
          Math.sin(2 * TWO_PI * this.turboPh + 0.9) * 0.35;
        const blown = wn > 0 ? this.bpWhine.tick(white) * 3.2 : 0;
        const whine = (tone * (1 - wn) + blown * wn) *
          s2 * P.whineGain * 0.5 * (0.8 + 0.2 * this.whAm.tick());
        this.hissLp += (white - this.hissLp) * this.hissK;
        const hiss = (white - this.hissLp) * s2 * P.hissGain * 0.6;
        // Throttle slams shut under boost -> pressure vents (blow-off)
        if (this.loadSlow - load > 0.35 && this.spool > 0.4 &&
            this.boEnv < 0.1) {
          this.boEnv = this.spool;
        }
        this.boEnv *= this.boDecay;
        let blow = 0;
        if (this.boEnv > 0.005) {
          blow = this.bpBlow.tick(white) * this.boEnv * P.blowoffGain * 2.5;
        }
        turbo = whine + hiss + blow;
      }

      // ---- starter motor + solenoid ----
      let starter = 0;
      if (this.stEng || this.stRps > 0.5 || this.solEnv > 1e-4 ||
          this.thumpEnv > 1e-4 || this.pinEnv > 1e-4 || this.pinDelay > 0) {
        const crankRps = this.rpm * sf / 60;
        const refRps = crankRef / 60 * STARTER_RATIO;
        let amp;
        if (this.stEng) {
          // Meshed: armature locked to the crank through the gears. It
          // strains (louder) into every compression stroke and gets
          // dragged faster when the engine catches (pinion overrun).
          // (with a little cogging / brush-contact speed scatter)
          this.stRps += (crankRps * STARTER_RATIO * (1 + 0.025 * this.stJit.tick()) -
            this.stRps) * this.kStLock;
          const strain = dip > 0 ? comp * dip / Math.max(0.05, P.compressionDip) : 0;
          amp = 0.4 + 1.4 * strain;
        } else {
          this.stRps *= this.stSpinDown; // freewheels to a stop
          amp = 0.55 * Math.min(1, this.stRps / refRps);
        }
        let motor = 0;
        if (this.stRps > 0.5) {
          // Gear mesh whine (only while the pinion is in the ring gear)
          let mesh = 0;
          if (this.stEng) {
            this.stMeshPh += (P.ringTeeth || 150) * crankRps / sr;
            if (this.stMeshPh >= 1) this.stMeshPh -= Math.floor(this.stMeshPh);
            const m = TWO_PI * this.stMeshPh;
            mesh = Math.sin(m) + 0.45 * Math.sin(2 * m + 0.7) +
              0.25 * Math.sin(3 * m + 1.9);
          }
          // Commutator buzz + brush noise + armature hum
          this.stCommPh += this.stRps * COMMUTATOR_BARS / sr;
          if (this.stCommPh >= 1) this.stCommPh -= Math.floor(this.stCommPh);
          const cs = Math.sin(TWO_PI * this.stCommPh);
          const pulse = cs * cs * cs * cs * cs * cs;
          const brush = this.bpBrush.tick(white) * pulse;
          this.stArmPh += this.stRps / sr;
          if (this.stArmPh >= 1) this.stArmPh -= Math.floor(this.stArmPh);
          const hum = Math.sin(TWO_PI * this.stArmPh);
          // Mostly a gritty, noisy whirr (brushes + gear rattle), with only a
          // hint of tone — a real starter isn't a clean electric whine
          const grind = this.bpGrind.tick(white) * (0.6 + 0.8 * (Math.random() < 0.3 ? 1 : 0));
          motor = (mesh * 0.12 + (pulse - 0.3) * 0.22 + brush * 2.0 + grind * 1.4 +
            hum * 0.04) * amp;
        }
        // Solenoid pull-in / release click, pinion clank
        this.solEnv *= this.solDecay;
        this.thumpEnv *= this.thumpDecay;
        this.thumpPh += 120 / sr;
        if (this.thumpPh >= 1) this.thumpPh -= 1;
        if (this.pinDelay > 0 && --this.pinDelay === 0) this.pinEnv = 1;
        this.pinEnv *= this.solDecay;
        const clicks = this.bpSol.tick(white * this.solEnv) * 3 +
          Math.sin(TWO_PI * this.thumpPh) * this.thumpEnv * 0.5 +
          this.bpPin.tick(white * this.pinEnv) * 3.5;
        starter = (motor * P.starterGain + clicks * P.solenoidGain) *
          this.starterLevel * 0.03;
      }

      // ---- mix, saturate, tone, DC-block ----
      // ---- structure-borne vibration (body panels re-radiating) ----
      let vib = 0;
      const vg = (P.vibGain || 0) * (P.vibration === undefined ? 1 : P.vibration);
      if (vg > 0) {
        this.vib1 += (exL + exR - this.vib1) * this.vibK;
        this.vib2 += (this.vib1 - this.vib2) * this.vibK;
        this.vibHp += (this.vib2 - this.vibHp) * this.vibHpK;
        vib = (this.vib2 - this.vibHp) * vg * 1.6;
      }

      // ---- transmission path: per-source lowpass to the listener ----
      let exT = exhaust, inT = intake, meT = mech + chain, tuT = turbo, stT = starter;
      if (this.kTEx < 1) exT = (this.tEx += (exhaust - this.tEx) * this.kTEx);
      if (this.kTIn < 1) inT = (this.tIn += (intake - this.tIn) * this.kTIn);
      if (this.kTMe < 1) meT = (this.tMe += (mech + chain - this.tMe) * this.kTMe);
      if (this.kTTu < 1) tuT = (this.tTu += (turbo - this.tTu) * this.kTTu);
      if (this.kTSt < 1) stT = (this.tSt += (starter - this.tSt) * this.kTSt);

      let sum = exT + inT + meT + tuT + stT + vib;
      sum = Math.tanh(sum * P.drive) * this.driveNorm;
      this.mLp += (sum - this.mLp) * this.masterK;
      const y = this.mLp - this.dcX + 0.995 * this.dcY;
      this.dcX = this.mLp;
      this.dcY = y;
      out[i] = y * P.masterGain * 0.7;

      // ---- overrun bang layer (output 1) ----
      if (bangOut) {
        for (let q = this.bangQ.length - 1; q >= 0; q--) {
          if (--this.bangQ[q][0] <= 0) {
            const st = this.bangQ[q][1];
            this.bangQ.splice(q, 1);
            if (st > this.bangEnv) {
              this.bangEnv = st;
              this.bangDecay = Math.exp(-1 / ((0.005 + Math.random() * 0.012) * sr));
              this.bpBangLo.set(90 + Math.random() * 140, 1.6, sr);
            }
          }
        }
        let bang = 0;
        if (this.bangEnv > 1e-4) {
          // crack: bright noise burst; body: low resonant thump
          this.bangLp += (white - this.bangLp) * this.bangCrackK;
          const crack = white - this.bangLp;
          const body = this.bpBangLo.tick(white) * 4;
          const ck = P.bangCrack === undefined ? 1 : P.bangCrack;
          bang = this.bangPipe.tick((crack * 0.9 * ck + body) * this.bangEnv);
          this.bangEnv *= this.bangDecay;
        }
        if (this.kTBa < 1) bang = (this.tBa += (bang - this.tBa) * this.kTBa);
        bangOut[i] = bang * (P.bangLevel || 0) * 0.8;
      }
    }
    return true;
  }
}

registerProcessor('physical-engine', PhysicalEngineProcessor);
