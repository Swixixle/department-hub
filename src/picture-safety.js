// Before a picture goes on the board: rebuild it without its hidden details, and read any words in it.
//
// Hidden details: a phone photo carries EXIF data, which can include where it was taken (GPS), when, and the phone's
// make and model. Drawing the picture onto a blank canvas and saving that keeps only the pixels, so none of it
// survives. The photo is turned upright first, the way the phone showed it, because the turning instruction is itself
// part of what gets dropped.
//
// Words: the same bundled text reader the schedule import uses reads the picture, and what it reads goes through the
// same patient-detail screen as typed words. A photo of a wristband, a chart or a monitor label is stopped before it
// leaves the phone. What the reader saw is used for that check and kept nowhere. It can miss words (handwriting, small
// or angled text) and it cannot recognize a face, so the rule above the composer still applies.
//
// Videos are not rebuilt: a browser cannot rewrite a video file without re-encoding it, which is slow and heavy on a
// phone. The composer says so.

const PICTURE = /^image\/(jpeg|png|webp|heic|heif|gif|avif)$/i;
const LONGEST_SIDE = 2400;            // enough for a phone screen and a zoom; keeps a 12-megapixel photo from being 8 MB

export const isPicture = file => PICTURE.test(file?.type || '') || /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(file?.name || '');

// The size to draw at: the picture's own size, scaled down so its longest side is at most LONGEST_SIDE.
export function drawSize(width, height, longest = LONGEST_SIDE) {
  const scale = Math.min(1, longest / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// What to save the clean copy as. A PNG (screenshots, memes with text) stays PNG so words stay sharp; a GIF is left as
// the file it is, because rebuilding it would freeze an animation and a GIF has no EXIF block to carry a location;
// everything else becomes JPEG.
export function outputOf(file) {
  const type = (file.type || '').toLowerCase(), name = file.name || 'picture';
  if (type === 'image/gif' || /\.gif$/i.test(name)) return { keep: true };
  const png = type === 'image/png' || /\.png$/i.test(name);
  const base = name.replace(/\.[^.]+$/, '') || 'picture';
  return png ? { type: 'image/png', name: base + '.png' } : { type: 'image/jpeg', name: base + '.jpg', quality: 0.88 };
}

// Turns a reading of a picture into the words found and whether they point to a patient. `screen` is guard.js's
// patientFindings, passed in so this file stays free of the app's other modules.
export function judgePictureText(readings, screen) {
  const found = [];
  for (const { name, text } of readings) {
    const findings = screen(String(text || '').replace(/\s+/g, ' '));
    if (findings.length) found.push({ name, findings });
  }
  return { ok: !found.length, found };
}

// The browser half: decode, draw upright and smaller, save as a clean file. Returns the clean File and a canvas-like
// source the text reader can read. Throws a plain-language error if the picture cannot be opened (an HEIC photo in a
// browser that cannot decode HEIC, for instance).
export async function cleanPicture(file) {
  const plan = outputOf(file);
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('“' + file.name + '” could not be opened here to remove its hidden details. Save it as a JPEG or PNG and attach it again.'); }
  const { width, height } = drawSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (plan.type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  if (plan.keep) return { file, readable: canvas, cleaned: false };
  const blob = await new Promise(resolve => canvas.toBlob(resolve, plan.type, plan.quality));
  if (!blob) throw new Error('“' + file.name + '” could not be saved without its hidden details.');
  return { file: new File([blob], plan.name, { type: plan.type, lastModified: Date.now() }), readable: canvas, cleaned: true };
}

// Every picture in a post: cleaned, then read. `read(canvases)` returns one text per canvas (the bundled Tesseract,
// loaded only when a post has a picture). Non-pictures pass through untouched.
export async function preparePictures(files, { read, screen, onStep = () => {} }) {
  const out = [], readable = [], names = [];
  for (const file of files) {
    if (!isPicture(file)) { out.push(file); continue; }
    onStep('Removing hidden details from ' + file.name + '…');
    const clean = await cleanPicture(file);
    out.push(clean.file);
    readable.push(clean.readable);
    names.push(file.name);
  }
  if (!readable.length) return { files: out, check: { ok: true, found: [] }, pictures: 0 };
  onStep('Reading the words in ' + (readable.length === 1 ? 'the picture' : 'the pictures') + '…');
  const texts = await read(readable);
  return { files: out, check: judgePictureText(texts.map((text, index) => ({ name: names[index], text })), screen), pictures: readable.length };
}
