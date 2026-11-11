import './style.css';
import { SHIFTS, POLICY, AGREED_STATUS, addDays, weekStart, assignmentKey, normalizeName, mergeAssignments, verifyRoster, evaluateChange, committedKeys, projectRoster } from './model.js';
import { putSource, getSource, clearSources, loadState, saveState } from './storage.js';

const publicDemo = __PUBLIC_DEMO__;
const storageKey = 'department-hub-v1-' + (publicDemo ? 'demo' : 'local');
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
const initial = {
  mode: 'sample',
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
let state = loadState(storageKey, initial);
// The starter rules live in code. A saved workspace picks up a new rule version on load.
if (state.policy?.version !== POLICY.version) state = { ...state, policy: POLICY };
const agreedRequestFor = row => state.requests.find(request => request.status === AGREED_STATUS &&
  [request.from?.key, request.to?.key].includes(row.key));
const checkChange = (details, exceptId = null) => evaluateChange({
  roster: projectRoster(state.assignments, state.requests), directory: state.directory,
  hoursVerified: state.hoursVerified, policy: state.policy, committed: committedKeys(state.requests, exceptId), ...details
});
let ui ={ tab: 'schedule', date: '2026-11-13', view: 'weekend', dialog: null, pending: null, busy: null, notice: '' };
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
    nav('schedule', '▦', 'Schedule') + nav('board', '▤', 'Department board') + nav('requests', '⇄', 'Requests') +
    '</nav><div class="aside-bottom"><span class="status-dot"></span>' + (publicDemo ? 'Public demo · fictional data' : 'Local workspace · this browser') + '</div></aside>';
}

function displayDates() {
  if (ui.view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(ui.date), i));
  const friday = addDays(weekStart(ui.date), 5);
  return Array.from({ length: 3 }, (_, i) => addDays(friday, i));
}

function schedule() {
  const dates = displayDates();
  const title = dayLabel(dates[0], { month:'long', day:'numeric' }) + ' – ' + dayLabel(dates.at(-1), { month:'short', day:'numeric' });
  const cells = dates.map(date => '<article class="day-card"><header><span>' + h(dayLabel(date, { weekday:'long' })) +
    '</span><strong>' + h(dayLabel(date, { day:'numeric' })) + '</strong></header>' + Object.entries(SHIFTS).map(([shift, def]) => {
      const rows = state.assignments.filter(row => row.date === date && row.shift === shift);
      return '<section class="shift"><div class="shift-label ' + (shift === 'N' ? 'night' : 'day') + '"><b>' + def.label + '</b><span>' +
        (shift === 'N' ? '7 PM – 7 AM' : '7 AM – 7 PM') + '</span></div>' +
        (rows.length ? rows.map(row => button(avatar(row.person) + '<span class="name">' + h(row.person) + '</span>' +
          (row.hours ? '<i class="tag">' + h(row.hours) + '</i>' : '') +
          (isMine(row) ? '<em>You</em>' : ''), 'shift', 'class="staff ' + (isMine(row) ? 'mine ' : '') + h(row.role || '') + '" ' +
          (row.role ? 'title="' + h(ROLE_LABELS[row.role] || row.role) + '" ' : '') + valueAttr(row.key))).join('') :
          '<p class="empty-shift">No assignments in this roster.</p>') + '</section>';
    }).join('') + '</article>').join('');
  return '<section class="intro"><div><div class="eyebrow">TEAM ROSTER</div><h1>Schedule</h1><p>See who’s working. Start a trade or find coverage from your shift.</p></div>' +
    button('＋ Import schedule', 'import', 'class="primary"') + '</section>' +
    '<div class="roster-status"><span class="status-dot"></span><b>' + (state.mode === 'sample' ? 'Fictional practice roster' : 'Imported roster') +
    '</b><span>' + h(state.mode === 'sample' ? 'Try the full flow with sample staff' : 'Published ' + timeLabel(state.importedAt)) +
    '</span><span class="spacer"></span>' + (state.mode === 'local' ? '<span>Hours and pickups need verification</span>' + button('Staff details', 'staff-setup', 'class="text-button"') + '' : '<span>Demo hours only</span>') + '</div>' +
    '<div class="calendar-toolbar"><div><div class="eyebrow">ROSTER VIEW</div><h2>' + h(title) + '</h2></div><div class="controls">' +
    '<div class="segments">' + button('Weekend', 'view', 'class="' + (ui.view === 'weekend' ? 'selected' : '') + '" data-value="weekend"') +
    button('Week', 'view', 'class="' + (ui.view === 'week' ? 'selected' : '') + '" data-value="week"') + '</div>' +
    '<div class="segments">' + button('‹', 'navigate', 'aria-label="Previous week" data-value="-7"') +
    button('›', 'navigate', 'aria-label="Next week" data-value="7"') + '</div></div></div>' +
    '<div class="calendar ' + ui.view + '">' + cells + '</div>' +
    (state.assignments.some(row => row.role) ? '<p class="calendar-foot legend"><span class="name charge">Pink</span> charge <span class="name icu">Green</span> ICU' +
      (state.assignments.some(row => row.role === 'extra') ? ' <span class="name extra">Yellow</span> extra' : '') + '</p>' : '') +
    '<p class="calendar-foot">Night shifts appear on their start date. Payroll checks split hours at the workweek boundary.</p>';
}

