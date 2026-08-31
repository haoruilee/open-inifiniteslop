import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { RuntimeConfig } from './config.js'
import {
  ChannelDatabase,
  DuplicateSubmissionError,
  InvalidStateError,
  NotFoundError,
} from './database.js'
import { moderatePrompt, normalizePrompt } from './moderation.js'
import { FixedWindowRateLimiter } from './rate-limit.js'
import { SseHub } from './sse.js'
import { serveStatic, StaticRequestError } from './static.js'
import type { ChannelSnapshot, PublicIdea } from './types.js'

const nicknameSchema = z.string()
  .regex(/^[A-Za-z0-9_-]{1,18}$/u, 'Use 1-18 letters, numbers, _ or -')

const messageSchema = z.string()
  .transform(normalizePrompt)
  .refine((value) => value.length > 0, 'Prompt cannot be empty')
  .refine((value) => Array.from(value).length <= 200, 'Prompt must be at most 200 characters')
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069]/u.test(value), 'Prompt contains unsupported control characters')

const promptSchema = z.object({
  nickname: nicknameSchema,
  message: messageSchema,
}).strict()

const compatibilityPromptSchema = z.object({
  user: nicknameSchema,
  msg: messageSchema,
  vip: z.boolean().optional(),
}).strict()

const voteSchema = z.object({}).strict()
const compatibilityVoteSchema = z.object({
  id: z.coerce.number().int().positive(),
  cid: z.string().max(128).optional(),
}).strict()
const likeSchema = z.object({}).strict()
const compatibilityLikeSchema = z.object({ seg: z.string().max(128).optional() }).strict()
const moderationSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).max(160).optional(),
}).strict()

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

function securityHeaders(response: ServerResponse, requestId: string) {
  response.setHeader('X-Request-Id', requestId)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  )
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  cacheControl = 'no-store',
) {
  const encoded = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Length', Buffer.byteLength(encoded))
  response.end(encoded)
}

function apiError(response: ServerResponse, error: HttpError) {
  json(response, error.status, {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  })
}

