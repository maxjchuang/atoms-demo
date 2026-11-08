import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  publicDir: command === 'build' ? false : 'public',
  server: { port: 5173, strictPort: true, proxy: mode === 'mock' ? undefined : { '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3001' } },
  preview: { port: 5173 },
}));
