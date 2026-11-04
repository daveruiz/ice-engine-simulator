#!/usr/bin/env node
// Render the physical engine presets offline (headless Chromium, the real
// worklet + FX + listening-position chain) through a fixed test drive:
// idle → two free-rev blips → full-throttle pull through the gears →
// lift-off. Writes one WAV per preset × listening position and prints
// level / bass-ratio stats, handy for balancing presets and positions.
//
//   node render-presets.js                       # everything → ./renders
//   node render-presets.js --preset f1-v10 --listener cabin --out /tmp/x
//   node render-presets.js --seconds 12
const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) { ({ chromium } = require('playwright')); }

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = path.resolve(opt('out', path.join(__dirname, 'renders')));
const ONLY_PRESET = opt('preset', null);
const ONLY_LISTENER = opt('listener', null);
const SECONDS = Number(opt('seconds', 10));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return { executablePath: process.env.CHROMIUM_PATH };
  if (fs.existsSync('/opt/pw-browsers/chromium')) return {};
  return { channel: 'chrome' };
}

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.ogg': 'audio/ogg' };

async function main() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body>
        <script src="js/engine.js"></script>
        <script src="js/physical-params.js"></script>
        <script src="js/engine-presets.js"></script>
        <script src="js/physical.js"></script></body></html>`);
      return;
    }
    const file = path.join(ROOT, path.normalize(url));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch({ ...findChromium(), args: ['--no-sandbox'] });
  fs.mkdirSync(OUT, { recursive: true });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://localhost:${server.address().port}/`);
    const presets = await page.evaluate(() => EnginePresets.PRESETS.map((p) => p.id));
    const listeners = await page.evaluate(() => PhysicalParams.LISTENERS.map((l) => l.id));
    console.log('preset'.padEnd(14), 'listener'.padEnd(9), 'rms dB', ' peak', ' bass%');
    for (const id of presets) {
      if (ONLY_PRESET && id !== ONLY_PRESET) continue;
      for (const lis of listeners) {
        if (ONLY_LISTENER && lis !== ONLY_LISTENER) continue;
        const r = await page.evaluate(renderInPage, { id, lis, seconds: SECONDS });
        const file = path.join(OUT, `${id}_${lis}.wav`);
        fs.writeFileSync(file, Buffer.from(r.wav, 'base64'));
        console.log(id.padEnd(14), lis.padEnd(9), r.rmsDb.toFixed(1).padStart(6),
          r.peak.toFixed(2).padStart(5), (r.bass * 100).toFixed(0).padStart(5));
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

/** Runs inside the page: render one preset from one listening position. */
async function renderInPage({ id, lis, seconds }) {
  const SR = 48000, STEP = 512; // control rate: one render-quantum multiple
  const frames = Math.round(seconds * SR / STEP) * STEP;
  const ctx = new OfflineAudioContext(2, frames, SR);
  const preset = EnginePresets.get(id);
  const sound = new PhysicalEngineSound();
  sound.setParams(EnginePresets.physicalParams(id));
  sound.setListener(lis);
  sound.setVolume(0.7);
  await sound.start({ context: ctx });
  sound.fadeIn(0, 0.05);

  const cfg = Object.assign({}, preset.engine);
  cfg.shiftUpRpm = Math.min(cfg.shiftUpRpm, cfg.maxRpm - 200);
  const engine = new EngineSim(cfg);
  engine.setNeutral(true);
  const dt = STEP / SR;
  // Test drive script (times in s), scaled to the clip length
  const k = seconds / 10;
  const drive = (t) => {
    if (t < 1.5 * k) return { n: true, rev: 0 };
    if (t < 1.85 * k) return { n: true, rev: 0.7 };
    if (t < 2.6 * k) return { n: true, rev: 0 };
    if (t < 3.2 * k) return { n: true, rev: 1 };
    if (t < 4.0 * k) return { n: true, rev: 0 };
    if (t < 8.3 * k) return { n: false, speed: cfg.maxSpeed };
    return { n: false, speed: 0 };
  };
  for (let f = STEP; f < frames; f += STEP) {
    const t = f / SR;
    ctx.suspend(t).then(async () => {
      const d = drive(t);
      engine.setNeutral(d.n);
      if (d.n) engine.setRevDemand(d.rev); else engine.setTargetSpeed(d.speed);
      engine.update(dt);
      sound.update(engine.rpm, engine.throttle, cfg.maxRpm, 0,
        engine.shifting, engine.shiftDir);
      await new Promise((r) => setTimeout(r, 0)); // let the port deliver
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  // Stats (skip the fade-in): RMS, peak, share of energy below ~150 Hz
  let sum = 0, peak = 0, lp = 0, low = 0;
  const kLp = 1 - Math.exp(-2 * Math.PI * 150 / SR);
  for (let i = SR * 0.2; i < frames; i++) {
    const m = (L[i] + R[i]) * 0.5;
    sum += m * m;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    lp += (m - lp) * kLp;
    low += lp * lp;
  }
  // 16-bit stereo WAV, base64
  const n = frames;
  const bytes = new Uint8Array(44 + n * 4);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true);
  dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const cnt = frames - SR * 0.2;
  return {
    wav: btoa(bin),
    rmsDb: 10 * Math.log10(sum / cnt + 1e-12),
    peak,
    bass: low / (sum + 1e-12),
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
