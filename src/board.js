// What a board post can carry, and how it is described. Nothing here touches the browser, so it can be tested directly.

export const FILE_LIMIT = 1024 * 1024 * 1024;        // one file, in this browser
export const VOICE_LIMIT_SECONDS = 180;

// Picture, video, audio, or just a file to download.
export function mediaKind(type = '', name = '') {
  const kind = type.split('/')[0];
  if (kind === 'image' && !/svg/.test(type)) return 'image';
  if (kind === 'video' || /\.(mp4|mov|m4v|webm)$/i.test(name)) return 'video';
  if (kind === 'audio' || /\.(mp3|m4a|wav|ogg)$/i.test(name)) return 'audio';
  return 'file';
}

export function fileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return (value >= 100 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[unit];
}

export const clock = seconds => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');

// The first YouTube or Vimeo link in a post, as something a player can load.
export function videoLink(text = '') {
  for (const raw of text.match(/https?:\/\/[^\s<>"']+/g) || []) {
    let url;
    try { url = new URL(raw.replace(/[).,!?]+$/, '')); } catch { continue; }
    const host = url.hostname.replace(/^(www\.|m\.)/, '');
    const id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0] :
      host === 'youtube.com' || host === 'youtube-nocookie.com' ? (url.pathname === '/watch' ? url.searchParams.get('v') : (url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/) || [])[1]) : null;
    if (id && /^[\w-]{6,20}$/.test(id)) return { site: 'YouTube', id, url: url.href, embed: 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1' };
    const vimeo = host === 'vimeo.com' || host === 'player.vimeo.com' ? (url.pathname.match(/(\d{6,12})/) || [])[1] : null;
    if (vimeo) return { site: 'Vimeo', id: vimeo, url: url.href, embed: 'https://player.vimeo.com/video/' + vimeo + '?autoplay=1' };
  }
  return null;
}

// Links in a post, so they can be made clickable. Returns [{ text }, { text, href }, ...] in order.
export function linkParts(text = '') {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const href = match[0].replace(/[).,!?]+$/, '');
    try { new URL(href); } catch { continue; }
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: href, href });
    last = match.index + href.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export const FILTERS = [['all', 'All'], ['dated', 'Dates'], ['learning', 'Learning'], ['voice', 'Voice'], ['media', 'Photos and video'], ['files', 'Files']];
export function matchesFilter(post, filter) {
  const media = post.media || [];
  if (filter === 'dated') return Boolean(post.when);
  if (filter === 'learning') return Boolean(post.learning);
  if (filter === 'voice') return Boolean(post.voice);
  if (filter === 'media') return media.some(item => item.kind === 'image' || item.kind === 'video') || Boolean(videoLink(post.body));
  if (filter === 'files') return media.some(item => item.kind === 'file' || (item.kind === 'audio' && !post.voice));
  return true;
}

// The words that go out when a post is shared. The files travel beside them.
export function shareText(post) {
  const what = post.voice ? 'Voice message' + (post.media?.[0]?.seconds ? ' (' + clock(post.media[0].seconds) + ')' : '') : '';
  return [post.author + (post.created ? ', ' + new Date(post.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + ':', post.body || what].filter(Boolean).join(' ').trim();
}

// Checks files chosen for a post. Returns the reason to refuse, or nothing.
export function refuseFiles(files, limit = FILE_LIMIT) {
  if (files.length > 10) return 'Add up to 10 files to one post.';
  const large = files.find(file => file.size > limit);
  if (large) return large.name + ' is ' + fileSize(large.size) + '. One file can be up to ' + fileSize(limit) + '.';
  if (files.some(file => !file.size)) return 'One of those files is empty.';
  return '';
}

// ---- reactions and caption contests ---------------------------------------------------------------------------
// Two reactions, no more: a laugh and a thanks. No counts of who reacts most, and nothing ranks people.
export const REACTIONS = [['laugh', '😂', 'Funny'], ['thanks', '👍', 'Thanks']];
const KINDS = REACTIONS.map(([kind]) => kind);
export const CAPTION_LIMIT = 140;

// Kept in the browser, a reaction is the list of names who gave it. From the server it arrives as { count, mine }.
// Either way the screen asks the same question.
export function reactionState(entry, kind, me, same = (a, b) => a === b) {
  const value = entry?.reactions?.[kind];
  if (Array.isArray(value)) return { count: value.length, mine: value.some(name => same(name, me)) };
  return { count: value?.count || 0, mine: Boolean(value?.mine) };
}

const toggled = (list = [], who, same) => list.some(name => same(name, who)) ? list.filter(name => !same(name, who)) : [...list, who];

export function toggleReaction(posts, postId, kind, who, same = (a, b) => a === b) {
  if (!KINDS.includes(kind)) throw new Error('unknown reaction');
  return posts.map(post => post.id !== postId ? post : { ...post, reactions: { ...(post.reactions || {}), [kind]: toggled(post.reactions?.[kind], who, same) } });
}

export function addCaption(posts, postId, caption) {
  const text = String(caption.text || '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('A caption needs words.');
  if (text.length > CAPTION_LIMIT) throw new Error('A caption is at most ' + CAPTION_LIMIT + ' characters.');
  return posts.map(post => post.id !== postId ? post : { ...post, captions: [...(post.captions || []), { ...caption, text, reactions: {} }] });
}

export function toggleCaptionLaugh(posts, postId, captionId, who, same = (a, b) => a === b) {
  return posts.map(post => post.id !== postId ? post : { ...post, captions: (post.captions || []).map(caption => caption.id !== captionId ? caption
    : { ...caption, reactions: { laugh: toggled(caption.reactions?.laugh, who, same) } }) });
}

export function removeCaption(posts, postId, captionId) {
  return posts.map(post => post.id !== postId ? post : { ...post, captions: (post.captions || []).filter(caption => caption.id !== captionId) });
}

// Funniest first; ties go to whoever was first. The leader is marked only once someone has laughed.
export function rankedCaptions(post, me, same) {
  const list = (post.captions || []).map(caption => ({ ...caption, laugh: reactionState(caption, 'laugh', me, same) }));
  list.sort((a, b) => b.laugh.count - a.laugh.count || String(a.created).localeCompare(String(b.created)));
  return list.map((caption, index) => ({ ...caption, leading: index === 0 && caption.laugh.count > 0 }));
}

// The contest at the top of the board: the newest caption post from the last seven days, if there is one.
export function currentContest(posts, now = new Date()) {
  const week = 7 * 24 * 60 * 60 * 1000;
  return [...posts].filter(post => post.contest && post.created && now - new Date(post.created) < week)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)))[0] || null;
}
