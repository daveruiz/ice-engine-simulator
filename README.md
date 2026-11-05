# ICE Engine Simulator

A web app that simulates the **sound of am internal combustion engine (ICE)**
for use in electric cars. Feed it a speed — from an on-screen slider, touch
pedals, or the device's GPS — and it derives gear, RPM and engine load like
an automatic gearbox would, then produces the engine sound in real time with
the Web Audio API (a physical model, a lightweight synth, or crossfaded
recorded samples).

No build step, no dependencies: plain HTML/CSS/JS. Works on mobile browsers
and in the Tesla in-car browser (any Chromium-based browser).

This has been vibe-coded — no build tooling or framework needed, since Claude
keeps it consistent instead.

## Motivation

I have an electric car and it's a lot of fun — this just makes it even more
fun. **Teslas** work especially nicely with it: the built-in browser has GPS
access, so you can open the app in the car, switch the speed source to GPS,
and let the (silent) EV borrow a combustion soundtrack that follows how you
actually drive. I don't know about other EVs, but if your car has a browser
and GPS, it should work there too.

I looked at other projects doing something similar, but they usually needed
an Arduino or other extra hardware, or were locked to a specific phone brand
(iPhone-only, for example), and tended to be far less customizable. This one
runs straight in the browser — no hardware, no app store, no walled garden —
and every part of the engine (RPM range, gear count, shift points, cylinder
count, sound engine, and more) is tweakable from the settings panel.

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
  comes from _where_ you touch — the position maps to 30–100% with dead
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
  computed from _number of gears_, _max speed_ and _max RPM_. Automatic shift
  logic with shift-up/shift-down RPM thresholds, hysteresis, and a torque-cut
  shift time. RPM follows speed through the current gear ratio (clamped at
  idle), with a rev limiter that cuts injection in bursts at redline — the
  "bru-bru" bounce. In neutral the engine free-revs with configurable,
  non-linear rev-up / rev-down response. Engine load (throttle) is estimated
  from acceleration and drives the sound character.
- **Driver behavior model**: shifting reacts to _how_ you drive, not just
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
- **Ignition & shutdown**: with the physical model the engine start is
  **synthesized** by default (Settings → Start sound): turning the key
  pulls in the solenoid (clack) and slams the starter pinion onto the
  flywheel ring gear (clank); the starter motor — gear-mesh whine at
  ring-teeth × crank speed, commutator buzz, brush noise — spins the crank
  with no combustion, slowing into every compression stroke (the
  "rur-rur-rur", with the starter straining and dropping pitch on each
  one); the odd cylinder fires, then combustion ramps in with misfires
  and the revs jump to ~1.5× idle almost at once, hang there for half a
  second and settle back — a curve matched against a recorded start
  ([`sounds/start.ogg`](sounds/start.ogg)). Cranking sits well below the
  running engine, so the catch lands with a real jump in level. Key-off cuts combustion, so
  the engine winds down on compression alone and shudders to a stop.
  Cranking speed/time, compression drag, ring gear teeth and levels are
  per engine (Starter & ignition group in the tuner, set by every preset:
  a diesel cranks slow and lumpy, a V12 smooth, an F1 fast on its external
  starter). The recorded clip ([`sounds/start.ogg`](sounds/start.ogg)) is
  still available — and used by the other sound engines: it plays as the
  key turns and the generated engine swells up under its tail as it
  catches (~0.8 s in). Stopping winds the revs down to a halt (the tacho
  falls with it) before the sound is cut, instead of an abrupt fade.
