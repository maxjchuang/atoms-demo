import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  publicDir: command === 'build' ? false : 'public',
  server: { port: 5173, strictPort: true, proxy: { '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3001' } },
  preview: { port: 5173 },
}));
