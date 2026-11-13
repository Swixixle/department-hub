// Speech to text on this phone. The speech model is downloaded once from Hugging Face, at a fixed revision, and kept
// in this browser's cache; after that nothing leaves the phone. The audio itself is never sent anywhere: it is turned
// into text here, in this worker. Not a language model: it writes down what was said, and Ask stays rule-based.
import { pipeline, env } from '@huggingface/transformers';
// The ONNX Runtime WebAssembly files, bundled by the build and served from the app's own address. Without these two
// lines the runtime fetches them from a public CDN.
import ortWasm from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';

export const MODEL = 'onnx-community/whisper-base.en';
export const REVISION = '51eefc0af78b103839eda9e7e4f4186acc6517fe';
let transcriber = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href, mjs: new URL(ortMjs, self.location.href).href };
      env.backends.onnx.wasm.numThreads = 1;
      transcriber ||= await pipeline('automatic-speech-recognition', MODEL, { revision: REVISION, dtype: 'q8', device: 'wasm',
        progress_callback: progress => { if (progress.status === 'progress') self.postMessage({ type: 'progress', file: progress.file, loaded: progress.loaded, total: progress.total }); } });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'transcribe') {
      const result = await transcriber(data.audio, { chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ type: 'text', text: (result.text || '').trim() });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error?.message || error) });
  }
};
