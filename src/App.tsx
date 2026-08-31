import { FormEvent, memo, useEffect, useMemo, useRef, useState } from 'react'

type FeedItem = {
  id: number
  time: string
  user: string
  message: string
  votes?: number
  generating?: boolean
  mine?: boolean
}

const playingNext: FeedItem[] = [
  { id: 1, time: '11:27', user: 'fede', message: 'orange cat becomes mayor of the moon' },
  { id: 2, time: '11:27', user: 'larry', message: 'a tiny game show inside a teacup' },
  { id: 3, time: '11:27', user: 'KiraKiraKaiju', message: 'clouds playing jazz at sunset' },
  { id: 4, time: '11:28', user: 'alex', message: 'a friendly robot cooks noodles' },
]

const generatingNow: FeedItem[] = [
  { id: 5, time: '11:28', user: 'dan', message: 'paint drying, literally', generating: true },
  { id: 6, time: '11:28', user: 'BooBoo', message: 'a seed grows into a tree in a glass jar', generating: true },
  { id: 7, time: '11:28', user: 'snow', message: 'a miniature orchestra made of clouds', generating: true },
]

const initialQueue: FeedItem[] = [
  { id: 8, time: '11:28', user: 'curiouscat', message: 'breakfast floating in zero gravity', votes: 3 },
  { id: 9, time: '11:28', user: 'vibey', message: 'friendly frogs host the evening news', votes: 2 },
  { id: 10, time: '11:28', user: 'teacupTV', message: 'a paper boat adventure in the rain', votes: 1 },
  { id: 11, time: '11:28', user: 'noodlebot', message: 'robots discover a jazz club on Mars', votes: 1 },
]

const initialChat: FeedItem[] = [
  { id: 21, time: '11:27', user: 'cloudchaser', message: 'clouds playing jazz at sunset' },
  { id: 22, time: '11:27', user: 'Yeroo', message: 'a cozy cabin in the snow with a cat by the fireplace' },
  { id: 23, time: '11:27', user: 'Mira', message: 'tiny astronauts having a picnic on a keyboard' },
  { id: 24, time: '11:28', user: 'Tribal', message: 'Brazil' },
  { id: 25, time: '11:28', user: 'Ivan', message: 'should I build a treehouse or a tiny library?' },
  { id: 26, time: '11:28', user: 'brian', message: 'a paper boat adventure in the rain' },
  { id: 27, time: '11:28', user: 'Catcatcat', message: 'a hedgehog running a coffee shop' },
  { id: 28, time: '11:28', user: 'brimstonecoal', message: 'friendly monsters cook breakfast together' },
  { id: 29, time: '11:28', user: 'Catcatcat', message: 'a horse rides an elevator to the moon' },
]

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

const FalMark = memo(function FalMark() {
  return (
    <span className="fal-mark" aria-label="fal.ai">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 1.5c1.35 0 2.45 1.1 2.58 2.44A9.64 9.64 0 0 0 28.06 13.4 2.6 2.6 0 0 1 30.5 16a2.6 2.6 0 0 1-2.44 2.6 9.64 9.64 0 0 0-9.48 9.46A2.6 2.6 0 0 1 16 30.5a2.6 2.6 0 0 1-2.58-2.44 9.64 9.64 0 0 0-9.48-9.46A2.6 2.6 0 0 1 1.5 16a2.6 2.6 0 0 1 2.44-2.6 9.64 9.64 0 0 0 9.48-9.46A2.6 2.6 0 0 1 16 1.5Zm0 8.9a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2Z" />
      </svg>
      <span>fal</span>
    </span>
  )
})

const BrandCredit = memo(function BrandCredit({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? 'brand-credit compact' : 'brand-credit'}>
      by{' '}
      <a href="https://x.com/levelsio" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        @levelsio
      </a>{' '}
      + <a href="https://fal.ai/minimax-h3-max" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><FalMark /></a>
    </span>
  )
})

const FeedBubble = memo(function FeedBubble({ item, className = '' }: { item: FeedItem; className?: string }) {
  return (
    <div
      className={`feed-bubble ${item.generating ? 'generating' : ''} ${item.mine ? 'hot' : ''} ${className}`}
      style={!item.generating && !item.mine ? { background: pastel(item.user) } : undefined}
    >
      <span className="time">{item.time}</span>
      <b>{item.user}</b>
      {item.message}
    </div>
  )
})

