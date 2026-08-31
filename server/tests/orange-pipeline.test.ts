import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createChannelHttpApp } from '../app.js'
import { loadConfig } from '../config.js'
import { ChannelDatabase } from '../database.js'
import { OrangeVideoProvider } from '../orange-video-provider.js'
import { ChannelOrchestrator } from '../orchestrator.js'
import type { ChannelSnapshot } from '../types.js'

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for Orange pipeline state')
}

function sseSnapshots(response: Response) {
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    reader,
    async next(): Promise<ChannelSnapshot> {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = event.split('\n').find((line) => line.startsWith('data: '))
          if (data) return JSON.parse(data.slice(6)) as ChannelSnapshot
          continue
        }
        const chunk = await reader.read()
        if (chunk.done) throw new Error('SSE stream ended before the expected state')
        buffer += decoder.decode(chunk.value, { stream: true })
      }
    },
  }
}

test('moderation gates Orange generation before SSE playback and same-origin Range delivery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orange-pipeline-'))
  const video = readFileSync(new URL('../../public/assets/mock-loop-1.mp4', import.meta.url))
  const credentialSentinel = `orange-pipeline-${crypto.randomUUID()}`
  let postCount = 0
  let pollCount = 0
  let mediaCount = 0
  let mediaUserAgent = ''
  const gateway = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/video/generations') {
      postCount += 1
      assert.equal(request.headers.authorization, `Bearer ${credentialSentinel}`)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: { task_id: 'pipeline-task' } }))
      return
    }
    if (request.method === 'GET' && request.url === '/v1/video/generations/pipeline-task') {
      pollCount += 1
      assert.equal(request.headers.authorization, `Bearer ${credentialSentinel}`)
      response.setHeader('Content-Type', 'application/json')
      const gatewayAddress = gateway.address() as AddressInfo
      const gatewayOrigin = `http://127.0.0.1:${gatewayAddress.port}`
      response.end(JSON.stringify(pollCount === 1
        ? { data: { status: 'PROCESSING' } }
        : { data: { status: 'SUCCESS', result_url: `${gatewayOrigin}/signed/result.mp4` } }))
      return
    }
    if (request.method === 'GET' && request.url === '/signed/result.mp4') {
      mediaCount += 1
      mediaUserAgent = request.headers['user-agent'] || ''
      response.setHeader('Content-Type', 'video/mp4')
      response.setHeader('Content-Length', String(video.length))
      response.end(video)
      return
    }
    response.statusCode = 404
    response.end()
  })

  let database: ChannelDatabase | undefined
  let app: ReturnType<typeof createChannelHttpApp> | undefined
  let orchestrator: ChannelOrchestrator | undefined
  let sseAbort: AbortController | undefined
  let stream: ReturnType<typeof sseSnapshots> | undefined
  try {
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve))
    const gatewayAddress = gateway.address() as AddressInfo
    const gatewayOrigin = `http://127.0.0.1:${gatewayAddress.port}`
    const config = loadConfig({
      NODE_ENV: 'test',
      VIDEO_PROVIDER: 'orange',
      ADMIN_TOKEN: 'pipeline-admin',
      DATABASE_PATH: join(directory, 'channel.sqlite'),
      MEDIA_DIR: join(directory, 'videos'),
      PROMPT_RATE_LIMIT: '100',
    }, directory)
    database = new ChannelDatabase(config.databasePath, { seed: false, provider: 'orange' })
    app = createChannelHttpApp(database, config)
    await new Promise<void>((resolve) => app!.server.listen(0, '127.0.0.1', resolve))
    const appAddress = app.server.address() as AddressInfo
    const origin = `http://127.0.0.1:${appAddress.port}`
    const provider = new OrangeVideoProvider({
      apiKey: credentialSentinel,
      baseUrl: `${gatewayOrigin}/v1`,
      model: 'happyhorse-1.0-t2v',
      mediaDir: config.mediaDir,
      durationSeconds: 3,
      resolution: '720P',
      ratio: '16:9',
      watermark: true,
      pollIntervalMs: 1,
      timeoutMs: 5_000,
      allowInsecureBaseUrl: true,
      sleep: async () => undefined,
      downloadOptions: { trustedOrigins: new Set([gatewayOrigin]) },
    })
    orchestrator = new ChannelOrchestrator(database, provider, {
      generationConcurrency: 1,
      bufferTarget: 1,
      workerIntervalMs: 60_000,
      rotationIntervalMs: 60_000,
      maximumAttempts: 1,
    }, app.broadcast)
    orchestrator.start()

    sseAbort = new AbortController()
    const events = await fetch(`${origin}/api/events`, { signal: sseAbort.signal })
    assert.equal(events.status, 200)
    stream = sseSnapshots(events)
    const observed = [await stream.next()]

    const submission = await fetch(`${origin}/api/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        nickname: 'human-review',
        message: 'a fictional scene with a real person deepfake',
      }),
    })
    assert.equal(submission.status, 201)
    const submitted = await submission.json() as { idea: { id: number; status: string } }
    assert.equal(submitted.idea.status, 'pending_review')
    await orchestrator.runOnce()
    assert.equal(postCount, 0)
    const heldState = await (await fetch(`${origin}/api/state`)).json() as ChannelSnapshot
    assert.deepEqual(heldState.queue, [])
    assert.deepEqual(heldState.generatingNow, [])
    assert.deepEqual(heldState.chat, [])

    const approval = await fetch(`${origin}/api/moderation/${submitted.idea.id}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer pipeline-admin',
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ action: 'approve', reason: 'pipeline_test_approved' }),
    })
    assert.equal(approval.status, 200)
    await orchestrator.runOnce()
    await waitFor(() => database!.getIdea(submitted.idea.id).status === 'playing')

    while (!observed.some((snapshot) => snapshot.nowPlaying?.id === submitted.idea.id)) {
      observed.push(await stream.next())
      assert.ok(observed.length < 30, 'SSE did not reach playback')
    }
    assert.ok(observed.some((snapshot) => snapshot.queue.some((item) => item.id === submitted.idea.id)))
    assert.ok(observed.some((snapshot) => snapshot.generatingNow.some((item) => item.id === submitted.idea.id)))
    const playing = observed.find((snapshot) => snapshot.nowPlaying?.id === submitted.idea.id)!
    assert.equal(playing.nowPlaying?.videoUrl, `/api/media/${submitted.idea.id}`)
    const publicEvents = JSON.stringify(observed)
    assert.equal(publicEvents.includes(credentialSentinel), false)
    assert.equal(publicEvents.includes('pipeline-task'), false)
    assert.equal(publicEvents.includes('/signed/result.mp4'), false)

    assert.equal(postCount, 1)
    assert.equal(pollCount, 2)
    assert.equal(mediaCount, 1)
    assert.match(mediaUserAgent, /^Mozilla\/5\.0/u)
    const stored = database.getIdea(submitted.idea.id)
    assert.equal(stored.generationAttempts, 1)
    assert.equal(stored.providerRequestId, 'pipeline-task')
    assert.equal(stored.videoUrl, `/api/media/${submitted.idea.id}`)
    assert.ok(stored.videoPath)
    assert.deepEqual(readdirSync(config.mediaDir), [`${submitted.idea.id}.mp4`])

    const full = await fetch(`${origin}/api/media/${submitted.idea.id}`)
    assert.equal(full.status, 200)
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), video)
    const range = await fetch(`${origin}/api/media/${submitted.idea.id}`, {
      headers: { Range: 'bytes=4-11' },
    })
    assert.equal(range.status, 206)
    assert.equal(range.headers.get('content-range'), `bytes 4-11/${video.length}`)
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), video.subarray(4, 12))
    const head = await fetch(`${origin}/api/media/${submitted.idea.id}`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(video.length))
  } finally {
    sseAbort?.abort()
    await stream?.reader.cancel().catch(() => undefined)
    await orchestrator?.stop()
    await app?.close()
    database?.close()
    await new Promise<void>((resolve) => gateway.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
