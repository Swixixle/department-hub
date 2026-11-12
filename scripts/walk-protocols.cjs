#!/usr/bin/env node
// Walks the Protocols feature in a real browser against a built copy of the app (dist by default).
// Synthetic test material — NOT FOR CLINICAL USE: the only protocol used is the invented one that ships with the app.
//
// Optional local check. It needs Playwright with Chromium on the machine and is not part of `npm test` or CI,
// which have no browser. Run `npm run build` first, then `node scripts/walk-protocols.cjs [folder] [--shots dir]`.
// It covers what the Node tests cannot: the PDF reader running in a browser with its worker, pages drawn to a
// canvas, the outline over a cited passage, phone layout, storage in the browser and an upgrade from a saved workspace.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const folder = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist');
const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const ADULT = 'What rate do I start an adult Blue Trainer drill at, with a written order on file?';
const ONE = 'd09ae851f3b242a33c69c0e6db5e2eb2620ec2ea2cfb1b254cefa98c16a67ed4', TWO = '7cce7d9d091e1a2a0e083e2af1a7d8006fbefbb2a571050a42392a0f57bdfd09';
const results = [];
const step = async (name, work) => { try { await work(); results.push([true, name]); console.log('PASS  ' + name); } catch (error) { results.push([false, name]); console.log('FAIL  ' + name + '\n        ' + String(error.message).split('\n').slice(0, 4).join('\n        ')); } };

