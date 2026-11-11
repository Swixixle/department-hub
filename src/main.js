import './style.css';
import './sizes.css';
import { SHIFTS, POLICY, AGREED_STATUS, addDays, weekStart, assignmentKey, normalizeName, mergeAssignments, verifyRoster, evaluateChange, committedKeys, projectRoster, tidyNames, tidyNotes } from './model.js';
import { putSource, getSource, clearSources, loadState, saveState } from './storage.js';
import { GROUPS, STATUS_BY_GROUP, formatPhone, fullName, linkNames, personId, phoneLink } from './contacts.js';
import { HOLIDAY_NAMES, census, holidayTracker, ledger, publicationRecord, releaseOrder, staffing, standing, statSheet } from './fairness.js';
import { FILTERS, VOICE_LIMIT_SECONDS, clock, fileSize, linkParts, matchesFilter, mediaKind, refuseFiles, shareText, videoLink } from './board.js';
import { localBoard } from './backend.js';

const publicDemo = __PUBLIC_DEMO__;
const storageKey = 'department-hub-v1-' + (publicDemo ? 'demo' : 'local');
const draftKey = storageKey + '-draft';
const BUILD = 8;
const HOURS = /^\d{1,2}(:\d{2})?-\d{1,2}(:\d{2})?$/;
const asset = path => new URL(import.meta.env.BASE_URL + path, window.location.href).href;
const app = document.querySelector('#app');
const sample = await fetch(asset('fixtures/manifest.json')).then(response => {
  if (!response.ok) throw new Error('Sample images could not load.');
  return response.json();
});
const sampleDirectory = Object.fromEntries([...new Set(sample.truth.map(row => row.person))].map(person => [
  normalizeName(person), { person, status: 'Staff', skills: [sample.truth.find(row => row.person === person).shift] }
]));
sampleDirectory['robin'] = { person: 'Robin', status: 'PRN', skills: ['D','N'] };
const staffSample = mergeAssignments(sample.truth.map(row => ({ ...row, sources: [] })));
// Fictional contacts for the demo. 555-01xx numbers are reserved for fiction and reach no one.
const SAMPLE_SURNAMES = ['Lane', 'Moss', 'Reyes', 'Park', 'Stone', 'Vale', 'Hart', 'Quill', 'Rowe', 'Finch', 'Marsh', 'Cole', 'Wren', 'Dale', 'Poe', 'Shaw', 'Birch', 'Ames'];
const samplePeople = Object.values(sampleDirectory).map((profile, index) => {
  const person = { last: SAMPLE_SURNAMES[index % SAMPLE_SURNAMES.length], first: profile.person, title: '', role: '', group: profile.status === 'PRN' ? 'PRN' : 'Staff',
    cell: '317555' + String(100 + index).padStart(4, '0'), office: '' };
  return { ...person, id: personId(person) };
});
const initial = {
  mode: 'sample',
  people: samplePeople,
  peopleSource: 'sample',
  manualLinks: {},
  releases: [],
  custodians: ['jordan'],
  holidayRules: { off: [], extra: [] },
  history: [],
  assignments: staffSample,
  directory: sampleDirectory,
  hoursVerified: true,
  revision: 'sample-fixture',
  importedAt: null,
  images: [],
  actor: 'Jordan',
  policy: POLICY,
  requests: [],
  posts: [{ id: 'sample-welcome', author: 'Avery', body: 'Use the schedule to start a trade or coverage request. The conversation stays attached to the shift.', created: null }],
  events: []
};
// Readies a workspace that was saved by any earlier version, whether it comes from this browser or from a backup file.
function prepare(loaded) {
  let next = loaded;
  if (!next.people) next = { ...next, people: next.mode === 'sample' ? samplePeople : [], peopleSource: next.mode === 'sample' ? 'sample' : 'import', manualLinks: {} };
  for (const [field, empty] of [['releases', []], ['requests', []], ['posts', []], ['events', []], ['images', []], ['directory', {}], ['history', []],
    ['custodians', next.mode === 'sample' ? ['jordan'] : []], ['holidayRules', { off: [], extra: [] }]]) if (!next[field]) next = { ...next, [field]: empty };
  next = withContacts(next);
  // The starter rules live in code. A saved workspace picks up a new rule version on load.
  if (next.policy?.version !== POLICY.version) next = { ...next, policy: POLICY };
  return next;
}
let state = prepare(loadState(storageKey, initial));
const localToday = () => new Date().toLocaleDateString('en-CA');
// Open on today when the roster covers it. Otherwise on its first day.
function startDate() {
  const dates = state.assignments.map(row => row.date).sort();
  if (dates.length && localToday() >= dates[0] && localToday() <= dates.at(-1)) return localToday();
  return state.mode === 'sample' || !dates.length ? '2026-11-13' : dates[0];
}
// An import that was read but not yet published is kept, so closing or reloading the page does not lose the review.
function loadDraft() {
  const draft = loadState(draftKey, null);
  return draft && Array.isArray(draft.assignments) && Array.isArray(draft.flags) && Array.isArray(draft.pages) ? draft : null;
}
function saveDraft() {
  try { ui.pending ? localStorage.setItem(draftKey, JSON.stringify(ui.pending)) : localStorage.removeItem(draftKey); } catch { /* storage full: the draft stays in memory */ }
}
const agreedRequestFor = row => state.requests.find(request => request.status === AGREED_STATUS &&
  [request.from?.key, request.to?.key].includes(row.key));
const checkChange = (details, exceptId = null) => evaluateChange({
  roster: projectRoster(state.assignments, state.requests), directory: state.directory,
  hoursVerified: state.hoursVerified, policy: state.policy, committed: committedKeys(state.requests, exceptId), ...details
});
let ui ={ tab: 'schedule', date: startDate(), view: 'weekend', dialog: null, pending: loadDraft(), busy: null, notice: '', flash: '' };
// Text size is a setting of this device, not of the workspace. It scales every rem in sizes.css.
const TEXT_SIZES = [1, 1.15, 1.3], TEXT_NAMES = ['normal', 'large', 'larger'], textKey = 'department-hub-text-size';
let textSize = Math.max(0, TEXT_SIZES.indexOf(Number(loadState(textKey, 1))));
const applyTextSize = () => document.documentElement.style.setProperty('--scale', TEXT_SIZES[textSize]);
applyTextSize();
// Which buttons get pressed, as fixed button names and totals only. Never a person's name, a shift, a typed word or a
// recording: a value is kept only for the few controls whose values are fixed words, such as the tab that was opened.
// Kept apart from the workspace, so it is not in backups or receipts, and not counted at all in the public demo.
const usageKey = 'department-hub-usage-v1', FIXED_VALUES = new Set(['tab', 'view', 'board-filter', 'pool', 'fair-scope']);
function countPress(action, value) {
  if (publicDemo || !/^[a-z][a-z-]*(:[a-z-]+)?$/.test(action || '')) return;
  const name = FIXED_VALUES.has(action) && /^[A-Za-z-]{1,12}$/.test(value || '') ? action + ':' + value.toLowerCase() : action;
  try {
    const usage = loadState(usageKey, null) || { since: localToday(), counts: {} };
    usage.counts[name] = (usage.counts[name] || 0) + 1;
    localStorage.setItem(usageKey, JSON.stringify(usage));
  } catch { /* counting must never get in the way */ }
}
const USAGE_NAMES = { 'tab:schedule':'Opened Schedule', 'tab:board':'Opened Board', 'tab:requests':'Opened Requests', 'tab:fairness':'Opened Fairness', 'tab:people':'Opened Directory',
  shift:'Opened a shift', 'edit-shift':'Opened Edit names', 'form:edit-shift':'Saved names on a shift', matches:'Looked for a trade or coverage', 'form:request':'Sent a request',
  voice:'Started a voice message', 'form:voice':'Sent a voice message', 'form:post':'Posted to the board', share:'Pressed Share', backup:'Saved a backup', restore:'Restored a backup',
  import:'Opened Import', publish:'Published a schedule', 'form:correct':'Saved a checked shift', 'view:week':'Chose Week', 'view:weekend':'Chose Weekend', today:'Pressed Today', navigate:'Changed week',
  over:'Opened an over-staffed shift', release:'Opened low census', 'form:release':'Recorded low census', 'text-size':'Changed text size', close:'Closed a dialog' };
// Attachments on board posts: the files themselves, and addresses the page can show them from.
const mediaBlobs = new Map(), mediaUrls = new Map();
// The one place the board keeps posts and files. A hosted service replaces this line (see src/backend.js).
const boardStore = localBoard({
  getPosts: () => state.posts,
  change: (type, details, update) => commit(type, details, previous => ({ ...previous, posts: update(previous.posts) }))
});
let voice = null;         // a voice message being recorded or reviewed
async function hydrateMedia() {
  const wanted = state.posts.flatMap(post => post.media || []).filter(item => !mediaBlobs.has(item.id));
  if (!wanted.length) return;
  for (const item of wanted) {
    const blob = await boardStore.file(item.id).catch(() => null);
    mediaBlobs.set(item.id, blob);
    if (blob) mediaUrls.set(item.id, URL.createObjectURL(blob));
  }
  render();
}
function forgetMedia(ids) {
  for (const id of ids) { if (mediaUrls.get(id)) URL.revokeObjectURL(mediaUrls.get(id)); mediaUrls.delete(id); mediaBlobs.delete(id); }
}
let sourceUrl = null;
let writing = false;
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const toDate = value => new Date(value + 'T12:00:00Z');
const dayLabel = (date, opts) => toDate(date).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const timeLabel = value => value ? new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Sample roster';
const avatar = name => '<span class="avatar">' + h(name.trim().split(/\s+/).map(part => part[0]).slice(0,2).join('').toUpperCase()) + '</span>';
const button = (label, action, options = '') => '<button type="button" data-action="' + action + '" ' + options + '>' + label + '</button>';
const valueAttr = value => 'data-value="' + h(value) + '"';
const actorNames = () => [...new Set([...state.assignments.map(row => row.person), ...Object.values(state.directory).map(profile => profile.person)])].sort((a,b) => a.localeCompare(b));
const isSame = (a,b) => normalizeName(a) === normalizeName(b);
const isMine = row => isSame(row.person, state.actor);
const ROLE_LABELS = { charge: 'Charge', icu: 'ICU', extra: 'Extra' };

// Ties schedule names to people on the telephone list, then fills in what the list and the roster already say:
// employment status from the list's section, and which shifts a person works from the roster itself.
function withContacts(next) {
  const names = [...new Set(next.assignments.map(item => item.person))];
  const manual = next.manualLinks || {};
  const claimed = new Set(Object.values(manual).filter(Boolean));
  const auto = linkNames(names.filter(name => !(normalizeName(name) in manual)), next.people.filter(person => person.group !== 'Physician' && !claimed.has(person.id)));
  const links = { ...auto.links, ...Object.fromEntries(Object.entries(manual).filter(([, id]) => id)) };
  const directory = { ...next.directory };
  for (const name of names) {
    const key = normalizeName(name);
    const profile = directory[key] || { person: name, status: null, skills: [] };
    const person = next.people.find(item => item.id === links[key]);
    const worked = [...new Set(next.assignments.filter(item => normalizeName(item.person) === key).map(item => item.shift))];
    directory[key] = {
      ...profile, status: profile.status || (person && STATUS_BY_GROUP[person.group]) || null,
      skills: profile.skills?.length || next.mode !== 'local' ? profile.skills : worked
    };
  }
  return { ...next, links, linkGuesses: auto.guessed, directory };
}
const contactFor = name => state.people.find(person => person.id === state.links?.[normalizeName(name)]) || null;
const contactButtons = (person, body) => {
  const call = phoneLink('tel', person?.cell), text = phoneLink('sms', person?.cell, body);
  return call ? '<a class="contact-link" href="' + h(call) + '">Call</a><a class="contact-link" href="' + h(text) + '">Text</a>' : '';
};

async function receipt(type, details) {
  const payload = {
    id: crypto.randomUUID(), time: new Date().toISOString(), type,
    rosterRevision: state.revision, policyVersion: state.policy.version,
    previousHash: state.events.at(-1)?.hash || null, actor: state.actor, details
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return { ...payload, hash: Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('') };
}
async function commit(type, details, update) {
  if (writing) throw new Error('Another change is still being saved.');
  writing = true;
  try {
    const event = await receipt(type, details);
    const next = update(state);
    next.events = [...state.events, event];
    saveState(storageKey, next);
    state = next;
  } finally { writing = false; }
}

function top() {
  const nav = (id, icon, text) => button('<span aria-hidden="true">' + icon + '</span>' + text, 'tab',
    'class="nav-item ' + (ui.tab === id ? 'active' : '') + '" ' + valueAttr(id) + (ui.tab === id ? ' aria-current="page"' : ''));
  return '<aside><div class="brand"><img src="' + h(asset('mark.svg')) + '" alt=""><div><b>Department Hub</b><small>WORKSPACE</small></div></div>' +
    '<div class="space-label">YOUR DEPARTMENT</div><div class="space-name">Respiratory Care</div><nav aria-label="Workspace">' +
    nav('schedule', '▦', 'Schedule') + nav('board', '▤', 'Board') + nav('requests', '⇄', 'Requests') + nav('fairness', '⚖', 'Fairness') + nav('people', '☎', 'Directory') +
    '</nav><div class="aside-bottom"><span class="status-dot"></span>' + (publicDemo ? 'Public demo · fictional data' :
      button('Saved in this browser · ' + h(location.host), 'data', 'class="where" title="Backup, restore and where this workspace is kept"')) + '</div></aside>';
}

function displayDates() {
  if (ui.view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(ui.date), i));
  const friday = addDays(weekStart(ui.date), 5);
  return Array.from({ length: 3 }, (_, i) => addDays(friday, i));
}

