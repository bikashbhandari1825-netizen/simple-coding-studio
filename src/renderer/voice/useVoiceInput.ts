import { useCallback, useEffect, useRef, useState } from 'react';

// 🎤 Voice typing: Web Speech API (webkitSpeechRecognition), नेपाली ne-NP / English en-US।
// Electron भित्र यो API ले "network" error दिन्छ, त्यसैले यसलाई Chrome/Edge को लुकेको window मा चलाइन्छ
// (main-process/cloudDictation.ts), र शब्दहरू बोल्दै गर्दा नै यहाँ आउँछन्।
// यहाँ mic बाट waveform का लागि आवाजको स्तर मात्र पढिन्छ: रेकर्ड वा प्रशोधन गरिँदैन।
//
// Voice typing uses the Web Speech API (ne-NP / en-US). It fails inside Electron, so it runs in a hidden
// Chrome/Edge window and streams words back while you speak. Here the mic is only read for the waveform:
// nothing is recorded or processed locally.

export type VoiceLanguage = 'nepali' | 'english';
export type VoiceState =
  | { stage: 'idle' }
  | { stage: 'recording'; seconds: number };

const MAX_SECONDS = 180;
/** रोकेपछि अन्तिम शब्द यति बेरसम्म पर्खने — wait this long for the last words after stopping. */
const END_WAIT_MS = 2000;
/** यो भन्दा कम चर्को भए "mic को आवाज सानो" चेतावनी — warn about a quiet mic below this level. */
const QUIET_MIC_RMS = 0.01;
const LANG_KEY = 'studio.voiceLanguage';

function storedLanguage(): VoiceLanguage {
  try {
    return localStorage.getItem(LANG_KEY) === 'english' ? 'english' : 'nepali';
  } catch {
    return 'nepali';
  }
}

interface Session {
  stream: MediaStream;
  ctx: AudioContext;
  finals: string[];
  interim: string;
  maxRms: number;
  stopped: boolean;
  /** रोक्दा box मा राखिएको पाठ — the text placed in the box at stop time */
  shownAtStop: string | null;
  timer: ReturnType<typeof setInterval>;
  meter: ReturnType<typeof setInterval>;
  startedAt: number;
}

const joined = (s: Session) =>
  [...s.finals, s.interim]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ');

/**
 * onLive(text) — बोल्दै गर्दाको पूरा पाठ — the full dictated text while recording.
 * onFinal(shown, better) — रोकेपछि आएको अन्तिम पाठ — the final text that arrives after stopping.
 */
