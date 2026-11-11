import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, fileSize, linkParts, matchesFilter, mediaKind, refuseFiles, shareText, videoLink } from '../src/board.js';

test('a file is a picture, a video, a recording or a download', () => {
  assert.deepEqual([mediaKind('image/jpeg'), mediaKind('image/svg+xml'), mediaKind('video/quicktime'), mediaKind('', 'clip.MOV'), mediaKind('audio/mp4'), mediaKind('application/pdf', 'policy.pdf')],
    ['image', 'file', 'video', 'video', 'audio', 'file']);
  assert.deepEqual([fileSize(900), fileSize(2048), fileSize(5.5 * 1024 * 1024), fileSize(3 * 1024 ** 3)], ['900 B', '2.0 KB', '5.5 MB', '3.0 GB']);
  assert.deepEqual([clock(0), clock(42.7), clock(185)], ['0:00', '0:42', '3:05']);
});

test('YouTube and Vimeo links are recognised in their usual forms, and nothing else is', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of ['https://www.youtube.com/watch?v=' + id + '&t=30s', 'https://youtu.be/' + id + '?si=abc', 'https://m.youtube.com/shorts/' + id, 'Watch this: https://youtube.com/live/' + id + '.'])
    assert.deepEqual([videoLink(url).site, videoLink(url).id], ['YouTube', id], url);
  assert.equal(videoLink('https://youtu.be/' + id).embed, 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1');
  assert.deepEqual([videoLink('see https://vimeo.com/123456789 tonight').site, videoLink('https://vimeo.com/channels/staff/123456789').id], ['Vimeo', '123456789']);
  for (const text of ['no link here', 'https://example.com/watch?v=' + id, 'https://youtube.com/@channel', 'https://youtube.com.evil.example/watch?v=' + id, 'https://youtu.be/<script>'])
    assert.equal(videoLink(text), null, text);
});

test('links in a post are found without swallowing the punctuation after them', () => {
  assert.deepEqual(linkParts('Read https://example.com/a?b=1, then call.'), [{ text: 'Read ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' }, { text: ', then call.' }]);
  assert.deepEqual(linkParts('plain words'), [{ text: 'plain words' }]);
  assert.deepEqual(linkParts('javascript:alert(1) stays text'), [{ text: 'javascript:alert(1) stays text' }]);
});

test('the board filters sort posts by what they carry', () => {
  const posts = {
    words: { body: 'hello' }, lesson: { body: 'vent modes', learning: true, media: [{ kind: 'video' }] }, voice: { voice: true, media: [{ kind: 'audio' }] },
    photo: { media: [{ kind: 'image' }] }, pdf: { media: [{ kind: 'file' }] }, song: { media: [{ kind: 'audio' }] }, tube: { body: 'https://youtu.be/dQw4w9WgXcQ' }
  };
  const names = filter => Object.keys(posts).filter(name => matchesFilter(posts[name], filter));
  assert.deepEqual(names('all').length, 7);
  assert.deepEqual(names('learning'), ['lesson']);
  assert.deepEqual(names('voice'), ['voice']);
  assert.deepEqual(names('media'), ['lesson', 'photo', 'tube']);
  assert.deepEqual(names('files'), ['pdf', 'song']);
});

test('shared words name the author, and oversized or empty files are refused with the reason', () => {
  assert.equal(shareText({ author: 'Avery', body: 'New filters are in.', created: '2026-11-11T12:00:00Z' }), 'Avery, Nov 11: New filters are in.');
  assert.equal(shareText({ author: 'Avery', voice: true, media: [{ seconds: 42 }] }), 'Avery: Voice message (0:42)');
  const file = (name, size) => ({ name, size });
  assert.equal(refuseFiles([file('a.jpg', 10)]), '');
  assert.match(refuseFiles([file('long.mov', 2048)], 1024), /long\.mov is 2\.0 KB\. One file can be up to 1\.0 KB\./);
  assert.match(refuseFiles([file('a', 0)]), /empty/);
  assert.match(refuseFiles(Array.from({ length: 11 }, () => file('a', 1))), /up to 10/);
});
