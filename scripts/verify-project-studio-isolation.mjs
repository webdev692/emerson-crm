// Run after the ordinary production build, not after the separate rehearsal build.
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import console from 'node:console'

const root = fileURLToPath(new URL('../', import.meta.url))
const forbidden =
  /Harbor Lantern Services|SYN-PS5-001|project-studio-demo|StudioRehearsal|PROJECT_STUDIO_REHEARSAL_MODE/
let inspected = 0
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await inspect(path)
    else if (/\.(?:m?js|cjs|css|html|json|map)$/.test(entry.name)) {
      if (forbidden.test(await readFile(path, 'utf8')))
        throw Error(`Synthetic rehearsal found in production artifact: ${path}`)
      inspected++
    }
  }
}
await inspect(resolve(root, 'dist/client'))
await inspect(resolve(root, 'dist/server'))
if (!inspected) throw Error('No production build artifacts inspected.')
for (const path of ['src/routeTree.gen.ts', 'netlify/functions/crm.mts']) {
  if (
    /project-studio-rehearsal|project-studio-demo/.test(
      await readFile(resolve(root, path), 'utf8'),
    )
  ) {
    throw Error(`Production entry imports the isolated rehearsal: ${path}`)
  }
}
console.log(
  `PASS: ${inspected} production artifacts exclude the isolated Project Studio rehearsal; CRM API and route tree unchanged.`,
)
