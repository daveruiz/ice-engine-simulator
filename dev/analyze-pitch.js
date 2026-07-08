#!/usr/bin/env node
/**
 * Measure the fundamental frequency (and thus engine RPM) of audio clips.
 *
 *   node analyze-pitch.js [--cylinders N] file1 [file2 ...]
 *
 * Prints a per-window pitch track (steady = good loop material), the
 * median f0, and RPM candidates. See dev/README.md.
 */
const { withAudioPage } = require('./lib');

const args = process.argv.slice(2);
let cylinders = 8;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cylinders') cylinders = Number(args[++i]) || 8;
  else files.push(args[i]);
}
if (!files.length) {
  console.error('usage: node analyze-pitch.js [--cylinders N] file1 [file2 ...]');
  process.exit(1);
}

withAudioPage(files, async (page, urlFor) => {
  for (let i = 0; i < files.length; i++) {
    const result = await page.evaluate(async (url) => {
      const arr = await (await fetch(url)).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const buf = await ctx.decodeAudioData(arr);
      const sr = buf.sampleRate, n = buf.length;
      const mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let j = 0; j < n; j++) mono[j] += d[j] / buf.numberOfChannels;
      }
      let sum = 0;
      for (let j = 0; j < n; j++) sum += mono[j] * mono[j];
      const rms = Math.sqrt(sum / n);

      // Normalized autocorrelation per window, with octave-error check:
      // if a subdivided lag (2x/3x the frequency) scores nearly as well,
      // prefer it — autocorrelation loves locking onto subharmonics.
      const win = 8192, hop = Math.floor(sr / 4);
      const minF = 18, maxF = 500;
      const maxLag = Math.floor(sr / minF), minLag = Math.floor(sr / maxF);
      const corr = (start, lag, e0) => {
        let s = 0, e1 = 0;
        for (let j = 0; j < win; j += 2) {
          s += mono[start + j] * mono[start + j + lag];
          e1 += mono[start + j + lag] * mono[start + j + lag];
        }
        return s / Math.sqrt((e0 / 2) * (e1 || 1e-9));
      };
      const track = [];
      for (let start = 0; start + win + maxLag < n; start += hop) {
        let e0 = 0;
        for (let j = 0; j < win; j++) e0 += mono[start + j] * mono[start + j];
        if (e0 < 1e-6) continue;
        let best = 0, bestLag = -1;
        for (let lag = minLag; lag <= maxLag; lag++) {
          const v = corr(start, lag, e0);
          if (v > best) { best = v; bestLag = lag; }
        }
        if (bestLag < 0 || best < 0.3) continue;
        let cand = bestLag;
        for (const div of [2, 3]) {
          const l2 = Math.round(bestLag / div);
          if (l2 >= minLag && corr(start, l2, e0) > best * 0.9) { cand = l2; break; }
        }
        track.push({ t: +(start / sr).toFixed(2), f: +(sr / cand).toFixed(1), conf: +best.toFixed(2) });
      }
      const sorted = track.map((x) => x.f).sort((a, b) => a - b);
      return {
        duration: +(n / sr).toFixed(2), rms: +rms.toFixed(4),
        median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
        min: sorted[0], max: sorted[sorted.length - 1], track,
      };
    }, urlFor(i));

    console.log(`\n=== ${files[i]} ===`);
    console.log(`duration=${result.duration}s rms=${result.rms}`);
    console.log(`f0 median=${result.median}Hz  range=[${result.min} .. ${result.max}]Hz`);
    console.log('track:', result.track.map((x) => `${x.t}s:${x.f}Hz(${x.conf})`).join(' '));
    const firing = cylinders / 2;
    console.log(`RPM if f0 = firing frequency (${cylinders} cyl): ${Math.round(result.median * 60 / firing)}`);
    console.log(`RPM if f0 = half-order:                 ${Math.round(result.median * 120 / firing)}`);
    console.log(`RPM if f0 = crank rotation:             ${Math.round(result.median * 60)}`);
  }
}).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