(async () => {
  const server = http.createServer((request, response) => {
    const file = path.join(folder, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(folder) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push('page error: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text()); });
  const demo = /demo/.test(folder);
  const stored = () => page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))));
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => /^department-hub-v1-(local|demo)$/.test(key)))));
  const press = async (action, value) => { await page.locator('[data-action="' + action + '"]' + (value === undefined ? '' : '[data-value="' + value + '"]')).first().click(); };
  const text = selector => page.locator(selector).first().innerText();
  const settle = () => page.waitForTimeout(120);
  const askFor = async question => { if (!(await page.locator('dialog[data-dialog="ask"]').count())) await press('ask-open'); await page.fill('dialog input[name="q"]', question); await page.click('dialog form[data-form="ask"] button.primary'); await page.waitForSelector('.ask-answer'); await settle(); return text('.ask-answer'); };
  const closeDialog = async () => { if (await page.locator('dialog [data-action="close"]').count()) await press('close'); };
  // How much of a drawn page is ink. A blank or missing canvas fails this.
  const inked = digest => page.evaluate(wanted => [...document.querySelectorAll('[data-page-canvas^="' + wanted + '"] canvas')].map(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0;
    for (let at = 0; at < data.length; at += 16) if (data[at + 3] > 0 && data[at] + data[at + 1] + data[at + 2] < 380) dark++;
    return dark; }), digest);
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); } };
  const carry = async label => {     // the steps a record keeper takes for one revision, each by its own press
    await press('protocol-check'); await settle();
    await press('protocol-pane', 'answers'); await press('protocol-sample-mapping'); await page.waitForSelector('[data-bundle]');
    assert.equal(await page.locator('[data-bundle]').count(), 6);
    assert.equal(await page.locator('[data-bundle] .badge:has-text("Not reviewed")').count(), 6, 'a mapping arrives unreviewed');
    for (let index = 0; index < 6; index++) { await page.locator('[data-action="protocol-review"]').first().click(); await settle(); }
    assert.equal(await page.locator('[data-bundle] .badge:has-text("Reviewed")').count(), 6);
    await press('protocol-reviewed'); await settle(); await press('protocol-activate'); await settle();
    assert.match(await text('.intro .badge.standing'), new RegExp('Revision ' + label + ' · Active'));
  };

  await page.goto(origin);
  await page.waitForSelector('#app main');
  if (await page.locator('[data-action="notice-ok"]').count()) await press('notice-ok');

  await step('Protocols is a labelled button on every main screen, on a phone too, and the five tabs keep their size', async () => {
    for (const tab of ['schedule', 'board', 'requests', 'fairness', 'people']) { await press('tab', tab); assert.equal(await page.locator('.protocols-trigger').innerText(), 'Protocols', tab); }
    await page.setViewportSize({ width: 390, height: 844 });
    const before = await page.evaluate(() => [...document.querySelectorAll('nav .nav-item')].map(item => { const box = item.getBoundingClientRect(); return [Math.round(box.width), Math.round(box.height)]; }));
    assert.equal(before.length, 5, 'the bottom bar still has five tabs');
    assert.ok(before.every(([width, height]) => width >= 44 && height >= 44), 'tab targets: ' + JSON.stringify(before));
    for (const tab of ['schedule', 'board', 'requests', 'fairness', 'people']) {
      await press('tab', tab);
      const box = await page.locator('.protocols-trigger').boundingBox(), view = page.viewportSize();
      assert.ok(box && box.height >= 44 && box.width >= 44 && box.x >= 0 && box.x + box.width <= view.width, tab + ': ' + JSON.stringify(box));
      const ask = await page.locator('.ask-trigger').boundingBox();
      assert.ok(ask.height >= 44 && ask.x + ask.width <= view.width, 'Ask is still whole on ' + tab);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'nothing pushes the phone screen sideways');
    await shot('01-phone-top-bar');
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  await step('the invented protocol is added unchecked, its pages are drawn and its reading is shown beside them', async () => {
    await press('tab', 'protocols');
    assert.match(await text('.content'), /No protocols are held yet/);
    await press('protocol-sample');
    await page.waitForSelector('.protocol-read.both .page-frame canvas', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.page-frame canvas').length === 3, null, { timeout: 20000 });
    assert.match(await text('.notice'), /Added revision 1 of the invented protocol, unchecked\. It answers nothing until/);
    assert.match(await text('.intro .badge.standing'), /Revision 1 · Added · reading not checked/);
    const ink = await inked(ONE);
    assert.equal(ink.length, 3); assert.ok(ink.every(dark => dark > 400), 'each page of the original is drawn: ' + ink);
    assert.equal(await page.locator('.reading-pane .reading-page').count(), 3);
    assert.equal(await page.locator('.reading-pane .passage.running:has-text("Synthetic test material — NOT FOR CLINICAL USE")').count(), 6, 'the label is on every page, top and bottom');
    assert.deepEqual(await page.locator('.reading-table thead th[scope=col]').allInnerTexts(), ['Age band', 'Starting rate', 'Highest rate', 'Recheck after']);
    assert.deepEqual(await page.locator('.reading-table tbody tr').first().locator('th,td').allInnerTexts().then(cells => cells.slice(0, 4)), ['Adult (18 years and over)', '12 mk/min', '20 mk/min', '10 minutes']);
    assert.equal(await page.locator('.passage.figure').count(), 11, 'diagram labels are marked');
    assert.match(await text('.record'), new RegExp('Fingerprint \\(SHA-256\\)\\s*' + ONE));
    assert.match(await text('.record'), /Effective\s*2026-06-01 \(the issuer’s date\)[\s\S]*Reading confirmed\s*not yet/);
    await shot('02-added-side-by-side');
  });

  await step('before review Ask gives no rule, and quotes nothing from the protocol', async () => {
    const reply = await askFor(ADULT);
    assert.match(reply, /No reviewed answer yet for the revision now in effect/);
    assert.ok(!/mk\/min|manikin/.test(reply), 'protocol text was quoted with no reviewed answer behind it');
    await closeDialog();
  });

  await step('a record keeper confirms the reading, reviews each answer by its own press, and makes revision 1 active', async () => {
    await carry('1');
    const types = (await state()).events.map(event => event.type);
    for (const [type, count] of [['Protocol revision added', 1], ['Protocol reading confirmed', 1], ['Protocol answers mapped', 1], ['Protocol answer reviewed', 6], ['Protocol answers reviewed', 1], ['Protocol revision made active', 1]])
      assert.equal(types.filter(entry => entry === type).length, count, type);
    await shot('03-revision-1-active');
  });

  await step('Ask returns the whole rule, and Open outlines the cited passage on the right page of the original', async () => {
    const reply = await askFor(ADULT);
    assert.match(reply, /Start an adult drill at 12 mk\/min\./);
    assert.match(reply, /For: Adult \(18 years and over\) · A written order is on file/);
    assert.equal(await page.locator('.ask-answer .ask-item').count(), 7);
    for (const heading of ['The rule', 'Order required first', 'Who may do this', 'Do not go ahead if', 'Stop if', 'Who to call']) assert.ok(reply.includes(heading + ' · RT-TRAIN-014 rev 1 · page'), heading);
    assert.match(reply, /file d09ae851f3b2, as held on this device\. Department Hub cannot tell whether whoever issued it has published a newer one/);
    assert.equal(await page.locator('.ask-answer [data-action="ask-yes"], .ask-answer [data-action="ask-no"]').count(), 0, 'a protocol answer offers no Yes or No');
    assert.match(reply, /“Yes”, repeated questions and search cannot change it/);
    await shot('04-ask-whole-rule');
    await page.locator('.ask-answer .ask-item:has-text("Do not start the drill if the amber seal lamp") [data-action="ask-go"]').click();
    await page.waitForSelector('#cite-mark'); await page.waitForFunction(() => document.querySelectorAll('.page-frame canvas').length === 3);
    const where = await page.evaluate(() => { const mark = document.querySelector('#cite-mark'), frame = mark.closest('.page-frame'), a = mark.getBoundingClientRect(), b = frame.getBoundingClientRect();
      return { page: frame.dataset.pageCanvas, left: (a.left - b.left) / b.width, top: (a.top - b.top) / b.height, width: a.width / b.width, height: a.height / b.height, canvas: Boolean(frame.querySelector('canvas')), onScreen: a.top >= 0 && a.bottom <= window.innerHeight }; });
    assert.equal(where.page, ONE + '|3', 'the exception is on page 3 of revision 1');
    assert.ok(where.canvas && where.onScreen, 'the outlined passage is drawn and scrolled into view');
    // The passage starts at the left margin (72 of 612 points) about 117 points down an 792-point page, and spans most of the line.
    assert.ok(Math.abs(where.left - 72 / 612) < 0.02 && Math.abs(where.top - 117.4 / 792) < 0.02 && where.width > 0.7 && where.height > 0.02 && where.height < 0.06, JSON.stringify(where));
    assert.equal(await page.locator('.reading-pane .passage.cited').getAttribute('data-anchor'), 'p3.b3', 'the same passage is marked in the reading');
    assert.ok(await page.locator('.reading-pane .passage.cited').evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }), 'and the reading is scrolled to it');
    await shot('05-open-highlights-original');
    await press('ask-back'); await page.waitForSelector('.ask-answer');
    assert.match(await text('.ask-answer'), /Start an adult drill at 12 mk\/min\./, 'Back returns to the answer');
  });

  await step('a missing fact is asked for with "Not known", and not knowing shows every possibility whole', async () => {
    let reply = await askFor('and for a child?');
    assert.match(reply, /Start a pediatric drill at 6 mk\/min, with the small cuff fitted\./);
    reply = await askFor('What rate do I start the Blue Trainer drill at with an order on file?');
    assert.match(reply, /Is the manikin adult or pediatric\?/);
    assert.ok(!/mk\/min/.test(reply));
    assert.deepEqual(await page.locator('.ask-answer .chip').allInnerTexts(), ['Adult (18 years and over)', 'Pediatric (under 18 years)', 'Not known']);
    await page.locator('.ask-answer .chip:has-text("Not known")').click(); await settle();
    reply = await text('.ask-answer');
    assert.match(reply, /This depends on the age band, which is not known/);
    assert.match(reply, /If Adult \(18 years and over\): Start an adult drill at 12 mk\/min\./);
    assert.match(reply, /If Pediatric \(under 18 years\): Start a pediatric drill at 6 mk\/min/);
    assert.equal(await page.locator('.ask-answer .ask-item').count(), 16, 'two possibilities, each with its seven passages and its own summary line');
    await shot('06-ask-not-known');
    reply = await askFor('When do I work next?');
    assert.ok(!/RT-TRAIN-014/.test(reply), 'a schedule question still goes to the schedule');
    await closeDialog();
  });

  await step('revision 2 takes over on being added: nothing answers until it is reviewed, then only it answers', async () => {
    await press('tab', 'protocols'); await press('protocol-home'); await press('protocol-sample');
    await page.waitForFunction(digest => document.querySelectorAll('[data-page-canvas^="' + digest + '"] canvas').length === 3, TWO, { timeout: 20000 });
    assert.match(await text('.intro .badge.standing'), /Revision 2 · Added · reading not checked/);
    assert.match(await text('.content'), /Revision 2 of RT-TRAIN-014 has been in effect since 2026-11-01, and its review here is not finished/);
    let reply = await askFor(ADULT);
    assert.match(reply, /No reviewed answer yet for the revision now in effect/);
    assert.ok(!/mk\/min/.test(reply), 'the superseded revision answered, or an unreviewed one was quoted');
    await page.locator('.ask-answer [data-action="ask-go"]').first().click(); await page.waitForSelector('.page-frame');
    assert.ok((await page.locator('.page-frame').first().getAttribute('data-page-canvas')).startsWith(TWO), 'Open goes to the revision in effect, with its pending state');
    await carry('2');
    reply = await askFor(ADULT);
    assert.match(reply, /Start an adult drill at 14 mk\/min\./);
    assert.ok(!/12 mk\/min|24 hours/.test(reply) && /48 hours/.test(reply) && /call the Charge Educator/.test(reply));
    assert.match(reply, /RT-TRAIN-014 revision 2, effective 2026-11-01, file 7cce7d9d091e/);
    await page.locator('.ask-answer .ask-item:has-text("Age band: Adult") [data-action="ask-go"]').click(); await page.waitForSelector('#cite-mark');
    assert.equal(await page.locator('#cite-mark').evaluate(mark => mark.closest('.page-frame').dataset.pageCanvas), TWO + '|2', 'the table row is outlined on page 2 of revision 2');
    assert.equal(await page.locator('.reading-table tr.cited').getAttribute('data-anchor'), 'p2.b3.r1');
    await shot('07-revision-2-table-row');
  });

  await step('revision 1 stays in the history, readable and citable, and is plainly marked as superseded', async () => {
    const history = await page.locator('.protocol-top .line-list > div').allInnerTexts();
    assert.match(history[0], /Revision 2[\s\S]*effective 2026-11-01 · Active · file 7cce7d9d091e/);
    assert.match(history[1], /Revision 1[\s\S]*effective 2026-06-01 · Superseded · history only · file d09ae851f3b2/);
    const one = (await state()).protocols.revisions.find(revision => revision.digest === ONE);
    await press('protocol-revision', one.id); await settle();
    await press('protocol-cite', one.id + '|p2.b3.r1'); await page.waitForSelector('#cite-mark');
    assert.equal(await page.locator('#cite-mark').evaluate(mark => mark.closest('.page-frame').dataset.pageCanvas), ONE + '|2', 'a citation of revision 1 opens revision 1');
    assert.match(await text('.content'), /You are reading revision 1 \(superseded · history only\)\. The revision in effect is 2\./);
    assert.match(await text('.reading-table tr.cited'), /12 mk\/min/);
    assert.ok((await inked(ONE)).every(dark => dark > 400), 'the superseded original is still drawn');
    await shot('08-history-revision-1');
  });

  await step('search and bookmarks work, and reading, searching and asking leave no trace in storage', async () => {
    await press('protocol-home');
    await page.fill('form[data-form="protocol-search"] input[name="q"]', 'amber seal lamp serviced'); await page.click('form[data-form="protocol-search"] button'); await settle();
    assert.match(await text('.protocol-results'), /serviced within the last 48 hours/);
    assert.ok(!/24 hours/.test(await text('.protocol-results')), 'search reads the revision in effect');
    await press('protocol-mark'); await settle();
    assert.equal(await page.locator('[data-action="protocol-mark"]').first().getAttribute('aria-pressed'), 'true');
    const kept = await stored();
    for (const typed of ['amber seal lamp serviced', 'Blue Trainer drill at', 'and for a child', 'Not known']) assert.ok(!kept.includes(typed), 'storage holds "' + typed + '"');
    const usage = JSON.parse(JSON.parse(kept)['department-hub-usage-v1'] || '{"counts":{}}').counts;
    assert.ok(Object.keys(usage).every(name => /^[a-z][a-z-]*(:[a-z-]+)?$/.test(name)), 'button counts are fixed names only: ' + Object.keys(usage).filter(name => !/^[a-z][a-z-]*(:[a-z-]+)?$/.test(name)));
    const events = (await state()).events;
    assert.ok(events.every((event, index) => event.previousHash === (index ? events[index - 1].hash : null)), 'the receipt chain is unbroken');
    const recorded = ['Protocol revision added', 'Protocol reading confirmed', 'Protocol answers mapped', 'Protocol answer reviewed', 'Protocol answers reviewed', 'Protocol revision made active'];
    assert.deepEqual([...new Set(events.map(event => event.type).filter(type => /protocol/i.test(type)))].sort(), recorded.sort(), 'receipts exist for imports, reviews and replacements, and for nothing else: not reading, searching, bookmarking or asking');
    assert.equal(events.filter(event => event.type === 'Answer relevance feedback').length, 0);
  });

  await step('professional references are a shelf of links out: searchable, retired hidden, nothing of their text held, usable on a phone', async () => {
    await press('tab', 'protocols'); if (await page.locator('[data-action="protocol-home"]').count()) await press('protocol-home');
    await page.waitForSelector('[data-action="reference-shelf"]');
    await press('reference-shelf'); await page.waitForSelector('article.reference');
    assert.equal(await page.locator('article.reference').count(), 79);
    assert.match(await text('.reference-terms'), /These are not your hospital’s protocols\./);
    assert.deepEqual(await page.locator('article.reference a.link-button').first().evaluate(link => [link.target, link.rel, /^https:\/\/www\.aarc\.org\//.test(link.href)]), ['_blank', 'noopener noreferrer', true]);
    await page.fill('form[data-form="reference-search"] input[name="q"]', 'oxygen adults'); await page.click('form[data-form="reference-search"] button'); await settle();
    assert.deepEqual((await page.locator('article.reference:not(.grouped) h3').allInnerTexts()).slice(0, 2), ['AARC Clinical Practice Guideline: Management of Adult Patients With Oxygen in the Acute Care Setting (2022)', 'Oxygen Therapy for Adults in the Acute Care Facility (2002)']);
    assert.match(await page.locator('article.reference').nth(1).innerText(), /Dated 2002, 24 years ago\. Check with whoever issued it for something newer\.[\s\S]*AARC also lists a later document on this subject/);
    await page.selectOption('#reference-section', 'AARC-Retired Guidelines'); await settle();
    assert.equal(await page.locator('article.reference').count(), 0, 'the retired collection shows nothing until retired documents are asked for');
    await page.check('#reference-retired'); await settle();
    await page.fill('form[data-form="reference-search"] input[name="q"]', ''); await page.click('form[data-form="reference-search"] button'); await settle();
    assert.equal(await page.locator('article.reference.retired').count(), 26);
    await shot('10-reference-shelf');
    const reply = await askFor('Is there an AARC guideline on suctioning?');
    assert.match(reply, /Professional references on this\. They are not your hospital’s protocol\./);
    assert.equal(await page.locator('.ask-answer a.link-button').count(), 3);
    await shot('11-ask-points-to-reference');
    await closeDialog();
    await page.setViewportSize({ width: 390, height: 844 });
    await press('tab', 'protocols');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the reference shelf scrolls sideways on a phone');
    const small = await page.evaluate(() => [...document.querySelectorAll('.content a.link-button, .content form button, .content select, .content input[type=search], .content input[name=q]')].filter(node => node.offsetParent).map(node => Math.round(node.getBoundingClientRect().height)).filter(height => height < 44));
    assert.deepEqual(small, [], 'a control on the reference shelf is under 44 px tall on a phone');
    await shot('12-phone-reference-shelf');
    await page.setViewportSize({ width: 1360, height: 900 });
    const kept = await stored();
    for (const typed of ['oxygen adults', 'guideline on suctioning']) assert.ok(!kept.includes(typed), 'storage holds "' + typed + '"');
    await press('protocol-home');
  });

  await step('someone who is not a record keeper can read, search, bookmark and ask, and cannot add, review or withdraw', async () => {
    const names = await page.locator('#actor option').allInnerTexts(), keepers = (await state()).custodians;
    const other = names.find(name => !keepers.includes(name.toLowerCase().replace(/[^a-z]+/g, ' ').trim()) && !keepers.some(id => name.toLowerCase().startsWith(id)));
    await page.selectOption('#actor', other); await settle();
    await press('tab', 'protocols');
    assert.equal(await page.locator('[data-action="protocol-add"], [data-action="protocol-sample"]').count(), 0);
    await press('protocol-open'); await page.waitForSelector('.protocol-read');
    assert.equal(await page.locator('[data-action="protocol-check"], [data-action="protocol-review"], [data-action="protocol-activate"], [data-action="protocol-withdraw"], #protocol-mapping-file').count(), 0);
    assert.match(await askFor(ADULT), /Start an adult drill at 14 mk\/min\./);
    await closeDialog();
    await page.selectOption('#actor', names.find(name => keepers.some(id => name.toLowerCase().startsWith(id)))); await settle();
  });

  await step('a workspace saved before protocols existed opens intact, and its pasted protocol stays a legacy document', async () => {
    const key = demo ? 'department-hub-v1-demo' : 'department-hub-v1-local', saved = await state();
    const older = { ...saved, documents: [...saved.documents, { id: 'old-doc', title: 'Thin liquids', kind: 'Protocol', effective: '2026-01-01', added: '2026-10-01T10:00:00.000Z', by: 'Jordan',
      text: 'Thin liquids\n\nA swallow screen is recorded before thin liquids are offered in the training kitchen. This is invented text for a test.' }] };
    delete older.protocols;                       // exactly what a Version 17 workspace lacks
    await page.evaluate(([name, value]) => localStorage.setItem(name, JSON.stringify(value)), [key, older]);
    await page.reload(); await page.waitForSelector('#app main');
    const after = await state();
    assert.equal(after.protocols, undefined, 'loading alone rewrites nothing');
    await press('tab', 'protocols');
    assert.match(await text('.content'), /No protocols are held yet/);
    assert.match(await text('.content'), /Pasted documents[\s\S]*Thin liquids[\s\S]*Legacy document · Protocol · effective 2026-01-01/);
    const reply = await askFor('swallow screen before thin liquids');
    assert.match(reply, /Legacy document, not a reviewed protocol · Thin liquids/);
    assert.match(reply, /A pasted document is searched by its words; it is not a reviewed protocol\./);
    assert.ok(await page.locator('.ask-answer [data-action="ask-yes"]').count() === 1, 'legacy document answers keep their own feedback');
    await closeDialog();
    assert.equal((await state()).events.length, saved.events.length, 'receipts are all still there');
    assert.deepEqual((await state()).events.map(event => event.hash), saved.events.map(event => event.hash));
    // Put the library back and check the protocol still answers after a reload, original included.
    await page.evaluate(([name, value]) => localStorage.setItem(name, JSON.stringify(value)), [key, { ...saved, documents: older.documents }]);
    await page.reload(); await page.waitForSelector('#app main');
    assert.match(await askFor(ADULT), /Start an adult drill at 14 mk\/min\./);
    await page.locator('.ask-answer [data-action="ask-go"]').first().click();
    await page.waitForFunction(digest => document.querySelectorAll('[data-page-canvas^="' + digest + '"] canvas').length === 3, TWO, { timeout: 20000 });
  });

  await step('an original missing from this device is said to be missing, and only the very same file restores it', async () => {
    await page.evaluate(digest => new Promise((resolve, reject) => { const open = indexedDB.open('department-hub-media-v1', 1); open.onsuccess = () => { const tx = open.result.transaction('files', 'readwrite'); tx.objectStore('files').delete('protocol:' + digest); tx.oncomplete = resolve; tx.onerror = reject; }; }), TWO);
    await page.reload(); await page.waitForSelector('#app main');
    await press('tab', 'protocols'); await press('protocol-open'); await page.waitForSelector('#protocol-original-file');
    assert.match(await text('.original-pane .notice'), /The original file is not on this device, so it cannot be shown\./);
    assert.equal(await page.locator('.reading-pane .reading-page').count(), 3, 'the reading is still shown');
    await page.setInputFiles('#protocol-original-file', path.join(folder, 'fixtures/protocols/rt-train-014-rev1.pdf')); await page.waitForSelector('.notice:has-text("That is a different file")');
    assert.match(await text('.content > .notice'), /That is a different file\. Its fingerprint starts d09ae851f3b2; this revision is 7cce7d9d091e\. Nothing was changed\./);
    await press('tab', 'protocols');
    await page.setInputFiles('#protocol-original-file', path.join(folder, 'fixtures/protocols/rt-train-014-rev2.pdf'));
    await page.waitForFunction(digest => document.querySelectorAll('[data-page-canvas^="' + digest + '"] canvas').length === 3, TWO, { timeout: 20000 });
    assert.ok((await inked(TWO)).every(dark => dark > 400));
    // A stored file that has been swapped for another is caught by its fingerprint and not shown.
    await page.evaluate(async ([digest, url]) => { const blob = await (await fetch(url)).blob(); await new Promise((resolve, reject) => { const open = indexedDB.open('department-hub-media-v1', 1);
      open.onsuccess = () => { const tx = open.result.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, 'protocol:' + digest); tx.oncomplete = resolve; tx.onerror = reject; }; }); }, [TWO, origin + 'fixtures/protocols/rt-train-014-rev1.pdf']);
    await page.reload(); await page.waitForSelector('#app main');
    await press('tab', 'protocols'); await press('protocol-open'); await page.waitForSelector('#protocol-original-file');
    assert.match(await text('.original-pane .notice'), /The file stored on this device no longer matches this revision’s fingerprint, so it is not shown\./);
    assert.equal(await page.locator('.page-frame canvas').count(), 0, 'a file that fails its fingerprint is not drawn');
    await page.setInputFiles('#protocol-original-file', path.join(folder, 'fixtures/protocols/rt-train-014-rev2.pdf'));
    await page.waitForFunction(digest => document.querySelectorAll('[data-page-canvas^="' + digest + '"] canvas').length === 3, TWO, { timeout: 20000 });
  });

  await step('withdrawing the active revision needs a reason, is recorded, and leaves the protocol with no answer', async () => {
    await press('protocol-withdraw'); await page.fill('form[data-form="protocol-withdraw"] input[name="reason"]', 'Walkthrough finished'); await page.click('form[data-form="protocol-withdraw"] button.danger'); await settle();
    assert.match(await text('.content > .notice'), /Revision withdrawn\. It stays in the history and no longer answers\./);
    const reply = await askFor(ADULT);
    // Revision 1 is the newest live revision again, and it is still active from before.
    assert.match(reply, /Start an adult drill at 12 mk\/min\./, 'with revision 2 withdrawn, revision 1 is in force again');
    await closeDialog();
    const last = (await state()).events.at(-1);
    assert.deepEqual([last.type, last.details.reason, last.details.sha256], ['Protocol revision withdrawn', 'Walkthrough finished', TWO]);
  });

  await step('a phone shows the original and the reading one under the other, with nothing cut off', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await press('tab', 'protocols'); if (await page.locator('[data-action="protocol-open"]').count()) await press('protocol-open');
    await page.waitForSelector('.protocol-read');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page scrolls sideways on a phone');
    assert.ok(await page.locator('.intro .badge.standing').isVisible(), 'where the revision stands is shown on a phone');
    await press('protocol-home');
    assert.ok(await page.locator('.protocol-terms').isVisible(), 'the terms of use of the feature are shown on a phone');
    await press('protocol-open'); await page.waitForSelector('.protocol-read');
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.content button')].filter(button => button.offsetParent && !button.classList.contains('text-button')).map(button => [button.textContent.trim().slice(0, 24), Math.round(button.getBoundingClientRect().height)]));
    assert.ok(sizes.every(([, height]) => height >= 44), 'small targets: ' + JSON.stringify(sizes.filter(([, height]) => height < 44)));
    await shot('09-phone-protocol');
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  await step('blood-gas cards are added from the held capture, and on a phone a checked card answers over the source’s own words', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await closeDialog(); await press('tab', 'protocols'); await press('protocol-home');
    await press('knowledge-add'); await page.waitForSelector('[data-card="paco2"]');
    const added = (await state()).events.at(-1);
    assert.deepEqual([added.type, added.details.sha256, added.details.bytes], ['Reference cards added', 'cf48652c3a646897627597f3827d14b412a963bc7e354604b4c9524071cde3e7', 25965], 'the browser hashed the held page and it matched');
    assert.match(await text('[data-card="paco2"]'), /35–45 mmHg\s+Less than 25 mmHg\./);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the cards screen scrolls sideways on a phone');
    await page.locator('[data-card="paco2"] .source-quote').nth(1).scrollIntoViewIfNeeded(); await shot('10-phone-cards');
    await press('knowledge-check', 'paco2'); await settle();
    await askFor('whats the normal range for PaCO2');
    const answer = await text('.ask-answer');
    assert.match(answer, /Adult normal PaCO2 is 35-45 mmHg/);
    assert.match(answer, /PaCO2\s+Pressure of carbon dioxide in the blood\.[\s\S]*35–45 mmHg\s+Less than 25 mmHg\.\s+Greater than 60 mmHg\./, 'the answer shows the captured row');
    assert.ok(await page.locator('.ask-answer .source-quote').first().isVisible());
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.ask-answer .source-quote')].every(quote => quote.scrollWidth <= quote.clientWidth + 1)), true, 'a quoted passage is cut off');
    await page.locator('.ask-answer .source-quote').nth(1).scrollIntoViewIfNeeded(); await shot('11-phone-card-answer');
    await closeDialog();
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  await step('no page error or console error occurred during the walk', async () => { assert.deepEqual(problems, []); });

  await browser.close(); server.close();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(failed ? failed + ' of ' + results.length + ' steps failed (' + folder + ').' : 'All ' + results.length + ' steps pass (' + folder + ').');
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
