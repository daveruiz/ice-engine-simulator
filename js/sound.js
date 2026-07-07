/**
 * EngineSound — fully synthesized ICE sound (placeholder for real samples).
 *
 * Model: the dominant tone of a piston engine is the firing frequency
 *   f = rpm / 60 * cylinders / 2   (4-stroke: each cylinder fires every
 *                                   other revolution)
 * We stack detuned saw/square oscillators at sub/fundamental/harmonic
 * ratios, drive them through a waveshaper (exhaust distortion) and a
 * lowpass that opens with throttle, and add band-passed noise for
 * intake/exhaust breath. Load (throttle) controls both loudness and
 * brightness, which is what makes on/off-throttle sound so different
 * in a real car.
 */
class EngineSound {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.volume = 0.7;
  }

  async start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    await this.ctx.resume();
    this._build();
    this.running = true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const ctx = this.ctx;
    // Fade out quickly, then tear down.
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => ctx.close().catch(() => {}), 300);
    this.ctx = null;
  }

  _build() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Output chain: master -> compressor -> destination
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Engine tone chain: oscillators -> pre -> waveshaper -> lowpass -> gain
    this.pre = ctx.createGain();
    this.pre.gain.value = 0.5;

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = EngineSound._makeDistortionCurve(3.2);
    this.shaper.oversample = '2x';

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 400;
    this.lowpass.Q.value = 1.1;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.5;

    this.pre.connect(this.shaper);
    this.shaper.connect(this.lowpass);
    this.lowpass.connect(this.engineGain);
    this.engineGain.connect(this.master);

    // Oscillator stack: [freq ratio vs firing freq, type, level, detune cents]
    const layers = [
      [0.5, 'sawtooth', 0.85, 0],   // half order — big-engine rumble
      [1.0, 'sawtooth', 1.00, 0],   // firing fundamental
      [1.0, 'sawtooth', 0.45, 11],  // detuned copy — thickness
      [2.0, 'square',   0.30, 0],   // 2nd harmonic — mechanical edge
      [3.0, 'sawtooth', 0.14, -7],  // upper harmonic — rasp at revs
    ];
    this.oscs = layers.map(([ratio, type, level, detune]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 30 * ratio;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(this.pre);
      osc.start(t);
      return { osc, ratio };
    });

    // Slow wobble on pitch: idle lope / combustion unevenness.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfo.frequency.value = 6;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 1.5; // Hz of wobble, reduced at revs in update()
    this.lfo.connect(this.lfoGain);
    this.oscs.forEach(({ osc }) => this.lfoGain.connect(osc.frequency));
    this.lfo.start(t);

    // Intake/exhaust breath: looping white noise through a tracking bandpass
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 900;
    this.noiseFilter.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noise.start(t);

    // Fade master in
    this.master.gain.setTargetAtTime(this.volume, t, 0.4);
  }

  static _makeDistortionCurve(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(amount * x);
    }
    return curve;
  }

  /**
   * Drive the synth from the engine model. Call every animation frame.
   * @param {number} rpm
   * @param {number} throttle   0..1 engine load
   * @param {number} maxRpm
   * @param {number} cylinders
   * @param {boolean} shifting  torque cut during a gear change
   */
  update(rpm, throttle, maxRpm, cylinders, shifting) {
    if (!this.running || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const S = 0.045; // smoothing time constant for all params

    const firing = (rpm / 60) * (cylinders / 2);
    const rpmNorm = Math.min(1, rpm / maxRpm);

    // Torque cut while shifting: throttle momentarily closed.
    const load = shifting ? throttle * 0.15 : throttle;

    for (const { osc, ratio } of this.oscs) {
      osc.frequency.setTargetAtTime(firing * ratio, t, S);
    }

    // Pitch wobble: strong at idle, fades away as revs climb.
    this.lfoGain.gain.setTargetAtTime(2.2 * (1 - rpmNorm) ** 2, t, S);
    this.lfo.frequency.setTargetAtTime(5 + rpmNorm * 12, t, S);

    // Brightness: closed throttle = muffled, open throttle = raspy.
    const cutoff = 180 + rpmNorm * 1400 + load * 3200;
    this.lowpass.frequency.setTargetAtTime(cutoff, t, S);

    // Loudness: idle floor + load + a little with revs.
    const gain = 0.16 + load * 0.62 + rpmNorm * 0.18;
    this.engineGain.gain.setTargetAtTime(Math.min(1, gain), t, S);

    // Harder combustion under load
    this.pre.gain.setTargetAtTime(0.35 + load * 0.45, t, S);

    // Breath noise tracks revs and load
    this.noiseFilter.frequency.setTargetAtTime(500 + firing * 6 + load * 1500, t, S);
    this.noiseGain.gain.setTargetAtTime((0.02 + load * 0.10) * (0.3 + rpmNorm), t, S);
  }

  setVolume(v) {
    this.volume = v;
    if (this.running && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }
}

window.EngineSound = EngineSound;
