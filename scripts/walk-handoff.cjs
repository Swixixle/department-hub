// Walks the Handoff tab in a real Chromium at phone size, with invented data only: start, beds, typed fields and the
// name screen, a chart photo boxed out, a vent screen read, dictation through the on-phone speech model (a recorded
// sentence played as the microphone), the bedside view, print, the wipe, and the 13-hour wipe. Checks that nothing of
// the handoff reaches the workspace, its backup or any other address.
//   node scripts/walk-handoff.cjs dist FIXTURES_DIR [--shots DIR] [--model-cache DIR]
// FIXTURES_DIR holds chart.png, vent.png and said.wav (all invented). The speech model is fetched once with curl into
// --model-cache and served from there, so the test needs no browser access to the internet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const folder = path.resolve(process.argv[2] || 'dist'), fixtures = path.resolve(process.argv[3] || '.');
const option = name => process.argv.includes(name) ? path.resolve(process.argv[process.argv.indexOf(name) + 1]) : null;
const shots = option('--shots'), cache = option('--model-cache') || path.join(fixtures, 'model-cache');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
const results = [];
const step = async (name, work) => { try { await work(); results.push([true, name]); console.log('PASS  ' + name); } catch (error) { results.push([false, name]); console.log('FAIL  ' + name + '\n        ' + String(error.message).split('\n').slice(0, 6).join('\n        ')); } };

