# ICE Simulator

A web app that simulates the **sound of a combustion (ICE) engine** for use in
electric cars. Feed it a speed — from an on-screen slider, touch pedals, or the
device's GPS — and it derives gear, RPM and engine load like an automatic
gearbox would, then produces the engine sound in real time with the Web Audio
API (a physical model, a lightweight synth, or crossfaded recorded samples).

No build step, no dependencies: plain HTML/CSS/JS. Works on mobile browsers
and in the Tesla in-car browser (any Chromium-based browser).

## Motivation

I have an electric car and it's a lot of fun — this just makes it even more
fun. **Teslas** work especially nicely with it: the built-in browser has GPS
access, so you can open the app in the car, switch the speed source to GPS,
and let the (silent) EV borrow a combustion soundtrack that follows how you
actually drive.

## Live app

**https://daveruiz.github.io/ice-engine-simulator/**

Every push to `main` deploys automatically to GitHub Pages via
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).
Since Pages serves over HTTPS, GPS speed input works there — open the link
on your phone or in the car's browser, allow location access, and switch
the speed source to GPS in ⚙ Settings.

## Running it locally

Serve the folder over HTTP(S) — any static server works:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the URL in the browser and tap **START ENGINE** (browsers require a
user gesture before audio can play).

> GPS speed input requires **HTTPS** (or `localhost`) and location permission.
> For in-car use, open the [GitHub Pages deployment](https://daveruiz.github.io/ice-engine-simulator/)
> in the car's browser.

## How it works

- **Input**: target speed, from the slider (manual mode), touch pedals
  (pedal mode), or `navigator.geolocation.watchPosition` (GPS mode — uses
  `coords.speed` when available, falls back to haversine distance between
  fixes). GPS mode also has a small **REV pedal** (a momentary clutch-in) to
  blip the engine at a standstill or over the top of the moving speed.
- **Pedal mode**: on-screen gas and brake pedals where the press amount
  comes from *where* you touch — the position maps to 30–100% with dead
  margins at the extremes (hard to hit accurately on touch), and sliding
  your finger modulates it live. Both pedals track independent touches
  (left-foot braking works). A small vehicle physics model integrates
  speed from the pedals: full gas accelerates hard (fading near top speed),
  no pedals coasts down against drag (so holding a speed needs a bit of
  throttle, like a real car), and the brake decelerates strongly. An **N/D
  handle** between the pedals switches to neutral, where the gas pedal
  free-revs the engine without moving the car.
- **Drivetrain model** (`js/engine.js`): near-linear per-gear ratios (like a
  real gearbox — big RPM drops between the low gears, small ones up top),
  computed from *number of gears*, *max speed* and *max RPM*. Automatic shift
  logic with shift-up/shift-down RPM thresholds, hysteresis, and a torque-cut
  shift time. RPM follows speed through the current gear ratio (clamped at
  idle), with a rev limiter that cuts injection in bursts at redline — the
  "bru-bru" bounce. In neutral the engine free-revs with configurable,
  non-linear rev-up / rev-down response. Engine load (throttle) is estimated
  from acceleration and drives the sound character.
- **Driver behavior model**: shifting reacts to *how* you drive, not just
  speed:
  - A driving-style estimate (rises fast under hard acceleration, cools down
    slowly) slides the shift-up point between an early "economy" RPM for
    relaxed driving and the configured sporty shift point when pushed —
    and sporty shifts are quicker.
  - **Kickdown**: strong acceleration demand below the power band drops one
    or more gears first (like flooring an automatic), with an inhibit window
    after upshifts so the box never hunts at full throttle.
  - **1st gear is for launching**: coming down through 2nd, the box holds 2nd
    while rolling and only drops to 1st near a stop or when lugging near idle
    (kickdown excepted) — so relaxed slowing stays in 2nd and pulls away
    again in 2nd.
  - **Braking**: under hard braking the gear is held (no shifting mid-stop);
    the gears drop through only as the car crawls to a halt. Downshifts get a
    rev-match throttle blip in the sound; upshifts get a torque cut.
- **Ignition & shutdown**: turning the key plays a shared cranking clip
  ([`sounds/start.ogg`](sounds/start.ogg)) and, as the engine catches
  (~0.8 s in), swells the generated engine up under the sample's tail — for
  whichever sound engine is active. Stopping winds the revs down to a halt
  (the tacho falls with it) before the sound is cut, instead of an abrupt
  fade.
- **Sound** — three interchangeable engines (Settings → Sound):
  - **Synthesized** (`js/sound.js`, always available): firing frequency
    `rpm / 60 × cylinders / 2` drives a stack of detuned saw/square
    oscillators through waveshaper distortion and a throttle-tracking
    lowpass, plus band-passed noise for intake/exhaust breath.
  - **Physical model** (`js/physical.js` + `js/physical-worklet.js`):
    physically informed synthesis after Baldan et al., *"Physically
    informed car engine sound synthesis for virtual and augmented
    environments"* (IEEE SIVE 2015). An AudioWorklet simulates the
    actual sound-producing parts of the engine, sample by sample: each
    cylinder fires a combustion pressure pulse at its crank angle into
    per-bank exhaust header **waveguides** (a cross-plane V8 sends an
    uneven pulse train down each bank — that's the burble), through a
    main exhaust pipe waveguide with a lossy open-end reflection and an
    absorption muffler; intake-stroke air noise excites an intake tract
    waveguide; firing impacts ring two resonant engine-block modes plus
    camshaft-rate chain rattle; an optional turbocharger spools with
    exhaust energy (whine, boost hiss, blow-off on lift); and on
    overrun, unburnt mixture ignites in the exhaust — pops emerge from
    the same pipe model rather than being played back. The synthesized
    signal runs through an **FX bus** (low-shelf bass exaggeration,
    mid/treble EQ, parallel tanh saturation). **Every physical
    parameter is tweakable live in [`tuner.html`](tuner.html)** (⚙
    Settings → Physical Engine Tuner): pipe lengths, muffler cutoff,
    firing pattern, cylinder count, turbo, pops… Presets can be
    exported/imported as JSON; the tuned set is stored in
    `localStorage` and used by the simulator. Defaults model a
    cross-plane V8.
  - **Sample packs** (`js/samples.js`): an engine library registered in
    the editable [`sounds/engines.js`](sounds/engines.js) — one folder
    per engine, each configured by a commented
    [`pack.js`](sounds/v8/pack.js); see
    [sounds/README.md](sounds/README.md). Load-based slots (`start`,
    `idle`, `gasFull`, `gasHalf`, `gasRelease`, `pop`) are crossfaded by
    engine load and pitch-shifted to the current RPM, racing-game style —
    `gasRelease` can loop or fire as a one-shot lift-off burble, and
    overrun/shift **exhaust pops** play (a recording, or a synthesized pop
    if none is supplied). A *single* full-throttle loop is a complete pack;
    every optional slot improves realism. Packs load lazily when selected in
    Settings, loops are made seamless and volume-normalized at load time.
- **UI** (`js/dashboard.js`): canvas tachometer with red zone, speedometer,
  gear indicator and shift light, styled like an instrument cluster.

## Configurable (⚙ Settings)

| Setting | Range |
| --- | --- |
| Speed source | Manual slider / Pedals / GPS |
| Units | km/h / mph |
| Engine sound | Physical model / Synthesized / sample packs |
| Max RPM | 4,000 – 12,000 |
| Idle RPM | 500 – 1,500 |
| Cylinders | 2 – 12 |
| Neutral rev-up / rev-down time | 0.1 – 2.5 s |
| Gears | 3 – 10 |
| Shift-up / shift-down RPM | configurable with hysteresis guard |
| Max speed | 120 – 400 km/h |
| Volume | 0 – 100% |
| Start sound volume | 0 – 200% (relative to volume) |

New installs default to **GPS** input and the **physical** engine sound.
Settings persist in `localStorage`. The physical model has its own deep
tuning in [`tuner.html`](tuner.html) (linked from Settings).

## Known limitations

- **GPS latency.** GPS needs time to work out your speed, so in GPS mode the
  sound reacts a little *late* to changes — it lags behind sharp
  acceleration and braking. This is unavoidable for now: the speed simply
  isn't known any sooner. (The real fix would be an API that reads the
  accelerator pedal directly — if anyone builds that, get in touch. :P)
  For a tighter, latency-free feel, use the on-screen **pedals** mode
  instead.

## Project status

Not actively maintained anymore — it does what I wanted it to do. I'll still
add the occasional feature if a cool idea crosses my mind, and PRs are
welcome. Older asset versions are left in place on purpose, so you can see how
it evolved.

If you enjoy it, **give the repo a ⭐ — it's the best kind of thank-you.**

Possible future ideas:

- More physical-model presets (inline-4 turbo, flat-plane V8, diesel…)
- Manual shifting mode (paddle buttons)
- OBD-II / vehicle API speed input where available

## License & thanks

Copyright (C) 2026 David Ruiz.

Free to use, share and modify under the **GNU General Public License v3.0**
(or later) — see [LICENSE](LICENSE). GPL is copyleft: you may redistribute and
adapt it freely, but derived works must keep this license and its copyright
attribution, and share their source under the same terms.

Special thanks to Baldan, Lachambre, Delle Monache & Boussard, whose paper
*"Physically informed car engine sound synthesis for virtual and augmented
environments"* (IEEE VR Workshop on Sonic Interactions for Virtual
Environments, 2015) informs the physical-model synthesis and makes such a
convincing real engine sound possible.
