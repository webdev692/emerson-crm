// Explicit local rehearsal build. Neither entry is a production application route.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import console from 'node:console'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(
  root,
  '../build-evidence/project-studio-phase-five-20261115/demo',
)
const common = {
  root,
  configFile: false,
  envDir: false,
  publicDir: false,
  envPrefix: 'UNUSED_PROJECT_STUDIO_REHEARSAL_',
  logLevel: 'warn',
}
const client = await build({
  ...common,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    minify: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, 'scripts/fixtures/project-studio-review.tsx'),
      name: 'StudioRehearsal',
      formats: ['iife'],
    },
  },
})
const outputs = (Array.isArray(client) ? client : [client]).flatMap(
  (result) => result.output,
)
const script = outputs
  .filter((item) => item.type === 'chunk')
  .map((item) => item.code)
  .join('\n')
const css = outputs
  .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map((item) => String(item.source))
  .join('\n')
if (!script || !css)
  throw Error('Rehearsal JavaScript and styles are required.')
if (/https?:\/\//i.test(css))
  throw Error('External style resources are forbidden.')
const server = await build({
  ...common,
  ssr: { noExternal: true },
  build: {
    ssr: resolve(root, 'netlify/functions/lib/project-studio-rehearsal.mts'),
    write: false,
    minify: false,
    sourcemap: false,
    rollupOptions: { output: { format: 'es', codeSplitting: false } },
  },
})
const serverOutputs = (Array.isArray(server) ? server : [server]).flatMap(
  (result) => result.output,
)
const chunks = serverOutputs.filter((item) => item.type === 'chunk')
if (chunks.length !== 1) throw Error('Expected one isolated server module.')
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Project Studio — private synthetic rehearsal</title>
<link rel="stylesheet" href="/review.css"></head>
<body><div id="root"></div><script defer src="/review.js"></script></body></html>`
await mkdir(destination, { recursive: true })
const files = {
  'index.html': html,
  'review.js': script,
  'review.css': css,
  'server.mjs': chunks[0].code,
}
for (const [name, content] of Object.entries(files))
  await writeFile(resolve(destination, name), content)
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim()
const trackedChanges = execFileSync(
  'git',
  ['status', '--porcelain', '--untracked-files=no'],
  { cwd: root, encoding: 'utf8' },
).trim()
const manifest = {
  purpose:
    'Local synthetic demonstration only; no production route or transport',
  commit,
  trackedWorkingTreeDirty: Boolean(trackedChanges),
  builtAt: new Date().toISOString(),
  productionConnection: false,
  persistence: 'process memory only; stop resets all records',
  files: Object.fromEntries(
    Object.entries(files).map(([name, content]) => [
      name,
      createHash('sha256').update(content).digest('hex'),
    ]),
  ),
}
await writeFile(
  resolve(destination, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)
console.log(`Synthetic rehearsal built at ${destination}`)
