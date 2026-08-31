-- Polling is deliberately short-lived: each scheduled invocation leases a
-- provider task, performs at most one status request, then releases it for a
-- later tick. This keeps long video jobs below the Workers Free external
-- subrequest ceiling while preserving recovery state in D1.
ALTER TABLE ideas ADD COLUMN generation_next_poll_at INTEGER;
ALTER TABLE ideas ADD COLUMN generation_poll_lease_until INTEGER;
ALTER TABLE ideas ADD COLUMN generation_poll_token TEXT;

CREATE INDEX IF NOT EXISTS ideas_generation_poll_due
  ON ideas(status, generation_next_poll_at, generation_poll_lease_until, id);
