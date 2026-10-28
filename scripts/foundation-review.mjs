// Local visual review only. Never deploy this server or use real records here.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import console from 'node:console'
import process from 'node:process'
import { resolve } from 'node:path'
import { reviewPayload } from './fixtures/review-data.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({
  root,
  configFile: false,
  envPrefix: 'CRM_SYNTHETIC_REVIEW_UNUSED_',
  publicDir: false,
  plugins: [
    react(),
    tailwind(),
    {
      name: 'synthetic-read-only-review',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, nextMiddleware) => {
          if (req.url?.startsWith('/api/crm')) {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            if (req.method !== 'GET') {
              res.statusCode = 403
              res.end(
                JSON.stringify({
                  error:
                    'This local visual review is read-only. Save behavior is verified in automated API and PostgreSQL tests.',
                }),
              )
              return
            }
            res.end(JSON.stringify(reviewPayload))
            return
          }
          if (req.url === '/') {
            const html = await vite.transformIndexHtml(
              '/',
              '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emerson CRM — synthetic review</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/foundation-review.tsx"></script></body></html>',
            )
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
            return
          }
          nextMiddleware()
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@netlify/identity': resolve(root, 'scripts/fixtures/review-identity.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4191,
    strictPort: true,
    fs: { allow: [root] },
  },
})
await server.listen()
console.log(
  'Synthetic read-only review: http://127.0.0.1:4191/ (no production connection)',
)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await server.close()
    process.exit(0)
  })
