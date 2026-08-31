export const ideaStatuses = [
  'pending_review',
  'rejected',
  'queued',
  'generating',
  'ready',
  'playing',
  'aired',
  'failed',
] as const

export type IdeaStatus = (typeof ideaStatuses)[number]

export type ModerationDecision = 'approve' | 'review' | 'reject'

export type ModerationResult = {
  decision: ModerationDecision
  reason: string | null
}

export type IdeaRecord = {
  id: number
  visitorId: string
  author: string
  body: string
  normalizedBody: string
  status: IdeaStatus
  moderationReason: string | null
  votes: number
  createdAt: number
  statusChangedAt: number
  provider: string | null
  providerRequestId: string | null
  videoUrl: string | null
  videoPath: string | null
  posterUrl: string | null
  durationSeconds: number | null
  generationProgress: string | null
  error: string | null
  playCount: number
  generationAttempts: number
  retryAt: number | null
}

export type PublicIdea = {
  id: number
  user: string
  message: string
  status: IdeaStatus
  votes: number
  createdAt: number
  time: string
  videoUrl: string | null
  posterUrl: string | null
  durationSeconds: number | null
  generationProgress: string | null
  startedAt: number | null
}

export type ChannelSnapshot = {
  revision: number
  live: {
    isLive: boolean
    viewers: number
    likes: number
    provider: string
  }
  nowPlaying: PublicIdea | null
  playingNext: PublicIdea[]
  generatingNow: PublicIdea[]
  queue: PublicIdea[]
  chat: PublicIdea[]
  chatPage: {
    hasMore: boolean
    oldestId: number | null
  }
  serverTime: number
}

export type CreateSubmissionResult = {
  idea: IdeaRecord
  revision: number
}
