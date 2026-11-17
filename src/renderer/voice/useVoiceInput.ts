import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceRequest, VoiceResponse } from './whisper.worker';

export type VoiceLanguage = 'nepali' | 'english';
export type VoiceState =
  | { stage: 'idle' }
  | { stage: 'recording'; seconds: number }
  | { stage: 'loading'; progress: number }
  | { stage: 'transcribing' };

const LANG_KEY = 'studio.voiceLanguage';
const MAX_SECONDS = 60;

function savedLanguage(): VoiceLanguage {
  try {
    return localStorage.getItem(LANG_KEY) === 'english' ? 'english' : 'nepali';
  } catch {
    return 'nepali';
  }
}

/**
 * 🎤 बटनको logic: mic बाट रेकर्ड गर्ने, अनि Whisper ले नेपाली/English अक्षरमा बदल्ने।
 * Mic button logic: record from the microphone, then turn speech into Nepali/English text with Whisper.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>({ stage: 'idle' });
  const [language, setLanguageState] = useState<VoiceLanguage>(savedLanguage);
  const [error, setError] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const setLanguage = (lang: VoiceLanguage) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // ignore
    }
  };

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('./whisper.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.addEventListener('message', (e: MessageEvent<VoiceResponse>) => {
        const msg = e.data;
        if (msg.type === 'loading')
          setState({ stage: 'loading', progress: msg.progress });
        else if (msg.type === 'ready') setState({ stage: 'transcribing' });
        else if (msg.type === 'result') {
          setState({ stage: 'idle' });
          if (msg.text) onTextRef.current(msg.text);
          else
            setError(
              'केही सुनिएन, फेरि बोल्नुहोस् · Nothing heard, please try again',
            );
        } else {
          setState({ stage: 'idle' });
          setError(`आवाज बुझ्न सकिएन — Could not transcribe: ${msg.message}`);
        }
      });
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      workerRef.current?.terminate();
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState({ stage: 'transcribing' });
      try {
        // Whisper लाई 16kHz mono आवाज चाहिन्छ — Whisper expects 16 kHz mono audio.
        const ctx = new AudioContext({ sampleRate: 16000 });
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        const audio = decoded.getChannelData(0).slice();
        await ctx.close();
        const req: VoiceRequest = { type: 'transcribe', audio, language };
        getWorker().postMessage(req, [audio.buffer]);
      } catch (err) {
        setState({ stage: 'idle' });
        setError(
          `आवाज पढ्न सकिएन — Could not read the recording: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [getWorker, language],
  );

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        'Microphone खुलेन। Windows Settings → Privacy → Microphone मा desktop apps लाई अनुमति दिनुहोस्। — Microphone unavailable; allow desktop apps in Windows privacy settings.',
      );
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      void transcribe(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setState({ stage: 'recording', seconds: 0 });
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (seconds >= MAX_SECONDS) stop();
      else setState({ stage: 'recording', seconds });
    }, 250);
    // पहिले नै model तयार गर्न worker सुरु गर्ने — warm up the worker while the user speaks.
    getWorker();
  }, [getWorker, stop, transcribe]);

  const toggle = useCallback(() => {
    if (state.stage === 'recording') stop();
    else if (state.stage === 'idle') void start();
  }, [start, state.stage, stop]);

  return {
    state,
    language,
    setLanguage,
    error,
    clearError: () => setError(''),
    toggle,
  };
}
