-- Apply once to an existing exam-pilot database created before the practice
-- library. New databases already receive these columns from schema.sql.
ALTER TABLE exams ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 5 CHECK(duration_minutes BETWEEN 1 AND 360);
ALTER TABLE exams ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE exams ADD COLUMN archived_at INTEGER;
ALTER TABLE exams ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
ALTER TABLE exams ADD COLUMN source_name TEXT NOT NULL DEFAULT '';
ALTER TABLE exams ADD COLUMN source_format TEXT NOT NULL DEFAULT '';
UPDATE exams SET archived_at=updated_at WHERE slug LIKE 'archived-%';

CREATE TABLE platform_browsers (
 token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
);
CREATE TABLE platform_exam_sessions (
 browser_token_hash TEXT NOT NULL REFERENCES platform_browsers(token_hash),
 exam_id TEXT NOT NULL REFERENCES exams(id), attempt_id TEXT NOT NULL REFERENCES attempts(id),
 PRIMARY KEY(browser_token_hash,exam_id)
);
CREATE INDEX platform_sessions_attempt ON platform_exam_sessions(attempt_id);
