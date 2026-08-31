import type { ModerationResult } from './types.js'

type ModerationRule = {
  pattern: RegExp
  reason: string
}

// High-confidence categories are rejected locally before a prompt reaches any
// external model. Ambiguous safety-sensitive requests wait for human review.
const rejectRules: ModerationRule[] = [
  { pattern: /(?:child|minor|underage).{0,24}(?:nude|naked|sexual|porn)/iu, reason: 'sexual_content_involving_minors' },
  { pattern: /(?:rape|non[- ]?consensual).{0,24}(?:sex|sexual|porn)/iu, reason: 'non_consensual_sexual_content' },
  { pattern: /(?:bestiality|zoophilia)/iu, reason: 'sexual_content' },
  { pattern: /(?:doxx|home address|social security number).{0,32}(?:real|person|someone|target)/iu, reason: 'personal_data_abuse' },
]

const reviewRules: ModerationRule[] = [
  { pattern: /https?:\/\//iu, reason: 'external_reference' },
  { pattern: /(?:blood|gore|murder|suicide|torture|beheading)/iu, reason: 'graphic_violence' },
  { pattern: /(?:nude|naked|porn|explicit sex)/iu, reason: 'sexual_content' },
  { pattern: /(?:bomb|explosive|bioweapon|chemical weapon)/iu, reason: 'dangerous_content' },
  { pattern: /(?:real person|celebrity|politician|public figure|deepfake)/iu, reason: 'real_person_likeness' },
  { pattern: /(?:password|credit card|private key|api key|phone number|home address)/iu, reason: 'sensitive_information' },
]

export function normalizePrompt(value: string) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

export function moderatePrompt(rawPrompt: string): ModerationResult {
  const prompt = normalizePrompt(rawPrompt)

  for (const rule of rejectRules) {
    if (rule.pattern.test(prompt)) return { decision: 'reject', reason: rule.reason }
  }

  if (/(.)\1{15,}/u.test(prompt)) {
    return { decision: 'review', reason: 'spam_pattern' }
  }

  for (const rule of reviewRules) {
    if (rule.pattern.test(prompt)) return { decision: 'review', reason: rule.reason }
  }

  return { decision: 'approve', reason: null }
}
