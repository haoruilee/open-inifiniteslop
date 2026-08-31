PRAGMA foreign_keys = ON;

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
  votes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  status_changed_at INTEGER NOT NULL,
  provider_request_id TEXT,
  video_key TEXT,
  poster_url TEXT,
  duration_seconds REAL,
  generation_progress TEXT,
  error TEXT,
  play_count INTEGER NOT NULL DEFAULT 0,
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  workflow_id TEXT
);

CREATE TABLE IF NOT EXISTS votes (
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (idea_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS channel_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 9000,
  is_live INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, subject, window_start)
);

-- This budget is deliberately consumed before an upstream create request.  If a
-- network failure leaves the provider request ambiguous, the request is never
-- replayed and the attempt remains counted rather than risking a double charge.
CREATE TABLE IF NOT EXISTS generation_budget (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO channel_state(singleton, revision, likes, is_live, updated_at)
VALUES (1, 0, 9000, 1, unixepoch('subsec') * 1000);

CREATE INDEX IF NOT EXISTS ideas_stage_order
  ON ideas(status, status_changed_at, created_at, id);
CREATE INDEX IF NOT EXISTS ideas_queue_order
  ON ideas(status, votes DESC, created_at, id);
CREATE INDEX IF NOT EXISTS ideas_chat_recent
  ON ideas(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS rate_limits_cleanup
  ON rate_limits(window_start);
CREATE UNIQUE INDEX IF NOT EXISTS ideas_single_playing
  ON ideas(status) WHERE status = 'playing';
