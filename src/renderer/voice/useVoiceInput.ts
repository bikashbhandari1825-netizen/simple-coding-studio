import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  VoiceLanguage,
  VoiceQuality,
  VoiceRequest,
  VoiceResponse,
} from './whisper.worker';

export type { VoiceLanguage, VoiceQuality };

export type VoiceState =
  | { stage: 'idle' }
  | { stage: 'loading'; progress: number }
  | { stage: 'recording'; seconds: number }
  | { stage: 'finishing' };

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 120;
/** यति चुप रहेपछि टुक्रा पक्का गर्ने — commit a segment after this much silence. */
const COMMIT_SILENCE_S = 0.6;
/** लामो बोलाइलाई यति सेकेन्डमा टुक्र्याउने (छोटो टुक्रा = छिटो) — split long speech; shorter segments are faster. */
const MAX_SEGMENT_S = 5;
/** बोल्दै गर्दा हरेक यति सेकेन्डमा नयाँ शब्द देखाउने — refresh live words this often while speaking. */
const LIVE_STEP_S = 0.4;
/** रोक्दा यतिभन्दा कम नयाँ आवाज भए live पाठ नै अन्तिम मान्ने — on stop, reuse the live text if this little audio is new. */
const REUSE_TAIL_S = 0.5;

const LANG_KEY = 'studio.voiceLanguage';
const QUALITY_KEY = 'studio.voiceQuality';
const USED_KEY = 'studio.voiceUsed';

function stored<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

// Whisper ले चुप आवाजमा कहिलेकाहीं बनाउने झूटा शब्द — phrases Whisper invents on near-silence.
const HALLUCINATION =
  /^\s*(\[.*\]|\(.*\)|thank you\.?|thanks\.?|thanks for watching\.?|you|bye\.?|\.+)\s*$/i;

interface Session {
  ctx: AudioContext;
  stream: MediaStream;
  proc: ScriptProcessorNode;
  chunks: Float32Array[];
  total: number;
  /** अहिलेको टुक्रा कहाँबाट सुरु — start of the current (uncommitted) segment, in samples */
  segStart: number;
  /** अन्तिम पटक बोलेको ठाउँ — last sample index that held speech */
  lastVoice: number;
  segHasSpeech: boolean;
  lastLiveAt: number;
  /** पृष्ठभूमि आवाजको स्तर — adaptive background-noise level */
  noise: number;
  committed: string;
  interim: string;
  /** live पाठले कहाँसम्मको आवाज समेटेको — how far (in samples) the live text covers */
  interimTo: number;
  busy: boolean;
  nextId: number;
  pending: Map<number, { commit: boolean; to: number }>;
  stopping: boolean;
  finalSent: boolean;
  timer: ReturnType<typeof setInterval>;
  startedAt: number;
}

/**
 * 🎤 Live voice typing: बोल्दै गर्दा शब्दहरू तुरुन्तै text box मा आउँछन् (GPU मा Whisper)।
 * Live voice typing: words appear while you speak (Whisper on the GPU), and the waveform follows your voice.
 *
 * onLive(text, final) — यो पटक बोलेको पूरा पाठ — the full dictated text of this session so far.
 */
