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
 *     └── exhaust-energy-driven turbo spool state ──> turbine whine
 *         (blade-pass tone), boost hiss, blow-off burst on throttle lift
 *
 *   mix ──> tanh soft clip (drive) ──> master lowpass ──> DC blocker
 *
 * A digital waveguide is a delay line with a filtered, sign-inverting
 * reflection: the pressure wave travels down the pipe, loses highs to the
 * walls (one-pole LP) and partially reflects at the open end with phase
 * inversion — giving the odd-harmonic resonances of a closed/open pipe.
 * Delay length D = 2·L·sr/c for acoustic length L.
 *
 * Control: main thread posts {type:'state', rpm, load, maxRpm} every
 * frame and {type:'params', params} when a tuner slider moves. All
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
  constructor(size) {
    this.buf = new Float32Array(size);
    this.size = size;
    this.w = 0;
    this.D = 64;
    this.fb = 0.5;
    this.k = 0.3;
    this.lp = 0;
  }
  set(D, fb, k) {
    this.D = Math.max(2, Math.min(this.size - 1, Math.round(D)));
    this.fb = fb;
    this.k = k;
  }
  tick(x) {
    let r = this.w - this.D;
    if (r < 0) r += this.size;
    const y = this.buf[r];
    this.lp += (y - this.lp) * this.k;
    this.buf[this.w] = x - this.fb * this.lp;
    if (++this.w === this.size) this.w = 0;
    return y;
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
    this.wobble = 0; this.wobbleT = 0;

    // Waveguides (sized for ≤6 m pipe at 96 kHz)
    this.runL = new Pipe(2048);
    this.runR = new Pipe(2048);
    this.exPipe = new Pipe(4096);
    this.inPipe = new Pipe(2048);

    // Filter/envelope state
    this.muff1 = 0; this.muff2 = 0;
    this.inCol = 0;
    this.mechEnv = 0; this.chainEnv = 0; this.chainPhase = 0;
    this.bpRes1 = new Bandpass();
    this.bpRes2 = new Bandpass();
    this.bpChain = new Bandpass();
    this.bpBlow = new Bandpass();
    this.spool = 0; this.turboPh = 0; this.boEnv = 0; this.hissLp = 0;
    this.samplesSincePop = 1e9;
    this.mLp = 0; this.dcX = 0; this.dcY = 0;

    this._applyParams();

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'state') {
        this.rpmT = m.rpm;
        this.loadT = m.load;
        if (m.maxRpm) this.maxRpm = m.maxRpm;
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
    } else if (P.firingPattern !== 'single') {
      for (let i = 0; i < this.N; i++) this.bank[i] = i & 1;
    }

    this.runL.set(D(P.runnerLength), P.runnerFb, lpCoef(3200, sr));
    // Slightly unequal runner lengths, like a real manifold
    this.runR.set(D(P.runnerLength * 1.07), P.runnerFb, lpCoef(3200, sr));
    this.exPipe.set(D(P.exhaustLength), P.exhaustFb, lpCoef(P.exhaustLp, sr));
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

    this.driveNorm = 1 / Math.tanh(Math.max(0.3, P.drive));
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    const P = this.P, sr = this.sr, N = this.N;
    const w = P.fireWidth, wIn = 0.28;
    const TWO_PI = 2 * Math.PI;
    const intakeNorm = 2 / Math.max(2, N);

    // Blow-off filter follows its (block-rate) envelope down in pitch
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

      // ---- crankshaft (with idle wobble) ----
      this.wobble += (this.wobbleT - this.wobble) * this.kWobble;
      const dp = this.rpm * (1 + this.wobble) / (120 * sr);
      this.phase += dp;
      if (this.phase >= 1) {
        this.phase -= 1;
        const depth = P.idleWobble * (1 - load) * (1 - rpmNorm) * (1 - rpmNorm);
        this.wobbleT = (Math.random() * 2 - 1) * depth;
      }

      // ---- cylinders: combustion pulses, intake gates, impacts ----
      const overrun = load < 0.12 && rpmNorm > 0.28;
      this.samplesSincePop++;
      let exL = 0, exR = 0, gate = 0;
      for (let c = 0; c < N; c++) {
        let x = this.phase - c / N;
        if (x < 0) x += 1;
        if (x < dp) {
          // New cycle for this cylinder: combustion strength varies
          // shot-to-shot (mixture/ignition dispersion, strongest at idle)
          this.cycleAmp[c] = 1 + P.variability * (Math.random() * 4 - 2);
          let pop = 0;
          if (overrun && this.samplesSincePop > this.popGapSamples &&
              Math.random() < P.popChance) {
            pop = 1;
            this.samplesSincePop = 0;
          }
          this.cyclePop[c] = pop;
          // Piston reaches TDC and fires: mechanical impact on the block
          this.mechEnv += 0.5 + Math.random() * 0.8;
        }
        if (x < w) {
          // Exhaust blow-down pressure pulse (raised cosine squared)
          let g = 0.5 - 0.5 * Math.cos(TWO_PI * x / w);
          g *= g;
          let a = (P.idleLevel + (1 - P.idleLevel) * load) * this.cycleAmp[c];
          let nMix = P.fireNoise;
          if (this.cyclePop[c]) { a *= P.popGain; nMix = 1; }
          const sig = a * g * (1 + nMix * (Math.random() * 2 - 1));
          if (this.bank[c]) exR += sig; else exL += sig;
        }
        // Intake stroke sits 360° after the power stroke begins
        let xi = x - 0.5;
        if (xi < 0) xi += 1;
        if (xi < wIn) gate += 0.5 - 0.5 * Math.cos(TWO_PI * xi / wIn);
      }

      // ---- exhaust tract: headers -> main pipe -> muffler ----
      const hdr = this.runL.tick(exL) + this.runR.tick(exR);
      const pipeOut = this.exPipe.tick(hdr * 0.8);
      this.muff1 += (pipeOut - this.muff1) * this.muffK;
      this.muff2 += (this.muff1 - this.muff2) * this.muffK;
      const exhaust = (P.straightMix * pipeOut +
        (1 - P.straightMix) * this.muff2 * 1.4) * P.exhaustGain;

      // ---- intake tract ----
      const white = Math.random() * 2 - 1;
      this.inCol += (white - this.inCol) * this.inColK;
      const inExc = this.inCol * gate * (0.25 + 0.75 * load) * intakeNorm;
      const intake = this.inPipe.tick(inExc) *
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
        const f = P.whineMin + (P.whineMax - P.whineMin) * this.spool;
        this.turboPh += f / sr;
        if (this.turboPh >= 1) this.turboPh -= 1;
        const whine = (Math.sin(TWO_PI * this.turboPh) * 0.75 +
          Math.sin(2 * TWO_PI * this.turboPh + 0.9) * 0.35) *
          s2 * P.whineGain * 0.5;
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

      // ---- mix, saturate, tone, DC-block ----
      let sum = exhaust + intake + mech + chain + turbo;
      sum = Math.tanh(sum * P.drive) * this.driveNorm;
      this.mLp += (sum - this.mLp) * this.masterK;
      const y = this.mLp - this.dcX + 0.995 * this.dcY;
      this.dcX = this.mLp;
      this.dcY = y;
      out[i] = y * P.masterGain * 0.7;
    }
    return true;
  }
}

registerProcessor('physical-engine', PhysicalEngineProcessor);
