import test from 'node:test';
import assert from 'node:assert/strict';
import { addCaption, currentContest, rankedCaptions, reactionState, removeCaption, toggleCaptionLaugh, toggleReaction } from '../src/board.js';

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const posts = [{ id: 'p1', author: 'Avery', body: 'tanks', created: '2026-11-12T03:00:00Z' }, { id: 'p2', author: 'Jordan', contest: true, created: '2026-11-10T03:00:00Z', media: [{ id: 'm', kind: 'image' }] }];

test('a reaction is one tap on and one tap off, per person, and only the two kinds exist', () => {
  let next = toggleReaction(posts, 'p1', 'laugh', 'Morgan', same);
  next = toggleReaction(next, 'p1', 'laugh', 'Avery', same);
  assert.deepEqual(reactionState(next[0], 'laugh', 'avery', same), { count: 2, mine: true });
  next = toggleReaction(next, 'p1', 'laugh', 'AVERY', same);
  assert.deepEqual(reactionState(next[0], 'laugh', 'Avery', same), { count: 1, mine: false });
  assert.deepEqual(reactionState(next[0], 'thanks', 'Avery', same), { count: 0, mine: false });
  assert.throws(() => toggleReaction(posts, 'p1', 'angry', 'Avery'), /unknown reaction/);
  assert.equal(posts[0].reactions, undefined, 'the original list is not changed');
  assert.deepEqual(reactionState({ reactions: { laugh: { count: 4, mine: true } } }, 'laugh', 'x'), { count: 4, mine: true }, 'the server\'s shape reads the same');
});

test('captions: words required and short, the funniest leads once anyone laughs, ties go to the first', () => {
  let next = addCaption(posts, 'p2', { id: 'c1', author: 'Avery', text: '  me at 0300  ', created: '2026-11-10T04:00:00Z' });
  next = addCaption(next, 'p2', { id: 'c2', author: 'Morgan', text: 'when RT is paged to every code', created: '2026-11-10T05:00:00Z' });
  assert.equal(next[1].captions[0].text, 'me at 0300');
  assert.throws(() => addCaption(next, 'p2', { id: 'c3', author: 'x', text: '   ' }), /needs words/);
  assert.throws(() => addCaption(next, 'p2', { id: 'c3', author: 'x', text: 'a'.repeat(141) }), /at most 140/);
  assert.deepEqual(rankedCaptions(next[1], 'Avery', same).map(caption => [caption.id, caption.leading]), [['c1', false], ['c2', false]], 'nobody leads with no laughs');
  next = toggleCaptionLaugh(next, 'p2', 'c2', 'Avery', same);
  assert.deepEqual(rankedCaptions(next[1], 'Avery', same).map(caption => [caption.id, caption.leading, caption.laugh.mine]), [['c2', true, true], ['c1', false, false]]);
  next = removeCaption(next, 'p2', 'c2');
  assert.deepEqual(next[1].captions.map(caption => caption.id), ['c1']);
});

test('the contest at the top is the newest caption post from the last seven days', () => {
  assert.equal(currentContest(posts, new Date('2026-11-12T12:00:00Z'))?.id, 'p2');
  assert.equal(currentContest(posts, new Date('2026-11-20T12:00:00Z')), null, 'a contest older than a week drops off the top');
});
