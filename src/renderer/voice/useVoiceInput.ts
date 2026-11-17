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
  | { stage: 'recording'; seconds: number };

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 120;
/** यति चुप रहेपछि टुक्रा पक्का गर्ने — commit a segment after this much silence. */
const COMMIT_SILENCE_S = 0.7;
/** छोटो टुक्रा = छिटो — split long speech so each pass stays fast. */
const MAX_SEGMENT_S = 5;
/** बोल्दै गर्दा नयाँ शब्द देखाउने अन्तराल — refresh live words this often while speaking. */
const LIVE_STEP_S = 0.35;
/** बोली सुरु हुनुअघिको यति आवाज पनि राख्ने (पहिलो अक्षर नकाटियोस्) — keep this much audio before speech starts. */
const PRE_ROLL_S = 0.5;
/** बोली मान्ने न्यूनतम स्तर (laptop mic मा बिस्तारै बोल्दा पनि) — minimum level counted as speech, low enough for quiet voices. */
const MIN_SPEECH_RMS = 0.0035;

const LANG_KEY = 'studio.voiceLanguage';
const QUALITY_KEY = 'studio.voiceQuality';

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
  /^\s*(\[.*\]|\(.*\)|thank you\.?|thanks\.?|thanks for watching\.?|you|bye\.?|\.+|।+|धन्यवाद[।!.]?)\s*$/i;

interface Job {
  session: Session;
  kind: 'live' | 'commit';
  to: number;
  /** commit भएको टुक्राको क्रम — order of the committed segment */
  index?: number;
}

interface Session {
  ctx: AudioContext;
  stream: MediaStream;
  proc: ScriptProcessorNode;
  chunks: Float32Array[];
  total: number;
  segStart: number;
  lastVoice: number;
  segHasSpeech: boolean;
  lastLiveAt: number;
  noise: number;
  /** पक्का भएका टुक्राहरू (क्रम अनुसार) — committed segment texts, in order */
  segments: string[];
  interim: string;
  interimTo: number;
  liveBusy: boolean;
  openJobs: number;
  stopped: boolean;
  /** रोक्दा box मा राखिएको पाठ — the text placed in the box at stop time */
  shownAtStop: string | null;
  timer: ReturnType<typeof setInterval>;
  startedAt: number;
}

/**
 * 🎤 Live voice typing (Whisper, GPU)।
 * - बोल्दै गर्दा शब्दहरू box मा आउँछन् (⚡ छिटो model ले)।
 * - 🎤 रोक्नासाथ (≈0s) पाठ box मा रहन्छ र mic मुक्त हुन्छ; अन्तिम सुधार पछाडि हुन्छ।
 *
 * - Words appear while you speak (using the fast model).
 * - Pressing 🎤 again stops instantly: the text stays in the box and the mic is free; the final
 *   clean-up runs in the background and only replaces the text if you have not changed it.
 *
 * onLive(text) — बोल्दै गर्दाको पूरा पाठ — the full dictated text while recording.
 * onFinal(shown, better) — रोकेपछिको सुधारिएको पाठ — improved text after stopping.
 */
