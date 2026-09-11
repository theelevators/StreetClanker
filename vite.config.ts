import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mob3Core = require.resolve('@mob3/core')

export default defineConfig({
  plugins: [react()],
  resolve: {
    // @mob3/three + @mob3/react 0.1.0 still import "mob3" after the rename to @mob3/core
    alias: {
      mob3: mob3Core,
    },
  },
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
  optimizeDeps: {
    include: ['@mob3/core', '@mob3/three', '@mob3/react', 'three'],
  },
})
