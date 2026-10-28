// Standalone synthetic visual artifact. No app server, database, Identity or network.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import console from 'node:console'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(
  root,
  '../build-evidence/emerson-crm-education/2026-10-24',
)
const result = await build({
  root,
  configFile: false,
  envDir: false,
  publicDir: false,
  plugins: [react(), tailwind()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    minify: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, 'scripts/fixtures/education-review.tsx'),
      name: 'EducationSyntheticReview',
      formats: ['iife'],
    },
  },
})
const outputs = (Array.isArray(result) ? result : [result]).flatMap(
  (item) => item.output,
)
const js = outputs
  .filter((item) => item.type === 'chunk')
  .map((item) => item.code)
  .join('\n')
const css = outputs
  .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map((item) => String(item.source))
  .join('\n')
  .replace(/@import\s+(?:url\([^;]+\)|"[^"]+"|'[^']+');?/gi, '')
if (!js || !css) throw Error('Visual review bundle is incomplete')
await mkdir(destination, { recursive: true })
await writeFile(
  resolve(destination, 'education-review.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>Emerson CRM — synthetic HR clearance</title><style>${css.replaceAll('</style', '<\\/style')}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`,
)
console.log(
  'Offline synthetic HR review artifact built; no network, persistence or authentication.',
)
