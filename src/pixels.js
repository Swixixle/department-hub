// Pixel helpers for photographed paper schedules. Pure functions over an ImageData-like { data, width, height }.

// Ink is dark in every colour channel. Highlighter is bright in at least one, so the brightest channel
// washes it out. Comparing each pixel with its neighbourhood handles uneven lighting across a photo.
export function inkMask({ data, width, height }, strength = 0.72) {
  const count = width * height;
  const value = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) value[i] = Math.max(data[p], data[p + 1], data[p + 2]);
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += value[y * width + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const radius = Math.max(12, Math.round(Math.max(width, height) / 80));
  const mask = new Uint8Array(count);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
      const total = sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left];
      if (value[y * width + x] * (bottom - top) * (right - left) < total * strength) mask[y * width + x] = 1;
    }
  }
  return mask;
}

export function maskToRgba(mask) {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = mask[i] ? 0 : 255;
    out[p + 3] = 255;
  }
  return out;
}

// OCR word boxes are often taller than the letters. This trims a box to the rows that actually hold ink.
export function tightBox(mask, width, [x0, y0, x1, y1]) {
  const counts = [];
  for (let y = y0; y < y1; y++) {
    let count = 0;
    for (let x = x0; x < x1; x++) count += mask[y * width + x];
    counts.push(count);
  }
  const floor = Math.max(...counts, 0) * 0.25;
  let best = [0, 0], start = -1;
  counts.forEach((count, index) => {
    if (count > floor && start < 0) start = index;
    if ((count <= floor || index === counts.length - 1) && start >= 0) {
      const end = count > floor ? index + 1 : index;
      if (end - start > best[1] - best[0]) best = [start, end];
      start = -1;
    }
  });
  return best[1] > best[0] ? [x0, y0 + best[0], x1, y0 + best[1]] : [x0, y0, x1, y1];
}

// Mean colour of the lighter pixels around a word, as hue (degrees) and saturation.
export function backgroundColor({ data, width, height }, [x0, y0, x1, y1], pad = 3) {
  const left = Math.max(0, x0 - pad), right = Math.min(width, x1 + pad);
  const top = Math.max(0, y0 - pad), bottom = Math.min(height, y1 + pad);
  const pixels = [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const p = (y * width + x) * 4;
      pixels.push([Math.max(data[p], data[p + 1], data[p + 2]), data[p], data[p + 1], data[p + 2]]);
    }
  }
  if (!pixels.length) return { hue: 0, saturation: 0 };
  pixels.sort((a, b) => b[0] - a[0]);
  const light = pixels.slice(0, Math.max(1, Math.round(pixels.length * 0.6)));
  const [r, g, b] = [1, 2, 3].map(channel => light.reduce((sum, pixel) => sum + pixel[channel], 0) / light.length / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta > 0) {
    hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, saturation: max ? delta / max : 0 };
}

// Names the highlighter colour behind a word, or null for plain paper. `paper` is the page's own paper saturation.
export function tintName({ hue, saturation }, paper = 0.05) {
  if (saturation < Math.max(0.1, paper + 0.03)) return null;
  if (hue >= 290 || hue < 20) return 'pink';
  if (hue < 75) return hue >= 35 && saturation > 0.25 ? 'yellow' : null;
  if (hue < 170) return 'green';
  if (hue < 265) return 'blue';
  return null;
}

// Long, nearly level pen strokes inside a region. A strike-through is one. Printed letters and
// handwriting only produce short runs. A run may drift one pixel up or down per step.
export function longStrokes(mask, width, { x0, y0, x1, y1 }, minLength) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(width, Math.ceil(x1)); y1 = Math.min(Math.floor(mask.length / width), Math.ceil(y1));
  const rows = y1 - y0;
  if (rows <= 0 || x1 <= x0) return [];
  let previous = new Uint16Array(rows + 2), current = new Uint16Array(rows + 2);
  const found = [];
  const close = (x, length, y) => {
    const stroke = { x0: x - length, x1: x, y, length };
    const twin = found.find(item => Math.abs(item.y - y) <= 6 && item.x0 < stroke.x1 && stroke.x0 < item.x1);
    if (!twin) found.push(stroke);
    else if (length > twin.length) Object.assign(twin, stroke);
  };
  for (let x = x0; x <= x1; x++) {
    current.fill(0);
    if (x < x1) {
      for (let row = 0; row < rows; row++) {
        if (mask[(y0 + row) * width + x]) current[row + 1] = 1 + Math.max(previous[row], previous[row + 1], previous[row + 2]);
      }
    }
    for (let row = 0; row < rows; row++) {
      const length = previous[row + 1];
      if (length >= minLength && current[row] <= length && current[row + 1] <= length && current[row + 2] <= length) close(x, length, y0 + row);
    }
    [previous, current] = [current, previous];
  }
  return found;
}
