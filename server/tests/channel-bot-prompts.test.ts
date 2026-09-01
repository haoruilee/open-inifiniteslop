import assert from 'node:assert/strict'
import test from 'node:test'
import { moderatePrompt } from '../moderation.js'
import { channelBotPromptCycleLength, channelBotPromptFor } from '../../worker/channel-bot-prompts.js'

test('channel bot prompt cycle stays diverse and locally safe', () => {
  const prompts = Array.from({ length: channelBotPromptCycleLength }, (_, slot) => channelBotPromptFor(slot))

  assert.equal(channelBotPromptCycleLength, 16_384)
  assert.equal(new Set(prompts).size, prompts.length)
  for (const prompt of prompts) {
    assert.equal(moderatePrompt(prompt).decision, 'approve')
    assert.match(prompt, /no text\.$/u)
  }
})
