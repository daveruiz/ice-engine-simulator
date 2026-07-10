/**
 * Main app: wires settings UI, speed sources (manual slider / GPS),
 * the engine model, the sound synth and the dashboard together.
 */
(function () {
  "use strict";

  const KMH_PER_MS = 3.6;
  const MPH_PER_KMH = 0.621371;
  const STORAGE_KEY = "ice-simulator-settings-v1";

  // GPS noise rejection. A phone standing still doesn't report a clean 0:
  // its fix wanders several metres between samples (and browsers that don't
  // provide coords.speed force us to derive speed from those position deltas,
  // which as a raw distance always reads as forward motion). Without this the
  // car "creeps" while parked and the neutral rev-pedal decay gets cut short
  // by a phantom re-engage. Displacement below the fix's own accuracy radius
  // is treated as noise, and any resulting speed under the floor is a true stop.
  const GPS_ACCURACY_FALLBACK_M = 12; // when coords.accuracy is missing
  const GPS_SPEED_FLOOR_KMH = 3; // below this the car is considered stopped

  const DEFAULTS = {
    source: "gps", // 'manual' | 'pedals' | 'gps'
    units: "kmh", // 'kmh' | 'mph'
    maxRpm: 7000,
    idleRpm: 850,
    cylinders: 6,
    gears: 6,
    shiftUpRpm: 6200,
    shiftDownRpm: 1800,
    maxSpeed: 250, // always stored in km/h
    revUpTime: 0.55, // neutral rev-up time constant (s)
    revDownTime: 0.85, // neutral rev-down time constant (s)
    speedSmoothing: 0.3, // s: speed-follow lag (lower = snappier vs GPS)
    volume: 70,
    startVolume: 150, // ignition clip level, % relative to master volume
    soundSet: "physical", // 'synth' | 'physical' | a pack id | 'auto'
  };

  let settings = loadSettings();

  const engine = new EngineSim(engineConfig());

  // Sound engines: the built-in synth, the physically modeled engine
  // (js/physical.js, tuned in tuner.html) plus any sample packs registered
  // in sounds/engines.js (one folder per engine, each with a pack.js).
  // Packs are loaded lazily the first time they're selected.
  const synthSound = new EngineSound();
  const physicalSound = new PhysicalEngineSound();
  let soundLibrary = []; // entries from sounds/engines.js
  const packEngines = new Map(); // id -> SampleEngineSound | null (failed)
  let sound = synthSound; // active engine
  let soundSwapToken = 0; // guards concurrent engine swaps

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    overlay: $("start-overlay"),
    app: $("app"),
    gear: $("gear-value"),
    shiftLight: $("shift-light"),
    roRpm: $("ro-rpm"),
    roSpeed: $("ro-speed"),
    roThrottle: $("ro-throttle"),
    roSpeedUnit: $("ro-speed-unit"),
    speedUnitLabel: $("speed-unit-label"),
    slider: $("speed-slider"),
    manualControls: $("manual-controls"),
    pedalControls: $("pedal-controls"),
    gpsStatus: $("gps-status"),
    gpsMessage: $("gps-message"),
    settingsPanel: $("settings-panel"),
    engineToggle: $("btn-engine-toggle"),
  };

  const tacho = new Gauge($("tacho"), {
    max: settings.maxRpm,
    majorStep: 1000,
    redFrom: redlineFor(settings),
    minorPerMajor: 5,
    tickLabel: (v) => Math.round(v / 1000),
    digitalFmt: (v) => String(Math.round(v / 10) * 10),
  });
  const speedo = new Gauge($("speedo"), {
    max: displaySpeed(settings.maxSpeed),
    majorStep: speedoStep(),
    redFrom: Infinity,
    minorPerMajor: 4,
    digitalFmt: (v) => String(Math.round(v)),
  });

  // ---------- Settings persistence ----------
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = Object.assign({}, DEFAULTS, JSON.parse(raw));
        if (s.soundSet === "samples") s.soundSet = "auto"; // pre-library format
        return s;
      }
    } catch (e) {
      /* private mode etc. */
    }
    return Object.assign({}, DEFAULTS);
  }
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      /* ignore */
    }
  }

  function engineConfig() {
    return {
      maxRpm: settings.maxRpm,
      idleRpm: settings.idleRpm,
      maxSpeed: settings.maxSpeed,
      gears: settings.gears,
      shiftUpRpm: Math.min(settings.shiftUpRpm, settings.maxRpm - 200),
      shiftDownRpm: settings.shiftDownRpm,
      revUpTime: settings.revUpTime,
      revDownTime: settings.revDownTime,
      speedSmoothing: settings.speedSmoothing,
    };
  }

  function redlineFor(s) {
    return Math.max(s.shiftUpRpm, s.maxRpm - 1000);
  }

  // ---------- Units ----------
  function displaySpeed(kmh) {
    return settings.units === "mph" ? kmh * MPH_PER_KMH : kmh;
  }
  function speedoStep() {
    const max = displaySpeed(settings.maxSpeed);
    if (max <= 160) return 20;
    if (max <= 260) return 30;
    return 40;
  }
  function unitLabel() {
    return settings.units === "mph" ? "mph" : "km/h";
  }

  function applySettings() {
    engine.configure(engineConfig());
    tacho.setRange(settings.maxRpm, 1000, redlineFor(settings));
    speedo.setRange(displaySpeed(settings.maxSpeed), speedoStep(), Infinity);
    el.slider.max = String(Math.round(settings.maxSpeed));
    el.roSpeedUnit.textContent = unitLabel();
    el.speedUnitLabel.textContent = unitLabel();
    sound.setVolume(settings.volume / 100);
    setSource(settings.source);
    setActiveSound();
    updateSettingsVisibility();
    saveSettings();
  }

  // Show each control only where it applies: Cylinders shapes the built-in
  // synth, the tuner is for the physical model, and speed smoothing only
  // matters for the (jittery) GPS input.
  function updateSettingsVisibility() {
    $("row-cylinders").classList.toggle(
      "hidden",
      settings.soundSet !== "synth",
    );
    $("row-tuner").classList.toggle("hidden", settings.soundSet !== "physical");
    $("row-speedsmooth").classList.toggle("hidden", settings.source !== "gps");
  }

  // ---------- Sound engine selection ----------
  function loadScriptGlobal(src, globalName) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src + "?ts=" + Date.now();
      s.onload = () => {
        s.remove();
        window[globalName]
          ? resolve(window[globalName])
          : reject(new Error(src + " did not define " + globalName));
      };
      s.onerror = () => {
        s.remove();
        reject(new Error("missing " + src));
      };
      document.head.appendChild(s);
    });
  }

  /** Library entry for the current setting (built-ins resolve to null). */
  function resolveSoundChoice() {
    if (settings.soundSet === "synth" || settings.soundSet === "physical") {
      return null;
    }
    return (
      soundLibrary.find((e) => e.id === settings.soundSet) ||
      soundLibrary[0] ||
      null
    );
  }

  async function ensurePackEngine(entry) {
    if (packEngines.has(entry.id)) return packEngines.get(entry.id);
    try {
      const pack = await SampleEngineSound.loadPack(
        "sounds/" + entry.dir + "/",
      );
      const eng = new SampleEngineSound(pack);
      packEngines.set(entry.id, eng);
      return eng;
    } catch (e) {
      packEngines.set(entry.id, null);
      return null;
    }
  }

  /** Activate the selected engine, restarting audio if it's playing. */
  async function setActiveSound() {
    const token = ++soundSwapToken;
    const entry = resolveSoundChoice();
    let next = synthSound;
    let note = "Built-in synthesized engine.";
    if (settings.soundSet === "physical") {
      next = physicalSound;
      note =
        "Physically modeled engine (cylinders, waveguides, muffler…). " +
        'Shape it in the <a href="tuner.html">engine tuner</a> — ' +
        "the cylinder count lives there, not in the slider above.";
    } else if (entry) {
      const eng = await ensurePackEngine(entry);
      if (token !== soundSwapToken) return; // superseded by a newer choice
      if (eng) {
        next = eng;
        note =
          entry.name + " — slots: " + Object.keys(eng.pack.slots).join(", ");
      } else {
        note =
          'Pack "' +
          entry.name +
          '" failed to load — using the synthesized engine.';
      }
    }
    $("soundset-hint").innerHTML = note;
    if (next === sound) return;
    const wasOn = engineOn || !!cranking;
    if (wasOn) stopEngine({ spinDown: false });
    sound = next;
    sound.setVolume(settings.volume / 100);
    if (wasOn) await startEngine({ withStarter: false });
  }

  /** Rebuild the Engine dropdown from the library + built-in synth. */
  function populateSoundSelect() {
    const sel = $("set-soundset");
    sel.innerHTML = "";
    for (const e of soundLibrary) {
      const o = document.createElement("option");
      o.value = e.id;
      o.textContent = e.name;
      sel.appendChild(o);
    }
    const op = document.createElement("option");
    op.value = "physical";
    op.textContent = "Physical model (V8 preset)";
    sel.appendChild(op);
    const o = document.createElement("option");
    o.value = "synth";
    o.textContent = "Synthesized (built-in)";
    sel.appendChild(o);
    const entry = resolveSoundChoice();
    sel.value =
      settings.soundSet === "physical"
        ? "physical"
        : entry
          ? entry.id
          : "synth";
  }

  async function loadSoundLibrary() {
    try {
      const lib = await loadScriptGlobal(
        "sounds/engines.js",
        "ENGINE_SOUND_LIBRARY",
      );
      soundLibrary = (Array.isArray(lib) ? lib : []).filter(
        (e) => e && e.id && e.dir && e.id !== "synth",
      );
    } catch (e) {
      soundLibrary = [];
    }
    populateSoundSelect();
    setActiveSound();
  }

  // ---------- Speed sources ----------
  let gpsWatchId = null;
  let lastGpsPos = null;

  function setSource(source) {
    settings.source = source;
    el.manualControls.classList.toggle("hidden", source !== "manual");
    el.pedalControls.classList.toggle("hidden", source !== "pedals");
    el.gpsStatus.classList.toggle("hidden", source !== "gps");
    // Control area height changes with the source; re-fit the gauges
    requestAnimationFrame(onResize);
    if (source !== "pedals") setDriveMode("d"); // N only exists with pedals
    if (source === "gps") {
      startGps();
    } else {
      stopGps();
      if (source === "manual") {
        engine.setTargetSpeed(Number(el.slider.value));
      } else {
        pedalSpeed = engine.speed; // take over from wherever the car is
      }
    }
  }

  // ---------- Pedals ----------
  // Press amount comes from *where* the pedal is touched: near the top is
  // a light press, near the bottom is flooring it. Each pedal tracks its
  // own pointer, so gas and brake work simultaneously (multi-touch).
  const pedals = { gas: 0, brake: 0 };
  let pedalSpeed = 0; // km/h integrated from pedal inputs
  let driveMode = "d"; // 'd' drive | 'n' neutral (gas free-revs the engine)

  function setDriveMode(mode) {
    driveMode = mode;
    engine.setNeutral(mode === "n");
    if (mode !== "n") engine.setRevDemand(0);
    $("mode-n").classList.toggle("active", mode === "n");
    $("mode-d").classList.toggle("active", mode === "d");
  }
  $("mode-n").addEventListener("click", () => setDriveMode("n"));
  $("mode-d").addEventListener("click", () => setDriveMode("d"));

  // Touch position (0 = top, 1 = bottom) -> press amount. A 0.30 floor and
  // dead margins at the extremes (0–25% and 75–100%), which are hard to
  // hit accurately on touch: 30% up to 25%, ramping to 100% by 75%.
  function pedalPress(frac) {
    const p = Math.max(0, Math.min(1, frac));
    const MIN = 0.3,
      LO = 0.25,
      HI = 0.75;
    if (p <= LO) return MIN;
    if (p >= HI) return 1;
    return MIN + ((1 - MIN) * (p - LO)) / (HI - LO);
  }

  function setupPedal(elPedal, key) {
    const apply = (e) => {
      const rect = elPedal.getBoundingClientRect();
      pedals[key] = pedalPress((e.clientY - rect.top) / rect.height);
      elPedal.style.setProperty("--press", pedals[key].toFixed(2));
      elPedal.classList.add("pressed");
    };
    const release = () => {
      pedals[key] = 0;
      elPedal.style.setProperty("--press", "0");
      elPedal.classList.remove("pressed");
    };
    elPedal.addEventListener("pointerdown", (e) => {
      elPedal.setPointerCapture(e.pointerId);
      e.preventDefault();
      apply(e);
    });
    elPedal.addEventListener("pointermove", (e) => {
      if (elPedal.hasPointerCapture(e.pointerId) && pedals[key] > 0) apply(e);
    });
    elPedal.addEventListener("pointerup", release);
    elPedal.addEventListener("pointercancel", release);
  }
  setupPedal($("pedal-gas"), "gas");
  setupPedal($("pedal-brake"), "brake");

  // GPS-mode rev pedal: momentary clutch-in blip. While held it puts the
  // engine in neutral and revs it from the touch position (top = light,
  // bottom = full), so you can make noise at a stop — or over the top of
  // moving GPS speed — without leaving GPS mode. On release the revs spin
  // down: if the car is stopped we stay in neutral so the decay is audible;
  // once GPS shows movement the render loop re-engages a gear.
  //
  // The "moving" threshold sits above typical standstill GPS noise: a phone
  // sitting still still reports a few km/h of jitter, and at 1 km/h a single
  // noisy fix would re-engage a gear and snap the revs to idle (killing the
  // spin-down). ~6 km/h is safely past that but still a walking pace.
  const MOVING_KMH = 6;
  let revHeld = false;
  function setupRevPedal(elPedal) {
    const apply = (e) => {
      const rect = elPedal.getBoundingClientRect();
      const press = pedalPress((e.clientY - rect.top) / rect.height);
      elPedal.style.setProperty("--press", press.toFixed(2));
      elPedal.classList.add("pressed");
      revHeld = true;
      engine.setNeutral(true);
      engine.setRevDemand(press);
    };
    const release = () => {
      elPedal.style.setProperty("--press", "0");
      elPedal.classList.remove("pressed");
      revHeld = false;
      engine.setRevDemand(0);
      // Stay in neutral while stopped so the free-rev spins down; the loop
      // re-engages a gear as soon as the car is moving.
      if (engine.speed > MOVING_KMH) engine.setNeutral(false);
    };
    elPedal.addEventListener("pointerdown", (e) => {
      elPedal.setPointerCapture(e.pointerId);
      e.preventDefault();
      apply(e);
    });
    elPedal.addEventListener("pointermove", (e) => {
      if (elPedal.hasPointerCapture(e.pointerId)) apply(e);
    });
    elPedal.addEventListener("pointerup", release);
    elPedal.addEventListener("pointercancel", release);
  }
  setupRevPedal($("rev-pedal"));

  /**
   * Pedal-mode vehicle physics (km/h per second): full gas accelerates
   * hard (fading near top speed), brake decelerates strongly, and with
   * no pedals the car coasts down against drag — so holding a speed
   * needs a bit of gas, like a real car.
   */
  function updatePedalPhysics(dt) {
    const max = settings.maxSpeed;
    // In neutral the gas revs the engine instead of driving the wheels
    const inGear = driveMode !== "n";
    if (!inGear) engine.setRevDemand(pedals.gas);
    const gasAccel = inGear
      ? pedals.gas * 26 * (1 - 0.68 * (pedalSpeed / max))
      : 0;
    const brakeDecel = pedals.brake * 55;
    const drag = pedalSpeed > 0 ? 1.2 + 2.4 * (pedalSpeed / max) : 0;
    pedalSpeed += (gasAccel - brakeDecel - drag) * dt;
    pedalSpeed = Math.max(0, Math.min(pedalSpeed, max));
    engine.setTargetSpeed(pedalSpeed);
  }

  function startGps() {
    if (gpsWatchId !== null) return;
    if (!("geolocation" in navigator)) {
      gpsError("Geolocation not supported on this device");
      return;
    }
    el.gpsStatus.classList.remove("fix", "error");
    el.gpsMessage.textContent = "Waiting for GPS fix…";
    gpsWatchId = navigator.geolocation.watchPosition(
      onGpsPosition,
      (err) => {
        gpsError(
          err.code === 1
            ? "Location permission denied"
            : "GPS error: " + err.message,
        );
      },
      { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 },
    );
  }

  function stopGps() {
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
    lastGpsPos = null;
  }

  function onGpsPosition(pos) {
    let speedKmh = null;
    if (pos.coords.speed !== null && !isNaN(pos.coords.speed)) {
      speedKmh = Math.max(0, pos.coords.speed) * KMH_PER_MS;
    } else if (lastGpsPos) {
      // Fallback: derive speed from consecutive fixes (haversine). Ignore
      // displacement within the fix's accuracy radius — that's standstill
      // jitter, not motion — so a parked car reads 0 instead of drifting up.
      const dt = (pos.timestamp - lastGpsPos.timestamp) / 1000;
      if (dt > 0.2) {
        const d = haversineMeters(
          lastGpsPos.coords.latitude,
          lastGpsPos.coords.longitude,
          pos.coords.latitude,
          pos.coords.longitude,
        );
        const noise = pos.coords.accuracy || GPS_ACCURACY_FALLBACK_M;
        speedKmh = d > noise ? (d / dt) * KMH_PER_MS : 0;
      }
    }
    lastGpsPos = pos;
    if (speedKmh !== null) {
      // Deadband: treat a hair of speed as a full stop so the car doesn't
      // creep, and the neutral rev-pedal spins all the way down at a light.
      if (speedKmh < GPS_SPEED_FLOOR_KMH) speedKmh = 0;
      engine.setTargetSpeed(speedKmh);
      el.gpsStatus.classList.add("fix");
      el.gpsStatus.classList.remove("error");
      el.gpsMessage.textContent =
        "GPS: " + Math.round(displaySpeed(speedKmh)) + " " + unitLabel();
    }
  }

  function gpsError(msg) {
    el.gpsStatus.classList.add("error");
    el.gpsStatus.classList.remove("fix");
    el.gpsMessage.textContent = msg;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000,
      toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad,
      dLon = (lon2 - lon1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ---------- Settings UI ----------
  const bindings = [
    // [element id, output id, settings key, format]
    ["set-maxrpm", "out-maxrpm", "maxRpm", (v) => v],
    ["set-idlerpm", "out-idlerpm", "idleRpm", (v) => v],
    ["set-cylinders", "out-cylinders", "cylinders", (v) => v],
    ["set-gears", "out-gears", "gears", (v) => v],
    ["set-shiftup", "out-shiftup", "shiftUpRpm", (v) => v],
    ["set-shiftdown", "out-shiftdown", "shiftDownRpm", (v) => v],
    ["set-maxspeed", "out-maxspeed", "maxSpeed", (v) => v],
    ["set-speedsmooth", "out-speedsmooth", "speedSmoothing", (v) => v.toFixed(2) + "s"],
    ["set-revup", "out-revup", "revUpTime", (v) => v.toFixed(2) + "s"],
    ["set-revdown", "out-revdown", "revDownTime", (v) => v.toFixed(2) + "s"],
    ["set-volume", "out-volume", "volume", (v) => v + "%"],
    ["set-startvol", "out-startvol", "startVolume", (v) => v + "%"],
  ];

  function syncSettingsUI() {
    $("set-source").value = settings.source;
    $("set-units").value = settings.units;
    populateSoundSelect();
    for (const [inputId, outId, key, fmt] of bindings) {
      $(inputId).value = settings[key];
      $(outId).textContent = fmt(settings[key]);
    }
  }

  function initSettingsUI() {
    syncSettingsUI();
    for (const [inputId, outId, key, fmt] of bindings) {
      $(inputId).addEventListener("input", () => {
        settings[key] = Number($(inputId).value);
        // Keep shift thresholds sane relative to each other / max RPM
        if (key === "maxRpm" && settings.shiftUpRpm > settings.maxRpm - 200) {
          settings.shiftUpRpm = settings.maxRpm - 200;
          syncSettingsUI();
        }
        if (key === "shiftUpRpm" || key === "shiftDownRpm") {
          if (settings.shiftDownRpm > settings.shiftUpRpm - 800) {
            settings.shiftDownRpm = Math.max(800, settings.shiftUpRpm - 800);
            syncSettingsUI();
          }
        }
        $(outId).textContent = fmt(settings[key]);
        applySettings();
      });
    }
    $("set-source").addEventListener("change", (e) => {
      settings.source = e.target.value;
      applySettings();
    });
    $("set-units").addEventListener("change", (e) => {
      settings.units = e.target.value;
      applySettings();
    });
    $("set-soundset").addEventListener("change", (e) => {
      settings.soundSet = e.target.value;
      applySettings();
    });
    $("btn-reset-defaults").addEventListener("click", () => {
      settings = Object.assign({}, DEFAULTS);
      syncSettingsUI();
      applySettings();
    });
    $("btn-settings").addEventListener("click", () =>
      el.settingsPanel.classList.remove("hidden"),
    );
    $("btn-settings-close").addEventListener("click", () =>
      el.settingsPanel.classList.add("hidden"),
    );
  }

  // ---------- Manual controls ----------
  el.slider.addEventListener("input", () => {
    engine.setTargetSpeed(Number(el.slider.value));
  });
  document.querySelectorAll(".quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      let v = Number(btn.dataset.speed);
      if (v < 0) v = settings.maxSpeed;
      v = Math.min(v, settings.maxSpeed);
      el.slider.value = String(v);
      engine.setTargetSpeed(v);
    });
  });

  // ---------- Engine start/stop ----------
  let engineOn = false;
  let cranking = null; // { elapsed } while the starter clip cranks
  let shutdown = null; // { snd, elapsed, rpm0, faded } during key-off spin-down

  // Shared starter (ignition) clip, played for every sound engine when the
  // key is turned. Timed to the recording: it cranks, then the engine
  // "catches" ~0.8 s in — that's when the generated engine swells up under
  // the sample's settling tail.
  const STARTER_URL = "sounds/start.ogg?v=24";
  const STARTER_CATCH = 0.8; // s: engine fires in the recording
  const STARTER_FADE = 0.55; // s: generated engine swell-in
  const STARTER_CRANK_RPM = 260; // needle sits here while the starter cranks
  // On catch the revs flare up and settle back to idle, matching the sample's
  // rev peak (~1.0 s) and decay. Times are measured from the catch.
  const STARTER_FLARE_PEAK = 1.8; // × idle rpm at the top of the blip
  const STARTER_FLARE_RISE = 0.22; // s: catch → peak
  const STARTER_FLARE_FALL = 0.95; // s: peak → idle
  const SHUTDOWN_TIME = 1.3; // s: revs wind down to a halt on key-off
  let starterBytes = null; // cached raw file (fetched once)

  async function playStarter(ctx) {
    try {
      if (!starterBytes) {
        starterBytes = await (await fetch(STARTER_URL)).arrayBuffer();
      }
      // decodeAudioData detaches its input, so decode a fresh copy each time.
      const buf = await ctx.decodeAudioData(starterBytes.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      // Own level (Settings → Start sound volume), scaled by master so an
      // overall mute still applies. Can boost past unity — a limiter below
      // catches the peaks so the clip stays clean.
      g.gain.value = (settings.volume / 100) * (settings.startVolume / 100);
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 4;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      src.connect(g);
      g.connect(limiter);
      limiter.connect(ctx.destination);
      src.start();
    } catch (e) {
      /* starter is cosmetic — never block the engine on it */
    }
  }

  async function startEngine(opts = {}) {
    const withStarter = opts.withStarter !== false;
    // Cancel any in-flight spin-down / crank so a quick re-start is clean.
    if (shutdown) {
      shutdown.snd.stop();
      shutdown = null;
    }
    cranking = null;
    // Set the level before start() (while stopped) so it only stages the
    // value; the master itself is faded in below, not snapped up.
    sound.setVolume(settings.volume / 100);
    try {
      await sound.start();
    } catch (err) {
      $("soundset-hint").textContent =
        "Sound engine failed to start: " + err.message;
      return;
    }
    engineOn = true;
    el.engineToggle.textContent = "■ STOP ENGINE";
    if (withStarter && sound.ctx) {
      playStarter(sound.ctx);
      sound.fadeIn(STARTER_CATCH, STARTER_FADE); // swell in as the engine catches
      cranking = { elapsed: 0 };
    } else {
      sound.fadeIn(0, 0.15); // instant-ish (e.g. swapping sound engines)
    }
  }

  function stopEngine(opts = {}) {
    if (!engineOn && !cranking) return;
    engineOn = false;
    cranking = null;
    el.engineToggle.textContent = "▶ START ENGINE";
    // Car comes to a stop with the engine — don't resume mid-speed next start.
    engine.speed = 0;
    engine.setTargetSpeed(0);
    pedalSpeed = 0;
    el.slider.value = "0";
    if (opts.spinDown === false) {
      sound.stop();
      return;
    }
    // Emulate the engine dying: the revs wind down to a stop, then silence.
    shutdown = {
      snd: sound,
      elapsed: 0,
      rpm0: Math.max(engine.rpm, settings.idleRpm),
      faded: false,
    };
  }

  $("btn-start").addEventListener("click", async () => {
    el.overlay.classList.add("hidden");
    el.app.classList.remove("hidden");
    onResize();
    await startEngine();
  });
  el.engineToggle.addEventListener("click", () => {
    engineOn ? stopEngine() : startEngine();
  });

  // ---------- Render / simulation loop ----------
  let lastTime = performance.now();

  function loop(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    if (settings.source === "pedals") updatePedalPhysics(dt);
    // GPS rev pedal: once the car is moving again, drop out of the
    // held-at-standstill neutral and re-engage a gear.
    if (
      settings.source === "gps" &&
      engine.neutral &&
      !revHeld &&
      engine.speed > MOVING_KMH
    ) {
      engine.setNeutral(false);
    }
    engine.update(dt);

    // Displayed rpm/gear depend on run state (a fully-off engine reads 0,
    // even though the model keeps idling internally).
    let dispRpm = 0;
    let dispGear = "N";
    let dispThrottle = 0;

    if (shutdown) {
      // Key-off: revs wind down to a halt, then the sound is torn down.
      shutdown.elapsed += dt;
      const p = Math.min(1, shutdown.elapsed / SHUTDOWN_TIME);
      // Decel curve reaches 0 at p=1; a small shudder as it dies.
      const shudder = 1 + 0.05 * Math.sin(shutdown.elapsed * 30) * (1 - p);
      dispRpm = Math.max(0, shutdown.rpm0 * Math.pow(1 - p, 1.6) * shudder);
      dispGear = "N";
      dispThrottle = 0;
      shutdown.snd.update(
        dispRpm,
        0,
        settings.maxRpm,
        settings.cylinders,
        false,
        0,
      );
      // Fade the last of the sound out so the low-rpm tail doesn't drone.
      if (!shutdown.faded && p > 0.55) {
        shutdown.snd.fadeOut(SHUTDOWN_TIME * (1 - 0.55));
        shutdown.faded = true;
      }
      if (p >= 1) {
        shutdown.snd.stop();
        shutdown = null;
      }
    } else if (engineOn) {
      let sRpm = engine.rpm,
        sLoad = engine.throttle;
      let sShift = engine.shifting,
        sDir = engine.shiftDir;
      if (cranking) {
        // Follow the recording: the needle sits low while the starter cranks,
        // then on catch (~0.8s) the revs flare up and settle back to idle —
        // and we feed that same curve to the generated engine so it blips in
        // step with the sample instead of fading in flat.
        cranking.elapsed += dt;
        const e = cranking.elapsed;
        const idle = settings.idleRpm;
        let crankRpm,
          crankLoad = 0;
        if (e < STARTER_CATCH) {
          crankRpm = STARTER_CRANK_RPM * (0.85 + 0.15 * Math.sin(e * 22)); // uneven cranking
        } else {
          const te = e - STARTER_CATCH;
          const peak = idle * STARTER_FLARE_PEAK;
          if (te < STARTER_FLARE_RISE) {
            const p = te / STARTER_FLARE_RISE;
            crankRpm =
              STARTER_CRANK_RPM +
              (peak - STARTER_CRANK_RPM) * (p * p * (3 - 2 * p));
          } else {
            const p = Math.min(
              1,
              (te - STARTER_FLARE_RISE) / STARTER_FLARE_FALL,
            );
            crankRpm = peak + (idle - peak) * (p * p * (3 - 2 * p));
            if (p >= 1) cranking = null;
          }
          crankLoad =
            Math.max(0, Math.min(1, (crankRpm - idle) / (peak - idle))) * 0.6;
        }
        dispRpm = crankRpm;
        dispThrottle = crankLoad;
        sRpm = crankRpm;
        sLoad = crankLoad;
        sShift = false;
        sDir = 0;
      } else {
        dispRpm = engine.rpm;
        dispGear = engine.displayGear;
        dispThrottle = engine.throttle;
      }
      sound.update(
        sRpm,
        sLoad,
        settings.maxRpm,
        settings.cylinders,
        sShift,
        sDir,
      );
    }

    // Gauges
    tacho.value = dispRpm;
    speedo.value = displaySpeed(engine.speed);
    tacho.draw();
    speedo.draw();

    // Readouts
    el.gear.textContent = dispGear;
    el.roRpm.textContent = String(Math.round(dispRpm / 10) * 10);
    el.roSpeed.textContent = String(Math.round(displaySpeed(engine.speed)));
    el.roThrottle.textContent = String(Math.round(dispThrottle * 100));
    el.shiftLight.classList.toggle(
      "on",
      engineOn &&
        !cranking &&
        (engine.rpm >= redlineFor(settings) || engine.shifting),
    );

    requestAnimationFrame(loop);
  }

  function onResize() {
    tacho._resize();
    speedo._resize();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 200));

  // Keep audio alive when tab visibility flips (Tesla browser can suspend)
  document.addEventListener("visibilitychange", () => {
    if (
      !document.hidden &&
      engineOn &&
      sound.ctx &&
      sound.ctx.state === "suspended"
    ) {
      sound.ctx.resume();
    }
  });

  // ---------- Boot ----------
  initSettingsUI();
  applySettings();
  loadSoundLibrary();
  requestAnimationFrame(loop);

  // Debug/testing hook
  window.__ice = {
    engine,
    get sound() {
      return sound;
    },
    get settings() {
      return settings;
    },
  };
})();
