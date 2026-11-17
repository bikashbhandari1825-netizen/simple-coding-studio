import { useEffect, useRef } from 'react';

/**
 * Guru बोल्दा हल्लिने रंगीन तरंग; हरेक शब्दमा उफ्रन्छ।
 * The colourful wave shown while Guru speaks; it jumps on every spoken word.
 */
export function SpeakWave({
  pulse,
  width = 64,
  height = 18,
}: {
  pulse: number;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energy = useRef(0.6);

  // नयाँ शब्द = नयाँ ऊर्जा — each new word adds energy.
  useEffect(() => {
    energy.current = Math.min(1, energy.current + 0.55);
  }, [pulse]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const BARS = 9;
    const levels = new Float32Array(BARS);
    let t = 0;
    let frame = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const g = ctx.createLinearGradient(0, 0, width, 0);
      g.addColorStop(0, '#4f8cff');
      g.addColorStop(0.5, '#a66cff');
      g.addColorStop(1, '#ff6fa8');
      ctx.fillStyle = g;
      t += 0.12;
      energy.current = Math.max(0.25, energy.current * 0.94);
      const gap = 2;
      const barW = (width - gap * (BARS - 1)) / BARS;
      for (let i = 0; i < BARS; i++) {
        const centre = 1 - Math.abs(i - (BARS - 1) / 2) / BARS;
        const target =
          energy.current * centre * (0.55 + 0.45 * Math.sin(t * 1.7 + i * 1.3));
        levels[i] += (target - levels[i]) * 0.3;
        const h = Math.max(2, levels[i] * height);
        ctx.beginPath();
        ctx.roundRect(i * (barW + gap), (height - h) / 2, barW, h, barW / 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [width, height]);

  return (
    <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />
  );
}