export function useVoiceInput(onLive: (text: string, final: boolean) => void) {
  const [state, setState] = useState<VoiceState>({ stage: 'idle' });
  const [language, setLanguageState] = useState<VoiceLanguage>(() =>
    stored(LANG_KEY, ['nepali', 'english'] as const, 'nepali'),
  );
  const [quality, setQualityState] = useState<VoiceQuality>(() =>
    stored(QUALITY_KEY, ['fast', 'accurate'] as const, 'fast'),
  );
  const [device, setDevice] = useState<'webgpu' | 'wasm' | null>(null);
  const [error, setError] = useState('');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const settingsRef = useRef({ language, quality });
  settingsRef.current = { language, quality };
  const session = useRef<Session | null>(null);

  const emit = (s: Session, final: boolean) => {
    const text = [s.committed, s.interim]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    onLiveRef.current(text, final);
  };

  const finish = useCallback((s: Session) => {
    if (session.current !== s) return;
    clearInterval(s.timer);
    s.interim = '';
    emit(s, true);
    session.current = null;
    setAnalyser(null);
    setState({ stage: 'idle' });
    void s.ctx.close();
  }, []);

  const slice = (s: Session, from: number, to: number) => {
    const out = new Float32Array(Math.max(0, to - from));
    let offset = 0;
    let pos = 0;
    for (const c of s.chunks) {
      const end = pos + c.length;
      if (end > from && pos < to) {
        const a = Math.max(from, pos) - pos;
        const b = Math.min(to, end) - pos;
        out.set(c.subarray(a, b), offset);
        offset += b - a;
      }
      pos = end;
    }
    return out;
  };

  const send = (s: Session, commit: boolean, from: number, to: number) => {
    const worker = workerRef.current;
    if (!worker) return;
    const audio = slice(s, from, to);
    const id = s.nextId++;
    s.pending.set(id, { commit, to });
    s.busy = true;
    const { language: lang, quality: q } = settingsRef.current;
    const req: VoiceRequest = {
      type: 'transcribe',
      id,
      audio,
      language: lang,
      quality: q,
    };
    worker.postMessage(req, [audio.buffer]);
  };

  /** रोकेपछि: बाँकी टुक्रा मात्र पठाउने, वा live पाठ नै पक्का गर्ने — after stop, finish as fast as possible. */
  const tryFinish = useCallback(
    (s: Session) => {
      if (s.busy) return; // चलिरहेको काम सकिएपछि फेरि बोलाइन्छ — called again when the running job returns
      if (s.finalSent) {
        if (s.pending.size === 0) finish(s);
        return;
      }
      const newSpeechAfterLive = s.lastVoice > s.interimTo + SAMPLE_RATE * 0.15;
      if (
        s.interim &&
        (!newSpeechAfterLive ||
          s.total - s.interimTo <= SAMPLE_RATE * REUSE_TAIL_S)
      ) {
        // Live पाठले सबै बोली समेटिसक्यो: तुरुन्तै पक्का — the live text already covers the speech: commit instantly.
        s.committed = `${s.committed} ${s.interim}`.trim();
        s.interim = '';
        finish(s);
        return;
      }
      if (s.segHasSpeech && s.total - s.segStart > SAMPLE_RATE * 0.2) {
        s.finalSent = true;
        send(s, true, s.segStart, s.total);
        return;
      }
      finish(s);
    },
    [finish],
  );

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('./whisper.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.addEventListener('message', (e: MessageEvent<VoiceResponse>) => {
        const msg = e.data;
        if (msg.type === 'loading') {
          if (!session.current)
            setState({ stage: 'loading', progress: msg.progress });
          return;
        }
        if (msg.type === 'ready') {
          setDevice(msg.device);
          setState((st) => (st.stage === 'loading' ? { stage: 'idle' } : st));
          return;
        }
        const s = session.current;
        if (msg.type === 'error') {
          if (s) {
            if (msg.id !== undefined) s.pending.delete(msg.id);
            s.busy = false;
          }
          setError(`आवाज बुझ्न सकिएन — Could not transcribe: ${msg.message}`);
          if (s?.stopping) finish(s);
          else if (!s) setState({ stage: 'idle' });
          return;
        }
        if (!s) return;
        const job = s.pending.get(msg.id);
        s.pending.delete(msg.id);
        s.busy = false;
        const text = HALLUCINATION.test(msg.text) ? '' : msg.text.trim();
        if (job?.commit) {
          if (text) s.committed = `${s.committed} ${text}`.trim();
          s.interim = '';
          s.interimTo = job.to;
        } else if (job) {
          s.interim = text;
          s.interimTo = job.to;
        }
        emit(s, false);
        if (s.stopping) tryFinish(s);
      });
      workerRef.current = worker;
    }
    return workerRef.current;
  }, [finish, tryFinish]);

  // अघिल्लो पटक voice चलाएको भए model पहिल्यै तयार राख्ने — preload the model if voice was used before.
  useEffect(() => {
    let used = false;
    try {
      used = localStorage.getItem(USED_KEY) === '1';
    } catch {
      // ignore
    }
    if (!used) return;
    const t = setTimeout(() => {
      const req: VoiceRequest = {
        type: 'warmup',
        quality: settingsRef.current.quality,
      };
      getWorker().postMessage(req);
    }, 2500);
    return () => clearTimeout(t);
  }, [getWorker]);

  useEffect(
    () => () => {
      const s = session.current;
      if (s) {
        clearInterval(s.timer);
        s.stream.getTracks().forEach((t) => t.stop());
        void s.ctx.close();
      }
      workerRef.current?.terminate();
    },
    [],
  );

  const stop = useCallback(() => {
    const s = session.current;
    if (!s || s.stopping) return;
    s.stopping = true;
    s.stream.getTracks().forEach((t) => t.stop());
    s.proc.disconnect();
    setState({ stage: 'finishing' });
    tryFinish(s);
  }, [tryFinish]);

  const tick = (s: Session) => {
    if (session.current !== s || s.stopping) return;
    const seconds = (Date.now() - s.startedAt) / 1000;
    setState({ stage: 'recording', seconds: Math.floor(seconds) });
    if (seconds >= MAX_SECONDS) {
      stop();
      return;
    }
    if (s.busy) return;
    const segLen = s.total - s.segStart;
    if (segLen < SAMPLE_RATE * 0.3) return;
    const silence = (s.total - s.lastVoice) / SAMPLE_RATE;
    if (
      s.segHasSpeech &&
      (silence >= COMMIT_SILENCE_S || segLen >= SAMPLE_RATE * MAX_SEGMENT_S)
    ) {
      // बोलाइ रोकियो: यो टुक्रा पक्का गर्ने — a pause: lock in this segment.
      const end = s.total;
      send(s, true, s.segStart, end);
      s.segStart = end;
      s.segHasSpeech = false;
      s.lastLiveAt = end;
    } else if (
      s.segHasSpeech &&
      s.total - s.lastLiveAt >= SAMPLE_RATE * LIVE_STEP_S
    ) {
      // बोल्दै गर्दा अहिलेसम्मका शब्द देखाउने — show the words so far while still speaking.
      s.lastLiveAt = s.total;
      send(s, false, s.segStart, s.total);
    } else if (!s.segHasSpeech && segLen > SAMPLE_RATE * 1.5) {
      // चुप्पीलाई फ्याँक्ने — drop silence so it is never sent.
      s.segStart = s.total;
      s.lastLiveAt = s.total;
      s.interimTo = s.total;
    }
  };

  const start = useCallback(async () => {
    setError('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setError(
        'Microphone खुलेन। Windows Settings → Privacy → Microphone मा desktop apps लाई अनुमति दिनुहोस्। — Microphone unavailable; allow desktop apps in Windows privacy settings.',
      );
      return;
    }
    store(USED_KEY, '1');
    getWorker();
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    source.connect(an);
    const proc = ctx.createScriptProcessor(1024, 1, 1);
    source.connect(proc);
    proc.connect(ctx.destination);

    const s: Session = {
      ctx,
      stream,
      proc,
      chunks: [],
      total: 0,
      segStart: 0,
      lastVoice: 0,
      segHasSpeech: false,
      lastLiveAt: 0,
      noise: 0.004,
      committed: '',
      interim: '',
      interimTo: 0,
      busy: false,
      nextId: 1,
      pending: new Map(),
      stopping: false,
      finalSent: false,
      timer: setInterval(() => tick(s), 80),
      startedAt: Date.now(),
    };
    proc.onaudioprocess = (ev) => {
      if (s.stopping) return;
      const copy = new Float32Array(ev.inputBuffer.getChannelData(0));
      s.chunks.push(copy);
      s.total += copy.length;
      let sum = 0;
      for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
      const rms = Math.sqrt(sum / copy.length);
      // पृष्ठभूमि आवाज आफैं सिक्ने, त्यसभन्दा धेरै माथिको मात्र बोली मान्ने — learn the noise floor; speech must clearly exceed it.
      if (rms < s.noise * 2.5) s.noise = s.noise * 0.9 + rms * 0.1;
      if (rms > Math.max(0.015, s.noise * 3.5)) {
        s.lastVoice = s.total;
        s.segHasSpeech = true;
      }
    };
    session.current = s;
    setAnalyser(an);
    setState({ stage: 'recording', seconds: 0 });
    onLiveRef.current('', false);
  }, [getWorker]);

  const toggle = useCallback(() => {
    if (session.current) stop();
    else if (state.stage === 'idle') void start();
  }, [start, state.stage, stop]);

  return {
    state,
    analyser,
    device,
    language,
    setLanguage: (l: VoiceLanguage) => {
      setLanguageState(l);
      store(LANG_KEY, l);
    },
    quality,
    setQuality: (q: VoiceQuality) => {
      setQualityState(q);
      store(QUALITY_KEY, q);
    },
    error,
    clearError: () => setError(''),
    toggle,
  };
}