const countNote = item => item.people.length + ' listed · ' + Math.abs(item.extra) + (item.extra > 0 ? ' over' : ' short');
const firstInLine = order => order.filter(item => item.first).map(item => item.person);

function schedule() {
  const dates = displayDates();
  const usual = { D: staffing(state.assignments, 'D', state.directory), N: staffing(state.assignments, 'N', state.directory) };
  const offUsual = (date, shift) => usual[shift].over.find(item => item.date === date) || usual[shift].short.find(item => item.date === date);
  const title = dayLabel(dates[0], { month:'long', day:'numeric' }) + ' – ' + dayLabel(dates.at(-1), { month:'short', day:'numeric' });
  const cells = dates.map(date => '<article class="day-card"><header><span>' + h(dayLabel(date, { weekday:'long' })) +
    '</span><strong>' + h(dayLabel(date, { day:'numeric' })) + '</strong></header>' + Object.entries(SHIFTS).map(([shift, def]) => {
      const rows = state.assignments.filter(row => row.date === date && row.shift === shift);
      return '<section class="shift"><div class="shift-label ' + (shift === 'N' ? 'night' : 'day') + '"><b>' + def.label + '</b><span>' +
        (shift === 'N' ? '7 PM – 7 AM' : '7 AM – 7 PM') + '</span>' +
        (offUsual(date, shift)?.extra < 0 ? '<i class="count-note">' + h(countNote(offUsual(date, shift))) + '</i>' : '') + '</div>' +
        (offUsual(date, shift)?.extra > 0 ? button('<span>' + h(countNote(offUsual(date, shift))) + '</span><span>Who is next ›</span>', 'over',
          'class="count-note over" title="More people than usual. See who is next for low census." ' + valueAttr(date + '|' + shift)) : '') +
        (rows.length ? rows.map(row => button(avatar(row.person) + '<span class="name">' + h(row.person) + '</span>' +
          (row.hours ? '<i class="tag">' + h(row.hours) + '</i>' : '') +
          (isMine(row) ? '<em>You</em>' : ''), 'shift', 'class="staff ' + (isMine(row) ? 'mine ' : '') + h(row.role || '') + '" ' +
          (row.role ? 'title="' + h(ROLE_LABELS[row.role] || row.role) + '" ' : '') + valueAttr(row.key))).join('') :
          '<p class="empty-shift">No assignments in this roster.</p>') +
        button(rows.length ? 'Edit names' : 'Add names', 'edit-shift', 'class="edit-shift" ' + valueAttr(date + '|' + shift)) + '</section>';
    }).join('') + '</article>').join('');
  return '<section class="intro"><div><div class="eyebrow">TEAM ROSTER</div><h1>Schedule</h1><p>See who’s working. Start a trade or find coverage from your shift.</p></div>' +
    button('＋ Import schedule', 'import', 'class="secondary"') + '</section>' +
    '<div class="roster-status"><span class="status-dot"></span><b>' + (state.mode === 'sample' ? 'Fictional practice roster' : 'Imported roster') +
    '</b><span>' + h(state.mode !== 'sample' ? 'Published ' + timeLabel(state.importedAt) : publicDemo ? 'Try the full flow with sample staff' :
      'No schedule is saved in this browser at ' + location.host + '. These are sample names.') +
    '</span><span class="spacer"></span>' + (state.mode === 'local' ? '<span>Hours and pickups need verification</span>' + button('Staff details', 'staff-setup', 'class="text-button"') + '' :
      publicDemo ? '<span>Demo hours only</span>' : button('Restore a backup', 'data', 'class="text-button"')) + '</div>' +
    (ui.pending && !ui.busy ? '<div class="roster-status waiting"><span class="status-dot"></span><b>An import is waiting to be finished</b><span>' + ui.pending.assignments.length + ' shifts read, ' +
      ui.pending.flags.filter(flag => flag.status === 'open').length + ' to check</span><span class="spacer"></span>' + button('Continue', 'import', 'class="text-button"') +
      button('Discard', 'clear-draft', 'class="text-button"') + '</div>' : '') +
    '<div class="calendar-toolbar"><div><div class="eyebrow">ROSTER VIEW</div><h2>' + h(title) + '</h2></div><div class="controls">' +
    '<div class="segments">' + button('Weekend', 'view', 'class="' + (ui.view === 'weekend' ? 'selected' : '') + '" data-value="weekend"') +
    button('Week', 'view', 'class="' + (ui.view === 'week' ? 'selected' : '') + '" data-value="week"') + '</div>' +
    '<div class="segments">' + button('Today', 'today') + button('‹', 'navigate', 'aria-label="Previous week" data-value="-7"') +
    button('›', 'navigate', 'aria-label="Next week" data-value="7"') + '</div></div></div>' +
    '<div class="calendar ' + ui.view + '">' + cells + '</div>' +
    (state.assignments.some(row => row.role) ? '<p class="calendar-foot legend"><span class="name charge">Pink</span> charge <span class="name icu">Green</span> ICU' +
      (state.assignments.some(row => row.role === 'extra') ? ' <span class="name extra">Yellow</span> extra' : '') + '</p>' : '') +
    '<p class="calendar-foot">Night shifts appear on their start date. Payroll checks split hours at the workweek boundary.</p>';
}

const RULE = 'No patients, monitors, charts or names in pictures, video or recordings.';
function postMarkup(post) {
  const link = videoLink(post.body);
  const words = post.body ? '<p>' + linkParts(post.body).map(part => part.href ?
    '<a href="' + h(part.href) + '" target="_blank" rel="noopener noreferrer">' + h(part.text) + '</a>' : h(part.text)).join('') + '</p>' : '';
  const piece = item => {
    const url = mediaUrls.get(item.id);
    if (!mediaBlobs.has(item.id)) return '<p class="subtle">Loading ' + h(item.name) + '…</p>';
    if (!url) return '<p class="subtle">' + h(item.name) + ' is not in this browser.</p>';
    if (item.kind === 'image') return '<a href="' + url + '" target="_blank" rel="noopener"><img class="post-image" src="' + url + '" alt="' + h(item.name) + '" loading="lazy"></a>';
    if (item.kind === 'video') return '<video class="post-video" data-media="' + h(item.id) + '" src="' + url + '" controls playsinline preload="metadata"></video>';
    if (item.kind === 'audio') return '<audio class="post-audio" data-media="' + h(item.id) + '" src="' + url + '" controls preload="metadata"></audio>' + (post.voice ? '' : '<small>' + h(item.name) + '</small>');
    return '<a class="post-file" href="' + url + '" download="' + h(item.name) + '"><b>' + h(item.name) + '</b><span>' + fileSize(item.size) + ' · Download</span></a>';
  };
  return '<article class="panel post"><div class="post-head">' + avatar(post.author) +
    '<div><b>' + h(post.author) + '</b><small>' + h(post.created ? timeLabel(post.created) : 'Sample announcement') +
    (post.voice ? ' · Voice message' + (post.media?.[0]?.seconds ? ' · ' + clock(post.media[0].seconds) : '') : '') + '</small></div>' +
    (post.learning ? '<span class="badge learning">Learning</span>' : '') + '</div>' + words +
    (post.media?.length ? '<div class="post-media">' + post.media.map(piece).join('') + '</div>' : '') +
    (link ? '<div class="link-player" data-embed="' + h(link.embed) + '">' + button('▶ Play here · ' + h(link.site), 'play-link', 'class="play-link"') + '</div>' : '') +
    '<div class="post-actions">' + (post.inside ? '<span class="subtle">Department only</span>' : button('↗ Share', 'share', 'class="post-action" ' + valueAttr(post.id))) +
    (post.created && isSame(post.author, state.actor) ? button('Remove', 'remove-post', 'class="post-action quiet" ' + valueAttr(post.id)) : '') + '</div></article>';
}

function board() {
  const filter = ui.boardFilter || 'all';
  const shown = [...state.posts].reverse().filter(post => matchesFilter(post, filter));
  return '<section class="intro"><div><div class="eyebrow">TEAM SPACE</div><h1>Department board</h1><p>News, pictures, files, video and voice for the whole department.</p></div>' +
    button('🎙 Voice message to everyone', 'voice', 'class="primary voice-start"') + '</section>' +
    (boardStore.shared ? '' : '<div class="roster-status"><span class="status-dot"></span><b>Kept in ' + h(boardStore.where) + '</b><span>Nobody else sees a post until the shared version is switched on. Share sends one out now.</span></div>') +
    '<form data-form="post" class="panel form-panel composer"><label for="post-text">Write to the department</label>' +
    '<textarea id="post-text" name="body" maxlength="2000" placeholder="Share something with the department. A YouTube or Vimeo link plays right on the board."></textarea>' +
    '<label class="attach"><b>＋ Photos, video or files</b><input id="post-files" name="files" type="file" multiple></label>' +
    '<label><span><input type="checkbox" name="learning"> Add to Learning (instructional, CEU-type)</span></label>' +
    '<label><span><input type="checkbox" name="inside"> Keep inside the department (no Share button)</span></label>' +
    '<p class="subtle">' + RULE + '</p><p class="refusal" role="alert"></p><button class="primary">Post</button></form>' +
    '<div class="calendar-toolbar board-bar"><div class="segments">' + FILTERS.map(([id, label]) => button(label, 'board-filter', 'class="' + (filter === id ? 'selected' : '') + '" ' + valueAttr(id))).join('') + '</div></div>' +
    '<div class="post-list">' + (shown.map(postMarkup).join('') || '<div class="panel empty"><strong>Nothing here yet.</strong></div>') + '</div>';
}

