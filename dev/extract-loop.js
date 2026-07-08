#!/usr/bin/env node
/**
 * Cut a loopable segment out of a recording and save it as mono WAV.
 *
 *   node extract-loop.js input.ogg output.wav [--from S] [--to S] [--peak P]
 *
 * --from/--to  time range in seconds (defaults: whole file)
 * --peak       normalize the peak to this level, e.g. 0.7 (default: keep)
 *
 * Pick cut points where the pitch track (analyze-pitch.js) starts and
 * ends at the same value. See dev/README.md.
 */
const { withAudioPage, writeWav } = require('./lib');

const args = process.argv.slice(2);
const files = [];
const opt = { from: 0, to: Infinity, peak: 0 };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') opt.from = Number(args[++i]);
  else if (args[i] === '--to') opt.to = Number(args[++i]);
  else if (args[i] === '--peak') opt.peak = Number(args[++i]);
  else files.push(args[i]);
}
if (files.length !== 2) {
  console.error('usage: node extract-loop.js input output.wav [--from S] [--to S] [--peak P]');
  process.exit(1);
}
const [input, output] = files;

withAudioPage([input], async (page, urlFor) => {
  const res = await page.evaluate(async ({ url, from, to, peak }) => {
    const arr = await (await fetch(url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const buf = await ctx.decodeAudioData(arr);
    const sr = buf.sampleRate;
    const s0 = Math.max(0, Math.floor(from * sr));
    const s1 = Math.min(buf.length, Math.floor((to === null ? buf.duration : to) * sr));
    const n = s1 - s0;
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[s0 + i] / buf.numberOfChannels;
    }
    let pk = 0;
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(mono[i]));
    let gain = 1;
    if (peak > 0 && pk > 0) gain = peak / pk;
    if (gain !== 1) for (let i = 0; i < n; i++) mono[i] *= gain;
    return {
      sampleRate: sr, seconds: +(n / sr).toFixed(2),
      originalPeak: +pk.toFixed(3), gain: +gain.toFixed(2),
      samples: Array.from(mono),
    };
  }, { url: urlFor(0), from: opt.from, to: opt.to === Infinity ? null : opt.to, peak: opt.peak });

  writeWav(output, Float32Array.from(res.samples), res.sampleRate);
  console.log(`wrote ${output}: ${res.seconds}s, peak ${res.originalPeak} x${res.gain}`);
}).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
