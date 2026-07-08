/**
 * SampleEngineSound — engine sound driven by recorded/generated samples.
 *
 * The pack is defined in ONE editable file: sounds/v8/pack.js (loaded as
 * a plain script so it can carry comments). It maps sounds to load-based
 * slots:
 *
 *   start      one-shot when the engine starts            (optional)
 *   idle       loop at standstill / idling                (optional)
 *   gasFull    loop, engine at full throttle              (REQUIRED)
 *   gasHalf    loop, engine at partial throttle / cruise  (optional)
 *   gasRelease loop, throttle released / overrun          (optional)
 *
 * Every loop is pitch-shifted to the current RPM (playbackRate =
 * rpm / slot.rpm) and the gas slots are crossfaded by engine load.
 * Missing optional slots degrade gracefully: without gasHalf the blend
 * goes straight from release to full; without gasRelease a load-tracking
 * lowpass + volume floor supplies the closed-throttle character.
 *
 * Loops are made seamless (tail-into-head crossfade) and RMS-normalized
 * at load time, so clips don't need perfect seams or matched levels.
 */
class SampleEngineSound {
  constructor(pack) {
    this.pack = pack;
    this.ctx = null;
    this.running = false;
    this.volume = 0.7;
  }

  /** Tunables the pack file may override in its `params` section. */
  static defaultParams() {
    return {
      masterVolume: 1.0,
      pitch: 1.0,
      revBoost: 1.4,
      releaseMaxLoad: 0.2,
      halfLoad: 0.5,
      fullMinLoad: 0.85,
      idleFadeStartRpm: 900,
      idleFadeEndRpm: 1300,
      minPitch: 0.25,
      maxPitch: 4.0,
      filterMinHz: 260,
      filterLoadHz: 4200,
      filterRpmHz: 2200,
    };
  }

