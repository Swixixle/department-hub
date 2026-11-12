// Simulated DOM check of the Protocols screens and their hand-off to Ask, in a built local release.
// Synthetic test material — NOT FOR CLINICAL USE: the only protocol used is the invented one that ships with the app.
// Requires jsdom; no actual browser. It cannot draw a PDF page, so it starts from a library whose file was already
// read (by the same reader, in Node) and checks everything around the drawing: the steps a record keeper takes,
// their receipts, what Ask shows, where Open lands and what is never stored. scripts/walk-protocols.cjs covers the
// drawing itself in a real browser.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
(async () => {
  const root = process.cwd(), load = file => import(pathToFileURL(path.join(root, file)));
  // The library is built before any browser globals exist, so the reader runs as it does in the Node tests.
  const witnessKit = await load('tests/witness-kit.mjs');
  globalThis.departmentHubCaptureShots = async () => witnessKit.held().shots;
  const kit = await load('tests/protocol-kit.mjs'), protocols = await load('src/protocols.js'), audit = await load('src/audit.js'), model = await load('src/model.js');
  const seeded = (await kit.carryThrough(protocols.emptyLibrary(), 1, { upTo: 'added', who: 'Jordan' })).library;
  const ONE = kit.DIGESTS['rt-train-014-rev1.pdf'], revisionId = seeded.revisions[0].id;
  const RealDate = Date, started = performance.now(), fixedStart = RealDate.parse('2026-11-11T12:00:00Z');
  const now = () => fixedStart + Math.floor(performance.now() - started);
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now()])); } static now() { return now(); } };
  const html = fs.readFileSync('dist/index.html', 'utf8'), metadata = html.match(/<meta name="department-hub-build" content="[a-f0-9]{64}">/)?.[0];
  assert.ok(metadata, 'The real release HTML must carry its build identity');
  const dom = new JSDOM('<!doctype html><html><head>' + metadata + '</head><body><div id="app"></div></body></html>', { url: 'http://127.0.0.1:8769/' });
  const w = dom.window;
  for (const name of ['window', 'document', 'location', 'localStorage', 'FormData', 'MutationObserver']) Object.defineProperty(globalThis, name, { value: name === 'window' ? w : w[name], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  globalThis.CSS = { escape: value => String(value).replace(/["\\]/g, '\\$&') };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  const scrolled = [];
  w.Element.prototype.scrollIntoView = function () { scrolled.push(this.id || this.className); };
  const people = ['Jordan', 'Avery', 'Morgan'];
  const stored = { mode: 'local', actor: 'Jordan', custodians: ['jordan'], assignments: model.mergeAssignments([{ date: '2026-11-12', shift: 'D', person: 'Jordan', sources: [] }, { date: '2026-11-12', shift: 'D', person: 'Avery', sources: [] }, { date: '2026-11-13', shift: 'N', person: 'Morgan', sources: [] }]),
    directory: Object.fromEntries(people.map(person => [model.normalizeName(person), { person, status: 'Staff', skills: ['D', 'N'] }])), people: [], peopleSource: 'import', manualLinks: {}, releases: [], requests: [], history: [], images: [], events: [],
    policy: model.POLICY, revision: 'protocol-ui-check', importedAt: '2026-11-08T09:00:00Z', holidayRules: { off: [], extra: [] }, posts: [],
    documents: [{ id: 'thin', title: 'Thin liquids', kind: 'Protocol', effective: '2026-01-01', added: '2026-01-01T00:00:00Z', by: 'Jordan', text: 'Thin liquids\n\nA swallow screen is recorded before thin liquids are offered in the training kitchen. Invented text for a test.' }],
    protocols: seeded };
  const key = 'department-hub-v1-local', read = () => JSON.parse(localStorage.getItem(key));
  const earlier = { id: 'before-protocols', time: '2026-11-10T12:00:00Z', type: 'Document added', previousHash: null, actor: 'Jordan', details: { id: 'thin' } };
  stored.events.push({ ...earlier, hash: await audit.sha256(JSON.stringify(earlier)) });
  localStorage.setItem(key, JSON.stringify(stored));
  localStorage.setItem(key + '-seen', JSON.stringify('2000-01-01T00:00:00Z'));
  const fetches = [];
  globalThis.fetch = async input => { const url = String(input); if (url.endsWith('/fixtures/manifest.json')) return new Response(fs.readFileSync('public/fixtures/manifest.json'));
    fetches.push(url); const name = url.match(/\/fixtures\/protocols\/(rt-train-014-rev[12]\.mapping\.json)$/)?.[1];
    assert.ok(name, 'Unexpected request: ' + url); return new Response(fs.readFileSync(path.join('public/fixtures/protocols', name))); };
  await import(pathToFileURL(path.join(root, 'dist/assets', fs.readdirSync('dist/assets').find(name => /^index-.*\.js$/.test(name)))));
  const settle = () => new Promise(resolve => setTimeout(resolve, 70));
  const waitFor = async (ready, label) => { for (let i = 0; i < 150; i++) { if (ready()) { await settle(); return; } await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail('Timed out: ' + label); };
  const find = (action, value) => [...document.querySelectorAll('[data-action]')].find(el => el.dataset.action === action && (value === undefined || el.dataset.value === value));
  const READING = new Set(['tab', 'protocol-home', 'protocol-open', 'protocol-revision', 'protocol-pane', 'protocol-cite', 'protocol-mark', 'protocol-ask', 'reference-shelf', 'knowledge-open', 'ask-go', 'ask-open', 'ask-back', 'ask-next', 'close', 'protocol-withdraw', 'protocol-withdraw-cancel']);
  const click = async (action, value) => { const before = read().events, el = find(action, value); assert.ok(el, 'Missing action ' + action + (value ? ' ' + value : '')); el.click(); await settle();
    if (READING.has(action)) assert.deepEqual(read().events, before, 'Reading must not add a receipt: ' + action); };
  const submit = async (selector, values) => { const form = document.querySelector(selector); assert.ok(form, 'Missing form ' + selector); for (const [name, value] of Object.entries(values)) form.querySelector('[name=' + name + ']').value = value;
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle(); };
  const ask = async question => { if (!document.querySelector('form[data-form="ask"]')) await click('ask-open'); const form = document.querySelector('form[data-form="ask"]'), before = read().events;
    form.querySelector('[name=q]').value = question; form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !form.isConnected && document.querySelector('.ask-answer'), 'question rendered');
    assert.deepEqual(read().events, before, 'Asking must not write a receipt'); return document.querySelector('.ask-answer').textContent; };
  const actor = async name => { const el = document.querySelector('#actor'); el.value = name; el.dispatchEvent(new w.Event('change', { bubbles: true })); await settle(); };
  const content = () => document.querySelector('.content').textContent, types = () => read().events.map(event => event.type);
  const ADULT = 'What rate do I start an adult Blue Trainer drill at, with a written order on file?';
  await settle();
  if (document.querySelector('dialog')?.dataset.dialog === 'notice') await click('notice-ok');
  const receiptsAtStart = read().events.length;

  // A visible, labelled destination from every main screen.
  for (const tab of ['schedule', 'board', 'requests', 'fairness', 'people']) { await click('tab', tab); assert.equal(document.querySelector('.app-top .protocols-trigger').textContent, 'Protocols', tab); }
  assert.equal(document.querySelectorAll('nav .nav-item').length, 5, 'the five tabs are unchanged');
  await click('tab', 'protocols');
  assert.equal(document.querySelector('.protocols-trigger').getAttribute('aria-current'), 'page');
  assert.match(content(), /Blue Trainer Bellows Drill[\s\S]*Revision 1 · Added · reading not checked · effective 2026-06-01/);
  assert.match(content(), /its review here is not finished \(added · reading not checked\)/);
  // The pasted document from before stays what it was.
  assert.match(content(), /Pasted documents[\s\S]*Thin liquids\s*Legacy document · Protocol · effective 2026-01-01/);
  assert.equal(read().protocols.revisions.length, 1);
  assert.equal(read().documents.length, 1);

  // Nothing answers before review, and nothing of the protocol is quoted.
  let reply = await ask(ADULT);
  assert.match(reply, /No reviewed answer yet for the revision now in effect/);
  assert.ok(!/mk\/min|manikin/.test(reply));
  reply = await ask('swallow screen before thin liquids');
  assert.match(reply, /Legacy document, not a reviewed protocol · Thin liquids/);
  assert.match(reply, /A pasted document is searched by its words; it is not a reviewed protocol\./);
  assert.ok(find('ask-yes'), 'a legacy document answer keeps its own feedback');
  await click('close');

  // The record keeper's steps, each its own press and its own receipt.
  await click('protocol-open');
  assert.match(content(), /Fingerprint \(SHA-256\)d09ae851f3b242a33c69c0e6db5e2eb2620ec2ea2cfb1b254cefa98c16a67ed4/);
  assert.match(content(), /The original file is not on this device, so it cannot be shown\./, 'with no stored file the screen says so instead of showing a blank page');
  assert.equal(document.querySelectorAll('.reading-pane .reading-page').length, 3);
  assert.equal(document.querySelectorAll('.passage.figure').length, 11);
  assert.equal(find('protocol-reviewed'), undefined); assert.equal(find('protocol-activate'), undefined);
  // A diagram label can be unmarked and marked again before the reading is confirmed, without a receipt.
  await click('protocol-figure', 'p3.b17'); assert.equal(document.querySelectorAll('.passage.figure').length, 10);
  await click('protocol-figure', 'p3.b17'); assert.equal(document.querySelectorAll('.passage.figure').length, 11);
  assert.equal(read().events.length, receiptsAtStart);
  await click('protocol-check');
  assert.equal(types().at(-1), 'Protocol reading confirmed');
  assert.equal(find('protocol-figure'), undefined, 'what counts as diagram text is fixed once the reading is confirmed');
  await click('protocol-pane', 'answers');
  assert.match(content(), /No answers are mapped to this revision/);
  await click('protocol-sample-mapping');
  assert.equal(types().at(-1), 'Protocol answers mapped');
  assert.equal(document.querySelectorAll('[data-bundle]').length, 6);
  assert.equal([...document.querySelectorAll('[data-bundle] .badge')].filter(badge => badge.textContent === 'Not reviewed').length, 6);
  reply = await ask(ADULT);
  assert.match(reply, /No reviewed answer yet/); assert.ok(!/mk\/min/.test(reply), 'a mapped but unreviewed answer was shown');
  await click('close');
  // With answers waiting for review, someone who is not a record keeper is offered no way to review them, and a forged press is refused.
  await actor('Avery'); await click('tab', 'protocols'); await click('protocol-pane', 'answers');
  assert.equal(document.querySelectorAll('[data-bundle]').length, 6);
  for (const action of ['protocol-review', 'protocol-reviewed', 'protocol-sample-mapping']) assert.equal(find(action), undefined, action + ' is offered to a non-keeper');
  const beforeReview = localStorage.getItem(key), forgedReview = document.createElement('button'); forgedReview.dataset.action = 'protocol-review'; forgedReview.dataset.value = 'start-adult'; document.querySelector('#app').append(forgedReview); forgedReview.click(); await settle();
  assert.match(document.querySelector('.content > .notice').textContent, /Only a record keeper can change the protocols held here\./);
  assert.equal(localStorage.getItem(key), beforeReview);
  await actor('Jordan'); await click('tab', 'protocols'); await click('protocol-pane', 'answers');
  for (let index = 0; index < 6; index++) { await click('protocol-review'); assert.equal(types().at(-1), 'Protocol answer reviewed'); }
  assert.match(document.querySelector('[data-bundle="start-adult"]').textContent, /Reviewed by Jordan on 2026-11-11\. Recorded for the profile selected on this device\. This prototype does not verify who that is, and a recorded review is not clinical sign-off\./);
  assert.equal(find('protocol-review'), undefined);
  await click('protocol-reviewed'); assert.equal(types().at(-1), 'Protocol answers reviewed');
  await click('protocol-activate'); assert.equal(types().at(-1), 'Protocol revision made active');
  assert.match(content(), /Revision 1 · Active/);
  assert.deepEqual(read().events.at(-1).details, { identifier: 'RT-TRAIN-014', revision: '1', sha256: ONE, effective: '2026-06-01', inForce: 'from now', replaces: [], note: 'Earlier revisions stay in the history. Their mapped answers do not carry over.' });

  // Ask returns the whole rule; nothing a reader presses can change it.
  reply = await ask(ADULT);
  assert.match(reply, /Understood as: the protocol RT-TRAIN-014, Blue Trainer Bellows Drill: starting the drill\./);
  assert.match(reply, /Start an adult drill at 12 mk\/min\./);
  assert.equal(document.querySelectorAll('.ask-answer .ask-item').length, 7);
  assert.equal(find('ask-yes'), undefined); assert.equal(find('ask-no'), undefined);
  const beforeForged = localStorage.getItem(key);
  for (const action of ['ask-yes', 'ask-no']) { const forged = document.createElement('button'); forged.dataset.action = action; document.querySelector('.ask-answer').append(forged); forged.click(); await settle(); }
  assert.equal(localStorage.getItem(key), beforeForged, 'a forged Yes or No changes nothing: no receipt, no learned wording');
  // Open lands on the cited passage of the cited revision.
  const exception = [...document.querySelectorAll('.ask-answer .ask-item')].find(item => /Do not start the drill if the amber seal lamp/.test(item.textContent)).querySelector('[data-action="ask-go"]');
  assert.equal(exception.dataset.value, 'protocol|' + revisionId + '|p3.b3');
  scrolled.length = 0; exception.click(); await settle();
  const mark = document.querySelector('#cite-mark');
  assert.ok(mark, 'the cited passage is outlined');
  assert.equal(mark.closest('.page-frame').dataset.pageCanvas, ONE + '|3');
  assert.equal(mark.getAttribute('style'), 'left:11.16%;top:14.52%;width:76.62%;height:3.93%', 'the outline is placed from the passage\'s own coordinates');
  assert.equal(document.querySelector('.reading-pane .passage.cited').dataset.anchor, 'p3.b3');
  assert.ok(scrolled.includes('cite-mark'), 'the screen moves to the outline');
  await click('ask-back');
  assert.match(document.querySelector('.ask-answer').textContent, /Start an adult drill at 12 mk\/min\./);
  // A table row is outlined as a row, and the reading marks that row alone.
  const row = [...document.querySelectorAll('.ask-answer .ask-item')].find(item => /^Age band: Adult/.test(item.textContent)).querySelector('[data-action="ask-go"]');
  row.click(); await settle();
  assert.equal(document.querySelector('#cite-mark').closest('.page-frame').dataset.pageCanvas, ONE + '|2');
  assert.deepEqual([...document.querySelectorAll('.reading-pane .cited')].map(node => node.dataset.anchor), ['p2.b3.r1']);
  // A missing fact is asked for; "Not known" shows every possibility; none of it is stored.
  reply = await ask('What rate do I start the Blue Trainer drill at with an order on file?');
  assert.match(reply, /Is the manikin adult or pediatric\?/);
  assert.deepEqual([...document.querySelectorAll('.ask-answer .chip')].map(chip => chip.textContent), ['Adult (18 years and over)', 'Pediatric (under 18 years)', 'Not known']);
  await click('ask-next', '2');
  reply = document.querySelector('.ask-answer').textContent;
  assert.match(reply, /This depends on the age band, which is not known/);
  assert.match(reply, /If Adult \(18 years and over\): Start an adult drill at 12 mk\/min\.[\s\S]*If Pediatric \(under 18 years\): Start a pediatric drill at 6 mk\/min/);
  await click('close');

  // Search, bookmark and the per-protocol Ask entry: all reading, none recorded.
  await click('tab', 'protocols'); await click('protocol-home');
  await submit('form[data-form="protocol-search"]', { q: 'amber seal lamp serviced' });
  assert.match(document.querySelector('.protocol-results').textContent, /Do not start the drill if the amber seal lamp[\s\S]*RT-TRAIN-014 rev 1 · Active · page 3/);
  await click('protocol-mark'); assert.equal(find('protocol-mark').getAttribute('aria-pressed'), 'true');
  await click('protocol-open');
  await click('protocol-ask', 'Stopping the drill and who to call');
  assert.match(document.querySelector('.ask-answer').textContent, /Stop at once if the red lamp lights or the gauge reads above 30 marks\./);
  await click('close');

  // Someone who is not a record keeper reads and asks, and cannot change anything, even with a forged press.
  await actor('Avery');
  await click('tab', 'protocols');
  for (const action of ['protocol-add', 'protocol-sample', 'protocol-check', 'protocol-review', 'protocol-activate', 'protocol-withdraw']) assert.equal(find(action), undefined, action + ' is offered to a non-keeper');
  assert.equal(document.querySelector('#protocol-mapping-file'), null);
  const beforeDenied = read().events;
  for (const action of ['protocol-activate', 'protocol-check', 'protocol-add', 'protocol-sample']) { const forged = document.createElement('button'); forged.dataset.action = action; document.querySelector('#app').append(forged); forged.click(); await settle();
    assert.match(document.querySelector('.content > .notice').textContent, /Only a record keeper can change the protocols held here\./, action); }
  assert.deepEqual(read().events, beforeDenied);
  assert.match(await ask(ADULT), /Start an adult drill at 12 mk\/min\./);
  await click('close');
  await actor('Jordan');

  // Reference knowledge: cards in the source's own words, added only when every line is found on the page's
  // screenshots. jsdom has no text reader, so the readings recorded from the app's reader in a real browser stand in
  // for it (the walk runs the real reader). A non-keeper cannot add them; nobody is asked to vouch for a card.
  await click('tab', 'protocols'); await click('protocol-home');
  assert.match(content(), /Reference knowledge[\s\S]*No reference cards are held\./);
  await actor('Avery'); await click('tab', 'protocols');
  assert.equal(find('knowledge-add'), undefined, 'a non-keeper is not offered the cards');
  await actor('Jordan'); await click('tab', 'protocols');
  await click('knowledge-add'); await waitFor(() => document.querySelector('[data-card="paco2"]'), 'cards added');
  assert.equal(types().at(-1), 'Reference cards added');
  assert.match(read().events.at(-1).details.found, /^\d+ of 1100 words, every number$/);
  assert.equal(read().events.at(-1).details.sha256, 'cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7', 'the page the built app held is the captured page');
  assert.equal(find('knowledge-check'), undefined, 'nobody is asked to vouch for a card');
  assert.match(content(), /12 of 12 cards answering[\s\S]*Reference knowledge\. It is not your hospital’s protocol and not an order for any patient\./);
  assert.equal(document.querySelector('.knowledge-source .digest').textContent, 'cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7');
  assert.ok([...document.querySelectorAll('[data-card="paco2"] .source-quote')].some(quote => quote.textContent.includes('\t35–45 mmHg\tLess than 25 mmHg.')), 'the card shows the captured row');
  const pictured = document.querySelector('[data-card="paco2"] .capture-picture image').getAttribute('href');
  assert.ok(fs.existsSync(path.join('dist/assets', path.basename(pictured))), 'the screenshot a card shows ships with the app: ' + pictured);
  reply = await ask('whats the normal range for PaCO2');
  assert.match(reply, /Understood as: reference knowledge: paco2: normal and critical values\.[\s\S]*From the source: PaCO2: normal and critical values[\s\S]*Reference knowledge\. It is not your hospital’s protocol and not an order for any patient\./);
  const cited = document.querySelector('.ask-answer .ask-item a.link-button');
  assert.deepEqual([cited.href, cited.target, cited.rel], ['https://wtcs.pressbooks.pub/nursingfundamentals/chapter/15-5-acid-base-balance/', '_blank', 'noopener noreferrer']);
  assert.ok([...document.querySelectorAll('.ask-answer .source-quote')].some(quote => quote.textContent.includes('\t35–45 mmHg\tLess than 25 mmHg.')), 'the answer shows the source’s own words');
  assert.ok(document.querySelectorAll('.ask-answer .capture-picture rect').length >= 3, 'the answer outlines the row on its screenshot');
  assert.match(reply, /exact text captured with Blinders on 2026-11-12, SHA-256 cf48652c…cde3e7 · found on the page’s screenshots: \d+ of \d+ words, every number/);
  assert.equal(find('ask-yes'), undefined, 'a reference card offers no Yes or No');
  reply = await ask('What is a normal SpO2?');
  assert.ok(!/reference knowledge/i.test(reply), 'the arterial-saturation card answered a pulse-oximetry question');
  await click('close');

  // Professional references: a shelf of links out. Nothing of any guideline is held, shown or answered from.
  await click('tab', 'protocols'); await click('protocol-home');
  await waitFor(() => find('reference-shelf'), 'the reference list loaded');
  assert.match(content(), /Professional references[\s\S]*They are not your hospital’s protocols\./);
  await click('reference-shelf');
  assert.equal(document.querySelectorAll('article.reference').length, 79, 'retired documents are left out to begin with');
  assert.match(document.querySelector('.reference-terms').textContent, /^These are not your hospital’s protocols\. Each entry is a title, a year and a link to the publisher’s own copy\. Department Hub holds none of the text, does not summarise it and answers nothing from it\./);
  const out = [...document.querySelectorAll('article.reference a.link-button')];
  assert.ok(out.length === 79 && out.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer' && /^https?:\/\/[^/]+\//.test(link.href)), 'every entry leaves the app by an ordinary safe link');
  await submit('form[data-form="reference-search"]', { q: 'suction' });
  assert.deepEqual([...document.querySelectorAll('article.reference:not(.grouped) h3')].map(node => node.textContent), ['AARC Clinical Practice Guidelines: Artificial Airway Suctioning (2022)',
    'Endotracheal Suctioning of Mechanically Ventilated Patients With Artificial Airways (2010)', 'Nasotracheal Suctioning (2004)']);
  assert.match(document.querySelector('.group-divider').textContent, /^Not matched by title\. Filed under a related subject:$/);
  assert.ok(document.querySelector('.group-divider').compareDocumentPosition(document.querySelector('article.reference.grouped')) & 4, 'entries matched only by subject group come after the divider');
  const retiredBox = document.querySelector('#reference-retired'); retiredBox.checked = true; retiredBox.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  assert.deepEqual([...document.querySelectorAll('article.reference.retired:not(.grouped) h3')].map(node => node.textContent), ['Suctioning of the patient in the home (1999)']);
  assert.match(document.querySelector('article.reference.retired:not(.grouped)').textContent, /^RETIRED · AARC-Retired Guidelines[\s\S]*Retired by AARC\. Kept as history, not as a reference for practice\./);
  reply = await ask('Is there an AARC guideline on suctioning?');
  assert.match(reply, /Understood as: a search of the professional reference list\.[\s\S]*Professional references on this\. They are not your hospital’s protocol\.[\s\S]*Department Hub holds none of their text and does not summarise them\./);
  const pointers = [...document.querySelectorAll('.ask-answer .ask-item a.link-button')];
  assert.deepEqual(pointers.map(link => [link.textContent, link.target, link.rel, link.href.startsWith('https://www.aarc.org/wp-content/uploads/')]), Array(3).fill(['Open official source ↗', '_blank', 'noopener noreferrer', true]));
  assert.ok(!/\b\d+\s?(?:mm ?hg|cm ?h2o|l\/min)\b/i.test(reply), 'a setting appeared in a reference answer');
  await click('ask-go', 'refs|suctioning');
  assert.equal(document.querySelector('form[data-form="reference-search"] [name=q]').value, 'suctioning');
  assert.equal(document.querySelectorAll('article.reference:not(.grouped)').length, 3);
  reply = await ask('When do I work next?');
  assert.ok(!/Professional references/.test(reply), 'a schedule question is still a schedule question');
  await click('close');
  await click('protocol-home');

  // Withdrawal needs a reason and leaves a receipt; the protocol then has no answer and says why.
  await click('tab', 'protocols'); if (find('protocol-open')) await click('protocol-open');
  await click('protocol-withdraw');
  await submit('form[data-form="protocol-withdraw"]', { reason: 'Check finished' });
  assert.deepEqual([types().at(-1), read().events.at(-1).details.reason, read().events.at(-1).details.was], ['Protocol revision withdrawn', 'Check finished', 'active']);
  assert.match(content(), /Revision 1 · Withdrawn/);
  reply = await ask(ADULT);
  assert.match(reply, /No revision is held[\s\S]*Every revision held of RT-TRAIN-014 has been withdrawn\./);
  assert.ok(!/mk\/min/.test(reply));
  await click('close');

  // What was kept, and what was not.
  // The captured textbook page is held on purpose, and it contains ordinary words such as "suction". It is set aside
  // here so that the check is of what was typed, not of what the page says.
  const unheld = value => { try { const parsed = JSON.parse(value); for (const set of parsed?.protocols?.knowledge || []) if (set.held) set.held = 'set aside'; return JSON.stringify(parsed); } catch { return value; } };
  const kept = JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(name => [name, unheld(localStorage.getItem(name))])));
  assert.ok(JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(name => [name, localStorage.getItem(name)]))).includes('WakeMed Pathology Laboratories'), 'the captured page is held in storage');
  for (const typed of ['Blue Trainer drill at', 'amber seal lamp serviced', 'swallow screen before', 'suction', 'normal range for PaCO2', 'normal SpO2']) assert.ok(!kept.includes(typed), 'storage holds what was typed: ' + typed);
  assert.deepEqual(types().slice(receiptsAtStart), ['Protocol reading confirmed', 'Protocol answers mapped', ...Array(6).fill('Protocol answer reviewed'), 'Protocol answers reviewed', 'Protocol revision made active',
    'Reference cards added', 'Protocol revision withdrawn']);
  assert.deepEqual(read().events[0], stored.events[0], 'the receipt from before protocols is untouched');
  assert.equal((await audit.verifyReceipts(read().events)).ok, true);
  assert.equal(read().documents[0].text, stored.documents[0].text);
  assert.ok(fetches.length === 1 && /rt-train-014-rev1\.mapping\.json$/.test(fetches[0]), 'the only request was for the mapping that ships with the app');
  console.log('PASS: Protocols is on every screen; reading confirmed, answers mapped, each reviewed, revision made active and withdrawn, each with a receipt; Ask shows the whole rule and Open lands on the cited passage; reading, searching, asking and branch choices store nothing; a non-keeper cannot change the library; professional references are links out with nothing of their text held; the earlier receipt and pasted document are unchanged.');
  dom.window.close();
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
