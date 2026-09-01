import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceChannelPlayback,
  ChannelApiError,
  type ChannelIdea,
  likeChannel,
  loadOlderChat,
  submitPrompt,
  useChannel,
  voteForIdea,
} from './channel'

type FeedItem = {
  id: number
  time: string
  user: string
  message: string
  votes?: number
  generating?: boolean
  mine?: boolean
  automated?: boolean
}

type PlaybackSlot = 'a' | 'b'

function playbackIdentity(idea: ChannelIdea | null | undefined) {
  return idea ? `${idea.id}:${idea.startedAt ?? 'pending'}` : null
}

function alternateSlot(slot: PlaybackSlot): PlaybackSlot {
  return slot === 'a' ? 'b' : 'a'
}

function optimizedPoster(posterUrl: string | null | undefined) {
  return !posterUrl || posterUrl === '/assets/tv-frame.png'
    ? '/assets/tv-frame.webp'
    : posterUrl
}

function toFeedItem(idea: ChannelIdea, nickname: string): FeedItem {
  return {
    id: idea.id,
    time: idea.time,
    user: idea.user,
    message: idea.message,
    votes: idea.votes,
    generating: idea.status === 'generating',
    mine: nickname.length > 0 && idea.user === nickname,
    automated: idea.user === 'channel bot',
  }
}

function pastel(name: string) {
  let hue = 0
  for (const character of name) hue = (hue * 31 + character.charCodeAt(0)) % 360
  return `hsl(${hue} 55% 78% / 0.92)`
}

function useDeskQueue() {
  const [isDesktop, setIsDesktop] = useState(() => {
    const width = window.innerWidth
    const videoWidth = Math.min(width, window.innerHeight * 9 / 16)
    return width >= 1000 && (width - videoWidth) / 2 >= 280
  })

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth
      const videoWidth = Math.min(width, window.innerHeight * 9 / 16)
      setIsDesktop(width >= 1000 && (width - videoWidth) / 2 >= 280)
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return isDesktop
}

function savedNickname() {
  return window.localStorage.getItem('infinite-slop-nickname') || ''
}

function savedVotes() {
  try {
    const values = JSON.parse(window.localStorage.getItem('infinite-slop-votes') || '[]') as unknown
    if (!Array.isArray(values)) return new Set<number>()
    return new Set(values.filter((value): value is number => Number.isSafeInteger(value)))
  } catch {
    return new Set<number>()
  }
}

const BrandCredit = memo(function BrandCredit({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? 'brand-credit compact' : 'brand-credit'}>
      by{' '}
      <a href="https://x.com/AI4Azure" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        @AI4Azure
      </a>
      <span className="credit-divider" aria-hidden="true">·</span>
      <a href="https://github.com/haoruilee/open-inifiniteslop" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        opensourced at GitHub
      </a>
    </span>
  )
})

const FeedBubble = memo(function FeedBubble({ item, className = '' }: { item: FeedItem; className?: string }) {
  return (
    <div
      className={`feed-bubble ${item.generating ? 'generating' : ''} ${item.mine ? 'hot' : ''} ${item.automated ? 'automated' : ''} ${className}`}
      style={!item.generating && !item.mine && !item.automated ? { background: pastel(item.user) } : undefined}
    >
      <span className="time">{item.time}</span>
      {item.automated ? <span className="automation-badge" aria-label="Automated channel bot">AUTO</span> : null}
      <b>{item.user}</b>
      {item.message}
    </div>
  )
})

