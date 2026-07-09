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
 */
class PhysicalEngineSound {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.running = false;
    this.volume = 0.7;
    this.params = window.PhysicalParams.load();
    window.addEventListener('storage', (e) => {
      if (e.key === window.PhysicalParams.STORAGE_KEY) {
        this.setParams(window.PhysicalParams.load());
      }
    });
  }

  async start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    if (!ctx.audioWorklet) {
      ctx.close().catch(() => {});
      throw new Error('AudioWorklet not supported by this browser');
    }
    await ctx.resume();
    await ctx.audioWorklet.addModule('js/physical-worklet.js?v=17');
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
    this._buildFx(ctx, this.node, this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);
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
    setTimeout(() => ctx.close().catch(() => {}), 300);
    this.ctx = null;
    this.node = null;
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

  /** Replace the parameter set (tuner sliders); safe while running. */
  setParams(params) {
    this.params = params;
    if (this.node) {
      this.node.port.postMessage({ type: 'params', params });
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
