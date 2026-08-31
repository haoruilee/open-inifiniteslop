import assert from 'node:assert/strict'
import test from 'node:test'
import { ChannelDatabase } from '../database.js'
import { moderatePrompt } from '../moderation.js'
import { ChannelOrchestrator } from '../orchestrator.js'
import {
  MockVideoProvider,
  ProviderError,
  type GeneratedVideo,
  type GenerationProgress,
  type VideoProvider,
} from '../video-provider.js'
import type { IdeaRecord } from '../types.js'

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for orchestrator state')
}

function submit(database: ChannelDatabase, visitor: string, message: string) {
  return database.createSubmission(visitor, visitor, message, moderatePrompt(message)).idea
}

function mockResult(idea: IdeaRecord): GeneratedVideo {
  return {
    videoUrl: `/assets/mock-loop-${((idea.id - 1) % 3) + 1}.mp4`,
    videoPath: null,
    posterUrl: '/assets/tv-frame.png',
    durationSeconds: 6,
    providerRequestId: `test-${idea.id}`,
  }
}

test('generates the highest-voted prompt, fills a buffer, and rotates on duration', async () => {
  let now = 1_750_000_000_000
  const database = new ChannelDatabase(':memory:', { seed: false, now: () => now })
  const first = submit(database, 'first', 'a red origami city')
  now += 10
  submit(database, 'second', 'a blue origami city')
  now += 10
  const voted = submit(database, 'voted', 'a golden origami city')
  database.vote(voted.id, 'fan-one')
  database.vote(voted.id, 'fan-two')

  const orchestrator = new ChannelOrchestrator(database, new MockVideoProvider(0), {
    generationConcurrency: 1,
    bufferTarget: 2,
    workerIntervalMs: 60_000,
    rotationIntervalMs: 60_000,
  }, () => undefined)
  try {
    await orchestrator.runOnce()
    await waitFor(() => database.snapshot().nowPlaying?.id === voted.id && database.snapshot().playingNext.length === 1)
    assert.equal(database.getIdea(voted.id).playCount, 1)
    assert.equal(database.pipelineCounts().playing, 1)
    assert.equal(database.pipelineCounts().ready, 1)

    now += 6_001
    await orchestrator.runOnce()
    assert.equal(database.getIdea(voted.id).status, 'aired')
    assert.equal(database.snapshot().nowPlaying?.id, first.id)
  } finally {
    await orchestrator.stop()
    database.close()
  }
})

test('retries transient generation failures and succeeds without wedging the queue', async () => {
  let now = 5_000
  let calls = 0
  const provider: VideoProvider = {
    name: 'mock',
    async generate(idea) {
      calls += 1
      if (calls === 1) throw new ProviderError('temporary_overload', true)
      return mockResult(idea)
    },
  }
  const database = new ChannelDatabase(':memory:', { seed: false, now: () => now })
  const idea = submit(database, 'retry', 'a tiny train through a garden')
  const orchestrator = new ChannelOrchestrator(database, provider, {
    generationConcurrency: 1,
    bufferTarget: 1,
    workerIntervalMs: 60_000,
    rotationIntervalMs: 60_000,
    maximumAttempts: 3,
  }, () => undefined)

  try {
    await orchestrator.runOnce()
    await waitFor(() => database.getIdea(idea.id).generationProgress === 'retry_scheduled')
    assert.equal(database.getIdea(idea.id).status, 'queued')
    assert.equal(database.getIdea(idea.id).generationAttempts, 1)

    now += 1_000
    await orchestrator.runOnce()
    await waitFor(() => database.snapshot().nowPlaying?.id === idea.id)
    assert.equal(database.getIdea(idea.id).generationAttempts, 2)
    assert.equal(calls, 2)
  } finally {
    await orchestrator.stop()
    database.close()
  }
})