function QueuePanel({
  playingNext,
  generatingNow,
  queue,
  onVote,
  votedIds,
  pendingVotes,
}: {
  playingNext: FeedItem[]
  generatingNow: FeedItem[]
  queue: FeedItem[]
  onVote: (id: number) => void
  votedIds: Set<number>
  pendingVotes: Set<number>
}) {
  return (
    <div className="queue-panel" data-testid="queue-panel">
      <h2>PLAYING NEXT</h2>
      <div className="feed-stack playing-stack">
        {playingNext.length > 0
          ? playingNext.map((item) => <FeedBubble key={item.id} item={item} />)
          : <div className="empty-feed">buffering…</div>}
      </div>
      <h2>NOW GENERATING</h2>
      <div className="feed-stack">
        {generatingNow.length > 0
          ? generatingNow.map((item) => <FeedBubble key={item.id} item={item} />)
          : <div className="empty-feed">waiting for a prompt…</div>}
      </div>
      <h2>QUEUE</h2>
      <div className="feed-stack">
        {queue.length > 0 ? queue.map((item) => {
          const voted = votedIds.has(item.id)
          const pending = pendingVotes.has(item.id)
          return (
            <div className="queue-row" key={item.id}>
              <button
                className={`upvote ${voted ? 'voted' : ''}`}
                onClick={() => onVote(item.id)}
                aria-label={`${voted ? 'Voted for' : 'Upvote'} ${item.user}'s idea`}
                aria-pressed={voted}
                disabled={voted || pending}
              >
                {voted ? '✓' : '▲'}<span>{item.votes ?? 0}</span>
              </button>
              <FeedBubble item={item} />
            </div>
          )
        }) : <div className="empty-feed">the queue is open</div>}
      </div>
    </div>
  )
}

function ChatPanel({
  chat,
  activeTab,
  isDesktop,
  input,
  submitting,
  onInput,
  onSubmit,
  onTab,
  playingNext,
  generatingNow,
  queue,
  onVote,
  votedIds,
  pendingVotes,
  hasOlderChat,
  loadingOlderChat,
  onLoadOlderChat,
}: {
  chat: FeedItem[]
  activeTab: 'chat' | 'queue'
  isDesktop: boolean
  input: string
  submitting: boolean
  onInput: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onTab: (tab: 'chat' | 'queue') => void
  playingNext: FeedItem[]
  generatingNow: FeedItem[]
  queue: FeedItem[]
  onVote: (id: number) => void
  votedIds: Set<number>
  pendingVotes: Set<number>
  hasOlderChat: boolean
  loadingOlderChat: boolean
  onLoadOlderChat: () => Promise<void>
}) {
  const messagesRef = useRef<HTMLDivElement>(null)
  const latestChatId = chat[chat.length - 1]?.id ?? null
  const lastChatId = useRef<number | null>(null)
  const wasAtBottom = useRef(true)

  useEffect(() => {
    const previous = lastChatId.current
    lastChatId.current = latestChatId
    if (previous !== null && previous === latestChatId) return
    const frame = window.requestAnimationFrame(() => {
      const messages = messagesRef.current
      if (messages && (previous === null || wasAtBottom.current)) messages.scrollTop = messages.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [latestChatId])

  async function loadEarlierMessages() {
    const messages = messagesRef.current
    const previousHeight = messages?.scrollHeight ?? 0
    await onLoadOlderChat()
    window.requestAnimationFrame(() => {
      const updated = messagesRef.current
      if (updated) updated.scrollTop += updated.scrollHeight - previousHeight
    })
  }

  function trackScroll() {
    const messages = messagesRef.current
    if (!messages) return
    wasAtBottom.current = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48
  }

  return (
    <aside className="chat-panel" data-testid="chat-panel">
      {!isDesktop ? (
        <div className="chat-tabs">
          <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => onTab('chat')}>CHAT</button>
          <button className={activeTab === 'queue' ? 'active' : ''} onClick={() => onTab('queue')}>QUEUE</button>
        </div>
      ) : null}

      {activeTab === 'chat' || isDesktop ? (
        <div className="chat-tab-pane">
          <div className="chat-messages" data-testid="chat-messages" ref={messagesRef} onScroll={trackScroll}>
            {hasOlderChat ? (
              <button className="load-earlier" type="button" onClick={() => void loadEarlierMessages()} disabled={loadingOlderChat}>
                {loadingOlderChat ? 'loading…' : 'earlier messages'}
              </button>
            ) : null}
            {chat.length > 0
              ? chat.map((item) => <FeedBubble key={item.id} item={item} className="chat-bubble" />)
              : <div className="empty-feed chat-empty">be the first to decide what airs</div>}
          </div>
          <form className="chat-form" onSubmit={onSubmit}>
            <input
              aria-label="What you wanna see next"
              value={input}
              onChange={(event) => onInput(event.target.value)}
              maxLength={200}
              placeholder="What you wanna see next…"
              autoComplete="off"
              disabled={submitting}
            />
            <button type="submit" disabled={submitting}>{submitting ? '…' : 'Say'}</button>
          </form>
        </div>
      ) : (
        <QueuePanel
          playingNext={playingNext}
          generatingNow={generatingNow}
          queue={queue}
          onVote={onVote}
          votedIds={votedIds}
          pendingVotes={pendingVotes}
        />
      )}
    </aside>
  )
}

function PlayIcon() {
  return (
    <svg className="play-icon" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M18 10.8c0-4.1 4.5-6.5 7.9-4.2l30.4 20.4a6 6 0 0 1 0 10L26 57.4c-3.4 2.3-8-.1-8-4.2V10.8Z" />
    </svg>
  )
}

function Splash({ onTuneIn, tuning = false }: { onTuneIn: () => void; tuning?: boolean }) {
  return (
    <div
      className="splash"
      role="button"
      tabIndex={0}
      onClick={onTuneIn}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('a')) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onTuneIn()
        }
      }}
      aria-label="Tune in to Infinite Slop"
    >
      <span className="splash-inner">
        <span className="logo-lockup">
          <img className="creator-avatar" src="/assets/ai4azure-avatar.png" alt="AI4Azure GitHub avatar" />
          <span className="logo">Infinite Slop</span>
        </span>
        <PlayIcon />
        <span className="subtitle">
          {tuning ? 'tuning the channel…' : <>
            an endless AI-generated TV channel.<br />
            the chat decides what airs next
          </>}
        </span>
        <BrandCredit compact />
      </span>
    </div>
  )
}