export function useVoiceInput(
  onLive: (text: string) => void,
  onFinal: (shown: string, better: string) => void,
) {
  const [state, setState] = useState<VoiceState>({ stage: 'idle' });
  const [language, setLanguageState] = useState<VoiceLanguage>(() =>
    stored(LANG_KEY, ['nepali', 'english'] as const, 'nepali'),
  );
  const [quality, setQualityState] = useState<VoiceQuality>(() =>
    stored(QUALITY_KEY, ['fast', 'accurate'] as const, 'fast'),
  );
  const [device, setDevice] = useState<'webgpu' | 'wasm' | null>(null);
  /** model कति तयार (null = तयार) — model download/load progress; null once ready */
  const [modelProgress, setModelProgress] = useState<number | null>(0);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState('');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const cbRef = useRef({ onLive, onFinal });
  cbRef.current = { onLive, onFinal };
  const settingsRef = useRef({ language, quality });
  settingsRef.current = { language, quality };
  const session = useRef<Session | null>(null);
  const jobs = useRef(new Map<number, Job>());
  const nextId = useRef(1);
  const readyModels = useRef(new Set<VoiceQuality>());

  const textOf = (s: Session, withInterim: boolean) =>
    [...s.segments, withInterim ? s.interim : '']
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

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

  const send = (
    s: Session,
    kind: Job['kind'],
    from: number,
    to: number,
    index?: number,
  ) => {
    const worker = workerRef.current;
    if (!worker) return;
    const audio = slice(s, from, to);
    const id = nextId.current++;
    jobs.current.set(id, { session: s, kind, to, index });
    s.openJobs++;
    if (kind === 'live') s.liveBusy = true;
    const { language: lang, quality: q } = settingsRef.current;
    // Live शब्द सधैं छिटो model ले; पक्का गर्ने काम छानिएको model ले — live words always use the fast model.
    const req: VoiceRequest = {
      type: 'transcribe',
      id,
      audio,
      language: lang,
      quality: kind === 'live' ? 'fast' : q,
    };
    worker.postMessage(req, [audio.buffer]);
  };

  /**
   * टुक्रा पक्का गर्ने। ⚡ मोडमा live नतिजा (सकिएको वा GPU मा चलिरहेको) ले टुक्राको अन्त्यसम्म समेटेको भए फेरि नचलाउने।
   * Commit a segment. In fast mode, reuse the live result (finished or still running on the GPU)
   * when it already covers the segment, instead of transcribing the same audio again.
   */
  const commitSegment = (s: Session, from: number, end: number) => {
    const index = s.segments.length;
    s.segments.push(s.interim); // नतिजा नआउन्जेल live पाठ देखाउने — show the live text until the result arrives
    const near = end - Math.round(SAMPLE_RATE * 0.3);
    if (settingsRef.current.quality === 'fast') {
      for (const job of jobs.current.values()) {
        if (
          job.session === s &&
          job.kind === 'live' &&
          job.to >= near &&
          job.to <= end
        ) {
          // चलिरहेको live काम नै अन्तिम बन्छ — the running live job becomes the final one.
          job.kind = 'commit';
          job.index = index;
          s.liveBusy = false;
          s.interim = '';
          return;
        }
      }
      if (s.interim && s.interimTo >= near) {
        s.interim = ''; // live पाठ नै पक्का — the live text is final as is
        return;
      }
    }
    send(s, 'commit', from, end, index);
    s.interim = '';
  };

  /** रोकिएको session को सबै काम सकिएपछि सुधारिएको पाठ पठाउने — deliver the improved text once a stopped session is done. */
  const maybeDeliver = (s: Session) => {
    if (!s.stopped || s.openJobs > 0 || s.shownAtStop === null) return;
    const better = textOf(s, false) || s.shownAtStop;
    cbRef.current.onFinal(s.shownAtStop, better);
    s.shownAtStop = null;
    setRefining(false);
  };

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('./whisper.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.addEventListener('message', (e: MessageEvent<VoiceResponse>) => {
        const msg = e.data;
        if (msg.type === 'loading') {
          setModelProgress(msg.progress);
          return;
        }
        if (msg.type === 'ready') {
          readyModels.current.add(msg.quality);
          setDevice(msg.device);
          setModelProgress(null);
          return;
        }
        const job = msg.id !== undefined ? jobs.current.get(msg.id) : undefined;
        if (msg.id !== undefined) jobs.current.delete(msg.id);
        if (msg.type === 'error') {
          setError(`आवाज बुझ्न सकिएन — Could not transcribe: ${msg.message}`);
          if (job) {
            job.session.openJobs--;
            if (job.kind === 'live') job.session.liveBusy = false;
            maybeDeliver(job.session);
          }
          return;
        }
        if (!job) return;
        const s = job.session;
        s.openJobs--;
        const text = HALLUCINATION.test(msg.text) ? '' : msg.text.trim();
        if (job.kind === 'commit' && job.index !== undefined) {
          s.segments[job.index] = text;
          if (s.interimTo <= job.to) s.interim = '';
        } else if (job.kind === 'live') {
          s.liveBusy = false;
          if (!s.stopped && job.to > s.interimTo) {
            s.interim = text;
            s.interimTo = job.to;
          }
        }
        if (!s.stopped) cbRef.current.onLive(textOf(s, true));
        maybeDeliver(s);
      });
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  // App खुल्नासाथ model तयार राख्ने ताकि 🎤 थिच्दा पर्खनु नपरोस् — preload the models when the app opens.
  useEffect(() => {
    const t = setTimeout(() => {
      const w = getWorker();
      const warm = (q: VoiceQuality) =>
        w.postMessage({ type: 'warmup', quality: q } satisfies VoiceRequest);
      warm('fast');
      if (settingsRef.current.quality === 'accurate') warm('accurate');
    }, 1500);
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

  const tick = (s: Session) => {
    if (session.current !== s) return;
    const seconds = (Date.now() - s.startedAt) / 1000;
    setState({ stage: 'recording', seconds: Math.floor(seconds) });
    if (seconds >= MAX_SECONDS) {
      stop();
      return;
    }
    const segLen = s.total - s.segStart;
    const silence = (s.total - s.lastVoice) / SAMPLE_RATE;
    if (
      s.segHasSpeech &&
      segLen > SAMPLE_RATE * 0.3 &&
      (silence >= COMMIT_SILENCE_S || segLen >= SAMPLE_RATE * MAX_SEGMENT_S)
    ) {
      // बोलाइ रोकियो: यो टुक्रा पक्का गर्ने (live काम पर्खनु पर्दैन) — a pause: lock in this segment.
      const end = s.total;
      commitSegment(s, s.segStart, end);
      s.interimTo = end;
      s.segStart = end;
      s.segHasSpeech = false;
      s.lastLiveAt = end;
      return;
    }
    if (
      !s.liveBusy &&
      s.segHasSpeech &&
      s.total - s.lastLiveAt >= SAMPLE_RATE * LIVE_STEP_S
    ) {
      // बोल्दै गर्दा अहिलेसम्मका शब्द देखाउने — show the words so far while still speaking.
      s.lastLiveAt = s.total;
      send(s, 'live', s.segStart, s.total);
      return;
    }
    if (!s.segHasSpeech && segLen > SAMPLE_RATE * 2) {
      // लामो चुप्पी फ्याँक्ने, तर अन्तिम आधा सेकेन्ड राख्ने — drop long silence but keep a short pre-roll.
      s.segStart = Math.max(
        s.segStart,
        s.total - Math.round(SAMPLE_RATE * PRE_ROLL_S),
      );
      s.lastLiveAt = s.segStart;
    }
  };

  /** 🎤 फेरि थिच्दा तुरुन्तै रोक्ने — stop instantly; the clean-up continues in the background. */
  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    s.proc.disconnect();
    s.stopped = true;
    session.current = null;
    setAnalyser(null);
    setState({ stage: 'idle' });
    void s.ctx.close();

    // बाँकी टुक्रा पक्का गर्न पठाउने — send the unfinished tail for a final pass.
    if (s.segHasSpeech && s.total - s.segStart > SAMPLE_RATE * 0.25) {
      commitSegment(s, s.segStart, s.total);
    }
    s.shownAtStop = textOf(s, true);
    cbRef.current.onLive(s.shownAtStop);
    if (s.openJobs > 0) setRefining(true);
    maybeDeliver(s);
  }, []);

  const start = useCallback(async () => {
    setError('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // noiseSuppression बन्द: Windows को noise-suppression ले बिस्तारै बोलेको आवाज पनि काट्छ।
        // Noise suppression off: it tends to clip quiet speech; echo cancellation and auto gain stay on.
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
    } catch {
      setError(
        'Microphone खुलेन। Windows Settings → Privacy → Microphone मा desktop apps लाई अनुमति दिनुहोस्। — Microphone unavailable; allow desktop apps in Windows privacy settings.',
      );
      return;
    }
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
      noise: 0.002,
      segments: [],
      interim: '',
      interimTo: 0,
      liveBusy: false,
      openJobs: 0,
      stopped: false,
      shownAtStop: null,
      timer: setInterval(() => tick(s), 60),
      startedAt: Date.now(),
    };
    proc.onaudioprocess = (ev) => {
      if (s.stopped) return;
      const copy = new Float32Array(ev.inputBuffer.getChannelData(0));
      s.chunks.push(copy);
      s.total += copy.length;
      let sum = 0;
      for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
      const rms = Math.sqrt(sum / copy.length);
      const threshold = Math.max(MIN_SPEECH_RMS, s.noise * 2.2);
      if (rms > threshold) {
        s.lastVoice = s.total;
        s.segHasSpeech = true;
      } else {
        // चुप्पीको बेला मात्र पृष्ठभूमि आवाज सिक्ने — learn the background level only from quiet frames.
        s.noise = s.noise * 0.95 + rms * 0.05;
      }
    };
    session.current = s;
    setAnalyser(an);
    setState({ stage: 'recording', seconds: 0 });
    cbRef.current.onLive('');
  }, [getWorker]);

  const toggle = useCallback(() => {
    if (session.current) stop();
    else void start();
  }, [start, stop]);

  return {
    state,
    analyser,
    device,
    modelProgress,
    refining,
    language,
    setLanguage: (l: VoiceLanguage) => {
      setLanguageState(l);
      store(LANG_KEY, l);
    },
    quality,
    setQuality: (q: VoiceQuality) => {
      setQualityState(q);
      store(QUALITY_KEY, q);
      if (!readyModels.current.has(q))
        getWorker().postMessage({
          type: 'warmup',
          quality: q,
        } satisfies VoiceRequest);
    },
    error,
    clearError: () => setError(''),
    toggle,
  };
}
