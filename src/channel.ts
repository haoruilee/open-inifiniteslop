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
    provider: 'mock' | 'fal'
  }
  nowPlaying: ChannelIdea | null
  playingNext: ChannelIdea[]
  generatingNow: ChannelIdea[]
  queue: ChannelIdea[]
  chat: ChannelIdea[]
  serverTime: number
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

async function getSnapshot(signal?: AbortSignal) {
  const response = await fetch('/api/state', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  })
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
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      applySnapshot(await getSnapshot(signal))
    } catch (requestError) {
      if (signal?.aborted) return
      setError(requestError instanceof Error ? requestError.message : 'Channel connection failed')
      setConnection('reconnecting')
    }
  }, [applySnapshot])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)

    const events = new EventSource('/api/events')
    events.onopen = () => setConnection('live')
    events.addEventListener('state', (event) => {
      try {
        applySnapshot(JSON.parse((event as MessageEvent<string>).data) as ChannelSnapshot)
      } catch {
        setError('Received an invalid channel update')
      }
    })
    events.onerror = () => setConnection('reconnecting')

    const poll = window.setInterval(() => void refresh(controller.signal), 2_500)
    return () => {
      controller.abort()
      events.close()
      window.clearInterval(poll)
    }
  }, [applySnapshot, refresh])

  return { snapshot, connection, error, refresh }
}
