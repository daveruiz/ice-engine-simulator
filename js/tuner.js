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
  const Presets = window.EnginePresets;
  const $ = (id) => document.getElementById(id);

  let params = PP.load();
  const sound = new PhysicalEngineSound();
  sound.setParams(params);

  // The bench runs the simulator's drivetrain (rev range, idle, gearbox)
  // so a 19,000 rpm F1 preset actually revs to 19,000 here too.
  const ENGINE_CFG_KEYS = Presets.ENGINE_KEYS;
  function benchConfig() {
    const st = Presets.readSettings();
    const cfg = {};
    for (const k of ENGINE_CFG_KEYS) if (typeof st[k] === 'number') cfg[k] = st[k];
    if (cfg.shiftUpRpm && cfg.maxRpm) {
      cfg.shiftUpRpm = Math.min(cfg.shiftUpRpm, cfg.maxRpm - 200);
    }
    return cfg;
  }
  const engine = new EngineSim(benchConfig());
  engine.setNeutral(true);
  sound.setListener(Presets.readSettings().listener || 'cabin');

  function syncBenchToSettings() {
    engine.configure(benchConfig());
    const sp = $('bench-speed');
    sp.max = String(Math.round(engine.cfg.maxSpeed));
    const st = Presets.readSettings();
    sound.setCompression((st.compressor ?? 50) / 100);
    sound.setSpatial(st.spatial || 'off');
    $('bench-spatial').value = sound.spatialMode;
    const lis = PP.listener(st.listener || 'cabin').id;
    sound.setListener(lis);
    $('bench-listener').value = lis;
    if (lisBox) renderLis();
  }

  // ---------- Parameter UI (generated from the schema) ----------
  const inputs = {}; // key -> {input, output, fmt}

  function fmtValue(s, v) {
    if (s.type === 'select' || s.type === 'bool') return '';
    const digits = s.step >= 1 ? 0 : (s.step >= 0.05 ? 2 : 3);
    const num = Number(v).toLocaleString('en-US',
      { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return num + (s.unit ? ' ' + s.unit : '');
  }

  /** Fill a range track up to its thumb (CSS reads --p). */
  function paintRange(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const p = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--p', Math.max(0, Math.min(100, p)) + '%');
  }
  document.addEventListener('input', (e) => {
    if (e.target.type === 'range') paintRange(e.target);
  });

  function buildParamsUI() {
    const root = $('tuner-params');
    root.innerHTML = '';
    for (const g of PP.GROUPS) {
      const sec = document.createElement('section');
      sec.className = 'pgroup';
      const h = document.createElement('h3');
      h.textContent = g.name;
      sec.appendChild(h);
      for (const s of PP.SCHEMA) {
        if (s.group !== g.id) continue;
        sec.appendChild(buildRow(s));
      }
      root.appendChild(sec);
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
    if (typeof updateEff === 'function') updateEff();
  }

  /** Push `params` back into every control (after reset/import). */
  function refreshUI() {
    for (const key of Object.keys(inputs)) {
      const { input, output, schema } = inputs[key];
      if (schema.type === 'bool') input.checked = !!params[key];
      else input.value = params[key];
      if (input.type === 'range') paintRange(input);
      output.textContent = fmtValue(schema, params[key]);
    }
    if (typeof renderLis === 'function') renderLis();
  }

  // ---------- Engine presets ----------
  const presetSel = $('preset-select');
  Presets.fillSelect(presetSel);
  presetSel.value = Presets.readSettings().preset || Presets.DEFAULT_ID;
  const showPresetDesc = () => {
    const p = Presets.get(presetSel.value);
    $('preset-desc').textContent = p ? p.desc : '';
  };
  presetSel.addEventListener('change', showPresetDesc);
  showPresetDesc();
  $('btn-preset-load').addEventListener('click', () => {
    const p = Presets.get(presetSel.value);
    if (!p) return;
    params = Presets.physicalParams(p.id);
    PP.save(params);
    sound.setParams(params);
    refreshUI();
    // The simulator gets the matching drivetrain (live if it's open)
    Presets.patchSettings(Object.assign({}, p.engine,
      { preset: p.id, soundSet: 'physical' }));
    syncBenchToSettings();
  });

  // Listening position (shared with the simulator's setting)
  const lisSel = $('bench-listener');
  for (const L of PP.LISTENERS) {
    const o = document.createElement('option');
    o.value = L.id;
    o.textContent = L.name;
    lisSel.appendChild(o);
  }
  lisSel.addEventListener('change', () => {
    sound.setListener(lisSel.value);
    Presets.patchSettings({ listener: lisSel.value });
  });
  $('bench-spatial').addEventListener('change', (e) => {
    sound.setSpatial(e.target.value);
    Presets.patchSettings({ spatial: e.target.value });
  });

  // Simulator settings changed in another tab: follow them
  window.addEventListener('storage', (e) => {
    if (e.key === Presets.SETTINGS_KEY) syncBenchToSettings();
  });

  // ---------- Preset I/O ----------
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
  let ignition = null;     // IgnitionSequence while the engine is starting

  function crank() {
    ignition = new IgnitionSequence({
      idleRpm: engine.cfg.idleRpm,
      crankRpm: params.crankRpm,
      crankTime: params.crankTime,
    });
  }

  $('btn-run').addEventListener('click', async () => {
    if (running) {
      sound.stop();
      running = false;
      ignition = null;
      $('btn-run').textContent = '▶ START ENGINE';
      return;
    }
    try {
      await sound.start();
      sound.fadeIn(0, 0.03); // start() leaves the master silent
      crank(); // the synthesized starter brings the engine to life
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
  $('btn-crank').addEventListener('click', async () => {
    if (!running) { $('btn-run').click(); return; }
    // Key off for a moment, then crank again: restart the audio graph so
    // the model starts from rest
    sound.stop();
    await new Promise((r) => setTimeout(r, 350));
    await sound.start();
    sound.fadeIn(0, 0.03);
    crank();
  });
  $('btn-zero').addEventListener('click', () => {
    if (mode === 'rev') {
      $('bench-throttle').value = '0';
      paintRange($('bench-throttle'));
      $('out-bench-throttle').textContent = '0%';
      throttle = 0;
    } else {
      $('bench-speed').value = '0';
      paintRange($('bench-speed'));
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
      engine.setTargetSpeed(engine.cfg.maxSpeed);
    }
    engine.update(dt);

    let rpm = engine.rpm, load = engine.throttle;
    if (running && ignition) {
      const st = ignition.update(dt);
      rpm = st.rpm; load = st.load;
      sound.update(rpm, load, engine.cfg.maxRpm, params.cylinders, false, 0, st);
      if (st.done) ignition = null;
    } else if (running) {
      sound.update(engine.rpm, engine.throttle, engine.cfg.maxRpm,
        params.cylinders, engine.shifting, engine.shiftDir);
    }

    $('bench-rpm').textContent = String(Math.round(rpm / 10) * 10);
    $('bench-load').textContent = String(Math.round(load * 100));
    $('bench-gear').textContent = engine.displayGear;
    requestAnimationFrame(loop);
  }

  // ---------- Mixer: solo / mute every sound, live level meters ----------
  const SOURCES = PhysicalEngineSound.SOURCES;
  const solo = new Set(), mute = new Set();
  const meterEls = [];
  const meterDb = SOURCES.map(() => -90);
  (function buildMixer() {
    const box = $('mixer-rows');
    SOURCES.forEach((src, k) => {
      const row = document.createElement('div');
      row.className = 'mix-row';
      row.title = src.info;
      row.innerHTML = '<span class="mix-name"></span>' +
        '<span class="mix-meter"><span class="mix-fill"></span></span>' +
        '<output class="mix-db">—</output>' +
        '<button class="mix-btn solo" aria-pressed="false" title="Solo">S</button>' +
        '<button class="mix-btn mute" aria-pressed="false" title="Mute">M</button>';
      row.querySelector('.mix-name').textContent = src.name;
      row.querySelector('.solo').addEventListener('click', () => {
        solo.has(src.id) ? solo.delete(src.id) : solo.add(src.id); applyMix();
      });
      row.querySelector('.mute').addEventListener('click', () => {
        mute.has(src.id) ? mute.delete(src.id) : mute.add(src.id); applyMix();
      });
      box.appendChild(row);
      meterEls[k] = { row, fill: row.querySelector('.mix-fill'), db: row.querySelector('.mix-db') };
    });
  })();
  function applyMix() {
    const any = solo.size > 0;
    const gains = SOURCES.map((s) => (any ? (solo.has(s.id) ? 1 : 0) : (mute.has(s.id) ? 0 : 1)));
    sound.setMix(gains, true);
    SOURCES.forEach((s, k) => {
      const r = meterEls[k].row;
      r.querySelector('.solo').setAttribute('aria-pressed', solo.has(s.id));
      r.querySelector('.mute').setAttribute('aria-pressed', mute.has(s.id));
      r.classList.toggle('silenced', gains[k] === 0);
    });
  }
  $('btn-mix-reset').addEventListener('click', () => { solo.clear(); mute.clear(); applyMix(); });
  sound.onMeters = (rms) => {
    rms.forEach((v, k) => {
      const db = 20 * Math.log10(v + 1e-9);
      // fast attack, slow release, like a mixing-desk meter
      meterDb[k] = db > meterDb[k] ? db : meterDb[k] - 2.5;
      const d = meterDb[k];
      const pct = Math.max(0, Math.min(100, ((d + 60) / 54) * 100));
      meterEls[k].fill.style.width = pct + '%';
      meterEls[k].db.textContent = d < -60 ? '—' : Math.round(d) + ' dB';
    });
  };
  applyMix();

  // ---------- Listening-position editor ----------
  const OPS = [['mul', '×'], ['add', '+'], ['set', '=']];
  var lisBox = $('lis-editor');
  let effSpans = [];
  function schemaOf(key) { return PP.SCHEMA.find((s) => s.key === key); }
  function fmtAny(s, v) {
    if (s.type === 'select') { const o = s.options.find((x) => x[0] === v); return o ? o[1].split(' (')[0] : String(v); }
    if (s.type === 'bool') return v ? 'on' : 'off';
    return fmtValue(s, v);
  }
  function opOf(m) { return m.set !== undefined ? 'set' : (m.add !== undefined ? 'add' : 'mul'); }
  function valOf(m) { const o = opOf(m); return o === 'set' ? m.set : (o === 'add' ? m.add : m.mul); }

  function updateEff() {
    const eff = PP.applyListener(params, lisSel.value);
    for (const { key, span } of effSpans) {
      const s = schemaOf(key);
      span.textContent = fmtAny(s, params[key]) + ' → ' + fmtAny(s, eff[key]);
    }
  }

  function commitLis(mods, space) {
    PP.saveListener(lisSel.value, { mods, space });
    sound.refreshListener();
    renderLis();
  }

  function renderLis() {
    const L = PP.listener(lisSel.value);
    const mods = JSON.parse(JSON.stringify(L.mods || {}));
    const space = L.space ? JSON.parse(JSON.stringify(L.space)) : null;
    effSpans = [];
    lisBox.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = 'Listening position · ' + L.name + (L.custom ? ' (edited)' : '');
    lisBox.appendChild(h);
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Modifiers layered on top of any engine: × multiplies, + adds, = sets a ' +
      'parameter. Each row shows the engine value → what the listener gets. Edits apply ' +
      'live, are saved and the simulator uses them too. Switch the position under the test bench.';
    lisBox.appendChild(p);

    const list = document.createElement('div');
    list.className = 'lis-list';
    const keys = PP.SCHEMA.map((s) => s.key).filter((k) => k in mods);
    if (!keys.length) {
      const e = document.createElement('p');
      e.className = 'hint';
      e.textContent = 'No modifiers: the raw engine model.';
      list.appendChild(e);
    }
    for (const key of keys) {
      const s = schemaOf(key);
      const m = mods[key];
      const row = document.createElement('div');
      row.className = 'lis-row';
      const name = document.createElement('span');
      name.className = 'lis-name';
      name.textContent = s.label;
      name.title = s.info || '';
      const op = document.createElement('select');
      op.className = 'lis-op';
      const choice = s.type === 'select' || s.type === 'bool' ? [['set', '=']] : OPS;
      for (const [v, t] of choice) {
        const o = document.createElement('option'); o.value = v; o.textContent = t; op.appendChild(o);
      }
      op.value = opOf(m);
      let val;
      if (s.type === 'select' || s.type === 'bool') {
        val = document.createElement('select');
        const opts = s.type === 'bool' ? [[1, 'on'], [0, 'off']] : s.options;
        for (const [v, t] of opts) {
          const o = document.createElement('option'); o.value = v; o.textContent = t; val.appendChild(o);
        }
        val.value = m.set;
      } else {
        val = document.createElement('input');
        val.type = 'number';
        val.step = 'any';
        val.value = valOf(m);
      }
      val.className = 'lis-val';
      const eff = document.createElement('span');
      eff.className = 'lis-eff';
      effSpans.push({ key, span: eff });
      const del = document.createElement('button');
      del.className = 'lis-del';
      del.textContent = '✕';
      del.title = 'Remove this modifier';
      const write = () => {
        let v = val.value;
        if (s.type === 'bool') v = Number(v);
        else if (s.type !== 'select') v = Number(v);
        if (s.type !== 'select' && !isFinite(v)) return;
        mods[key] = { [op.value]: v };
        PP.saveListener(lisSel.value, { mods, space });
        sound.refreshListener();
        updateEff();
        h.textContent = 'Listening position · ' + L.name + ' (edited)';
        resetBtn.classList.remove('hidden');
      };
      op.addEventListener('change', () => {
        // sensible starting value for the new operation
        if (s.type !== 'select' && s.type !== 'bool') {
          val.value = op.value === 'mul' ? 1 : op.value === 'add' ? 0 : params[key];
        }
        write();
      });
      val.addEventListener(val.tagName === 'SELECT' ? 'change' : 'input', write);
      del.addEventListener('click', () => { delete mods[key]; commitLis(mods, space); });
      row.append(name, op, val, eff, del);
      list.appendChild(row);
    }
    lisBox.appendChild(list);

    // add a modifier for any other parameter
    const add = document.createElement('div');
    add.className = 'lis-add';
    const pick = document.createElement('select');
    pick.id = 'lis-add-param';
    for (const g of PP.GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g.name;
      for (const s of PP.SCHEMA) {
        if (s.group !== g.id || s.key in mods) continue;
        const o = document.createElement('option'); o.value = s.key; o.textContent = s.label; og.appendChild(o);
      }
      if (og.children.length) pick.appendChild(og);
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'quick';
    addBtn.textContent = 'ADD MODIFIER';
    addBtn.addEventListener('click', () => {
      const s = schemaOf(pick.value);
      if (!s) return;
      mods[s.key] = s.type === 'select' || s.type === 'bool' ? { set: params[s.key] } : { mul: 1 };
      commitLis(mods, space);
    });
    add.append(pick, addBtn);
    lisBox.appendChild(add);

    // acoustic space (global path to the ear)
    if (space) {
      const sh = document.createElement('h4');
      sh.textContent = 'Acoustic space (whole mix)';
      lisBox.appendChild(sh);
      const grid = document.createElement('div');
      grid.className = 'lis-space';
      for (const [k, label, unit, min, max, step] of PP.SPACE_FIELDS) {
        if (space[k] === undefined) continue;
        const r = document.createElement('label');
        r.className = 'lis-sf';
        r.textContent = label + (unit ? ' (' + unit + ')' : '');
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = min; inp.max = max; inp.step = step; inp.value = space[k];
        inp.addEventListener('input', () => {
          const v = Number(inp.value);
          if (!isFinite(v)) return;
          space[k] = Math.max(min, Math.min(max, v));
          PP.saveListener(lisSel.value, { mods, space });
          sound.refreshListener();
          resetBtn.classList.remove('hidden');
        });
        r.appendChild(inp);
        grid.appendChild(r);
      }
      lisBox.appendChild(grid);
    }

    const resetBtn = document.createElement('button');
    resetBtn.className = 'quick' + (L.custom ? '' : ' hidden');
    resetBtn.textContent = 'RESET ' + L.short + ' TO DEFAULTS';
    resetBtn.addEventListener('click', () => {
      PP.resetListener(lisSel.value);
      sound.refreshListener();
      renderLis();
    });
    const rb = document.createElement('div');
    rb.className = 'quick-buttons lis-reset';
    rb.appendChild(resetBtn);
    lisBox.appendChild(rb);
    updateEff();
  }
  lisSel.addEventListener('change', renderLis);
  window.addEventListener('storage', (e) => {
    if (e.key === PP.LISTENER_KEY) { PP.loadListeners(); sound.refreshListener(); renderLis(); }
  });

  buildParamsUI();
  refreshUI();
  document.querySelectorAll('#bench input[type="range"]').forEach(paintRange);
  syncBenchToSettings();
  requestAnimationFrame(loop);

  // Debug hook
  window.__tuner = { engine, sound, get params() { return params; } };
})();
