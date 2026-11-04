# Dev tools

Utilities for preparing engine sample packs and checking the physical
engine presets. **Not part of the app** —
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

## render-presets.js — render the physical presets offline

Renders every engine preset (`js/engine-presets.js`) from every listening
position through the real worklet + FX + acoustic-space chain in an
`OfflineAudioContext`, along a fixed test drive (idle → two free-rev blips
→ full-throttle pull through the gears → lift-off). Writes one WAV per
combination and prints RMS level, peak and the share of energy below
~150 Hz — useful to keep presets and positions balanced after tweaks.

```bash
node render-presets.js                          # all → dev/renders/
node render-presets.js --preset f1-v10 --listener cabin --out /tmp/r
node render-presets.js --seconds 12
node render-presets.js --scenario sweep --preset golf-gti   # slow rev-up + lift-off pops
node render-presets.js --scenario cruise                    # steady 3,000 rpm (tone purity)
node render-presets.js --scenario start                     # key-on → crank → idle → key-off
node render-presets.js --preset golf-gti --set exhaustFb=0,turbo=0 --tag test  # overrides
node render-presets.js --comp 1                             # mix compressor amount 0..1
```

The compressor's make-up table in `js/physical.js` (`MAKEUP_DB`) was
calibrated with the `sweep` scenario at amounts 0, .25, .5, .75 and 1 so
the engine's loudness barely moves with the slider — re-measure it if the
FX chain or the compressor mapping changes.
