// No hosted entry: this explicit operator command serves fictional process-memory data only.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import console from 'node:console'

const { Request } = globalThis
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(
  root,
  '../build-evidence/project-studio-phase-five-20261115/demo',
)
const port = Number(process.argv[2] || 4195)
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error('A non-privileged local port is required.')
if (
  process.env.PROJECT_STUDIO_REHEARSAL_MODE !== 'synthetic-local' ||
  ['NETLIFY', 'CONTEXT', 'DEPLOY_ID', 'SITE_ID'].some((key) =>
    Object.hasOwn(process.env, key),
  )
) {
  throw Error(
    'This rehearsal requires explicit local mode and is unavailable in hosted runtimes.',
  )
}
const origin = `http://127.0.0.1:${port}`
const { createStudioRehearsal } = await import(
  pathToFileURL(resolve(destination, 'server.mjs')).href
)
const handler = createStudioRehearsal({
  origin,
  mode: process.env.PROJECT_STUDIO_REHEARSAL_MODE,
  environment: { ...process.env },
})
const routes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/review.js': ['review.js', 'text/javascript; charset=utf-8'],
  '/review.css': ['review.css', 'text/css; charset=utf-8'],
}
const csp =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
const server = createServer(async (incoming, outgoing) => {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
  }
  const reject = (status) => {
    outgoing.writeHead(status, {
      ...headers,
      'Content-Type': 'application/json',
    })
    outgoing.end(JSON.stringify({ error: 'Rehearsal request unavailable.' }))
  }
  try {
    if (
      incoming.socket.remoteAddress !== '127.0.0.1' ||
      incoming.headers.host !== `127.0.0.1:${port}` ||
      !incoming.url?.startsWith('/') ||
      incoming.url.startsWith('//')
    )
      return reject(403)
    const url = new URL(incoming.url, origin)
    if (url.origin !== origin || url.hash) return reject(404)
    const asset = Object.hasOwn(routes, url.pathname)
      ? routes[url.pathname]
      : null
    if (asset) {
      if (url.search) return reject(404)
      if (!['GET', 'HEAD'].includes(incoming.method)) return reject(405)
      outgoing.writeHead(200, { ...headers, 'Content-Type': asset[1] })
      outgoing.end(
        incoming.method === 'HEAD'
          ? undefined
          : await readFile(resolve(destination, asset[0])),
      )
      return
    }
    if (
      ![
        '/api/project-studio-demo',
        '/api/project-studio-demo/session',
        '/api/project-studio-demo/production',
      ].includes(url.pathname)
    )
      return reject(404)
    const requestHeaders = Object.fromEntries(
      Object.entries(incoming.headers).filter(
        ([, value]) => typeof value === 'string',
      ),
    )
    // The permanently disabled adapter rejects before the HTTP bridge buffers a body.
    if (url.pathname === '/api/project-studio-demo/production') {
      const response = await handler(
        new Request(url, { method: incoming.method, headers: requestHeaders }),
      )
      outgoing.writeHead(response.status, {
        ...headers,
        ...Object.fromEntries(response.headers.entries()),
      })
      outgoing.end(Buffer.from(await response.arrayBuffer()))
      return
    }
    if (incoming.method !== 'GET' && incoming.method !== 'POST')
      return reject(405)
    if (incoming.method === 'POST' && incoming.headers.origin !== origin)
      return reject(403)
    if (
      ['forwarded', 'x-forwarded-host', 'x-forwarded-proto'].some((key) =>
        Object.hasOwn(incoming.headers, key),
      )
    )
      return reject(403)
    let length = 0
    const parts = []
    for await (const part of incoming) {
      length += part.length
      if (length > 16384) return reject(413)
      parts.push(part)
    }
    const request = new Request(url, {
      method: incoming.method,
      headers: requestHeaders,
      ...(parts.length && !['GET', 'HEAD'].includes(incoming.method)
        ? { body: Buffer.concat(parts) }
        : {}),
    })
    const response = await handler(request)
    outgoing.writeHead(response.status, {
      ...headers,
      ...Object.fromEntries(response.headers.entries()),
    })
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    if (!outgoing.headersSent) reject(500)
    else outgoing.end()
  }
})
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Synthetic Project Studio rehearsal: ${origin} (no production connections)`,
  ),
)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close())
