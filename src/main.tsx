import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {SupportPortalPage} from './components/SupportPortalPage';
import './index.css';
import {enforceLatestVersion} from './lib/versionManager';

// Run version enforcement to wipe stale cache if a new deployment is detected
enforceLatestVersion().catch((err) => {
  console.warn('[PWA] Version check caught error:', err);
});

const mountApp = () => {
  const rootEl = document.getElementById('root');
  if (!rootEl) return;

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const isReportRoute = pathname === '/report' || pathname === '/report/';

  if (isReportRoute) {
    createRoot(rootEl).render(
      <StrictMode>
        <SupportPortalPage />
      </StrictMode>,
    );
    return;
  }

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

mountApp();

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().catch(() => {});
    }
  }).catch(() => {});
}
