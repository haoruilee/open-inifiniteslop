import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createChannelHttpApp } from '../app.js'
import { loadConfig } from '../config.js'
import { ChannelDatabase } from '../database.js'
import type { ChannelSnapshot } from '../types.js'

async function startTestServer(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'infinite-slop-api-'))
  const database = new ChannelDatabase(join(directory, 'channel.sqlite'), { seed: false })
  const config = loadConfig({
    NODE_ENV: 'test',
    ADMIN_TOKEN: 'test-admin-token',
    PROMPT_RATE_LIMIT: '100',
    VOTE_RATE_LIMIT: '100',
    LIKE_RATE_LIMIT: '100',
    ...overrides,
  }, directory)
  const app = createChannelHttpApp(database, config)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  let cookie = ''

  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('Cookie', cookie)
    const response = await fetch(`${origin}${path}`, { ...init, headers })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';', 1)[0]
    return response
  }

  const jsonRequest = async (path: string, body: unknown, init: RequestInit = {}) => request(path, {
    method: 'POST',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    body: JSON.stringify(body),
  })

  return {
    app,
    config,
    database,
    origin,
    request,
    jsonRequest,
    cookie: () => cookie,
    close: async () => {
      await app.close()
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('health and state expose a safe, no-store contract with security headers', async () => {
  const server = await startTestServer()
  try {
    const health = await server.request('/api/health')
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('cache-control'), 'no-store')
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(health.headers.get('x-frame-options'), 'DENY')
    assert.match(health.headers.get('content-security-policy') || '', /frame-ancestors 'none'/u)
    assert.match(health.headers.get('set-cookie') || '', /HttpOnly; SameSite=Strict/u)
    const healthBody = await health.json() as Record<string, unknown>
    assert.deepEqual(healthBody, { status: 'ok', database: 'ok', revision: 0, provider: 'mock' })

    const stateResponse = await server.request('/api/state')
    const state = await stateResponse.json() as ChannelSnapshot
    assert.equal(state.revision, 0)
    assert.equal(state.live.provider, 'mock')
    assert.deepEqual(state.queue, [])
    assert.equal('databasePath' in state, false)
    assert.equal(JSON.stringify(state).includes('test-admin-token'), false)
  } finally {
    await server.close()
  }
})

test('validates, normalizes, persists, and publishes prompt submissions', async () => {
  const server = await startTestServer()
  try {
    const createdResponse = await server.jsonRequest('/api/prompts', {
      nickname: 'qa_user',
      message: '  tiny   astronauts having tea  ',
    })
    assert.equal(createdResponse.status, 201)
    const created = await createdResponse.json() as { idea: { id: number; body: string; status: string }; revision: number }
    assert.equal(created.idea.body, 'tiny astronauts having tea')
    assert.equal(created.idea.status, 'queued')
    assert.equal(created.revision, 1)

    const state = await (await server.request('/api/state')).json() as ChannelSnapshot
    assert.deepEqual(state.queue.map((idea) => idea.id), [created.idea.id])
    assert.deepEqual(state.chat.map((idea) => idea.id), [created.idea.id])

    const invalidCases = [
      { nickname: '', message: 'hello' },
      { nickname: 'a'.repeat(19), message: 'hello' },
      { nickname: 'valid', message: ' ' },
      { nickname: 'valid', message: 'x'.repeat(201) },
      { nickname: 'valid', message: 'hello', votes: 999 },
    ]
    for (const invalid of invalidCases) {
      const response = await server.jsonRequest('/api/prompts', invalid)
      assert.equal(response.status, 400)
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'VALIDATION_ERROR')
    }

    const wrongType = await server.request('/api/prompts', { method: 'POST', body: '{}' })
    assert.equal(wrongType.status, 415)
    const malformed = await server.request('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    assert.equal(malformed.status, 400)
    const tooLarge = await server.jsonRequest('/api/prompts', { nickname: 'valid', message: 'x'.repeat(5_000) })
    assert.equal(tooLarge.status, 413)

    const after = await (await server.request('/api/state')).json() as ChannelSnapshot
    assert.equal(after.revision, 1)
    assert.equal(after.queue.length, 1)
  } finally {
    await server.close()
  }
})

test('holds ambiguous prompts for authenticated human moderation', async () => {
  const server = await startTestServer()
  try {
    const submitted = await server.jsonRequest('/api/prompts', {
      nickname: 'review_me',
      message: 'a movie poster featuring a real person deepfake',
    })
    const body = await submitted.json() as { idea: { id: number; status: string } }
    assert.equal(body.idea.status, 'pending_review')

    const publicState = await (await server.request('/api/state')).json() as ChannelSnapshot
    assert.deepEqual(publicState.queue, [])
    assert.deepEqual(publicState.chat, [])

    const unauthorized = await server.request('/api/moderation')
    assert.equal(unauthorized.status, 401)
    const moderation = await server.request('/api/moderation', {
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const reviewQueue = await moderation.json() as { items: Array<{ id: number }> }
    assert.deepEqual(reviewQueue.items.map((idea) => idea.id), [body.idea.id])

    const approved = await server.jsonRequest(`/api/moderation/${body.idea.id}`, {
      action: 'approve',
      reason: 'reviewed_safe',
    }, { headers: { Authorization: 'Bearer test-admin-token' } })
    assert.equal(approved.status, 200)
    const after = await (await server.request('/api/state')).json() as ChannelSnapshot
    assert.deepEqual(after.queue.map((idea) => idea.id), [body.idea.id])
  } finally {
    await server.close()
  }
})

test('makes votes atomic per visitor and likes exact', async () => {
  const server = await startTestServer()
  try {
    await server.request('/api/health')
    const created = await (await server.jsonRequest('/api/prompts', {
      nickname: 'votable',
      message: 'a clockwork whale above a city',
    })).json() as { idea: { id: number } }

    const attempts = await Promise.all(Array.from({ length: 12 }, () => server.jsonRequest(
      `/api/queue/${created.idea.id}/votes`,
      {},
    )))
    assert.equal(attempts.filter((response) => response.status === 200).length, 1)
    assert.equal(attempts.filter((response) => response.status === 409).length, 11)
    assert.equal(server.database.getIdea(created.idea.id).votes, 1)

    const likes = await Promise.all(Array.from({ length: 20 }, () => server.jsonRequest('/api/likes', {})))
    assert.equal(likes.every((response) => response.status === 200), true)
    assert.equal((await (await server.request('/api/state')).json() as ChannelSnapshot).live.likes, 20)
  } finally {
    await server.close()
  }
})

test('enforces independent mutation rate limits and same-origin writes', async () => {
  const server = await startTestServer({ PROMPT_RATE_LIMIT: '1', LIKE_RATE_LIMIT: '1' })
  try {
    const first = await server.jsonRequest('/api/prompts', { nickname: 'one', message: 'first safe prompt' })
    assert.equal(first.status, 201)
    const limited = await server.jsonRequest('/api/prompts', { nickname: 'two', message: 'second safe prompt' })
    assert.equal(limited.status, 429)
    assert.match(limited.headers.get('retry-after') || '', /^\d+$/u)

    const like = await server.jsonRequest('/api/likes', {})
    assert.equal(like.status, 200)
    const likeLimited = await server.jsonRequest('/api/likes', {})
    assert.equal(likeLimited.status, 429)
    const health = await server.request('/api/health')
    assert.equal(health.status, 200)

    const crossSite = await server.jsonRequest('/api/likes', {}, {
      headers: { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' },
    })
    assert.equal(crossSite.status, 403)
    assert.equal((await (await server.request('/api/state')).json() as ChannelSnapshot).live.likes, 1)
  } finally {
    await server.close()
  }
})

test('serves original-compatible status and chat read contracts', async () => {
  const server = await startTestServer()
  try {
    const submission = await server.jsonRequest('/api/chat', {
      user: 'compat',
      msg: 'a paper kite catches a comet',
      vip: false,
    })
    assert.equal(submission.status, 201)
    const created = await submission.json() as { id: number }

    const statusResponse = await server.request('/status.json')
    assert.equal(statusResponse.headers.get('cache-control'), 'public, max-age=2')
    const status = await statusResponse.json() as { queue: Array<{ id: number; u: string; m: string; v: number }>; live: boolean }
    assert.equal(status.live, true)
    assert.deepEqual(status.queue, [{ id: created.id, u: 'compat', m: 'a paper kite catches a comet', at: status.queue[0].at, v: 0 }])

    const chat = await (await server.request('/api/chat?since=0')).json() as {
      msgs: Array<{ id: number; user: string; msg: string }>
      mine: null
      viewers: number
    }
    assert.deepEqual(chat.msgs.map(({ id, user, msg }) => ({ id, user, msg })), [{
      id: created.id,
      user: 'compat',
      msg: 'a paper kite catches a comet',
    }])
    assert.equal(chat.mine, null)
    assert.equal(chat.viewers >= 1, true)
  } finally {
    await server.close()
  }
})

test('pages a large chat history while keeping live state payloads bounded', async () => {
  const server = await startTestServer()
  try {
    for (let index = 0; index < 125; index += 1) {
      server.database.createSubmission(
        `history-${index}`,
        'history',
        `safe channel history item ${index}`,
        { decision: 'approve', reason: null },
      )
    }
    const state = await (await server.request('/api/state')).json() as ChannelSnapshot
    assert.equal(state.chat.length, 60)
    assert.equal(state.chatPage.hasMore, true)
    assert.equal(state.chatPage.oldestId, state.chat[0].id)

    const older = await (await server.request(`/api/chat?before=${state.chatPage.oldestId}&limit=25`)).json() as {
      items: Array<{ id: number }>
      page: { hasMore: boolean; nextBefore: number | null }
    }
    assert.equal(older.items.length, 25)
    assert.equal(older.items.every((item) => item.id < state.chatPage.oldestId!), true)
    assert.equal(older.items[0].id, older.page.nextBefore)
    assert.equal(older.page.hasMore, true)
  } finally {
    await server.close()
  }
})

test('streams an initial SSE snapshot and the next mutation revision', async () => {
  const server = await startTestServer()
  const controller = new AbortController()
  try {
    await server.request('/api/health')
    const response = await fetch(`${server.origin}/api/events`, {
      headers: { Cookie: server.cookie() },
      signal: controller.signal,
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /^text\/event-stream/u)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffered = ''

    const nextSnapshot = async () => {
      while (true) {
        const boundary = buffered.indexOf('\n\n')
        if (boundary >= 0) {
          const event = buffered.slice(0, boundary)
          buffered = buffered.slice(boundary + 2)
          const data = event.split('\n').find((line) => line.startsWith('data: '))
          if (data) return JSON.parse(data.slice(6)) as ChannelSnapshot
        }
        const chunk = await reader.read()
        if (chunk.done) throw new Error('SSE ended before a state event')
        buffered += decoder.decode(chunk.value, { stream: true })
      }
    }

    const initial = await nextSnapshot()
    assert.equal(initial.revision, 0)
    await server.jsonRequest('/api/prompts', { nickname: 'sse', message: 'a lighthouse made of paper' })

    let updated = await nextSnapshot()
    while (updated.revision <= initial.revision) updated = await nextSnapshot()
    assert.equal(updated.revision, 1)
    assert.equal(updated.queue[0].message, 'a lighthouse made of paper')
    controller.abort()
    await reader.cancel().catch(() => undefined)
  } finally {
    controller.abort()
    await server.close()
  }
})

test('serves provider-downloaded media with immutable byte ranges', async () => {
  const server = await startTestServer()
  try {
    const created = server.database.createSubmission(
      'media-visitor',
      'media',
      'a harmless media route test',
      { decision: 'approve', reason: null },
    ).idea
    server.database.claimNextForGeneration('fal')
    mkdirSync(server.config.mediaDir, { recursive: true })
    const mediaPath = join(server.config.mediaDir, `${created.id}.mp4`)
    const bytes = Buffer.from('00000000000000000000mock-video-payload')
    writeFileSync(mediaPath, bytes)
    server.database.completeGeneration(created.id, {
      videoUrl: `/api/media/${created.id}`,
      videoPath: mediaPath,
      posterUrl: null,
      durationSeconds: 5,
      providerRequestId: 'media-test',
    })

    const full = await server.request(`/api/media/${created.id}`)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-type'), 'video/mp4')
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.equal(full.headers.get('cache-control'), 'public, max-age=86400, immutable')
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)

    const partial = await server.request(`/api/media/${created.id}`, { headers: { Range: 'bytes=4-11' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), `bytes 4-11/${bytes.length}`)
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(4, 12))

    const unsatisfiable = await server.request(`/api/media/${created.id}`, { headers: { Range: 'bytes=999-' } })
    assert.equal(unsatisfiable.status, 416)
  } finally {
    await server.close()
  }
})

test('serves the production SPA without exposing paths outside dist', async () => {
  const server = await startTestServer()
  try {
    mkdirSync(join(server.config.staticDir, 'assets'), { recursive: true })
    writeFileSync(join(server.config.staticDir, 'index.html'), '<!doctype html><title>Infinite Slop test</title><div id="root"></div>')
    writeFileSync(join(server.config.staticDir, 'assets', 'app-abcdefgh.js'), 'console.log("ok")')
    writeFileSync(join(server.config.staticDir, 'assets', 'clip.mp4'), Buffer.from('0123456789abcdef'))

    const home = await server.request('/', { headers: { Accept: 'text/html' } })
    assert.equal(home.status, 200)
    assert.equal(home.headers.get('cache-control'), 'no-cache')
    assert.match(await home.text(), /Infinite Slop test/u)

    const routeFallback = await server.request('/channel/live', { headers: { Accept: 'text/html' } })
    assert.equal(routeFallback.status, 200)
    assert.match(await routeFallback.text(), /Infinite Slop test/u)

    const asset = await server.request('/assets/app-abcdefgh.js')
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    const tag = asset.headers.get('etag')
    assert.ok(tag)
    const notModified = await server.request('/assets/app-abcdefgh.js', { headers: { 'If-None-Match': tag } })
    assert.equal(notModified.status, 304)

    const partial = await server.request('/assets/clip.mp4', { headers: { Range: 'bytes=3-7' } })
    assert.equal(partial.status, 206)
    assert.equal(await partial.text(), '34567')

    for (const path of ['/assets/missing.js', '/.git/config', '/data/channel.sqlite', '/server/index.ts']) {
      const response = await server.request(path, { headers: { Accept: 'text/html' } })
      assert.equal(response.status, 404, path)
      assert.match(response.headers.get('content-type') || '', /^application\/json/u)
    }
  } finally {
    await server.close()
  }
})
