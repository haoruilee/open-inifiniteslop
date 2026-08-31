import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveOrangeApiKey } from '../credentials.js'

test('uses macOS Keychain for the canonical gateway and lets deployments override it', () => {
  const keychainValue = `orange-keychain-${crypto.randomUUID()}`
  const environmentValue = `orange-environment-${crypto.randomUUID()}`
  assert.equal(resolveOrangeApiKey(null, undefined, {
    platform: 'darwin',
    keychainLookup: () => `${keychainValue}\n`,
  }), keychainValue)
  assert.equal(resolveOrangeApiKey(environmentValue, undefined, {
    platform: 'darwin',
    keychainLookup: () => assert.fail('An explicit deployment value must take precedence'),
  }), environmentValue)
})

test('falls back to a deployment secret and fails closed when neither source exists', () => {
  const environmentValue = `orange-environment-${crypto.randomUUID()}`
  assert.equal(resolveOrangeApiKey(environmentValue, undefined, {
    platform: 'linux',
    keychainLookup: () => assert.fail('Linux must not query macOS Keychain'),
  }), environmentValue)
  assert.equal(resolveOrangeApiKey(null, undefined, {
    platform: 'darwin',
    keychainLookup: () => { throw new Error('lookup failed') },
  }), null)
})

test('never sends a Keychain credential to a custom API base', () => {
  assert.equal(resolveOrangeApiKey(null, 'https://example.invalid/v1', {
    platform: 'darwin',
    keychainLookup: () => assert.fail('A custom gateway must provide its own deployment credential'),
  }), null)
})
