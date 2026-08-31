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
    true,
  )
})
