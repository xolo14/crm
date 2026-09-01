import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

/** DECOY-ONLY Vite config — builds to dist/legacy, base /legacy/ */
export default defineConfig({
  root: path.resolve(__dirname),
  base: '/legacy/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../dist/legacy'),
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 8081,
    proxy: {
      '/api-decoy': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
