/**
 * ============================================
 *  ENGINE LIBRARY — register sample packs here
 * ============================================
 *
 * Every entry appears in Settings → Sound → Engine, next to the
 * built-in "Synthesized" engine (which is always available).
 *
 * To add an engine:
 *   1. Create a folder inside sounds/ (e.g. sounds/i6-diesel/)
 *   2. Put the audio files and a pack.js in it — copy sounds/v8/pack.js
 *      as a template; every slot and parameter is documented there.
 *   3. Add a line below.
 *
 * Fields:
 *   id    Unique key, saved in the user's settings. Don't reuse 'synth'.
 *   name  Label shown in the Settings dropdown.
 *   dir   Folder name inside sounds/ containing the pack.js.
 *
 * Packs are only downloaded when selected, so a long list costs nothing.
 */
window.ENGINE_SOUND_LIBRARY = [
  { id: 'v8', name: 'V8 (recorded)', dir: 'v8' },
  // { id: 'i4-turbo', name: 'Inline-4 turbo', dir: 'i4-turbo' },
];
