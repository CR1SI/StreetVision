import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Multi-page app: one folder per page, so the built site has real URLs
// (/, /overlap/?id=, /data/, /dataset/?id=, /contribute/, /check/, /about/).
// `npm run build` writes to ../web, which FastAPI serves at http://localhost:8000/.
const pages = ['overlap', 'data', 'dataset', 'contribute', 'check', 'about']

export default defineConfig({
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
    // In dev, the React app runs on :5173 and forwards API calls to the FastAPI backend.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
