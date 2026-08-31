import assert from 'node:assert/strict'
import test from 'node:test'
import { mp4DurationSeconds } from '../../worker/mp4-duration.js'

function box(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(8 + payload.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.byteLength)
  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.charCodeAt(index)
  bytes.set(payload, 8)
  return bytes
}

function movieWithDuration(timescale: number, duration: number) {
  const movieHeader = new Uint8Array(20)
  const view = new DataView(movieHeader.buffer)
  view.setUint32(12, timescale)
  view.setUint32(16, duration)
  return box('moov', box('mvhd', movieHeader))
}

test('reads an MP4 movie-header duration without trusting a requested duration', () => {
  assert.equal(mp4DurationSeconds(movieWithDuration(1_000, 5_062)), 5.062)
  assert.equal(mp4DurationSeconds(new Uint8Array([0, 1, 2, 3])), null)
})
