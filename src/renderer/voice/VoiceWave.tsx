import { useEffect, useRef } from 'react';

/**
 * बोल्दा हल्लिने आवाजको तरंग: बिस्तारै बोल्दा सानो, ठूलो बोल्दा ठूलो।
 * Live sound waves that follow the voice: small when quiet, tall when loud.
 */
export function VoiceWave({
  analyser,
  height = 40,
}: {
  analyser: AnalyserNode | null;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const freq = new Uint8Array(analyser.frequencyBinCount);
    const wave = new Uint8Array(analyser.fftSize);
    const BARS = 36;
    const levels = new Float32Array(BARS);
    let frame = 0;
    let t = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(wave);
      // समग्र आवाजको चर्कोपन — overall loudness (RMS of the waveform).
      let sum = 0;
      for (let i = 0; i < wave.length; i++) {
        const v = (wave[i] - 128) / 128;
        sum += v * v;
      }
      const loud = Math.min(1, Math.sqrt(sum / wave.length) * 6);

      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, '#4f8cff');
      gradient.addColorStop(0.5, '#a66cff');
      gradient.addColorStop(1, '#ff6fa8');
      ctx.fillStyle = gradient;

      t += 0.06;
      const gap = 3;
      const barW = Math.max(2, (w - gap * (BARS - 1)) / BARS);
      const usable = Math.floor(freq.length * 0.55); // बोलीका आवृत्ति मात्र — speech frequencies only
      for (let i = 0; i < BARS; i++) {
        // बीचमा अग्लो, किनारमा होचो — tallest in the middle, like a voice ribbon.
        const mirror = i < BARS / 2 ? i : BARS - 1 - i;
        const bin = Math.floor((mirror / (BARS / 2)) * usable);
        const f = freq[bin] / 255;
        const idle = 0.06 + 0.04 * Math.sin(t + i * 0.5); // चुप हुँदा पनि हल्का सास फेर्ने — gentle idle motion
        const target = Math.max(
          idle,
          f * 0.7 + loud * 0.6 * (0.6 + 0.4 * Math.sin(t * 2 + i)),
        );
        levels[i] += (Math.min(1, target) - levels[i]) * 0.35; // चिल्लो चाल — smooth easing
        const barH = Math.max(3, levels[i] * h);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        const r = Math.min(barW / 2, barH / 2);
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, r);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
      aria-hidden="true"
    />
  );
}