function board() {
  return '<section class="intro"><div><div class="eyebrow">TEAM SPACE</div><h1>Department board</h1><p>Announcements and updates for the whole workspace.</p></div></section>' +
    '<form data-form="post" class="panel form-panel"><label for="post-text">Write an update</label>' +
    '<textarea id="post-text" name="body" maxlength="1200" required placeholder="Share something with the department"></textarea><button class="primary">Post update</button></form>' +
    '<div class="post-list">' + [...state.posts].reverse().map(post => '<article class="panel post"><div class="post-head">' + avatar(post.author) +
      '<div><b>' + h(post.author) + '</b><small>' + h(post.created ? timeLabel(post.created) : 'Sample announcement') +
      '</small></div></div><p>' + h(post.body) + '</p></article>').join('') + '</div>';
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
  const sameDialog = app.querySelector('dialog')?.dataset.dialog === ui.dialog?.type;
  app.innerHTML = top() + '<main><header class="app-top"><div class="breadcrumbs">Workspace <span>›</span> Respiratory Care</div>' +
    '<label class="actor">Viewing as <select id="actor" aria-label="Viewing as">' +
    (actorNames().length ? actorNames() : [state.actor]).map(name => '<option ' + (isSame(name, state.actor) ? 'selected' : '') + '>' + h(name) + '</option>').join('') +
    '</select></label></header><div class="content">' +
    (ui.notice ? '<div role="status" class="notice">' + h(ui.notice) + '</div>' : '') +
    (ui.tab === 'board' ? board() : ui.tab === 'requests' ? requests() : schedule()) +
    '<footer><span>' + (publicDemo ? 'Fictional data only' : 'Private local prototype') +
    ' · No payroll or official schedule changes</span>' + button('Decision history', 'audit', 'class="text-button"') + '</footer></div></main>' + dialogMarkup();
  const dialog = app.querySelector('dialog');
  if (dialog) {
    dialog.showModal();
    if (sameDialog && focus?.id) document.getElementById(focus.id)?.focus();
  }
}