function noticeForError(error: unknown) {
  if (error instanceof ChannelApiError) {
    if (error.code === 'DUPLICATE_PROMPT') return 'that idea is already in the channel'
    if (error.code === 'RATE_LIMITED') return 'slow down a little, then try again'
    if (error.code === 'INVALID_STATE') return 'that item has already moved on'
    return error.message
  }
  return 'the channel lost the request — please retry'
}

function App() {
  const isDesktop = useDeskQueue()
  const { snapshot, error: connectionError, refresh, applyLikes, applySnapshot } = useChannel()
  const [tunedIn, setTunedIn] = useState(false)
  const [tuneRequested, setTuneRequested] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'chat' | 'queue'>('chat')
  const [input, setInput] = useState('')
  const [nickname, setNickname] = useState(savedNickname)
  const [nameDraft, setNameDraft] = useState('')
  const [nameModal, setNameModal] = useState(false)
  const [pendingMessage, setPendingMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [votedIds, setVotedIds] = useState(savedVotes)
  const [pendingVotes, setPendingVotes] = useState<Set<number>>(() => new Set())
  const [heartKeys, setHeartKeys] = useState<number[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [failedVideoId, setFailedVideoId] = useState<number | null>(null)
  const [olderChat, setOlderChat] = useState<ChannelIdea[]>([])
  const [olderChatCursor, setOlderChatCursor] = useState<number | null>(null)
  const [hasOlderChat, setHasOlderChat] = useState(false)
  const [loadingOlderChat, setLoadingOlderChat] = useState(false)
  const noticeTimer = useRef<number | null>(null)
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const chatHistoryExhausted = useRef(false)
  const endedPlaybackKey = useRef<string | null>(null)
  const playbackRetryTimers = useRef<number[]>([])
  const playbackAdvanceInFlight = useRef<string | null>(null)
  const activeSlotRef = useRef<PlaybackSlot>('a')
  const slotPlaybackRef = useRef<Record<PlaybackSlot, ChannelIdea | null>>({ a: null, b: null })
  const [activeSlot, setActiveSlot] = useState<PlaybackSlot>('a')
  const [slotPlayback, setSlotPlayback] = useState<Record<PlaybackSlot, ChannelIdea | null>>({ a: null, b: null })

  const chatIdeas = useMemo(() => {
    const latest = snapshot?.chat ?? []
    const byId = new Map<number, ChannelIdea>()
    for (const idea of [...olderChat, ...latest]) byId.set(idea.id, idea)
    const ordered = [...byId.values()].sort((left, right) => left.id - right.id)
    return ordered.length > 600 ? ordered.slice(-600) : ordered
  }, [olderChat, snapshot?.chat])
  const chat = useMemo(() => chatIdeas.map((idea) => toFeedItem(idea, nickname)), [chatIdeas, nickname])
  const playingNext = useMemo(() => (snapshot?.playingNext ?? []).map((idea) => toFeedItem(idea, nickname)), [snapshot?.playingNext, nickname])
  const generatingNow = useMemo(() => (snapshot?.generatingNow ?? []).map((idea) => toFeedItem(idea, nickname)), [snapshot?.generatingNow, nickname])
  const queue = useMemo(() => (snapshot?.queue ?? []).map((idea) => toFeedItem(idea, nickname)), [snapshot?.queue, nickname])
  const nowPlaying = snapshot?.nowPlaying
  const nowPlayingKey = playbackIdentity(nowPlaying)

  useEffect(() => {
    activeSlotRef.current = activeSlot
  }, [activeSlot])

  useEffect(() => {
    slotPlaybackRef.current = slotPlayback
  }, [slotPlayback])

  useEffect(() => {
    const first = snapshot?.chat[0]?.id ?? null
    if (first === null) return
    if (chatHistoryExhausted.current) return
    setOlderChatCursor((current) => current === null ? (snapshot?.chatPage?.oldestId ?? first) : current)
    setHasOlderChat((current) => current || Boolean(snapshot?.chatPage?.hasMore))
  }, [snapshot?.chat, snapshot?.chatPage?.hasMore, snapshot?.chatPage?.oldestId])

  useEffect(() => {
    setFailedVideoId(null)
  }, [nowPlaying?.id, nowPlaying?.videoUrl, nowPlaying?.startedAt])

  const clearPlaybackRetries = useCallback(() => {
    for (const timer of playbackRetryTimers.current) window.clearTimeout(timer)
    playbackRetryTimers.current = []
  }, [])

  useEffect(() => () => clearPlaybackRetries(), [clearPlaybackRetries])

  useEffect(() => {
    if (endedPlaybackKey.current !== null && endedPlaybackKey.current !== nowPlayingKey) {
      endedPlaybackKey.current = null
      clearPlaybackRetries()
    }
    if (playbackAdvanceInFlight.current !== null && playbackAdvanceInFlight.current !== nowPlayingKey) {
      playbackAdvanceInFlight.current = null
    }
  }, [clearPlaybackRetries, nowPlayingKey])

  useEffect(() => {
    if (failedVideoId === null) return
    const timer = window.setTimeout(() => setFailedVideoId(null), 3_000)
    return () => window.clearTimeout(timer)
  }, [failedVideoId])

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
  }, [])

  function showNotice(message: string) {
    setNotice(message)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3_400)
  }

  async function sendMessage(message: string, user: string) {
    const trimmed = message.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      const result = await submitPrompt(user, trimmed)
      setInput('')
      setPendingMessage('')
      if (result.idea.status === 'pending_review') showNotice('sent to moderation — it will queue after approval')
      else if (result.idea.status === 'rejected') showNotice('this prompt could not be accepted')
      else showNotice('added to the live queue')
      await refresh()
    } catch (requestError) {
      showNotice(noticeForError(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim()) return
    if (!nickname) {
      setPendingMessage(input)
      setNameModal(true)
      return
    }
    void sendMessage(input, nickname)
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault()
    const safeName = nameDraft.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 18)
    if (!safeName) return
    window.localStorage.setItem('infinite-slop-nickname', safeName)
    setNickname(safeName)
    setNameModal(false)
    void sendMessage(pendingMessage, safeName)
  }

  async function handleVote(id: number) {
    if (votedIds.has(id) || pendingVotes.has(id)) return
    setPendingVotes((items) => new Set(items).add(id))
    try {
      await voteForIdea(id)
      setVotedIds((items) => {
        const next = new Set(items).add(id)
        window.localStorage.setItem('infinite-slop-votes', JSON.stringify([...next]))
        return next
      })
      await refresh()
    } catch (requestError) {
      if (requestError instanceof ChannelApiError && requestError.code === 'INVALID_STATE' && requestError.message === 'Already voted') {
        setVotedIds((items) => new Set(items).add(id))
      }
      showNotice(noticeForError(requestError))
    } finally {
      setPendingVotes((items) => {
        const next = new Set(items)
        next.delete(id)
        return next
      })
    }
  }

  async function handleLoadOlderChat() {
    if (loadingOlderChat || !hasOlderChat || olderChatCursor === null) return
    setLoadingOlderChat(true)
    try {
      const page = await loadOlderChat(olderChatCursor)
      setOlderChat((existing) => {
        const byId = new Map<number, ChannelIdea>()
        for (const idea of [...page.items, ...existing]) byId.set(idea.id, idea)
        return [...byId.values()].sort((left, right) => left.id - right.id).slice(-540)
      })
      setOlderChatCursor(page.page.nextBefore)
      if (!page.page.hasMore) chatHistoryExhausted.current = true
      setHasOlderChat(page.page.hasMore)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    } catch (requestError) {
      showNotice(noticeForError(requestError))
    } finally {
      setLoadingOlderChat(false)
    }
  }

  async function addHeart() {
    const key = Date.now()
    setHeartKeys((keys) => [...keys, key])
    window.setTimeout(() => setHeartKeys((keys) => keys.filter((item) => item !== key)), 2_700)
    try {
      const result = await likeChannel()
      applyLikes(result.likes, result.revision)
      void refresh()
    } catch (requestError) {
      showNotice(noticeForError(requestError))
    }
  }

  function handleTab(tab: 'chat' | 'queue') {
    if (activeTab === tab) {
      setChatOpen(false)
      return
    }
    setActiveTab(tab)
  }

  function tuneIn() {
    setTuneRequested(true)
    const activeVideo = activeSlotRef.current === 'a' ? videoARef.current : videoBRef.current
    if (activeVideo && activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setTunedIn(true)
      activeVideo.muted = false
      void activeVideo.play().catch(() => undefined)
    }
  }

  const statusNotice = notice || connectionError
  const nowMessage = nowPlaying?.message || 'the next broadcast is warming up'
  const nowUser = nowPlaying?.user || 'channel'
  const nowTime = nowPlaying?.time || '--:--'
  const poster = optimizedPoster(nowPlaying?.posterUrl)
  const showVideo = Boolean(nowPlaying?.videoUrl && failedVideoId !== nowPlaying.id)
  const activePlayback = slotPlayback[activeSlot] ?? (showVideo ? nowPlaying : null)
  const slotAPlayback = slotPlayback.a ?? (activeSlot === 'a' && showVideo ? nowPlaying : null)
  const slotBPlayback = slotPlayback.b ?? (activeSlot === 'b' && showVideo ? nowPlaying : null)
  const videoForSlot = useCallback((slot: PlaybackSlot) => (
    slot === 'a' ? videoARef.current : videoBRef.current
  ), [])

  const requestPlaybackAdvance = useCallback(async () => {
    const playback = nowPlaying
    const startedAt = playback?.startedAt
    if (!playback || !nowPlayingKey || typeof startedAt !== 'number' || !Number.isSafeInteger(startedAt)) return
    if (playbackAdvanceInFlight.current === nowPlayingKey) return

    playbackAdvanceInFlight.current = nowPlayingKey
    try {
      applySnapshot(await advanceChannelPlayback(playback.id, startedAt))
    } catch {
      void refresh()
    } finally {
      const requestKey = nowPlayingKey
      window.setTimeout(() => {
        if (playbackAdvanceInFlight.current === requestKey) playbackAdvanceInFlight.current = null
      }, 1_500)
    }
  }, [applySnapshot, nowPlaying, nowPlayingKey, refresh])

  const handleVideoEnded = useCallback(() => {
    if (!nowPlayingKey || endedPlaybackKey.current === nowPlayingKey) return

    endedPlaybackKey.current = nowPlayingKey
    clearPlaybackRetries()
    const requestNext = () => {
      if (endedPlaybackKey.current === nowPlayingKey) void requestPlaybackAdvance()
    }

    requestNext()
    for (const delay of [500, 1_200, 2_400, 4_000]) {
      playbackRetryTimers.current.push(window.setTimeout(requestNext, delay))
    }
  }, [clearPlaybackRetries, nowPlayingKey, requestPlaybackAdvance])

  const playSlot = useCallback((slot: PlaybackSlot) => {
    const video = videoForSlot(slot)
    if (!video) return

    // A new element must start muted or browsers can reject the automatic
    // handoff. Audio is restored only after its first successful frame.
    video.muted = true
    void video.play().then(() => {
      if (video.isConnected && activeSlotRef.current === slot && tunedIn) video.muted = false
    }).catch(() => {
      if (playbackIdentity(slotPlaybackRef.current[slot]) === nowPlayingKey) {
        void requestPlaybackAdvance()
      }
    })
  }, [nowPlayingKey, requestPlaybackAdvance, tunedIn, videoForSlot])

  const promoteSlot = useCallback((slot: PlaybackSlot) => {
    const source = slotPlaybackRef.current[slot]
    const video = videoForSlot(slot)
    if (
      !source
      || playbackIdentity(source) !== nowPlayingKey
      || !video
      || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) return

    const previousSlot = activeSlotRef.current
    if (previousSlot !== slot) {
      if (video.currentTime > 0) video.currentTime = 0
      activeSlotRef.current = slot
      setActiveSlot(slot)
      if (tuneRequested) setTunedIn(true)
      window.setTimeout(() => {
        if (activeSlotRef.current === slot) videoForSlot(previousSlot)?.pause()
      }, 360)
    }
    playSlot(slot)
  }, [nowPlayingKey, playSlot, tuneRequested, videoForSlot])

  const handleCanPlay = useCallback((slot: PlaybackSlot) => {
    if (slot === activeSlotRef.current) {
      if (tuneRequested) setTunedIn(true)
      playSlot(slot)
      return
    }
    if (playbackIdentity(slotPlaybackRef.current[slot]) === nowPlayingKey) promoteSlot(slot)
  }, [nowPlayingKey, playSlot, promoteSlot, tuneRequested])

  const handleVideoFailure = useCallback((slot: PlaybackSlot) => {
    const source = slotPlaybackRef.current[slot]
    if (!source || playbackIdentity(source) !== nowPlayingKey) return
    setFailedVideoId(source.id)
    void requestPlaybackAdvance()
  }, [nowPlayingKey, requestPlaybackAdvance])

  const handleVideoProgress = useCallback((slot: PlaybackSlot) => {
    if (slot !== activeSlotRef.current) return
    const source = slotPlaybackRef.current[slot]
    const video = videoForSlot(slot)
    if (
      !source
      || playbackIdentity(source) !== nowPlayingKey
      || !video
      || !Number.isFinite(video.duration)
      || video.duration <= 0
    ) return
    if (video.currentTime >= video.duration - 0.35) handleVideoEnded()
  }, [handleVideoEnded, nowPlayingKey, videoForSlot])

  useEffect(() => {
    if (!showVideo || !nowPlaying || !nowPlayingKey) return
    const currentSlot = activeSlotRef.current
    const current = slotPlaybackRef.current[currentSlot]
    const destination = !current
      ? currentSlot
      : playbackIdentity(current) === nowPlayingKey
        ? null
        : alternateSlot(currentSlot)
    if (!destination || playbackIdentity(slotPlaybackRef.current[destination]) === nowPlayingKey) return

    setSlotPlayback((existing) => {
      const next = { ...existing, [destination]: nowPlaying }
      slotPlaybackRef.current = next
      return next
    })
  }, [nowPlaying, nowPlayingKey, showVideo])

  useEffect(() => {
    const video = videoForSlot(activeSlot)
    if (!video || !activePlayback?.videoUrl) return

    const startPlayback = () => playSlot(activeSlot)
    video.addEventListener('canplay', startPlayback)
    const timer = window.setTimeout(startPlayback, 0)
    return () => {
      video.removeEventListener('canplay', startPlayback)
      window.clearTimeout(timer)
    }
  }, [activePlayback?.id, activePlayback?.startedAt, activePlayback?.videoUrl, activeSlot, playSlot, videoForSlot])

  useEffect(() => {
    if (!showVideo || !nowPlayingKey) return

    const watchdog = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return
      const targetSlot = (['a', 'b'] as PlaybackSlot[]).find((slot) => (
        playbackIdentity(slotPlaybackRef.current[slot]) === nowPlayingKey
      ))
      const video = targetSlot ? videoForSlot(targetSlot) : null
      if (!targetSlot || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        void requestPlaybackAdvance()
      } else if (targetSlot === activeSlotRef.current && video.paused) {
        playSlot(targetSlot)
      } else if (targetSlot !== activeSlotRef.current) {
        promoteSlot(targetSlot)
      }
    }, 8_000)

    return () => window.clearTimeout(watchdog)
  }, [nowPlayingKey, playSlot, promoteSlot, requestPlaybackAdvance, showVideo, slotPlayback, videoForSlot])

  return (
    <main className={`app ${isDesktop ? 'desktop-queue' : ''} ${chatOpen ? '' : 'chat-closed'}`}>
      <h1 className="sr-only">Infinite AI Slop: a live community-shaped AI video channel</h1>
      <div className={`tv-wrap ${tunedIn ? 'playing' : ''}`}>
        <img
          className="video-frame video-poster"
          src={poster}
          alt="Surreal AI-generated television broadcast"
          width={941}
          height={1672}
          fetchPriority="high"
        />
        {slotAPlayback?.videoUrl ? (
          <video
            ref={videoARef}
            className={`video-frame broadcast-video ${activeSlot === 'a' ? 'is-active' : ''}`}
            src={slotAPlayback.videoUrl}
            poster={optimizedPoster(slotAPlayback.posterUrl)}
            muted
            playsInline
            loop
            preload="auto"
            onCanPlay={() => handleCanPlay('a')}
            onError={() => handleVideoFailure('a')}
            onTimeUpdate={() => handleVideoProgress('a')}
            onEnded={handleVideoEnded}
          />
        ) : null}
        {slotBPlayback?.videoUrl ? (
          <video
            ref={videoBRef}
            className={`video-frame broadcast-video ${activeSlot === 'b' ? 'is-active' : ''}`}
            src={slotBPlayback.videoUrl}
            poster={optimizedPoster(slotBPlayback.posterUrl)}
            muted
            playsInline
            loop
            preload="auto"
            onCanPlay={() => handleCanPlay('b')}
            onError={() => handleVideoFailure('b')}
            onTimeUpdate={() => handleVideoProgress('b')}
            onEnded={handleVideoEnded}
          />
        ) : null}
      </div>

      <div className="top-left">
        <div className="now-playing">
          <span className="now-label">PLAYING</span>
          <span className="now-message"><span className="time">{nowTime}</span><b>{nowUser}:</b> {nowMessage}</span>
        </div>
        <div className="viewer-pill">👀 <b>{snapshot?.live.viewers ?? 0}</b> watching</div>
      </div>

      <button className="chat-toggle" onClick={() => setChatOpen((open) => !open)}>
        {chatOpen ? '× chat' : '💬 chat'}
      </button>

      {isDesktop && chatOpen ? (
        <aside className="left-queue">
          <QueuePanel
            playingNext={playingNext}
            generatingNow={generatingNow}
            queue={queue}
            onVote={(id) => void handleVote(id)}
            votedIds={votedIds}
            pendingVotes={pendingVotes}
          />
        </aside>
      ) : null}

      {chatOpen ? (
        <ChatPanel
          chat={chat}
          activeTab={activeTab}
          isDesktop={isDesktop}
          input={input}
          submitting={submitting}
          onInput={setInput}
          onSubmit={handleSubmit}
          onTab={handleTab}
          playingNext={playingNext}
          generatingNow={generatingNow}
          queue={queue}
          onVote={(id) => void handleVote(id)}
          votedIds={votedIds}
          pendingVotes={pendingVotes}
          hasOlderChat={hasOlderChat}
          loadingOlderChat={loadingOlderChat}
          onLoadOlderChat={handleLoadOlderChat}
        />
      ) : null}

      <div className="credit"><BrandCredit /></div>

      {!chatOpen ? (
        <button className="heart-button" onClick={() => void addHeart()}>❤️<span>{snapshot?.live.likes ?? 0}</span></button>
      ) : null}
      {heartKeys.map((key, index) => (
        <span className="floating-heart" key={key} style={{ '--heart-x': `${14 + (index % 3) * 18}px`, '--wobble': `${index % 2 ? 30 : -24}px` } as React.CSSProperties}>❤️</span>
      ))}

      {statusNotice ? <div className="action-notice" role="status">{statusNotice}</div> : null}
      {!tunedIn ? <Splash onTuneIn={tuneIn} tuning={tuneRequested} /> : null}

      {nameModal ? (
        <>
          <button className="modal-backdrop" onClick={() => setNameModal(false)} aria-label="Close name dialog" />
          <section className="name-modal" role="dialog" aria-modal="true" aria-labelledby="name-title">
            <h2 id="name-title">Pick a name to chat</h2>
            <form onSubmit={handleJoin}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                maxLength={18}
                placeholder="your name…"
                aria-label="Your chat name"
                disabled={submitting}
              />
              <button type="submit" disabled={submitting}>Join</button>
            </form>
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