// Fairness is a kept record. Everyone sees their own sheet and the department picture, without names. Whoever keeps the
// record sees who is carrying more, the holiday tracker and the low-census ledger, and can export it.
const isKeeper = () => state.custodians.includes(normalizeName(state.actor));
const keeperNames = () => state.custodians.map(id => state.directory[id]?.person || id);
const recordRows = () => ui.fairScope === 'record' && state.history.length ? [...state.history, ...state.assignments] : state.assignments;
const signed = value => (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(1);
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');

function fairness() {
  const rows = recordRows(), rules = state.holidayRules;
  const mine = rows.filter(row => isSame(row.person, state.actor));
  const pool = ui.pool || (mine.filter(row => row.shift === 'N').length > mine.length / 2 ? 'N' : 'D');
  const table = ledger(rows, pool, state.directory, rules), stand = standing(table), tracker = holidayTracker(rows, state.directory, rules);
  const sheet = statSheet(state.actor, { ...state, assignments: rows, rules }), me = sheet.row;
  const line = (label, value) => '<div><b>' + h(value) + '</b><span>' + h(label) + '</span></div>';
  const verdict = !me ? '' : me.weekendOnly ? 'Weekend-only position.' :
    me.weekendVolunteer ? 'You have taken ' + sheet.weekendExtra.toFixed(1) + ' weekend turns beyond a regular share by choice.' :
    me.weekendGap >= 1 ? 'You are carrying ' + me.weekendGap.toFixed(1) + ' weekend turns more than your share.' :
    me.weekendGap <= -1 ? 'You are ' + Math.abs(me.weekendGap).toFixed(1) + ' weekend turns under your share.' : 'You are within one weekend turn of your share.';
  const card = me ? '<div class="panel stat-sheet"><div class="eyebrow">YOUR SHEET · ' + h(state.actor.toUpperCase()) + '</div><p class="fair-line">' + h(verdict) + '</p><div class="stat-grid">' +
    line('shifts', me.shifts) + line(me.weekendOnly || me.weekendVolunteer ? 'weekend turns' : 'weekend turns, share ' + me.weekendFair.toFixed(1), me.weekend) +
    line('holidays' + (me.holidays.length ? ': ' + me.holidays.join(', ') : ''), me.holidays.length) + line('charge', me.charge) + line('ICU', me.icu) +
    line('trades accepted', sheet.tradesAccepted) + line('shifts covered', sheet.shiftsCovered) + line('went home for someone', sheet.wentHomeForSomeone) + line('low-census hours', sheet.releasedHours) + '</div></div>' : '';
  const holidayShifts = tracker.people.reduce((sum, entry) => sum + entry.count, 0);
  const picture = !table.people.length ? '<div class="panel empty"><strong>No ' + (pool === 'N' ? 'night' : 'day') + ' shifts on record.</strong></div>' :
    '<div class="panel"><p class="fair-line"><b>' + table.withinOne + ' of ' + table.regulars + '</b> regulars are within one weekend turn of their share. The spread is <b>' + table.spread.toFixed(1) + '</b> turns. The aim is under one.</p>' +
    '<p><b>' + stand.over.length + '</b> carrying more than a turn extra. <b>' + stand.under.length + '</b> more than a turn under.' +
    (holidayShifts ? ' ' + plural(holidayShifts, 'holiday shift') + ' worked by ' + plural(tracker.people.length, 'person').replace('persons', 'people') + '; the most by one person is ' + tracker.people[0].count + '.' : '') + '</p>' +
    '<p class="subtle">A weekend turn is a Saturday or Sunday day shift, or a Friday, Saturday or Sunday night. A share follows how many shifts a person works. Students are left out. Calling in sick and declined requests are never counted.</p></div>';
  const access = '<div class="panel"><p><b>' + (state.custodians.length ? 'The full record is kept by ' + h(keeperNames().join(' and ')) + '.' : 'Nobody keeps the record yet.') + '</b></p>' +
    '<p class="subtle">You see your own sheet and the department picture. Whoever keeps the record sees who is carrying more, tracks the holidays and can export it.</p>' +
    (state.custodians.length ? '' : '<p>' + button('I will keep the record', 'claim-record', 'class="secondary"') + '</p>') + '</div>';
  return '<section class="intro"><div><div class="eyebrow">WHO CARRIED WHAT</div><h1>Fairness</h1><p>A kept record, so nobody quietly ends up with more than their share.</p></div></section>' + card +
    '<div class="calendar-toolbar"><div><div class="eyebrow">' + (table.from ? h(dayLabel(table.from, { month:'short', day:'numeric' }) + ' – ' + dayLabel(table.to, { month:'short', day:'numeric', year:'numeric' })) : 'NOTHING ON RECORD') +
    '</div><h2>' + (pool === 'N' ? 'Night shift' : 'Day shift') + '</h2></div><div class="controls">' +
    (state.history.length ? '<div class="segments">' + button('This schedule', 'fair-scope', 'class="' + (ui.fairScope === 'record' ? '' : 'selected') + '" data-value="schedule"') +
      button('Everything on record', 'fair-scope', 'class="' + (ui.fairScope === 'record' ? 'selected' : '') + '" data-value="record"') + '</div>' : '') +
    '<div class="segments">' + button('Days', 'pool', 'class="' + (pool === 'D' ? 'selected' : '') + '" data-value="D"') + button('Nights', 'pool', 'class="' + (pool === 'N' ? 'selected' : '') + '" data-value="N"') + '</div></div></div>' +
    picture + (isKeeper() ? recordMarkup(table, stand, tracker, pool, rows) : access);
}

function recordMarkup(table, stand, tracker, pool, rows) {
  const person = entry => '<div><span><b>' + h(entry.person) + '</b> <small>' + plural(entry.weekend, 'weekend turn') + ', share ' + entry.weekendFair.toFixed(1) +
    (entry.holidays.length ? ' · ' + plural(entry.holidays.length, 'holiday') : '') + '</small></span><b class="gap ' + (entry.weekendGap > 0 ? 'over' : 'under') + '">' + signed(entry.weekendGap) + '</b></div>';
  const full = table.people.map(entry => '<tr class="' + (isSame(entry.person, state.actor) ? 'mine' : '') + (entry.regular || entry.weekendVolunteer ? '' : ' light') + '"><th scope="row">' + h(entry.person) +
    (entry.weekendOnly ? ' <small>weekend only</small>' : entry.weekendVolunteer ? ' <small>extra weekends by choice</small>' : entry.regular ? '' : ' <small>' + h(entry.status === 'PRN' ? 'PRN' : 'few shifts') + '</small>') +
    '</th><td>' + entry.shifts + '</td><td>' + entry.weekend + '</td><td>' + (entry.weekendOnly ? '–' : entry.weekendFair.toFixed(1)) + '</td><td class="gap ' +
    (entry.weekendVolunteer ? 'credit' : entry.weekendOnly || Math.abs(entry.weekendGap) < 1 ? 'even' : entry.weekendGap > 0 ? 'over' : 'under') + '">' +
    (entry.weekendOnly ? '–' : entry.weekendVolunteer ? '+' + entry.weekendExtra.toFixed(1) + ' by choice' : signed(entry.weekendGap)) + '</td><td>' + entry.holidays.length + '</td><td>' + entry.charge + '</td><td>' + entry.icu + '</td></tr>').join('');
  return '<div class="calendar-toolbar"><div><div class="eyebrow">KEPT BY ' + h(keeperNames().join(' AND ').toUpperCase()) + '</div><h2>The record</h2></div></div>' +
    '<div class="panel"><h3>Carrying more than their share</h3>' + (stand.over.length ? '<div class="line-list">' + stand.over.map(person).join('') + '</div>' : '<p class="subtle">Nobody is more than a weekend turn over.</p>') +
    '<h3>Under their share</h3>' + (stand.under.length ? '<div class="line-list">' + stand.under.map(person).join('') + '</div>' : '<p class="subtle">Nobody is more than a weekend turn under.</p>') +
    (table.next.length && table.spread >= 1 ? '<p class="subtle">The next weekend turns would go first to ' + h(table.next.join(', ')) + '.</p>' : '') +
    table.volunteers.map(item => '<p class="subtle"><b>' + h(item.person) + '</b> has taken ' + item.extra.toFixed(1) + ' weekend turns beyond a regular share by choice. Those turns are out of the rotation, so nobody else is measured against them.</p>').join('') +
    table.people.filter(entry => !entry.weekendOnly && !entry.weekendVolunteer && entry.shifts >= 4 && entry.weekend === entry.shifts).map(entry => '<p class="subtle"><b>' + h(entry.person) +
      '</b> is listed only on weekends. If that is a weekend-only position, set it in Staff details, so nobody else is measured against it.</p>').join('') +
    '<details><summary>Everyone, in one table</summary><div class="fair-scroll"><table class="fair"><thead><tr><th scope="col">Name</th><th scope="col">Shifts</th><th scope="col">Weekend</th><th scope="col">Share</th><th scope="col">Difference</th><th scope="col">Holidays</th><th scope="col">Charge</th><th scope="col">ICU</th></tr></thead><tbody>' +
    full + '</tbody></table></div></details></div>' +
    '<div class="panel"><h3>Holiday tracker</h3>' + (tracker.days.length ? '<div class="fair-scroll"><table class="fair holiday"><thead><tr><th scope="col">Name</th>' +
      tracker.days.map(day => '<th scope="col">' + h(day.name) + '<br><small>' + h(dayLabel(day.date, { month:'short', day:'numeric', year:'2-digit' })) + '</small></th>').join('') + '<th scope="col">Total</th></tr></thead><tbody>' +
      (tracker.people.map(entry => '<tr class="' + (isSame(entry.person, state.actor) ? 'mine' : '') + '"><th scope="row">' + h(entry.person) + '</th>' +
        tracker.days.map(day => '<td>' + (entry.worked[day.date] ? h(entry.worked[day.date].replace('D', 'Day ').replace('N', 'Night').trim()) : '·') + '</td>').join('') + '<td><b>' + entry.count + '</b></td></tr>').join('') ||
        '<tr><td colspan="' + (tracker.days.length + 2) + '">Nobody is listed on these days.</td></tr>') + '</tbody></table></div>' : '<p class="subtle">No holiday falls inside these dates.</p>') +
    '<p>' + button('Which holidays count', 'holiday-rules', 'class="secondary"') + '</p></div>' + lowCensus(pool, rows) +
    '<div class="panel"><h3>Keeping the record</h3><p class="subtle">Every schedule that is published, every shift edited by hand and every low-census entry leaves a dated receipt. When a new schedule replaces an old one, the old one stays on record.' +
    (state.history.length ? ' ' + state.history.length + ' shifts are carried from earlier schedules.' : '') + '</p><div class="actions wrap">' + button('Export the record', 'export-record', 'class="primary"') +
    button('Who keeps the record', 'staff-setup', 'class="secondary"') + button('Decision history', 'audit', 'class="secondary"') + '</div></div>';
}

function lowCensus(pool, rows) {
  const table = census(rows, pool, state.directory, state.releases, localToday());
  const word = pool === 'N' ? 'night' : 'day';
  const chip = item => {
    const label = h(dayLabel(item.date, { weekday:'short', month:'short', day:'numeric' }));
    return state.assignments.some(row => row.date === item.date && row.shift === pool)
      ? button(label, 'over', 'class="chip" ' + valueAttr(item.date + '|' + pool)) : '<span class="chip">' + label + ' · archived</span>';
  };
  const next = item => firstInLine(item.order).length === 1 ? 'next in line is ' + firstInLine(item.order)[0] : 'tied for next: ' + firstInLine(item.order).join(', ');
  const shortDates = table.short.map(item => dayLabel(item.date, { month:'short', day:'numeric' }));
  return '<div class="calendar-toolbar"><div><div class="eyebrow">MORE PEOPLE THAN USUAL</div><h2>Low census</h2></div></div><div class="panel">' +
    (table.over.length ? '<p class="fair-line"><b>' + table.over.length + '</b> ' + word + ' shift' + (table.over.length === 1 ? ' lists' : 's list') + ' more than the usual <b>' + table.usual +
      '</b>. Someone is likely to be released on each.</p>' : '<p class="fair-line">No ' + word + ' shift in this roster lists more than the usual <b>' + table.usual + '</b>.</p>') +
    (table.upcoming.length ? '<div class="chip-list"><span class="subtle">Coming up</span>' + table.upcoming.map(item => '<div>' + chip(item) + ' <span class="subtle">' + h(next(item)) + '</span></div>').join('') + '</div>' : '') +
    (table.unrecorded.length ? '<div class="chip-list"><span class="subtle">Past, nothing recorded yet</span><div>' + table.unrecorded.map(chip).join(' ') + '</div></div>' : '') +
    (table.people.length ? '<div class="fair-scroll"><table class="fair"><thead><tr><th scope="col">Name</th><th scope="col">On those shifts</th><th scope="col">Share of the cuts</th><th scope="col">Released</th><th scope="col">Hours</th><th scope="col">Offered</th></tr></thead><tbody>' +
      table.people.map(entry => '<tr class="' + (isSame(entry.person, state.actor) ? 'mine' : '') + '"><th scope="row">' + h(entry.person) + '</th><td>' + entry.onOver + '</td><td>' + entry.share.toFixed(2) +
        '</td><td>' + entry.turns + '</td><td>' + entry.hours + '</td><td>' + entry.offered + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="subtle">Totals follow the dates shown. Who is next uses all recorded hours: whoever has lost the fewest is next. Hours count the same whether a person offered or was sent, so offering never moves anyone to the front. Share of the cuts splits each extra person evenly between everyone listed on that shift.</p>' : '') +
    (shortDates.length ? '<p class="subtle">' + shortDates.length + ' ' + word + ' shift' + (shortDates.length === 1 ? ' lists' : 's list') + ' fewer than usual: ' + h(shortDates.slice(0, 8).join(', ')) +
      (shortDates.length > 8 ? ' and ' + (shortDates.length - 8) + ' more' : '') + '. Handwritten additions are not read, so check the page.</p>' : '') + '</div>';
}

function people() {
  const linkedAs = person => Object.entries(state.links || {}).filter(([, id]) => id === person.id).map(([key]) => state.directory[key]?.person || key);
  const card = person => {
    const names = linkedAs(person);
    const guess = names.some(name => (state.linkGuesses || []).includes(normalizeName(name)));
    return '<article class="panel person"><div class="post-head">' + avatar(fullName(person).replace(/^Dr\.\s*/, '')) + '<div><b>' + h(fullName(person)) + '</b><small>' +
      h([person.role, names.length ? 'On the schedule as ' + names.join(', ') + (guess ? ' (best guess)' : '') : ''].filter(Boolean).join(' · ') || person.group) +
      '</small></div></div><div class="person-lines">' +
      (person.cell ? '<span>' + h(formatPhone(person.cell)) + '</span>' + contactButtons(person) : '') +
      (person.office ? '<span class="subtle">Office ' + h(person.office) + '</span>' : '') + '</div></article>';
  };
  const unlinked = [...new Set(state.assignments.map(item => item.person))].filter(name => !contactFor(name) || (state.linkGuesses || []).includes(normalizeName(name)));
  const choices = name => '<label class="link-row"><span>' + h(name) + (contactFor(name) ? ' <small>(best guess)</small>' : '') + '</span><select data-link="' + h(name) + '" aria-label="Contact for ' + h(name) + '"><option value="">No contact</option>' +
    state.people.filter(person => person.group !== 'Physician').map(person => '<option value="' + h(person.id) + '"' + (contactFor(name)?.id === person.id ? ' selected' : '') + '>' + h(fullName(person)) + '</option>').join('') + '</select></label>';
  return '<section class="intro"><div><div class="eyebrow">DEPARTMENT CONTACTS</div><h1>Directory</h1><p>Call or text a coworker. Numbers stay in this workspace.</p></div>' +
    (publicDemo ? '' : button('＋ Import phone list', 'import', 'class="primary"')) + '</section>' +
    (!state.people.length ? '<div class="panel empty"><strong>No contacts yet.</strong><p>Import a photo of the department telephone list. It is read on this device.</p></div>' :
      (state.peopleSource === 'sample' ? '<div class="roster-status"><span class="status-dot"></span><b>Fictional contacts</b><span>These numbers reach no one</span></div>' : '') +
      (unlinked.length && state.people.length ? '<div class="panel form-panel"><b>Schedule names to match</b><p class="subtle">Pick the person each schedule name belongs to.</p>' + unlinked.map(choices).join('') + '</div>' : '') +
      GROUPS.map(group => { const list = state.people.filter(person => person.group === group).sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first));
        return list.length ? '<div class="eyebrow group-head">' + h({ Contract: 'CONTRACT AND RESERVE', Student: 'STUDENTS', Physician: 'PHYSICIANS' }[group] || group.toUpperCase()) + '</div><div class="post-list">' + list.map(card).join('') + '</div>' : ''; }).join(''));
}

function requests() {
  const list = [...state.requests].reverse().map(request => '<article class="panel request"><div><span class="badge">' + h(request.status) +
    '</span><h3>' + h(request.kind === 'trade' ? 'Shift trade' : 'Coverage request') + '</h3><p>' + h(request.from.person + ' → ' + request.recipient) +
    ' · ' + h(shiftCaption(request.from)) + '</p></div>' +
    button('Open thread', 'thread', 'class="secondary" ' + valueAttr(request.id)) + '</article>').join('');
  return '<section class="intro"><div><div class="eyebrow">SHIFT COORDINATION</div><h1>Requests</h1><p>Follow trades and coverage without changing the official roster.</p></div></section>' +
    (list || '<div class="panel empty"><strong>No shift requests yet.</strong><p>Open one of your shifts to start a request.</p>' +
      button('Go to schedule', 'tab', 'class="secondary" data-value="schedule"') + '</div>');
}

function shiftCaption(row) {
  return dayLabel(row.date, { weekday:'short', month:'short', day:'numeric' }) + ' · ' + SHIFTS[row.shift].label;
}

function render() {
  const focus = document.activeElement;
  const playing = [...app.querySelectorAll('[data-media]')].filter(player => player.currentTime > 0 && !player.ended)
    .map(player => ({ id: player.dataset.media, time: player.currentTime, on: !player.paused }));
  const sameDialog = app.querySelector('dialog')?.dataset.dialog === ui.dialog?.type;
  app.innerHTML = top() + '<main><header class="app-top"><div class="breadcrumbs">Workspace <span>›</span> Respiratory Care</div>' +
    '<div class="top-tools">' + button('Aa', 'text-size', 'class="text-size" title="Text size" aria-label="Text size: ' + TEXT_NAMES[textSize] + '. Press to change."') +
    '<label class="actor">Viewing as <select id="actor" aria-label="Viewing as">' +
    (actorNames().length ? actorNames() : [state.actor]).map(name => '<option ' + (isSame(name, state.actor) ? 'selected' : '') + '>' + h(name) + '</option>').join('') +
    '</select></label></div></header><div class="content">' +
    (ui.notice ? '<div role="status" class="notice">' + h(ui.notice) + '</div>' : '') +
    (ui.tab === 'board' ? board() : ui.tab === 'requests' ? requests() : ui.tab === 'people' ? people() : ui.tab === 'fairness' ? fairness() : schedule()) +
    '<footer><span>' + (publicDemo ? 'Fictional data only' : 'Private local prototype') +
    ' · No payroll or official schedule changes · Version ' + BUILD + '</span><span>' + (publicDemo ? '' : button('Backup and restore', 'data', 'class="text-button"') + ' ') +
    button('Decision history', 'audit', 'class="text-button"') + '</span></footer></div></main>' + dialogMarkup();
  for (const item of playing) {
    const player = app.querySelector('[data-media="' + CSS.escape(item.id) + '"]');
    if (player) { player.currentTime = item.time; if (item.on) player.play().catch(() => {}); }
  }
  const dialog = app.querySelector('dialog');
  if (dialog) {
    dialog.showModal();
    if (sameDialog && focus?.id) document.getElementById(focus.id)?.focus();
  }
}

function shell(title, body) {
  return '<dialog data-dialog="' + ui.dialog.type + '" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title">' +
    h(title) + '</h2>' + button('×', 'close', 'class="close" aria-label="Close dialog"') + '</div><div class="dialog-body">' +
    (ui.flash ? '<p class="flash" role="status">' + h(ui.flash) + '</p>' : '') + body + '</div></dialog>';
}

// One line per person: name, role, partial hours.
function nameLine(row, index, focus = -1) {
  return '<div class="name-row' + (row?.check ? ' check' : '') + '"><input name="person" list="known-names" maxlength="80" autocomplete="off" placeholder="Name" aria-label="Name ' +
    (index + 1) + '" value="' + h(row?.person || '') + '"' + (index === focus ? ' autofocus' : '') + '><select name="role" aria-label="Role for name ' + (index + 1) + '">' +
    [['', 'No role'], ...Object.entries(ROLE_LABELS)].map(([value, label]) => '<option value="' + value + '"' + ((row?.role || '') === value ? ' selected' : '') + '>' + label + '</option>').join('') +
    '</select><input name="hours" maxlength="9" autocomplete="off" placeholder="7-3" pattern="\\d{1,2}(:\\d{2})?-\\d{1,2}(:\\d{2})?" title="Partial hours like 7-3 or 7-3:30" aria-label="Partial hours for name ' + (index + 1) + '" value="' + h(row?.hours || '') + '"></div>';
}
const nameLines = (rows, focus) => '<div class="name-rows">' + Array.from({ length: Math.max(rows.length + 2, 5) }, (_, index) => nameLine(rows[index], index, focus)).join('') + '</div>' +
  '<p>' + button('＋ More lines', 'more-lines', 'class="text-button"') + '</p>';
const knownList = names => '<datalist id="known-names">' + names.map(name => '<option value="' + h(name) + '">').join('') + '</datalist>';
// Reads the name lines of a form into clean rows, one person each.
function readNameLines(form, known) {
  const fields = new FormData(form), roles = fields.getAll('role'), times = fields.getAll('hours');
  const entries = fields.getAll('person').map((person, position) => ({ person, role: roles[position], hours: times[position].trim() }));
  if (entries.some(entry => entry.person.trim() && entry.hours && !HOURS.test(entry.hours))) throw new Error('Write partial hours like 7-3 or 7-3:30.');
  return tidyNames(entries, known);
}

function dialogMarkup() {
  if (!ui.dialog) return '';
  const { type, row, kind, id, chosen } = ui.dialog;
  if (type === 'import') {
    if (ui.busy) return shell('Reading the schedule', '<p role="status">' + h(ui.busy) + '</p><div class="progress"><i></i></div><p>Processing stays on this device.</p>');
    if (!ui.pending) return shell('Import schedule photos',
      '<p>Use a batch of screenshots. The app combines overlapping dates into a single draft and flags cells it could not read.</p>' +
      (publicDemo ? '<p class="subtle">The public demo uses fictional screenshots only.</p>' :
        '<label class="drop" id="drop-zone"><b>Choose or drop photos</b><span>PNG, JPEG or WebP · up to 20 pages</span><input id="photos" type="file" multiple accept="image/png,image/jpeg,image/webp"></label>') +
      button('Read 10 sample screenshots', 'samples', 'class="secondary"'));
    const { pending } = ui;
    const unresolved = pending.flags.filter(flag => flag.status === 'open').length;
    return shell('Review import', '<div class="import-stats"><b>' + pending.pages.length + ' pages</b><b>' + pending.assignments.length +
      ' assignments</b><b>' + unresolved + ' to check</b></div>' +
      '<p>Review the flagged cells and check the date span. Duplicate assignments are combined with their source references.</p>' +
      '<details' + (pending.pages.some(page => page.shift) ? ' open' : '') + '><summary>Pages and extracted dates</summary><ul class="compact">' + pending.pages.map(page => '<li>' +
        h(page.name + ' · ' + page.status + (page.dates.length ? ' · ' + page.dates.at(0) + ' to ' + page.dates.at(-1) : '')) +
        (page.shift ? ' · <b>' + (page.shift === 'N' ? 'Night' : 'Day') + ' schedule</b>' + (page.shiftGuessed ? ' (guessed) ' : ' ') +
          button('Switch to ' + (page.shift === 'N' ? 'Day' : 'Night'), 'flip-page', 'class="text-button" ' + valueAttr(page.page)) : '') +
        '</li>').join('') + '</ul></details>' +
      (pending.people?.length ? '<div class="flag"><p><b>Telephone list: ' + pending.people.length + ' people read.</b> ' +
        pending.people.filter(person => person.check).length + ' need a closer look.</p>' + button('Check and save the directory', 'people-review', 'class="primary"') + '</div>' : '') +
      (unresolved ? '<p>' + button('Review ' + unresolved + ' flagged ' + (unresolved === 1 ? 'shift' : 'shifts'), 'review-flags', 'class="primary"') + '</p>' : '') +
      (pending.flags.length ? '<div class="flags">' + pending.flags.map((flag, index) => '<div class="flag"><p>' + h(flag.message) + '</p><small>' +
        h((flag.draft.date ? flag.draft.date.slice(5).replace('-', '/') + ' · ' : '') + flag.source.file + ' · ' + flag.status) + '</small> ' +
        button('Review', 'flag', 'class="text-button" ' + valueAttr(index)) + '</div>').join('') + '</div>' : '') +
      (pending.issues.length ? '<ul class="compact">' + pending.issues.slice(0,20).map(issue => '<li>' +
        h(issue.date + ' · ' + issue.message) + '</li>').join('') + '</ul>' : '<p class="good">No structural issues were flagged.</p>') +
      '<div class="actions">' + button('Start over', 'clear-draft', 'class="secondary"') +
      button('Publish to this workspace', 'publish', 'class="primary" ' + (!pending.assignments.length || unresolved ? 'disabled' : '')) + '</div>');
  }
  if (type === 'over') {
    const { date, shift } = ui.dialog;
    const listed = state.assignments.filter(item => item.date === date && item.shift === shift && state.directory[normalizeName(item.person)]?.status !== 'Student');
    const order = releaseOrder([...new Set(listed.map(item => item.person))], state.releases);
    const first = firstInLine(order);
    const usual = staffing(state.assignments, shift, state.directory).usual;
    const done = state.releases.filter(item => item.date === date && item.shift === shift);
    return shell('Low census · ' + shiftCaption({ date, shift }), '<p><b>' + order.length + '</b> people are listed and <b>' + usual + '</b> is usual.</p>' +
      (first.length === 1 ? '<p>Next in line: <b>' + h(first[0]) + '</b>.</p>' : '<p>Tied for next: <b>' + h(first.join(', ')) + '</b>. They have lost the same hours, so this app has no basis to choose between them.</p>') +
      (done.length ? '<p class="subtle">Recorded: ' + h(done.map(item => item.person + ', ' + item.hours + ' h, ' + (item.voluntary ? 'offered' + (item.inPlaceOf ? ' in place of ' + item.inPlaceOf : '') : 'sent home')).join('; ')) + '</p>' : '') +
      '<div class="line-list">' + order.map(item => '<div><span><b>' + h(item.person) + '</b> <small>' + item.hours + ' hours lost so far' + (item.last ? ', last released ' + h(dayLabel(item.last, { month:'short', day:'numeric' })) : '') +
        '</small></span>' + button('Went home', 'release', 'class="secondary" ' + valueAttr(listed.find(entry => isSame(entry.person, item.person)).key)) + '</div>').join('') + '</div>' +
      '<p class="subtle">Whoever has lost the fewest hours goes first. Hours count the same whether a person offered or was sent.</p>');
  }
  if (type === 'release') {
    const working = state.assignments.filter(item => item.date === row.date && item.shift === row.shift && state.directory[normalizeName(item.person)]?.status !== 'Student').map(item => item.person);
    const order = releaseOrder([...new Set(working)], state.releases);
    const first = firstInLine(order);
    return shell('Low census · ' + shiftCaption(row), '<p><b>' + h(row.person) + '</b> went home early.</p>' +
      '<p class="subtle">' + (first.length === 1 ? 'Next in line for a cut on this shift: <b>' + h(first[0]) + '</b> (' + order[0].hours + ' hours so far).' : 'Tied for next on this shift: <b>' + h(first.join(', ')) + '</b>.') +
      ' Hours count the same whether someone offered or was sent, so offering never moves a person to the front.</p>' +
      '<form data-form="release"><input type="hidden" name="key" value="' + h(row.key) + '"><label>Hours not worked<input name="hours" type="number" min="0.5" max="12" step="0.5" required></label>' +
      '<label>How it happened<select name="how"><option value="voluntary">Offered to go home</option><option value="directed">Was sent home</option></select></label>' +
      '<label>If they offered, whose turn did they take?<select name="inPlaceOf"><option value="">Nobody else was up</option>' +
      order.filter(item => !isSame(item.person, row.person)).map(item => '<option' + (first.length === 1 && isSame(first[0], item.person) ? ' selected' : '') + '>' + h(item.person) + '</option>').join('') +
      '</select></label><div class="actions"><button class="primary">Save</button></div></form>');
  }
  if (type === 'people-review') {
    const list = ui.pending.people;
    const row = (person, index) => '<div class="person-row' + (person.check ? ' check' : '') + '">' + (ui.dialog.images?.[person.source.page] ? stripMarkup(ui.dialog.images[person.source.page], person.source.box) : '') +
      '<div class="person-fields"><input name="last" aria-label="Last name ' + (index + 1) + '" placeholder="Last name" maxlength="60" value="' + h(person.last) + '">' +
      '<input name="first" aria-label="First name ' + (index + 1) + '" placeholder="First name" maxlength="60" value="' + h(person.first) + '">' +
      '<select name="group" aria-label="Group ' + (index + 1) + '">' + GROUPS.map(group => '<option' + (person.group === group ? ' selected' : '') + '>' + group + '</option>').join('') + '</select>' +
      '<input name="cell" aria-label="Cell ' + (index + 1) + '" placeholder="Cell" inputmode="tel" maxlength="16" value="' + h(formatPhone(person.cell)) + '">' +
      '<input name="office" aria-label="Office ' + (index + 1) + '" placeholder="Office" maxlength="8" value="' + h(person.office) + '">' +
      '<input type="hidden" name="title" value="' + h(person.title) + '"><input type="hidden" name="role" value="' + h(person.role) + '"></div></div>';
    return shell('Check the directory', '<p>Compare each line with the strip of the photo above it. Shaded lines are the ones the reader was unsure of. Clear a last name to leave someone out.</p>' +
      '<form data-form="people"><div class="person-rows">' + list.map(row).join('') + '</div><div class="actions">' +
      button('Back', 'import', 'class="secondary"') + '<button class="primary">Save ' + list.length + ' people</button></div></form>');
  }
  if (type === 'flag') {
    const flag = ui.pending.flags[id];
    const left = ui.pending.flags.filter(item => item.status === 'open').length;
    const existing = flagCellRows(flag);
    const suggested = flagCellFlags(flag).map(item => item.draft)
      .filter((draft, index, all) => draft.person && !existing.some(row => isSame(row.person, draft.person)) &&
        all.findIndex(other => other.person && isSame(other.person, draft.person)) === index);
    // Listed top to bottom, the way they sit on the page.
    const height = item => (item.sources || [item.source]).find(source => source?.page === flag.source.page)?.box?.[1] ?? Infinity;
    const rows = [...existing.map(row => ({ ...row, check: false, y: height(row) })),
      ...flagCellFlags(flag).filter(item => suggested.includes(item.draft)).map(item => ({ ...item.draft, check: true, y: height(item) }))]
      .sort((a, b) => a.y - b.y);
    const known = [...new Set([...ui.pending.assignments.map(item => item.person), ...actorNames()])].sort((a, b) => a.localeCompare(b));
    const blank = rows.findIndex(row => row.check);
    const focus = blank >= 0 ? blank : rows.length;
    return shell('Check this shift · ' + left + ' left', '<p>' + h(flag.message) + '</p>' + (chosen ? cropMarkup(chosen, flag.source) : '') +
      '<form data-form="correct" data-index="' + id + '"><div class="cell-when"><label>Date<input name="date" type="date" value="' + h(flag.draft.date) +
      '" required></label><label>Shift<select name="shift"><option value="D"' + (flag.draft.shift === 'D' ? ' selected' : '') +
      '>Day</option><option value="N"' + (flag.draft.shift === 'N' ? ' selected' : '') + '>Night</option></select></label></div>' +
      '<p class="subtle">One line per person. Fix a name, add anyone missing, or clear a line to remove someone. A name entered twice is kept once.' +
      (suggested.length ? ' Shaded names are unsure readings.' : '') + '</p>' +
      nameLines(rows, focus) + knownList(known) + '<div class="actions">' +
      button('Leave as read', 'dismiss-flag', 'class="secondary" ' + valueAttr(id)) +
      '<button class="primary">Save and next</button></div></form>');
  }
  if (type === 'shift') return shell(shiftCaption(row), '<p><b>' + h(row.person) + '</b> · ' + h(row.date) +
    (row.role ? ' · ' + h(ROLE_LABELS[row.role] || row.role) : '') + (row.hours ? ' · ' + h(row.hours) : '') + '</p>' +
    (contactFor(row.person)?.cell && !isMine(row) ? '<p class="person-lines"><span>' + h(formatPhone(contactFor(row.person).cell)) + '</span>' + contactButtons(contactFor(row.person)) + '</p>' : '') +
    (row.sources.length ? '<p>' + button('See photo source', 'source', 'class="text-button" ' + valueAttr(row.key)) +
      ' <small>' + h(row.sources.length + ' source page(s)') + '</small></p>' : '<p class="subtle">' + (row.manual ? 'Added by hand. There is no photo for this line.' :
      state.mode === 'sample' ? 'Fictional starting roster. Import sample photos to see image evidence.' : 'There is no photo for this line.') + '</p>') +
    (state.releases.some(item => item.key === row.key) ? '<p class="subtle">Low census recorded: ' + h(state.releases.filter(item => item.key === row.key).map(item =>
      item.hours + ' h, ' + (item.voluntary ? 'offered to go' + (item.inPlaceOf ? ' in place of ' + item.inPlaceOf : '') : 'sent home')).join('; ')) + '</p>' : '') +
    '<p>' + button('Record low census (VA)', 'release', 'class="text-button" ' + valueAttr(row.key)) + ' ' +
      button('Edit names on this shift', 'edit-shift', 'class="text-button" ' + valueAttr(row.date + '|' + row.shift)) + '</p>' +
    (agreedRequestFor(row) ? '<p class="subtle">This shift is part of an agreed request that is queued for review. It cannot be offered again until that is settled.</p>' +
      '<div class="actions">' + button('Open the request', 'thread', 'class="secondary" ' + valueAttr(agreedRequestFor(row).id)) + '</div>' :
    isMine(row) ? '<div class="actions">' + button('Trade this shift', 'matches', 'class="primary" data-kind="trade" ' + valueAttr(row.key)) +
      button('Find coverage', 'matches', 'class="secondary" data-kind="coverage" ' + valueAttr(row.key)) + '</div>' : ''));
  if (type === 'source') return shell('Original photo', chosen ? imageMarkup(chosen, row.sources[0]) : '<p>The photo is unavailable in this browser.</p>');
  if (type === 'matches') {
    const list = matches(row, kind);
    return shell(kind === 'trade' ? 'Find a trade' : 'Find coverage', '<p>' + h(row.person + ' · ' + shiftCaption(row)) + '</p>' +
      (state.mode === 'local' ? '<p class="subtle">Imported rows are a snapshot. A request can start while hours and credentials are being verified.</p>' : '') +
      (list.length ? '<div class="match-list">' + list.map((match, index) => button(avatar(match.recipient) + '<span><b>' +
        h(match.recipient) + '</b><small>' + h(match.to ? shiftCaption(match.to) : 'Take this shift') + '</small></span><em>' +
        (match.check.status === 'review' ? 'Needs verification' : 'Eligible in sample') + '</em>', 'choose', 'class="match" ' + valueAttr(index))).join('') +
        '</div>' : '<p class="subtle">There are no eligible matches in this roster. Try a different shift.</p>'));
  }
  if (type === 'request') return shell('Send shift request', '<p><b>' + h(chosen.recipient) + '</b> · ' + h(shiftCaption(row)) +
    (chosen.to ? ' ↔ ' + h(shiftCaption(chosen.to)) : '') + '</p><p class="subtle">' + h(chosen.check.reason) +
    '</p><form data-form="request"><label>Message<textarea name="body" maxlength="800" placeholder="Can you make this trade?"></textarea></label>' +
    '<button class="primary">Send request</button></form>');
  if (type === 'thread') {
    const request = state.requests.find(entry => entry.id === id);
    if (!request) return '';
    return shell(request.kind === 'trade' ? 'Trade conversation' : 'Coverage conversation',
      '<span class="badge">' + h(request.status) + '</span><p>' + h(request.from.person + ' → ' + request.recipient + ' · ' + shiftCaption(request.from)) +
      (request.to ? ' ↔ ' + h(shiftCaption(request.to)) : '') + '</p><p class="subtle">' + h(request.check.reason) + '</p>' +
      '<div class="thread">' + request.messages.map(message => '<article><b>' + h(message.author) + '</b><p>' + h(message.body) + '</p></article>').join('') +
      '</div><form data-form="reply"><label>Reply<input name="body" maxlength="800" required></label><button class="secondary">Send reply</button></form>' +
      (request.status === 'Awaiting reply' && isSame(state.actor, request.recipient) ?
        '<div class="actions">' + button('Decline', 'decision', 'class="secondary" data-value="decline"') +
        button('Accept and queue for review', 'decision', 'class="primary" data-value="accept"') + '</div>' : '') +
      (request.status === 'Awaiting reply' && isSame(state.actor, request.from.person) && contactFor(request.recipient)?.cell ?
        '<p class="person-lines"><span class="subtle">This app cannot notify ' + h(request.recipient) + ' yet. Send it from your phone:</span>' +
        contactButtons(contactFor(request.recipient), requestText(request)) + '</p>' : '') +
      (request.status.startsWith('Both agreed') ? '<p class="subtle">Agreement recorded here. A coordinator can review and enter it in the official system.</p>' : ''));
  }
  if (type === 'audit') return shell('Decision history', '<p class="subtle">Local receipts are linked by hash. Exported receipts can be checked independently. A local owner can replace the whole history.</p>' +
    (state.events.length ? '<ul class="compact">' + [...state.events].reverse().slice(0,25).map(event => '<li>' +
      h(event.type + ' · ' + timeLabel(event.time) + ' · ' + event.hash.slice(0,12)) + '</li>').join('') + '</ul>' : '<p>No decisions recorded yet.</p>') +
    '<div class="actions">' + button('Export receipts', 'export', 'class="secondary"') +
    (!publicDemo ? button('Backup and restore', 'data', 'class="text-button"') : '') + '</div>');
  if (type === 'staff-setup') {
    const name = chosen || state.actor;
    const profile = state.directory[normalizeName(name)] || { skills:[] };
    return shell('Staff details', '<p>Add confirmed information for roster-based matching. Actual hours and pickups still need review.</p>' +
      '<label for="staff-select">Staff member</label><select id="staff-select">' +
      actorNames().map(person => '<option' + (isSame(name,person) ? ' selected' : '') + '>' + h(person) + '</option>').join('') +
      '</select><form data-form="profile"><input type="hidden" name="person" value="' + h(name) + '">' +
      '<label>Status<select name="status"><option value="">Unknown</option><option' + (profile.status === 'Staff' ? ' selected' : '') +
      '>Staff</option>' + ['Contract', 'PRN', 'Student'].map(status => '<option' + (profile.status === status ? ' selected' : '') + '>' + status + '</option>').join('') + '</select></label>' +
      '<label><span><input type="checkbox" name="day"' + (profile.skills.includes('D') ? ' checked' : '') + '> Qualified for day shift</span></label>' +
      '<label><span><input type="checkbox" name="night"' + (profile.skills.includes('N') ? ' checked' : '') + '> Qualified for night shift</span></label>' +
      '<label>Weekends<select name="arrangement"><option value="">Regular rotation</option><option value="weekend-only"' + (profile.arrangement === 'weekend-only' ? ' selected' : '') +
      '>Weekend-only position</option><option value="weekend-volunteer"' + (profile.arrangement === 'weekend-volunteer' ? ' selected' : '') + '>Regular position, taking extra weekends by choice</option></select></label>' +
      '<p class="subtle">Either choice takes this person’s weekend shifts out of the rotation, so nobody else is measured against them. Extra weekends taken by choice are shown as credit.</p>' +
      '<label><span><input type="checkbox" name="keeper"' + (state.custodians.includes(normalizeName(name)) ? ' checked' : '') + '> Keeps the fairness record (sees everyone’s numbers)</span></label>' +
      '<button class="primary">Save staff details</button></form>');
  }
  if (type === 'voice') {
    const body = !voice || voice.state === 'asking' ? '<p>Allow the microphone when the browser asks. Recording starts right away.</p>' :
      voice.state === 'error' ? '<p>' + h(voice.message) + '</p><div class="actions">' + button('Try again', 'voice', 'class="primary"') + '</div>' :
      voice.state === 'recording' ? '<div class="recording"><span class="rec-dot"></span><b id="voice-clock">0:00</b></div>' +
        '<div class="actions center">' + button('■ Stop', 'voice-stop', 'class="primary big"') + '</div><p class="subtle center">Stops by itself at ' + clock(VOICE_LIMIT_SECONDS) + '. ' + RULE + '</p>' :
      '<audio class="post-audio" data-media="voice-preview" src="' + voice.url + '" controls></audio><form data-form="voice">' +
        '<label>What is it about? (optional)<input name="caption" maxlength="200" autocomplete="off" placeholder="Shift change at 7, new filters in the supply room"></label>' +
        '<label><span><input type="checkbox" name="inside"> Keep inside the department (no Share button)</span></label>' +
        '<p class="subtle">' + clock(voice.seconds) + ' recorded. ' + RULE + '</p>' +
        '<div class="actions">' + button('Record again', 'voice', 'class="secondary"') + '<button class="primary">Send to the department</button></div></form>';
    return shell('Voice message to everyone', body);
  }
  if (type === 'share') {
    const post = state.posts.find(item => item.id === id);
    if (!post) return '';
    const text = shareText(post), files = (post.media || []).filter(item => mediaUrls.get(item.id));
    return shell('Share this post', '<p class="subtle">On a phone, Share opens the phone’s own share sheet, which sends the file itself to Messages, Mail, YouTube or any other app. Here, use these.</p>' +
      '<textarea id="share-text" readonly rows="3">' + h(text) + '</textarea>' +
      '<div class="actions wrap">' + button('Copy the words', 'copy-share', 'class="secondary" ' + valueAttr(post.id)) +
      '<a class="secondary link-button" href="mailto:?subject=' + encodeURIComponent('From the department board') + '&body=' + encodeURIComponent(text) + '">Email</a>' +
      '<a class="secondary link-button" href="sms:?&body=' + encodeURIComponent(text) + '">Text message</a></div>' +
      (files.length ? '<h3>Files</h3><p class="subtle">Email and text carry the words only. Download the file, then attach or upload it wherever it needs to go.</p>' +
        files.map(item => '<a class="post-file" href="' + mediaUrls.get(item.id) + '" download="' + h(item.name) + '"><b>' + h(item.name) + '</b><span>' + fileSize(item.size) + ' · Download</span></a>').join('') : ''));
  }
  if (type === 'remove-post') return shell('Remove this post?', '<p>It is taken off the board together with its files. This cannot be undone.</p><div class="actions">' +
    button('Keep it', 'close', 'class="secondary"') + button('Remove it', 'remove-post-yes', 'class="danger" ' + valueAttr(id)) + '</div>');
  if (type === 'holiday-rules') {
    const rules = state.holidayRules;
    return shell('Which holidays count', '<form data-form="holidays"><p class="subtle">Untick a day your department does not treat as a holiday. Add any day of your own.</p>' +
      HOLIDAY_NAMES.map(name => '<label><span><input type="checkbox" name="on" value="' + h(name) + '"' + (rules.off.includes(name) ? '' : ' checked') + '> ' + h(name) + '</span></label>').join('') +
      rules.extra.map((item, index) => '<label><span><input type="checkbox" name="keep" value="' + index + '" checked> ' + h(item.name + ' · ' + item.date) + '</span></label>').join('') +
      '<h3>Add a day</h3><div class="cell-when"><label>Name<input name="name" maxlength="40" autocomplete="off" placeholder="Easter"></label><label>Date<input name="date" type="date"></label></div>' +
      '<div class="actions"><button class="primary">Save</button></div></form>');
  }
  if (type === 'edit-shift') {
    const { date, shift } = ui.dialog;
    const rows = state.assignments.filter(item => item.date === date && item.shift === shift);
    return shell('Who is on · ' + shiftCaption({ date, shift }), '<form data-form="edit-shift"><input type="hidden" name="date" value="' + h(date) + '"><input type="hidden" name="shift" value="' + h(shift) + '">' +
      '<p class="subtle">One line per person. Add a name, fix one, or clear a line to take someone off. A name entered twice is kept once.</p>' +
      nameLines(rows, rows.length) + knownList(actorNames()) + '<div class="actions"><button class="primary">Save</button></div></form>');
  }
  if (type === 'data') {
    const { restore, confirmErase } = ui.dialog;
    // A step that replaces or removes everything gets the sheet to itself: one question, two answers.
    if (restore) return shell('Restore this backup?', '<p><b>' + h(restore.name) + '</b> holds ' + restore.state.assignments.length + ' shifts and ' + (restore.state.people || []).length + ' contacts' +
      (restore.savedAt ? ', saved ' + h(timeLabel(restore.savedAt)) : '') + '.</p><p>Restoring replaces what is in this browser now' +
      (state.mode === 'sample' ? ' (sample names).' : ' (' + state.assignments.length + ' shifts).') + '</p><div class="actions">' +
      button('Cancel', 'data', 'class="secondary"') + button('Replace this workspace with the backup', 'restore', 'class="danger"') + '</div>');
    if (confirmErase) return shell('Erase everything in this browser?', '<p><b>This cannot be undone.</b> ' + (state.mode === 'sample' ? 'The sample workspace will be reset.' :
      state.assignments.length + ' shifts and ' + state.people.length + ' contacts will be removed. Save a backup file first if you might want them back.') + '</p><div class="actions">' +
      button('Cancel', 'data', 'class="secondary"') + button('Erase everything in this browser', 'erase', 'class="danger"') + '</div>');
    return shell('Workspace data', '<p>This workspace is kept in this browser only, at <b>' + h(location.host) + '</b>. A different browser, or a different address, starts with sample names.</p>' +
      '<p><b>' + state.assignments.length + '</b> shifts · <b>' + state.people.length + '</b> contacts · ' + h(state.mode === 'sample' ? 'sample workspace' : 'published ' + timeLabel(state.importedAt)) + ' · version ' + BUILD + '</p>' +
      '<h3>Backup</h3><p class="subtle">A backup file holds the schedule, the contacts with their phone numbers, requests and history. Photos, videos and recordings are not included. Keep the file somewhere private.</p>' +
      '<p>' + button('Save a backup file', 'backup', 'class="primary"') + '</p>' +
      '<label class="drop"><b>Restore from a backup file</b><span>Choose a file saved with the button above</span><input id="backup-file" type="file" accept="application/json,.json"></label>' +
      (() => {
        const usage = loadState(usageKey, null), rows = Object.entries(usage?.counts || {}).sort((a, b) => b[1] - a[1]);
        return '<h3>How this copy gets used</h3><p class="subtle">Which buttons get pressed, by button name and total only. No names, no shifts, no typed words, no recordings. Kept in this browser and left out of backups.</p>' +
          (rows.length ? '<div class="usage">' + rows.slice(0, 15).map(([name, total]) => '<div><span>' + h(USAGE_NAMES[name] || name) + '</span><b>' + total + '</b></div>').join('') + '</div>' +
            '<p class="subtle">' + rows.reduce((sum, row) => sum + row[1], 0) + ' presses since ' + h(usage.since) + '.</p><p>' + button('Copy the counts', 'usage-copy', 'class="secondary"') + ' ' +
            button('Reset the counts', 'usage-reset', 'class="secondary"') + '</p>' : '<p class="subtle">Nothing counted yet.</p>');
      })() +
      '<h3>Start over</h3><p class="subtle">Clears the roster, contacts, source photos, messages and receipts from this browser and brings back the sample names.</p>' +
      button('Erase local workspace', 'erase-ask', 'class="secondary"'));
  }
  return '';
}

// Rows and open flags that belong to the same date and shift on the same photo as a flag.
function flagCellRows(flag) {
  return flag.draft.date ? ui.pending.assignments.filter(item => item.date === flag.draft.date && item.shift === flag.draft.shift &&
    item.sources.some(source => source.page === flag.source.page)) : [];
}
function flagCellFlags(flag) {
  return flag.draft.date ? ui.pending.flags.filter(item => item.status === 'open' && item.source.page === flag.source.page &&
    item.draft.date === flag.draft.date && item.draft.shift === flag.draft.shift) : [flag];
}
async function nextFlag(after = -1) {
  clearPreview();
  const open = ui.pending.flags.map((flag, index) => ({ flag, index })).filter(entry => entry.flag.status === 'open');
  const next = open.find(entry => entry.index > after) || open[0];
  ui.dialog = next ? { type:'flag', id:next.index, chosen:await showSource(next.flag.source) } : { type:'import' };
}

// The part of the photo a flag points at, enlarged. A small box is a single name, so its surroundings are included.
function cropMarkup(image, source) {
  const box = source.box;
  if (!box || box[2] <= box[0] || box[3] <= box[1]) return imageMarkup(image, source);
  const [x0, y0, x1, y1] = box;
  const cell = x1 - x0 > image.width * 0.06 && y1 - y0 > image.height * 0.08;
  const padX = cell ? (x1 - x0) * 0.1 : Math.max((x1 - x0) * 0.6, image.width * 0.05);
  const padY = cell ? (y1 - y0) * 0.1 : (y1 - y0) * 3.5;
  const left = Math.max(0, x0 - padX), top = Math.max(0, y0 - padY);
  const width = Math.min(image.width, x1 + padX) - left, height = Math.min(image.height, y1 + padY) - top;
  const percent = value => (value * 100).toFixed(3) + '%';
  return '<figure class="source-image"><div class="source-crop" style="aspect-ratio:' + width + '/' + height + ';max-width:calc(44vh*' + (width / height).toFixed(3) + ')">' +
    '<img src="' + h(image.url) + '" alt="' + h(source.file) + '" style="width:' + percent(image.width / width) + ';left:' + percent(-left / width) + ';top:' + percent(-top / height) + '">' +
    (cell ? '' : '<span class="source-box" style="left:' + percent((x0 - left) / width) + ';top:' + percent((y0 - top) / height) +
      ';width:' + percent((x1 - x0) / width) + ';height:' + percent((y1 - y0) / height) + '"></span>') +
    '</div><figcaption>' + h(source.file) + '</figcaption></figure>';
}

function imageMarkup(image, source) {
  const box = source.box;
  return '<figure class="source-image"><div><img src="' + h(image.url) + '" alt="' + h(source.file) + '">' +
    (box ? '<span class="source-box" style="left:' + box[0] / image.width * 100 + '%;top:' + box[1] / image.height * 100 +
      '%;width:' + (box[2] - box[0]) / image.width * 100 + '%;height:' + (box[3] - box[1]) / image.height * 100 + '%"></span>' : '') +
    '</div><figcaption>' + h(source.file) + '</figcaption></figure>';
}

function matches(row, kind) {
  const directory = state.directory;
  const pool = kind === 'trade' ? state.assignments.filter(to => to.date !== row.date && !isSame(to.person,row.person)).map(to => ({
    to, recipient: to.person
  })) : Object.values(directory).filter(profile => !isSame(profile.person,row.person)).map(profile => ({ recipient: profile.person }));
  return pool.map(match => ({ ...match, check: checkChange({ from: row, kind, ...match }) }))
    .filter(match => match.check.status !== 'blocked')
    .sort((a,b) => (a.check.status === b.check.status ? 0 : a.check.status === 'eligible' ? -1 : 1) ||
      (a.to && b.to ? Math.abs(toDate(a.to.date) - toDate(row.date)) - Math.abs(toDate(b.to.date) - toDate(row.date)) : 0) ||
      a.recipient.localeCompare(b.recipient)).slice(0,40);
}

const pageUrls = new Map();
function clearPreview() {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = null;
  for (const url of pageUrls.values()) URL.revokeObjectURL(url);
  pageUrls.clear();
}
async function loadPages(pages) {
  const images = {};
  for (const page of new Set(pages)) {
    const data = await getSource(page);
    if (!data) continue;
    pageUrls.set(page, URL.createObjectURL(data.file));
    images[page] = { ...data, url: pageUrls.get(page) };
  }
  return images;
}
// One line of a photographed list, shown as a wide strip.
function stripMarkup(image, box) {
  const padX = image.width * 0.02, padY = (box[3] - box[1]) * 0.35;
  const left = Math.max(0, box[0] - padX), top = Math.max(0, box[1] - padY);
  const width = Math.min(image.width, box[2] + padX) - left, height = Math.min(image.height, box[3] + padY) - top;
  const percent = value => (value * 100).toFixed(3) + '%';
  return '<div class="source-crop strip" style="aspect-ratio:' + width + '/' + height + '"><img src="' + h(image.url) + '" alt="" style="width:' +
    percent(image.width / width) + ';left:' + percent(-left / width) + ';top:' + percent(-top / height) + '"></div>';
}
function requestText(request) {
  const first = contactFor(request.recipient)?.first || request.recipient;
  return 'Hi ' + first + ', it is ' + state.actor + '. ' + (request.to
    ? 'Could you trade your ' + shiftCaption(request.to) + ' shift for my ' + shiftCaption(request.from) + ' shift?'
    : 'Could you take my ' + shiftCaption(request.from) + ' shift?');
}
async function showSource(source) {
  clearPreview();
  if (!source?.page) return null;
  const data = await getSource(source.page);
  if (!data) return null;
  sourceUrl = URL.createObjectURL(data.file);
  return { ...data, url: sourceUrl };
}

async function importFiles(files, sampleImport = false) {
  if (!files.length || ui.busy || (publicDemo && !sampleImport)) return;
  if (files.length > 20 || files.some(file => file.size > 20 * 1024 * 1024 ||
      !/^(image\/(png|jpeg|webp))$/.test(file.type))) throw new Error('Choose up to 20 PNG, JPEG or WebP files, each 20 MB or less.');
  ui.dialog = { type:'import' };
  ui.busy = 'Starting the on-device photo reader…';
  ui.notice = '';
  render();
  try {
    const { readBatch } = await import('./importer.js');
    ui.pending = await readBatch(files, (current, count) => {
      ui.busy = 'Reading photo ' + current + ' of ' + count + '…';
      render();
    }, putSource);
    ui.pending.sample = sampleImport;
  } finally {
    ui.busy = null;
    saveDraft();
    render();
  }
}

app.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  countPress(control.dataset.action, control.dataset.value);
  if (control.dataset.action === 'play-link') {
    const box = control.closest('.link-player'), frame = document.createElement('iframe');
    frame.src = box.dataset.embed;
    frame.title = 'Video player';
    frame.allow = 'autoplay; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    box.replaceChildren(frame);
    return;
  }
  void act(control.dataset).catch(error => {
    ui.notice = error.message || String(error);
    if (!ui.busy) ui.dialog = null;
    render();
  }).finally(saveDraft);
});
app.addEventListener('change', event => {
  if (event.target.id === 'actor') {
    state = { ...state, actor: event.target.value };
    saveState(storageKey, state);
    render();
  }
  if (event.target.id === 'staff-select') { ui.dialog = { type:'staff-setup', chosen:event.target.value }; render(); }
  if (event.target.dataset.link) {
    const key = normalizeName(event.target.dataset.link), value = event.target.value;
    void commit('Contact matched', { name: key }, previous => withContacts({ ...previous, manualLinks: { ...previous.manualLinks, [key]: value } })).then(render).catch(fail);
  }
  if (event.target.id === 'photos') void importFiles([...event.target.files]).catch(fail);
  if (event.target.id === 'backup-file' && event.target.files[0]) void readBackup(event.target.files[0]).catch(fail);
});
// A backup file made by this app, or a bare workspace. Nothing is replaced until the person confirms.
async function readBackup(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error('That file is too large to be a Department Hub backup.');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('That file could not be read as a Department Hub backup.'); }
  const saved = parsed?.app === 'department-hub' && parsed.state ? parsed.state : parsed;
  const valid = saved && Array.isArray(saved.assignments) && saved.assignments.every(row => /^\d{4}-\d{2}-\d{2}$/.test(row?.date) && SHIFTS[row.shift] && typeof row.person === 'string' && Array.isArray(row.sources)) &&
    ['sample', 'local'].includes(saved.mode) && typeof saved.actor === 'string';
  if (!valid) throw new Error('That file is not a Department Hub backup.');
  ui.dialog = { type:'data', restore:{ name:file.name, savedAt:parsed.savedAt || saved.importedAt || null, state:saved } };
  render();
}
// A recording made in the browser often carries no length, so the player cannot show one or seek. Asking it to jump far
// past the end makes the browser work the length out. Media events do not bubble, so this listens on the way down.
app.addEventListener('loadedmetadata', event => {
  const player = event.target;
  if (!player.matches?.('audio, video') || Number.isFinite(player.duration)) return;
  const back = () => { player.removeEventListener('timeupdate', back); player.currentTime = 0; };
  player.addEventListener('timeupdate', back);
  player.currentTime = 1e101;
}, true);
app.addEventListener('dragover', event => { if (event.target.closest('#drop-zone')) event.preventDefault(); });
app.addEventListener('drop', event => {
  if (!event.target.closest('#drop-zone')) return;
  event.preventDefault();
  void importFiles([...event.dataTransfer.files]).catch(fail);
});
app.addEventListener('cancel', event => {
  if (event.target.tagName !== 'DIALOG') return;
  event.preventDefault();
  if (!ui.busy) { clearPreview(); stopVoice(); ui.dialog = null; render(); }
}, true);
// Voice message: one tap starts, one tap stops, then send.
// AAC in an .m4a plays almost anywhere, so it comes first. Plain "audio/mp4" comes last: Safari makes AAC from it, but
// Chrome would put Opus inside the mp4, which few other players open.
const voiceType = () => ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
function stopVoice() {
  if (!voice) return;
  const session = voice;
  voice = null;
  clearInterval(session.timer);
  try { if (session.recorder?.state === 'recording') session.recorder.stop(); } catch { /* already stopped */ }
  session.stream?.getTracks().forEach(track => track.stop());
  if (session.url) URL.revokeObjectURL(session.url);
}
async function startVoice() {
  stopVoice();
  const session = voice = { state: 'asking' };
  ui.dialog = { type:'voice' };
  ui.notice = '';
  render();
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser cannot record on this page. A voice message needs a microphone and a secure address.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (voice !== session) { stream.getTracks().forEach(track => track.stop()); return; }      // closed while the browser was asking
    const type = voiceType(), recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [];
    Object.assign(session, { state: 'recording', stream, recorder, started: performance.now() });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      clearInterval(session.timer);
      if (voice !== session) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      voice = { state: 'review', blob, url: URL.createObjectURL(blob), seconds: Math.max(1, Math.round((performance.now() - session.started) / 1000)) };
      if (ui.dialog?.type === 'voice') render();
    };
    recorder.start();
    session.timer = setInterval(() => {
      const elapsed = (performance.now() - session.started) / 1000, shown = document.getElementById('voice-clock');
      if (shown) shown.textContent = clock(elapsed);
      if (elapsed >= VOICE_LIMIT_SECONDS && recorder.state === 'recording') recorder.stop();
    }, 250);
    render();
  } catch (error) {
    if (voice !== session) return;
    voice = { state: 'error', message: error.name === 'NotAllowedError' ? 'The microphone was not allowed. Allow it for this page in the browser’s site settings, then try again.' :
      error.name === 'NotFoundError' ? 'No microphone was found on this device.' : error.message || String(error) };
    if (ui.dialog?.type === 'voice') render();
  }
}

