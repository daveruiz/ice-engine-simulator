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
  name: 'V8 (AI generated)',

  // --- One-shot on engine start (set to null to disable) ------------
  // start: { file: 'start.mp3', volume: 1.0 },
  start: null,

  // --- Idle loop (standstill) ---------------------------------------
  idle: { file: 'idle.mp3', rpm: 750, volume: 0.75 },

  // --- Gas: full throttle (REQUIRED) --------------------------------
  gasFull: { file: 'on_1900.mp3', rpm: 1900, volume: 1.0 },

  // --- Gas: half throttle / cruise (set to null if you have no clip) -
  // gasHalf: { file: 'half_2500.mp3', rpm: 2500, volume: 1.0 },
  gasHalf: null,

  // --- Gas: released / overrun (set to null if you have no clip) ----
  // gasRelease: { file: 'release_2000.mp3', rpm: 2000, volume: 0.9 },
  gasRelease: null,

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
