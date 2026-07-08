# Engine sample packs

Put a sample pack in `sounds/v8/` and the app will use it automatically
(Settings → Sound → "Sample pack"). If no pack is present the built-in
synthesized engine is used.

## Minimum viable pack: ONE file

A single steady on-throttle loop is enough — the app pitch-shifts it across
the whole RPM range and derives the closed-throttle (coasting) character
with a load-tracking filter. Every additional sample just improves realism.

## Manifest

`sounds/v8/manifest.json`:

```json
{
  "name": "V8",
  "samples": [
    { "file": "on_3000.ogg",  "rpm": 3000, "type": "on"   },

    { "file": "on_1500.ogg",  "rpm": 1500, "type": "on"   },
    { "file": "on_5500.ogg",  "rpm": 5500, "type": "on"   },
    { "file": "off_2500.ogg", "rpm": 2500, "type": "off"  },
    { "file": "idle.ogg",     "rpm": 900,  "type": "idle" },
    { "file": "start.ogg",                 "type": "start" },
    { "file": "stop.ogg",                  "type": "stop"  }
  ]
}
```

Only the first entry is required; the rest are optional upgrades.

| type | looped | meaning |
| --- | --- | --- |
| `on` | yes | engine under load at a steady, known RPM (≥ 1 required) |
| `off` | yes | overrun / throttle closed at a steady, known RPM |
| `idle` | yes | idle loop; takes over below ~1250 RPM |
| `start` | no | one-shot played when the engine starts |
| `stop` | no | one-shot played when the engine stops |

## Sample requirements

- **Constant RPM within each clip** — no revving up/down. The `rpm` field
  must state the RPM the clip was recorded/generated at (approximate is
  fine; it's the pitch reference: a V8 fires at `RPM / 60 × 4` Hz).
- 1–5 seconds each, WAV/OGG/MP3 (anything the browser decodes).
- Loops don't need perfect seams — a tail-into-head crossfade is applied
  at load time. Volumes are normalized automatically.
- All clips should sound like the same car (same generation session /
  same recording) — consistency matters more than quality.

With multiple `on`/`off` samples, the two bands nearest the current RPM
are crossfaded (equal-power, log-spaced), racing-game style. Keep adjacent
RPM steps within ~1.5× of each other for the smoothest result.
