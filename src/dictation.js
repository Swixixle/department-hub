// The page side of dictation: record with the microphone, turn the recording into 16 kHz samples, and hand them to the
// speech worker. Nothing here or there sends audio anywhere.
let worker = null, ready = null;
const base = () => new URL(import.meta.env.BASE_URL, window.location.href).href;

export function loadSpeech(onProgress = () => {}) {
  if (ready) return ready;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  const files = new Map();
  ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { files.set(data.file, [data.loaded, data.total]); const all = [...files.values()]; onProgress(all.reduce((sum, [loaded]) => sum + loaded, 0), all.reduce((sum, [, total]) => sum + (total || 0), 0)); }
      if (data.type === 'ready') resolve();
      if (data.type === 'error') { ready = null; reject(new Error(data.message)); }
    };
    worker.postMessage({ type: 'load', base: base() });
  });
  return ready;
}

export async function transcribe(samples) {
  await ready;
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => { if (data.type === 'text') resolve(data.text); if (data.type === 'error') reject(new Error(data.message)); };
    worker.postMessage({ type: 'transcribe', audio: samples }, [samples.buffer]);
  });
}

// A recording, decoded and resampled to the 16 kHz mono the model reads.
export async function toSamples(blob) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    return (await offline.startRendering()).getChannelData(0).slice();
  } finally { context.close(); }
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream), chunks = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  return { stop: () => new Promise(resolve => { recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); resolve(new Blob(chunks, { type: recorder.mimeType })); }; recorder.stop(); }) };
}
