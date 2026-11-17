// आवाजलाई अक्षरमा बदल्ने worker (Whisper)। आवाज यही computer मा प्रशोधन हुन्छ, कतै पठाइँदैन।
// Speech-to-text worker (Whisper). Audio is processed on this computer and never uploaded.
//
// गति: GPU (WebGPU) भए GPU मा, नभए CPU (WASM) मा चल्छ। Model एकपटक लोड भएपछि memory मै रहन्छ।
// Speed: runs on the GPU through WebGPU when available, otherwise on the CPU (WASM). The model stays loaded.
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import ortWasmMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

/** छिटो (base) वा बढी सही (small) — fast (base) or more accurate (small). */
export type VoiceQuality = 'fast' | 'accurate';
const MODELS: Record<VoiceQuality, string> = {
  fast: 'onnx-community/whisper-base',
  accurate: 'onnx-community/whisper-small',
};

export type VoiceLanguage = 'nepali' | 'english';
export type VoiceRequest =
  | { type: 'warmup'; quality: VoiceQuality }
  | {
      type: 'transcribe';
      id: number;
      audio: Float32Array;
      language: VoiceLanguage;
      quality: VoiceQuality;
    };
export type VoiceResponse =
  | { type: 'loading'; progress: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm'; quality: VoiceQuality }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string };

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
  // SharedArrayBuffer भए धेरै CPU core प्रयोग गर्ने — use several CPU cores when SharedArrayBuffer is available.
  onnx.wasm.numThreads =
    typeof SharedArrayBuffer !== 'undefined'
      ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
      : 1;
}

const post = (msg: VoiceResponse) =>
  (self as unknown as { postMessage(m: VoiceResponse): void }).postMessage(msg);

type Loaded = {
  asr: AutomaticSpeechRecognitionPipeline;
  device: 'webgpu' | 'wasm';
};
const transcribers = new Map<VoiceQuality, Promise<Loaded>>();

async function pickDevice(): Promise<{
  device: 'webgpu' | 'wasm';
  fp16: boolean;
}> {
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> };
    }
  ).gpu;
  if (!gpu) return { device: 'wasm', fp16: false };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { device: 'wasm', fp16: false };
    return { device: 'webgpu', fp16: adapter.features.has('shader-f16') };
  } catch {
    return { device: 'wasm', fp16: false };
  }
}

function load(quality: VoiceQuality): Promise<Loaded> {
  let transcriber = transcribers.get(quality);
  if (!transcriber) {
    const model = MODELS[quality];
    transcriber = (async (): Promise<Loaded> => {
      const files = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (p: {
        status: string;
        file?: string;
        loaded?: number;
        total?: number;
      }) => {
        if (p.status !== 'progress' || !p.file || !p.total) return;
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
      };
      const choice = await pickDevice();
      if (choice.device === 'webgpu') {
        try {
          const asr = (await pipeline('automatic-speech-recognition', model, {
            device: 'webgpu',
            dtype: {
              encoder_model: choice.fp16 ? 'fp16' : 'fp32',
              decoder_model_merged: 'q4',
            },
            progress_callback,
          })) as AutomaticSpeechRecognitionPipeline;
          // पहिलो पटकको GPU तयारी अहिल्यै सक्ने — compile the GPU shaders now, not on the first real request.
          await asr(new Float32Array(16000), {
            language: 'english',
            task: 'transcribe',
          });
          return { asr, device: 'webgpu' as const };
        } catch {
          // GPU मा नचले CPU मा फर्कने — fall back to the CPU if the GPU path fails.
        }
      }
      const asr = (await pipeline('automatic-speech-recognition', model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback,
      })) as AutomaticSpeechRecognitionPipeline;
      return { asr, device: 'wasm' as const };
    })();
    transcribers.set(quality, transcriber);
    transcriber.catch(() => {
      transcribers.delete(quality); // अर्कोपटक फेरि प्रयास गर्न मिलोस् — allow a retry next time
    });
  }
  return transcriber;
}

// एकपटकमा एउटा मात्र काम, क्रमैसँग — one job at a time, in order.
let queue: Promise<void> = Promise.resolve();

self.addEventListener('message', (event: MessageEvent<VoiceRequest>) => {
  const req = event.data;
  if (req?.type === 'warmup') {
    queue = queue.then(async () => {
      try {
        const { device } = await load(req.quality);
        post({ type: 'ready', device, quality: req.quality });
      } catch (err) {
        post({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return;
  }
  if (req?.type !== 'transcribe') return;
  queue = queue.then(async () => {
    try {
      const { asr, device } = await load(req.quality);
      post({ type: 'ready', device, quality: req.quality });
      const t0 = performance.now();
      const output = await asr(req.audio, {
        language: req.language,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = (
        Array.isArray(output)
          ? output.map((o) => o.text).join(' ')
          : output.text
      ).trim();
      post({
        type: 'result',
        id: req.id,
        text,
        ms: Math.round(performance.now() - t0),
      });
    } catch (err) {
      post({
        type: 'error',
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
});