- **Sound** — three interchangeable engines (Settings → Sound):
  - **Synthesized** (`js/sound.js`, always available): firing frequency
    `rpm / 60 × cylinders / 2` drives a stack of detuned saw/square
    oscillators through waveshaper distortion and a throttle-tracking
    lowpass, plus band-passed noise for intake/exhaust breath.
  - **Physical model** (`js/physical.js` + `js/physical-worklet.js`):
    physically informed synthesis after Baldan et al., _"Physically
    informed car engine sound synthesis for virtual and augmented
    environments"_ (IEEE SIVE 2015). An AudioWorklet simulates the
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
    the same pipe model rather than being played back, and each one
    **bangs at the tailpipe** on a separate layer (unmuffled crack +
    low thump, optional after-crackle) that's driven hard into
    saturation and mixed past the compressor so it punches through.
    Pulling hard builds up "pop heat" (hot exhaust, unburnt fuel) that
    the overrun uses up, so a lift-off crackles for a second or two and
    fades instead of popping through every long coast; inside the car a
    bang arrives as a dull, hard thump.
    No two cycles are alike: every cylinder burns slightly differently
    (the half orders of a real engine), each combustion is jittered in
    timing and duration, the muffler damps the pipe resonance inside its
    round trip, and the exhaust waveguides are fractional delays re-tuned
    by the exhaust gas temperature (resonances rise with load, with
    thermal lag) plus a little flow turbulence. That removes the glassy,
    over-pure tone and the "moiré" beading of harmonics sweeping through
    static comb resonances. The synthesized signal runs through an **FX
    bus** (low-shelf bass exaggeration, mid/treble EQ, parallel tanh
    saturation), a **mix compressor** (Settings → Compressor, loudness
    calibrated to stay put) and a final safety limiter. **Every physical
    parameter is tweakable live in [`tuner.html`](tuner.html)** (⚙
    Settings → Physical Engine Tuner): pipe lengths, muffler cutoff,
    firing pattern, cylinder count, turbo, pops… The tuner also has a
    **mixer** — a live level meter per sound (exhaust, intake, mechanical,
    chain, turbo whistle / hiss / blow-off, starter, body vibration,
    bangs) as it reaches the listener, with solo / mute to pick out
    what you hear — and an **editor for the listening positions** (every
    modifier as × / + / =, with the engine value → what the listener gets,
    plus the acoustic space), saved and used by the simulator. Presets can be
    exported/imported as JSON; the tuned set is stored in
    `localStorage` and used by the simulator. Defaults model a
    cross-plane V8.
  - **Engine presets** ([`js/engine-presets.js`](js/engine-presets.js),
    the ENGINE picker at the top of the main screen, also loadable in the
    tuner): one pick sets
    the whole car — the physical sound model _and_ the drivetrain (rev
    range, idle, gears, shift points and shift speed, top speed, rev
    response). Street: VW Golf TDI (I4 diesel), Golf GTI (I4 turbo),
    Toyota GR Yaris (I3 turbo), Subaru WRX STI (boxer-4 with
    unequal-length headers), BMW M3 E46 (I6), V8 muscle car (the original
    default). Sports: Porsche 911 GT3 (flat-6), Ferrari 458 (flat-plane
    V8), Lamborghini Huracán (V10), Ferrari 812 (V12), Mazda RX-8
    (rotary). Racing: Formula 1 V10 (2005, 19,000 rpm) and F1 V6 turbo
    hybrid (2014+). Real-world figures for the drivetrain; the acoustic
    values are tuned by ear to evoke each engine. Tweaking anything
    afterwards marks the preset as modified, with a one-tap ↺ restore.
  - **3D sound** (⚙ Settings → Sound, _experimental_, off by default):
    instead of one mono mix, every source gets its own place around the
    listener through a Web Audio `PannerNode` — the engine block (with the
    chain and starter), intake and turbo where the engine sits (new
    _Engine position_ parameter: front, mid behind the seats or rear,
    set per preset), the exhaust and its overrun bangs at the tail. The
    driver sits on the left, so a front engine is slightly to the right;
    outside, you stand off the car's left flank. _Headphones_ uses HRTF
    (binaural: front/back and height); _Speakers_ is equal-power stereo
    (left/right only). Below 130 Hz the stems stay unpanned (Linkwitz–Riley
    split, so the bands sum flat) — bass carries little direction — and
    the body vibration has none. The level matches the mono mix within
    ~1 dB.
  - **Listening position** (⚙ Settings → Sound; defaults to _Inside_):
    _Original_ (the raw model, next to the engine), _Inside_ (driver's
    seat: the muffled exhaust from behind plus the engine's
    **structure-borne vibration** — the firing-rate rumble the body
    panels re-radiate, strong on a 3-cylinder or a diesel, faint on a
    V12 — a dull intake roar through the firewall, and almost none of
    the engine-bay mechanics: valvetrain clatter, piston slap and chain
    rattle stay under the bonnet. Treble is filtered **per source**, by
    each one's path to the seat — exhaust through floor and rear glass,
    intake and mechanics through the firewall, while the turbo whistle and
    the bang keep their edge — rather than with a global lowpass; plus a
    gentle cabin bass boom and a small damped room) and _Outside_ (a few metres away:
    tailpipe-dominated, brighter bark, ground and street reflections).
    Positions are relative modifiers layered automatically on top of
    whatever engine is active (preset or hand-tuned) — `{mul, add}` on
    any numeric parameter or `{set}` on any other — plus an
    acoustic-space stage (lowpass, boom resonance, generated impulse
    response) after the FX bus — see `LISTENERS` in
    [`js/physical-params.js`](js/physical-params.js).
  - **Sample packs** (`js/samples.js`): an engine library registered in
    the editable [`sounds/engines.js`](sounds/engines.js) — one folder
    per engine, each configured by a commented
    [`pack.js`](sounds/v8/pack.js); see
    [sounds/README.md](sounds/README.md). Load-based slots (`start`,
    `idle`, `gasFull`, `gasHalf`, `gasRelease`, `pop`) are crossfaded by
    engine load and pitch-shifted to the current RPM, racing-game style —
    `gasRelease` can loop or fire as a one-shot lift-off burble, and
    overrun/shift **exhaust pops** play (a recording, or a synthesized pop
    if none is supplied). A _single_ full-throttle loop is a complete pack;
    every optional slot improves realism. Packs load lazily when selected in
    Settings, loops are made seamless and volume-normalized at load time.
    [`dev/`](dev/README.md) has headless-browser scripts for measuring a
    recording's RPM and cutting clean loop points when preparing a pack.
