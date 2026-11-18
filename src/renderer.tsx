import { createRoot } from 'react-dom/client';
import './index.css';
import './renderer/monacoSetup';
import App from './renderer/App';
import { installRipple } from './renderer/ripple';

installRipple();

createRoot(document.getElementById('root')!).render(<App />);
