import { ChannelDatabase } from './database.js'
import { ProviderError, type VideoProvider } from './video-provider.js'

export type OrchestratorOptions = {
  generationConcurrency: number
  bufferTarget: number
  workerIntervalMs: number
  rotationIntervalMs: number
  maximumAttempts?: number
}

type ActiveGeneration = {
  controller: AbortController
  promise: Promise<void>
}

export class ChannelOrchestrator {
  private readonly active = new Map<number, ActiveGeneration>()
  private workerTimer: NodeJS.Timeout | null = null
  private rotationTimer: NodeJS.Timeout | null = null
  private filling = false
  private rotating = false
  private stopping = false

  constructor(
    private readonly database: ChannelDatabase,
    private readonly provider: VideoProvider,
    private readonly options: OrchestratorOptions,
    private readonly onChange: () => void,
  ) {}

  start() {
    if (this.workerTimer || this.rotationTimer) return
    this.stopping = false
    if (this.database.requeueInterruptedGeneration().changed) this.onChange()
    void this.rotate()
    void this.fillBuffer()
    this.workerTimer = setInterval(() => void this.fillBuffer(), this.options.workerIntervalMs)
    this.rotationTimer = setInterval(() => void this.rotate(), this.options.rotationIntervalMs)
    this.workerTimer.unref()
    this.rotationTimer.unref()
  }

  async runOnce() {
    await this.rotate()
    await this.fillBuffer()
  }

  private async rotate() {
    if (this.rotating || this.stopping) return
    this.rotating = true
    try {
      if (this.database.advancePlayback().changed) this.onChange()
    } finally {
      this.rotating = false
    }
  }

  private async fillBuffer() {
    if (this.filling || this.stopping) return
    this.filling = true
    try {
      let counts = this.database.pipelineCounts()
      let buffered = counts.generating + counts.ready + counts.playing
      while (
        !this.stopping
        && this.active.size < this.options.generationConcurrency
        && buffered < this.options.bufferTarget
      ) {
        const idea = this.database.claimNextForGeneration(this.provider.name)
        if (!idea) break
        buffered += 1
        this.onChange()
        this.launch(idea.id)
        counts = this.database.pipelineCounts()
        buffered = counts.generating + counts.ready + counts.playing
      }
    } finally {
      this.filling = false
    }
  }

  private launch(ideaId: number) {
    const controller = new AbortController()
    const promise = this.generate(ideaId, controller.signal)
      .finally(() => {
        this.active.delete(ideaId)
        if (!this.stopping) setImmediate(() => void this.runOnce())
      })
    this.active.set(ideaId, { controller, promise })
  }

  private async generate(ideaId: number, signal: AbortSignal) {
    const idea = this.database.getIdea(ideaId)
    try {
      const video = await this.provider.generate(idea, (progress) => {
        if (this.database.updateGenerationProgress(ideaId, progress.stage, progress.requestId).changed) {
          this.onChange()
        }
      }, signal)
      this.database.completeGeneration(ideaId, video)
      this.onChange()
    } catch (error) {
      const retryable = error instanceof ProviderError ? error.retryable : false
      const code = error instanceof ProviderError ? error.code : 'generation_failed'
      const attempts = this.database.getIdea(ideaId).generationAttempts
      const maximumAttempts = this.options.maximumAttempts ?? 3
      const retryDelay = retryable && attempts < maximumAttempts
        ? Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
        : null
      if (this.database.failGeneration(ideaId, code, retryDelay).changed) this.onChange()
    }
  }

  async stop() {
    if (this.stopping) return
    this.stopping = true
    if (this.workerTimer) clearInterval(this.workerTimer)
    if (this.rotationTimer) clearInterval(this.rotationTimer)
    this.workerTimer = null
    this.rotationTimer = null
    for (const { controller } of this.active.values()) controller.abort(new Error('server_shutdown'))
    await Promise.allSettled([...this.active.values()].map(({ promise }) => promise))
    this.active.clear()
  }
}
