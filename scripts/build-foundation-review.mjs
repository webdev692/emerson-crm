// Offline visual evidence only. This file and its fixtures are never app entry points.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { reviewPayload } from './fixtures/review-data.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(
  root,
  '../build-evidence/emerson-crm-foundation/2026-10-24',
)
const result = await build({
  root,
  configFile: false,
  envDir: false,
  envPrefix: 'CRM_SYNTHETIC_REVIEW_UNUSED_',
  publicDir: false,
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@netlify/identity': resolve(root, 'scripts/fixtures/review-identity.ts'),
    },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    minify: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, 'scripts/fixtures/foundation-review.tsx'),
      name: 'EmersonSyntheticReview',
      formats: ['iife'],
    },
  },
})
const outputs = (Array.isArray(result) ? result : [result]).flatMap(
  (result) => result.output,
)
const javascript = outputs
  .filter((item) => item.type === 'chunk')
  .map((item) => item.code)
  .join('\n')
// The artifact must also render without font services or any other network access.
const css = outputs
  .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map((item) => String(item.source))
  .join('\n')
  .replace(/@import\s+(?:url\([^;]+\)|"[^"]+"|'[^']+');?/gi, '')
if (!javascript || !css)
  throw Error('The offline review bundle is missing JavaScript or CSS.')
const fixtureJson = JSON.stringify(reviewPayload).replaceAll('<', '\\u003c')
const stub = `
globalThis.fetch = async function(input, init) {
  const path = typeof input === 'string' ? input : input.url;
  const method = (init && init.method) || (typeof input === 'object' && input.method) || 'GET';
  if (!/^\\/api\\/crm(?:\\?|$)/.test(path) || method !== 'GET' || path.includes('export=')) {
    return Response.json({error:'This offline synthetic review is read-only. Network, save, export and account operations are unavailable.'}, {status:403});
  }
  return Response.json(${fixtureJson}, {headers:{'Cache-Control':'no-store'}});
};
`
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>Emerson CRM — offline synthetic visual review</title><style>${css.replaceAll('</style', '<\\/style')}</style></head>
<body><div id="root"></div><script>${stub.replaceAll('</script', '<\\/script')}</script><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`
await mkdir(destination, { recursive: true })
const path = resolve(destination, 'foundation-review.html')
await writeFile(path, html)
await writeFile(
  resolve(destination, 'offline-review-manifest.json'),
  JSON.stringify(
    {
      purpose:
        'Offline synthetic visual review; not deployment or authentication evidence',
      file: path,
      source: 'scripts/fixtures/foundation-review.tsx',
      fixtureSource: 'scripts/fixtures/review-data.mjs',
      syntheticRecords: reviewPayload.records.length,
      productionConnection: false,
      writes: 'blocked by in-artifact fetch stub and CSP',
      externalResources: false,
      bytes: Buffer.byteLength(html),
    },
    null,
    2,
  ),
)
console.log(`Offline synthetic review saved to ${path}`)
