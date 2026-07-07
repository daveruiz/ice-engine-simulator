/**
 * Main app: wires settings UI, speed sources (manual slider / GPS),
 * the engine model, the sound synth and the dashboard together.
 */
(function () {
  'use strict';

  const KMH_PER_MS = 3.6;
  const MPH_PER_KMH = 0.621371;
  const STORAGE_KEY = 'ice-simulator-settings-v1';

  const DEFAULTS = {
    source: 'manual',   // 'manual' | 'gps'
    units: 'kmh',       // 'kmh' | 'mph'
    maxRpm: 7000,
    idleRpm: 850,
    cylinders: 6,
    gears: 6,
    shiftUpRpm: 6200,
    shiftDownRpm: 1800,
    maxSpeed: 250,      // always stored in km/h
    volume: 70,
  };

  let settings = loadSettings();

  const engine = new EngineSim(engineConfig());
  const sound = new EngineSound();

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    overlay: $('start-overlay'), app: $('app'),
    gear: $('gear-value'), shiftLight: $('shift-light'),
    roRpm: $('ro-rpm'), roSpeed: $('ro-speed'), roThrottle: $('ro-throttle'),
    roSpeedUnit: $('ro-speed-unit'), speedUnitLabel: $('speed-unit-label'),
    slider: $('speed-slider'), manualControls: $('manual-controls'),
    pedalControls: $('pedal-controls'),
    gpsStatus: $('gps-status'), gpsMessage: $('gps-message'),
    settingsPanel: $('settings-panel'),
    engineToggle: $('btn-engine-toggle'),
  };

  const tacho = new Gauge($('tacho'), {
    max: settings.maxRpm, majorStep: 1000, redFrom: redlineFor(settings),
    minorPerMajor: 5,
    tickLabel: (v) => Math.round(v / 1000),
    digitalFmt: (v) => String(Math.round(v / 10) * 10),
  });
  const speedo = new Gauge($('speedo'), {
    max: displaySpeed(settings.maxSpeed), majorStep: speedoStep(), redFrom: Infinity,
    minorPerMajor: 4,
    digitalFmt: (v) => String(Math.round(v)),
  });

  // ---------- Settings persistence ----------
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* private mode etc. */ }
    return Object.assign({}, DEFAULTS);
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch (e) { /* ignore */ }
  }

  function engineConfig() {
    return {
      maxRpm: settings.maxRpm,
      idleRpm: settings.idleRpm,
      maxSpeed: settings.maxSpeed,
      gears: settings.gears,
      shiftUpRpm: Math.min(settings.shiftUpRpm, settings.maxRpm - 200),
      shiftDownRpm: settings.shiftDownRpm,
    };
  }

  function redlineFor(s) { return Math.max(s.shiftUpRpm, s.maxRpm - 1000); }

  // ---------- Units ----------
  function displaySpeed(kmh) {
    return settings.units === 'mph' ? kmh * MPH_PER_KMH : kmh;
  }
  function speedoStep() {
    const max = displaySpeed(settings.maxSpeed);
    if (max <= 160) return 20;
    if (max <= 260) return 30;
    return 40;
  }
  function unitLabel() { return settings.units === 'mph' ? 'mph' : 'km/h'; }

  function applySettings() {
    engine.configure(engineConfig());
    tacho.setRange(settings.maxRpm, 1000, redlineFor(settings));
    speedo.setRange(displaySpeed(settings.maxSpeed), speedoStep(), Infinity);
    el.slider.max = String(Math.round(settings.maxSpeed));
    el.roSpeedUnit.textContent = unitLabel();
    el.speedUnitLabel.textContent = unitLabel();
    sound.setVolume(settings.volume / 100);
    setSource(settings.source);
    saveSettings();
  }

  // ---------- Speed sources ----------
  let gpsWatchId = null;
  let lastGpsPos = null;

  function setSource(source) {
    settings.source = source;
    el.manualControls.classList.toggle('hidden', source !== 'manual');
    el.pedalControls.classList.toggle('hidden', source !== 'pedals');
    el.gpsStatus.classList.toggle('hidden', source !== 'gps');
    if (source === 'gps') {
      startGps();
    } else {
      stopGps();
      if (source === 'manual') {
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

  function setupPedal(elPedal, key) {
    const apply = (e) => {
      const rect = elPedal.getBoundingClientRect();
      const frac = (e.clientY - rect.top) / rect.height;
      pedals[key] = Math.max(0.1, Math.min(1, frac));
      elPedal.style.setProperty('--press', pedals[key].toFixed(2));
      elPedal.classList.add('pressed');
    };
    const release = () => {
      pedals[key] = 0;
      elPedal.style.setProperty('--press', '0');
      elPedal.classList.remove('pressed');
    };
    elPedal.addEventListener('pointerdown', (e) => {
      elPedal.setPointerCapture(e.pointerId);
      e.preventDefault();
      apply(e);
    });
    elPedal.addEventListener('pointermove', (e) => {
      if (elPedal.hasPointerCapture(e.pointerId) && pedals[key] > 0) apply(e);
    });
    elPedal.addEventListener('pointerup', release);
    elPedal.addEventListener('pointercancel', release);
  }
  setupPedal($('pedal-gas'), 'gas');
  setupPedal($('pedal-brake'), 'brake');

  /**
   * Pedal-mode vehicle physics (km/h per second): full gas accelerates
   * hard (fading near top speed), brake decelerates strongly, and with
   * no pedals the car coasts down against drag — so holding a speed
   * needs a bit of gas, like a real car.
   */
  function updatePedalPhysics(dt) {
    const max = settings.maxSpeed;
    const gasAccel = pedals.gas * 26 * (1 - 0.68 * (pedalSpeed / max));
    const brakeDecel = pedals.brake * 55;
    const drag = pedalSpeed > 0 ? 1.2 + 2.4 * (pedalSpeed / max) : 0;
    pedalSpeed += (gasAccel - brakeDecel - drag) * dt;
    pedalSpeed = Math.max(0, Math.min(pedalSpeed, max));
    engine.setTargetSpeed(pedalSpeed);
  }

  function startGps() {
    if (gpsWatchId !== null) return;
    if (!('geolocation' in navigator)) {
      gpsError('Geolocation not supported on this device');
      return;
    }
    el.gpsStatus.classList.remove('fix', 'error');
    el.gpsMessage.textContent = 'Waiting for GPS fix…';
    gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, (err) => {
      gpsError(err.code === 1 ? 'Location permission denied' : 'GPS error: ' + err.message);
    }, { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 });
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
      // Fallback: derive speed from consecutive fixes (haversine)
      const dt = (pos.timestamp - lastGpsPos.timestamp) / 1000;
      if (dt > 0.2) {
        const d = haversineMeters(
          lastGpsPos.coords.latitude, lastGpsPos.coords.longitude,
          pos.coords.latitude, pos.coords.longitude);
        speedKmh = (d / dt) * KMH_PER_MS;
      }
    }
    lastGpsPos = pos;
    if (speedKmh !== null) {
      engine.setTargetSpeed(speedKmh);
      el.gpsStatus.classList.add('fix');
      el.gpsStatus.classList.remove('error');
      el.gpsMessage.textContent =
        'GPS: ' + Math.round(displaySpeed(speedKmh)) + ' ' + unitLabel();
    }
  }

  function gpsError(msg) {
    el.gpsStatus.classList.add('error');
    el.gpsStatus.classList.remove('fix');
    el.gpsMessage.textContent = msg;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ---------- Settings UI ----------
  const bindings = [
    // [element id, output id, settings key, format]
    ['set-maxrpm', 'out-maxrpm', 'maxRpm', (v) => v],
    ['set-idlerpm', 'out-idlerpm', 'idleRpm', (v) => v],
    ['set-cylinders', 'out-cylinders', 'cylinders', (v) => v],
    ['set-gears', 'out-gears', 'gears', (v) => v],
    ['set-shiftup', 'out-shiftup', 'shiftUpRpm', (v) => v],
    ['set-shiftdown', 'out-shiftdown', 'shiftDownRpm', (v) => v],
    ['set-maxspeed', 'out-maxspeed', 'maxSpeed', (v) => v],
    ['set-volume', 'out-volume', 'volume', (v) => v + '%'],
  ];

  function syncSettingsUI() {
    $('set-source').value = settings.source;
    $('set-units').value = settings.units;
    for (const [inputId, outId, key, fmt] of bindings) {
      $(inputId).value = settings[key];
      $(outId).textContent = fmt(settings[key]);
    }
  }

  function initSettingsUI() {
    syncSettingsUI();
    for (const [inputId, outId, key, fmt] of bindings) {
      $(inputId).addEventListener('input', () => {
        settings[key] = Number($(inputId).value);
        // Keep shift thresholds sane relative to each other / max RPM
        if (key === 'maxRpm' && settings.shiftUpRpm > settings.maxRpm - 200) {
          settings.shiftUpRpm = settings.maxRpm - 200;
          syncSettingsUI();
        }
        if (key === 'shiftUpRpm' || key === 'shiftDownRpm') {
          if (settings.shiftDownRpm > settings.shiftUpRpm - 800) {
            settings.shiftDownRpm = Math.max(800, settings.shiftUpRpm - 800);
            syncSettingsUI();
          }
        }
        $(outId).textContent = fmt(settings[key]);
        applySettings();
      });
    }
    $('set-source').addEventListener('change', (e) => {
      settings.source = e.target.value;
      applySettings();
    });
    $('set-units').addEventListener('change', (e) => {
      settings.units = e.target.value;
      applySettings();
    });
    $('btn-reset-defaults').addEventListener('click', () => {
      settings = Object.assign({}, DEFAULTS);
      syncSettingsUI();
      applySettings();
    });
    $('btn-settings').addEventListener('click', () =>
      el.settingsPanel.classList.remove('hidden'));
    $('btn-settings-close').addEventListener('click', () =>
      el.settingsPanel.classList.add('hidden'));
  }

  // ---------- Manual controls ----------
  el.slider.addEventListener('input', () => {
    engine.setTargetSpeed(Number(el.slider.value));
  });
  document.querySelectorAll('.quick').forEach((btn) => {
    btn.addEventListener('click', () => {
      let v = Number(btn.dataset.speed);
      if (v < 0) v = settings.maxSpeed;
      v = Math.min(v, settings.maxSpeed);
      el.slider.value = String(v);
      engine.setTargetSpeed(v);
    });
  });

  // ---------- Engine start/stop ----------
  let engineOn = false;

  async function startEngine() {
    await sound.start();
    sound.setVolume(settings.volume / 100);
    engineOn = true;
    el.engineToggle.textContent = '■ STOP ENGINE';
  }
  function stopEngine() {
    sound.stop();
    engineOn = false;
    el.engineToggle.textContent = '▶ START ENGINE';
  }

  $('btn-start').addEventListener('click', async () => {
    el.overlay.classList.add('hidden');
    el.app.classList.remove('hidden');
    onResize();
    await startEngine();
  });
  el.engineToggle.addEventListener('click', () => {
    engineOn ? stopEngine() : startEngine();
  });

  // ---------- Render / simulation loop ----------
  let lastTime = performance.now();

  function loop(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    if (settings.source === 'pedals') updatePedalPhysics(dt);
    engine.update(dt);

    if (engineOn) {
      sound.update(engine.rpm, engine.throttle, settings.maxRpm,
        settings.cylinders, engine.shifting, engine.shiftDir);
    }

    // Gauges
    tacho.value = engine.rpm;
    speedo.value = displaySpeed(engine.speed);
    tacho.draw();
    speedo.draw();

    // Readouts
    el.gear.textContent = engine.displayGear;
    el.roRpm.textContent = String(Math.round(engine.rpm / 10) * 10);
    el.roSpeed.textContent = String(Math.round(displaySpeed(engine.speed)));
    el.roThrottle.textContent = String(Math.round(engine.throttle * 100));
    el.shiftLight.classList.toggle('on',
      engine.rpm >= redlineFor(settings) || engine.shifting);

    requestAnimationFrame(loop);
  }

  function onResize() {
    tacho._resize();
    speedo._resize();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

  // Keep audio alive when tab visibility flips (Tesla browser can suspend)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && engineOn && sound.ctx && sound.ctx.state === 'suspended') {
      sound.ctx.resume();
    }
  });

  // ---------- Boot ----------
  initSettingsUI();
  applySettings();
  requestAnimationFrame(loop);

  // Debug/testing hook
  window.__ice = { engine, sound, get settings() { return settings; } };
})();