  /**
   * Load `pack.js` from the pack directory (it must define
   * window.ENGINE_SOUND_PACK), then fetch every referenced sound file.
   */
  static async loadPack(baseUrl) {
    const def = await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = baseUrl + 'pack.js?ts=' + Date.now();
      s.onload = () => {
        s.remove();
        window.ENGINE_SOUND_PACK
          ? resolve(window.ENGINE_SOUND_PACK)
          : reject(new Error('pack.js did not define ENGINE_SOUND_PACK'));
      };
      s.onerror = () => { s.remove(); reject(new Error('no pack.js found')); };
      document.head.appendChild(s);
    });

    const params = Object.assign(SampleEngineSound.defaultParams(), def.params);
    const slots = {};
    for (const key of ['start', 'idle', 'gasFull', 'gasHalf', 'gasRelease']) {
      const slot = def[key];
      if (!slot || !slot.file) continue;
      const r = await fetch(baseUrl + slot.file);
      if (!r.ok) throw new Error('missing sound file ' + slot.file);
      slots[key] = {
        rpm: slot.rpm || 0,
        volume: slot.volume == null ? 1 : slot.volume,
        data: await r.arrayBuffer(),
      };
    }
    if (!slots.gasFull) throw new Error("pack needs at least a 'gasFull' sound");
    return { name: def.name || 'Sample pack', params, slots };
  }

  async start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.resume();

    // decodeAudioData detaches the ArrayBuffer — slice so restarts work
    const decoded = {};
    for (const [key, s] of Object.entries(this.pack.slots)) {
      decoded[key] = { ...s, buffer: await ctx.decodeAudioData(s.data.slice(0)) };
    }
    if (!this.ctx) return; // stopped while decoding
    const t = ctx.currentTime;

    // Output chain: master -> compressor -> destination
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.15;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // Full/half-throttle bus goes through a load-tracking lowpass
    // (muffled when the throttle closes); release/idle skip it since
    // those recordings are naturally muffled already.
    this.gasFilter = ctx.createBiquadFilter();
    this.gasFilter.type = 'lowpass';
    this.gasFilter.frequency.value = 1200;
    this.gasFilter.Q.value = 0.9;
    this.gasFilter.connect(this.master);

    const makeLoop = (slot, dest) => {
      const seam = SampleEngineSound._makeSeamless(ctx, slot.buffer);
      const source = ctx.createBufferSource();
      source.buffer = seam.buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(dest);
      source.start(t);
      return { rpm: slot.rpm, volume: slot.volume, source, gain, norm: seam.norm };
    };

    this.b = {
      idle: decoded.idle ? makeLoop(decoded.idle, this.master) : null,
      gasFull: makeLoop(decoded.gasFull, this.gasFilter),
      gasHalf: decoded.gasHalf ? makeLoop(decoded.gasHalf, this.gasFilter) : null,
      gasRelease: decoded.gasRelease ? makeLoop(decoded.gasRelease, this.master) : null,
    };
    this.startShot = decoded.start || null;

    if (this.startShot) this._playShot(this.startShot);
    this.master.gain.setTargetAtTime(this.volume, t, 0.3);
    this.running = true;
  }

  stop() {
    if (!this.ctx) return;
    this.running = false;
    const ctx = this.ctx;
    this.ctx = null;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    setTimeout(() => ctx.close().catch(() => {}), 400);
  }

  _playShot(slot) {
    const src = this.ctx.createBufferSource();
    src.buffer = slot.buffer;
    const g = this.ctx.createGain();
    g.gain.value = this.volume * slot.volume;
    src.connect(g);
    g.connect(this.comp);
    src.start();
  }

  /** Same interface as the synth engine — call every frame. */
  update(rpm, throttle, maxRpm, cylinders, shifting, shiftDir) {
    if (!this.running || !this.ctx) return;
    const P = this.pack.params;
    const t = this.ctx.currentTime;
    const S = 0.05;
    const clamp = SampleEngineSound._clamp;

    // Upshift: torque cut. Downshift: rev-match blip.
    let load = throttle;
    if (shifting) {
      load = shiftDir < 0 ? Math.max(throttle, 0.55) : throttle * 0.15;
    }
    const rpmNorm = Math.min(1, rpm / maxRpm);

    // Idle loop takes over at the bottom of the rev range
    const idleBlend = this.b.idle
      ? clamp((P.idleFadeEndRpm - rpm) / (P.idleFadeEndRpm - P.idleFadeStartRpm), 0, 1)
      : 0;

    // Gas layer crossfade by load, louder with revs (pitch-shifting up
    // spreads sample energy thinner, so this also compensates for that)
    const w = this._gasWeights(load);
    const level = P.masterVolume * 1.25 * (1 + P.revBoost * rpmNorm)
      * (1 - idleBlend) * w.floorGain;

    const setBand = (b, weight) => {
      if (!b) return;
      b.source.playbackRate.setTargetAtTime(
        clamp((rpm / b.rpm) * P.pitch, P.minPitch, P.maxPitch), t, S);
      b.gain.gain.setTargetAtTime(weight * b.volume * b.norm, t, S);
    };
    setBand(this.b.gasFull, w.full * level);
    setBand(this.b.gasHalf, w.half * level);
    setBand(this.b.gasRelease, w.release * level);
    if (this.b.idle) {
      this.b.idle.source.playbackRate.setTargetAtTime(
        clamp((rpm / this.b.idle.rpm) * P.pitch, 0.15, 2), t, S);
      this.b.idle.gain.gain.setTargetAtTime(
        idleBlend * this.b.idle.volume * this.b.idle.norm * P.masterVolume, t, S);
    }

    const cutoff = P.filterMinHz + load * P.filterLoadHz + rpmNorm * P.filterRpmHz;
    this.gasFilter.frequency.setTargetAtTime(cutoff, t, S);
  }

  /**
   * Blend weights for the three gas layers at a given load, with
   * graceful fallbacks when optional slots are missing. `floorGain`
   * quiets the remaining layers at low load when there is no
   * gasRelease sample to hand over to.
   */
  _gasWeights(load) {
    const P = this.pack.params;
    const hasHalf = !!this.b.gasHalf;
    const hasRel = !!this.b.gasRelease;
    const xf = (x) => [Math.cos(x * Math.PI / 2), Math.sin(x * Math.PI / 2)];
    let full = 0, half = 0, release = 0, floorGain = 1;

    if (hasHalf && hasRel) {
      if (load <= P.releaseMaxLoad) release = 1;
      else if (load >= P.fullMinLoad) full = 1;
      else if (load < P.halfLoad) {
        [release, half] = xf((load - P.releaseMaxLoad) / (P.halfLoad - P.releaseMaxLoad));
      } else {
        [half, full] = xf((load - P.halfLoad) / (P.fullMinLoad - P.halfLoad));
      }
    } else if (hasRel) {
      if (load <= P.releaseMaxLoad) release = 1;
      else if (load >= P.fullMinLoad) full = 1;
      else [release, full] = xf((load - P.releaseMaxLoad) / (P.fullMinLoad - P.releaseMaxLoad));
    } else if (hasHalf) {
      if (load >= P.fullMinLoad) full = 1;
      else if (load >= P.halfLoad) [half, full] = xf((load - P.halfLoad) / (P.fullMinLoad - P.halfLoad));
      else { half = 1; floorGain = 0.25 + 0.75 * (load / P.halfLoad); }
    } else {
      full = 1;
      floorGain = 0.25 + 0.75 * load;
    }
    return { full, half, release, floorGain };
  }

  setVolume(v) {
    this.volume = v;
    if (this.running && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Make a buffer loop seamlessly (blend the tail into the head, trim
   * the tail) and compute an RMS normalization factor.
   */
  static _makeSeamless(ctx, buf) {
    const n = buf.length;
    const x = Math.min(Math.floor(0.06 * buf.sampleRate), Math.floor(n / 8));
    const out = ctx.createBuffer(buf.numberOfChannels, n - x, buf.sampleRate);
    let sum = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < n - x; i++) dst[i] = src[i];
      for (let i = 0; i < x; i++) {
        const k = i / x;
        dst[i] = src[i] * k + src[n - x + i] * (1 - k);
      }
      for (let i = 0; i < dst.length; i++) sum += dst[i] * dst[i];
    }
    const rms = Math.sqrt(sum / (out.length * buf.numberOfChannels)) || 1;
    return { buffer: out, norm: SampleEngineSound._clamp(0.12 / rms, 0.1, 8) };
  }

  static _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
}

window.SampleEngineSound = SampleEngineSound;