function shell(title, body) {
  return '<dialog data-dialog="' + ui.dialog.type + '" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title">' +
    h(title) + '</h2>' + button('×', 'close', 'class="close" aria-label="Close dialog"') + '</div><div class="dialog-body">' + body + '</div></dialog>';
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
      ' assignments</b><b>' + (unresolved + pending.issues.length) + ' to review</b></div>' +
      '<p>Review the flagged cells and check the date span. Duplicate assignments are combined with their source references.</p>' +
      '<details' + (pending.pages.some(page => page.shift) ? ' open' : '') + '><summary>Pages and extracted dates</summary><ul class="compact">' + pending.pages.map(page => '<li>' +
        h(page.name + ' · ' + page.status + (page.dates.length ? ' · ' + page.dates.at(0) + ' to ' + page.dates.at(-1) : '')) +
        (page.shift ? ' · <b>' + (page.shift === 'N' ? 'Night' : 'Day') + ' schedule</b>' + (page.shiftGuessed ? ' (guessed) ' : ' ') +
          button('Switch to ' + (page.shift === 'N' ? 'Day' : 'Night'), 'flip-page', 'class="text-button" ' + valueAttr(page.page)) : '') +
        '</li>').join('') + '</ul></details>' +
      (unresolved ? '<p>' + button('Review ' + unresolved + ' flagged ' + (unresolved === 1 ? 'shift' : 'shifts'), 'review-flags', 'class="primary"') + '</p>' : '') +
      (pending.flags.length ? '<div class="flags">' + pending.flags.map((flag, index) => '<div class="flag"><p>' + h(flag.message) + '</p><small>' +
        h((flag.draft.date ? flag.draft.date.slice(5).replace('-', '/') + ' · ' : '') + flag.source.file + ' · ' + flag.status) + '</small> ' +
        button('Review', 'flag', 'class="text-button" ' + valueAttr(index)) + '</div>').join('') + '</div>' : '') +
      (pending.issues.length ? '<ul class="compact">' + pending.issues.slice(0,20).map(issue => '<li>' +
        h(issue.date + ' · ' + issue.message) + '</li>').join('') + '</ul>' : '<p class="good">No structural issues were flagged.</p>') +
      '<div class="actions">' + button('Start over', 'clear-draft', 'class="secondary"') +
      button('Publish to this workspace', 'publish', 'class="primary" ' + (!pending.assignments.length || unresolved ? 'disabled' : '')) + '</div>');
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
    const line = (row, index) => '<div class="name-row' + (row?.check ? ' check' : '') + '"><input name="person" list="known-names" maxlength="80" autocomplete="off" placeholder="Name" aria-label="Name ' +
      (index + 1) + '" value="' + h(row?.person || '') + '"' + (index === focus ? ' autofocus' : '') + '><select name="role" aria-label="Role for name ' + (index + 1) + '">' +
      [['', 'No role'], ...Object.entries(ROLE_LABELS)].map(([value, label]) => '<option value="' + value + '"' + ((row?.role || '') === value ? ' selected' : '') + '>' + label + '</option>').join('') +
      '</select><input name="hours" maxlength="9" autocomplete="off" placeholder="7-3" pattern="\\d{1,2}(:\\d{2})?-\\d{1,2}(:\\d{2})?" title="Partial hours like 7-3 or 7-3:30" aria-label="Partial hours for name ' + (index + 1) + '" value="' + h(row?.hours || '') + '"></div>';
    return shell('Check this shift · ' + left + ' left', '<p>' + h(flag.message) + '</p>' + (chosen ? cropMarkup(chosen, flag.source) : '') +
      '<form data-form="correct" data-index="' + id + '"><div class="cell-when"><label>Date<input name="date" type="date" value="' + h(flag.draft.date) +
      '" required></label><label>Shift<select name="shift"><option value="D"' + (flag.draft.shift === 'D' ? ' selected' : '') +
      '>Day</option><option value="N"' + (flag.draft.shift === 'N' ? ' selected' : '') + '>Night</option></select></label></div>' +
      '<p class="subtle">One box per person. Fix a name, add anyone missing, or clear a box to remove someone.' +
      (suggested.length ? ' Shaded names are unsure readings.' : '') + '</p>' +
      '<div class="name-rows">' + Array.from({ length: Math.max(rows.length + 2, 5) }, (_, index) => line(rows[index], index)).join('') + '</div>' +
      '<datalist id="known-names">' + known.map(name => '<option value="' + h(name) + '">').join('') + '</datalist><div class="actions">' +
      button('Leave as read', 'dismiss-flag', 'class="secondary" ' + valueAttr(id)) +
      '<button class="primary">Save and next</button></div></form>');
  }
  if (type === 'shift') return shell(shiftCaption(row), '<p><b>' + h(row.person) + '</b> · ' + h(row.date) +
    (row.role ? ' · ' + h(ROLE_LABELS[row.role] || row.role) : '') + (row.hours ? ' · ' + h(row.hours) : '') + '</p>' +
    (row.sources.length ? '<p>' + button('See photo source', 'source', 'class="text-button" ' + valueAttr(row.key)) +
      ' <small>' + h(row.sources.length + ' source page(s)') + '</small></p>' : '<p class="subtle">Fictional starting roster. Import sample photos to see image evidence.</p>') +
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
      (request.status.startsWith('Both agreed') ? '<p class="subtle">Agreement recorded here. A coordinator can review and enter it in the official system.</p>' : ''));
  }
  if (type === 'audit') return shell('Decision history', '<p class="subtle">Local receipts are linked by hash. Exported receipts can be checked independently. A local owner can replace the whole history.</p>' +
    (state.events.length ? '<ul class="compact">' + [...state.events].reverse().slice(0,25).map(event => '<li>' +
      h(event.type + ' · ' + timeLabel(event.time) + ' · ' + event.hash.slice(0,12)) + '</li>').join('') + '</ul>' : '<p>No decisions recorded yet.</p>') +
    '<div class="actions">' + button('Export receipts', 'export', 'class="secondary"') +
    (!publicDemo ? button('Manage local data', 'data', 'class="text-button"') : '') + '</div>');
  if (type === 'staff-setup') {
    const name = chosen || state.actor;
    const profile = state.directory[normalizeName(name)] || { skills:[] };
    return shell('Staff details', '<p>Add confirmed information for roster-based matching. Actual hours and pickups still need review.</p>' +
      '<label for="staff-select">Staff member</label><select id="staff-select">' +
      actorNames().map(person => '<option' + (isSame(name,person) ? ' selected' : '') + '>' + h(person) + '</option>').join('') +
      '</select><form data-form="profile"><input type="hidden" name="person" value="' + h(name) + '">' +
      '<label>Status<select name="status"><option value="">Unknown</option><option' + (profile.status === 'Staff' ? ' selected' : '') +
      '>Staff</option><option' + (profile.status === 'PRN' ? ' selected' : '') + '>PRN</option></select></label>' +
      '<label><span><input type="checkbox" name="day"' + (profile.skills.includes('D') ? ' checked' : '') + '> Qualified for day shift</span></label>' +
      '<label><span><input type="checkbox" name="night"' + (profile.skills.includes('N') ? ' checked' : '') + '> Qualified for night shift</span></label>' +
      '<button class="primary">Save staff details</button></form>');
  }
  if (type === 'data') return shell('Local workspace data', '<p>Clear the imported roster, source photos, messages and receipts from this browser and restore the sample workspace.</p>' +
    button('Erase local workspace', 'erase', 'class="danger"'));
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