function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  database: ChannelDatabase,
  mediaRoot: string,
  ideaId: number,
) {
  const idea = database.getIdea(ideaId)
  if (!idea.videoPath) throw new NotFoundError('Video not found')
  const absoluteRoot = `${resolve(mediaRoot)}${sep}`
  const absolutePath = resolve(idea.videoPath)
  if (!absolutePath.startsWith(absoluteRoot)) throw new NotFoundError('Video not found')

  let stats
  try {
    stats = statSync(absolutePath)
  } catch {
    throw new NotFoundError('Video not found')
  }
  if (!stats.isFile()) throw new NotFoundError('Video not found')

  const mimeType = extname(absolutePath).toLocaleLowerCase('en') === '.webm' ? 'video/webm' : 'video/mp4'
  const range = request.headers.range
  let start = 0
  let end = stats.size - 1
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/u)
    if (!match || (!match[1] && !match[2])) {
      response.statusCode = 416
      response.setHeader('Content-Range', `bytes */${stats.size}`)
      response.end()
      return
    }
    if (!match[1]) {
      const suffix = Number.parseInt(match[2], 10)
      start = Math.max(0, stats.size - suffix)
    } else {
      start = Number.parseInt(match[1], 10)
    }
    if (match[2]) end = Math.min(stats.size - 1, Number.parseInt(match[2], 10))
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stats.size) {
      response.statusCode = 416
      response.setHeader('Content-Range', `bytes */${stats.size}`)
      response.end()
      return
    }
    response.statusCode = 206
    response.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`)
  } else {
    response.statusCode = 200
  }
  response.setHeader('Content-Type', mimeType)
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Cache-Control', 'public, max-age=86400, immutable')
  response.setHeader('Content-Length', String(end - start + 1))
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = createReadStream(absolutePath, { start, end })
  stream.once('error', () => response.destroy())
  stream.pipe(response)
}

async function readJson(request: IncomingMessage, maxBytes = 4_096): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLocaleLowerCase('en')
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  }

  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      tooLarge = true
      continue
    }
    chunks.push(buffer)
  }
  if (tooLarge) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large')

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON')
  }
}

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const rawFields = z.flattenError(result.error).fieldErrors
  const fields = Object.fromEntries(
    Object.entries(rawFields).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])),
  )
  throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', fields)
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>()
  if (!header) return cookies
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    try {
      cookies.set(key, decodeURIComponent(value))
    } catch {
      continue
    }
  }
  return cookies
}

function visitorSession(request: IncomingMessage, response: ServerResponse, secure: boolean) {
  const candidate = parseCookies(request.headers.cookie).get('islop_vid')
  const visitorId = candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate)
    ? candidate
    : randomUUID()
  if (candidate !== visitorId) {
    response.setHeader(
      'Set-Cookie',
      `islop_vid=${encodeURIComponent(visitorId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}`,
    )
  }
  return visitorId
}

function remoteAddress(request: IncomingMessage, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for']
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',', 1)[0]
    if (first?.trim()) return first.trim()
  }
  return request.socket.remoteAddress || 'unknown'
}

function requireSameOrigin(request: IncomingMessage) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new HttpError(403, 'CROSS_SITE_REQUEST', 'Cross-site writes are not allowed')
  }
  const origin = request.headers.origin
  if (!origin) return
  const host = request.headers.host
  if (!host) throw new HttpError(403, 'ORIGIN_MISMATCH', 'Request origin is not allowed')
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new HttpError(403, 'ORIGIN_MISMATCH', 'Request origin is not allowed')
  }
  if (parsed.host !== host) throw new HttpError(403, 'ORIGIN_MISMATCH', 'Request origin is not allowed')
}

function requireAdmin(request: IncomingMessage, configuredToken: string | null) {
  if (!configuredToken) throw new HttpError(503, 'MODERATION_DISABLED', 'Set ADMIN_TOKEN to use moderation controls')
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/iu)?.[1]
  const supplied = bearer || (Array.isArray(request.headers['x-admin-token'])
    ? request.headers['x-admin-token'][0]
    : request.headers['x-admin-token'])
  if (!supplied) throw new HttpError(401, 'ADMIN_AUTH_REQUIRED', 'Administrator authentication required')
  const expectedBuffer = Buffer.from(configuredToken)
  const suppliedBuffer = Buffer.from(supplied)
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    throw new HttpError(403, 'ADMIN_AUTH_INVALID', 'Administrator authentication failed')
  }
}

function compatibilityStatus(snapshot: ChannelSnapshot) {
  const now = snapshot.nowPlaying
  const generating = snapshot.generatingNow[0] ?? null
  return {
    live: snapshot.live.isLive,
    paused: false,
    viewers_active: snapshot.live.viewers > 0,
    now_playing: now?.message ?? null,
    now_generated_at: now ? Math.floor(now.createdAt / 1_000) : null,
    now_replay: now?.status === 'aired',
    now_chat: now?.user ?? null,
    generating: generating?.message ?? null,
    generating_chat: generating?.user ?? null,
    generating_now: snapshot.generatingNow.map((idea) => ({ c: idea.message, at: Math.floor(idea.createdAt / 1_000) })),
    playing_next: snapshot.playingNext.map((idea) => ({ c: idea.message, at: Math.floor(idea.createdAt / 1_000) })),
    queue: snapshot.queue.slice(0, 20).map((idea) => ({
      id: idea.id,
      u: idea.user,
      m: idea.message,
      at: Math.floor(idea.createdAt / 1_000),
      v: idea.votes,
    })),
    likes: now ? { [`${String(now.id).padStart(6, '0')}.mp4`]: snapshot.live.likes } : {},
    buffer_clips: snapshot.playingNext.length,
    generating_clips: snapshot.generatingNow.length,
    buffer_secs: snapshot.playingNext.reduce((total, idea) => total + (idea.durationSeconds ?? 10), 0),
    generated_total: snapshot.playingNext.length + snapshot.generatingNow.length + (now ? 1 : 0),
    chat_messages: snapshot.chat.length,
    last_error: null,
    recent: snapshot.chat.slice(-20).reverse().map((idea) => ({
      prompt: idea.message,
      source: idea.user,
      at: new Date(idea.createdAt).toISOString().replace('T', ' ').slice(0, 19),
    })),
    ts: Math.floor(snapshot.serverTime / 1_000),
  }
}

function moderationState(idea: PublicIdea) {
  if (idea.status === 'queued') return { s: 'queued', q: idea.votes }
  if (idea.status === 'rejected' || idea.status === 'failed') return { s: 'rejected', why: idea.status }
  if (idea.status === 'pending_review') return 'pending'
  if (idea.status === 'generating') return 'generating'
  if (idea.status === 'playing' || idea.status === 'aired') return 'aired'
  return 'seen'
}

export type ChannelHttpApp = {
  server: Server
  hub: SseHub
  snapshot: () => ChannelSnapshot
  broadcast: () => void
  close: () => Promise<void>
}

export function createChannelHttpApp(database: ChannelDatabase, config: RuntimeConfig): ChannelHttpApp {
  const hub = new SseHub()
  const limiter = new FixedWindowRateLimiter(config.rateLimitWindowMs)
  const snapshot = () => {
    const value = database.snapshot(config.provider)
    return {
      ...value,
      live: { ...value.live, viewers: Math.max(1, hub.size) },
    }
  }
  const broadcast = () => hub.broadcast(snapshot())

  const server = createServer(async (request, response) => {
    const startedAt = performance.now()
    const requestId = randomUUID()
    securityHeaders(response, requestId)

    try {
      const url = new URL(request.url || '/', 'http://localhost')
      const pathname = url.pathname
      const method = request.method || 'GET'
      const isApi = pathname.startsWith('/api/') || pathname === '/status.json'
      if (isApi) response.setHeader('Cache-Control', 'no-store')
      const visitorId = isApi ? visitorSession(request, response, config.secureCookies) : ''
      const ip = remoteAddress(request, config.trustProxy)

      const limit = (scope: 'prompt' | 'vote' | 'like', maximum: number) => {
        const result = limiter.take(`${scope}:${ip}:${visitorId}`, maximum)
        if (result.allowed) return
        response.setHeader('Retry-After', String(result.retryAfterSeconds))
        throw new HttpError(429, 'RATE_LIMITED', 'Too many requests; try again shortly')
      }

      const mediaMatch = pathname.match(/^\/api\/media\/(\d+)$/u)
      if ((method === 'GET' || method === 'HEAD') && mediaMatch) {
        serveMedia(request, response, database, config.mediaDir, Number(mediaMatch[1]))
        return
      }

      if (method === 'GET' && pathname === '/api/health') {
        json(response, 200, {
          status: 'ok',
          database: 'ok',
          revision: database.getRevision(),
          provider: config.provider,
        })
        return
      }

      if (method === 'GET' && pathname === '/api/state') {
        json(response, 200, snapshot())
        return
      }

      if (method === 'GET' && pathname === '/status.json') {
        json(response, 200, compatibilityStatus(snapshot()), 'public, max-age=2')
        return
      }

      if (method === 'GET' && pathname === '/api/chat') {
        if (url.searchParams.has('before') || url.searchParams.has('limit')) {
          const rawBefore = url.searchParams.get('before')
          const before = rawBefore && /^\d+$/u.test(rawBefore) ? Number(rawBefore) : null
          if (rawBefore && (!before || !Number.isSafeInteger(before))) {
            throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid chat cursor')
          }
          const rawLimit = Number.parseInt(url.searchParams.get('limit') || '100', 10)
          const limit = Number.isSafeInteger(rawLimit) ? rawLimit : 100
          json(response, 200, database.listChatPage(before, limit), 'private, max-age=0')
          return
        }
        const state = snapshot()
        const since = Math.max(0, Number.parseInt(url.searchParams.get('since') || '0', 10) || 0)
        const messages = state.chat.filter((idea) => idea.id > since).slice(-50)
        const mineIds = (url.searchParams.get('mine') || '')
          .split(',')
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isSafeInteger(value) && value > 0)
          .slice(0, 10)
        const allIdeas = [state.nowPlaying, ...state.playingNext, ...state.generatingNow, ...state.queue, ...state.chat]
          .filter((idea): idea is PublicIdea => idea !== null)
        const ideaMap = new Map(allIdeas.map((idea) => [idea.id, idea]))
        const mine = mineIds.length === 0
          ? null
          : Object.fromEntries(mineIds.map((id) => [String(id), ideaMap.has(id) ? moderationState(ideaMap.get(id)!) : 'rejected']))
        json(response, 200, {
          msgs: messages.map((idea) => ({
            id: idea.id,
            user: idea.user,
            msg: idea.message,
            at: new Date(idea.createdAt).toISOString().replace('T', ' ').slice(0, 19),
          })),
          mine,
          viewers: state.live.viewers,
        })
        return
      }

      if (method === 'GET' && pathname === '/api/events') {
        hub.subscribe(request, response, snapshot, () => setImmediate(broadcast))
        return
      }

      if (method === 'GET' && pathname === '/api/moderation') {
        requireAdmin(request, config.adminToken)
        const status = url.searchParams.get('status') === 'rejected' ? 'rejected' : 'pending_review'
        json(response, 200, { items: database.listModeration(status), revision: database.getRevision() })
        return
      }

      if (method === 'POST') requireSameOrigin(request)

      if (method === 'POST' && (pathname === '/api/prompts' || pathname === '/api/chat')) {
        limit('prompt', config.promptRateLimit)
        const body = await readJson(request)
        const input = pathname === '/api/chat'
          ? (() => {
              const compatibility = validate(compatibilityPromptSchema, body)
              return { nickname: compatibility.user, message: compatibility.msg }
            })()
          : validate(promptSchema, body)
        const result = database.createSubmission(
          visitorId,
          input.nickname,
          input.message,
          moderatePrompt(input.message),
        )
        broadcast()
        if (pathname === '/api/chat') {
          json(response, 201, { id: result.idea.id, status: result.idea.status })
        } else {
          json(response, 201, { idea: result.idea, revision: result.revision })
        }
        return
      }

      const voteMatch = pathname.match(/^\/api\/queue\/(\d+)\/votes$/u)
      if (method === 'POST' && voteMatch) {
        limit('vote', config.voteRateLimit)
        validate(voteSchema, await readJson(request))
        const result = database.vote(Number(voteMatch[1]), visitorId)
        broadcast()
        json(response, 200, { id: result.idea.id, votes: result.idea.votes, revision: result.revision })
        return
      }

      if (method === 'POST' && pathname === '/api/vote') {
        limit('vote', config.voteRateLimit)
        const input = validate(compatibilityVoteSchema, await readJson(request))
        const result = database.vote(input.id, visitorId)
        broadcast()
        json(response, 200, { votes: result.idea.votes })
        return
      }

      if (method === 'POST' && (pathname === '/api/likes' || pathname === '/api/like')) {
        limit('like', config.likeRateLimit)
        const body = await readJson(request)
        if (pathname === '/api/like') validate(compatibilityLikeSchema, body)
        else validate(likeSchema, body)
        const result = database.like()
        broadcast()
        json(response, 200, result)
        return
      }

      const moderationMatch = pathname.match(/^\/api\/moderation\/(\d+)$/u)
      if (method === 'POST' && moderationMatch) {
        requireAdmin(request, config.adminToken)
        const input = validate(moderationSchema, await readJson(request))
        const result = database.moderate(Number(moderationMatch[1]), input.action, input.reason ?? `manual_${input.action}`)
        broadcast()
        json(response, 200, { idea: result.idea, revision: result.revision })
        return
      }

      if (pathname.startsWith('/api/') || pathname === '/status.json') {
        throw new HttpError(404, 'NOT_FOUND', 'API route not found')
      }
      const rawPathname = (request.url || '/').split('?', 1)[0]
      if (serveStatic(request, response, config.staticDir, rawPathname, pathname)) return
      throw new HttpError(404, 'NOT_FOUND', 'Not found')
    } catch (error) {
      if (response.headersSent) {
        response.end()
        return
      }
      if (error instanceof HttpError) {
        apiError(response, error)
      } else if (error instanceof DuplicateSubmissionError) {
        apiError(response, new HttpError(409, 'DUPLICATE_PROMPT', error.message))
      } else if (error instanceof InvalidStateError) {
        apiError(response, new HttpError(409, 'INVALID_STATE', error.message))
      } else if (error instanceof NotFoundError) {
        apiError(response, new HttpError(404, 'NOT_FOUND', error.message))
      } else if (error instanceof StaticRequestError) {
        apiError(response, new HttpError(error.status, 'INVALID_STATIC_PATH', error.message))
      } else {
        console.error(JSON.stringify({ requestId, event: 'request_failed', error: error instanceof Error ? error.name : 'UnknownError' }))
        apiError(response, new HttpError(500, 'INTERNAL_ERROR', 'Internal server error'))
      }
    } finally {
      const durationMs = Math.round(performance.now() - startedAt)
      if (process.env.NODE_ENV !== 'test') {
        console.info(JSON.stringify({ requestId, method: request.method, path: request.url?.split('?', 1)[0], status: response.statusCode, durationMs }))
      }
    }
  })

  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000

  return {
    server,
    hub,
    snapshot,
    broadcast,
    close: async () => {
      if (!server.listening) {
        hub.close()
        return
      }
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
      hub.close()
      await closed
    },
  }
}
