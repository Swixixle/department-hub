// How the app feels under a finger: the theme (light, dark, or whatever the phone is set to), a short vibration on
// phones that allow it, and soft synthesized sounds for people who turn them on.
//
// Sounds are off until a person turns them on. These phones sit in pockets on quiet units at night, near people who
// are asleep. Vibration is on, but only Android browsers allow a page to vibrate; iPhone Safari does not, so on an
// iPhone this part does nothing and nothing breaks. The tones are made here with the Web Audio API, so there are no
// sound files to download and nothing to wait for.

const KEY = 'department-hub-feel';
const DEFAULTS = { theme: 'system', palette: 'green', sound: false, vibrate: true };
export const THEMES = [['system', 'Same as the phone'], ['light', 'Light'], ['dark', 'Dark']];
// Colors each person can pick for themselves. Green is the department's own and the default.
export const PALETTES = [['green', 'Green'], ['warm', 'Warm charcoal']];

export function loadFeel(storage = globalThis.localStorage) {
  try { return { ...DEFAULTS, ...JSON.parse(storage?.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveFeel(feel, storage = globalThis.localStorage) {
  const clean = { theme: THEMES.some(([id]) => id === feel.theme) ? feel.theme : 'system', palette: PALETTES.some(([id]) => id === feel.palette) ? feel.palette : 'green',
    sound: Boolean(feel.sound), vibrate: feel.vibrate !== false };
  try { storage?.setItem(KEY, JSON.stringify(clean)); } catch { /* a private window keeps it for this visit */ }
  return clean;
}

// The theme actually shown: the person's choice, or the phone's when they left it to the phone.
export const resolvedTheme = (feel, prefersDark) => feel.theme === 'system' ? (prefersDark ? 'dark' : 'light') : feel.theme;

export function applyTheme(feel, root = globalThis.document?.documentElement, media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')) {
  if (!root) return 'light';
  const theme = resolvedTheme(feel, Boolean(media?.matches));
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('warm', feel.palette === 'warm');
  root.style.colorScheme = theme;
  const meta = globalThis.document?.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', feel.palette === 'warm' ? (theme === 'dark' ? '#171719' : '#2a2622') : theme === 'dark' ? '#0d1714' : '#133b34');
  return theme;
}

// The weight of an action decides the feedback: light for a reaction, firm for sending a post, a double pulse when
// something is refused.
const PATTERNS = { light: 8, medium: 14, heavy: [18, 40, 18], error: [30, 60, 30] };
let audio = null;
function tone(context, { from, to = from, length = 0.06, volume = 0.05, type = 'sine', at = 0 }) {
  const start = context.currentTime + at, oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}
const SOUNDS = {
  light: context => tone(context, { from: 880, to: 1320, length: 0.05, volume: 0.035 }),
  medium: context => tone(context, { from: 420, to: 380, length: 0.07, volume: 0.04, type: 'triangle' }),
  heavy: context => { tone(context, { from: 160, to: 90, length: 0.12, volume: 0.07 }); tone(context, { from: 640, to: 600, length: 0.05, volume: 0.025, at: 0.02 }); },
  error: context => { tone(context, { from: 330, length: 0.09, volume: 0.045, type: 'triangle' }); tone(context, { from: 247, length: 0.12, volume: 0.045, type: 'triangle', at: 0.12 }); }
};

export function feedback(kind, feel) {
  if (feel.vibrate !== false) { try { globalThis.navigator?.vibrate?.(PATTERNS[kind] ?? PATTERNS.light); } catch { /* not allowed here */ } }
  if (feel.sound && SOUNDS[kind]) {
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return;
      audio = audio || new Context();
      if (audio.state === 'suspended') void audio.resume();
      SOUNDS[kind](audio);
    } catch { /* sound is a nicety; never let it get in the way */ }
  }
}
