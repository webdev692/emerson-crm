// Synthetic integration harness only. Creates a fresh random-port PostgreSQL
// cluster and never reads a connection string, .env, runtime key or hosted data.
import { execFile, spawn } from 'node:child_process'
import { randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema'
import { rehearsalMigrationPlan } from './rehearsal-migrations'

export interface LocalPgPool {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>
  end(): Promise<void>
}
interface PgModule {
  Pool: new (options: {
    host: string
    port: number
    user: string
    database: string
    max: number
    connectionTimeoutMillis: number
  }) => LocalPgPool
}
const require = createRequire(import.meta.url)
const run = promisify(execFile)
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const postgresBin = join(workspace, '.tools/postgresql-17.11/pgsql/bin')

async function controlPostgres(args: string[]) {
  await new Promise<void>((resolveControl, reject) => {
    const child = spawn(join(postgresBin, 'pg_ctl.exe'), args, {
      windowsHide: true,
      stdio: 'ignore',
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Local PostgreSQL control timed out'))
    }, 45000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolveControl()
      else reject(new Error(`Local PostgreSQL control exited ${code}`))
    })
  })
}
async function unusedHighPort() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = randomInt(49152, 64000)
    const server = createServer()
    const available = await new Promise<boolean>((resolvePort, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EACCES' || error.code === 'EPERM') reject(error)
        else resolvePort(false)
      })
      server.listen(candidate, '127.0.0.1', () =>
        server.close(() => resolvePort(true)),
      )
    })
    if (available) return candidate
  }
  throw new Error('No unused loopback high port available')
}

export async function createLocalPostgres(label = 'education') {
  if (process.platform !== 'win32')
    throw new Error('Bundled local PostgreSQL harness requires Windows')
  if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid local fixture label')
  const evidence = join(
    workspace,
    'build-evidence/emerson-crm-education/2026-10-24',
    `${label}-postgres-${randomUUID()}`,
  )
  const cluster = join(evidence, 'data')
  const port = await unusedHighPort()
  await mkdir(evidence, { recursive: true })
  let started = false
  let pool: LocalPgPool | undefined
  const migrations: string[] = []
  const stop = async () => {
    await pool?.end()
    pool = undefined
    if (started) {
      await controlPostgres([
        'stop',
        '-D',
        cluster,
        '-m',
        'fast',
        '-w',
        '-t',
        '30',
      ])
      started = false
      await writeFile(
        join(evidence, 'stopped.json'),
        JSON.stringify(
          {
            stoppedAt: new Date().toISOString(),
            clusterStopped: true,
            migrations,
          },
          null,
          2,
        ),
      )
    }
  }
  try {
    await run(
      join(postgresBin, 'initdb.exe'),
      [
        '-D',
        cluster,
        '-U',
        'crm_education_rehearsal',
        '--auth=trust',
        '--encoding=UTF8',
        '--locale=C',
      ],
      { windowsHide: true, timeout: 60000 },
    )
    await controlPostgres([
      'start',
      '-D',
      cluster,
      '-l',
      join(evidence, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port} -F -c listen_addresses=127.0.0.1 -c max_connections=12`,
      '-w',
      '-t',
      '30',
    ])
    started = true
    const { Pool } = require('pg') as PgModule
    pool = new Pool({
      host: '127.0.0.1',
      port,
      user: 'crm_education_rehearsal',
      database: 'postgres',
      max: 6,
      connectionTimeoutMillis: 5000,
    })
    const observed = (
      await pool.query(
        'SELECT host(inet_server_addr()) AS host, inet_server_port() AS port',
      )
    ).rows[0]
    if (observed.host !== '127.0.0.1' || observed.port !== port)
      throw new Error('Fresh local PostgreSQL isolation check failed')
    const migrationRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../netlify/database/migrations',
    )
    const plan = await rehearsalMigrationPlan(migrationRoot)
    migrations.push(...plan.schemaMigrations)
    for (const migration of migrations) {
      const sql = await readFile(
        join(migrationRoot, migration, 'migration.sql'),
        'utf8',
      )
      await pool.query(`BEGIN;\n${sql}\nCOMMIT;`)
    }
    const db = drizzle({ client: pool, schema })
    await writeFile(
      join(evidence, 'isolation.json'),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          host: '127.0.0.1',
          port,
          database: 'fresh local PostgreSQL cluster',
          hostedConnections: false,
          syntheticAddressesOnly: true,
          migrations,
          deferredOperatorDml: plan.deferredOperatorDml,
          adapter:
            'drizzle-orm/node-postgres; production handler/schema; mocked Identity/database factory only',
          operationalKeysRead: false,
        },
        null,
        2,
      ),
    )
    return { pool, db, evidence, migrations, port, stop }
  } catch (error) {
    await stop()
    throw error
  }
}
