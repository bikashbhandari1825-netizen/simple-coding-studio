// 💧 थिच्दा पानीको लहर जस्तो ripple — a ripple on every button press, from one global listener.
// Ripple effect for every button: one listener for the whole app, nothing to add per button.

const TARGET = 'button, [role="radio"], .chip';

export function installRipple(): void {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGET);
      if (
        !el ||
        el.hasAttribute('disabled') ||
        el.dataset.noRipple !== undefined
      )
        return;
      // Monaco का भित्री बटनहरू नछुने — leave Monaco's own controls alone.
      if (el.closest('.monaco-editor')) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      el.classList.add('ripple-host');
      // पहिल्यै absolute/fixed भएका बटनको स्थान नबिगार्ने — keep absolutely positioned buttons where they are.
      if (getComputedStyle(el).position === 'static')
        el.classList.add('ripple-pos');
      const dot = document.createElement('span');
      dot.className = 'ripple';
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - rect.left - size / 2}px`;
      dot.style.top = `${e.clientY - rect.top - size / 2}px`;
      el.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove(), { once: true });
      setTimeout(() => dot.remove(), 900);
    },
    { capture: true, passive: true },
  );
}
