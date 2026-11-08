-- Additive, once-only migration for an existing practice-library database.
-- New databases receive these tables directly from schema.sql.
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, secret_version TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_login_windows (
 key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, failures INTEGER NOT NULL
);
