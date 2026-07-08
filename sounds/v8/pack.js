/**
 * ============================================================
 *  ENGINE SOUND PACK — edit this file to change all the sounds
 * ============================================================
 *
 * Put your audio files in this same folder (sounds/v8/) and point the
 * slots below at them. Reload the page after editing. Any format the
 * browser can decode works: .mp3, .ogg, .wav, .m4a ...
 *
 * THE SLOTS (what plays when):
 *
 *   start       One-shot played once when the engine starts. Optional.
 *   idle        Loop heard at standstill / engine idling. Optional.
 *   gasFull     Loop for FULL throttle.  >>> REQUIRED <<<
 *   gasHalf     Loop for PARTIAL throttle / relaxed cruising. Optional.
 *   gasRelease  Loop for throttle RELEASED (coasting / engine braking,
 *               the burbly overrun sound). Optional.
 *
 * The app crossfades gasRelease -> gasHalf -> gasFull as the engine
 * load rises (thresholds tunable in `params` below). Missing optional
 * slots are handled gracefully:
 *   - no gasHalf:    blends straight from gasRelease to gasFull
 *   - no gasRelease: gasFull/gasHalf get quieter + muffled off-throttle
 *   - no idle:       the gas sounds keep playing down to idle RPM
 *
 * EACH LOOP SLOT HAS:
 *   file    Sound file name in this folder.
 *   rpm     The engine RPM the recording was made at. This is the pitch
 *           reference: playback speed = current RPM / this value, so if
 *           the pitch sounds wrong, tweak this number (higher = the app
 *           plays the file slower / lower-pitched at a given RPM).
 *   volume  Relative level of this slot, 1.0 = neutral. Levels are
 *           auto-normalized across files first, so use this for taste,
 *           not to fix loudness mismatches between recordings.
 *
 * LOOPS: clips should hold a steady RPM (no revving up/down). Loop
 * seams and level differences are cleaned up automatically at load.
 */
window.ENGINE_SOUND_PACK = {

  // Shown in Settings so you know which pack loaded.
  name: 'V8 (recorded)',

  // --- One-shot on engine start (set to null to disable) ------------
  // start: { file: 'start.mp3', volume: 1.0 },
  start: null,

  // --- Idle loop (standstill) ---------------------------------------
  // Steady segment cut from the long idle recording (~73 Hz firing
  // frequency measured => ~1100 RPM on a V8).
  idle: { file: 'idle.wav', rpm: 1100, volume: 0.75 },

  // --- Gas: full throttle (REQUIRED) --------------------------------
  // Measured firing frequency ~180 Hz => ~2700 RPM.
  gasFull: { file: 'gas_full.ogg', rpm: 2700, volume: 1.0 },

  // --- Gas: half throttle / cruise (set to null if you have no clip) -
  // Reusing the full-throttle clip a bit quieter until a dedicated
  // partial-throttle recording exists.
  gasHalf: { file: 'gas_full.ogg', rpm: 2700, volume: 0.8 },

  // --- Gas: released / overrun (set to null if you have no clip) ----
  // A different steady segment of the idle recording, so coasting
  // doesn't sound identical to standstill.
  gasRelease: { file: 'gas_release.wav', rpm: 1100, volume: 0.85 },

  // --- Tuning knobs (all optional; delete a line to use the default) -
  params: {
    // Overall loudness of the pack (the in-app Volume slider still applies).
    masterVolume: 1.0,

    // How much louder the engine gets as revs rise: 0 = same loudness at
    // all RPM, 1.4 = 2.4x louder at the rev limiter than at low RPM.
    revBoost: 1.4,

    // Load thresholds (0..1) for the gas crossfade:
    releaseMaxLoad: 0.2,  // below this load only gasRelease is heard
    halfLoad: 0.5,        // load where gasHalf is at its strongest
    fullMinLoad: 0.85,    // above this load only gasFull is heard

    // Idle crossover (RPM): full idle sound below Start, none above End.
    idleFadeStartRpm: 900,
    idleFadeEndRpm: 1300,

    // Pitch-shift limits (playback speed multipliers). Widen if your
    // clips must stretch further; extreme values sound unnatural.
    minPitch: 0.25,
    maxPitch: 4.0,

    // Off-throttle muffling filter on gasFull/gasHalf (Hz):
    // cutoff = filterMinHz + load*filterLoadHz + revs*filterRpmHz
    filterMinHz: 260,
    filterLoadHz: 4200,
    filterRpmHz: 2200,
  },
};
