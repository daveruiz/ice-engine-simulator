# Dev tools

Utilities for preparing engine sample packs. **Not part of the app** —
nothing here is loaded by the site; it's for development only.

Both scripts drive a headless Chromium (via `playwright-core`) because the
browser's audio decoder handles every format the app itself can play
(ogg/mp3/wav/m4a/…).

## Setup

```bash
cd dev
npm install          # installs playwright-core
```

A Chromium binary is found in this order: `$CHROMIUM_PATH`, the Playwright
managed browser at `/opt/pw-browsers/chromium`, or an installed Chrome
(`channel: 'chrome'`). If none of those work, run `npx playwright install
chromium` once.

## analyze-pitch.js — measure a clip's RPM

Estimates the fundamental frequency over time (normalized autocorrelation
with octave-error correction) and converts it to RPM candidates.

```bash
node analyze-pitch.js ../sounds/v8/idle.wav [more files...]
node analyze-pitch.js --cylinders 6 some-recording.ogg
```

Reading the output:
- `f0 median` is the dominant pitch; the per-window `track` shows drift —
  a good loop candidate holds a steady value.
- A 4-stroke engine fires at `RPM / 60 × cylinders / 2` Hz. The script
  prints RPM for the common interpretations (firing frequency, half-order,
  crank rotation) — pick the plausible one (idle ≈ 600–1100 RPM, driving
  ≈ 1500–5000) and put it in the pack.js `rpm` field.

## extract-loop.js — cut a loopable segment / fix levels

Cuts a time range out of a recording, mixes to mono, optionally normalizes
the peak, and writes a WAV next to your pack:

```bash
node extract-loop.js input.ogg output.wav --from 30.4 --to 44.2
node extract-loop.js quiet-idle.ogg idle.wav --peak 0.7   # whole file, amplified
```

Choose cut points where the pitch track (from analyze-pitch.js) starts and
ends at the same value — the app crossfades the loop seam automatically,
but a pitch jump across the seam is audible.
