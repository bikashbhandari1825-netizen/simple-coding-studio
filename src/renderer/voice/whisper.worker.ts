// आवाजलाई अक्षरमा बदल्ने worker (Whisper)। आवाज यही computer मा प्रशोधन हुन्छ, कतै पठाइँदैन।
// Speech-to-text worker (Whisper). Audio is processed on this computer and never uploaded.
// Model पहिलोपटक Hugging Face बाट download हुन्छ र cache हुन्छ — the model downloads once, then is cached.
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import ortWasmMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

export const WHISPER_MODEL = 'onnx-community/whisper-small';

export type VoiceRequest = {
  type: 'transcribe';
  audio: Float32Array;
  language: 'nepali' | 'english';
};
export type VoiceResponse =
  | { type: 'loading'; progress: number }
  | { type: 'ready' }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string };

// CDN बाट होइन, app भित्रकै ONNX फाइल प्रयोग गर्ने — use the ONNX runtime files bundled with the app, not a CDN.
env.allowLocalModels = false;
const onnx = env.backends.onnx as {
  wasm?: { wasmPaths?: unknown; numThreads?: number };
};
if (onnx.wasm) {
  onnx.wasm.wasmPaths = {
    mjs: new URL(ortWasmMjs, self.location.href).href,
    wasm: new URL(ortWasm, self.location.href).href,
  };
  onnx.wasm.numThreads = 1;
}

const post = (msg: VoiceResponse) =>
  (self as unknown as { postMessage(m: VoiceResponse): void }).postMessage(msg);

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriber) {
    const files = new Map<string, { loaded: number; total: number }>();
    transcriber = pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: {
        status: string;
        file?: string;
        loaded?: number;
        total?: number;
      }) => {
        if (p.status === 'progress' && p.file && p.total) {
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
          let loaded = 0;
          let total = 0;
          for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          post({
            type: 'loading',
            progress: total ? Math.round((loaded / total) * 100) : 0,
          });
        }
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    transcriber.catch(() => {
      transcriber = null; // अर्कोपटक फेरि प्रयास गर्न मिलोस् — allow a retry next time
    });
  }
  return transcriber;
}

self.addEventListener('message', async (event: MessageEvent<VoiceRequest>) => {
  const req = event.data;
  if (req?.type !== 'transcribe') return;
  try {
    const asr = await load();
    post({ type: 'ready' });
    const output = await asr(req.audio, {
      language: req.language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (
      Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text
    ).trim();
    post({ type: 'result', text });
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
