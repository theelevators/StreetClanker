import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
  define: {
    // Keep mob3's isNode() checks false in the browser bundle
    'process.versions.node': 'undefined',
  },
  optimizeDeps: {
    include: ['mob3', '@mob3/three', '@mob3/assets', 'three'],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /vendor/],
    },
  },
})
