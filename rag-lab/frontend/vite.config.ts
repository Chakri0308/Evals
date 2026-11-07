import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    rolldownOptions: {
      output: {
        // long-lived vendor chunks: app changes don't invalidate the cached libraries
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
            { name: 'ui-vendor', test: /node_modules[\/](@radix-ui|framer-motion|motion-dom|motion-utils|lucide-react|react-resizable-panels)[\/]/ },
            { name: 'data-vendor', test: /node_modules[\/](@tanstack|zustand)[\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true } },
  },
})