function clearPreview() {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = null;
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
    render();
  }
}

app.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  void act(control.dataset).catch(error => {
    ui.notice = error.message || String(error);
    if (!ui.busy) ui.dialog = null;
    render();
  });
});
app.addEventListener('change', event => {
  if (event.target.id === 'actor') {
    state = { ...state, actor: event.target.value };
    saveState(storageKey, state);
    render();
  }
  if (event.target.id === 'staff-select') { ui.dialog = { type:'staff-setup', chosen:event.target.value }; render(); }
  if (event.target.id === 'photos') void importFiles([...event.target.files]).catch(fail);
});
app.addEventListener('dragover', event => { if (event.target.closest('#drop-zone')) event.preventDefault(); });
app.addEventListener('drop', event => {
  if (!event.target.closest('#drop-zone')) return;
  event.preventDefault();
  void importFiles([...event.dataTransfer.files]).catch(fail);
});
app.addEventListener('cancel', event => {
  if (event.target.tagName !== 'DIALOG') return;
  event.preventDefault();
  if (!ui.busy) { clearPreview(); ui.dialog = null; render(); }
}, true);
function fail(error) { ui.notice = error.message || String(error); ui.dialog = null; render(); }

async function act({action, value, kind}) {
  const row = state.assignments.find(item => item.key === value);
  ui.notice = '';
  switch (action) {
    case 'tab': ui.tab = value; ui.dialog = null; break;
    case 'view': ui.view = value; break;
    case 'navigate': ui.date = addDays(ui.date, Number(value)); break;
    case 'close': if (ui.busy) return; clearPreview(); ui.dialog = null; break;
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
        directory: draft.sample ? sampleDirectory : Object.fromEntries(
          [...new Set(draft.assignments.map(item => item.person))].map(person => [
            normalizeName(person), previous.mode === 'local' && previous.directory[normalizeName(person)] || { person, status: null, skills: [] }
          ])
        ),
        actor: draft.assignments.some(item => isSame(item.person, previous.actor)) ? previous.actor : draft.assignments[0].person
      }));
      ui.date = draft.assignments[0].date;
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
    case 'data': ui.dialog = { type:'data' }; break;
    case 'staff-setup': ui.dialog = { type:'staff-setup' }; break;
    case 'erase':
      await clearSources();
      localStorage.removeItem(storageKey);
      state = structuredClone(initial);
      ui.pending = null;
      ui.dialog = null;
      ui.date = '2026-11-13';
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
  void submit(form).catch(fail);
});
async function submit(form) {
  const data = Object.fromEntries(new FormData(form));
  const body = (data.body || '').trim();
  const message = { author:state.actor, body, created:new Date().toISOString() };
  switch (form.dataset.form) {
    case 'post':
      if (!body) return;
      await commit('Board update', {}, previous => ({ ...previous, posts:[...previous.posts, { id:crypto.randomUUID(), ...message }] }));
      break;
    case 'profile': {
      const profile = { person:data.person, status:data.status || null, skills:[data.day && 'D', data.night && 'N'].filter(Boolean) };
      await commit('Staff details recorded', { ...profile }, previous => ({
        ...previous, directory:{ ...previous.directory, [normalizeName(profile.person)]:profile }
      }));
      break;
    }
    case 'correct': {
      const index = Number(form.dataset.index);
      const flag = ui.pending.flags[index];
      const fields = new FormData(form);
      const date = fields.get('date'), shift = fields.get('shift');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SHIFTS[shift]) return;
      const roles = fields.getAll('role'), times = fields.getAll('hours');
      // The boxes replace what was read for this date and shift on this photo.
      const sameCell = date === flag.draft.date && shift === flag.draft.shift;
      const existing = sameCell ? flagCellRows(flag) : [];
      const listed = [];
      fields.getAll('person').forEach((value, position) => {
        const person = value.trim().replace(/\s+/g, ' ');
        if (!person || listed.some(row => isSame(row.person, person))) return;
        const hours = times[position].trim();
        if (hours && !/^\d{1,2}(:\d{2})?-\d{1,2}(:\d{2})?$/.test(hours)) throw new Error('Write partial hours like 7-3 or 7-3:30.');
        const before = existing.find(row => isSame(row.person, person));
        listed.push({
          date, shift, person, ...(roles[position] ? { role:roles[position] } : {}), ...(hours ? { hours } : {}),
          sources: before?.sources || [{ ...flag.source, box:flag.source.box || [0,0,0,0] }]
        });
      });
      const settled = sameCell ? flagCellFlags(flag) : [flag];
      ui.pending.assignments = mergeAssignments([...ui.pending.assignments.filter(item => !existing.includes(item)), ...listed]);
      ui.pending.issues = verifyRoster(ui.pending.assignments);
      for (const item of [...settled, flag]) item.status = 'corrected';
      await nextFlag(index);
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
