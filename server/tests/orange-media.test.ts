import assert from 'node:assert/strict'
import test from 'node:test'
import { requiresOrangeGatewayAuth } from '../../worker/orange-media.js'

test('only retries Orange credentials for trusted HTTPS gateway media URLs', () => {
  const base = 'https://api.orangeapi.chat/v1'

  assert.equal(requiresOrangeGatewayAuth(base, 'https://api.orangeapi.chat/v1/videos/result.mp4'), true)
  assert.equal(requiresOrangeGatewayAuth(base, 'https://orangeapi.chat/v1/videos/result.mp4'), true)
  assert.equal(requiresOrangeGatewayAuth(base, 'https://cdn.example.com/result.mp4'), false)
  assert.equal(requiresOrangeGatewayAuth(base, 'https://orangeapi.chat.attacker.example/result.mp4'), false)
  assert.equal(requiresOrangeGatewayAuth(base, 'http://orangeapi.chat/v1/videos/result.mp4'), false)
})
