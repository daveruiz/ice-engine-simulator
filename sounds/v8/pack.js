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
  name: "V8 (recorded)",

  // Clips extracted from a YouTube V8 recording, origin/rights unclear —
  // not confirmed as the original source. Included for personal/demo use;
  // swap in your own recordings if you need clean provenance.

  // --- One-shot on engine start (set to null to disable) ------------
  // start: { file: 'start.mp3', volume: 1.0 },
  start: null,

  // --- One-shot exhaust pop (overrun crackle, shift bangs) -----------
  // Played with random pitch/level on throttle lift-off at revs, on
  // full-throttle upshifts and on downshifts. Without a file, a
  // synthesized pop is used. Disable entirely with `pops: false` in
  // params below.
  // pop: { file: 'pop.ogg', volume: 1.0 },
  pop: null,

  // --- Idle loop (standstill) ---------------------------------------
  // rpm doubled vs the measured ~69 Hz: the analyzer locked onto the
  // 2nd harmonic, and the clip sounds right one octave lower.
  idle: { file: "idle.ogg", rpm: 850, volume: 0.75 },

  // --- Gas: full throttle (REQUIRED) --------------------------------
  // Measured firing frequency ~180 Hz => ~2700 RPM.
  gasFull: { file: "gas_full.ogg", rpm: 2700, volume: 1.0 },

  // --- Gas: half throttle / cruise (set to null if you have no clip) -
  // Intentionally shares the same recording as gasRelease (one file on
  // disk, two slots pointing at it), a bit louder here.
  gasHalf: { file: "gas_release.ogg", rpm: 2200, volume: 0.95 },

  // --- Gas: released / overrun -------------------------------------
  // oneShot: true => fired ONCE when you lift off the gas (a decel
  // burble), instead of looping. After it plays, the sustained sound
  // settles into gasHalf (coasting/partial) or idle (low revs) on its
  // own. Omit oneShot (or set false) to loop it as a steady overrun bed.
  //   duration: seconds to play of the clip as the one-shot (a long
  //             loop file still works as a short lift burble).
  gasRelease: null,

  // --- Tuning knobs (all optional; delete a line to use the default) -
  params: {
    // Overall loudness of the pack (the in-app Volume slider still applies).
    masterVolume: 1.0,

    // Global pitch scale for every slot: 1.0 = play each clip at its
    // recorded pitch at its reference RPM. Lower = deeper engine sound
    // everywhere (0.7 makes 850 RPM sound like ~600 RPM).
    pitch: 0.7,

    // How much louder the engine gets as revs rise: 0 = same loudness at
    // all RPM, 1.4 = 2.4x louder at the rev limiter than at low RPM.
    revBoost: 1.4,

    // Load thresholds (0..1) for the gas crossfade:
    releaseMaxLoad: 0.2, // below this load only gasRelease is heard
    halfLoad: 0.5, // load where gasHalf is at its strongest
    fullMinLoad: 0.85, // above this load only gasFull is heard

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

    // Exhaust pops:
    pops: true, // false = no pops at all
    popVolume: 0.6, // loudness of each pop
    popChance: 0.7, // 0..1 how likely/dense the overrun crackle is
    popWindow: 1.8, // seconds of crackle after lifting off the gas
  },
};
