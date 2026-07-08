/**
 * SampleEngineSound — engine sound driven by recorded/generated samples.
 *
 * Loads a pack described by a manifest (see sounds/README.md) with any
 * number of loopable samples per ladder:
 *   - "on"   : engine under load at a known steady RPM (at least 1 required)
 *   - "off"  : overrun / throttle-closed at a known RPM (optional)
 *   - "idle" : idle loop (optional)
 *   - "start"/"stop" : one-shots (optional)
 *
 * Playback: every band loops continuously; its playbackRate follows
 * rpm / sampleRpm (racing-game style pitch tracking) and the two bands
 * nearest to the current RPM get an equal-power crossfade. Engine load
 * blends the on/off ladders and drives a lowpass, so a pack with a
 * single "on" sample still produces the full on/off-throttle dynamic.
 *
 * Loops are made seamless at load time by blending the tail into the
 * head, and normalized to a common RMS so bands don't jump in volume.
 */
class SampleEngineSound {
  constructor(pack) {
    this.pack = pack;
    this.ctx = null;
    this.running = false;
    this.volume = 0.7;
  }

  /** Fetch manifest + audio files. Throws if the pack is unusable. */
  static async loadPack(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest not found');
    const manifest = await res.json();
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    const samples = await Promise.all((manifest.samples || []).map(async (s) => {
      const r = await fetch(base + s.file);
      if (!r.ok) throw new Error('missing sample ' + s.file);
      return { rpm: s.rpm || 0, type: s.type, data: await r.arrayBuffer() };
    }));
    if (!samples.some((s) => s.type === 'on')) {
      throw new Error("pack needs at least one 'on' sample");
    }
    return { name: manifest.name || 'Sample pack', samples };
  }

  async start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.resume();

    // decodeAudioData detaches the ArrayBuffer — slice so restarts work
    const decoded = await Promise.all(this.pack.samples.map(async (s) => ({
      rpm: s.rpm,
      type: s.type,
      buffer: await ctx.decodeAudioData(s.data.slice(0)),
    })));
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

    // On-throttle bus gets a load-tracking lowpass (muffled when closed)
    this.onFilter = ctx.createBiquadFilter();
    this.onFilter.type = 'lowpass';
    this.onFilter.frequency.value = 1200;
    this.onFilter.Q.value = 0.9;
    this.onFilter.connect(this.master);

    const makeBand = (s, dest) => {
      const seam = SampleEngineSound._makeSeamless(ctx, s.buffer);
      const source = ctx.createBufferSource();
      source.buffer = seam.buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(dest);
      source.start(t);
      return { rpm: s.rpm, source, gain, norm: seam.norm };
    };

    const byRpm = (a, b) => a.rpm - b.rpm;
    this.on = decoded.filter((s) => s.type === 'on')
      .map((s) => makeBand(s, this.onFilter)).sort(byRpm);
    this.off = decoded.filter((s) => s.type === 'off')
      .map((s) => makeBand(s, this.master)).sort(byRpm);
    this.idle = decoded.filter((s) => s.type === 'idle')
      .map((s) => makeBand(s, this.master))[0] || null;
    this.startShot = (decoded.find((s) => s.type === 'start') || {}).buffer;
    this.stopShot = (decoded.find((s) => s.type === 'stop') || {}).buffer;

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
    if (this.stopShot) {
      // shut-off one-shot bypasses the fading master
      const src = ctx.createBufferSource();
      src.buffer = this.stopShot;
      const g = ctx.createGain();
      g.gain.value = this.volume;
      src.connect(g);
      g.connect(this.comp);
      src.start();
    }
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  }

  _playShot(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = this.volume;
    src.connect(g);
    g.connect(this.comp);
    src.start();
  }

  /** Same interface as the synth engine — call every frame. */
  update(rpm, throttle, maxRpm, cylinders, shifting, shiftDir) {
    if (!this.running || !this.ctx) return;
    const t = this.ctx.currentTime;
    const S = 0.05;

    // Upshift: torque cut. Downshift: rev-match blip.
    let load = throttle;
    if (shifting) {
      load = shiftDir < 0 ? Math.max(throttle, 0.55) : throttle * 0.15;
    }
    const rpmNorm = Math.min(1, rpm / maxRpm);

    // Dedicated idle loop takes over at the bottom of the range
    const idleBlend = this.idle
      ? Math.max(0, Math.min(1, (1250 - rpm) / 350)) : 0;

    // On/off ladder blend by engine load; without an off ladder the
    // lowpass alone provides the closed-throttle character. Real engines
    // also get louder with revs, and pitch-shifting samples up spreads
    // their energy thinner, so a rev-linked boost keeps full-load pulls
    // clearly louder than idle.
    const revBoost = (0.65 + 0.85 * rpmNorm) * 1.9;
    const onLevel = (this.off.length ? 0.08 + 0.92 * load : 0.25 + 0.75 * load)
      * revBoost * (1 - idleBlend);
    const offLevel = this.off.length
      ? (1 - load) * (0.25 + 0.75 * rpmNorm) * revBoost * (1 - idleBlend) : 0;

    this._setLadder(this.on, rpm, onLevel, t, S);
    this._setLadder(this.off, rpm, offLevel, t, S);
    if (this.idle) {
      this.idle.source.playbackRate.setTargetAtTime(
        SampleEngineSound._clamp(rpm / this.idle.rpm, 0.5, 2), t, S);
      this.idle.gain.gain.setTargetAtTime(idleBlend * this.idle.norm * 0.75, t, S);
    }

    const cutoff = 260 + load * 4200 + rpmNorm * 2200;
    this.onFilter.frequency.setTargetAtTime(cutoff, t, S);
  }

  /** Pitch every band to the target rpm, crossfade the two nearest. */
  _setLadder(bands, rpm, level, t, S) {
    if (!bands.length) return;
    for (const b of bands) {
      b.source.playbackRate.setTargetAtTime(
        SampleEngineSound._clamp(rpm / b.rpm, 0.25, 4), t, S);
    }
    const w = new Array(bands.length).fill(0);
    if (rpm <= bands[0].rpm || bands.length === 1) {
      w[0] = 1;
    } else if (rpm >= bands[bands.length - 1].rpm) {
      w[bands.length - 1] = 1;
    } else {
      let i = 0;
      while (rpm > bands[i + 1].rpm) i++;
      const x = (Math.log(rpm) - Math.log(bands[i].rpm)) /
                (Math.log(bands[i + 1].rpm) - Math.log(bands[i].rpm));
      w[i] = Math.cos(x * Math.PI / 2);      // equal-power crossfade
      w[i + 1] = Math.sin(x * Math.PI / 2);
    }
    bands.forEach((b, i) =>
      b.gain.gain.setTargetAtTime(w[i] * level * b.norm, t, S));
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
