import { extname, join } from 'node:path'
import { ApiError, createFalClient, type QueueStatus } from '@fal-ai/client'
import type { RuntimeConfig } from './config.js'
import { resolveOrangeApiKey } from './credentials.js'
import { OrangeVideoProvider } from './orange-video-provider.js'
import {
  ProviderError,
  delay,
  downloadVideo,
  type GeneratedVideo,
  type GenerationProgress,
  type VideoProvider,
} from './provider-shared.js'
import type { IdeaRecord } from './types.js'

export { ProviderError, downloadVideo } from './provider-shared.js'
export type { GeneratedVideo, GenerationProgress, VideoProvider } from './provider-shared.js'

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
  if (config.provider === 'orange') {
    const apiKey = resolveOrangeApiKey(config.orangeApiKey, config.orangeApiBase)
    if (!apiKey) throw new Error('VIDEO_PROVIDER=orange requires an OrangeAPI credential')
    return new OrangeVideoProvider({
      apiKey,
      baseUrl: config.orangeApiBase,
      model: config.orangeModel,
      mediaDir: config.mediaDir,
      durationSeconds: config.orangeDurationSeconds,
      resolution: config.orangeResolution,
      ratio: config.orangeRatio,
      watermark: config.orangeWatermark,
      pollIntervalMs: config.orangePollIntervalMs,
      timeoutMs: config.providerTimeoutMs,
    })
  }
  if (!config.falKey) throw new Error('VIDEO_PROVIDER=fal requires FAL_KEY in the server environment')
  return new FalVideoProvider(config.falKey, config.falModel, config.mediaDir, config.providerTimeoutMs)
}
