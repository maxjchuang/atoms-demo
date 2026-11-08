import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

async function start() {
  if (import.meta.env.MODE === 'mock') {
    const { worker } = await import('./mock/browser');
    await worker.start({ onUnhandledRequest: 'bypass', serviceWorker: { url: '/mockServiceWorker.js' } });
  }
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
}
void start();