export function useVoiceInput(
  onLive: (text: string) => void,
  onFinal: (shown: string, better: string) => void,
) {
  const [state, setState] = useState<VoiceState>({ stage: 'idle' });
  const [language, setLanguageState] = useState<VoiceLanguage>(storedLanguage);
  /** लुकेको browser तयार छ कि — whether the hidden browser is connected and ready */
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);
  const [quietMic, setQuietMic] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState('');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const cbRef = useRef({ onLive, onFinal });
  cbRef.current = { onLive, onFinal };
  const languageRef = useRef(language);
  languageRef.current = language;
  const session = useRef<Session | null>(null);
  const closing = useRef<Session | null>(null);

  const deliver = (s: Session) => {
    if (s.shownAtStop === null) return;
    cbRef.current.onFinal(s.shownAtStop, joined(s) || s.shownAtStop);
    s.shownAtStop = null;
    if (closing.current === s) closing.current = null;
    setRefining(false);
  };

  // App खुल्नासाथ लुकेको browser तयार राख्ने — start the hidden browser as soon as the app opens.
  useEffect(() => {
    const t = setTimeout(() => {
      window.studio
        .dictationAvailable()
        .then((ok) => {
          setAvailable(ok);
          return ok
            ? window.studio.dictationPrepare().then(() => setReady(true))
            : undefined;
        })
        .catch(() => setReady(false));
    }, 800);
    return () => clearTimeout(t);
  }, []);

  // बोल्दै गर्दा आउने शब्दहरू — words streaming in from the speech service.
  useEffect(() => {
    const off = window.studio.onDictationEvent((ev) => {
      if (ev.type === 'ready') setReady(true);
      const s = session.current ?? closing.current;
      if (!s) return;
      if (ev.type === 'interim') {
        s.interim = ev.text ?? '';
      } else if (ev.type === 'final') {
        if (ev.text?.trim()) s.finals.push(ev.text.trim());
        s.interim = '';
      } else if (ev.type === 'error') {
        const e = ev.error ?? '';
        setError(
          e === 'network'
            ? 'Internet जडान भएन, आवाज बुझ्न सकिएन। — No internet connection; speech could not be recognised.'
            : e === 'not-allowed' ||
                e === 'audio-capture' ||
                e === 'service-not-allowed'
              ? 'Browser ले mic प्रयोग गर्न पाएन। Windows Settings → Privacy → Microphone मा अनुमति दिनुहोस्। — The browser could not use the microphone; allow it in Windows privacy settings.'
              : e === 'language-not-supported'
                ? 'यो भाषा समर्थित भएन। — This language is not supported.'
                : `आवाज पहिचानमा समस्या (${e}) — Speech recognition error (${e}).`,
        );
      } else if (ev.type === 'end' && s.stopped) {
        deliver(s);
        return;
      }
      if (!s.stopped) cbRef.current.onLive(joined(s));
      else if (ev.type === 'final') deliver(s);
    });
    return () => off();
  }, []);

  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    s.stopped = true;
    clearInterval(s.timer);
    clearInterval(s.meter);
    s.stream.getTracks().forEach((t) => t.stop());
    void s.ctx.close();
    setAnalyser(null);
    setState({ stage: 'idle' });
    void window.studio.dictationStop();
    // रोक्नासाथ अहिलेसम्मको पाठ box मा — the text so far stays in the box immediately.
    s.shownAtStop = joined(s);
    cbRef.current.onLive(s.shownAtStop);
    closing.current = s;
    setRefining(true);
    setTimeout(() => deliver(s), END_WAIT_MS);
  }, []);

  const start = useCallback(async () => {
    setError('');
    if (!available) {
      setError(
        'Voice typing का लागि Chrome वा Edge चाहिन्छ। — Voice typing needs Chrome or Edge installed.',
      );
      return;
    }
    let stream: MediaStream;
    try {
      // Waveform का लागि मात्र, कुनै प्रशोधन बिना — for the waveform only, no processing.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      setError(
        'Microphone खुलेन। Windows Settings → Privacy → Microphone मा desktop apps लाई अनुमति दिनुहोस्। — Microphone unavailable; allow desktop apps in Windows privacy settings.',
      );
      return;
    }
    try {
      await window.studio.dictationStart(
        languageRef.current === 'english' ? 'en-US' : 'ne-NP',
      );
      setReady(true);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setError(
        `Voice typing सुरु भएन (Chrome/Edge खुलेन)। फेरि 🎤 थिच्नुहोस्। — Voice typing could not start: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const s: Session = {
      stream,
      ctx,
      finals: [],
      interim: '',
      maxRms: 0,
      stopped: false,
      shownAtStop: null,
      startedAt: Date.now(),
      timer: setInterval(() => {
        const seconds = (Date.now() - s.startedAt) / 1000;
        setState({ stage: 'recording', seconds: Math.floor(seconds) });
        if (seconds > 2.5) setQuietMic(s.maxRms < QUIET_MIC_RMS);
        if (seconds >= MAX_SECONDS) stop();
      }, 250),
      meter: setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        s.maxRms = Math.max(s.maxRms, Math.sqrt(sum / buf.length));
      }, 100),
    };
    session.current = s;
    setAnalyser(an);
    setQuietMic(false);
    setState({ stage: 'recording', seconds: 0 });
    cbRef.current.onLive('');
  }, [available, stop]);

  const toggle = useCallback(() => {
    if (session.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(
    () => () => {
      if (session.current) stop();
    },
    [stop],
  );

  return {
    state,
    analyser,
    ready,
    available,
    quietMic,
    refining,
    language,
    setLanguage: (l: VoiceLanguage) => {
      setLanguageState(l);
      try {
        localStorage.setItem(LANG_KEY, l);
      } catch {
        // ignore
      }
    },
    error,
    clearError: () => setError(''),
    toggle,
  };
}
