import { createReadStream, statSync, type Stats } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export class StaticRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'StaticRequestError'
  }
}

function safePath(rawPathname: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPathname)
  } catch {
    throw new StaticRequestError(400, 'Invalid URL encoding')
  }
  if (decoded.includes('\0')) throw new StaticRequestError(400, 'Invalid URL path')
  const segments = decoded.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new StaticRequestError(400, 'Invalid URL path')
  }
  return decoded
}

function fileStats(path: string): Stats | null {
  try {
    const stats = statSync(path)
    return stats.isFile() ? stats : null
  } catch {
    return null
  }
}

function etag(stats: Stats) {
  return `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`
}

function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  stats: Stats,
  cacheControl: string,
) {
  const tag = etag(stats)
  response.setHeader('ETag', tag)
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Type', mimeTypes[extname(path).toLocaleLowerCase('en')] || 'application/octet-stream')
  response.setHeader('Accept-Ranges', 'bytes')
  if (request.headers['if-none-match'] === tag) {
    response.statusCode = 304
    response.end()
    return
  }

  let start = 0
  let end = stats.size - 1
  const range = request.headers.range
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
  response.setHeader('Content-Length', String(end - start + 1))
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = createReadStream(path, { start, end })
  stream.once('error', () => response.destroy())
  stream.pipe(response)
}

export function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  staticDirectory: string,
  rawPathname: string,
  normalizedPathname: string,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const pathname = safePath(rawPathname)
  const root = resolve(staticDirectory)
  const rootPrefix = `${root}${sep}`
  const requestedRelative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const requestedPath = resolve(root, requestedRelative)
  if (requestedPath !== root && !requestedPath.startsWith(rootPrefix)) {
    throw new StaticRequestError(400, 'Invalid URL path')
  }

  const requestedStats = fileStats(requestedPath)
  if (requestedStats) {
    const isIndex = requestedPath === resolve(root, 'index.html')
    const isHashedAsset = /(?:^|\/)assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/u.test(requestedPath)
    const cacheControl = isIndex
      ? 'no-cache'
      : isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600, must-revalidate'
    sendFile(request, response, requestedPath, requestedStats, cacheControl)
    return true
  }

  const acceptsHtml = request.headers.accept?.includes('text/html') ?? false
  const isAssetRequest = normalizedPathname.startsWith('/assets/') || extname(normalizedPathname) !== ''
  const isReservedPath = /^\/(?:\.git|data|server|server-dist|src)(?:\/|$)/u.test(normalizedPathname)
  if (!acceptsHtml || isAssetRequest || isReservedPath) return false
  const indexPath = resolve(root, 'index.html')
  const indexStats = fileStats(indexPath)
  if (!indexStats) return false
  sendFile(request, response, indexPath, indexStats, 'no-cache')
  return true
}
