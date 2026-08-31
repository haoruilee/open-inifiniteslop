import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ChannelDatabase, DuplicateSubmissionError, InvalidStateError } from '../database.js'
import { moderatePrompt } from '../moderation.js'

function tempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'infinite-slop-db-'))
  const databasePath = join(directory, 'channel.sqlite')
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

test('persists prompts, votes, likes, and revisions across restarts', () => {
  const { databasePath, cleanup } = tempDatabase()
  let now = 1_750_000_000_000
  const first = new ChannelDatabase(databasePath, { seed: false, now: () => now })

  try {
    const created = first.createSubmission('visitor-a', 'harvey', '  clouds   playing jazz  ', moderatePrompt('clouds playing jazz'))
    assert.equal(created.idea.body, 'clouds playing jazz')
    assert.equal(created.idea.status, 'queued')
    assert.equal(created.revision, 1)

    now += 1_000
    const voted = first.vote(created.idea.id, 'visitor-b')
    assert.equal(voted.idea.votes, 1)
    first.like()
    first.like()
    assert.equal(first.snapshot().live.likes, 2)
    first.close()

    const second = new ChannelDatabase(databasePath, { seed: false, now: () => now })
    assert.equal(second.getIdea(created.idea.id).votes, 1)
    assert.equal(second.snapshot().live.likes, 2)
    assert.equal(second.snapshot().revision, 4)
    assert.throws(() => second.vote(created.idea.id, 'visitor-b'), InvalidStateError)
    second.close()
  } finally {
    cleanup()
  }
})

test('orders queue by votes, then creation time, then id', () => {
  let now = 100_000
  const database = new ChannelDatabase(':memory:', { seed: false, now: () => now })
  try {
    const first = database.createSubmission('v1', 'one', 'red cloud orchestra', moderatePrompt('red cloud orchestra')).idea
    now += 10
    const second = database.createSubmission('v2', 'two', 'blue cloud orchestra', moderatePrompt('blue cloud orchestra')).idea
    now += 10
    const third = database.createSubmission('v3', 'three', 'green cloud orchestra', moderatePrompt('green cloud orchestra')).idea
    database.vote(second.id, 'vote-a')
    database.vote(second.id, 'vote-b')
    database.vote(third.id, 'vote-c')

    assert.deepEqual(database.snapshot().queue.map((idea) => idea.id), [second.id, third.id, first.id])
  } finally {
    database.close()
  }
})
test('routes unsafe and ambiguous prompts through moderation without public leakage', () => {
  const database = new ChannelDatabase(':memory:', { seed: false })
  try {
    const review = database.createSubmission(
      'reviewer',
      'reviewer',
      'a fictional scene with a real person deepfake',
      moderatePrompt('a fictional scene with a real person deepfake'),
    ).idea
    const rejected = database.createSubmission(
      'blocked',
      'blocked',
      'doxx the home address of a real person',
      moderatePrompt('doxx the home address of a real person'),
    ).idea

    assert.equal(review.status, 'pending_review')
    assert.equal(rejected.status, 'rejected')
    assert.deepEqual(database.snapshot().chat, [])

    const approved = database.moderate(review.id, 'approve', 'human_approved')
    assert.equal(approved.idea.status, 'queued')
    assert.deepEqual(database.snapshot().chat.map((idea) => idea.id), [review.id])
  } finally {
    database.close()
  }
})

test('rejects duplicate active prompts within the deduplication window', () => {
  const database = new ChannelDatabase(':memory:', { seed: false })
  try {
    database.createSubmission('first', 'first', 'A tiny moon café', moderatePrompt('A tiny moon café'))
    assert.throws(
      () => database.createSubmission('second', 'second', 'a  tiny moon café', moderatePrompt('a tiny moon café')),
      DuplicateSubmissionError,
    )
  } finally {
    database.close()
  }
})

test('keeps a provider task id for safe resume but clears it when providers change', () => {
  const database = new ChannelDatabase(':memory:', { seed: false })
  try {
    const resumed = database.createSubmission(
      'resume-visitor',
      'resume',
      'a tiny paper city at sunrise',
      moderatePrompt('a tiny paper city at sunrise'),
    ).idea
    database.claimNextForGeneration('orange')
    database.updateGenerationProgress(resumed.id, 'provider_queued', 'orange-task-resume')
    database.failGeneration(resumed.id, 'provider_timeout', 0)
    assert.equal(database.claimNextForGeneration('orange')?.providerRequestId, 'orange-task-resume')
    database.failGeneration(resumed.id, 'manual_switch', 0)
    assert.equal(database.claimNextForGeneration('fal')?.providerRequestId, null)
  } finally {
    database.close()
  }
})
