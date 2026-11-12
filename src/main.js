import './style.css';
import './sizes.css';
import './protocols.css';
import { SHIFTS, POLICY, AGREED_STATUS, EXCHANGE_AGREED, addDays, weekStart, assignmentKey, normalizeName, mergeAssignments, verifyRoster, committedKeys, projectRoster, tidyNames, tidyNotes } from './model.js';
import { putSource, getSource, clearSources, loadState, saveState, putMedia, getMedia } from './storage.js';
import { GROUPS, STATUS_BY_GROUP, formatPhone, fullName, linkNames, personId, phoneLink } from './contacts.js';
import { HOLIDAY_NAMES, census, holidayTracker, ledger, publicationRecord, releaseOrder, staffing, standing, statSheet } from './fairness.js';
import { FILTERS, VOICE_LIMIT_SECONDS, clock, fileSize, linkParts, matchesFilter, mediaKind, refuseFiles, shareText, videoLink } from './board.js';
import { localBoard } from './backend.js';
import { SUGGESTIONS, ask, findPeople, pretty as prettyDate, readingProblem, searchDocuments } from './ask.js';
import { checkExchange, describe, exchangeBasis, exchangeCredits, findOptions, parties, shiftName } from './trades.js';
import { keywords, qualifiers, tidyQuestion } from './words.js';
import { LONG_NUMBER_HELP, patientShown, patientSigns } from './guard.js';
import { readPdf } from './pdftext.js';
import { emptyLibrary, prepareLibrary, addRevision, checkExtraction, supplyText, markFigure, activate, withdraw, toggleMark, revisionOf, searchLibrary } from './protocols.js';
import { addMapping, reviewBundle, markMappingsReviewed } from './bundles.js';
import { protocolTopics } from './pathways.js';
import { libraryView, familyView, addDialog, landingRevision, referencesView, knowledgeView } from './protocol-view.js';
import { addSet, reviewCard, withdrawSet } from './facts.js';
import { documentVersion, fileFingerprint, postVersion, sha256, verifyContent, verifyReceipts } from './audit.js';

