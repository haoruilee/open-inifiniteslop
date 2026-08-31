import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, extname, join } from 'node:path'
import { finished } from 'node:stream/promises'
import { ApiError, createFalClient, type QueueStatus } from '@fal-ai/client'
import type { RuntimeConfig } from './config.js'
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
  readonly name: 'mock' | 'fal'
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

function delay(milliseconds: number, signal: AbortSignal) {
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

export class MockVideoProvider implements VideoProvider {
  readonly name = 'mock' as const

  constructor(private readonly generationDelayMs = 800) {}

  async generate(
    idea: IdeaRecord,
    onProgress: (progress: GenerationProgress) => void,
    signal: AbortSignal,
  ): Promise<GeneratedVideo> {
    onProgress({ stage: 'mock_rendering' })
    await delay(this.generationDelayMs, signal)
    const variant = ((idea.id - 1) % 3) + 1
    return {
      videoUrl: `/assets/mock-loop-${variant}.mp4`,
      videoPath: null,
      posterUrl: '/assets/tv-frame.png',
      durationSeconds: 6,
      providerRequestId: `mock-${idea.id}-${idea.generationAttempts}`,
    }
  }
}

type FalVideoOutput = {
  video?: {
    url?: string
    content_type?: string
    file_name?: string
  }
}

function isBlockedHost(hostname: string) {
  const lower = hostname.toLocaleLowerCase('en')
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return true
  if (isIP(lower) === 4) {
    return /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(lower)
  }
  if (isIP(lower) === 6) return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')
  return false
}

async function downloadVideo(
  remoteUrl: string,
  destination: string,
  signal: AbortSignal,
  maximumBytes = 250 * 1024 * 1024,
) {
  const parsed = new URL(remoteUrl)
  if (parsed.protocol !== 'https:' || isBlockedHost(parsed.hostname)) {
    throw new ProviderError('unsafe_provider_video_url', false)
  }

  const response = await fetch(parsed, { signal, redirect: 'follow' })
  const finalUrl = new URL(response.url)
  if (finalUrl.protocol !== 'https:' || isBlockedHost(finalUrl.hostname)) {
    throw new ProviderError('unsafe_provider_video_redirect', false)
  }
  if (!response.ok || !response.body) {
    throw new ProviderError(`video_download_http_${response.status}`, response.status === 429 || response.status >= 500)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en') || ''
  if (!contentType.startsWith('video/')) throw new ProviderError('provider_result_is_not_video', false)
  const declaredSize = Number.parseInt(response.headers.get('content-length') || '0', 10)
  if (declaredSize > maximumBytes) throw new ProviderError('provider_video_too_large', false)

  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.partial`
  if (existsSync(temporary)) unlinkSync(temporary)
  const output = createWriteStream(temporary, { flags: 'wx' })
  let downloaded = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      downloaded += chunk.byteLength
      if (downloaded > maximumBytes) throw new ProviderError('provider_video_too_large', false)
      if (!output.write(chunk)) await new Promise<void>((resolve) => output.once('drain', resolve))
    }
    output.end()
    await finished(output)
    renameSync(temporary, destination)
  } catch (error) {
    output.destroy()
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}

export class FalVideoProvider implements VideoProvider {
  readonly name = 'fal' as const
  private readonly client

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly mediaDir: string,
    private readonly timeoutMs: number,
  ) {
    this.client = createFalClient({
      credentials: apiKey,
      retry: { maxRetries: 2, baseDelay: 500, maxDelay: 5_000 },
    })
  }

  async generate(
    idea: IdeaRecord,
    onProgress: (progress: GenerationProgress) => void,
    signal: AbortSignal,
  ): Promise<GeneratedVideo> {
    let requestId: string | undefined
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs)
    const providerSignal = AbortSignal.any([signal, timeoutSignal])
    try {
      const result = await this.client.subscribe(this.model, {
        input: {
          prompt: idea.body,
          duration: 5,
          resolution: '768P',
          aspect_ratio: '9:16',
          enable_safety_checker: true,
          prompt_expansion_mode: 'balanced',
        },
        logs: true,
        mode: 'polling',
        pollInterval: 1_000,
        timeout: this.timeoutMs,
        abortSignal: providerSignal,
        onEnqueue: (id) => {
          requestId = id
          onProgress({ stage: 'provider_queued', requestId: id })
        },
        onQueueUpdate: (status: QueueStatus) => {
          requestId = status.request_id
          onProgress({
            stage: status.status === 'IN_QUEUE'
              ? `provider_queue_${status.queue_position}`
              : status.status === 'IN_PROGRESS'
                ? 'provider_rendering'
                : 'provider_complete',
            requestId: status.request_id,
          })
        },
      })
      requestId = result.requestId
      const output = result.data as FalVideoOutput
      const remoteUrl = output.video?.url
      if (!remoteUrl) throw new ProviderError('provider_result_missing_video', false)
      onProgress({ stage: 'downloading_video', requestId })

      const contentType = output.video?.content_type || ''
      const sourceExtension = extname(output.video?.file_name || '').toLocaleLowerCase('en')
      const extension = contentType.includes('webm') || sourceExtension === '.webm' ? '.webm' : '.mp4'
      const destination = join(this.mediaDir, `${idea.id}${extension}`)
      await downloadVideo(remoteUrl, destination, providerSignal)
      return {
        videoUrl: `/api/media/${idea.id}`,
        videoPath: destination,
        posterUrl: '/assets/tv-frame.png',
        durationSeconds: 5,
        providerRequestId: requestId,
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (timeoutSignal.aborted) throw new ProviderError('provider_timeout', true)
      if (signal.aborted) throw new ProviderError('generation_aborted', true)
      const retryable = error instanceof ApiError
        ? !error.isUserTimeout && (error.status === 429 || error.status >= 500)
        : error instanceof TypeError
      throw new ProviderError('provider_request_failed', retryable)
    }
  }
}

export function createVideoProvider(config: RuntimeConfig): VideoProvider {
  if (config.provider === 'mock') return new MockVideoProvider(config.mockGenerationDelayMs)
  if (!config.falKey) throw new Error('VIDEO_PROVIDER=fal requires FAL_KEY in the server environment')
  return new FalVideoProvider(config.falKey, config.falModel, config.mediaDir, config.providerTimeoutMs)
}
