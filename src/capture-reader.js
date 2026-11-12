// Reads a captured page's screenshots with the app's own text reader (the same bundled Tesseract the schedule import
// uses), three times each: as a page, as a single block, and as scattered words, because each way takes a table's cells
// differently and a short label ("SaO2") or a highlighted line can be missed by one way and read by another.
// The words come back with their boxes and how sure the reader was. Loaded only when a captured page is being added.
import { createWorker } from 'tesseract.js';

const asset = path => new URL(import.meta.env.BASE_URL + path, window.location.href).href;
export const READ_MODES = ['3', '6', '11'];

const wordsOf = data => (data.blocks || []).flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || [])
  .map(word => ({ text: word.text, confidence: Math.round(word.confidence), box: [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1] }));

// `images` are Blobs of PNG files. Returns, for each, one list of words per reading mode.
export async function readShots(images, onProgress = () => {}) {
  const worker = await createWorker('eng', 1, { workerPath: asset('ocr/worker.min.js'), corePath: asset('ocr'), langPath: asset('ocr'), workerBlobURL: false, cacheMethod: 'none' });
  try {
    const out = [];
    for (const [index, image] of images.entries()) {
      const readings = [];
      for (const mode of READ_MODES) {
        onProgress(index * READ_MODES.length + readings.length + 1, images.length * READ_MODES.length);
        await worker.setParameters({ tessedit_pageseg_mode: mode });
        const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
        readings.push(wordsOf(data));
      }
      out.push(readings);
    }
    return out;
  } finally {
    await worker.terminate();
  }
}