- **UI** (`js/dashboard.js`, `css/style.css`): an instrument cluster —
  canvas tachometer and speedometer (260° dials with red zone, glowing value
  arc, digital LCD window), a center stack with racing-style shift lights
  (green → amber → red, flashing at the shift point / limiter), the gear and
  an engine load meter. Portrait phones put the tachometer large on top;
  landscape and the car screen show the dials side by side, sized to the
  available height. One button/control family, self-hosted Barlow typefaces
  ([`fonts/`](fonts/)), and the engine picker at the top of the screen.
  The app icon ([`icons/`](icons/): a dial whose orange needle drives the
  sound waves below it) and a web manifest let you add it to a phone's home
  screen like an app.

## Configurable (⚙ Settings)

| Setting                        | Range                                       |
| ------------------------------ | ------------------------------------------- |
| Speed source                   | Manual slider / Pedals / GPS                |
| Units                          | km/h / mph                                  |
| Speed smoothing                | 0.05 – 1.5 s (lower = snappier vs GPS)      |
| Engine preset (main screen)    | 13 engines, street cars to Formula 1        |
| Listening position             | Inside the car (default) / Original / Outside |
| Compressor (physical model)    | Off – 100% (default 50%)                    |
| 3D sound (physical model)      | Off (default) / Headphones / Speakers — experimental |
| Engine sound                   | Physical model / Synthesized / sample packs |
| Max RPM                        | 4,000 – 20,000                              |
| Idle RPM                       | 500 – 5,000                                 |
| Cylinders                      | 2 – 12                                      |
| Neutral rev-up / rev-down time | 0.1 – 2.5 s                                 |
| Gears                          | 3 – 10                                      |
| Shift-up / shift-down RPM      | configurable with hysteresis guard          |
| Shift time                     | 0.03 – 0.6 s (torque cut per gear change)   |
| Max speed                      | 120 – 400 km/h                              |
| Volume                         | 0 – 100%                                    |
| Start sound (physical model)   | Synthesized starter / recorded clip         |
| Start sound volume             | 0 – 200% (relative to volume)               |

New installs default to **GPS** input and the **physical** engine sound.
Settings persist in `localStorage`. The physical model has its own deep
tuning in [`tuner.html`](tuner.html) (linked from Settings).

## Known limitations

- **GPS latency.** GPS needs time to work out your speed, so in GPS mode the
  sound reacts a little _late_ to changes — it lags behind sharp
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

- More listening positions (e.g. drive-by / pit lane, helmet cam)
- Manual shifting mode (paddle buttons)
- OBD-II / vehicle API speed input where available

## License & thanks

Copyright (C) 2026 David Ruiz.

Free to use, share and modify under the **GNU General Public License v3.0**
(or later) — see [LICENSE](LICENSE). GPL is copyleft: you may redistribute and
adapt it freely, but derived works must keep this license and its copyright
attribution, and share their source under the same terms.

The bundled Barlow and Barlow Condensed fonts (Copyright 2017 The Barlow
Project Authors) are under the SIL Open Font License 1.1 — see
[fonts/OFL.txt](fonts/OFL.txt).

Special thanks to Baldan, Lachambre, Delle Monache & Boussard, whose paper
[_"Physically informed car engine sound synthesis for virtual and augmented
environments"_](https://ieeexplore.ieee.org/document/7361287/) (IEEE VR
Workshop on Sonic Interactions for Virtual Environments, 2015,
[free PDF](https://air.iuav.it/retrieve/de164c2a-5461-60ee-e053-3a05fe0a7787/SIVE15_submission_4.pdf))
informs the physical-model synthesis and makes such a convincing real engine
sound possible.
