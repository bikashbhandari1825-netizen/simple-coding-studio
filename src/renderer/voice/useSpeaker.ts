import { useCallback, useEffect, useRef, useState } from 'react';
import { markdownToSpeech } from '../lib/speechText';

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
  const currentId = useRef<string | null>(null);

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
      } else if (ev.type === 'word') {
        setPulse((p) => p + 1);
      } else if (ev.type === 'end') {
        currentId.current = null;
        setSpeakingId(null);
        setLoadingId(null);
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
    setSpeakingId(null);
    setLoadingId(null);
    void window.studio.stopSpeaking();
  }, []);

  const toggle = useCallback(
    async (id: string, markdown: string) => {
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
      const chunks = markdownToSpeech(markdown);
      if (!chunks.length) return;
      currentId.current = id;
      setLoadingId(id);
      setSpeakingId(null);
      try {
        await window.studio.speak(id, chunks, 1, gender);
      } catch (err) {
        currentId.current = null;
        setLoadingId(null);
        setError(
          `आवाज सुरु भएन — Could not start the voice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [available, gender, stop],
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
    toggle,
    stop,
  };
}
