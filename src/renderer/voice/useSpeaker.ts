import { useCallback, useEffect, useRef, useState } from 'react';
import { markdownToSpeech, unitsToSpeech } from '../lib/speechText';

/**
 * 🔊 Guru को जवाफ पढ्ने: एकपटकमा एउटा मात्र; उही बटन फेरि थिच्दा रोकिन्छ।
 * Read Guru's answers aloud: one at a time; pressing the same button again stops it.
 */
export function useSpeaker() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  /** हरेक शब्द बोल्दा बढ्ने — increments on every spoken word (drives the waveform) */
  const [pulse, setPulse] = useState(0);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState('');
  const [gender, setGenderState] = useState<'female' | 'male'>(() => {
    try {
      return localStorage.getItem('studio.speakerVoice') === 'male'
        ? 'male'
        : 'female';
    } catch {
      return 'female';
    }
  });
  // 🇳🇵 नेपाली आवाज: Google (Translate जस्तै प्राकृतिक) वा Microsoft हेमकला — Nepali voice engine.
  const [engine, setEngineState] = useState<'google' | 'microsoft'>(() => {
    try {
      return localStorage.getItem('studio.speakerNeEngine') === 'microsoft'
        ? 'microsoft'
        : 'google';
    } catch {
      return 'google';
    }
  });
  const currentId = useRef<string | null>(null);
  // 🎵 कुन आवाज कुन लाइनको हो, र अहिले कुन लाइन बोलिँदैछ — which line each chunk belongs to, and the line being spoken now
  const unitMap = useRef<number[]>([]);
  const playSeq = useRef(0);
  const [activeUnit, setActiveUnit] = useState<number | null>(null);

  // App खुलेपछि लुकेको Edge पहिल्यै तयार राख्ने — get the hidden Edge window ready early.
  useEffect(() => {
    const t = setTimeout(() => {
      window.studio
        .speakerAvailable()
        .then((ok) => {
          setAvailable(ok);
          return ok ? window.studio.speakerPrepare() : undefined;
        })
        .catch(() => undefined);
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const off = window.studio.onSpeakerEvent((ev) => {
      if (!ev.id || ev.id !== currentId.current) return;
      if (ev.type === 'start' || ev.type === 'chunk') {
        setLoadingId(null);
        setSpeakingId(ev.id);
        if (ev.type === 'chunk' && typeof ev.index === 'number') {
          const u = unitMap.current[ev.index];
          setActiveUnit(u !== undefined && u >= 0 ? u : null);
        }
      } else if (ev.type === 'word') {
        setPulse((p) => p + 1);
      } else if (ev.type === 'end') {
        currentId.current = null;
        setSpeakingId(null);
        setLoadingId(null);
        setActiveUnit(null);
      } else if (ev.type === 'error' && ev.error) {
        setError(
          `आवाज बजाउन सकिएन (${ev.error}) — Could not play the voice (${ev.error}).`,
        );
      }
    });
    return () => off();
  }, []);

  const stop = useCallback(() => {
    currentId.current = null;
    unitMap.current = [];
    setSpeakingId(null);
    setLoadingId(null);
    setActiveUnit(null);
    void window.studio.stopSpeaking();
  }, []);

  /**
   * 🎵 देखिएका लाइनहरूबाट पढ्ने। `from` लाइनबाट सुरु हुन्छ — Spotify मा गीतको लाइन थिचेजस्तै।
   * Speak the displayed lines starting from line `from`. `base` names the button (the id gets a counter so old events never mix in).
   * `restart` = true (a tap on a line): always start again from that line. false (a button): a second press stops.
   */
  const playUnits = useCallback(
    async (
      base: string,
      units: string[],
      opts: {
        from?: number;
        only?: 'ne-NP' | 'en-US';
        note?: string;
        restart?: boolean;
      } = {},
    ): Promise<'started' | 'stopped' | 'empty' | 'failed'> => {
      setError('');
      const speakingThis = currentId.current?.startsWith(`${base}#`) ?? false;
      if (speakingThis && !opts.restart) {
        stop();
        return 'stopped';
      }
      if (!available) {
        setError(
          'आवाजमा पढ्न Microsoft Edge चाहिन्छ। — Reading aloud needs Microsoft Edge.',
        );
        return 'failed';
      }
      const { chunks, unitOf } = unitsToSpeech(
        units,
        opts.from ?? 0,
        opts.only,
        opts.note,
      );
      if (!chunks.length) return 'empty';
      // नयाँ पढाइले पुरानोलाई आफैं बदल्छ (speaker ले एउटा मात्र चलाउँछ) — a new reading replaces the old one by itself
      const id = `${base}#${++playSeq.current}`;
      currentId.current = id;
      unitMap.current = unitOf;
      setLoadingId(id);
      setSpeakingId(null);
      setActiveUnit(null);
      try {
        await window.studio.speak(id, chunks, 1, gender, engine);
        return 'started';
      } catch (err) {
        currentId.current = null;
        setLoadingId(null);
        setError(
          `आवाज सुरु भएन — Could not start the voice: ${err instanceof Error ? err.message : String(err)}`,
        );
        return 'failed';
      }
    },
    [available, gender, engine, stop],
  );

  const toggle = useCallback(
    async (id: string, markdown: string, only?: 'ne-NP' | 'en-US') => {
      setError('');
      if (currentId.current === id) {
        stop();
        return;
      }
      if (!available) {
        setError(
          'आवाजमा पढ्न Microsoft Edge चाहिन्छ। — Reading aloud needs Microsoft Edge.',
        );
        return;
      }
      // "नेपाली मात्र" वा "English मात्र" — optionally keep just one language.
      const chunks = markdownToSpeech(markdown).filter(
        (c) => !only || c.lang === only,
      );
      if (!chunks.length) {
        setError(
          only === 'en-US'
            ? 'यो जवाफमा English भाग छैन। — This answer has no English part.'
            : only === 'ne-NP'
              ? 'यो जवाफमा नेपाली भाग छैन। — This answer has no Nepali part.'
              : '',
        );
        return;
      }
      currentId.current = id;
      setLoadingId(id);
      setSpeakingId(null);
      try {
        await window.studio.speak(id, chunks, 1, gender, engine);
      } catch (err) {
        currentId.current = null;
        setLoadingId(null);
        setError(
          `आवाज सुरु भएन — Could not start the voice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [available, gender, engine, stop],
  );

  return {
    speakingId,
    loadingId,
    pulse,
    error,
    clearError: () => setError(''),
    gender,
    setGender: (g: 'female' | 'male') => {
      setGenderState(g);
      try {
        localStorage.setItem('studio.speakerVoice', g);
      } catch {
        // ignore
      }
    },
    engine,
    setEngine: (e: 'google' | 'microsoft') => {
      setEngineState(e);
      try {
        localStorage.setItem('studio.speakerNeEngine', e);
      } catch {
        // ignore
      }
    },
    toggle,
    playUnits,
    activeUnit,
    stop,
  };
}
