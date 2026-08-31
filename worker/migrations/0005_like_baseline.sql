-- The launch counter represents the channel's existing historical audience.
-- Every increase after this one-time floor comes from an actual /api/likes write.
UPDATE channel_state
SET likes = 9000,
    revision = revision + 1,
    updated_at = unixepoch('subsec') * 1000
WHERE singleton = 1 AND likes < 9000;