(async () => {
  const server = http.createServer((request, response) => {
    const file = path.join(folder, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(folder) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + path.join(fixtures, 'said.wav') + '%noloop'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await context.grantPermissions(['microphone'], { origin });
  const elsewhere = [];
  context.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) elsewhere.push(url); });
  // The speech model: served from a local copy fetched with curl, so the browser itself reaches no outside address.
  fs.mkdirSync(cache, { recursive: true });
  await context.route('https://huggingface.co/**', async route => {
    const url = route.request().url(), file = path.join(cache, url.replace(/^https:\/\/huggingface\.co\//, '').replace(/[?#].*$/, '').replace(/[^\w.-]+/g, '_'));
    if (!fs.existsSync(file)) { try { execFileSync('curl', ['-sfL', '-o', file, url]); } catch { await route.fulfill({ status: 404, body: '' }); return; } }
    await route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': /\.json$/.test(file) ? 'application/json' : 'application/octet-stream', 'access-control-allow-origin': '*' } });
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push('page error: ' + error.message));
  page.on('console', message => { if (message.type() === 'error' && !/^Estimating resolution as \d+$/.test(message.text())) problems.push('console: ' + message.text()); });
  const press = async (action, value) => { await page.locator('[data-action="' + action + '"]' + (value === undefined ? '' : '[data-value="' + value + '"]')).first().click(); };
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
  const stored = () => page.evaluate(() => Object.keys(localStorage).map(key => key + '=' + localStorage.getItem(key)).join('\n'));
  const held = () => page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'department-hub-handoff-v1') ? new Promise(resolve => { const open = indexedDB.open('department-hub-handoff-v1'); open.onsuccess = () => { const db = open.result; if (!db.objectStoreNames.contains('report')) { db.close(); resolve(null); return; }
    const get = db.transaction('report').objectStore('report').get('current'); get.onsuccess = () => { db.close(); resolve(get.result || null); }; }; open.onerror = () => resolve(null); }) : null);
  const fieldOf = (bed, key) => page.locator('[data-bed-card] :is(input,select,textarea)[data-handoff-field="' + key + '"]').nth(bed);
  const setField = async (bed, key, value) => { const field = fieldOf(bed, key); await field.fill(value); await field.dispatchEvent('change'); await page.waitForTimeout(150); };

  await page.goto(origin);
  await page.waitForSelector('#app main');
  if (await page.locator('[data-action="notice-ok"]').count()) await press('notice-ok');

  await step('Handoff is the sixth tab, every tab still a full-size target, nothing pushed sideways', async () => {
    const tabs = await page.evaluate(() => [...document.querySelectorAll('nav .nav-item')].map(item => { const box = item.getBoundingClientRect(); return [item.textContent.trim(), Math.round(box.width), Math.round(box.height)]; }));
    assert.equal(tabs.length, 6); assert.match(tabs.at(-1)[0], /Handoff/);
    assert.ok(tabs.every(([, width, height]) => width >= 44 && height >= 44), JSON.stringify(tabs));
    await press('tab', 'handoff'); await page.waitForSelector('.handoff-start');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  });

  await step('the tab says where the handoff lives, and the banner changes to match', async () => {
    assert.match(await page.locator('.handoff-terms').innerText(), /On this phone only\.\s+Not sent anywhere, not in backups, not on the department server\. Wiped 13 hours/);
    assert.match(await page.locator('.unofficial').innerText(), /This phone only\. Bed numbers, never names\./);
    await shot('handoff-1-start');
  });

  await step('a night handoff starts; a bed is a number, a name is refused as a bed', async () => {
    await press('handoff-start', 'N'); await page.waitForSelector('form[data-form="handoff-bed"]');
    await page.fill('form[data-form="handoff-bed"] input[name="bed"]', 'Jones'); await page.click('form[data-form="handoff-bed"] button');
    await page.waitForSelector('.notice[role="status"]'); assert.match(await page.locator('.notice[role="status"]').innerText(), /A bed is a short number/);
    for (const bed of ['12', '4']) { await page.fill('form[data-form="handoff-bed"] input[name="bed"]', bed); await page.click('form[data-form="handoff-bed"] button'); await page.waitForTimeout(150); }
    assert.deepEqual(await page.locator('.handoff-bed h2').allInnerTexts(), ['Bed 4', 'Bed 12']);
  });

  await step('typed fields save as they change; a name is stopped until its writer says it is not one', async () => {
    await setField(1, 'mode', 'PRVC'); await setField(1, 'events', 'Desat to 84% at 0200 with suctioning, recovered');
    await setField(1, 'plan', 'Hamilton Medical rep coming at 0900');
    assert.match(await page.locator('.handoff-refusal').first().innerText(), /Not saved: what may be a name \(“Hamilton Medical”\)/);
    await press('handoff-not-name', 'Hamilton Medical'); await setField(1, 'plan', 'Hamilton Medical rep coming at 0900');
    await setField(1, 'airway', 'MRN 00482913');
    assert.match(await page.locator('.handoff-refusal').first().innerText(), /a record or account number/);
    const report = await held(), twelve = report.beds.find(bed => bed.bed === '12');
    assert.deepEqual([twelve.fields.mode, twelve.fields.plan, twelve.fields.airway], ['PRVC', 'Hamilton Medical rep coming at 0900', undefined]);
    await shot('handoff-2-bed');
  });

  await step('a chart photo is boxed out: the name, record and birth-date lines go black, the settings stay and are read', async () => {
    await page.locator('input[data-handoff-photo]').nth(1).setInputFiles(path.join(fixtures, 'chart.png'));
    await page.waitForSelector('#handoff-mask', { timeout: 120000 }); await page.waitForTimeout(300);
    const summary = await page.locator('dialog').innerText();
    await shot('handoff-3-masked');
    assert.match(summary, /words boxed out/);
    // The name line sits at the top left of the invented chart; the settings line lower down. Measured as ink on the kept copy.
    const dark = await page.evaluate(() => { const canvas = document.getElementById('handoff-mask'), context = canvas.getContext('2d'), scale = canvas.width / 1400;
      const share = (x, y, w, h) => { const data = context.getImageData(x * scale, y * scale, w * scale, h * scale).data; let black = 0; for (let at = 0; at < data.length; at += 4) if (data[at] + data[at + 1] + data[at + 2] < 60) black++; return black / (data.length / 4); };
      return { name: share(180, 45, 380, 40), mrn: share(50, 125, 90, 35), mrnNumber: share(150, 125, 200, 35), dob: share(420, 125, 260, 35), rate: share(50, 525, 130, 35), fio2: share(600, 525, 150, 35) }; });
    assert.ok(dark.name > 0.6, 'the name is boxed out: ' + JSON.stringify(dark));
    for (const part of ['mrn', 'mrnNumber', 'dob']) assert.ok(dark[part] > 0.6, part + ' is boxed out: ' + JSON.stringify(dark));
    for (const part of ['rate', 'fio2']) assert.ok(dark[part] < 0.2, part + ' is still readable: ' + JSON.stringify(dark));
    assert.match(summary, /PEEP: 8/); assert.match(summary, /FiO2: 40/);
    await press('handoff-photo-keep'); await page.waitForSelector('.handoff-photos img');
    const twelve = (await held()).beds.find(bed => bed.bed === '12');
    assert.equal(twelve.photos.length, 1); assert.equal(twelve.fields.peep, '8'); assert.equal(twelve.fields.fio2, '40');
  });

  await step('a vent screen photo fills the settings of another bed', async () => {
    await page.locator('input[data-handoff-photo]').nth(0).setInputFiles(path.join(fixtures, 'vent.png'));
    await page.waitForSelector('#handoff-mask', { timeout: 120000 });
    const summary = await page.locator('dialog').innerText();
    await shot('handoff-3b-vent');
    if (!/Rate: 16/.test(summary)) console.log('        vent dialog: ' + summary.replace(/\s+/g, ' ').slice(0, 600));
    for (const wanted of [/Mode: PRVC/, /Rate: 16/, /Vt: 420/, /PEEP: 10/, /FiO2: 45/]) assert.match(summary, wanted);
    await press('handoff-photo-keep'); await page.waitForTimeout(200);
    const four = (await held()).beds.find(bed => bed.bed === '4');
    assert.deepEqual([four.fields.mode, four.fields.rate, four.fields.vt, four.fields.peep, four.fields.fio2], ['PRVC', '16', '420', '10', '45']);
  });

  await step('dictation: the speech model loads on the phone, the microphone recording is written down and lands in the beds', async () => {
    await press('handoff-dictate'); await page.waitForSelector('[data-action="handoff-speech-load"]');
    assert.match(await page.locator('dialog').innerText(), /about 77 MB, once/);
    await press('handoff-speech-load'); await page.waitForSelector('[data-action="handoff-rec"]', { timeout: 240000 });
    await press('handoff-rec'); await page.waitForTimeout(22000); await press('handoff-rec-stop');
    await page.waitForSelector('form[data-form="handoff-heard"]', { timeout: 180000 });
    const heard = await page.locator('form[data-form="handoff-heard"] textarea').inputValue();
    console.log('        heard: ' + heard);
    // The recording is a synthetic voice (espeak), harder than a person: the speech model must get the settings words.
    for (const wanted of [/PRVC/i, /\b14\b/, /\b450\b/, /40\s*%/, /breathing trial/i]) assert.match(heard, wanted);
    await shot('handoff-4-heard');
    // What it mishears, the person fixes in the box before it goes in: the flow the screen asks for.
    const fixed = heard.replace(/^\W*\w+\s+(12|twelve)\b/i, 'Bed 12').replace(/P-?P\w*\.?/i, 'PEEP 8.');
    await page.fill('form[data-form="handoff-heard"] textarea', fixed); await press('handoff-reread'); await page.waitForSelector('form[data-form="handoff-heard"]');
    assert.match(await page.locator('.heard-plan').innerText(), /Bed 12:[^\n]*PEEP 8/);
    await page.click('form[data-form="handoff-heard"] button.primary'); await page.waitForTimeout(300);
    const twelve = (await held()).beds.find(bed => bed.bed === '12');
    assert.equal(twelve.fields.peep, '8'); assert.match(twelve.fields.plan || '', /breathing trial|SBT/i);
  });

  await step('bedside view and print show the beds and nothing else', async () => {
    await press('handoff-bedside'); await page.waitForSelector('.bedside');
    assert.match(await page.locator('.bedside').innerText(), /Bed 12[\s\S]*Mode[\s\S]*PRVC/);
    await shot('handoff-5-bedside'); await press('close');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.handoff-print').isVisible(), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('nav')).visibility), 'hidden');
    await page.emulateMedia({ media: 'screen' });
  });

  await step('nothing of the handoff is in the workspace, its backup or any other address', async () => {
    const all = await stored();
    for (const word of ['PRVC', 'Hamilton', 'Desat to 84%', 'Kowalski', '00482913']) assert.ok(!all.includes(word), word + ' is in browser storage outside the handoff');
    const backup = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter(key => /^department-hub-v1/.test(key)).map(key => localStorage.getItem(key))));
    assert.ok(!backup.includes('Desat to 84%'));
    const outside = elsewhere.filter(url => !url.startsWith('https://huggingface.co/'));
    assert.deepEqual(outside, [], 'requests outside the app and the model host');
  });

  await step('Handed off wipes the whole handoff from the phone', async () => {
    await press('handoff-wipe'); await press('handoff-wipe-yes'); await page.waitForSelector('.handoff-start');
    assert.equal(await held(), null);
  });

  await step('a handoff past its 13 hours is wiped when the app next opens', async () => {
    await press('handoff-start', 'D'); await page.fill('form[data-form="handoff-bed"] input[name="bed"]', '7B'); await page.click('form[data-form="handoff-bed"] button'); await page.waitForTimeout(200);
    assert.ok(await held());
    await page.addInitScript(() => { const shift = 13 * 3600000 + 60000, RealDate = Date; globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [RealDate.now() + shift])); } static now() { return RealDate.now() + shift; } }; });
    await page.reload(); await page.waitForSelector('#app main');
    if (await page.locator('[data-action="notice-ok"]').count()) await press('notice-ok');
    await press('tab', 'handoff'); await page.waitForSelector('.handoff-start');
    assert.match(await page.locator('.notice[role="status"]').first().innerText(), /wiped: its 13 hours were up/);
    assert.equal(await held(), null);
  });

  await step('no page error or console error occurred during the walk', async () => assert.deepEqual(problems, []));
  await browser.close(); server.close();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(failed ? failed + ' of ' + results.length + ' steps failed.' : 'All ' + results.length + ' steps pass (' + folder + ').');
  process.exit(failed ? 1 : 0);
})();
