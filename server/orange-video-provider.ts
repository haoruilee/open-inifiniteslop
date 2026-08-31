import { renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  ProviderError,
  delay,
  downloadVideo,
  type DownloadVideoOptions,
  type GeneratedVideo,
  type GenerationProgress,
  type VideoProvider,
} from './provider-shared.js'
import type { IdeaRecord } from './types.js'

export const orangeVideoModels = [
  'happyhorse-1.0-t2v',
  'wan2.7-t2v',
  'grok-imagine-video',
  'seedance-2-5',
  'seedance-2-0',
  'seedance-2-0-fast',
  'seedance-2-0-mini',
  'seedance-1-5-pro',
] as const

type OrangeVideoModel = (typeof orangeVideoModels)[number]

export type OrangeProviderOptions = {
  apiKey: string
  baseUrl: string
  model: string
  mediaDir: string
  durationSeconds: number
  resolution: string
  ratio: string
  watermark: boolean
  pollIntervalMs: number
  timeoutMs: number
  fetchImpl?: typeof fetch
  sleep?: typeof delay
  downloadOptions?: DownloadVideoOptions
  allowInsecureBaseUrl?: boolean
}

type JsonRecord = Record<string, unknown>

export const orangeBrowserUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 InfiniteSlop/0.1'

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function unwrap(payload: unknown) {
  const root = record(payload)
  if (!root) return { root: null, data: null }
  return { root, data: record(root.data) ?? root }
}

function taskIdFrom(payload: unknown) {
  const { root, data } = unwrap(payload)
  return stringValue(data?.task_id) ?? stringValue(root?.task_id)
}

function taskStateFrom(payload: unknown) {
  const { root, data } = unwrap(payload)
  const status = (stringValue(data?.status) ?? stringValue(root?.status))?.toLocaleUpperCase('en') ?? null
  const resultUrl = stringValue(data?.result_url) ?? stringValue(root?.result_url)
  return { status, resultUrl }
}

function progressStage(status: string) {
  if (status === 'PENDING' || status === 'QUEUED') return 'provider_queued'
  if (status === 'PROCESSING' || status === 'RUNNING' || status === 'IN_PROGRESS') return 'provider_rendering'
  return `provider_${status.toLocaleLowerCase('en').replace(/[^a-z0-9]+/gu, '_').slice(0, 80)}`
}

function retryDelay(response: Response, fallback: number) {
  const seconds = Number.parseFloat(response.headers.get('retry-after') || '')
  return Number.isFinite(seconds) ? Math.min(10_000, Math.max(250, seconds * 1_000)) : fallback
}

export class OrangeVideoProvider implements VideoProvider {
  readonly name = 'orange' as const
  private readonly baseUrl: URL
  private readonly model: OrangeVideoModel
  private readonly fetchImpl: typeof fetch
  private readonly sleep: typeof delay

  constructor(private readonly options: OrangeProviderOptions) {
    const normalizedBase = options.baseUrl.replace(/\/+$/u, '')
    try {
      this.baseUrl = new URL(`${normalizedBase}/`)
    } catch {
      throw new Error('ORANGE_API_BASE must be a valid URL')
    }
    if (this.baseUrl.protocol !== 'https:' && !options.allowInsecureBaseUrl) {
      throw new Error('ORANGE_API_BASE must use HTTPS')
    }
    if (!orangeVideoModels.includes(options.model as OrangeVideoModel)) {
      throw new Error('ORANGE_MODEL is not in the enabled text-to-video allowlist')
    }
    this.model = options.model as OrangeVideoModel
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? delay
  }

