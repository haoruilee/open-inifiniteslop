import { useCallback, useEffect, useRef, useState } from 'react'

export type IdeaStatus =
  | 'pending_review'
  | 'rejected'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'playing'
  | 'aired'
  | 'failed'

export type ChannelIdea = {
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
    provider: 'mock' | 'fal' | 'orange'
  }
  nowPlaying: ChannelIdea | null
  playingNext: ChannelIdea[]
  generatingNow: ChannelIdea[]
  queue: ChannelIdea[]
  chat: ChannelIdea[]
  chatPage?: {
    hasMore: boolean
    oldestId: number | null
  }
  serverTime: number
}

export type ChatHistoryPage = {
  items: ChannelIdea[]
  page: {
    hasMore: boolean
    nextBefore: number | null
  }
}

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting'

type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
  }
}

export class ChannelApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ChannelApiError'
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as ApiErrorBody | T
  if (response.ok) return body as T
  const error = body as ApiErrorBody
  throw new ChannelApiError(
    response.status,
    error.error?.code || 'REQUEST_FAILED',
    error.error?.message || 'The channel could not process that request',
  )
}

async function getSnapshot(revision: number, signal?: AbortSignal) {
  const headers = new Headers({ Accept: 'application/json' })
  if (revision >= 0) headers.set('If-None-Match', `"channel-${revision}"`)
  const response = await fetch('/api/state', {
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  })
  if (response.status === 304) return null
  return readResponse<ChannelSnapshot>(response)
}

async function postJson<T>(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  return readResponse<T>(response)
}

export function submitPrompt(nickname: string, message: string) {
  return postJson<{
    idea: { id: number; status: IdeaStatus; body: string }
    revision: number
  }>('/api/prompts', { nickname, message })
}

export function voteForIdea(id: number) {
  return postJson<{ id: number; votes: number; revision: number }>(`/api/queue/${id}/votes`, {})
}

export function likeChannel() {
  return postJson<{ likes: number; revision: number }>('/api/likes', {})
}

export function advanceChannelPlayback(ideaId: number, startedAt: number) {
  return postJson<ChannelSnapshot>('/api/playback/advance', { ideaId, startedAt })
}

export async function loadOlderChat(before: number, limit = 100, signal?: AbortSignal) {
  const query = new URLSearchParams({ before: String(before), limit: String(limit) })
  const response = await fetch(`/api/chat?${query.toString()}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  })
  return readResponse<ChatHistoryPage>(response)
}

export function useChannel() {
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const latestRevision = useRef(-1)

  const applySnapshot = useCallback((next: ChannelSnapshot) => {
    if (!Number.isSafeInteger(next.revision) || next.revision < latestRevision.current) return
    latestRevision.current = next.revision
    setSnapshot(next)
    setError(null)
    setConnection('live')
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await getSnapshot(latestRevision.current, signal)
      if (next) applySnapshot(next)
    } catch (requestError) {
      if (signal?.aborted) return
      setError(requestError instanceof Error ? requestError.message : 'Channel connection failed')
      setConnection('reconnecting')
    }
  }, [applySnapshot])

  const applyLikes = useCallback((likes: number, revision: number) => {
    if (!Number.isSafeInteger(likes) || likes < 0 || !Number.isSafeInteger(revision)) return
    latestRevision.current = Math.max(latestRevision.current, revision)
    setSnapshot((current) => {
      if (!current || revision < current.revision) return current
      return {
        ...current,
        revision: Math.max(current.revision, revision),
        live: { ...current.live, likes },
      }
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | null = null
    let stopped = false
    const poll = async () => {
      await refresh(controller.signal)
      if (stopped) return
      timer = window.setTimeout(poll, document.hidden ? 60_000 : 15_000)
    }
    const refreshForVisibility = () => {
      if (!document.hidden) void refresh(controller.signal)
    }
    document.addEventListener('visibilitychange', refreshForVisibility)
    void poll()
    return () => {
      stopped = true
      controller.abort()
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshForVisibility)
    }
  }, [refresh])

  return { snapshot, connection, error, refresh, applyLikes, applySnapshot }
}
