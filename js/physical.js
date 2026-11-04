/**
 * PhysicalEngineSound — physically informed engine synthesis
 * (third sound engine, next to the synth and the sample packs).
 *
 * All the DSP lives in an AudioWorklet (js/physical-worklet.js) so the
 * per-cylinder pulse trains and waveguides run sample-accurately off the
 * main thread. This class owns the AudioContext, the FX bus (EQ +
 * parallel saturation), the output chain (gain -> compressor) and the
 * control messages.
 *
 * Parameters come from PhysicalParams (js/physical-params.js): defaults
 * describe a cross-plane V8, overridden by whatever the tuner page
 * (tuner.html) saved to localStorage. A 'storage' listener applies tuner
 * changes live even when the tuner runs in another tab.
 *
 * On top of the engine parameters sits the listening position
 * (setListener: original / cabin / outside — see PhysicalParams.LISTENERS):
 * relative parameter modifiers plus an acoustic-space stage (transmission
 * lowpass, cabin boom, generated impulse response) after the FX bus.
 */
// Make-up gain (dB) per compression amount 0, .25, .5, .75, 1 — measured
// with dev/render-presets.js so the engine's loudness barely moves with the
// slider (it gets ~1 dB denser at full). Not monotonic because the native
// compressor applies its own partial auto make-up.
const MAKEUP_DB = [0.9, -1.3, -1.65, 0.4, 3.15];