  private headers(includeContentType = false) {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.options.apiKey}`,
      'User-Agent': orangeBrowserUserAgent,
      ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  private endpoint(taskId?: string) {
    const suffix = taskId ? `video/generations/${encodeURIComponent(taskId)}` : 'video/generations'
    return new URL(suffix, this.baseUrl)
  }

  private async submit(idea: IdeaRecord, signal: AbortSignal) {
    const body = this.model === 'happyhorse-1.0-t2v'
      ? {
          model: this.model,
          prompt: idea.body,
          seconds: String(this.options.durationSeconds),
          resolution: this.options.resolution,
          ratio: this.options.ratio,
          watermark: this.options.watermark,
        }
      : {
          model: this.model,
          prompt: idea.body,
          duration: this.options.durationSeconds,
          resolution: this.options.resolution,
          ratio: this.options.ratio,
          watermark: this.options.watermark,
        }
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(body),
        redirect: 'error',
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw new ProviderError('orange_submission_ambiguous', false)
    }
    if (!response.ok) throw new ProviderError(`orange_submission_http_${response.status}`, false)
    const payload = await response.json().catch(() => null)
    const taskId = taskIdFrom(payload)
    if (!taskId) throw new ProviderError('orange_submission_missing_task_id', false)
    return taskId
  }

  private async poll(taskId: string, onProgress: (progress: GenerationProgress) => void, signal: AbortSignal) {
    let transientFailures = 0
    let earlyNotFound = 0
    const maximumEarlyNotFound = Math.min(15, Math.max(2, Math.ceil(30_000 / this.options.pollIntervalMs)))
    while (true) {
      let response: Response
      try {
        response = await this.fetchImpl(this.endpoint(taskId), {
          headers: this.headers(),
          redirect: 'error',
          signal,
        })
      } catch {
        if (signal.aborted) throw signal.reason
        transientFailures += 1
        onProgress({ stage: 'provider_poll_retry', requestId: taskId })
        await this.sleep(Math.min(10_000, this.options.pollIntervalMs * 2 ** Math.min(transientFailures, 4)), signal)
        continue
      }

      if (response.status === 404 && earlyNotFound < maximumEarlyNotFound) {
        earlyNotFound += 1
        await this.sleep(this.options.pollIntervalMs, signal)
        continue
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        transientFailures += 1
        onProgress({ stage: 'provider_poll_retry', requestId: taskId })
        await this.sleep(retryDelay(response, Math.min(10_000, this.options.pollIntervalMs * 2 ** Math.min(transientFailures, 4))), signal)
        continue
      }
      if (!response.ok) throw new ProviderError(`orange_poll_http_${response.status}`, false)
      transientFailures = 0

      const payload = await response.json().catch(() => null)
      const { status, resultUrl } = taskStateFrom(payload)
      if (!status) throw new ProviderError('orange_poll_missing_status', false)
      if (status === 'SUCCESS') {
        if (!resultUrl) throw new ProviderError('provider_result_missing_video', false)
        return resultUrl
      }
      if (status === 'FAILURE' || status === 'FAILED') {
        throw new ProviderError('orange_generation_failed', false)
      }
      onProgress({ stage: progressStage(status), requestId: taskId })
      await this.sleep(this.options.pollIntervalMs, signal)
    }
  }

  async generate(
    idea: IdeaRecord,
    onProgress: (progress: GenerationProgress) => void,
    signal: AbortSignal,
  ): Promise<GeneratedVideo> {
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs)
    const providerSignal = AbortSignal.any([signal, timeoutSignal])
    let taskId = idea.provider === this.name ? idea.providerRequestId : null
    try {
      if (!taskId) {
        taskId = await this.submit(idea, providerSignal)
        onProgress({ stage: 'provider_queued', requestId: taskId })
      } else {
        onProgress({ stage: 'provider_resuming', requestId: taskId })
      }
      const remoteUrl = await this.poll(taskId, onProgress, providerSignal)
      onProgress({ stage: 'downloading_video', requestId: taskId })
      const provisionalDestination = join(this.options.mediaDir, `${idea.id}.mp4`)
      const downloadHeaders = new Headers(this.options.downloadOptions?.headers)
      if (!downloadHeaders.has('User-Agent')) downloadHeaders.set('User-Agent', orangeBrowserUserAgent)
      const downloaded = await downloadVideo(remoteUrl, provisionalDestination, providerSignal, {
        ...this.options.downloadOptions,
        headers: downloadHeaders,
      })
      const destination = downloaded.mediaType === 'webm'
        ? join(this.options.mediaDir, `${idea.id}.webm`)
        : provisionalDestination
      if (destination !== provisionalDestination) renameSync(provisionalDestination, destination)
      return {
        videoUrl: `/api/media/${idea.id}`,
        videoPath: destination,
        posterUrl: '/assets/tv-frame.png',
        durationSeconds: this.options.durationSeconds,
        providerRequestId: taskId,
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (timeoutSignal.aborted) throw new ProviderError('provider_timeout', Boolean(taskId))
      if (signal.aborted) throw new ProviderError('generation_aborted', Boolean(taskId))
      throw new ProviderError('orange_provider_failed', Boolean(taskId))
    }
  }
}
