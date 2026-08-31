import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { once } from 'node:events'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { dirname } from 'node:path'
import { finished } from 'node:stream/promises'
import type { IdeaRecord } from './types.js'

export type GenerationProgress = {
  stage: string
  requestId?: string
}

export type GeneratedVideo = {
  videoUrl: string | null
  videoPath: string | null
  posterUrl: string | null
  durationSeconds: number
  providerRequestId: string | null
}

export interface VideoProvider {
  readonly name: 'mock' | 'fal' | 'orange'
  generate(
    idea: IdeaRecord,
    onProgress: (progress: GenerationProgress) => void,
    signal: AbortSignal,
  ): Promise<GeneratedVideo>
}

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code)
    this.name = 'ProviderError'
  }
}

export function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function isBlockedAddress(address: string) {
  const lower = address.toLocaleLowerCase('en')
  if (lower.startsWith('::ffff:')) return isBlockedAddress(lower.slice('::ffff:'.length))
  if (isIP(lower) === 4) {
    return /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(lower)
  }
  if (isIP(lower) === 6) {
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')
  }
  return true
}

async function validateDownloadUrl(url: URL, trustedOrigins: ReadonlySet<string>) {
  if (trustedOrigins.has(url.origin)) return
  const hostname = url.hostname.toLocaleLowerCase('en')
  if (url.protocol !== 'https:' || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new ProviderError('unsafe_provider_video_url', false)
  }
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new ProviderError('unsafe_provider_video_url', false)
    return
  }
  let addresses
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new ProviderError('provider_video_host_unresolved', true)
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new ProviderError('unsafe_provider_video_url', false)
  }
}

export type DownloadVideoOptions = {
  fetchImpl?: typeof fetch
  headers?: RequestInit['headers']
  maximumBytes?: number
  maximumRedirects?: number
  trustedOrigins?: ReadonlySet<string>
}

export async function downloadVideo(
  remoteUrl: string,
  destination: string,
  signal: AbortSignal,
  options: DownloadVideoOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch
  const maximumBytes = options.maximumBytes ?? 250 * 1024 * 1024
  const maximumRedirects = options.maximumRedirects ?? 5
  const trustedOrigins = options.trustedOrigins ?? new Set<string>()
  let currentUrl: URL
  try {
    currentUrl = new URL(remoteUrl)
  } catch {
    throw new ProviderError('unsafe_provider_video_url', false)
  }

  let response: Response | undefined
  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    await validateDownloadUrl(currentUrl, trustedOrigins)
    response = await fetchImpl(currentUrl, { headers: options.headers, signal, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location || redirects === maximumRedirects) {
      throw new ProviderError('provider_video_redirect_limit', false)
    }
    try {
      await response.body?.cancel()
      currentUrl = new URL(location, currentUrl)
    } catch {
      throw new ProviderError('unsafe_provider_video_redirect', false)
    }
  }

  if (!response?.ok || !response.body) {
    const status = response?.status ?? 0
    throw new ProviderError(`video_download_http_${status}`, status === 408 || status === 429 || status >= 500)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en') || ''
  const requiresMagicCheck = contentType === 'application/octet-stream'
  let mediaType: 'mp4' | 'webm' = contentType.includes('webm') ? 'webm' : 'mp4'
  if (!contentType.startsWith('video/') && !requiresMagicCheck) {
    throw new ProviderError('provider_result_is_not_video', false)
  }
  const declaredSize = Number.parseInt(response.headers.get('content-length') || '0', 10)
  if (declaredSize > maximumBytes) throw new ProviderError('provider_video_too_large', false)

  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.partial`
  if (existsSync(temporary)) unlinkSync(temporary)
  const output = createWriteStream(temporary, { flags: 'wx' })
  const outputFinished = finished(output)
  void outputFinished.catch(() => undefined)
  let downloaded = 0
  let prefix = Buffer.alloc(0)
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      downloaded += chunk.byteLength
      if (downloaded > maximumBytes) throw new ProviderError('provider_video_too_large', false)
      if (prefix.length < 16) prefix = Buffer.concat([prefix, Buffer.from(chunk)]).subarray(0, 16)
      if (!output.write(chunk)) await once(output, 'drain')
    }
    output.end()
    await outputFinished
    if (declaredSize > 0 && downloaded !== declaredSize) throw new ProviderError('provider_video_truncated', true)
    if (downloaded === 0) throw new ProviderError('provider_result_is_not_video', false)
    if (requiresMagicCheck) {
      const isMp4 = prefix.length >= 8 && prefix.subarray(4, 8).toString('ascii') === 'ftyp'
      const isWebm = prefix.length >= 4 && prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      if (!isMp4 && !isWebm) throw new ProviderError('provider_result_is_not_video', false)
      mediaType = isWebm ? 'webm' : 'mp4'
    }
    renameSync(temporary, destination)
    return { mediaType, bytes: downloaded }
  } catch (error) {
    output.destroy()
    if (existsSync(temporary)) unlinkSync(temporary)
    if (error instanceof ProviderError || signal.aborted) throw error
    throw new ProviderError('provider_video_transfer_failed', true)
  }
}