class PhysicalEngineSound {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.running = false;
    this.volume = 0.7;
    // baseParams: the engine as tuned/preset. params: what the DSP runs,
    // i.e. baseParams with the listening-position modifiers applied.
    this.listener = 'original';
    this.starterLevel = 1;
    this.compression = 0.5; // mix compressor amount 0..1 (Settings)
    this.baseParams = window.PhysicalParams.load();
    this.params = this._effective();
    window.addEventListener('storage', (e) => {
      if (e.key === window.PhysicalParams.STORAGE_KEY) {
        this.setParams(window.PhysicalParams.load());
      }
    });
  }

  _effective() {
    return window.PhysicalParams.applyListener(this.baseParams, this.listener);
  }

  /**
   * Build the audio graph. Normally creates its own realtime context;
   * `opts.context` (+ optional `opts.destination`) attaches to an existing
   * one instead — e.g. an OfflineAudioContext for headless rendering.
   */
  async start(opts = {}) {
    if (this.running) return;
    let ctx = opts.context;
    this._ownsCtx = !ctx;
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx({ latencyHint: 'interactive' });
    }
    if (!ctx.audioWorklet) {
      if (this._ownsCtx) ctx.close().catch(() => {});
      throw new Error('AudioWorklet not supported by this browser');
    }
    if (this._ownsCtx) await ctx.resume();
    await ctx.audioWorklet.addModule('js/physical-worklet.js?v=21');
    this.ctx = ctx;

    // Output 0: the engine. Output 1: overrun tailpipe bangs.
    this.node = new AudioWorkletNode(ctx, 'physical-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [1, 1],
      processorOptions: { params: this.params },
    });

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // Mix (bus) compressor on the engine: evens out the level and makes it
    // denser; amount from Settings. The bangs skip it on purpose.
    this.busComp = ctx.createDynamicsCompressor();
    this.busMakeup = ctx.createGain();
    this.busComp.connect(this.busMakeup);
    this.fxOut = ctx.createGain();
    this.busMakeup.connect(this.fxOut);
    this._buildFx(ctx, this.node, this.busComp);
    // Bang layer: driven hard into saturation, then straight into the
    // acoustic space (so cabin/outside still filter it) — past the bus
    // compressor, so it punches out of the mix
    this.bangShaper = ctx.createWaveShaper();
    this.bangShaper.oversample = '4x';
    this.node.connect(this.bangShaper, 1, 0);
    this.bangShaper.connect(this.fxOut);
    this._bangDrive = 0;
    this._buildSpace(ctx, this.fxOut, this.master);
    // Final safety limiter: only catches peaks (bangs, flares)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    this.master.connect(limiter);
    limiter.connect(opts.destination || ctx.destination);
    this._applyComp(true);
    this._applyFx();
    // Master is left silent; main.js fades it in (see fadeIn) so the
    // starter clip can crank first and the engine swell in as it catches.
    this.running = true;
  }

  /** Swell the generated engine up from silence, optionally after a delay. */
  fadeIn(delaySec = 0, durSec = 0.4) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.setTargetAtTime(this.volume, now + delaySec, Math.max(0.01, durSec / 3));
  }

  /** Fade the generated engine down (used by the key-off spin-down). */
  fadeOut(durSec = 0.3) {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.01, durSec / 3));
  }

  /**
   * FX bus between the synthesis worklet and the master gain:
   * low shelf (bass exaggeration) -> mid peak -> high shelf ->
   * parallel tanh saturation (dry + shaped paths summed). Controlled by
   * the fx group of the parameter schema, live like everything else.
   */
  _buildFx(ctx, from, to) {
    this.eqBass = ctx.createBiquadFilter();
    this.eqBass.type = 'lowshelf';
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.Q.value = 0.9;
    this.eqTreble = ctx.createBiquadFilter();
    this.eqTreble.type = 'highshelf';
    this.eqTreble.frequency.value = 4500;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.satDry = ctx.createGain();
    this.satWet = ctx.createGain();
    from.connect(this.eqBass);
    this.eqBass.connect(this.eqMid);
    this.eqMid.connect(this.eqTreble);
    this.eqTreble.connect(this.satDry);
    this.eqTreble.connect(this.shaper);
    this.shaper.connect(this.satWet);
    this.satDry.connect(to);
    this.satWet.connect(to);
    this._satDrive = 0;
    this._applyFx();
  }

  _applyFx() {
    const p = this.params;
    const t = this.ctx.currentTime;
    const S = 0.03;
    this.eqBass.frequency.setTargetAtTime(p.bassFreq, t, S);
    this.eqBass.gain.setTargetAtTime(p.bassGain, t, S);
    this.eqMid.frequency.setTargetAtTime(p.midFreq, t, S);
    this.eqMid.gain.setTargetAtTime(p.midGain, t, S);
    this.eqTreble.gain.setTargetAtTime(p.trebleGain, t, S);
    if (this._satDrive !== p.satDrive) {
      this._satDrive = p.satDrive;
      this.shaper.curve = PhysicalEngineSound._satCurve(p.satDrive);
    }
    this.satDry.gain.setTargetAtTime(1 - p.satMix, t, S);
    this.satWet.gain.setTargetAtTime(p.satMix, t, S);
    if (this.bangShaper && this._bangDrive !== p.bangDrive) {
      this._bangDrive = p.bangDrive;
      this.bangShaper.curve = PhysicalEngineSound._satCurve(p.bangDrive || 5);
    }
  }

  /**
   * Mix compressor amount (0 = off … 1 = heavy). Lower threshold and a
   * higher ratio as it goes up; attack stays slow enough to keep the
   * combustion transients, and make-up gain restores the level.
   */
  setCompression(a) {
    this.compression = Math.max(0, Math.min(1, a));
    this._applyComp(false);
  }

  _applyComp(instant) {
    if (!this.ctx || !this.busComp) return;
    const a = this.compression, c = this.busComp, t = this.ctx.currentTime;
    const S = instant ? 0.001 : 0.05;
    c.threshold.setTargetAtTime(-2 - 34 * a, t, S);
    c.ratio.setTargetAtTime(1 + 11 * a, t, S);
    c.knee.setTargetAtTime(10, t, S);
    c.attack.setTargetAtTime(0.025 - 0.017 * a, t, S);
    c.release.setTargetAtTime(0.25 - 0.12 * a, t, S);
    this.busMakeup.gain.setTargetAtTime(PhysicalEngineSound.makeup(a), t, S);
  }

  /** Make-up gain for compression amount a (calibrated, see dev/). */
  static makeup(a) {
    const x = Math.max(0, Math.min(1, a)) * (MAKEUP_DB.length - 1);
    const i = Math.min(MAKEUP_DB.length - 2, Math.floor(x));
    const db = MAKEUP_DB[i] + (MAKEUP_DB[i + 1] - MAKEUP_DB[i]) * (x - i);
    return Math.pow(10, db / 20);
  }

  /**
   * Acoustic path to the listener (see PhysicalParams.LISTENERS):
   *   fx out -> transmission lowpass -> boom peak -> dry ----------> master
   *                                         └-> convolver[pos] -> wet -┘
   * One convolver per listening position with its own generated impulse
   * response; switching positions only ramps gains (no clicks), and only
   * the active convolver stays connected so idle ones cost nothing.
   */
  _buildSpace(ctx, from, to) {
    this.spLp = ctx.createBiquadFilter();
    this.spLp.type = 'lowpass';
    this.spBoom = ctx.createBiquadFilter();
    this.spBoom.type = 'peaking';
    this.spDry = ctx.createGain();
    from.connect(this.spLp);
    this.spLp.connect(this.spBoom);
    this.spBoom.connect(this.spDry);
    this.spDry.connect(to);
    this.spaces = {};
    for (const L of window.PhysicalParams.LISTENERS) {
      if (!L.space) continue;
      const conv = ctx.createConvolver();
      conv.buffer = PhysicalEngineSound._makeIR(ctx, L.space.ir);
      const wet = ctx.createGain();
      wet.gain.value = 0;
      conv.connect(wet);
      wet.connect(to);
      this.spaces[L.id] = { conv, wet, connected: false, timer: null };
    }
    this._applySpace(true);
  }

  _applySpace(instant) {
    if (!this.ctx || !this.spLp) return;
    const L = window.PhysicalParams.listener(this.listener);
    const sp = L.space;
    const t = this.ctx.currentTime;
    const S = instant ? 0.001 : 0.08;
    const nyq = this.ctx.sampleRate / 2;
    this.spLp.frequency.setTargetAtTime(
      Math.min(sp ? sp.lowpass : 20000, nyq * 0.95), t, S);
    this.spLp.Q.setTargetAtTime(sp ? sp.lowpassQ : 0.5, t, S);
    this.spBoom.frequency.setTargetAtTime(sp ? sp.boomFreq : 68, t, S);
    this.spBoom.Q.setTargetAtTime(sp ? sp.boomQ : 1, t, S);
    this.spBoom.gain.setTargetAtTime(sp ? sp.boomGain : 0, t, S);
    const g = sp && sp.gain !== undefined ? sp.gain : 1;
    this.spDry.gain.setTargetAtTime(g, t, S);
    for (const id of Object.keys(this.spaces)) {
      const s = this.spaces[id];
      const active = id === L.id;
      clearTimeout(s.timer);
      if (active && !s.connected) {
        this.spBoom.connect(s.conv);
        s.connected = true;
      }
      s.wet.gain.setTargetAtTime(active ? sp.mix * g : 0, t, S);
      if (!active && s.connected) {
        // Let the tail fade out before unplugging the idle convolver
        s.timer = setTimeout(() => {
          try { this.spBoom.disconnect(s.conv); } catch (e) { /* gone */ }
          s.connected = false;
        }, instant ? 0 : 1200);
      }
    }
  }

  /**
   * Procedural stereo impulse response: a few discrete early reflections
   * (cabin panels / ground bounce) followed by an exponentially decaying,
   * lowpassed noise tail (-60 dB at `decay`). `width` decorrelates L/R.
   */
  static _makeIR(ctx, o) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.ceil((o.predelay + o.decay) * sr));
    const buf = ctx.createBuffer(2, len, sr);
    const k = 1 - Math.exp(-2 * Math.PI * o.tone / sr);
    // Deterministic noise so every start sounds the same
    let seed = 22222;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 1073741823.5 - 1;
    };
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const pre = Math.round(o.predelay * sr);
    let lpL = 0, lpR = 0;
    for (let i = pre; i < len; i++) {
      const tt = (i - pre) / sr;
      const env = Math.exp(-6.9 * tt / o.decay);
      const c = rnd(), a = rnd(), b = rnd();
      lpL += ((c * (1 - o.width) + a * o.width) - lpL) * k;
      lpR += ((c * (1 - o.width) + b * o.width) - lpR) * k;
      L[i] = lpL * env * 0.6;
      R[i] = lpR * env * 0.6;
    }
    for (const [time, gain] of o.early || []) {
      const i = Math.round(time * sr);
      if (i < len) {
        L[i] += gain;
        R[Math.min(len - 1, i + Math.round(0.0007 * sr * o.width))] += gain * 0.9;
      }
    }
    return buf;
  }

  /** tanh saturation curve normalized to ±1 at full scale. */
  static _satCurve(drive) {
    const n = 1024;
    const curve = new Float32Array(n);
    const norm = 1 / Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) * norm;
    }
    return curve;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const ctx = this.ctx;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    if (this._ownsCtx) setTimeout(() => ctx.close().catch(() => {}), 300);
    for (const id of Object.keys(this.spaces || {})) {
      clearTimeout(this.spaces[id].timer);
    }
    this.ctx = null;
    this.node = null;
    this.spLp = null;
  }

  /**
   * Drive the model. Same interface as the other engines; the `cylinders`
   * setting from the main page is ignored — cylinder count and geometry
   * belong to the physical parameter set (tune them in tuner.html).
   */
  update(rpm, throttle, maxRpm, cylinders, shifting, shiftDir, ign) {
    if (!this.running || !this.node) return;
    // Upshift: torque cut. Downshift: rev-match blip.
    let load = throttle;
    if (shifting) {
      load = shiftDir < 0 ? Math.max(throttle, 0.55) : throttle * 0.15;
    }
    // ign (optional): { comb: combustion 0..1, crank: starter engaged }.
    // Omitted = engine running normally.
    this.node.port.postMessage({
      type: 'state', rpm, load, maxRpm,
      comb: ign ? ign.comb : 1,
      crank: !!(ign && ign.crank),
      starterLevel: this.starterLevel,
    });
  }

  /** Synthesized starter/solenoid level (1 = as tuned). */
  setStarterLevel(v) {
    this.starterLevel = v;
  }

  /** Replace the engine parameter set (tuner/preset); safe while running. */
  setParams(params) {
    this.baseParams = params;
    this._pushParams();
  }

  /** Move the listener: 'original' | 'cabin' | 'outside'. Live. */
  setListener(id) {
    id = window.PhysicalParams.listener(id).id;
    if (id === this.listener) return;
    this.listener = id;
    this._pushParams();
    this._applySpace(false);
  }

  _pushParams() {
    this.params = this._effective();
    if (this.node) {
      this.node.port.postMessage({ type: 'params', params: this.params });
      this._applyFx();
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.running && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }
}

