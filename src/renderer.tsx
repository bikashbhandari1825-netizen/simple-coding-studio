import { createRoot } from 'react-dom/client';
import './index.css';
import './renderer/monacoSetup';
import App from './renderer/App';

createRoot(document.getElementById('root')!).render(<App />);
