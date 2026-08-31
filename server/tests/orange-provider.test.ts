import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { OrangeVideoProvider, type OrangeProviderOptions } from '../orange-video-provider.js'
import { ProviderError } from '../provider-shared.js'
import type { IdeaRecord } from '../types.js'

type FakeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

async function fakeGateway(handler: FakeHandler) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500
      response.end(error instanceof Error ? error.message : 'fake gateway error')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function idea(overrides: Partial<IdeaRecord> = {}): IdeaRecord {
  return {
    id: 41,
    visitorId: 'visitor-orange',
    author: 'orange-test',
    body: 'an orange paper boat drifting on calm water',
    normalizedBody: 'an orange paper boat drifting on calm water',
    status: 'generating',
    moderationReason: null,
    votes: 0,
    createdAt: Date.now(),
    statusChangedAt: Date.now(),
    provider: 'orange',
    providerRequestId: null,
    videoUrl: null,
    videoPath: null,
    posterUrl: null,
    durationSeconds: null,
    generationProgress: 'starting',
    error: null,
    playCount: 0,
    generationAttempts: 1,
    retryAt: null,
    ...overrides,
  }
}

function providerOptions(origin: string, mediaDir: string, overrides: Partial<OrangeProviderOptions> = {}): OrangeProviderOptions {
  return {
    apiKey: 'orange-provider-test-key',
    baseUrl: `${origin}/v1`,
    model: 'happyhorse-1.0-t2v',
    mediaDir,
    durationSeconds: 3,
    resolution: '720P',
    ratio: '16:9',
    watermark: true,
    pollIntervalMs: 1,
    timeoutMs: 5_000,
    allowInsecureBaseUrl: true,
    sleep: async () => undefined,
    downloadOptions: { trustedOrigins: new Set([origin]) },
    ...overrides,
  }
}

test('submits the documented HappyHorse payload, polls, and immediately stores the result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orange-provider-'))
  const video = readFileSync(new URL('../../public/assets/mock-loop-1.mp4', import.meta.url))
  let postCount = 0
  let pollCount = 0
  let submittedBody: Record<string, unknown> | null = null
  let mediaUserAgent: string | undefined
  const seenHeaders: Array<{ authorization: string | undefined; userAgent: string | undefined }> = []
  const gateway = await fakeGateway(async (request, response) => {
    seenHeaders.push({
      authorization: request.headers.authorization,
      userAgent: request.headers['user-agent'],
    })
    if (request.method === 'POST' && request.url === '/v1/video/generations') {
      postCount += 1
      submittedBody = await readJsonBody(request)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: { task_id: 'orange-task-1' } }))
      return
    }
    if (request.method === 'GET' && request.url === '/v1/video/generations/orange-task-1') {
      pollCount += 1
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(pollCount === 1
        ? { data: { status: 'PROCESSING' } }
        : { data: { status: 'SUCCESS', result_url: `${gateway.origin}/result.mp4` } }))
      return
    }
    if (request.method === 'GET' && request.url === '/result.mp4') {
      mediaUserAgent = request.headers['user-agent']
      response.setHeader('Content-Type', 'video/mp4')
      response.setHeader('Content-Length', String(video.length))
      response.end(video)
      return
    }
    response.statusCode = 404
    response.end()
  })

  try {
    const progress: string[] = []
    const provider = new OrangeVideoProvider(providerOptions(gateway.origin, directory))
    const result = await provider.generate(idea(), (update) => progress.push(update.stage), new AbortController().signal)
    assert.equal(postCount, 1)
    assert.equal(pollCount, 2)
    assert.deepEqual(submittedBody, {
      model: 'happyhorse-1.0-t2v',
      prompt: 'an orange paper boat drifting on calm water',
      seconds: '3',
      resolution: '720P',
      ratio: '16:9',
      watermark: true,
    })
    assert.ok(seenHeaders.slice(0, 3).every(({ authorization }) => authorization === 'Bearer orange-provider-test-key'))
    assert.ok(seenHeaders.slice(0, 3).every(({ userAgent }) => userAgent?.startsWith('Mozilla/5.0')))
    assert.ok(mediaUserAgent?.startsWith('Mozilla/5.0'))
    assert.deepEqual(progress, ['provider_queued', 'provider_rendering', 'downloading_video'])
    assert.equal(result.providerRequestId, 'orange-task-1')
    assert.equal(result.videoUrl, '/api/media/41')
    assert.equal(result.durationSeconds, 3)
    assert.deepEqual(readFileSync(result.videoPath!), video)
  } finally {
    await gateway.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('resumes a persisted task and retries only GET polling', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orange-resume-'))
  const video = readFileSync(new URL('../../public/assets/mock-loop-1.mp4', import.meta.url))
  let postCount = 0
  let pollCount = 0
  const gateway = await fakeGateway((request, response) => {
    if (request.method === 'POST') {
      postCount += 1
      response.statusCode = 500
      response.end()
      return
    }
    if (request.url === '/v1/video/generations/resume-task') {
      pollCount += 1
      if (pollCount === 1) {
        response.statusCode = 503
        response.end()
      } else {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ status: 'SUCCESS', result_url: `${gateway.origin}/resume.mp4` }))
      }
      return
    }
    if (request.url === '/resume.mp4') {
      response.setHeader('Content-Type', 'application/octet-stream')
      response.end(video)
      return
    }
    response.statusCode = 404
    response.end()
  })
  try {
    const provider = new OrangeVideoProvider(providerOptions(gateway.origin, directory))
    const result = await provider.generate(
      idea({ providerRequestId: 'resume-task', generationAttempts: 2 }),
      () => undefined,
      new AbortController().signal,
    )
    assert.equal(postCount, 0)
    assert.equal(pollCount, 2)
    assert.equal(result.providerRequestId, 'resume-task')
    assert.deepEqual(readFileSync(result.videoPath!), video)
  } finally {
    await gateway.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('fails closed on terminal generation errors and malformed submissions', async () => {
  let mode: 'missing-id' | 'failed' = 'missing-id'
  let postCount = 0
  const gateway = await fakeGateway((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'POST') {
      postCount += 1
      response.end(JSON.stringify(mode === 'missing-id' ? { data: {} } : { task_id: 'failed-task' }))
      return
    }
    response.end(JSON.stringify({ data: { status: 'FAILED' } }))
  })
  const directory = mkdtempSync(join(tmpdir(), 'orange-failure-'))
  try {
    const provider = new OrangeVideoProvider(providerOptions(gateway.origin, directory))
    await assert.rejects(
      provider.generate(idea({ provider: null }), () => undefined, new AbortController().signal),
      (error: unknown) => error instanceof ProviderError
        && error.code === 'orange_submission_missing_task_id'
        && error.retryable === false,
    )
    mode = 'failed'
    await assert.rejects(
      provider.generate(idea({ provider: null }), () => undefined, new AbortController().signal),
      (error: unknown) => error instanceof ProviderError
        && error.code === 'orange_generation_failed'
        && error.retryable === false,
    )
    assert.equal(postCount, 2)
  } finally {
    await gateway.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('rejects disabled models before making a request', () => {
  assert.throws(() => new OrangeVideoProvider({
    ...providerOptions('http://127.0.0.1:1', '/tmp'),
    model: 'happyhorse-1.0-r2v',
  }), /enabled text-to-video allowlist/u)
})
