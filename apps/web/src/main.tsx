import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './typography.css';
import './coordination.css';

async function start() {
  if (import.meta.env.MODE === 'mock') {
    const { worker } = await import('./mock/browser');
    await worker.start({ onUnhandledRequest(request, print) { if (new URL(request.url).pathname.startsWith('/api/')) print.error(); }, serviceWorker: { url: '/mockServiceWorker.js' } });
  }
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
}
void start();

import './run-replan.css';
