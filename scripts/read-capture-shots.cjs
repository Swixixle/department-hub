#!/usr/bin/env node
// Reads the held Blinders screenshots in a real browser with the same text reader the app ships (Tesseract.js, the
// same core and language data, the same three reading modes) and writes what it read to tests/fixtures/witness/.
// The Node tests then check the witness logic against the reader's real output, without a browser.
// Run `npm run build` first. Needs Playwright with Chromium. Not part of `npm test` or CI.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist'), sources = path.join(root, 'src/reference/sources'), out = path.join(root, 'tests/fixtures/witness');
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.png': 'image/png', '.html': 'text/html' };
(async () => {
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = url === '/' ? null : url.startsWith('/shots/') ? path.join(sources, path.basename(url)) : url === '/tesseract.min.js' ? path.join(root, 'node_modules/tesseract.js/dist/tesseract.min.js') : path.join(dist, url);
    if (!file) { response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>reader</title>'); return; }
    if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(), page = await browser.newPage();
  await page.goto(origin + '/'); await page.addScriptTag({ url: origin + '/tesseract.min.js' });
  const shots = fs.readdirSync(sources).filter(name => name.endsWith('.png')).sort();
  for (const name of shots) {
    const started = Date.now();
    const readings = await page.evaluate(async url => {
      const worker = await Tesseract.createWorker('eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr', workerBlobURL: false, cacheMethod: 'none' });
      const image = await fetch(url).then(response => response.blob()), readings = [];
      for (const mode of ['3', '6', '11']) {
        await worker.setParameters({ tessedit_pageseg_mode: mode });
        const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
        readings.push((data.blocks || []).flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || [])
          .map(word => ({ text: word.text, confidence: Math.round(word.confidence), box: [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1] })));
      }
      await worker.terminate();
      return readings;
    }, '/shots/' + name);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, name.replace(/\.png$/, '.readings.json')), JSON.stringify(readings) + '\n');
    console.log(name, readings.map(reading => reading.length + ' words').join(', '), Date.now() - started + ' ms');
  }
  await browser.close(); server.close();
})().catch(error => { console.error(error); process.exit(1); });
