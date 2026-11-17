import { createRoot } from 'react-dom/client';
import './index.css';

// चरण ० को परीक्षण स्क्रिन। चरण १ मा तपाईं यसलाई आफैं टाइप गरेर बदल्नुहुनेछ।
// Stage 0 test screen. In Stage 1 you will replace this by typing it yourself.
function SetupCheck() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-900 text-slate-100">
      <h1 className="text-3xl font-bold">Simple Coding Studio</h1>
      <p className="text-lg">✅ चरण ० पूरा भयो! — Stage 0 complete!</p>
      <p className="text-sm text-slate-400">Electron + React + TypeScript + Tailwind</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<SetupCheck />);
