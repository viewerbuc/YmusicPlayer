import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    strictPort: false
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
          pinyin: ['pinyin-pro'],
          icons: ['lucide-react']
        }
      }
    }
  }
});