/**
 * IgnitionSequence — the synthesized engine start, as a control curve fed
 * to PhysicalEngineSound.update() (shared by the simulator and the tuner):
 *
 *   key on → solenoid + pinion engage, the starter spins the crank up to
 *   cranking speed (no combustion: compression strokes drag it, see
 *   compressionDip) → a stray firing or two near the end → catch:
 *   combustion ramps in with misfires, revs flare to ~1.8× idle, the
 *   pinion is overrun and disengages → revs settle to idle.
 *
 * Cranking speed and time come from the physical params (crankRpm,
 * crankTime); the crank time varies ±15% per start like a real engine.
 */
class IgnitionSequence {
  constructor({ idleRpm, crankRpm, crankTime, randomize = true }) {
    this.idle = idleRpm;
    this.crank = Math.min(crankRpm, idleRpm * 0.8);
    this.crankTime = crankTime * (randomize ? 0.85 + Math.random() * 0.3 : 1);
    this.t = 0;
    this.engaged = true;
    this.done = false;
  }

  /** Advance dt seconds → { rpm, load, comb, crank, done }. */
  update(dt) {
    this.t += dt;
    const t = this.t, C = this.crank, idle = this.idle;
    const smooth = (p) => p * p * (3 - 2 * p);
    const SPIN_UP = 0.18;   // s: starter accelerating the crank from rest
    const RISE = 0.22;      // s: catch → flare peak
    const FALL = 0.95;      // s: flare peak → idle
    const peak = idle * 1.8;
    let rpm, comb = 0, load = 0;
    if (t < this.crankTime) {
      rpm = t < SPIN_UP ? C * smooth(t / SPIN_UP) : C * (1 + 0.04 * (t - SPIN_UP));
      // Near the end the odd cylinder fires on its own
      if (t > this.crankTime * 0.65) comb = 0.25;
    } else {
      const te = t - this.crankTime;
      const C2 = C * (1 + 0.04 * Math.max(0, this.crankTime - SPIN_UP));
      comb = Math.min(1, 0.45 + (0.55 * te) / 0.3);
      if (te < RISE) {
        rpm = C2 + (peak - C2) * smooth(te / RISE);
        load = 0.75; // all cylinders firing hard to pick the revs up
      } else {
        const p = Math.min(1, (te - RISE) / FALL);
        rpm = peak + (idle - peak) * smooth(p);
        load = 0.35 * (1 - p);
        if (p >= 1) this.done = true;
      }
      // Pinion overrun: the engine now drives the starter → it disengages
      if (this.engaged && (rpm > C2 * 1.7 || te > 0.25)) this.engaged = false;
    }
    return { rpm, load, comb, crank: this.engaged, done: this.done };
  }
}

window.PhysicalEngineSound = PhysicalEngineSound;
window.IgnitionSequence = IgnitionSequence;
