# Engine sample packs

Engines are registered in **[`sounds/engines.js`](engines.js)** — one
line per engine, pointing at a folder that contains the audio files and
a **`pack.js`** config ([`sounds/v8/pack.js`](v8/pack.js) is the
template: filenames, pitch references, volumes and every tuning knob,
all documented with comments right in the file). Edit, reload the page.
No build step.

All registered engines appear in Settings → Sound → Engine next to the
built-in **Synthesized** engine, which is always available and is the
fallback if a pack fails to load. Packs download lazily when selected.

To add an engine: copy the `v8/` folder, swap the audio files, adjust
its `pack.js`, and add an entry in `engines.js`.

## The slots

| slot | looped | plays when |
| --- | --- | --- |
| `start` | no | once, when the engine starts (optional) |
| `pop` | no | exhaust pop one-shot — fired with random pitch/level on lift-off overrun, full-throttle upshifts and downshifts; a synthesized pop is used if omitted (optional; `pops: false` in params disables) |
| `idle` | yes | at standstill / idle RPM (optional) |
| `gasFull` | yes | full throttle — **required** |
| `gasHalf` | yes | partial throttle / cruising (optional) |
| `gasRelease` | loop or one-shot | throttle released — coasting / overrun (optional). With `oneShot: true` it fires *once* on lift-off (a decel burble) and the bed then settles into `gasHalf`/`idle`; add `duration` (seconds) to cap the one-shot length |

The gas slots crossfade by engine load (`gasRelease → gasHalf → gasFull`),
and each loop is pitch-shifted to the current RPM using its `rpm` field as
the reference (a V8 fires at `RPM / 60 × 4` Hz if you want to verify a
clip's pitch). Missing optional slots degrade gracefully — a pack with
only `gasFull` is fully functional.

## Sample requirements

- **Steady RPM within each loop** — no revving up or down.
- 1–10 seconds each; MP3/OGG/WAV — anything the browser decodes.
- Don't worry about loop seams or level matching: a tail-into-head
  crossfade and RMS normalization are applied automatically at load time.
- All clips should sound like the same car; consistency beats quality.

All thresholds (load crossfade points, idle crossover RPMs, rev-linked
loudness, pitch limits, off-throttle filter) are in the `params` section
of `pack.js`, each with a comment explaining what it does.
