# ICE Simulator

A web app that simulates the **sound of a combustion (ICE) engine** for use in
electric cars. Feed it a speed — from an on-screen slider or from the device's
GPS — and it derives gear, RPM and engine load like an automatic gearbox would,
then synthesizes the engine sound in real time with the Web Audio API.

No build step, no dependencies: plain HTML/CSS/JS. Works on mobile browsers
and in the Tesla in-car browser (any Chromium-based browser).

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
  fixes).
- **Pedal mode**: on-screen gas and brake pedals where the press amount
  comes from *where* you touch — near the top is a light press, near the
  bottom is flooring it — and sliding your finger modulates it live. Both
  pedals track independent touches (left-foot braking works). A small
  vehicle physics model integrates speed from the pedals: full gas
  accelerates hard (fading near top speed), no pedals coasts down against
  drag (so holding a speed needs a bit of throttle, like a real car), and
  the brake decelerates strongly.
- **Drivetrain model** (`js/engine.js`): geometric gear spacing computed from
  *number of gears*, *max speed* and *max RPM*. An automatic shift logic with
  shift-up/shift-down RPM thresholds, hysteresis, and a torque-cut shift time.
  RPM follows speed through the current gear ratio, clamped at idle. Engine
  load (throttle) is estimated from acceleration and drives the sound
  character.
- **Driver behavior model**: shifting reacts to *how* you drive, not just
  speed:
  - A driving-style estimate (rises fast under hard acceleration, cools down
    slowly) slides the shift-up point between an early "economy" RPM for
    relaxed driving and the configured sporty shift point when pushed —
    and sporty shifts are quicker.
  - **Kickdown**: strong acceleration demand below the power band drops one
    or more gears first (like flooring an automatic), with an inhibit window
    after upshifts so the box never hunts at full throttle.
  - **Braking**: under hard braking the gear is held (no shifting mid-stop);
    only as the car comes down below ~10 km/h do the gears drop through
    quickly so it's back in 1st when it halts. Downshifts get a rev-match
    throttle blip in the sound; upshifts get a torque cut.
- **Sound** (`js/sound.js`): fully synthesized placeholder (v1). Firing
  frequency `rpm / 60 × cylinders / 2` drives a stack of detuned saw/square
  oscillators through waveshaper distortion and a throttle-tracking lowpass,
  plus band-passed noise for intake/exhaust breath. Load controls loudness
  *and* brightness — the on/off-throttle difference that makes ICE cars sound
  alive. Real recorded samples can replace this layer later.
- **UI** (`js/dashboard.js`): canvas tachometer with red zone, speedometer,
  gear indicator and shift light, styled like an instrument cluster.

## Configurable (⚙ Settings)

| Setting | Range |
| --- | --- |
| Speed source | Manual slider / Pedals / GPS |
| Units | km/h / mph |
| Max RPM | 4,000 – 12,000 |
| Idle RPM | 500 – 1,500 |
| Cylinders | 2 – 12 |
| Gears | 3 – 10 |
| Shift-up / shift-down RPM | configurable with hysteresis guard |
| Max speed | 120 – 400 km/h |
| Volume | 0 – 100% |

Settings persist in `localStorage`.

## Roadmap

- Replace synthesized layers with granular playback of real engine recordings
- Overrun pops/burbles and turbo/supercharger layers
- Manual shifting mode (paddle buttons)
- OBD-II / vehicle API speed input where available
