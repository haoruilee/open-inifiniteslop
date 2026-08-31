import assert from 'node:assert/strict'
import test from 'node:test'
import { loadConfig } from '../config.js'

test('seeds demos only for the mock provider by default', () => {
  assert.equal(loadConfig({ VIDEO_PROVIDER: 'mock' }, '/tmp').seedDemoQueue, true)
  assert.equal(loadConfig({ VIDEO_PROVIDER: 'fal', FAL_KEY: 'test-only' }, '/tmp').seedDemoQueue, false)
})

test('allows an explicit demo seed override', () => {
  assert.equal(loadConfig({ VIDEO_PROVIDER: 'mock', SEED_DEMO_QUEUE: 'false' }, '/tmp').seedDemoQueue, false)
  assert.equal(
    loadConfig({ VIDEO_PROVIDER: 'fal', FAL_KEY: 'test-only', SEED_DEMO_QUEUE: 'true' }, '/tmp').seedDemoQueue,
    false,
  )
})

test('loads the bounded OrangeAPI contract without seeding paid jobs', () => {
  const config = loadConfig({
    VIDEO_PROVIDER: 'orange',
    ORANGE_API_BASE: 'https://example.invalid/v1',
    ORANGE_MODEL: 'happyhorse-1.0-t2v',
    ORANGE_DURATION_SECONDS: '3',
    ORANGE_POLL_INTERVAL_MS: '25',
    GENERATION_MAX_ATTEMPTS: '1',
  }, '/tmp')
  assert.equal(config.provider, 'orange')
  assert.equal(config.seedDemoQueue, false)
  assert.equal(config.orangeApiBase, 'https://example.invalid/v1')
  assert.equal(config.orangeDurationSeconds, 3)
  assert.equal(config.orangePollIntervalMs, 250)
  assert.equal(config.generationMaximumAttempts, 1)
})
