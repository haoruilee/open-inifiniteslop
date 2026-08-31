import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

async function availablePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => probe.close(resolve))
  return port
}

async function waitForHealth(origin, child, output) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${output.join('')}`)
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) return response.json()
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`server did not become healthy\n${output.join('')}`)
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('server did not stop after SIGTERM')), 5_000))
  await Promise.race([exited, timeout])
  assert.equal(child.exitCode, 0)
}

function startServer(port, directory, output) {
  const child = spawn(globalThis.process.execPath, ['server-dist/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...globalThis.process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: join(directory, 'channel.sqlite'),
      MEDIA_DIR: join(directory, 'videos'),
      VIDEO_PROVIDER: 'mock',
      MOCK_GENERATION_DELAY_MS: '10',
      WORKER_INTERVAL_MS: '50',
      ROTATION_INTERVAL_MS: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))
  return child
}

const directory = mkdtempSync(join(tmpdir(), 'infinite-slop-smoke-'))
const output = []
let server
try {
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  server = startServer(port, directory, output)
  const health = await waitForHealth(origin, server, output)
  assert.equal(health.status, 'ok')

  const home = await fetch(`${origin}/`, { headers: { Accept: 'text/html' } })
  assert.equal(home.status, 200)
  assert.match(home.headers.get('content-type') || '', /^text\/html/u)
  const html = await home.text()
  assert.match(html, /Infinite Slop/u)
  const assetPath = html.match(/(?:src|href)="(\/assets\/[^"]+)"/u)?.[1]
  assert.ok(assetPath)
  const asset = await fetch(`${origin}${assetPath}`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('cache-control') || '', /immutable/u)

  const initial = await (await fetch(`${origin}/api/state`)).json()
  const marker = `production smoke ${Date.now()}`
  const submitted = await fetch(`${origin}/api/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'smoke', message: marker }),
  })
  assert.equal(submitted.status, 201)
  const created = await submitted.json()
  assert.ok(created.idea.id)
  assert.ok(initial.revision < created.revision)

  await stop(server)
  server = startServer(port, directory, output)
  await waitForHealth(origin, server, output)
  const restored = await (await fetch(`${origin}/api/state`)).json()
  assert.ok(restored.chat.some((idea) => idea.message === marker))
  await stop(server)
  server = undefined
  console.log(`production smoke passed on ${origin}`)
} finally {
  if (server && server.exitCode === null) server.kill('SIGKILL')
  rmSync(directory, { recursive: true, force: true })
}
