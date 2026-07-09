/**
 * Engine tuner page: a test bench for the physically modeled engine.
 *
 * - Builds the whole parameter UI from PhysicalParams.SCHEMA, so adding a
 *   parameter to the schema automatically adds a slider here.
 * - Every change is applied to the running DSP immediately AND saved to
 *   localStorage, where the main simulator picks it up (live across tabs).
 * - The test bench reuses EngineSim: "Free rev" puts it in neutral and
 *   maps the throttle slider to rev demand (realistic flywheel behavior,
 *   overrun on lift-off); "Drive" feeds a target speed through the full
 *   gearbox model.
 */
(function () {
  'use strict';

  const PP = window.PhysicalParams;
  const $ = (id) => document.getElementById(id);

  let params = PP.load();
  const sound = new PhysicalEngineSound();
  sound.setParams(params);

  const engine = new EngineSim({});   // default config, 7000 max rpm
  engine.setNeutral(true);

  // ---------- Parameter UI (generated from the schema) ----------
  const inputs = {}; // key -> {input, output, fmt}

  function fmtValue(s, v) {
    if (s.type === 'select' || s.type === 'bool') return '';
    const digits = s.step >= 1 ? 0 : (s.step >= 0.05 ? 2 : 3);
    return Number(v).toFixed(digits) + (s.unit ? ' ' + s.unit : '');
  }

  function buildParamsUI() {
    const root = $('tuner-params');
    root.innerHTML = '';
    for (const g of PP.GROUPS) {
      const h = document.createElement('h3');
      h.textContent = g.name;
      root.appendChild(h);
      for (const s of PP.SCHEMA) {
        if (s.group !== g.id) continue;
        root.appendChild(buildRow(s));
      }
    }
  }

  function buildRow(s) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    if (s.info) row.title = s.info;

    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = s.label;
    const out = document.createElement('output');
    out.textContent = fmtValue(s, params[s.key]);
    label.appendChild(name);
    label.appendChild(out);
    row.appendChild(label);

    let input;
    if (s.type === 'select') {
      input = document.createElement('select');
      for (const [val, text] of s.options) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = text;
        input.appendChild(o);
      }
      input.value = params[s.key];
      input.addEventListener('change', () => setParam(s, input.value));
    } else if (s.type === 'bool') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'param-check';
      input.checked = !!params[s.key];
      input.addEventListener('change', () => setParam(s, input.checked ? 1 : 0));
    } else {
      input = document.createElement('input');
      input.type = 'range';
      input.min = s.min;
      input.max = s.max;
      input.step = s.step;
      input.value = params[s.key];
      input.addEventListener('input', () => setParam(s, Number(input.value)));
    }
    row.appendChild(input);
    inputs[s.key] = { input, output: out, schema: s };
    return row;
  }

  function setParam(s, value) {
    params[s.key] = value;
    inputs[s.key].output.textContent = fmtValue(s, value);
    PP.save(params);
    sound.setParams(params);
  }

  /** Push `params` back into every control (after reset/import). */
  function refreshUI() {
    for (const key of Object.keys(inputs)) {
      const { input, output, schema } = inputs[key];
      if (schema.type === 'bool') input.checked = !!params[key];
      else input.value = params[key];
      output.textContent = fmtValue(schema, params[key]);
    }
  }

  // ---------- Preset I/O ----------
  $('btn-preset-reset').addEventListener('click', () => {
    params = PP.defaults();
    PP.save(params);
    sound.setParams(params);
    refreshUI();
  });
  $('btn-preset-export').addEventListener('click', () => {
    $('preset-json').value = JSON.stringify(params, null, 2);
  });
  $('btn-preset-apply').addEventListener('click', () => {
    try {
      const p = JSON.parse($('preset-json').value);
      params = Object.assign(PP.defaults(), p);
      PP.save(params);
      sound.setParams(params);
      refreshUI();
    } catch (e) {
      alert('Invalid JSON: ' + e.message);
    }
  });

  // ---------- Test bench ----------
  let running = false;
  let mode = 'rev';        // 'rev' | 'drive'
  let throttle = 0;        // 0..1 (rev mode)
  let wotHeld = false;

  $('btn-run').addEventListener('click', async () => {
    if (running) {
      sound.stop();
      running = false;
      $('btn-run').textContent = '▶ START ENGINE';
      return;
    }
    try {
      await sound.start();
      sound.fadeIn(0, 0.3); // start() now leaves the master silent
    } catch (err) {
      alert('Could not start audio: ' + err.message);
      return;
    }
    running = true;
    $('btn-run').textContent = '■ STOP ENGINE';
  });

  $('bench-mode').addEventListener('change', (e) => {
    mode = e.target.value;
    engine.setNeutral(mode === 'rev');
    $('row-throttle').classList.toggle('hidden', mode !== 'rev');
    $('row-speed').classList.toggle('hidden', mode !== 'drive');
  });

  $('bench-throttle').addEventListener('input', (e) => {
    throttle = Number(e.target.value) / 100;
    $('out-bench-throttle').textContent = e.target.value + '%';
  });
  $('bench-speed').addEventListener('input', (e) => {
    engine.setTargetSpeed(Number(e.target.value));
    $('out-bench-speed').textContent = e.target.value;
  });

  // Quick actions
  $('btn-blip').addEventListener('click', () => {
    if (mode !== 'rev') return;
    throttle = 1;
    setTimeout(() => { throttle = slider01(); }, 350);
  });
  const holdWot = (on) => {
    wotHeld = on;
    if (!on && mode === 'drive') {
      engine.setTargetSpeed(Number($('bench-speed').value));
    }
  };
  const wotBtn = $('btn-wot');
  wotBtn.addEventListener('pointerdown', (e) => {
    wotBtn.setPointerCapture(e.pointerId);
    holdWot(true);
  });
  wotBtn.addEventListener('pointerup', () => holdWot(false));
  wotBtn.addEventListener('pointercancel', () => holdWot(false));
  $('btn-zero').addEventListener('click', () => {
    if (mode === 'rev') {
      $('bench-throttle').value = '0';
      $('out-bench-throttle').textContent = '0%';
      throttle = 0;
    } else {
      $('bench-speed').value = '0';
      $('out-bench-speed').textContent = '0';
      engine.setTargetSpeed(0);
    }
  });

  function slider01() {
    return Number($('bench-throttle').value) / 100;
  }

  // ---------- Loop ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    if (mode === 'rev') {
      engine.setRevDemand(wotHeld ? 1 : throttle);
    } else if (wotHeld) {
      engine.setTargetSpeed(250);
    }
    engine.update(dt);

    if (running) {
      sound.update(engine.rpm, engine.throttle, engine.cfg.maxRpm,
        params.cylinders, engine.shifting, engine.shiftDir);
    }

    $('bench-rpm').textContent = String(Math.round(engine.rpm / 10) * 10);
    $('bench-load').textContent = String(Math.round(engine.throttle * 100));
    $('bench-gear').textContent = engine.displayGear;
    requestAnimationFrame(loop);
  }

  buildParamsUI();
  requestAnimationFrame(loop);

  // Debug hook
  window.__tuner = { engine, sound, get params() { return params; } };
})();
