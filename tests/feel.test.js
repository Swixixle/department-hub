import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme, feedback, loadFeel, resolvedTheme, saveFeel } from '../src/feel.js';

const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) }; };

test('sound starts off, vibration on, and the theme follows the phone until someone picks one', () => {
  const storage = memory();
  assert.deepEqual(loadFeel(storage), { theme: 'system', sound: false, vibrate: true });
  assert.equal(resolvedTheme({ theme: 'system' }, true), 'dark');
  assert.equal(resolvedTheme({ theme: 'system' }, false), 'light');
  assert.equal(resolvedTheme({ theme: 'light' }, true), 'light', 'a choice beats the phone');
  saveFeel({ theme: 'dark', sound: true, vibrate: false }, storage);
  assert.deepEqual(loadFeel(storage), { theme: 'dark', sound: true, vibrate: false });
  assert.equal(saveFeel({ theme: 'neon' }, storage).theme, 'system', 'an unknown theme falls back to the phone');
});

test('applying a theme marks the page, and follows the phone when left to it', () => {
  const classes = new Set(), root = { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) }, style: {} };
  assert.equal(applyTheme({ theme: 'system' }, root, { matches: true }), 'dark');
  assert.ok(classes.has('dark'));
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(applyTheme({ theme: 'light' }, root, { matches: true }), 'light');
  assert.equal(classes.has('dark'), false);
});

test('feedback vibrates by weight where allowed, and makes no sound unless sound is on', () => {
  const buzzes = [];
  let contexts = 0;
  const saved = { navigator: globalThis.navigator, AudioContext: globalThis.AudioContext };
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate: pattern => buzzes.push(pattern) }, configurable: true });
  globalThis.AudioContext = class { constructor() { contexts += 1; } };
  try {
    feedback('light', { sound: false, vibrate: true });
    feedback('error', { sound: false, vibrate: true });
    feedback('heavy', { sound: false, vibrate: false });
    assert.deepEqual(buzzes, [8, [30, 60, 30]], 'vibration off means none');
    assert.equal(contexts, 0, 'with sound off, no audio is even started');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true });
    globalThis.AudioContext = saved.AudioContext;
  }
});
