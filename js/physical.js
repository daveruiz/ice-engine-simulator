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
class PhysicalEngineSound {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.running = false;
    this.volume = 0.7;
    // baseParams: the engine as tuned/preset. params: what the DSP runs,
    // i.e. baseParams with the listening-position modifiers applied.
    this.listener = 'original';
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
    await ctx.audioWorklet.addModule('js/physical-worklet.js?v=18');
    this.ctx = ctx;

    this.node = new AudioWorkletNode(ctx, 'physical-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { params: this.params },
    });

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.fxOut = ctx.createGain();
    this._buildFx(ctx, this.node, this.fxOut);
    this._buildSpace(ctx, this.fxOut, this.master);
    this.master.connect(comp);
    comp.connect(opts.destination || ctx.destination);
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
    for (const id of Object.keys(this.spaces)) {
      const s = this.spaces[id];
      const active = id === L.id;
      clearTimeout(s.timer);
      if (active && !s.connected) {
        this.spBoom.connect(s.conv);
        s.connected = true;
      }
      s.wet.gain.setTargetAtTime(active ? sp.mix : 0, t, S);
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
  update(rpm, throttle, maxRpm, cylinders, shifting, shiftDir) {
    if (!this.running || !this.node) return;
    // Upshift: torque cut. Downshift: rev-match blip.
    let load = throttle;
    if (shifting) {
      load = shiftDir < 0 ? Math.max(throttle, 0.55) : throttle * 0.15;
    }
    this.node.port.postMessage({ type: 'state', rpm, load, maxRpm });
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

window.PhysicalEngineSound = PhysicalEngineSound;