test('enforces bounded generation concurrency while continuously refilling', async () => {
  let active = 0
  let maximumActive = 0
  const provider: VideoProvider = {
    name: 'mock',
    async generate(
      idea: IdeaRecord,
      onProgress: (progress: GenerationProgress) => void,
      signal: AbortSignal,
    ) {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      onProgress({ stage: 'controlled_render' })
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 25)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(signal.reason)
          }, { once: true })
        })
        return mockResult(idea)
      } finally {
        active -= 1
      }
    },
  }
  const database = new ChannelDatabase(':memory:', { seed: false })
  for (let index = 0; index < 5; index += 1) submit(database, `user-${index}`, `safe animation number ${index}`)
  const orchestrator = new ChannelOrchestrator(database, provider, {
    generationConcurrency: 2,
    bufferTarget: 4,
    workerIntervalMs: 60_000,
    rotationIntervalMs: 60_000,
  }, () => undefined)

  try {
    await orchestrator.runOnce()
    await waitFor(() => {
      const counts = database.pipelineCounts()
      return counts.playing + counts.ready === 4
    })
    assert.equal(maximumActive, 2)
    assert.equal(database.snapshot().queue.length, 1)
  } finally {
    await orchestrator.stop()
    database.close()
  }
})

test('fails closed after a non-retryable provider result', async () => {
  const provider: VideoProvider = {
    name: 'mock',
    async generate() {
      throw new ProviderError('provider_result_missing_video', false)
    },
  }
  const database = new ChannelDatabase(':memory:', { seed: false })
  const idea = submit(database, 'broken', 'a harmless scene that triggers the fake provider')
  const orchestrator = new ChannelOrchestrator(database, provider, {
    generationConcurrency: 1,
    bufferTarget: 1,
    workerIntervalMs: 60_000,
    rotationIntervalMs: 60_000,
  }, () => undefined)

  try {
    await orchestrator.runOnce()
    await waitFor(() => database.getIdea(idea.id).status === 'failed')
    assert.equal(database.getIdea(idea.id).error, 'provider_result_missing_video')
    assert.equal(database.pipelineCounts().generating, 0)
  } finally {
    await orchestrator.stop()
    database.close()
  }
})

test('requeues generation interrupted by a process restart', () => {
  const database = new ChannelDatabase(':memory:', { seed: false })
  try {
    const idea = submit(database, 'restart', 'a lantern parade through the clouds')
    database.claimNextForGeneration('mock')
    assert.equal(database.getIdea(idea.id).status, 'generating')
    assert.equal(database.requeueInterruptedGeneration().changed, true)
    assert.equal(database.getIdea(idea.id).status, 'queued')
    assert.equal(database.getIdea(idea.id).generationProgress, 'recovered_after_restart')
  } finally {
    database.close()
  }
})

test('fails closed on an interrupted Orange submission with no persisted task id', () => {
  const database = new ChannelDatabase(':memory:', { seed: false })
  try {
    const unknown = submit(database, 'unknown', 'an orange kite above a quiet valley')
    database.claimNextForGeneration('orange')
    assert.equal(database.requeueInterruptedGeneration().changed, true)
    assert.equal(database.getIdea(unknown.id).status, 'failed')
    assert.equal(database.getIdea(unknown.id).generationProgress, 'submission_state_unknown')
    assert.equal(database.getIdea(unknown.id).error, 'orange_submission_state_unknown')
  } finally {
    database.close()
  }
})

test('requeues an interrupted Orange task only after its task id is persisted', () => {
  const database = new ChannelDatabase(':memory:', { seed: false })
  try {
    const resumable = submit(database, 'resumable', 'an orange lantern floating over water')
    database.claimNextForGeneration('orange')
    database.updateGenerationProgress(resumable.id, 'provider_queued', 'persisted-orange-task')
    assert.equal(database.requeueInterruptedGeneration().changed, true)
    assert.equal(database.getIdea(resumable.id).status, 'queued')
    assert.equal(database.getIdea(resumable.id).providerRequestId, 'persisted-orange-task')
  } finally {
    database.close()
  }
})