function fail(error) { ui.notice = error.message || String(error); ui.dialog = null; render(); }

async function act({action, value, kind}) {
  const row = state.assignments.find(item => item.key === value);
  if (action === 'more-lines') {          // added in place, so nothing already typed is lost
    const rows = app.querySelector('dialog .name-rows');
    if (rows) rows.insertAdjacentHTML('beforeend', Array.from({ length: 3 }, (_, index) => nameLine(null, rows.children.length + index)).join(''));
    return;
  }
  ui.notice = '';
  ui.flash = '';
  switch (action) {
    case 'tab': ui.tab = value; ui.dialog = null; break;
    case 'view': ui.view = value; break;
    case 'navigate': ui.date = addDays(ui.date, Number(value)); break;
    case 'today': ui.date = localToday(); break;
    case 'fair-scope': ui.fairScope = value; break;
    case 'holiday-rules': if (isKeeper()) ui.dialog = { type:'holiday-rules' }; break;
    case 'claim-record':
      if (state.custodians.length) return;
      await commit('Record keeper set', { keeper:state.actor }, previous => ({ ...previous, custodians:[normalizeName(previous.actor)] }));
      break;
    case 'export-record': {
      if (!isKeeper()) return;
      const rows = recordRows(), quote = value => '"' + String(value).replace(/"/g, '""') + '"';
      const lines = [['Name', 'Shift', 'Shifts', 'Weekend turns', 'Share', 'Difference', 'Holidays worked', 'Which holidays', 'Charge', 'ICU', 'Low-census turns', 'Low-census hours', 'Offered to go'].map(quote).join(',')];
      for (const pool of ['D', 'N']) {
        const table = ledger(rows, pool, state.directory, state.holidayRules), low = census(rows, pool, state.directory, state.releases, localToday());
        for (const entry of table.people) {
          const cut = low.people.find(item => isSame(item.person, entry.person));
          lines.push([entry.person, pool === 'N' ? 'Night' : 'Day', entry.shifts, entry.weekend, entry.weekendOnly ? '' : entry.weekendFair.toFixed(1),
            entry.weekendOnly ? 'weekend only' : entry.weekendVolunteer ? '+' + entry.weekendExtra.toFixed(1) + ' by choice' : entry.weekendGap.toFixed(1),
            entry.holidays.length, entry.holidays.join('; '), entry.charge, entry.icu, cut?.turns || 0, cut?.hours || 0, cut?.offered || 0].map(quote).join(','));
        }
      }
      const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type:'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'department-hub-record-' + localToday() + '.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      ui.notice = 'The record was saved to your downloads as ' + link.download + '. It lists people by name. Keep it private.';
      break;
    }
    case 'text-size':
      textSize = (textSize + 1) % TEXT_SIZES.length;
      try { localStorage.setItem(textKey, JSON.stringify(TEXT_SIZES[textSize])); } catch { /* still applies for this visit */ }
      applyTextSize();
      ui.notice = 'Text size: ' + TEXT_NAMES[textSize] + '.';
      break;
    case 'usage-reset': localStorage.removeItem(usageKey); ui.flash = 'Counts reset.'; break;
    case 'usage-copy': {
      const usage = loadState(usageKey, null);
      const text = Object.entries(usage?.counts || {}).sort((a, b) => b[1] - a[1]).map(([name, total]) => total + '\t' + (USAGE_NAMES[name] || name)).join('\n');
      try { await navigator.clipboard.writeText('Department Hub button counts since ' + (usage?.since || '') + '\n' + text); ui.flash = 'Counts copied.'; }
      catch { ui.flash = 'Copying was not allowed here.'; }
      break;
    }
    case 'edit-shift': { const [date, shift] = value.split('|'); ui.dialog = { type:'edit-shift', date, shift }; break; }
    case 'erase-ask': ui.dialog = { type:'data', confirmErase:true }; break;
    case 'backup': {
      const file = { app:'department-hub', kind:'backup', version:1, savedAt:new Date().toISOString(), from:location.host, state };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type:'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'department-hub-backup-' + localToday() + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      ui.flash = 'Backup saved to your downloads as ' + link.download + '.';
      break;
    }
    case 'restore': {
      const { restore } = ui.dialog;
      if (!restore) return;
      state = prepare(restore.state);
      saveState(storageKey, state);
      await commit('Workspace restored from a backup', { savedAt:restore.savedAt || null, assignmentCount:state.assignments.length }, previous => previous);
      void hydrateMedia();
      ui.pending = null;
      ui.dialog = null;
      ui.date = startDate();
      ui.view = 'week';
      ui.notice = 'Backup restored: ' + state.assignments.length + ' shifts and ' + state.people.length + ' contacts.';
      break;
    }
    case 'close': if (ui.busy) return; clearPreview(); stopVoice(); ui.dialog = null; break;
    case 'board-filter': ui.boardFilter = value; break;
    case 'voice': void startVoice(); return;
    case 'voice-stop': if (voice?.recorder?.state === 'recording') voice.recorder.stop(); return;
    case 'share': {
      const post = state.posts.find(item => item.id === value);
      if (!post || post.inside) return;
      // Everything up to navigator.share stays synchronous, so the browser still counts it as the person's own tap.
      const files = (post.media || []).map(item => mediaBlobs.get(item.id) ? new File([mediaBlobs.get(item.id)], item.name, { type: item.type || mediaBlobs.get(item.id).type }) : null).filter(Boolean);
      if (navigator.share) {
        const words = { title: 'Department Hub', text: shareText(post) };
        try { await navigator.share(files.length && navigator.canShare?.({ files }) ? { ...words, files } : words); return; }
        catch (error) { if (error.name === 'AbortError') return; }
      }
      ui.dialog = { type:'share', id:post.id };
      break;
    }
    case 'copy-share': {
      const post = state.posts.find(item => item.id === value);
      if (!post) return;
      try { await navigator.clipboard.writeText(shareText(post)); ui.flash = 'Copied.'; }
      catch { ui.flash = 'Select the words in the box and copy them.'; }
      break;
    }
    case 'remove-post': ui.dialog = { type:'remove-post', id:value }; break;
    case 'remove-post-yes': {
      const post = state.posts.find(item => item.id === value);
      if (!post || !isSame(post.author, state.actor)) return;
      await boardStore.remove(post.id);
      forgetMedia((post.media || []).map(item => item.id));
      ui.dialog = null;
      ui.notice = 'Post removed.';
      break;
    }
    case 'import': ui.dialog = { type:'import' }; break;
    case 'samples': {
      ui.busy = 'Opening fictional screenshots…';
      render();
      let files;
      try {
        files = await Promise.all(sample.files.map(async name => {
          const response = await fetch(asset('fixtures/' + name));
          if (!response.ok) throw new Error('A sample screenshot could not load.');
          return new File([await response.blob()], name, { type:'image/png' });
        }));
      } finally { ui.busy = null; }
      await importFiles(files, true);
      return;
    }
    case 'clear-draft': ui.pending = null; break;
    case 'flip-page': {
      // A calendar page is all days or all nights. Switching moves every row and flag that came only from that page.
      const draft = ui.pending;
      const page = draft.pages.find(entry => entry.page === value);
      if (!page?.shift) return;
      const from = page.shift, to = from === 'N' ? 'D' : 'N';
      page.shift = to;
      page.shiftGuessed = false;
      draft.assignments = mergeAssignments(draft.assignments.map(item =>
        item.shift === from && item.sources.every(source => source.page === value) ? { ...item, shift: to } : item));
      for (const flag of draft.flags) if (flag.source.page === value && flag.draft.shift === from) flag.draft.shift = to;
      draft.issues = verifyRoster(draft.assignments);
      break;
    }
    case 'flag': ui.dialog = { type:'flag', id:Number(value), chosen:await showSource(ui.pending.flags[value].source) }; break;
    case 'review-flags': await nextFlag(); break;
    case 'people-review': clearPreview(); ui.dialog = { type:'people-review', images:await loadPages(ui.pending.people.map(person => person.source.page)) }; break;
    case 'dismiss-flag': ui.pending.flags[value].status = 'dismissed'; await nextFlag(Number(value)); break;
    case 'publish': {
      const draft = ui.pending;
      if (!draft?.assignments.length || draft.flags.some(flag => flag.status === 'open')) return;
      const revision = crypto.randomUUID();
      await commit('Roster published', {
        revision, sourceHashes: draft.pages.map(page => page.page),
        assignmentCount: draft.assignments.length, snapshot:draft.assignments, corrections: draft.flags.map(flag => ({ page:flag.source.page, status:flag.status })),
        issues: draft.issues
      }, previous => ({
        ...previous, assignments: draft.assignments, revision, images: draft.pages, importedAt:new Date().toISOString(),
        mode: draft.sample ? 'sample' : 'local',
        posts: (previous.mode === 'sample') === draft.sample ? previous.posts : [],
        requests: (previous.mode === 'sample') === draft.sample ? previous.requests : [],
        hoursVerified: draft.sample,
        ...(draft.sample ? { directory:sampleDirectory, history:[] } : publicationRecord(previous.mode === 'local' ? previous : {}, draft.assignments)),
        actor: draft.assignments.some(item => isSame(item.person, previous.actor)) ? previous.actor : draft.assignments[0].person,
        people: draft.sample ? samplePeople : previous.peopleSource === 'import' ? previous.people : [],
        peopleSource: draft.sample ? 'sample' : 'import',
        manualLinks: (previous.mode === 'sample') === draft.sample ? previous.manualLinks : {},
        releases: (previous.mode === 'sample') === draft.sample ? previous.releases || [] : [],
        holidayRules: (previous.mode === 'sample') === draft.sample ? previous.holidayRules : { off:[], extra:[] },
        custodians: (previous.mode === 'sample') === draft.sample ? previous.custodians : []
      }));
      state = withContacts(state);
      saveState(storageKey, state);
      ui.date = startDate();
      ui.view = 'week';
      ui.pending = null;
      ui.dialog = null;
      ui.notice = 'Schedule published to this workspace.';
      break;
    }
    case 'shift': ui.dialog = { type:'shift', row }; break;
    case 'source': ui.dialog = { type:'source', row, chosen:await showSource(row.sources[0]) }; break;
    case 'matches': if (row && isMine(row)) ui.dialog = { type:'matches', row, kind }; break;
    case 'choose': {
      const current = ui.dialog;
      const chosen = matches(current.row, current.kind)[Number(value)];
      if (chosen) ui.dialog = { ...current, type:'request', chosen };
      break;
    }
    case 'thread': ui.dialog = { type:'thread', id:value }; break;
    case 'decision': {
      const request = state.requests.find(entry => entry.id === ui.dialog.id);
      if (!request || !isSame(state.actor, request.recipient) || request.status !== 'Awaiting reply') return;
      const activeFrom = state.assignments.find(item => item.key === request.from.key);
      const activeTo = request.to ? state.assignments.find(item => item.key === request.to.key) : undefined;
      const check = activeFrom && (!request.to || activeTo) ? checkChange({
        from:activeFrom, to:activeTo, recipient:request.recipient, kind:request.kind
      }, request.id) : { status:'blocked', reason:'An assignment changed after the request was opened.' };
      const status = value === 'decline' ? 'Declined' : check.status === 'blocked' ? 'Blocked after recheck' : AGREED_STATUS;
      await commit('Request response', { id:request.id, status, check }, previous => ({
        ...previous, requests:previous.requests.map(item => item.id === request.id ? { ...item, status, check } : item)
      }));
      break;
    }
    case 'audit': ui.dialog = { type:'audit' }; break;
    case 'pool': ui.pool = value; break;
    case 'release': if (row) ui.dialog = { type:'release', row }; break;
    case 'over': { const [date, shift] = value.split('|'); ui.dialog = { type:'over', date, shift }; break; }
    case 'data': ui.dialog = { type:'data' }; break;
    case 'staff-setup': ui.dialog = { type:'staff-setup' }; break;
    case 'erase':
      await clearSources();
      await boardStore.clear();
      forgetMedia([...mediaBlobs.keys()]);
      localStorage.removeItem(storageKey);
      state = withContacts(structuredClone(initial));
      ui.pending = null;
      ui.dialog = null;
      ui.date = startDate();
      ui.notice = 'Local workspace cleared.';
      break;
    case 'export': {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format:1, rules:state.policy, events:state.events }, null, 2)], { type:'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'department-hub-receipts.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      break;
    }
    default: return;
  }
  render();
}

