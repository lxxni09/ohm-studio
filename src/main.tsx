import { applyA11y } from './a11y';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';

applyA11y();
createRoot(document.getElementById('root')!).render(<App />);

// Update-Suche beim Start (nur Desktop, abschaltbar, sendet nur die Programmversion)
void (async () => {
  const { org } = await import('./enterprise/org');
  const { checkForUpdates } = await import('./native');
  const { toast } = await import('./state/store');
  if (!org().autoUpdate) return;
  setTimeout(async () => {
    const r = await checkForUpdates(org().updateChannel);
    if (r?.ok && r.newer) toast(`Ohm Studio ${r.latest} ist verfügbar – Einstellungen → Updates.`);
  }, 5000);
})();

// Web-Version: als App installierbar und offline nutzbar (nicht in der Desktop-App)
if ('serviceWorker' in navigator && location.protocol === 'https:') void navigator.serviceWorker.register('./sw.js').catch(() => {});