const publicDemo = __PUBLIC_DEMO__;
const storageKey = 'department-hub-v1-' + (publicDemo ? 'demo' : 'local');
const draftKey = storageKey + '-draft';
const BUILD = 17;
const fingerprint = document.querySelector('meta[name="department-hub-build"]')?.content || '';
const BUILD_INFO = Object.freeze({ version:BUILD, fingerprint:/^[a-f0-9]{64}$/.test(fingerprint) ? fingerprint : null, mode:__BUILD_MODE__, source:__SOURCE_REVISION__ });
const SOURCE_LABEL = BUILD_INFO.source.commit ? BUILD_INFO.source.commit.slice(0,7) + (BUILD_INFO.source.dirty ? ' modified' : '') : 'source unknown';
const BUILD_LABEL = 'Version ' + BUILD + ' · ' + SOURCE_LABEL + ' · ' + (BUILD_INFO.fingerprint?.slice(0,12) || (__BUILD_MODE__ === 'development' ? 'development' : 'unidentified build'));
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
  documents: [],
  answers: [],
  unanswered: [],
  learned: [],
  corrections: [],
  exchanges: [],
  offers: [],
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
  protocols: emptyLibrary(),
  events: []
};
// Readies a workspace that was saved by any earlier version, whether it comes from this browser or from a backup file.
function prepare(loaded) {
  let next = loaded;
  if (!next.people) next = { ...next, people: next.mode === 'sample' ? samplePeople : [], peopleSource: next.mode === 'sample' ? 'sample' : 'import', manualLinks: {} };
  for (const [field, empty] of [['releases', []], ['requests', []], ['posts', []], ['events', []], ['images', []], ['directory', {}], ['history', []], ['documents', []], ['answers', []], ['exchanges', []], ['offers', []], ['unanswered', []], ['learned', []], ['corrections', []],
    ['custodians', next.mode === 'sample' ? ['jordan'] : []], ['holidayRules', { off: [], extra: [] }]]) if (!next[field]) next = { ...next, [field]: empty };
  // A workspace saved before protocols existed gets an empty library. Pasted documents stay documents: nothing is promoted.
  next = { ...next, protocols: prepareLibrary(next.protocols) };
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
// Trades between any number of people. The rules are the starting ones with whatever the department has entered on top.
const tradeRules = () => ({ ...state.policy, ...(state.tradeRules || {}) });
const allRequests = () => [...state.requests, ...state.exchanges];
const creditRequests = () => [...state.requests, ...exchangeCredits(state.exchanges)];
const tradeWorld = (exceptId = null) => ({ roster: projectRoster(state.assignments, allRequests().filter(item => item.id !== exceptId)), directory: state.directory, policy: tradeRules(),
  committed: committedKeys(allRequests(), exceptId), today: localToday(), now:new Date().toISOString() });
const exchangeFor = row => state.exchanges.find(item => item.status === EXCHANGE_AGREED && item.moves.some(move => move.key === row.key));
const pendingOf = exchange => exchange.parties.filter(name => !exchange.accepted[normalizeName(name)]);
const namesList = names => names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const rulesLine = () => { const rules = tradeRules(); return 'the week starts on ' + WEEKDAYS[rules.weekStartsOn || 0] + ', ' + rules.overtimeLimitMinutes / 60 + ' hours a week (going over is ' + (rules.overLimit === 'warn' ? 'flagged' : 'refused') + '), ' +
  rules.minimumRestMinutes / 60 + ' hours between shifts' + (rules.maxInARow ? ', a warning above ' + rules.maxInARow + ' days in a row' : ''); };
const optionsFor = (target, loops = false) => findOptions({ ...tradeWorld(), target, offers: state.offers, loops });
const checkChange = (details, exceptId = null) => {
  const {from,to,recipient,kind} = details, second = kind === 'trade' ? to?.person : recipient;
  const moves = [{key:from.key,to:second}, ...(kind === 'trade' && to ? [{key:to.key,to:from.person}] : [])];
  const result = checkExchange({...tradeWorld(exceptId),moves});
  if (result.status === 'blocked') return {status:'blocked',reason:result.problems.join(' ')};
  const unknown = result.people.some(part => !state.directory[normalizeName(part.person)]?.status);
  const cautions = [...result.cautions, ...(unknown ? ['Employment status and qualifications need verification.'] : []),
    ...(!state.hoursVerified ? ['Hours and pickups outside this roster need verification.'] : [])];
  return {status:cautions.length ? 'review' : 'eligible',reason:cautions.join(' ') || 'Roster-based checks passed.',
    projections:result.people.map(part=>({person:part.person,weeks:part.weeks}))};
};
// The notice is shown once on each device and answered with a press, before anything else.
const noticeKey = 'department-hub-notice-v3';
let noticeSeen = loadState(noticeKey, null);
let ui ={ tab: 'schedule', date: startDate(), view: 'weekend', dialog: noticeSeen ? null : { type:'notice' }, pending: loadDraft(), busy: null, notice: '', flash: '',
  protocols: { family:null, revision:null, pane:'both', cite:null, query:'', withdrawing:false, fromAsk:false, shelf:null, refQuery:'', refSection:'', refRetired:false } };
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
const USAGE_NAMES = { 'tab:schedule':'Opened Schedule', 'tab:board':'Opened Board', 'tab:requests':'Opened Requests', 'tab:fairness':'Opened Fairness', 'tab:people':'Opened Directory', 'tab:protocols':'Opened Protocols', 'reference-shelf':'Opened the professional references',
  shift:'Opened a shift', options:'Looked for ways off a shift', 'options-loops':'Looked for three-person loops', propose:'Proposed an exchange', 'exchange-agree':'Agreed to an exchange', 'exchange-decline':'Declined an exchange',
  'form:offer':'Said they could pick up a shift', 'form:trade-rules':'Changed the trade rules', 'ask-next':'Pressed a next-step question', 'ask-yes':'Said an answer helped', 'ask-no':'Said an answer did not help', 'ask-send':'Sent a question to the record keeper', verify:'Checked the receipts', 'notice-ok':'Acknowledged the notice', notice:'Opened the notice', 'mark-copy':'Copied the latest fingerprint', 'form:mark':'Looked for an earlier fingerprint', 'form:teach':'Taught an answer', 'ask-open':'Opened Ask', 'ask-wrong':'Said what was wrong with an answer', 'form:reading-try':'Tried a rewording', 'reading-save':'Saved a reading correction', 'form:passage-find':'Looked for a passage', 'passage-pick':'Chose a passage for a question', 'correction-remove':'Removed a correction', 'teach-copy':'Copied the waiting questions', 'form:ask':'Asked a question', 'ask-try':'Used a suggested question', 'ask-go':'Opened a record from an answer', 'edit-shift':'Opened Edit names', 'form:edit-shift':'Saved names on a shift', matches:'Looked for a trade or coverage', 'form:request':'Sent a request',
  voice:'Started a voice message', 'form:voice':'Sent a voice message', 'form:post':'Posted to the board', share:'Pressed Share', backup:'Saved a backup', restore:'Restored a backup',
  import:'Opened Import', publish:'Published a schedule', 'form:correct':'Saved a checked shift', 'view:week':'Chose Week', 'view:weekend':'Chose Weekend', today:'Pressed Today', navigate:'Changed week',
  over:'Opened an over-staffed shift', release:'Opened low census', 'form:release':'Recorded low census', 'text-size':'Changed text size', close:'Closed a dialog',
  'text-screen-blocked':'Text screen stops (including repeats and false alarms)' };
// When the board was last opened on this device, so Ask can say what is new since then.
const seenKey = storageKey + '-seen';
let sourceVersions = {};
const versionsFor = async documents => Object.fromEntries(await Promise.all(documents.map(async doc => [doc.id, await documentVersion(doc)])));
let boardSeen = loadState(seenKey, null);
function markBoardSeen(value = new Date().toISOString()) {
  boardSeen = value;
  try { value ? localStorage.setItem(seenKey, JSON.stringify(value)) : localStorage.removeItem(seenKey); } catch { /* only affects what is new */ }
}
const askWorld = () => ({ today: localToday(), now:new Date().toISOString(), actor: state.actor, assignments: state.assignments, directory: state.directory, people: state.people, links: state.links, posts: state.posts,
  documents: state.documents, releases: state.releases, requests: creditRequests(), trade: { ...tradeWorld(), offers: state.offers }, rules: state.holidayRules, keeper: isKeeper(), seen: boardSeen, published: state.mode === 'sample' ? null : state.importedAt,
  answers: state.answers, learned: state.learned, corrections: state.corrections, last: ui.askContext, versions:sourceVersions, protocols: state.protocols, references: referenceList?.records || [], referencesCollected: referenceList?.collectedOn });
function currentAsk(dialog = ui.dialog) {
  const signs = patientSigns(dialog?.q || '');
  if (signs.length) return { title:'Remove patient details before asking.', lines:['The text screen saw ' + patientShown(dialog.q) + '. No records were searched.', ...(signs.some(sign => sign.startsWith('a long number')) ? [LONG_NUMBER_HELP] : [])],
    items:[], source:'Patient-information screen; it cannot detect every disclosure.', empty:true, kind:'blocked', context:null };
  return ask(dialog.q, { ...askWorld(), last:dialog.previousContext });
}
async function runAsk(q) {
  sourceVersions = await versionsFor(state.documents);
  const dialog = { type:'ask', q, previousContext:ui.askContext }, result = currentAsk(dialog);
  ui.askContext = result.context;
  ui.lastAsk = ui.dialog = dialog;
  if (result.kind === 'blocked') countPress('text-screen-blocked');
  // A lookup stays in this conversation. Only explicitly saved feedback changes the record.
}
// A repeated press never overrides this screen. Files' contents are not inspected; the visible notice explains that.
function patientCheck(form, text) {
  const signs = patientSigns(text);
  if (!signs.length) return signs;
  countPress('text-screen-blocked');
  let note = form.querySelector('.refusal');
  if (!note) { note = document.createElement('p'); note.className = 'refusal'; note.setAttribute('role', 'alert'); form.append(note); }
  // The words that set it off are shown to the person who wrote them, and kept nowhere.
  note.textContent = 'Not saved. This looks like it points to a patient: ' + patientShown(text) + '. Take that out and save again. ' + (signs.some(sign => sign.startsWith('a long number')) ? LONG_NUMBER_HELP + ' ' : '') +
    'Repeated presses do not override this screen, and it can miss other forms of patient information.';
  note.scrollIntoView({ block:'nearest' });
  return null;
}

const DOC_LIMIT = 300000, DOC_TOTAL = 1500000;
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
let saveQueue = Promise.resolve();
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

async function receipt(type, details, actor) {
  const payload = {
    id: crypto.randomUUID(), time: new Date().toISOString(), type,
    build: BUILD_INFO,
    rosterRevision: state.revision, policyVersion: state.policy.version,
    previousHash: state.events.at(-1)?.hash || null, actor, details
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return { ...payload, hash: Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('') };
}
function commit(type, details, update) {
  const actor = state.actor, recorded = structuredClone(details);
  const task = saveQueue.then(async () => {
    const event = await receipt(type, recorded, actor);
    const next = { ...update(state) };
    next.events = [...state.events, event];
    const versions = next.documents !== state.documents ? await versionsFor(next.documents) : sourceVersions;
    saveState(storageKey, next);
    state = next;
    sourceVersions = versions;
  });
  saveQueue = task.catch(() => {});
  return task;
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
  const cells = dates.map(date => '<article class="day-card" data-date="' + date + '"><header><span>' + h(dayLabel(date, { weekday:'long' })) +
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

// Why a question is waiting for the record keeper.
const SCHEDULE_KINDS = ['when', 'who', 'off', 'offlist', 'run', 'hours', 'trade', 'pickup', 'staffing', 'fair'];
const WRONG = { misread:'reported as misread', passage:'reported as quoting the wrong part', unanswered:'nothing answered it' };
const sameAsk = (item, text) => item.asks.some(asked => asked.trim().toLowerCase() === text.trim().toLowerCase());
const liveDocuments = () => state.documents.filter(doc => doc.status !== 'withdrawn' && (!doc.effective || doc.effective <= localToday()));
const RULE = 'No patient information: no names, faces, monitors, charts or record numbers. Saved posts and uploads leave a fingerprint and the name in use. Ordinary questions are not logged.';
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
  return '<article class="panel post" data-post="' + h(post.id) + '"><div class="post-head">' + avatar(post.author) +
    '<div><b>' + h(post.author) + '</b><small>' + h(post.created ? timeLabel(post.created) : 'Sample announcement') +
    (post.voice ? ' · Voice message' + (post.media?.[0]?.seconds ? ' · ' + clock(post.media[0].seconds) : '') : '') + '</small></div>' +
    (post.learning ? '<span class="badge learning">Learning</span>' : '') + '</div>' +
    (post.when ? '<p><span class="badge dated">' + ({ due:'Due', meeting:'Meeting', event:'Event' }[post.when.kind] || 'Date') + ' · ' + h(prettyDate(post.when.date)) + '</span></p>' : '') + words +
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
    '<textarea id="post-text" name="body" maxlength="2000" placeholder="Share something with the department. A YouTube or Vimeo link plays right on the board.">' + h(ui.draftPost || '') + '</textarea>' +
    '<div class="cell-when"><label>Does it have a date?<select name="whenKind"><option value="">No date</option><option value="due">Due by</option><option value="meeting">Meeting on</option><option value="event">Event on</option></select></label>' +
    '<label>Date<input name="whenDate" type="date"></label></div>' +
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
  const sheet = statSheet(state.actor, { ...state, requests: creditRequests(), assignments: rows, rules }), me = sheet.row;
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
    button('Who keeps the record', 'staff-setup', 'class="secondary"') + button('Activity log', 'audit', 'class="secondary"') + '</div></div>';
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
  const exchanges = [...state.exchanges].reverse().map(exchange => {
    const forMe = exchange.status.startsWith('Waiting') && pendingOf(exchange).some(name => isSame(name, state.actor));
    return '<article class="panel request"><div><span class="badge' + (forMe ? ' dated' : '') + '">' + h(forMe ? 'Needs your answer' : exchange.status) + '</span><h3>' +
      h(exchange.parties.length > 2 ? 'Exchange between ' + exchange.parties.length + ' people' : exchange.moves.length > 1 ? 'Swap' : 'Pick-up') + '</h3><p>' + h(namesList(exchange.parties)) + ' · ' +
      h(exchange.moves.map(shiftName).join(', ')) + '</p></div>' + button('Open', 'exchange', 'class="secondary" ' + valueAttr(exchange.id)) + '</article>';
  }).join('');
  const today = localToday(), coming = state.offers.filter(offer => offer.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
  const mine = coming.filter(offer => isSame(offer.person, state.actor)), theirs = new Map();
  for (const offer of coming) if (!isSame(offer.person, state.actor)) theirs.set(offer.date + offer.shift, [...(theirs.get(offer.date + offer.shift) || [shiftName(offer)]), offer.person]);
  const offers = '<div class="panel"><h3>Shifts I could pick up</h3><p class="subtle">Say which shifts you would be open to working. When someone looks for a way off one of them, you are shown first. It is not a promise.</p>' +
    (mine.length ? '<div class="line-list">' + mine.map(offer => '<div><span><b>' + h(shiftName(offer)) + '</b></span>' + button('Remove', 'offer-remove', 'class="secondary" ' + valueAttr(offer.id)) + '</div>').join('') + '</div>' : '') +
    '<form data-form="offer" class="cell-when"><label>Date<input name="date" type="date" required min="' + today + '"></label><label>Shift<select name="shift"><option value="D">Day</option><option value="N">Night</option></select></label>' +
    '<button class="secondary">Add</button></form>' + (theirs.size ? '<h3>Others who said they could</h3>' + [...theirs.values()].map(([shift, ...names]) => '<p><b>' + h(shift) + ':</b> ' + h(namesList(names)) + '</p>').join('') : '') + '</div>';
  const rules = '<div class="panel"><h3>Trade rules in use</h3><p>' + h(rulesLine()[0].toUpperCase() + rulesLine().slice(1)) + '.</p><p class="subtle">' +
    (state.tradeRules ? 'Entered by ' + h(state.tradeRules.by) + ' on ' + h(prettyDate(state.tradeRules.at.slice(0, 10))) + '.' : 'These are starting values, not your department’s confirmed rules.') + ' ' +
    (isKeeper() ? '' : 'Whoever keeps the record can change them.') + '</p>' + (isKeeper() ? button('Change the rules', 'trade-rules', 'class="secondary"') : '') + '</div>';
  return '<section class="intro"><div><div class="eyebrow">SHIFT COORDINATION</div><h1>Requests</h1><p>Follow trades and coverage without changing the official roster.</p></div></section>' +
    (exchanges + list || '<div class="panel empty"><strong>No shift requests yet.</strong><p>Open one of your shifts to find the ways off it.</p>' +
      button('Go to schedule', 'tab', 'class="secondary" data-value="schedule"') + '</div>') + offers + rules;
}

function shiftCaption(row) {
  return dayLabel(row.date, { weekday:'short', month:'short', day:'numeric' }) + ' · ' + SHIFTS[row.shift].label;
}

// Protocols. The library (revisions, readings, mapped answers) is part of the workspace. Each original file is kept in
// this browser beside the board's files, under its own fingerprint, and is never changed after it is added.
const originalKey = digest => 'protocol:' + digest;
const originals = new Map();            // fingerprint → the file, or false when it is not on this device
const pageCanvases = new Map();         // fingerprint|page → the drawn page, kept so a redraw of the screen is instant
const SAMPLE_PROTOCOL = /^rt-train-014-rev[12]\.pdf$/;
let pdfjsReady = null;
// The PDF reader is large, so it is fetched only when a protocol is opened or added. It ships with the app; nothing is fetched from elsewhere.
const loadPdfjs = () => pdfjsReady ||= (async () => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  return pdfjs;
})();
const viewTools = { h, button, valueAttr };
// Professional references: titles and links only, shipped with the app and loaded after it starts. No text of any guideline is held.
let referenceList = null;
const loadReferences = () => import('./reference/respiratory-sources.json').then(module => { referenceList = module.default; if (ui.tab === 'protocols') render(); }).catch(() => {});
const shownRevision = () => ui.protocols.family ? revisionOf(state.protocols, ui.protocols.revision) || landingRevision(state.protocols, ui.protocols.family, localToday()) : null;
function protocolsScreen() {
  const view = ui.protocols, today = localToday();
  if (view.shelf?.startsWith('knowledge:')) return knowledgeView({ set:(state.protocols.knowledge || []).find(set => set.id === view.shelf.slice(10)), keeper:isKeeper(), withdrawing:view.withdrawing }, viewTools);
  if (view.shelf === 'references' && referenceList) return referencesView({ list:referenceList, query:view.refQuery, section:view.refSection, retired:view.refRetired, today }, viewTools);
  if (!view.family) return libraryView({ library:state.protocols, today, documents:state.documents, query:view.query, results:view.query ? searchLibrary(state.protocols, view.query, today) : [], keeper:isKeeper(), demo:publicDemo,
    sampleNext:['1', '2'].find(label => !state.protocols.revisions.some(revision => revision.file.name === 'rt-train-014-rev' + label + '.pdf')) || null, references:referenceList,
    cardSetOffered:!(state.protocols.knowledge || []).some(set => set.id === 'blood-gases-adult' && !set.withdrawn) }, viewTools);
  const revision = shownRevision();
  return familyView({ library:state.protocols, today, familyId:view.family, revisionId:revision?.id, pane:view.pane, cite:view.cite, keeper:isKeeper(), held:revision ? originals.get(revision.digest) : undefined,
    sampleMapping:Boolean(revision && SAMPLE_PROTOCOL.test(revision.file.name)), withdrawing:view.withdrawing, fromAsk:view.fromAsk && Boolean(ui.lastAsk),
    topics:protocolTopics(state.protocols, today).filter(entry => entry.family.id === view.family).map(entry => entry.topic.title) }, viewTools);
}
// Draws the original's pages into the frames on screen. The outline of a cited passage is ordinary markup over the
// page, placed from the reading's coordinates, so it is there whether or not the drawing has finished.
async function paintPages() {
  const frames = [...app.querySelectorAll('[data-page-canvas]')];
  if (!frames.length) return;
  const digest = frames[0].dataset.pageCanvas.split('|')[0];
  for (const frame of frames) { const ready = pageCanvases.get(frame.dataset.pageCanvas); if (ready) frame.prepend(ready); }
  if (frames.every(frame => pageCanvases.has(frame.dataset.pageCanvas))) return;
  if (!originals.has(digest)) {
    const file = await getMedia(originalKey(digest)).catch(() => null);
    // The stored bytes are checked against the revision's fingerprint every time they are first opened. A file that no longer matches is not shown.
    const intact = file ? await sha256(await file.arrayBuffer()) === digest : false;
    originals.set(digest, file ? (intact ? file : 'changed') : false);
    if (!intact) { render(); return; }
  }
  const file = originals.get(digest);
  if (!file || file === 'changed' || ui.painting === digest) return;
  ui.painting = digest;
  try {
    const pdfjs = await loadPdfjs(), source = await pdfjs.getDocument({ data:new Uint8Array(await file.arrayBuffer()), isEvalSupported:false, verbosity:0 }).promise;
    for (let number = 1; number <= source.numPages; number++) {
      const key = digest + '|' + number;
      if (pageCanvases.has(key)) continue;
      const page = await source.getPage(number), viewport = page.getViewport({ scale:Math.min(2, window.devicePixelRatio || 1) * 1.4 }), canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Page ' + number + ' of the original file');
      await page.render({ canvas, canvasContext:canvas.getContext('2d'), viewport }).promise;
      pageCanvases.set(key, canvas);
      app.querySelector('[data-page-canvas="' + key + '"]')?.prepend(canvas);
    }
    await source.destroy?.();
  } catch (error) { ui.notice = 'The original could not be drawn here: ' + (error.message || error) + ' The reading and its page numbers are still shown.'; }
  finally { ui.painting = null; }
}
// One recorded step on the library. A refusal is shown as it is worded; nothing is saved.
async function protocolStep(result, said) {
  if (!result.ok) throw new Error(result.why);
  if (result.receipt) await commit(result.receipt.type, result.receipt.details, previous => ({ ...previous, protocols:result.library }));
  else await (saveQueue = saveQueue.then(() => { state = { ...state, protocols:result.library }; saveState(storageKey, state); }));
  if (said) ui.notice = said;
  return result;
}
const keeperOnly = () => { if (!isKeeper()) throw new Error('Only a record keeper can change the protocols held here.'); };
// Reads a PDF on this device and adds it as an unchecked revision. The same path serves a chosen file and the invented example.
async function addProtocolFile(file, fields) {
  if (file.size > 40 * 1024 * 1024) throw new Error('That file is ' + fileSize(file.size) + '. A protocol can be up to 40 MB.');
  const bytes = await file.arrayBuffer(), digest = await sha256(bytes), extraction = await readPdf(bytes.slice(0), await loadPdfjs());
  const result = addRevision(state.protocols, { ...fields, digest, extraction, file:{ name:file.name, bytes:file.size } }, state.actor, new Date().toISOString());
  if (!result.ok) throw new Error(result.why);
  await putMedia(originalKey(digest), new Blob([bytes], { type:'application/pdf' }));
  originals.set(digest, new Blob([bytes], { type:'application/pdf' }));
  await protocolStep(result);
  return result;
}

async function addMappingFile(file) {
  keeperOnly();
  if (file.size > 2 * 1024 * 1024) throw new Error('That file is too large to be a mapping.');
  let mapping = null;
  try { mapping = JSON.parse(await file.text()); } catch { throw new Error('That file is not a mapping. It could not be read as JSON.'); }
  await protocolStep(addMapping(state.protocols, shownRevision().id, mapping, state.actor, new Date().toISOString()), 'Mapped answers added as proposals. None answers a question until it is reviewed against the original.');
  ui.protocols = { ...ui.protocols, pane:'answers' };
}
// A backup carries the library, not the original files. A file chosen again is taken only if it is the very same file.
async function restoreOriginal(file) {
  const revision = shownRevision(), bytes = await file.arrayBuffer(), digest = await sha256(bytes);
  if (digest !== revision.digest) throw new Error('That is a different file. Its fingerprint starts ' + digest.slice(0, 12) + '; this revision is ' + revision.digest.slice(0, 12) + '. Nothing was changed.');
  const blob = new Blob([bytes], { type:'application/pdf' });
  await putMedia(originalKey(digest), blob);
  originals.set(digest, blob);
  ui.notice = 'The original is back on this device. Its fingerprint matches.';
}

function render() {
  const focus = document.activeElement;
  const playing = [...app.querySelectorAll('[data-media]')].filter(player => player.currentTime > 0 && !player.ended)
    .map(player => ({ id: player.dataset.media, time: player.currentTime, on: !player.paused }));
  const sameDialog = app.querySelector('dialog')?.dataset.dialog === ui.dialog?.type;
  app.innerHTML = top() + '<main>' + button('<b>Independent staff project—not an official hospital product.</b> No patient information. Actions use cryptographic audit receipts. <u>What is recorded</u>', 'notice', 'class="unofficial"') + '<header class="app-top"><div class="breadcrumbs">Workspace <span>›</span> Respiratory Care</div>' +
    '<div class="top-tools">' + button('Aa', 'text-size', 'class="text-size" title="Text size" aria-label="Text size: ' + TEXT_NAMES[textSize] + '. Press to change."') +
    button('Protocols', 'tab', 'class="protocols-trigger' + (ui.tab === 'protocols' ? ' active' : '') + '" ' + valueAttr('protocols') + (ui.tab === 'protocols' ? ' aria-current="page"' : '')) +
    button('<span aria-hidden="true">?</span> Ask', 'ask-open', 'class="ask-trigger" aria-label="Ask a question about the schedule, the board, the documents or the protocols"') +
    '<label class="actor">Viewing as <select id="actor" aria-label="Viewing as">' +
    (actorNames().length ? actorNames() : [state.actor]).map(name => '<option ' + (isSame(name, state.actor) ? 'selected' : '') + '>' + h(name) + '</option>').join('') +
    '</select></label></div></header><div class="content">' +
    (ui.notice ? '<div role="status" class="notice">' + h(ui.notice) + '</div>' : '') +
    (ui.tab === 'board' ? board() : ui.tab === 'requests' ? requests() : ui.tab === 'people' ? people() : ui.tab === 'fairness' ? fairness() : ui.tab === 'protocols' ? protocolsScreen() : schedule()) +
    '<footer><span>' + (publicDemo ? 'Fictional data only' : 'Private local prototype') +
    ' · No payroll or official schedule changes · <span data-build="' + h(BUILD_INFO.fingerprint || '') + '" title="' + h(BUILD_INFO.fingerprint || 'No release fingerprint available') + '">' + h(BUILD_LABEL) + '</span></span><span>' + (publicDemo ? '' : button('Backup and restore', 'data', 'class="text-button"') + ' ') +
    button('Activity log', 'audit', 'class="text-button"') + '</span></footer></div></main>' + dialogMarkup();
  for (const item of playing) {
    const player = app.querySelector('[data-media="' + CSS.escape(item.id) + '"]');
    if (player) { player.currentTime = item.time; if (item.on) player.play().catch(() => {}); }
  }
  const dialog = app.querySelector('dialog');
  if (dialog) {
    dialog.showModal();
    if (sameDialog && focus?.id) document.getElementById(focus.id)?.focus();
  }
  if (ui.tab === 'protocols') paintPages();
  // A citation is shown in both places at once: the passage in the reading, then its outline on the original's page.
  if (ui.scrollTo === '#cite-mark') app.querySelector('.reading-pane .cited')?.scrollIntoView({ block:'center' });
  if (ui.scrollTo) { app.querySelector(ui.scrollTo)?.scrollIntoView({ block:ui.scrollTo === '#cite-mark' ? 'center' : 'start' }); ui.scrollTo = null; }
}

function shell(title, body) {
  return '<dialog data-dialog="' + ui.dialog.type + '" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title">' +
    h(title) + '</h2>' + (ui.dialog.type === 'notice' && !noticeSeen ? '' : button('×', 'close', 'class="close" aria-label="Close dialog"')) + '</div><div class="dialog-body">' +
    (ui.dialog.type === 'notice' ? '' : '<p class="subtle">Independent staff project—not an official hospital product. No patient information. Recorded actions use audit receipts.</p>') +
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
    exchangeFor(row) ? '<p class="subtle">This shift is part of an agreed exchange that is queued for review. It cannot be offered again until that is settled.</p>' +
      '<div class="actions">' + button('Open the exchange', 'exchange', 'class="secondary" ' + valueAttr(exchangeFor(row).id)) + '</div>' :
    isMine(row) ? '<div class="actions">' + button('Find ways off this shift', 'options', 'class="primary" ' + valueAttr(row.key)) +
      button('Trade this shift', 'matches', 'class="secondary" data-kind="trade" ' + valueAttr(row.key)) +
      button('Find coverage', 'matches', 'class="secondary" data-kind="coverage" ' + valueAttr(row.key)) + '</div>' : ''));
  if (type === 'options') {
    const { found } = ui.dialog, kinds = ['keep', 'keepLoops', 'swaps', 'pickups', 'chains', 'loops'];
    const lines = item => describe(item, state.actor).map(line => '<p class="' + (item.cautions.includes(line) ? 'caution' : item.notes.includes(line) || /^(Hours|Nobody|Rest)/.test(line) ? 'subtle' : 'move') + '">' + h(line) + '</p>').join('');
    const group = (kind, title, blurb) => found[kind].length ? '<h3>' + title + '</h3><p class="subtle">' + blurb + (found.counts[kind] > found[kind].length ? ' ' + found.counts[kind] + ' pass the rules. These are the ' + found[kind].length + ' simplest.' : '') + '</p>' +
      found[kind].map((item, index) => '<div class="option">' + (item.said ? '<span class="badge learning">Said they could work this</span>' : '') + lines(item) +
        '<div class="actions inline">' + button('Propose this', 'propose', 'class="secondary" ' + valueAttr(kind + '|' + index)) + '</div></div>').join('') : '';
    return shell('Ways off ' + shiftCaption(row), '<p class="subtle">Checked against this schedule and the rules entered. It does not know who is willing or who is on leave.</p>' +
      (found.blockedForMe.length ? '<p class="caution">' + h(found.blockedForMe.join(' ')) + '</p>' : '') +
      (found.keep.length || found.keepLoops.length ? '' : '<p><b>Nothing left in this pay week keeps everyone’s hours.</b> ' + (found.sameWeekLeft ? 'The ' + found.sameWeekLeft + ' other shifts still to come in it do not pass the rules.' : 'No other shift in it is still to come.') + ' The options below change someone’s weekly hours.</p>') +
      group('keep', 'Swap and keep your hours', 'You each take one of the other’s shifts in the same pay week, so nobody’s weekly hours change.') +
      group('keepLoops', 'Three people, everyone keeps their hours', 'Each of you hands a shift to the next, all in the same pay week.') +
      group('swaps', 'Swap that moves hours between weeks', 'You each take one of the other’s shifts, in different pay weeks.') +
      group('pickups', 'Someone covers it', 'They take the shift and give nothing back. You lose the hours.') +
      group('chains', 'Cover through a third person', 'Someone can take yours only because a third person picks up one of theirs. You lose the hours.') +
      (ui.dialog.loops ? group('loops', 'Other three-person exchanges', 'Each of you hands a shift to the next. These change someone’s weekly hours.') || '<p class="subtle">No other three-person exchange passes the rules.</p>' : '') +
      (kinds.some(kind => found[kind].length) ? '' : '<p><b>Nothing ' + (ui.dialog.loops ? '' : 'simpler ') + 'passes the rules entered.</b></p>') +
      '<p class="subtle">Rules in use: ' + h(rulesLine()) + '. Hours come from this schedule only, so a pick-up that is not on it is not counted.</p>' +
      '<div class="actions">' + (ui.dialog.loops ? '' : button('Look for more three-person exchanges', 'options-loops', 'class="secondary"')) + button('Back to the shift', 'shift', 'class="secondary" ' + valueAttr(row.key)) + '</div>');
  }
  if (type === 'exchange') {
    const exchange = state.exchanges.find(item => item.id === id);
    if (!exchange) return shell('Exchange', '<p>This exchange is no longer here.</p>');
    const open = exchange.status.startsWith('Waiting'), waiting = pendingOf(exchange), agreed = exchange.parties.filter(name => exchange.accepted[normalizeName(name)]);
    const result = open ? checkExchange({ ...tradeWorld(exchange.id), moves: exchange.moves, basis:exchange.basis || '' }) : null;
    const text = (result ? describe(result, state.actor) : exchange.summary).map(line => '<p class="' + (/^(Hours|Nobody|Rest)/.test(line) ? 'subtle' : result?.cautions.includes(line) || result?.problems.includes(line) ? 'caution' : 'move') + '">' + h(line) + '</p>').join('');
    const reach = waiting.filter(name => contactFor(name)?.cell).map(name => '<p class="person-lines"><span>' + h(name) + '</span>' + contactButtons(contactFor(name), state.actor + ' is asking about an exchange in Department Hub: ' + exchange.summary.slice(0, 3).join(' ')) + '</p>').join('');
    return shell(exchange.parties.length > 2 ? 'Exchange between ' + exchange.parties.length + ' people' : exchange.moves.length > 1 ? 'Swap' : 'Pick-up', '<p><span class="badge">' + h(exchange.status) + '</span></p><div class="option">' + text + '</div>' +
      '<p class="subtle">Asked by ' + h(exchange.by) + ' on ' + h(timeLabel(exchange.created)) + '. Agreed so far: ' + h(namesList(agreed)) + '.' + (open ? ' Nothing changes until everyone has agreed, and it is checked again each time.' : '') + '</p>' +
      (open && result.status === 'blocked' ? '<p class="caution"><b>This no longer works on the schedule as it stands.</b></p>' : '') +
      (open && isSame(exchange.by, state.actor) && reach ? '<p class="subtle">This app cannot notify anyone yet. Send it from your phone:</p>' + reach : '') +
      (exchange.status === EXCHANGE_AGREED ? '<p class="subtle">Agreement recorded here. A coordinator can review and enter it in the official system.</p>' : '') +
      (open ? '<div class="actions">' + (isSame(exchange.by, state.actor) ? button('Withdraw it', 'exchange-withdraw', 'class="secondary"') : '') +
        (waiting.some(name => isSame(name, state.actor)) ? button('Decline', 'exchange-decline', 'class="secondary"') + button('I agree', 'exchange-agree', 'class="primary"') : '') + '</div>' : ''));
  }
  if (type === 'trade-rules') {
    const rules = tradeRules(), pick = (value, current, label) => '<option value="' + value + '"' + (String(value) === String(current) ? ' selected' : '') + '>' + label + '</option>';
    return shell('Trade rules', '<p class="subtle">Every trade, swap and pick-up is checked against these. Enter what your department actually uses. Changing them is recorded.</p><form data-form="trade-rules">' +
      '<label>The pay week starts on<select name="weekStartsOn">' + WEEKDAYS.map((day, index) => pick(index, rules.weekStartsOn || 0, day)).join('') + '</select></label>' +
      '<label>Hours in a week before overtime<input name="limit" type="number" inputmode="decimal" min="1" max="168" step="0.5" required value="' + rules.overtimeLimitMinutes / 60 + '"></label>' +
      '<label>A change that would go over that<select name="overLimit">' + pick('block', rules.overLimit || 'block', 'Is refused') + pick('warn', rules.overLimit || 'block', 'Is allowed, with a warning') + '</select></label>' +
      '<label>Fewest hours between two shifts<input name="rest" type="number" inputmode="decimal" min="0" max="48" step="0.5" required value="' + rules.minimumRestMinutes / 60 + '"></label>' +
      '<label>Warn above this many days in a row (0 for no warning)<input name="row" type="number" inputmode="numeric" min="0" max="14" step="1" required value="' + (rules.maxInARow || 0) + '"></label>' +
      '<div class="actions">' + button('Cancel', 'close', 'class="secondary"') + '<button class="primary">Save the rules</button></div></form>');
  }
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
  if (type === 'audit') {
    const head = state.events.at(-1)?.hash || '';
    const who = event => isKeeper() || isSame(event.actor, state.actor) ? ' · ' + event.actor : '';
    const buildLabel = event => event.build ? 'v' + event.build.version + ' · ' + (event.build.fingerprint?.slice(0,12) || event.build.mode) :
      Number.isInteger(event.details?.build) ? 'v' + event.details.build + ' · fingerprint not recorded' : 'build not recorded';
    return shell('Activity log', '<p class="subtle">Changes, agreements, rule changes, saved corrections and export requests leave hash-linked receipts. Opening shifts, posts, documents and Ask answers does not create a named receipt; ordinary navigation keeps button totals only. Older browsing receipts remain unchanged in the history. Receipts record the selected profile, device time and source fingerprints. No authenticated identity or active human monitoring is provided. Internal changes and missing middle entries can be detected; detecting a missing tail or replaced log requires a checkpoint kept separately. ' +
      (isKeeper() ? 'You keep the record, so you see every name.' : 'You see your own name. Whoever keeps the record sees them all.') + '</p>' +
      (state.events.length ? '<p><b>' + state.events.length + ' receipts.</b> The newest 25:</p><ul class="compact">' + [...state.events].reverse().slice(0,25).map(event => '<li>' +
        h(event.type + who(event) + ' · ' + timeLabel(event.time) + ' · ' + buildLabel(event) + ' · ' + event.hash.slice(0,12)) + '</li>').join('') + '</ul>' : '<p>Nothing recorded yet.</p>') +
      '<div class="actions">' + button('Check every receipt', 'verify', 'class="secondary"') + button('Check retained posts, files and documents', 'verify-content', 'class="secondary"') + (isKeeper() ? button('Export receipts', 'export', 'class="secondary"') : '') +
      (!publicDemo ? button('Backup and restore', 'data', 'class="text-button"') : '') + '</div>' +
      (head ? '<h3>Latest fingerprint</h3><p class="mark">' + h(head) + '</p><p class="subtle">Whoever holds this device could replace the whole log. A fingerprint kept somewhere else is what catches that. Copy this one and send it to yourself or a coworker now and then. ' +
        'Later, paste the complete fingerprint below to check it against the whole current chain. This checks integrity, not the truth of the entries or the identity of a person.</p><div class="actions">' + button('Copy the latest fingerprint', 'mark-copy', 'class="secondary"') + '</div>' +
        '<form data-form="mark"><label>An earlier fingerprint<input name="mark" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" placeholder="Paste it here"></label>' +
        '<div class="actions inline"><button class="secondary">Look for it in the log</button></div></form>' : ''));
  }
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
        '<p class="subtle">' + clock(voice.seconds) + ' recorded. ' + RULE + '</p><p class="refusal" role="alert"></p>' +
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
  if (type === 'notice') return shell('Before you use this', '<p><b>This is not an official hospital product.</b> It is run by department staff to make the schedule and department news easier to follow. The hospital’s own systems stay the official record.</p>' +
    '<p><b>Never put patient information here.</b> No names, faces, monitors, charts, record numbers or anything that could point to a patient, in a post, a picture, a video, a recording or a question.</p>' +
    '<p><b>Changes and exports use cryptographic audit receipts.</b> Agreements, rule changes and saved corrections are included. Ordinary browsing, Ask lookups and text-screen stops keep anonymous totals only, without names, question fingerprints, blocked text or opened-record details. Your last board visit is kept on this device to show what is new. Sending a reviewed question or remembering wording saves that text or its search words in this browser and in backups. Older browsing receipts remain in existing history.</p>' +
    '<p><b>Hashing does not protect patient information.</b> It is not encryption, a patient-information detector, hospital approval or proof of who acted. The text screen checks only some patterns; it does not inspect uploaded images, video, audio or document-file contents. No one is actively monitoring this device. Deleted content cannot be recovered from its fingerprint.</p>' +
    '<p class="subtle">Receipts use the selected Viewing as profile and this device’s clock. Whoever controls this browser can replace the whole history; keep an independent checkpoint to detect replacement. Keep backups and exports private.</p>' +
    (noticeSeen ? '<p class="subtle">Acknowledged on this device ' + h(timeLabel(noticeSeen.at)) + ', viewing as ' + h(noticeSeen.by) + '.</p><div class="actions">' + button('Close', 'close', 'class="secondary"') + '</div>' :
      '<div class="actions">' + button('I understand', 'notice-ok', 'class="primary"') + '</div>'));
  if (type === 'teach') {
    if (!isKeeper()) return shell('Record keeper access', '<p>Switch to the record keeper’s profile to manage taught answers. Profile selection is a local courtesy until accounts exist.</p>');
    const picked = state.unanswered.find(item => item.id === ui.dialog.pick);
    if (picked) {
      // What Ask says for it now decides which corrections can do anything.
      const now = currentAsk({ q:picked.text }), answered = now.kind !== 'blocked' && !now.empty && !now.taught;
      const brief = result => (result.partial ? '<p class="fair-line"><strong>Partial answer.</strong> ' + h(result.partial) + '</p>' : '') + (result.understood ? '<p class="subtle">Understood as: ' + h(result.understood) + '.</p>' : '') + (result.title ? '<p class="fair-line">' + h(result.title) + '</p>' : '') +
        result.lines.map(text => '<p>' + h(text) + '</p>').join('') + result.items.slice(0, 3).map(entry => '<p><b>' + h(entry.text) + '</b>' + (entry.sub ? ' <small>' + h(entry.sub) + '</small>' : '') + '</p>').join('');
      const reads = ui.dialog.reads || '', screened = reads && patientSigns(reads).length > 0;
      const tried = reads && !screened ? ask(reads, { ...askWorld(), last:null, uncorrected:true }) : null;
      const problem = !reads ? '' : screened ? 'Take the patient details out of the wording.' : readingProblem(picked.text, reads, askWorld());
      const words = ui.dialog.words || '', passages = words ? searchDocuments(words, liveDocuments(), 5, [], sourceVersions) : [];
      return shell('Correct this answer', '<p class="fair-line">' + h(picked.text) + '</p><p class="subtle">' + h([WRONG[picked.reason] || WRONG.unanswered, 'sent ' + prettyDate(picked.at.slice(0, 10))].join(' · ')) + '</p>' +
        '<div class="ask-answer"><p class="subtle">What Ask says now</p>' + brief(now) + '</div>' +
        '<h3>Read it another way</h3><p class="subtle">Type the same question in words Ask gets right, keeping its people, dates and shift scope. Ask uses the current records each time; it does not save a fixed answer. A matching question about another person or day uses that person or day.</p>' +
        '<form data-form="reading-try"><label>It should be read as<input name="reads" maxlength="200" autocomplete="off" value="' + h(reads) + '" placeholder="Who is not working tonight?"></label>' +
        '<div class="actions inline"><button class="secondary">Try it</button></div></form>' +
        (reads ? '<div class="ask-answer">' + (tried ? brief(tried) : '') + (problem ? '<p class="refusal" role="alert">' + h(problem) + '</p>' :
          '<div class="actions">' + button('Save: read it this way', 'reading-save', 'class="primary" ' + valueAttr(picked.id)) + '</div>') + '</div>' : '') +
        (liveDocuments().length ? '<h3>Quote a passage</h3><p class="subtle">Find the part of an added document that answers it. The choice holds until that document changes.</p>' +
          '<form data-form="passage-find"><label>Words from the passage<input name="words" maxlength="120" autocomplete="off" value="' + h(words) + '" placeholder="four weeks before the schedule"></label>' +
          '<div class="actions inline"><button class="secondary">Find it</button></div></form>' +
          (words ? (passages.length ? passages.map(passage => '<div class="ask-item"><div><b>' + h(passage.text.replace(/\s+/g, ' ').slice(0, 220)) + (passage.text.length > 220 ? '…' : '') + '</b><small>' + h([passage.doc.title, passage.heading].filter(Boolean).join(' · ')) + '</small></div>' +
            button('Use this passage', 'passage-pick', 'class="secondary" ' + valueAttr('doc|' + passage.doc.id + '|' + passage.offset)) + '</div>').join('') : '<p class="subtle">No passage has those words.</p>') : '') : '') +
        '<h3>Write a note</h3>' + (answered ? '<p class="subtle">Not offered for this question. Ask already answers it from ' + (now.items.some(entry => entry.go?.startsWith('doc|')) ? 'a document' : now.kind === 'look' ? 'the board' : 'the schedule') +
          ', and a note is shown only when nothing else answers. If the schedule or the document is wrong, correct it there.</p>' :
        '<form data-form="teach"><input type="hidden" name="id" value="' + h(picked.id) + '">' +
        '<label>The answer<textarea name="answer" rows="4" required maxlength="1200" placeholder="Write it the way you would say it to a coworker"></textarea></label>' +
        '<label>Who says so, or which document<input name="source" maxlength="120" autocomplete="off" placeholder="Lead, Nov 10. Or: Time off policy, section 3"></label>' +
        '<label>Link an added source document<select name="documentId"><option value="">General department note; no document authority</option>' + state.documents.map(doc => '<option value="' + h(doc.id) + '">' + h(doc.title) + '</option>').join('') + '</select></label>' +
        '<p class="subtle">This is a human-written custodian note, not official policy approval. A linked note stops matching when its source changes or is removed. Live roster answers and document passages take precedence. ' + RULE + '</p><p class="refusal" role="alert"></p>' +
        '<div class="actions"><button class="primary">Save the note</button></div></form>') +
        '<div class="actions">' + button('Back', 'teach-list', 'class="secondary"') + '</div>');
    }
    const about = item => [item.at ? 'sent ' + prettyDate(item.at.slice(0, 10)) : '', WRONG[item.reason] || WRONG.unanswered, item.understood ? 'understood as: ' + item.understood : ''].filter(Boolean).join(' · ');
    const fix = item => { const doc = item.go && state.documents.find(entry => entry.id === item.go.split('|')[1]), stale = item.go && (!doc || item.sourceHash !== sourceVersions[doc.id]);
      return (item.reads ? 'Read as: “' + item.reads + '”' : 'Quotes a passage of ' + (doc ? doc.title : 'a removed document')) + (stale ? ' · not used now: the document changed or was removed' : '') + ' · ' + item.by + ', ' + prettyDate(item.at.slice(0, 10)); };
    return shell('What Ask has been taught', '<h3>Waiting for the record keeper</h3>' + (state.unanswered.length ? '<div class="line-list">' + state.unanswered.map(item => '<div><span><b>' + h(item.text) + '</b> <small>' + h(about(item)) +
        '</small></span><span class="pair">' + button('Correct it', 'teach-pick', 'class="secondary" ' + valueAttr(item.id)) + button('Dismiss', 'teach-drop', 'class="secondary" ' + valueAttr(item.id)) + '</span></div>').join('') + '</div>' +
        '<p>' + button('Copy the waiting questions', 'teach-copy', 'class="text-button"') + ' <span class="subtle">to send to whoever maintains the app. A misread that keeps coming back is better fixed there.</span></p>' : '<p class="subtle">Nothing is waiting.</p>') +
      '<h3>Corrections</h3>' + (state.corrections.length ? '<div class="line-list">' + state.corrections.map(item => '<div><span><b>' + h(item.asks[0]) + '</b> <small>' + h(fix(item)) +
        '</small></span>' + button('Remove', 'correction-remove', 'class="secondary" ' + valueAttr(item.id)) + '</div>').join('') + '</div>' : '<p class="subtle">None yet. A correction changes how one exact question is read, or which passage it quotes.</p>') +
      '<h3>Notes</h3>' + (state.answers.length ? '<div class="line-list">' + state.answers.map(item => '<div><span><b>' + h(item.asks[0]) + '</b> <small>' + h(item.answer.slice(0, 120)) + ' · ' + h(item.by) + ', ' + h(prettyDate(item.at.slice(0, 10))) +
        '</small></span>' + button('Remove', 'teach-remove', 'class="secondary" ' + valueAttr(item.id)) + '</div>').join('') + '</div>' : '<p class="subtle">None yet. A note is shown only when nothing else answers.</p>') +
      '<div class="actions">' + button('Back to Ask', 'ask-back', 'class="secondary"') + '</div>');
  }
  if (type === 'note') {
    const note = state.answers.find(entry => entry.id === id);
    return shell('Custodian note', note ? '<p class="fair-line">' + h(note.answer) + '</p><p class="subtle">Recorded as ' + h(note.by) + ' · ' + h(timeLabel(note.at)) + '. Not official policy. ' + h(note.source || 'No source named.') + '</p>' +
      (note.documentId ? '<p>' + button('Open linked document', 'doc-open', 'class="secondary" ' + valueAttr(note.documentId)) + '</p>' : '') +
      '<p>' + button('Back to Ask', 'ask-back', 'class="secondary"') + '</p>' : '<p>This note has been removed.</p>');
  }
  if (type === 'send-question') return shell('Review the question to save', (ui.dialog.reason ? '<p class="subtle">Sent to the record keeper as ' + h(WRONG[ui.dialog.reason]) + ', with how Ask understood it. The keeper can correct how it is read or which passage it quotes.</p>' : '') +
    '<form data-form="send-question"><label>Question<textarea name="question" maxlength="200" required>' + h(ui.dialog.q || '') + '</textarea></label>' +
    '<p class="subtle">Sending saves these exact words for the record keeper in this browser and in backups. They remain in a taught answer if the keeper answers it. Remove personal or patient details first. Everyone with control of this browser can access its data.</p><p class="refusal" role="alert"></p><div class="actions">' +
    button('Cancel', 'ask-back', 'class="secondary"') + '<button class="primary">Save reviewed question</button></div><input type="hidden" name="teach" value="' + (ui.dialog.teach ? 'yes' : '') + '"></form>');
  if (type === 'ask') {
    const { q = '' } = ui.dialog;
    // Recheck the current records and viewer every time; never reopen a cached keeper-only answer.
    const result = q ? currentAsk() : null;
    const canRemember = result?.taught || (ui.dialog.opened?.startsWith('doc|') && result?.items.some(entry => entry.go === ui.dialog.opened));
    const item = entry => '<div class="ask-item' + (entry.branch && !entry.go ? ' branch' : '') + '"><div><b>' + h(entry.text) + '</b>' + (entry.sub ? '<small>' + h((entry.go?.startsWith('doc|') ? 'Legacy document, not a reviewed protocol · ' : '') + entry.sub) + '</small>' : '') + '</div>' +
      (entry.href ? '<a class="secondary link-button" href="' + h(entry.href) + '" target="_blank" rel="noopener noreferrer">Open official source ↗</a>' : entry.go ? button('Open', 'ask-go', 'class="secondary" ' + valueAttr(entry.go)) : '') + '</div>';
    return shell('Ask', '<form data-form="ask"><label>Your question<input name="q" maxlength="200" autocomplete="off" enterkeyhint="search" placeholder="When do I work next?" value="' + h(q) + '"' + (result ? '' : ' autofocus') + '></label>' +
      '<div class="actions inline"><button class="primary">Ask</button></div></form>' +
      (result ? '<div class="ask-answer" role="status">' + (result.partial ? '<p class="fair-line"><strong>Partial answer.</strong> ' + h(result.partial) + '</p>' : '') + (result.read || result.understood ? '<p class="subtle">' + h([result.read ? 'Read as: “' + result.read + '”' + (result.corrected?.kind === 'reading' ? ', a correction by ' + result.corrected.by + ' as record keeper' : '') : '',
          result.understood ? 'Understood as: ' + result.understood : ''].filter(Boolean).join('. ')) + '.</p>' : '') + (result.title ? '<p class="fair-line">' + h(result.title) + '</p>' : '') + result.lines.map(text => '<p>' + h(text) + '</p>').join('') + result.items.map(item).join('') +
        '<p class="subtle">From: ' + h(result.source) + '</p>' +
        (result.next?.length ? '<div class="chip-list"><span class="subtle">Next</span><div>' + result.next.map((text, index) => button(h(text), 'ask-next', 'class="chip plain" ' + valueAttr(index))).join('') + '</div></div>' : '') +
        (result.kind === 'blocked' ? '' : ui.dialog.yes ? '<p class="subtle">' + h(ui.dialog.yes) + '</p>' :
          // A protocol answer is not open to a vote. Nothing a reader presses here can change it.
          result.kind === 'fact' ? '<p class="subtle">A reference card answers only after someone here has checked it against its source. “Yes”, repeated questions and search cannot change one. If it looks wrong, open the page and tell a record keeper.</p><div class="actions wrap">' +
            button('Review and send to the record keeper', 'ask-send', 'class="secondary"') + '</div>' :
          result.kind === 'protocol' ? '<p class="subtle">A protocol answer comes only from a reviewed mapping. “Yes”, repeated questions and search cannot change it. If it looks wrong, open the original and tell a record keeper.</p><div class="actions wrap">' +
            button('Review and send to the record keeper', 'ask-send', 'class="secondary"') + '</div>' : result.empty ? '<div class="actions wrap">' + button('Review and send to the record keeper', 'ask-send', 'class="secondary"') + button('Put this question on the board', 'ask-post', 'class="secondary"') +
          (isKeeper() ? button('Teach the answer', 'ask-teach', 'class="secondary"') : '') + '</div>' :
          // A wrong answer has one of three causes, and each is fixed in a different place.
          ui.dialog.no ? '<p class="subtle">What was wrong? You can also ask it again in other words.</p><div class="actions wrap">' + button('It misread my question', 'ask-wrong', 'class="secondary" ' + valueAttr('misread')) +
            (result.items.some(entry => entry.go?.startsWith('doc|')) ? button('It quoted the wrong part', 'ask-wrong', 'class="secondary" ' + valueAttr('passage')) : '') +
            (SCHEDULE_KINDS.includes(result.kind) ? button('The schedule itself is wrong', 'ask-wrong', 'class="secondary" ' + valueAttr('schedule')) : '') +
            button('Put this question on the board', 'ask-post', 'class="secondary"') + (isKeeper() ? button('Correct it now', 'ask-teach', 'class="secondary"') : '') + '</div>' :
          '<div class="actions wrap"><span class="subtle">Did that answer it?</span>' + button(canRemember ? 'Yes, remember this wording' : 'Yes', 'ask-yes', 'class="secondary"') + button('No', 'ask-no', 'class="secondary"') + '</div>' +
          (canRemember ? '<p class="subtle">Remembering saves wording or search words in this browser and backups. It records relevance feedback, not policy approval.</p>' : '')) + '</div>' :
        '<p class="subtle">It looks up supported questions and opens the records it finds. Nothing is sent to an AI service. Question text is not routinely saved; sending it or remembering wording saves a reviewed example. Receipts record fingerprints and source versions.</p>') +
      '<div class="chip-list"><span class="subtle">Try</span><div>' + SUGGESTIONS.map((text, index) => button(h(text), 'ask-try', 'class="chip plain" ' + valueAttr(index))).join('') + '</div></div>' +
      '<p>' + button('Protocols (' + state.protocols.families.length + ')', 'tab', 'class="text-button" ' + valueAttr('protocols')) + ' ' + button('Pasted documents it can search (' + state.documents.length + ')', 'docs', 'class="text-button"') + ' ' +
        (isKeeper() ? button('Corrections and notes (' + (state.corrections.length + state.answers.length) + '), waiting (' + state.unanswered.length + ')', 'teach-list', 'class="text-button"') : '') + '</p>');
  }
  if (type === 'protocol-add') return shell(ui.busy ? 'Reading the protocol' : 'Add a protocol', addDialog({ busy:ui.busy }, viewTools));
  if (type === 'docs') {
    const about = doc => [doc.kind, doc.effective ? 'effective ' + doc.effective : 'no effective date given', 'added by ' + doc.by + ' on ' + prettyDate(doc.added.slice(0, 10)), fileSize(doc.text.length)].join(' · ');
    return shell('Documents', '<p class="subtle">Ask searches these and quotes them with their title, section and date. Add only what the department is allowed to share. They are kept in this browser and go into backups.</p>' +
      (state.documents.length ? '<div class="line-list">' + state.documents.map(doc => '<div><span><b>' + h(doc.title) + '</b> <small>' + h(about(doc)) + '</small></span><span class="pair">' +
        button('Open', 'doc-open', 'class="secondary" ' + valueAttr(doc.id)) + (ui.dialog.confirm === doc.id ? button('Remove for good', 'doc-remove-yes', 'class="danger" ' + valueAttr(doc.id)) :
          button('Remove', 'doc-remove', 'class="secondary" ' + valueAttr(doc.id))) + '</span></div>').join('') + '</div>' : '<p>No documents yet.</p>') +
      '<h3>Add a document</h3><form data-form="doc"><label>Title<input name="title" maxlength="120" required autocomplete="off" placeholder="Time off requests"></label>' +
      '<div class="cell-when"><label>What it is<select name="kind">' + ['Policy', 'Procedure', 'Protocol', 'Manual', 'Other'].map(kind => '<option>' + kind + '</option>').join('') + '</select></label>' +
      '<label>Effective date<input name="effective" type="date"></label></div>' +
      '<label class="attach"><b>＋ A text file (.txt or .md)</b><input id="doc-file" name="file" type="file" accept=".txt,.md,text/plain,text/markdown"></label>' +
      '<label>Or paste the words<textarea name="text" rows="5" placeholder="Paste the text of the document here"></textarea></label>' +
      '<p class="subtle">A PDF cannot be read yet. Open it, select all, copy, and paste the words here. ' + RULE + '</p>' +
      '<div class="actions">' + button('Back to Ask', 'ask-back', 'class="secondary"') + '<button class="primary">Add the document</button></div></form>');
  }
  if (type === 'doc') {
    const doc = state.documents.find(entry => entry.id === id);
    if (!doc) return '';
    const at = ui.dialog.at, end = at == null ? 0 : (doc.text.indexOf('\n\n', at) < 0 ? doc.text.length : doc.text.indexOf('\n\n', at));
    return shell(doc.title, '<p class="subtle">' + h([doc.kind, doc.effective ? 'effective ' + doc.effective : 'no effective date given', 'added by ' + doc.by + ' on ' + prettyDate(doc.added.slice(0, 10))].join(' · ')) + '</p>' +
      '<div class="doc-text">' + (at == null ? h(doc.text) : h(doc.text.slice(0, at)) + '<mark id="doc-mark">' + h(doc.text.slice(at, end)) + '</mark>' + h(doc.text.slice(end))) + '</div>' +
      '<div class="actions">' + button('Back to Ask', 'ask-back', 'class="secondary"') + '</div>');
  }
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
      '<p><b>' + state.assignments.length + '</b> shifts · <b>' + state.people.length + '</b> contacts · ' + h(state.mode === 'sample' ? 'sample workspace' : 'published ' + timeLabel(state.importedAt)) + ' · ' + h(BUILD_LABEL) + '</p>' +
      '<p class="subtle">Build fingerprint: ' + h(BUILD_INFO.fingerprint || 'No release fingerprint') + ' · ' + h(BUILD_INFO.mode) + '. New receipts include this build identity.</p>' +
      '<p class="subtle">Source commit: ' + h(BUILD_INFO.source.commit || 'Unknown: built without the source repository') + (BUILD_INFO.source.dirty ? ' · modified working copy' : '') + '.</p>' +
      '<h3>Backup</h3><p class="subtle">A backup file holds the schedule, the contacts with their phone numbers, requests, history and added documents. Photos, videos and recordings are not included. Keep the file somewhere private.</p>' +
      '<p>' + button('Save a backup file', 'backup', 'class="primary"') + '</p>' +
      '<label class="drop"><b>Restore from a backup file</b><span>Choose a file saved with the button above</span><input id="backup-file" type="file" accept="application/json,.json"></label>' +
      (() => {
        const usage = loadState(usageKey, null), rows = Object.entries(usage?.counts || {}).sort((a, b) => b[1] - a[1]);
        return '<h3>How this copy gets used</h3><p class="subtle">Which buttons get pressed, by button name and total only. No names, no shifts, no typed words, no recordings. Kept in this browser and left out of backups.</p>' +
          '<p>Text screen stops: <b>' + (usage?.counts?.['text-screen-blocked'] || 0) + '</b>. Counts each stop, including repeat presses and false alarms. No blocked text or person is recorded; this is not a count of confirmed patient disclosures.</p>' +
          (rows.length ? '<div class="usage">' + rows.slice(0, 15).map(([name, total]) => '<div><span>' + h(USAGE_NAMES[name] || name) + '</span><b>' + total + '</b></div>').join('') + '</div>' +
            '<p class="subtle">' + rows.reduce((sum, row) => sum + row[1], 0) + ' actions counted since ' + h(usage.since) + '.</p><p>' + button('Copy the counts', 'usage-copy', 'class="secondary"') + ' ' +
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
    ui.lastAsk = null;
    ui.askContext = null;
    ui.dialog = null;
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
  // The collection and the retired box take effect at once, with whatever is typed in the search box.
  if (event.target.id === 'reference-section' || event.target.id === 'reference-retired') { const form = event.target.closest('form'), data = Object.fromEntries(new FormData(form));
    ui.protocols = { ...ui.protocols, refQuery:(data.q || '').trim().slice(0, 120), refSection:data.section || '', refRetired:Boolean(data.retired) }; render(); }
  if (event.target.id === 'protocol-mapping-file' && event.target.files[0]) void addMappingFile(event.target.files[0]).then(render).catch(fail);
  if (event.target.id === 'protocol-original-file' && event.target.files[0]) void restoreOriginal(event.target.files[0]).then(render).catch(fail);
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
  if (!ui.busy && (ui.dialog?.type !== 'notice' || noticeSeen)) { clearPreview(); stopVoice(); ui.dialog = null; render(); }
}, true);
// A browser closes a dialog by itself when Escape is pressed more than once. The notice comes straight back, and so does
// a dialog that is in the middle of saving.
app.addEventListener('close', event => {
  if (event.target.tagName !== 'DIALOG' || !ui.dialog) return;
  if ((ui.dialog.type !== 'notice' || noticeSeen) && !ui.busy) { clearPreview(); stopVoice(); ui.dialog = null; }
  render();
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

function fail(error) { ui.notice = error.message || String(error); ui.flash = ui.notice; ui.dialog = noticeSeen ? null : { type:'notice' }; render(); }

async function act({action, value, kind}) {
  if (!noticeSeen && !['notice-ok', 'notice'].includes(action)) { ui.dialog = { type:'notice' }; render(); return; }
  const row = state.assignments.find(item => item.key === value);
  if (action === 'more-lines') {          // added in place, so nothing already typed is lost
    const rows = app.querySelector('dialog .name-rows');
    if (rows) rows.insertAdjacentHTML('beforeend', Array.from({ length: 3 }, (_, index) => nameLine(null, rows.children.length + index)).join(''));
    return;
  }
  ui.notice = '';
  ui.flash = '';
  switch (action) {
    case 'tab':
      ui.tab = value;
      ui.dialog = null;
      if (value === 'board') markBoardSeen();
      break;
    case 'ask-open': ui.dialog = ui.lastAsk || { type:'ask' }; break;
    case 'ask-back': ui.dialog = ui.lastAsk || { type:'ask' }; break;
    case 'ask-try': await runAsk(SUGGESTIONS[Number(value)]); break;
    case 'ask-next': { const next = ui.dialog?.type === 'ask' && ui.dialog.q ? currentAsk().next?.[Number(value)] : null; if (next) await runAsk(next); break; }
    case 'ask-post': if (patientSigns(ui.dialog.q).length) return; ui.draftPost = ui.dialog.q || ''; ui.tab = 'board'; ui.boardFilter = 'all'; ui.dialog = null; ui.scrollTo = '.composer'; markBoardSeen(); break;
    case 'ask-go': {
      const [kind, first, second] = String(value).split('|');
      if (ui.dialog?.type === 'ask' && ui.lastAsk) ui.lastAsk = { ...ui.lastAsk, opened:value };      // the one they chose to read is the one a yes is about
      if (kind === 'doc') { ui.dialog = { type:'doc', id:first, at:Number(second) }; ui.scrollTo = '#doc-mark'; break; }
      if (kind === 'note') { ui.dialog = { type:'note', id:first }; break; }
      if (kind === 'knowledge') { ui.dialog = null; ui.tab = 'protocols'; ui.protocols = { ...ui.protocols, family:null, revision:null, shelf:'knowledge:' + first, withdrawing:false, fromAsk:false }; ui.scrollTo = '.content'; break; }
      if (kind === 'refs') { ui.dialog = null; ui.tab = 'protocols'; ui.protocols = { ...ui.protocols, shelf:'references', refQuery:decodeURIComponent(first || ''), refSection:'', refRetired:second === 'retired', fromAsk:false }; ui.scrollTo = '.content'; break; }
      // The exact revision cited, at the cited place, even when a later revision has since replaced it.
      if (kind === 'protocol' || kind === 'protocol-family') {
        const revision = kind === 'protocol' ? revisionOf(state.protocols, first) : landingRevision(state.protocols, first, localToday());
        if (!revision) throw new Error('That revision is no longer held on this device.');
        ui.dialog = null; ui.tab = 'protocols';
        ui.protocols = { ...ui.protocols, family:revision.family, revision:revision.id, cite:kind === 'protocol' ? second || null : null, pane:['both', 'original'].includes(ui.protocols.pane) ? ui.protocols.pane : 'both', withdrawing:false, fromAsk:true };
        ui.scrollTo = ui.protocols.cite ? '#cite-mark' : '.content';
        break;
      }
      if (kind === 'options') { const target = state.assignments.find(item => item.key === String(value).slice(8)); if (target && isMine(target)) ui.dialog = { type:'options', row:target, found:optionsFor(target) }; break; }
      ui.dialog = null;
      if (kind === 'date') { ui.tab = 'schedule'; ui.view = 'week'; ui.date = first; ui.scrollTo = '.day-card[data-date="' + first + '"]'; }
      else if (kind === 'post') { ui.tab = 'board'; ui.boardFilter = 'all'; ui.scrollTo = '[data-post="' + CSS.escape(first) + '"]'; markBoardSeen(); }
      else if (kind === 'people' || kind === 'fairness') ui.tab = kind;
      break;
    }
    case 'protocol-home': ui.protocols = { ...ui.protocols, family:null, revision:null, cite:null, withdrawing:false, fromAsk:false, shelf:null }; break;
    case 'knowledge-open': ui.protocols = { ...ui.protocols, family:null, revision:null, shelf:'knowledge:' + value, withdrawing:false }; ui.scrollTo = '.content'; break;
    case 'knowledge-add': {
      keeperOnly();
      const set = (await import('./reference/cards-blood-gases.json')).default;
      await protocolStep(addSet(state.protocols, set, state.actor, new Date().toISOString()), 'Reference cards added, unchecked. None answers until it has been compared with the cited page.');
      ui.protocols = { ...ui.protocols, family:null, revision:null, shelf:'knowledge:' + set.id, withdrawing:false };
      break;
    }
    case 'knowledge-check': keeperOnly(); await protocolStep(reviewCard(state.protocols, ui.protocols.shelf.slice(10), value, state.actor, new Date().toISOString())); break;
    case 'reference-shelf': ui.protocols = { ...ui.protocols, family:null, revision:null, shelf:'references' }; ui.scrollTo = '.content'; break;
    case 'protocol-open': ui.protocols = { ...ui.protocols, family:value, revision:landingRevision(state.protocols, value, localToday())?.id || null, cite:null, withdrawing:false, fromAsk:false }; ui.scrollTo = '.content'; break;
    case 'protocol-revision': ui.protocols = { ...ui.protocols, revision:value, cite:null, withdrawing:false }; break;
    case 'protocol-pane': ui.protocols = { ...ui.protocols, pane:['both', 'original', 'reading', 'answers'].includes(value) ? value : 'both' }; break;
    case 'protocol-cite': {
      const [id, anchor] = String(value).split('|'), revision = revisionOf(state.protocols, id);
      if (!revision) throw new Error('That revision is no longer held on this device.');
      ui.protocols = { ...ui.protocols, family:revision.family, revision:id, cite:anchor, pane:ui.protocols.pane === 'original' ? 'original' : 'both', withdrawing:false };
      ui.scrollTo = '#cite-mark';
      break;
    }
    case 'protocol-mark': await protocolStep({ ok:true, library:toggleMark(state.protocols, value) }); break;
    case 'protocol-add': keeperOnly(); ui.dialog = { type:'protocol-add' }; break;
    case 'protocol-sample': {
      keeperOnly();
      const label = ['1', '2'].find(entry => !state.protocols.revisions.some(revision => revision.file.name === 'rt-train-014-rev' + entry + '.pdf'));
      if (!label) break;
      ui.busy = 'Reading the invented protocol on this device…'; ui.dialog = { type:'protocol-add' }; render();
      try {
        const name = 'rt-train-014-rev' + label + '.pdf', reply = await fetch(asset('fixtures/protocols/' + name));
        if (!reply.ok) throw new Error('The invented protocol is not part of this copy of the app.');
        const result = await addProtocolFile(new File([await reply.blob()], name, { type:'application/pdf' }), { title:'Blue Trainer Bellows Drill', identifier:'RT-TRAIN-014', label, effective:label === '1' ? '2026-06-01' : '2026-11-01',
          authority:'Lakeside Training Hospital Respiratory Education Committee (fictional)', category:'Training drill (invented)', location:'Shipped with Department Hub as synthetic test material' });
        ui.protocols = { ...ui.protocols, family:result.family.id, revision:result.revision.id, pane:'both', cite:null, withdrawing:false, fromAsk:false };
        ui.notice = 'Added revision ' + label + ' of the invented protocol, unchecked. It answers nothing until its reading is confirmed, its answers are reviewed and it is made active.';
      } finally { ui.busy = null; ui.dialog = null; }
      break;
    }
    case 'protocol-sample-mapping': {
      keeperOnly();
      const revision = shownRevision(), reply = await fetch(asset('fixtures/protocols/' + revision.file.name.replace(/\.pdf$/, '.mapping.json')));
      if (!reply.ok) throw new Error('No mapping ships for this file.');
      await protocolStep(addMapping(state.protocols, revision.id, await reply.json(), state.actor, new Date().toISOString()), 'Mapped answers added as proposals. None answers a question until it is reviewed against the original.');
      ui.protocols = { ...ui.protocols, pane:'answers' };
      break;
    }
    case 'protocol-check': keeperOnly(); await protocolStep(checkExtraction(state.protocols, shownRevision().id, state.actor, new Date().toISOString()), 'Reading confirmed. Answers can now be mapped to it and reviewed.'); break;
    case 'protocol-figure': {
      keeperOnly();
      const revision = shownRevision(), marked = revision.extraction.pages.some(page => page.blocks.some(block => block.anchor === value && block.figure));
      await protocolStep(markFigure(state.protocols, revision.id, value, !marked));
      break;
    }
    case 'protocol-review': keeperOnly(); await protocolStep(reviewBundle(state.protocols, shownRevision().id, value, state.actor, new Date().toISOString()), 'Recorded as reviewed against the original.'); break;
    case 'protocol-reviewed': keeperOnly(); await protocolStep(markMappingsReviewed(state.protocols, shownRevision().id, state.actor, new Date().toISOString()), 'Answers recorded as reviewed. The revision can now be made active.'); ui.protocols = { ...ui.protocols, pane:'both' }; break;
    case 'protocol-activate': {
      keeperOnly();
      const revision = shownRevision();
      await protocolStep(activate(state.protocols, revision.id, state.actor, new Date().toISOString(), localToday()), revision.effective <= localToday() ? 'Revision ' + revision.label + ' is now active. Earlier revisions are history.' : 'Revision ' + revision.label + ' will be in use from ' + revision.effective + '.');
      break;
    }
    case 'protocol-withdraw': keeperOnly(); ui.protocols = { ...ui.protocols, withdrawing:true }; ui.scrollTo = '.protocol-step'; break;
    case 'protocol-withdraw-cancel': ui.protocols = { ...ui.protocols, withdrawing:false }; break;
    case 'protocol-ask': {
      // Opens Ask already pointed at this protocol, so "when do I stop?" needs no protocol name. Held for this conversation only.
      const revision = shownRevision();
      ui.askContext = { kind:'protocol', protocol:{ family:revision.family, revision:revision.digest, facts:{}, pending:'topic' } };
      ui.lastAsk = null;
      if (value) await runAsk(value); else ui.dialog = { type:'ask', previousContext:ui.askContext };
      break;
    }
    case 'docs': ui.dialog = { type:'docs' }; break;
    case 'doc-open': ui.dialog = { type:'doc', id:value }; break;
    case 'doc-remove': ui.dialog = { type:'docs', confirm:value }; break;
    case 'doc-remove-yes': {
      const doc = state.documents.find(entry => entry.id === value);
      if (!doc) return;
      await commit('Document removed', { id:doc.id, title:doc.title, version:sourceVersions[doc.id] }, previous => ({ ...previous,
        documents:previous.documents.filter(entry => entry.id !== value), learned:previous.learned.filter(link => !link.go.startsWith('doc|' + doc.id + '|')) }));
      ui.dialog = { type:'docs' };
      ui.flash = 'Removed ' + doc.title + '.';
      break;
    }
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
      await commit('Export requested', { kind:'fairness-record' }, previous => previous);
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
      try { await navigator.clipboard.writeText('Department Hub action totals since ' + (usage?.since || '') + '\n' + text); ui.flash = 'Counts copied.'; }
      catch { ui.flash = 'Copying was not allowed here.'; }
      break;
    }
    case 'edit-shift': { const [date, shift] = value.split('|'); ui.dialog = { type:'edit-shift', date, shift }; break; }
    case 'erase-ask': ui.dialog = { type:'data', confirmErase:true }; break;
    case 'backup': {
      await commit('Export requested', { kind:'workspace-backup' }, previous => previous);
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
      sourceVersions = await versionsFor(state.documents);
      ui.lastAsk = null;
      ui.askContext = null;
      ui.draftPost = '';
      markBoardSeen(null);
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
    case 'notice': ui.dialog = { type:'notice' }; break;
    case 'close': if (ui.busy || (ui.dialog?.type === 'notice' && !noticeSeen)) return; clearPreview(); stopVoice(); ui.dialog = null; break;
    case 'notice-ok':
      await commit('Notice acknowledged', { by:state.actor }, previous => previous);
      noticeSeen = { at:new Date().toISOString(), by:state.actor };
      try { localStorage.setItem(noticeKey, JSON.stringify(noticeSeen)); } catch { /* asked again next time */ }
      ui.dialog = null;
      break;
    case 'verify': {
      const check = await verifyReceipts(state.events);
      ui.flash = check.ok ? 'All ' + check.count + ' receipt links and hashes check out. A missing tail or replaced history cannot be detected without a separately saved checkpoint. Content and identities are not verified by this check.' : 'Receipt ' + check.at + ' ' + check.why + '. The history from there on cannot be relied on.';
      break;
    }
    case 'verify-content': {
      const chain = await verifyReceipts(state.events);
      if (!chain.ok) { ui.flash = 'Check failed: receipt ' + chain.at + ' ' + chain.why + '.'; break; }
      const check = await verifyContent({ events:state.events, posts:state.posts, documents:state.documents, file:id => boardStore.file(id) });
      ui.flash = check.checked + ' retained items checked. ' + (check.issues.length ? check.issues.join(' ') : 'No content mismatches among checked items.') +
        (check.unavailable.length ? ' Unavailable files (including files excluded from backups): ' + check.unavailable.length + '.' : '') +
        (check.legacy.length ? ' Older or partially fingerprinted items not fully verified: ' + check.legacy.length + '.' : '') + ' This does not establish policy approval or recover deleted content.';
      break;
    }
    case 'mark-copy':
      try { await navigator.clipboard.writeText(state.events.at(-1)?.hash || ''); ui.flash = 'Copied. Keep it somewhere outside this app.'; }
      catch { ui.flash = 'Copying was not allowed here. Press and hold the fingerprint to copy it.'; }
      break;
    case 'ask-no': if (['protocol', 'fact'].includes(currentAsk()?.kind)) return; ui.lastAsk = ui.dialog = { ...ui.dialog, no:true }; break;
    case 'ask-wrong': {
      const q = (ui.dialog?.q || '').trim(), result = q ? currentAsk() : null;
      if (!result || result.kind === 'blocked') return;
      if (value === 'schedule') {          // Ask only repeats the schedule, so that is where it is put right
        const dated = result.items.find(entry => entry.go?.startsWith('date|'))?.go.slice(5);
        ui.dialog = null; ui.tab = 'schedule';
        if (dated) { ui.view = 'week'; ui.date = dated; ui.scrollTo = '.day-card[data-date="' + dated + '"]'; }
        ui.notice = 'Ask repeats what the schedule says. Use Edit names on the shift to correct it, and the answer follows.';
        break;
      }
      if (!WRONG[value] || patientSigns(q).length) return;
      ui.dialog = { type:'send-question', q, reason:value };
      break;
    }
    case 'reading-save': {
      if (!isKeeper() || ui.dialog?.type !== 'teach') return;
      const waiting = state.unanswered.find(item => item.id === value), reads = (ui.dialog.reads || '').trim();
      if (!waiting || !reads || patientSigns(waiting.text + '\n' + reads).length || readingProblem(waiting.text, reads, askWorld())) return;
      const names = [...new Set(state.assignments.map(row=>row.person))];
      const entry = { id:crypto.randomUUID(), asks:[waiting.text], reads, people:findPeople(tidyQuestion(waiting.text,names).text,names), by:state.actor, at:new Date().toISOString() };
      await commit('Reading correction saved', { id:entry.id, question:await sha256(waiting.text.trim().toLowerCase()), reads:await sha256(reads.toLowerCase()) }, previous => ({ ...previous,
        corrections:[...previous.corrections.filter(item => !sameAsk(item, waiting.text)), entry].slice(-200), unanswered:previous.unanswered.filter(item => item.id !== waiting.id),
        learned:previous.learned.filter(link=>!previous.corrections.some(item=>sameAsk(item,waiting.text)&&item.id===link.correctionId)) }));
      ui.dialog = { type:'teach' };
      ui.flash = 'Saved. That question is now read as “' + reads + '”.';
      break;
    }
    case 'passage-pick': {
      if (!isKeeper() || ui.dialog?.type !== 'teach') return;
      const waiting = state.unanswered.find(item => item.id === ui.dialog.pick), [, documentId] = String(value).split('|'), sourceHash = sourceVersions[documentId];
      if (!waiting || !sourceHash || !liveDocuments().some(doc => doc.id === documentId)) return;
      const entry = { id:crypto.randomUUID(), asks:[waiting.text], go:value, sourceHash, by:state.actor, at:new Date().toISOString() };
      const read = currentAsk({ q:waiting.text }), wording = read.read || waiting.text, terms = keywords(wording);
      await commit('Passage correction saved', { id:entry.id, question:await sha256(waiting.text.trim().toLowerCase()), reference:value, sourceHash }, previous => ({ ...previous,
        corrections:[...previous.corrections.filter(item => !sameAsk(item, waiting.text)), entry].slice(-200), unanswered:previous.unanswered.filter(item => item.id !== waiting.id),
        // a question worded nearly the same way gets the same passage lifted, as it does after a confirmed answer
        learned: [...previous.learned.filter(link => !previous.corrections.some(item=>sameAsk(item,waiting.text)&&item.id===link.correctionId) &&
          !(link.go === value && link.terms.join(' ') === terms.join(' '))), ...(terms.length ? [{ terms, go:value, count:3, sourceHash, qualifiers:qualifiers(wording),correctionId:entry.id }] : [])].slice(-400) }));
      ui.dialog = { type:'teach' };
      ui.flash = 'Saved. That question now quotes the passage you chose, until the document changes.';
      break;
    }
    case 'correction-remove': if (isKeeper()) await commit('Correction removed', { id:value }, previous => ({ ...previous,
      corrections:previous.corrections.filter(item => item.id !== value),learned:previous.learned.filter(link=>link.correctionId!==value) })); break;
    case 'teach-copy': {
      if (!isKeeper()) return;
      const lines = state.unanswered.map(item => [item.text, WRONG[item.reason] || WRONG.unanswered, item.understood ? 'understood as: ' + item.understood : ''].filter(Boolean).join(' | '));
      void commit('Export requested', { kind:'waiting-questions', count:lines.length }, previous => previous).catch(fail);
      try { await navigator.clipboard.writeText(lines.join('\n')); ui.flash = 'Copied ' + lines.length + ' waiting question' + (lines.length === 1 ? '' : 's') + '.'; }
      catch { ui.flash = 'Copying was not allowed here.'; }
      break;
    }
    case 'ask-yes': {
      const { q } = ui.dialog, result = currentAsk(), opened = ui.dialog.opened;
      const top = result.items.some(item => item.go === opened) ? opened : '';
      if (!result || ui.dialog.yes) return;
      if (result.kind === 'blocked' || result.kind === 'protocol' || result.kind === 'fact') return;
      const terms = keywords(result.read || q), documentId = top.startsWith('doc|') ? top.split('|')[1] : '', sourceHash = sourceVersions[documentId];
      const same = link => link.go === top && link.terms.join(' ') === terms.join(' ') && link.sourceHash === sourceHash, asked = q.trim();
      // Two ways it learns from a yes: a confirmed passage comes first next time, and a taught answer picks up this wording.
      await commit('Answer relevance feedback', { fingerprint:await sha256(asked.toLowerCase()), kind:result.kind, opened:result.taught || top || null, sourceHash:sourceHash || null,
        wordingSaved:Boolean(result.taught || sourceHash) }, previous => ({ ...previous,
        learned: !sourceHash || !terms.length ? previous.learned : previous.learned.some(same) ? previous.learned.map(link => same(link) ? { ...link, count:link.count + 1 } : link) : [...previous.learned, { terms, go:top, count:1, sourceHash, qualifiers:qualifiers(result.read || q) }].slice(-400),
        answers: !result.taught ? previous.answers : previous.answers.map(item => item.id !== result.taught || item.asks.some(text => text.toLowerCase() === asked.toLowerCase()) ? item : { ...item, asks:[...item.asks, asked].slice(-12) }) }));
      ui.lastAsk = ui.dialog = { ...ui.dialog, yes:sourceHash ? 'Search words remembered for this source version. This records relevance, not policy approval.' : result.taught ? 'Wording saved with the custodian note. This is not policy approval.' : 'Feedback recorded. Open a passage before remembering wording for it.' };
      break;
    }
    case 'ask-send': case 'ask-teach': {
      const q = (ui.dialog.q || '').trim();
      if (!q) return;
      if (patientSigns(q).length) { ui.flash = 'That question looks like it has patient details in it. Ask it again without them, and then send it.'; break; }     // a waiting question is kept as typed
      if (action === 'ask-teach' && !isKeeper()) return;
      ui.dialog = { type:'send-question', q, teach:action === 'ask-teach' };
      break;
    }
    case 'teach-list': if (isKeeper()) ui.dialog = { type:'teach' }; break;
    case 'teach-pick': if (isKeeper()) ui.dialog = { type:'teach', pick:value }; break;
    case 'teach-drop': if (isKeeper()) await commit('Question dismissed', { id:value }, previous => ({ ...previous, unanswered:previous.unanswered.filter(item => item.id !== value) })); break;
    case 'teach-remove': if (isKeeper()) await commit('Taught answer removed', { id:value }, previous => ({ ...previous, answers:previous.answers.filter(item => item.id !== value) })); break;
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
        // Queue the receipt without awaiting it: native sharing needs the original tap's activation.
        void commit('Export requested', { kind:'board-share', reference:post.id }, previous => previous).catch(fail);
        try { await navigator.share(files.length && navigator.canShare?.({ files }) ? { ...words, files } : words); return; }
        catch (error) { if (error.name === 'AbortError') return; }
      }
      ui.dialog = { type:'share', id:post.id };
      break;
    }
    case 'copy-share': {
      const post = state.posts.find(item => item.id === value);
      if (!post || post.inside) return;
      void commit('Export requested', { kind:'board-copy', reference:post.id }, previous => previous).catch(fail);
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
    case 'options': if (row && isMine(row)) ui.dialog = { type:'options', row, found:optionsFor(row) }; break;
    case 'options-loops': if (ui.dialog?.type === 'options') ui.dialog = { ...ui.dialog, loops:true, found:optionsFor(ui.dialog.row, true) }; break;
    case 'propose': {
      const [group, index] = String(value).split('|'), option = ui.dialog?.found?.[group]?.[Number(index)], target = ui.dialog?.row;
      if (!option || !target || !isMine(target)) return;
      const world = tradeWorld(), rows = new Map(world.roster.map(item => [item.key, item]));
      if (option.moves.some(move => !rows.has(move.key))) { ui.flash = 'The schedule changed. Find the options again.'; break; }
      const moves = option.moves.map(move => { const item = rows.get(move.key); return { key:move.key, to:move.to, from:item.person, date:item.date, shift:item.shift, ...(item.role ? { role:item.role } : {}), ...(item.hours ? {hours:item.hours} : {}) }; });
      const result = checkExchange({ ...world, moves });
      if (result.status === 'blocked') { ui.flash = 'That no longer passes. ' + result.problems.join(' '); break; }
      const people = parties(moves, rows), now = new Date().toISOString();
      const basis = exchangeBasis(world,moves);
      const exchange = { id:crypto.randomUUID(), by:state.actor, created:now, moves, parties:people, accepted:{ [normalizeName(state.actor)]:now }, summary:describe(result), basis,
        status:'Waiting for ' + namesList(people.filter(name => !isSame(name, state.actor))), version:await sha256(basis) };
      await commit('Exchange proposed', { id:exchange.id, version:exchange.version, people:people.length, moves:moves.map(move => [move.key, move.to]), check:result.status, rules:tradeRules() }, previous => ({ ...previous, exchanges:[...previous.exchanges, exchange] }));
      ui.dialog = { type:'exchange', id:exchange.id };
      break;
    }
    case 'exchange': ui.dialog = { type:'exchange', id:value }; break;
    case 'exchange-agree': case 'exchange-decline': case 'exchange-withdraw': {
      const exchange = state.exchanges.find(item => item.id === ui.dialog?.id);
      if (!exchange || !exchange.status.startsWith('Waiting')) return;
      const update = change => previous => ({ ...previous, exchanges:previous.exchanges.map(item => item.id === exchange.id ? { ...item, ...change } : item) });
      if (action === 'exchange-withdraw') { if (isSame(exchange.by, state.actor)) await commit('Exchange withdrawn', { id:exchange.id }, update({ status:'Withdrawn' })); break; }
      if (!pendingOf(exchange).some(name => isSame(name, state.actor))) return;
      if (action === 'exchange-decline') { await commit('Exchange declined', { id:exchange.id }, update({ status:'Declined' })); break; }
      // Checked again on the schedule as it stands now, with everything agreed since counted in.
      const result = checkExchange({ ...tradeWorld(exchange.id), moves:exchange.moves, basis:exchange.basis || '' });
      if (result.status === 'blocked') { await commit('Exchange blocked after recheck', { id:exchange.id, version:exchange.version }, update({ status:'No longer possible', summary:describe(result) })); break; }
      const accepted = { ...exchange.accepted, [normalizeName(state.actor)]:new Date().toISOString() }, left = exchange.parties.filter(name => !accepted[normalizeName(name)]);
      await commit(left.length ? 'Exchange accepted' : 'Exchange agreed by everyone', { id:exchange.id, version:exchange.version, check:result.status }, previous => {
        const latest = checkExchange({...tradeWorld(exchange.id),moves:exchange.moves,basis:exchange.basis || ''});
        if (latest.status === 'blocked') throw new Error('The exchange changed while saving. Reopen it and review the current result.');
        return update({ accepted, summary:describe(latest), status:left.length ? 'Waiting for ' + namesList(left) : EXCHANGE_AGREED })(previous);
      });
      break;
    }
    case 'trade-rules': if (isKeeper()) ui.dialog = { type:'trade-rules' }; break;
    case 'offer-remove': {
      const offer = state.offers.find(item => item.id === value);
      if (offer && isSame(offer.person, state.actor)) await commit('Pick-up day removed', { date:offer.date, shift:offer.shift }, previous => ({ ...previous, offers:previous.offers.filter(item => item.id !== value) }));
      break;
    }
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
      sourceVersions = {};
      ui.lastAsk = null;
      ui.askContext = null;
      ui.draftPost = '';
      markBoardSeen(null);
      ui.pending = null;
      ui.dialog = null;
      ui.date = startDate();
      ui.notice = 'Local workspace cleared.';
      break;
    case 'export': {
      if (!isKeeper()) return;
      await commit('Export requested', { kind:'receipt-history' }, previous => previous);
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
  if (!noticeSeen) { ui.dialog = { type:'notice' }; render(); return; }
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
      if (data.whenKind && !/^\d{4}-\d{2}-\d{2}$/.test(data.whenDate || '')) { form.querySelector('.refusal').textContent = 'Pick the date, or set it back to No date.'; return; }
      const warned = patientCheck(form, [body, ...files.map(file => file.name)].join('\n'));
      if (!warned) return;
      const post = { id:crypto.randomUUID(), ...message, ...(media.length ? { media } : {}), ...(data.learning ? { learning:true } : {}), ...(data.inside ? { inside:true } : {}),
        ...(data.whenKind ? { when:{ kind:data.whenKind, date:data.whenDate } } : {}) };
      const send = form.querySelector('button.primary');
      send.disabled = true;
      send.textContent = 'Posting…';
      try { await boardStore.publish(post, media.map((item, index) => [item.id, files[index]]), { fingerprint:await sha256(body), postHash:await postVersion(post), files:await Promise.all(files.map(file => fileFingerprint(file))) }); }
      catch (error) { throw error.name === 'QuotaExceededError' ? new Error('This browser is out of room for files. Remove an old post with a large file, or post a smaller one.') : error; }
      media.forEach((item, index) => { mediaBlobs.set(item.id, files[index]); mediaUrls.set(item.id, URL.createObjectURL(files[index])); });
      ui.boardFilter = 'all';
      ui.draftPost = '';
      break;
    }
    case 'mark': {
      const mark = (data.mark || '').trim().toLowerCase();
      const check = await verifyReceipts(state.events, mark || 'invalid');
      ui.flash = check.ok ? 'The complete chain checks out and includes the saved checkpoint at receipt ' + check.checkpoint + '. Integrity has been checked against that checkpoint; identity and factual correctness have not.' : 'Checkpoint check failed: ' + check.why + '.';
      break;
    }
    case 'ask': {
      const q = (data.q || '').trim();
      if (!q) return;
      await runAsk(q);
      break;
    }
    case 'teach': {
      if (!isKeeper()) return;
      const waiting = state.unanswered.find(item => item.id === data.id), words = (data.answer || '').trim();
      if (!waiting || !words) return;
      const warned = patientCheck(form, [waiting.text, words, data.source || ''].join('\n'));
      if (!warned) return;
      const source = state.documents.find(doc => doc.id === data.documentId);
      const entry = { id:crypto.randomUUID(), asks:[waiting.text], answer:words, source:(data.source || '').trim(), by:state.actor, at:new Date().toISOString(),
        ...(source ? { documentId:source.id, sourceHash:sourceVersions[source.id] } : {}) };
      await commit('Answer taught', { id:entry.id, question:await sha256(waiting.text.toLowerCase()), answer:await sha256(words), sourceHash:entry.sourceHash || null }, previous => ({ ...previous, answers:[...previous.answers, entry], unanswered:previous.unanswered.filter(item => item.id !== waiting.id) }));
      ui.dialog = { type:'teach' };
      // Say what it will do, not what was hoped: a note never comes before the schedule or a document.
      ui.flash = currentAsk({ q:waiting.text }).taught === entry.id ? 'Saved. Ask now gives this note for that question.' : 'Saved, but Ask will not show it for that question: the schedule or a document answers it first.';
      break;
    }
    case 'reading-try': if (isKeeper() && ui.dialog?.type === 'teach') ui.dialog = { ...ui.dialog, reads:(data.reads || '').trim().slice(0, 200) }; break;
    case 'passage-find': if (isKeeper() && ui.dialog?.type === 'teach') ui.dialog = { ...ui.dialog, words:(data.words || '').trim().slice(0, 120) }; break;
    case 'send-question': {
      const q = (data.question || '').trim().slice(0, 200);
      if (!q || !patientCheck(form, q)) return;
      // Why it was sent, and how Ask took it, go with the words so the keeper can see what to correct.
      const reason = WRONG[ui.dialog?.reason] ? ui.dialog.reason : 'unanswered', taken = currentAsk({ q });
      const entry = state.unanswered.find(item => item.text.toLowerCase() === q.toLowerCase()) || { id:crypto.randomUUID(), text:q, at:new Date().toISOString(), reason, ...(taken.understood ? { understood:taken.understood } : {}) };
      if (!state.unanswered.includes(entry)) await commit('Reviewed question saved', { id:entry.id, fingerprint:await sha256(q.toLowerCase()), textSaved:true, reason, kind:taken.kind }, previous => ({ ...previous, unanswered:[...previous.unanswered, entry].slice(-200) }));
      ui.dialog = data.teach && isKeeper() ? { type:'teach', pick:entry.id } : { type:'ask', q, previousContext:ui.lastAsk?.previousContext, yes:'Reviewed question saved for the record keeper in this browser and backups.' };
      break;
    }
    case 'doc': {
      const file = form.querySelector('#doc-file')?.files[0];
      if (file && file.size > DOC_LIMIT * 2) throw new Error('That file is too large to be the text of one document.');
      const text = ((file ? await file.text() : '') + '\n\n' + (data.text || '')).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
      const title = (data.title || '').trim().replace(/\s+/g, ' ');
      if (!title || text.length < 20) throw new Error('A document needs a title and its words. Choose a text file or paste the text.');
      if (text.length > DOC_LIMIT) throw new Error('That is ' + fileSize(text.length) + ' of text. One document can be up to ' + fileSize(DOC_LIMIT) + '. Add it in parts.');
      if (state.documents.reduce((sum, doc) => sum + doc.text.length, 0) + text.length > DOC_TOTAL) throw new Error('The documents together are at the limit this browser can keep. Remove one first.');
      const doc = { id:crypto.randomUUID(), title, kind:data.kind || 'Other', effective:/^\d{4}-\d{2}-\d{2}$/.test(data.effective || '') ? data.effective : '', added:new Date().toISOString(), by:state.actor, text };
      await commit('Document added', { id:doc.id, title, kind:doc.kind, effective:doc.effective, characters:text.length, sha256:await sha256(text), version:await documentVersion(doc) }, previous => ({ ...previous, documents:[...previous.documents, doc] }));
      ui.dialog = { type:'docs' };
      ui.flash = 'Added ' + title + '. Ask can now search it.';
      break;
    }
    case 'voice': {
      if (voice?.state !== 'review') return;
      const warned = patientCheck(form, (data.caption || '').trim());
      if (!warned) return;
      const recording = voice;
      const item = { id:crypto.randomUUID(), name:'voice-message-' + localToday() + (/mp4/.test(recording.blob.type) ? '.m4a' : '.webm'), type:recording.blob.type, size:recording.blob.size, kind:'audio', seconds:recording.seconds };
      const file = new File([recording.blob], item.name, { type:recording.blob.type });
      const post = { id:crypto.randomUUID(), author:state.actor, body:(data.caption || '').trim(), created:new Date().toISOString(), voice:true, media:[item], ...(data.inside ? { inside:true } : {}) };
      await boardStore.publish(post, [[item.id, file]], { fingerprint:await sha256(post.body), postHash:await postVersion(post), files:[await fileFingerprint(file)] });
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
    case 'offer': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || data.date < localToday() || !SHIFTS[data.shift]) return;
      if (state.offers.some(offer => isSame(offer.person, state.actor) && offer.date === data.date && offer.shift === data.shift)) break;
      const offer = { id:crypto.randomUUID(), person:state.actor, date:data.date, shift:data.shift, at:new Date().toISOString() };
      await commit('Pick-up day added', { date:offer.date, shift:offer.shift }, previous => ({ ...previous, offers:[...previous.offers, offer].slice(-400) }));
      break;
    }
    case 'trade-rules': {
      if (!isKeeper()) return;
      const limit = Number(data.limit), rest = Number(data.rest), row = Math.round(Number(data.row));
      if (!(limit >= 1 && limit <= 168) || !(rest >= 0 && rest <= 48) || !(row >= 0 && row <= 14)) throw new Error('Check the numbers and try again.');
      const rules = { weekStartsOn:Math.min(6, Math.max(0, Math.round(Number(data.weekStartsOn)) || 0)), overtimeLimitMinutes:Math.round(limit * 60), overLimit:data.overLimit === 'warn' ? 'warn' : 'block',
        minimumRestMinutes:Math.round(rest * 60), maxInARow:row, by:state.actor, at:new Date().toISOString() };
      await commit('Trade rules changed', rules, previous => ({ ...previous, tradeRules:rules }));
      ui.dialog = null;
      ui.notice = 'Trade rules saved. Every check uses them from now on.';
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
      if (!patientCheck(form, body)) return;
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
      if (!patientCheck(form, body)) return;
      const id = ui.dialog.id;
      await commit('Thread reply', { id }, previous => ({
        ...previous, requests:previous.requests.map(item => item.id === id ? { ...item, messages:[...item.messages, message] } : item)
      }));
      break;
    }
    case 'protocol-search': ui.protocols = { ...ui.protocols, query:(data.q || '').trim().slice(0, 120) }; break;
    case 'knowledge-withdraw': {
      keeperOnly();
      if (!patientCheck(form, data.reason || '')) return;
      await protocolStep(withdrawSet(state.protocols, ui.protocols.shelf.slice(10), data.reason, state.actor, new Date().toISOString()), 'Cards withdrawn. They no longer answer.');
      ui.protocols = { ...ui.protocols, withdrawing:false };
      break;
    }
    case 'reference-search': ui.protocols = { ...ui.protocols, refQuery:(data.q || '').trim().slice(0, 120), refSection:data.section || '', refRetired:Boolean(data.retired) }; break;
    case 'protocol-add': {
      keeperOnly();
      const file = form.querySelector('#protocol-file')?.files[0];
      if (!file) throw new Error('Choose the protocol’s PDF.');
      ui.busy = 'Reading ' + file.name + ' on this device…'; render();
      try {
        const result = await addProtocolFile(file, { title:data.title, identifier:data.identifier, authority:data.authority, label:data.label, effective:data.effective, category:data.category, location:data.location });
        const empty = result.revision.extraction.emptyPages || [];
        ui.tab = 'protocols';
        ui.protocols = { ...ui.protocols, family:result.family.id, revision:result.revision.id, pane:'both', cite:null, withdrawing:false, fromAsk:false };
        ui.notice = 'Added revision ' + result.revision.label + ', unchecked. ' + (empty.length ? 'Page' + (empty.length === 1 ? ' ' : 's ') + empty.join(', ') + ' read as empty, which usually means a scan. Type the text in from the original, or withdraw this import.' :
          'Compare the reading with the original before anything else.');
      } finally { ui.busy = null; ui.dialog = null; }
      break;
    }
    case 'protocol-supply': {
      keeperOnly();
      if (!patientCheck(form, data.text || '')) return;
      await protocolStep(await supplyText(state.protocols, shownRevision().id, Number(data.page), data.text, state.actor, new Date().toISOString()), 'Typed text saved for page ' + Number(data.page) + '. It stays marked as typed in by a person.');
      break;
    }
    case 'protocol-withdraw': {
      keeperOnly();
      if (!patientCheck(form, data.reason || '')) return;
      await protocolStep(withdraw(state.protocols, shownRevision().id, data.reason, state.actor, new Date().toISOString()), 'Revision withdrawn. It stays in the history and no longer answers.');
      ui.protocols = { ...ui.protocols, withdrawing:false };
      break;
    }
    default: return;
  }
  render();
}
sourceVersions = await versionsFor(state.documents);
render();
void hydrateMedia();
void loadReferences();
