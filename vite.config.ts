import react from '@vitejs/plugin-react'
import { createLogger, defineConfig, type LogErrorOptions, type ProxyOptions } from 'vite'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mob3Core = require.resolve('@mob3/core')

const BENIGN_PROXY_CODES = new Set(['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED'])

function isBenignProxyDisconnect(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code && BENIGN_PROXY_CODES.has(code)) return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /EPIPE|ECONNRESET|ECONNREFUSED|ECONNABORTED|socket hang up/i.test(msg)
}

/**
 * Vite attaches its own ws proxy error loggers AFTER `configure`, so
 * proxy.on('error') cannot silence `[vite] ws proxy error` / `ws proxy socket error`.
 * Filter those at the logger when the underlying code is a benign disconnect.
 */
const logger = createLogger()
const logError = logger.error.bind(logger)
logger.error = (msg, options?: LogErrorOptions) => {
  const text = String(msg)
  const isWsProxyNoise =
    text.includes('ws proxy error') || text.includes('ws proxy socket error')
  const isHttpProxyNoise = text.includes('http proxy error')
  if ((isWsProxyNoise || isHttpProxyNoise) && isBenignProxyDisconnect(options?.error ?? text)) {
    return
  }
  logError(msg, options)
}

/** Tear down peer sockets cleanly so half-closed pipes don't throw EPIPE mid-frame. */
const quietProxyErrors: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('error', (err, _req, res) => {
    if (isBenignProxyDisconnect(err)) {
      if (res && 'destroy' in res && typeof res.destroy === 'function') {
        try {
          res.destroy()
        } catch {
          /* ignore */
        }
      }
      return
    }
    console.error('[vite proxy]', (err as Error).message)
  })

  proxy.on('proxyReqWs', (proxyReq, _req, socket) => {
    const silence = (err: NodeJS.ErrnoException) => {
      if (isBenignProxyDisconnect(err)) return
      console.error('[vite ws socket]', err.message)
    }
    socket.on('error', silence)
    // When the browser drops, kill the upstream half so the pipe stops writing.
    socket.on('close', () => {
      try {
        proxyReq.destroy()
      } catch {
        /* ignore */
      }
    })
  })
}

export default defineConfig({
  plugins: [react()],
  customLogger: logger,
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
