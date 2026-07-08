/**
 * PhysicalEngineSound — physically informed engine synthesis
 * (third sound engine, next to the synth and the sample packs).
 *
 * All the DSP lives in an AudioWorklet (js/physical-worklet.js) so the
 * per-cylinder pulse trains and waveguides run sample-accurately off the
 * main thread. This class only owns the AudioContext, the output chain
 * (gain -> compressor) and the control messages.
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
    await ctx.audioWorklet.addModule('js/physical-worklet.js?v=14');
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
    this.node.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.3);
    this.running = true;
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
