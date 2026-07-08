// Shared helpers for the dev audio tools: serve local files to a headless
// Chromium and decode them with the browser's audio decoder.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return { executablePath: process.env.CHROMIUM_PATH };
  if (fs.existsSync('/opt/pw-browsers/chromium')) {
    return { executablePath: '/opt/pw-browsers/chromium' };
  }
  return { channel: 'chrome' }; // system Chrome fallback
}

/** Serve the given files at /0, /1, ... and open a blank page. */
async function withAudioPage(files, fn) {
  const server = http.createServer((req, res) => {
    const p = req.url.slice(1).split('?')[0];
    const idx = /^\d+$/.test(p) ? Number(p) : -1;
    if (idx >= 0 && files[idx]) {
      fs.readFile(files[idx], (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(data);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body>dev-audio</body></html>');
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ ...findChromium(), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/`);
    return await fn(page, (i) => `/${i}`);
  } finally {
    await browser.close();
    server.close();
  }
}

/** Write mono float samples [-1..1] as a 16-bit PCM WAV file. */
function writeWav(file, samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

module.exports = { withAudioPage, writeWav, path };
