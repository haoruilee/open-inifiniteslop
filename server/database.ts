import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  ChannelSnapshot,
  CreateSubmissionResult,
  IdeaRecord,
  IdeaStatus,
  ModerationDecision,
  ModerationResult,
  PublicIdea,
} from './types.js'
import { normalizePrompt } from './moderation.js'

type IdeaRow = {
  id: number
  visitor_id: string
  author: string
  body: string
  normalized_body: string
  status: IdeaStatus
  moderation_reason: string | null
  votes: number
  created_at: number
  status_changed_at: number
  provider: string | null
  provider_request_id: string | null
  video_url: string | null
  video_path: string | null
  poster_url: string | null
  duration_seconds: number | null
  generation_progress: string | null
  error: string | null
  play_count: number
  generation_attempts: number
  retry_at: number | null
}

type ChannelRow = {
  revision: number
  likes: number
  viewers: number
  is_live: number
  provider: string
}

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visitors (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL REFERENCES visitors(id),
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    normalized_body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (
      'pending_review','rejected','queued','generating','ready','playing','aired','failed'
    )),
    moderation_reason TEXT,
    created_at INTEGER NOT NULL,
    status_changed_at INTEGER NOT NULL,
    provider TEXT,
    provider_request_id TEXT,
    video_url TEXT,
    video_path TEXT,
    poster_url TEXT,
    duration_seconds REAL,
    generation_progress TEXT,
    error TEXT,
    play_count INTEGER NOT NULL DEFAULT 0,
    generation_attempts INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS votes (
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (idea_id, visitor_id)
  );

  CREATE TABLE IF NOT EXISTS channel_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    revision INTEGER NOT NULL,
    likes INTEGER NOT NULL,
    viewers INTEGER NOT NULL,
    is_live INTEGER NOT NULL,
    provider TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ideas_stage_order
    ON ideas(status, status_changed_at, created_at, id);
  CREATE INDEX IF NOT EXISTS ideas_queue_order
    ON ideas(status, created_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS ideas_single_playing
    ON ideas(status) WHERE status = 'playing';
  CREATE INDEX IF NOT EXISTS chat_recent
    ON chat_messages(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS votes_by_idea
    ON votes(idea_id);
`

const publicStatusSql = `
  SELECT i.*, COUNT(v.idea_id) AS votes
  FROM ideas i
  LEFT JOIN votes v ON v.idea_id = i.id
`

function mapIdea(row: IdeaRow): IdeaRecord {
  return {
    id: Number(row.id),
    visitorId: row.visitor_id,
    author: row.author,
    body: row.body,
    normalizedBody: row.normalized_body,
    status: row.status,
    moderationReason: row.moderation_reason,
    votes: Number(row.votes),
    createdAt: Number(row.created_at),
    statusChangedAt: Number(row.status_changed_at),
    provider: row.provider,
    providerRequestId: row.provider_request_id,
    videoUrl: row.video_url,
    videoPath: row.video_path,
    posterUrl: row.poster_url,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    generationProgress: row.generation_progress,
    error: row.error,
    playCount: Number(row.play_count),
    generationAttempts: Number(row.generation_attempts),
    retryAt: row.retry_at === null ? null : Number(row.retry_at),
  }
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function toPublicIdea(idea: IdeaRecord): PublicIdea {
  return {
    id: idea.id,
    user: idea.author,
    message: idea.body,
    status: idea.status,
    votes: idea.votes,
    createdAt: idea.createdAt,
    time: formatClock(idea.createdAt),
    videoUrl: idea.videoUrl,
    posterUrl: idea.posterUrl,
    durationSeconds: idea.durationSeconds,
    generationProgress: idea.generationProgress,
    startedAt: idea.status === 'playing' ? idea.statusChangedAt : null,
  }
}

export class DuplicateSubmissionError extends Error {
  constructor() {
    super('This prompt was submitted recently')
    this.name = 'DuplicateSubmissionError'
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidStateError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export type ChannelDatabaseOptions = {
  seed?: boolean
  now?: () => number
  provider?: string
}

export class ChannelDatabase {
  readonly db: DatabaseSync
  private readonly now: () => number

  constructor(databasePath: string, options: ChannelDatabaseOptions = {}) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.now = options.now ?? Date.now
    this.db.exec(schema)
    this.migrate(options.provider ?? 'mock')
    if (options.seed ?? true) this.seedDemoQueue()
  }

  private migrate(provider: string) {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)
      `).run(now)
      const columns = this.db.prepare('PRAGMA table_info(ideas)').all() as Array<{ name: string }>
      if (!columns.some((column) => column.name === 'generation_attempts')) {
        this.db.exec('ALTER TABLE ideas ADD COLUMN generation_attempts INTEGER NOT NULL DEFAULT 0')
      }
      if (!columns.some((column) => column.name === 'retry_at')) {
        this.db.exec('ALTER TABLE ideas ADD COLUMN retry_at INTEGER')
      }
      this.db.prepare(`
        INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)
      `).run(now)
      this.db.prepare(`
        INSERT OR IGNORE INTO channel_state(
          singleton, revision, likes, viewers, is_live, provider, updated_at
        ) VALUES (1, 0, 9000, 1, 1, ?, ?)
      `).run(provider, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private seedDemoQueue() {
    const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as { count: number }).count)
    if (count > 0) return

    const samples = [
      ['fede', 'orange cat becomes mayor of the moon'],
      ['larry', 'a tiny game show inside a teacup'],
      ['KiraKiraKaiju', 'clouds playing jazz at sunset'],
      ['alex', 'a friendly robot cooks noodles'],
    ] as const
    const now = this.now()
    const visitorId = 'seed-demo'

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.upsertVisitor(visitorId, now)
      for (const [index, [author, body]] of samples.entries()) {
        const createdAt = now - (samples.length - index) * 1_000
        const result = this.db.prepare(`
          INSERT INTO ideas(
            visitor_id, author, body, normalized_body, status, moderation_reason,
            created_at, status_changed_at
          ) VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?)
        `).run(visitorId, author, body, normalizePrompt(body).toLocaleLowerCase('en'), createdAt, createdAt)
        this.db.prepare('INSERT INTO chat_messages(idea_id, created_at) VALUES (?, ?)')
          .run(Number(result.lastInsertRowid), createdAt)
      }
      this.bumpRevision(now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private upsertVisitor(visitorId: string, at: number) {
    this.db.prepare(`
      INSERT INTO visitors(id, created_at, last_seen_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).run(visitorId, at, at)
  }

  private bumpRevision(at: number) {
    this.db.prepare(`
      UPDATE channel_state SET revision = revision + 1, updated_at = ? WHERE singleton = 1
    `).run(at)
    return this.getRevision()
  }

  getRevision() {
    const row = this.db.prepare('SELECT revision FROM channel_state WHERE singleton = 1').get() as { revision: number }
    return Number(row.revision)
  }

  createSubmission(
    visitorId: string,
    author: string,
    body: string,
    moderation: ModerationResult,
  ): CreateSubmissionResult {
    const now = this.now()
    const normalizedBody = normalizePrompt(body)
    const normalizedKey = normalizedBody.toLocaleLowerCase('en')
    const status: IdeaStatus = moderation.decision === 'approve'
      ? 'queued'
      : moderation.decision === 'review'
        ? 'pending_review'
        : 'rejected'

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.upsertVisitor(visitorId, now)
      const duplicate = this.db.prepare(`
        SELECT id FROM ideas
        WHERE normalized_body = ? AND created_at >= ? AND status != 'rejected'
        LIMIT 1
      `).get(normalizedKey, now - 10 * 60_000)
      if (duplicate) throw new DuplicateSubmissionError()

      const result = this.db.prepare(`
        INSERT INTO ideas(
          visitor_id, author, body, normalized_body, status, moderation_reason,
          created_at, status_changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        visitorId,
        author,
        normalizedBody,
        normalizedKey,
        status,
        moderation.reason,
        now,
        now,
      )
      const ideaId = Number(result.lastInsertRowid)
      this.db.prepare('INSERT INTO chat_messages(idea_id, created_at) VALUES (?, ?)').run(ideaId, now)
      const revision = this.bumpRevision(now)
      this.db.exec('COMMIT')
      return { idea: this.getIdea(ideaId), revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getIdea(id: number) {
    const row = this.db.prepare(`${publicStatusSql}
      WHERE i.id = ?
      GROUP BY i.id
    `).get(id) as IdeaRow | undefined
    if (!row) throw new NotFoundError('Idea not found')
    return mapIdea(row)
  }

  vote(ideaId: number, visitorId: string) {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.upsertVisitor(visitorId, now)
      const row = this.db.prepare('SELECT status FROM ideas WHERE id = ?').get(ideaId) as { status: IdeaStatus } | undefined
      if (!row) throw new NotFoundError('Idea not found')
      if (row.status !== 'queued') throw new InvalidStateError('Only queued ideas can be voted on')
      const existing = this.db.prepare('SELECT 1 FROM votes WHERE idea_id = ? AND visitor_id = ?')
        .get(ideaId, visitorId)
      if (existing) throw new InvalidStateError('Already voted')
      this.db.prepare('INSERT INTO votes(idea_id, visitor_id, created_at) VALUES (?, ?, ?)')
        .run(ideaId, visitorId, now)
      const revision = this.bumpRevision(now)
      this.db.exec('COMMIT')
      return { idea: this.getIdea(ideaId), revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  like() {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE channel_state SET likes = likes + 1 WHERE singleton = 1').run()
      const revision = this.bumpRevision(now)
      const row = this.db.prepare('SELECT likes FROM channel_state WHERE singleton = 1').get() as { likes: number }
      this.db.exec('COMMIT')
      return { likes: Number(row.likes), revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  moderate(ideaId: number, decision: Exclude<ModerationDecision, 'review'>, reason: string | null) {
    const now = this.now()
    const nextStatus: IdeaStatus = decision === 'approve' ? 'queued' : 'rejected'
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare('SELECT status FROM ideas WHERE id = ?').get(ideaId) as { status: IdeaStatus } | undefined
      if (!row) throw new NotFoundError('Idea not found')
      if (!['pending_review', 'rejected'].includes(row.status)) {
        throw new InvalidStateError('Idea is not awaiting moderation')
      }
      this.db.prepare(`
        UPDATE ideas
        SET status = ?, moderation_reason = ?, status_changed_at = ?, error = NULL
        WHERE id = ?
      `).run(nextStatus, reason, now, ideaId)
      const revision = this.bumpRevision(now)
      this.db.exec('COMMIT')
      return { idea: this.getIdea(ideaId), revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listModeration(status: 'pending_review' | 'rejected' = 'pending_review') {
    const rows = this.db.prepare(`${publicStatusSql}
      WHERE i.status = ?
      GROUP BY i.id
      ORDER BY i.created_at ASC, i.id ASC
      LIMIT 100
    `).all(status) as IdeaRow[]
    return rows.map(mapIdea)
  }

  requeueInterruptedGeneration() {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const ambiguous = this.db.prepare(`
        UPDATE ideas
        SET status = 'failed', status_changed_at = ?, generation_progress = 'submission_state_unknown',
            error = 'orange_submission_state_unknown', retry_at = NULL
        WHERE status = 'generating' AND provider = 'orange' AND provider_request_id IS NULL
      `).run(now)
      const resumable = this.db.prepare(`
        UPDATE ideas
        SET status = 'queued', status_changed_at = ?, generation_progress = 'recovered_after_restart',
            error = NULL, retry_at = NULL
        WHERE status = 'generating'
          AND (COALESCE(provider, '') != 'orange' OR provider_request_id IS NOT NULL)
      `).run(now)
      const changed = Number(ambiguous.changes) > 0 || Number(resumable.changes) > 0
      const revision = changed ? this.bumpRevision(now) : this.getRevision()
      this.db.exec('COMMIT')
      return { changed, revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  pipelineCounts() {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM ideas
      WHERE status IN ('generating', 'ready', 'playing')
      GROUP BY status
    `).all() as Array<{ status: 'generating' | 'ready' | 'playing'; count: number }>
    const result = { generating: 0, ready: 0, playing: 0 }
    for (const row of rows) result[row.status] = Number(row.count)
    return result
  }

  claimNextForGeneration(provider: string) {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare(`${publicStatusSql}
        WHERE i.status = 'queued' AND (i.retry_at IS NULL OR i.retry_at <= ?)
        GROUP BY i.id
        ORDER BY votes DESC, i.created_at ASC, i.id ASC
        LIMIT 1
      `).get(now) as IdeaRow | undefined
      if (!row) {
        this.db.exec('COMMIT')
        return null
      }
      this.db.prepare(`
        UPDATE ideas
        SET status = 'generating', status_changed_at = ?,
            provider_request_id = CASE WHEN provider IS NULL OR provider = ? THEN provider_request_id ELSE NULL END,
            provider = ?,
            generation_progress = 'starting', error = NULL, retry_at = NULL,
            generation_attempts = generation_attempts + 1
        WHERE id = ? AND status = 'queued'
      `).run(now, provider, provider, row.id)
      this.bumpRevision(now)
      this.db.exec('COMMIT')
      return this.getIdea(row.id)
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  updateGenerationProgress(ideaId: number, progress: string, requestId?: string) {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare(`
        UPDATE ideas
        SET generation_progress = ?, provider_request_id = COALESCE(?, provider_request_id),
            status_changed_at = status_changed_at
        WHERE id = ? AND status = 'generating'
      `).run(progress.slice(0, 160), requestId ?? null, ideaId)
      const changed = Number(result.changes) > 0
      const revision = changed ? this.bumpRevision(now) : this.getRevision()
      this.db.exec('COMMIT')
      return { changed, revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  completeGeneration(ideaId: number, media: {
    videoUrl: string | null
    videoPath: string | null
    posterUrl: string | null
    durationSeconds: number
    providerRequestId: string | null
  }) {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare(`
        UPDATE ideas
        SET status = 'ready', status_changed_at = ?, video_url = ?, video_path = ?,
            poster_url = ?, duration_seconds = ?, provider_request_id = COALESCE(?, provider_request_id),
            generation_progress = 'complete', error = NULL, retry_at = NULL
        WHERE id = ? AND status = 'generating'
      `).run(
        now,
        media.videoUrl,
        media.videoPath,
        media.posterUrl,
        media.durationSeconds,
        media.providerRequestId,
        ideaId,
      )
      if (Number(result.changes) === 0) throw new InvalidStateError('Idea is not generating')
      const revision = this.bumpRevision(now)
      this.db.exec('COMMIT')
      return { idea: this.getIdea(ideaId), revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  failGeneration(ideaId: number, message: string, retryDelayMs: number | null) {
    const now = this.now()
    const nextStatus: IdeaStatus = retryDelayMs === null ? 'failed' : 'queued'
    const retryAt = retryDelayMs === null ? null : now + retryDelayMs
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare(`
        UPDATE ideas
        SET status = ?, status_changed_at = ?, generation_progress = ?, error = ?, retry_at = ?
        WHERE id = ? AND status = 'generating'
      `).run(
        nextStatus,
        now,
        retryDelayMs === null ? 'failed' : 'retry_scheduled',
        message.slice(0, 240),
        retryAt,
        ideaId,
      )
      if (Number(result.changes) === 0) return { changed: false, revision: this.getRevision() }
      const revision = this.bumpRevision(now)
      this.db.exec('COMMIT')
      return { changed: true, revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  advancePlayback() {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      let changed = false
      const current = this.db.prepare(`
        SELECT id, status_changed_at, COALESCE(duration_seconds, 10) AS duration_seconds
        FROM ideas WHERE status = 'playing'
        ORDER BY status_changed_at ASC, id ASC LIMIT 1
      `).get() as { id: number; status_changed_at: number; duration_seconds: number } | undefined

      let needsNext = !current
      let justAiredId: number | null = null
      if (current && now - Number(current.status_changed_at) >= Number(current.duration_seconds) * 1_000) {
        this.db.prepare(`
          UPDATE ideas SET status = 'aired', status_changed_at = ? WHERE id = ? AND status = 'playing'
        `).run(now, current.id)
        changed = true
        needsNext = true
        justAiredId = current.id
      }

      if (needsNext) {
        const fresh = this.db.prepare(`
          SELECT id, status FROM ideas WHERE status = 'ready'
          ORDER BY status_changed_at ASC, id ASC LIMIT 1
        `).get() as { id: number; status: 'ready' } | undefined
        const replay = fresh ? undefined : this.db.prepare(`
          SELECT id, status FROM ideas
          WHERE status = 'aired' AND (video_url IS NOT NULL OR video_path IS NOT NULL)
          ORDER BY
            CASE WHEN id = ? THEN 1 ELSE 0 END,
            play_count ASC,
            status_changed_at ASC,
            id ASC
          LIMIT 1
        `).get(justAiredId ?? -1) as { id: number; status: 'aired' } | undefined
        const next = fresh ?? replay
        if (next) {
          this.db.prepare(`
            UPDATE ideas
            SET status = 'playing', status_changed_at = ?, play_count = play_count + 1
            WHERE id = ? AND status = ?
          `).run(now, next.id, next.status)
          changed = true
        }
      }

      const revision = changed ? this.bumpRevision(now) : this.getRevision()
      this.db.exec('COMMIT')
      return { changed, revision }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private listByStatus(status: IdeaStatus, limit: number, orderBy: string) {
    const rows = this.db.prepare(`${publicStatusSql}
      WHERE i.status = ?
      GROUP BY i.id
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(status, limit) as IdeaRow[]
    return rows.map(mapIdea)
  }

  listChatPage(before: number | null, limit: number) {
    const safeLimit = Math.min(200, Math.max(10, Math.trunc(limit)))
    const rows = this.db.prepare(`${publicStatusSql}
      INNER JOIN chat_messages c ON c.idea_id = i.id
      WHERE i.status NOT IN ('pending_review', 'rejected')
        AND (? IS NULL OR i.id < ?)
      GROUP BY i.id
      ORDER BY i.id DESC
      LIMIT ?
    `).all(before, before, safeLimit + 1) as IdeaRow[]
    const hasMore = rows.length > safeLimit
    const items = rows.slice(0, safeLimit).reverse().map(mapIdea).map(toPublicIdea)
    return {
      items,
      page: {
        hasMore,
        nextBefore: items.length > 0 ? items[0].id : null,
      },
    }
  }

  snapshot(providerOverride?: string): ChannelSnapshot {
    const channel = this.db.prepare('SELECT * FROM channel_state WHERE singleton = 1').get() as ChannelRow
    const nowPlaying = this.listByStatus('playing', 1, 'i.status_changed_at ASC, i.id ASC')[0] ?? null
    const freshNext = this.listByStatus('ready', 8, 'i.status_changed_at ASC, i.id ASC')
    const replaySlots = Math.max(0, 8 - freshNext.length)
    const replayNext = replaySlots > 0
      ? (this.db.prepare(`${publicStatusSql}
          WHERE i.status = 'aired' AND (i.video_url IS NOT NULL OR i.video_path IS NOT NULL)
          GROUP BY i.id
          ORDER BY i.play_count ASC, i.status_changed_at ASC, i.id ASC
          LIMIT ?
        `).all(replaySlots) as IdeaRow[]).map(mapIdea)
      : []
    const playingNext = [...freshNext, ...replayNext]
    const generatingNow = this.listByStatus('generating', 20, 'i.status_changed_at ASC, i.id ASC')
    const queue = this.listByStatus('queued', 50, 'votes DESC, i.created_at ASC, i.id ASC')
    const chat = this.listChatPage(null, 60)

    return {
      revision: Number(channel.revision),
      live: {
        isLive: Boolean(channel.is_live),
        viewers: Number(channel.viewers),
        likes: Number(channel.likes),
        provider: providerOverride ?? channel.provider,
      },
      nowPlaying: nowPlaying ? toPublicIdea(nowPlaying) : null,
      playingNext: playingNext.map(toPublicIdea),
      generatingNow: generatingNow.map(toPublicIdea),
      queue: queue.map(toPublicIdea),
      chat: chat.items,
      chatPage: {
        hasMore: chat.page.hasMore,
        oldestId: chat.items.length > 0 ? chat.items[0].id : null,
      },
      serverTime: this.now(),
    }
  }

  close() {
    this.db.close()
  }
}