function QueuePanel({ queue, onVote }: { queue: FeedItem[]; onVote: (id: number) => void }) {
  return (
    <div className="queue-panel" data-testid="queue-panel">
      <h2>PLAYING NEXT</h2>
      <div className="feed-stack playing-stack">
        {playingNext.map((item) => <FeedBubble key={item.id} item={item} />)}
      </div>
      <h2>NOW GENERATING</h2>
      <div className="feed-stack">
        {generatingNow.map((item) => <FeedBubble key={item.id} item={item} />)}
      </div>
      <h2>QUEUE</h2>
      <div className="feed-stack">
        {queue.map((item) => (
          <div className="queue-row" key={item.id}>
            <button className="upvote" onClick={() => onVote(item.id)} aria-label={`Upvote ${item.user}'s idea`}>
              ▲<span>{item.votes ?? 0}</span>
            </button>
            <FeedBubble item={item} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatPanel({
  chat,
  activeTab,
  isDesktop,
  input,
  onInput,
  onSubmit,
  onTab,
  queue,
  onVote,
}: {
  chat: FeedItem[]
  activeTab: 'chat' | 'queue'
  isDesktop: boolean
  input: string
  onInput: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onTab: (tab: 'chat' | 'queue') => void
  queue: FeedItem[]
  onVote: (id: number) => void
}) {
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const messages = messagesRef.current
      if (messages) messages.scrollTop = messages.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chat.length])

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
          <div className="chat-messages" data-testid="chat-messages" ref={messagesRef}>
            {chat.map((item) => <FeedBubble key={item.id} item={item} className="chat-bubble" />)}
          </div>
          <form className="chat-form" onSubmit={onSubmit}>
            <input
              aria-label="What you wanna see next"
              value={input}
              onChange={(event) => onInput(event.target.value)}
              maxLength={200}
              placeholder="What you wanna see next…"
              autoComplete="off"
            />
            <button type="submit">Say</button>
          </form>
        </div>
      ) : (
        <QueuePanel queue={queue} onVote={onVote} />
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

function Splash({ onTuneIn }: { onTuneIn: () => void }) {
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
        <span className="logo">Infinite Slop</span>
        <PlayIcon />
        <span className="subtitle">
          an endless AI-generated TV channel.<br />
          the chat decides what airs next
        </span>
        <BrandCredit compact />
      </span>
    </div>
  )
}

function App() {
  const isDesktop = useDeskQueue()
  const [tunedIn, setTunedIn] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'chat' | 'queue'>('chat')
  const [input, setInput] = useState('')
  const [nickname, setNickname] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [nameModal, setNameModal] = useState(false)
  const [pendingMessage, setPendingMessage] = useState('')
  const [chat, setChat] = useState(initialChat)
  const [queue, setQueue] = useState(initialQueue)
  const [likes, setLikes] = useState(0)
  const [heartKeys, setHeartKeys] = useState<number[]>([])

  const nowPlaying = useMemo(() => ({
    time: '11:28',
    user: 'teacupTV',
    message: 'friendly robots host a tiny cosmic game show inside a teacup on the moon',
  }), [])

  function submitMessage(message: string, user: string) {
    const trimmed = message.trim()
    if (!trimmed) return
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const item: FeedItem = { id: Date.now(), time, user, message: trimmed, votes: 0, mine: true }
    setChat((items) => [...items, item])
    setQueue((items) => [...items, item])
    setInput('')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim()) return
    if (!nickname) {
      setPendingMessage(input)
      setNameModal(true)
      return
    }
    submitMessage(input, nickname)
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault()
    const safeName = nameDraft.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 18)
    if (!safeName) return
    setNickname(safeName)
    setNameModal(false)
    submitMessage(pendingMessage, safeName)
    setPendingMessage('')
  }

  function handleVote(id: number) {
    setQueue((items) => items.map((item) => item.id === id ? { ...item, votes: (item.votes ?? 0) + 1 } : item))
  }

  function addHeart() {
    const key = Date.now()
    setLikes((count) => count + 1)
    setHeartKeys((keys) => [...keys, key])
    window.setTimeout(() => setHeartKeys((keys) => keys.filter((item) => item !== key)), 2700)
  }

  function handleTab(tab: 'chat' | 'queue') {
    if (activeTab === tab) {
      setChatOpen(false)
      return
    }
    setActiveTab(tab)
  }

  return (
    <main className={`app ${isDesktop ? 'desktop-queue' : ''} ${chatOpen ? '' : 'chat-closed'}`}>
      <div className={`tv-wrap ${tunedIn ? 'playing' : ''}`}>
        <img className="video-frame" src="/assets/tv-frame.png" alt="Surreal AI-generated television broadcast" />
      </div>

      {tunedIn ? <div className="live-pill"><span />LIVE</div> : null}

      <div className="top-left">
        <div className="now-playing">
          <span className="now-label">PLAYING</span>
          <span className="now-message"><span className="time">{nowPlaying.time}</span><b>{nowPlaying.user}:</b> {nowPlaying.message}</span>
        </div>
        <div className="viewer-pill">👀 <b>753</b> watching</div>
      </div>

      <button className="chat-toggle" onClick={() => setChatOpen((open) => !open)}>
        {chatOpen ? '× chat' : '💬 chat'}
      </button>

      {isDesktop && chatOpen ? (
        <aside className="left-queue">
          <QueuePanel queue={queue} onVote={handleVote} />
        </aside>
      ) : null}

      {chatOpen ? (
        <ChatPanel
          chat={chat}
          activeTab={activeTab}
          isDesktop={isDesktop}
          input={input}
          onInput={setInput}
          onSubmit={handleSubmit}
          onTab={handleTab}
          queue={queue}
          onVote={handleVote}
        />
      ) : null}

      <div className="credit"><BrandCredit /></div>

      {!chatOpen ? (
        <button className="heart-button" onClick={addHeart}>❤️<span>{likes}</span></button>
      ) : null}
      {heartKeys.map((key, index) => (
        <span className="floating-heart" key={key} style={{ '--heart-x': `${14 + (index % 3) * 18}px`, '--wobble': `${index % 2 ? 30 : -24}px` } as React.CSSProperties}>❤️</span>
      ))}

      {!tunedIn ? <Splash onTuneIn={() => setTunedIn(true)} /> : null}

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
              />
              <button type="submit">Join</button>
            </form>
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
