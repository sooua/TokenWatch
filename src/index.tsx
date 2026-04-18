import { ThemeProvider } from 'next-themes';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MiniHud } from './components/MiniHud';
import './i18n'; // Side-effect: initializes i18next before any component mounts.
import './styles/index.css';

// The mini HUD runs in a separate BrowserWindow that loads the same
// index.html but with `?view=minihud` appended. We switch which React tree
// mounts so both surfaces share the same bundle and assets.
const viewParam =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null;
const isMiniHud = viewParam === 'minihud';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="tokenwatch-theme">
      {isMiniHud ? <MiniHud /> : <App />}
    </ThemeProvider>
  </React.StrictMode>,
);
