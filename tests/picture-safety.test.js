import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSize, isPicture, judgePictureText, outputOf, preparePictures } from '../src/picture-safety.js';
import { patientFindings } from '../src/guard.js';

test('which files count as pictures, and what each is saved as once its hidden details are gone', () => {
  assert.equal(isPicture({ type: 'image/jpeg', name: 'a.jpg' }), true);
  assert.equal(isPicture({ type: '', name: 'IMG_0001.HEIC' }), true, 'a phone photo with no type still counts');
  assert.equal(isPicture({ type: 'video/mp4', name: 'clip.mp4' }), false);
  assert.equal(isPicture({ type: 'application/pdf', name: 'policy.pdf' }), false);
  assert.deepEqual(outputOf({ type: 'image/heic', name: 'IMG_0001.HEIC' }), { type: 'image/jpeg', name: 'IMG_0001.jpg', quality: 0.88 });
  assert.deepEqual(outputOf({ type: 'image/png', name: 'meme.png' }), { type: 'image/png', name: 'meme.png' }, 'a screenshot stays PNG so its words stay sharp');
  assert.deepEqual(outputOf({ type: 'image/gif', name: 'dance.gif' }), { keep: true }, 'a GIF keeps its animation');
  assert.deepEqual(drawSize(4032, 3024), { width: 2400, height: 1800 });
  assert.deepEqual(drawSize(800, 600), { width: 800, height: 600 }, 'a small picture is not enlarged');
});

test('words read from a picture go through the same patient-detail screen as typed words', () => {
  const stopped = judgePictureText([{ name: 'band.jpg', text: 'DOE, JANE\nMRN 00482913\nDOB 03/14/1961' }, { name: 'meme.png', text: 'when the compressor alarms at 3am' }], patientFindings);
  assert.equal(stopped.ok, false);
  assert.deepEqual(stopped.found.map(entry => entry.name), ['band.jpg']);
  assert.ok(stopped.found[0].findings.some(item => /record/.test(item.sign)), stopped.found[0].findings.map(item => item.sign).join('; '));
  assert.equal(judgePictureText([{ name: 'tanks.jpg', text: 'WHERE ARE ALL THE TRANSPORT TANKS' }], patientFindings).ok, true, 'ordinary words pass');
  assert.equal(judgePictureText([{ name: 'blank.jpg', text: '' }], patientFindings).ok, true);
});

test('a post with no pictures is not read at all, and other files pass through untouched', async () => {
  const pdf = { type: 'application/pdf', name: 'policy.pdf' };
  let read = 0;
  const result = await preparePictures([pdf], { read: async () => { read += 1; return []; }, screen: patientFindings });
  assert.deepEqual([result.files, result.pictures, result.check.ok, read], [[pdf], 0, true, 0]);
});
