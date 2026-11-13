// A photo for the handoff: a vent screen, or a chart, patient list or flowsheet. Every one is boxed out before it is
// kept, the same way, and the original is never stored.
//
// 1. The photo is redrawn without its hidden details (location, time, phone model), as the board does.
// 2. The bundled text reader reads every word and where it is, two ways (as a page, and as scattered words).
// 3. Every word that is not a known clinical term or a short number that is not a date is boxed out in black, and so
//    is every word on a line that names a person or a record. That is an allow list: a name is boxed out because it is
//    not on the list, not because anything recognised it as a name.
// 4. The boxed copy is read once more, and anything still matching the patient screen is boxed out too.
// 5. The person sees the result, can box out more with a finger, and keeps it or throws it away.
//
// What it cannot do: it cannot see a face, a barcode or handwriting it cannot read, and a word it cannot read at all
// is left as it is. That is why step 5 exists, and why the screen says to look before keeping it.
import { createWorker } from 'tesseract.js';
import { cleanPicture } from './picture-safety.js';
import { maskPlan, keepWord, readVentWords, screenHandoff } from './handoff.js';

const asset = path => new URL(import.meta.env.BASE_URL + path, window.location.href).href;
const worker = () => createWorker('eng', 1, { workerPath: asset('ocr/worker.min.js'), corePath: asset('ocr'), langPath: asset('ocr'), workerBlobURL: false, cacheMethod: 'none' });

async function wordsIn(reader, canvas, modes) {
  const words = [];
  for (const mode of modes) {
    await reader.setParameters({ tessedit_pageseg_mode: mode });
    const { data } = await reader.recognize(canvas, {}, { blocks: true, text: false });
    let line = 0;
    for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) for (const row of paragraph.lines || []) {
      line++;
      for (const word of row.words || []) words.push({ text: word.text, confidence: Math.round(word.confidence), bbox: word.bbox, line: mode + ':' + line });
    }
  }
  return words;
}

// The reader is trained on dark text on a light page. A vent screen is light text on a dark one, so a mostly dark
// photo is read from an inverted grey copy; the boxes it finds are in the same places on the photo itself.
export function readableCopy(canvas) {
  const { width, height } = canvas, data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let sum = 0; for (let at = 0; at < data.length; at += 64) sum += 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2];
  if (sum / (data.length / 64) >= 110) return canvas;
  const copy = document.createElement('canvas'); copy.width = width; copy.height = height;
  const context = copy.getContext('2d'); context.filter = 'grayscale(1) invert(1) contrast(1.4)'; context.drawImage(canvas, 0, 0);
  return copy;
}
export const blackOut = (canvas, boxes) => { const context = canvas.getContext('2d'); context.fillStyle = '#000'; for (const box of boxes) context.fillRect(box.x, box.y, box.w, box.h); };

// Returns the boxed-out canvas (not yet saved), what was boxed and kept, and any vent settings read from kept words.
export async function maskPhoto(file, onStep = () => {}) {
  onStep('Removing hidden details…');
  const { readable: canvas } = await cleanPicture(file);
  const reader = await worker();
  try {
    onStep('Reading the words in the photo…');
    const source = readableCopy(canvas);
    const words = await wordsIn(reader, source, ['3', '11']);
    const plan = maskPlan(words);
    blackOut(canvas, plan.boxes);
    onStep('Checking the boxed copy…');
    const again = await wordsIn(reader, readableCopy(canvas), ['11']);
    // A word read clearly that is still not allowed, or anything shaped like a record, is boxed too. A smudge the reader
    // half-sees beside a black box (low confidence) is not: the first pass already boxed every word it was unsure of.
    const left = again.filter(word => screenHandoff(word.text).length || (word.confidence >= 60 && !keepWord(word.text, word.confidence) && word.text.replace(/\W/g, '').length > 2));
    const second = maskPlan(left.map(word => ({ ...word, line: 'again' })), 3).boxes;
    blackOut(canvas, second);
    const settings = readVentWords(words.filter(word => keepWord(word.text, word.confidence)));
    return { canvas, boxed: plan.boxed + second.length, kept: plan.kept, settings };
  } finally {
    await reader.terminate();
  }
}

export const canvasBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The photo could not be saved.')), 'image/jpeg', 0.85));
