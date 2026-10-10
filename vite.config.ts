import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PROSPER_UI_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.PROSPER_API_PORT ?? 4310}` },
  },
  build: { sourcemap: true },
});