app.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  countPress('form:' + form.dataset.form);
  void submit(form).catch(fail).finally(saveDraft);
});
async function submit(form) {
  ui.flash = '';
  const data = Object.fromEntries(new FormData(form));
  const body = (data.body || '').trim();
  const message = { author:state.actor, body, created:new Date().toISOString() };
  switch (form.dataset.form) {
    case 'post': {
      const files = [...(form.querySelector('#post-files')?.files || [])];
      if (!body && !files.length) return;
      const refusal = refuseFiles(files);
      if (refusal) { form.querySelector('.refusal').textContent = refusal; return; }     // said in place, so nothing typed is lost
      const media = files.map(file => ({ id:crypto.randomUUID(), name:file.name, type:file.type, size:file.size, kind:mediaKind(file.type, file.name) }));
      const post = { id:crypto.randomUUID(), ...message, ...(media.length ? { media } : {}), ...(data.learning ? { learning:true } : {}), ...(data.inside ? { inside:true } : {}) };
      const send = form.querySelector('button.primary');
      send.disabled = true;
      send.textContent = 'Posting…';
      try { await boardStore.publish(post, media.map((item, index) => [item.id, files[index]])); }
      catch (error) { throw error.name === 'QuotaExceededError' ? new Error('This browser is out of room for files. Remove an old post with a large file, or post a smaller one.') : error; }
      media.forEach((item, index) => { mediaBlobs.set(item.id, files[index]); mediaUrls.set(item.id, URL.createObjectURL(files[index])); });
      ui.boardFilter = 'all';
      break;
    }
    case 'voice': {
      if (voice?.state !== 'review') return;
      const recording = voice;
      const item = { id:crypto.randomUUID(), name:'voice-message-' + localToday() + (/mp4/.test(recording.blob.type) ? '.m4a' : '.webm'), type:recording.blob.type, size:recording.blob.size, kind:'audio', seconds:recording.seconds };
      const file = new File([recording.blob], item.name, { type:recording.blob.type });
      const post = { id:crypto.randomUUID(), author:state.actor, body:(data.caption || '').trim(), created:new Date().toISOString(), voice:true, media:[item], ...(data.inside ? { inside:true } : {}) };
      await boardStore.publish(post, [[item.id, file]]);
      mediaBlobs.set(item.id, file);
      mediaUrls.set(item.id, recording.url);
      voice = null;
      ui.dialog = null;
      ui.tab = 'board';
      ui.boardFilter = 'all';
      ui.notice = 'Voice message posted to the board.' + (boardStore.shared ? '' : ' It is in this browser only for now. Press Share on it to send it out.');
      break;
    }
    case 'profile': {
      const profile = { person:data.person, status:data.status || null, skills:[data.day && 'D', data.night && 'N'].filter(Boolean),
        ...(['weekend-only', 'weekend-volunteer'].includes(data.arrangement) ? { arrangement:data.arrangement } : {}) };
      const id = normalizeName(profile.person);
      await commit('Staff details recorded', { ...profile, keeper:Boolean(data.keeper) }, previous => ({
        ...previous, directory:{ ...previous.directory, [id]:profile },
        custodians: data.keeper ? [...new Set([...previous.custodians, id])] : previous.custodians.filter(item => item !== id)
      }));
      break;
    }
    case 'release': {
      const row = state.assignments.find(item => item.key === data.key);
      const hours = Number(data.hours);
      if (!row || !(hours > 0)) return;
      const entry = { id:crypto.randomUUID(), key:row.key, date:row.date, shift:row.shift, person:row.person, hours,
        voluntary:data.how === 'voluntary', inPlaceOf:data.how === 'voluntary' ? data.inPlaceOf || null : null };
      await commit('Low census recorded', entry, previous => ({ ...previous, releases:[...(previous.releases || []), entry] }));
      ui.dialog = { type:'shift', row };
      break;
    }
    case 'people': {
      const fields = new FormData(form);
      const column = name => fields.getAll(name).map(value => String(value).trim());
      const [last, first, group, cell, office, title, role] = ['last', 'first', 'group', 'cell', 'office', 'title', 'role'].map(column);
      const listed = [];
      last.forEach((surname, index) => {
        if (!surname) return;
        const person = { last: surname, first: first[index], title: title[index], role: role[index], group: group[index],
          cell: cell[index].replace(/\D/g, ''), office: office[index] };
        if (person.cell && person.cell.length !== 10) throw new Error('The cell number for ' + fullName(person) + ' needs ten digits.');
        listed.push({ ...person, id: personId(person) });
      });
      const pages = [...new Set(ui.pending.people.map(person => person.source.page))];
      // The receipt records that a list was saved and from which photos. It does not hold the numbers.
      await commit('Directory saved', { count: listed.length, sourceHashes: pages }, previous => withContacts({
        ...previous, peopleSource: 'import',
        people: [...(previous.peopleSource === 'import' ? previous.people.filter(old => !listed.some(person => person.id === old.id)) : []), ...listed]
      }));
      clearPreview();
      ui.pending.people = [];
      if (ui.pending.assignments.length || ui.pending.flags.length) ui.dialog = { type:'import' };
      else { ui.pending = null; ui.dialog = null; ui.tab = 'people'; }
      ui.notice = 'Directory saved: ' + listed.length + ' people.';
      break;
    }
    case 'correct': {
      const index = Number(form.dataset.index);
      const flag = ui.pending.flags[index];
      const fields = new FormData(form);
      const date = fields.get('date'), shift = fields.get('shift');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SHIFTS[shift]) return;
      // The lines replace what was read for this date and shift on this photo.
      const sameCell = date === flag.draft.date && shift === flag.draft.shift;
      const existing = sameCell ? flagCellRows(flag) : [];
      const tidy = readNameLines(form, [...new Set([...ui.pending.assignments.map(item => item.person), ...actorNames()])]);
      const listed = tidy.rows.map(row => ({
        date, shift, ...row,
        sources: existing.find(item => isSame(item.person, row.person))?.sources || [{ ...flag.source, box:flag.source.box || [0,0,0,0] }]
      }));
      const settled = sameCell ? flagCellFlags(flag) : [flag];
      ui.pending.assignments = mergeAssignments([...ui.pending.assignments.filter(item => !existing.includes(item)), ...listed]);
      ui.pending.issues = verifyRoster(ui.pending.assignments);
      for (const item of [...settled, flag]) item.status = 'corrected';
      await nextFlag(index);
      const notes = tidyNotes({ ...tidy, fresh: [] });
      if (notes.length) ui.flash = 'On ' + dayLabel(date, { month:'short', day:'numeric' }) + ': ' + notes.join(' ');
      break;
    }
    case 'holidays': {
      if (!isKeeper()) return;
      const fields = new FormData(form), on = fields.getAll('on'), keep = fields.getAll('keep').map(Number);
      const extra = state.holidayRules.extra.filter((item, index) => keep.includes(index));
      const name = (data.name || '').trim().replace(/\s+/g, ' ');
      if (name && /^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) extra.push({ name, date:data.date });
      else if (name || data.date) throw new Error('A day to add needs both a name and a date.');
      const rules = { off:HOLIDAY_NAMES.filter(item => !on.includes(item)), extra };
      await commit('Holiday list changed', rules, previous => ({ ...previous, holidayRules:rules }));
      ui.dialog = null;
      ui.notice = 'Holiday list saved.';
      break;
    }
    case 'edit-shift': {
      const { date, shift } = data;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SHIFTS[shift]) return;
      const tidy = readNameLines(form, actorNames());
      const before = state.assignments.filter(item => item.date === date && item.shift === shift);
      const after = tidy.rows.map(row => {
        const kept = before.find(item => isSame(item.person, row.person));
        const { role, hours, ...rest } = kept || { date, shift, person:row.person, sources:[], manual:true };
        const next = { ...rest, ...(row.role ? { role:row.role } : {}), ...(row.hours ? { hours:row.hours } : {}) };
        return { ...next, key:assignmentKey(next) };
      });
      const describe = item => item.person + (item.role ? ' (' + (ROLE_LABELS[item.role] || item.role) + ')' : '') + (item.hours ? ' ' + item.hours : '');
      const notes = tidyNotes(tidy);
      if (before.map(describe).sort().join('|') !== after.map(describe).sort().join('|')) {
        const removed = before.filter(item => !after.some(row => isSame(row.person, item.person)));
        const added = after.filter(row => !before.some(item => isSame(item.person, row.person)));
        await commit('Shift edited', { date, shift, before:before.map(describe), after:after.map(describe) }, previous => ({
          ...previous, assignments: mergeAssignments([...previous.assignments.filter(item => !(item.date === date && item.shift === shift)), ...after])
        }));
        state = withContacts(state);
        saveState(storageKey, state);
        for (const item of added) {
          const other = state.assignments.find(entry => entry.date === date && entry.shift !== shift && isSame(entry.person, item.person));
          if (other) notes.push(item.person + ' is also on the ' + SHIFTS[other.shift].label.toLowerCase() + ' shift that date.');
        }
        for (const item of removed) if (agreedRequestFor(item)) notes.push(item.person + '’s shift was part of an agreed request. Open Requests to sort that out.');
        ui.notice = ['Saved ' + shiftCaption({ date, shift }) + ': ' + (after.map(item => item.person).join(', ') || 'nobody listed') + '.', ...notes].join(' ');
      } else ui.notice = notes.length ? ['Nothing changed on ' + shiftCaption({ date, shift }) + '.', ...notes].join(' ') : '';
      ui.dialog = null;
      break;
    }
    case 'request': {
      const { row, kind, chosen } = ui.dialog;
      if (!isMine(row)) return;
      const check = checkChange({ from:row, to:chosen.to, recipient:chosen.recipient, kind });
      if (check.status === 'blocked') throw new Error(check.reason);
      if (state.requests.some(entry => entry.status === 'Awaiting reply' && entry.from.key === row.key &&
          entry.to?.key === chosen.to?.key && isSame(entry.recipient, chosen.recipient))) {
        throw new Error('You already sent this request to ' + chosen.recipient + '. Open it from Requests.');
      }
      const id = crypto.randomUUID();
      const request = {
        id, from:row, to:chosen.to, recipient:chosen.recipient, kind, check,
        status:'Awaiting reply', messages:body ? [message] : []
      };
      await commit('Request opened', { id, kind, from:assignmentKey(row), to:chosen.to?.key, recipient:chosen.recipient, check:chosen.check },
        previous => ({ ...previous, requests:[...previous.requests, request] }));
      ui.tab = 'requests';
      ui.dialog = { type:'thread', id };
      break;
    }
    case 'reply': {
      if (!body) return;
      const id = ui.dialog.id;
      await commit('Thread reply', { id }, previous => ({
        ...previous, requests:previous.requests.map(item => item.id === id ? { ...item, messages:[...item.messages, message] } : item)
      }));
      break;
    }
    default: return;
  }
  render();
}
render();
void hydrateMedia();
