import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Multi-page app: one folder per page, so the built site has real URLs
// (/, /overlap/?id=, /data/, /dataset/?id=, /contribute/, /check/, /about/).
// `npm run build` writes to ../web, which FastAPI serves at http://localhost:8000/.
const pages = ['overlap', 'data', 'dataset', 'contribute', 'check', 'about']

export default defineConfig(({ mode }) => {
  // Load .env, .env.local etc. Machine-specific overrides (e.g. VITE_API_PORT=9000)
  // belong in .env.local which is gitignored — teammates are never affected.
  const env = loadEnv(mode, resolve(__dirname, '../..'), '')
  const apiPort = env.VITE_API_PORT ?? '8000'

  return {
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, '../web'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1200, // maplibre-gl is ~800 kB on its own
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          ...Object.fromEntries(pages.map((p) => [p, resolve(__dirname, p, 'index.html')])),
        },
      },
    },
    server: {
      port: 5173,
      strictPort: false, // auto-increment to next free port instead of crashing
      // Forwards /api/* to the mock API server. Override port via VITE_API_PORT in .env.local.
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
  }
})
