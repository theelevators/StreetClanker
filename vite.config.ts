import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mob3Core = require.resolve('@mob3/core')

/** Vite's ws proxy throws noisy EPIPE when a tab closes or the ring restarts mid-frame. */
const quietProxyErrors: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNREFUSED') return
    console.error('[vite proxy]', err.message)
  })
  proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return
      console.error('[vite ws socket]', err.message)
    })
  })
}

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
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        configure: quietProxyErrors,
      },
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
        configure: quietProxyErrors,
      },
    },
  },
  optimizeDeps: {
    include: ['@mob3/core', '@mob3/three', '@mob3/react', 'three'],
  },
})
