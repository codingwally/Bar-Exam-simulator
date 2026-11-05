PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS exams (
 id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('practice','official')),
 draft_version INTEGER NOT NULL DEFAULT 0, draft_json TEXT NOT NULL DEFAULT '[]', published_version INTEGER,
 starts_at INTEGER, ends_at INTEGER, control TEXT NOT NULL DEFAULT 'normal' CHECK(control IN ('normal','paused','cancelled')),
 admission_enabled INTEGER NOT NULL DEFAULT 1 CHECK(admission_enabled IN (0,1)), access_key_hash TEXT, access_key TEXT,
 duration_minutes INTEGER NOT NULL DEFAULT 5 CHECK(duration_minutes BETWEEN 1 AND 360),
 instructions TEXT NOT NULL DEFAULT '', archived_at INTEGER,
 source_text TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL DEFAULT '', source_format TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS question_versions (
 exam_id TEXT NOT NULL REFERENCES exams(id), version INTEGER NOT NULL, approved_at INTEGER NOT NULL, approved_by TEXT NOT NULL,
 PRIMARY KEY(exam_id,version)
);
CREATE TABLE IF NOT EXISTS questions (
 id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, version INTEGER NOT NULL, number INTEGER NOT NULL, text TEXT NOT NULL,
 instructions TEXT NOT NULL DEFAULT '', points REAL,
 FOREIGN KEY(exam_id,version) REFERENCES question_versions(exam_id,version), UNIQUE(exam_id,version,number)
);
CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), version INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
 registration_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('waiting','active','finalized')), created_at INTEGER NOT NULL, started_at INTEGER,
 deadline_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, last_saved_at INTEGER, position TEXT,
 lease_editor TEXT, lease_expires_at INTEGER NOT NULL DEFAULT 0, finalized_at INTEGER, finalization_type TEXT,
 UNIQUE(exam_id,registration_hash)
);
CREATE INDEX IF NOT EXISTS attempts_exam ON attempts(exam_id,created_at,id);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_browsers (
 token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_exam_sessions (
 browser_token_hash TEXT NOT NULL REFERENCES platform_browsers(token_hash),
 exam_id TEXT NOT NULL REFERENCES exams(id), attempt_id TEXT NOT NULL REFERENCES attempts(id),
 PRIMARY KEY(browser_token_hash,exam_id)
);
CREATE INDEX IF NOT EXISTS platform_sessions_attempt ON platform_exam_sessions(attempt_id);
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, secret_version TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_login_windows (
 key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, failures INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS answer_operations (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), question_id TEXT NOT NULL REFERENCES questions(id),
 revision INTEGER NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, saved_at INTEGER NOT NULL,
 UNIQUE(attempt_id,question_id,revision)
);
CREATE TABLE IF NOT EXISTS answers (
 attempt_id TEXT NOT NULL REFERENCES attempts(id), question_id TEXT NOT NULL REFERENCES questions(id),
 revision INTEGER NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, saved_at INTEGER NOT NULL, operation_id TEXT NOT NULL,
 PRIMARY KEY(attempt_id,question_id)
);
CREATE TABLE IF NOT EXISTS submissions (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), receipt_id TEXT UNIQUE NOT NULL, checksum TEXT, question_count INTEGER,
 answered_count INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS final_answers (
 attempt_id TEXT NOT NULL REFERENCES attempts(id), question_id TEXT NOT NULL REFERENCES questions(id),
 revision INTEGER NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, saved_at INTEGER,
 PRIMARY KEY(attempt_id,question_id)
);
CREATE TABLE IF NOT EXISTS recovered_drafts (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), question_id TEXT NOT NULL REFERENCES questions(id),
 revision INTEGER NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, client_time TEXT, received_at INTEGER NOT NULL,
 label TEXT NOT NULL DEFAULT 'late/offline recovered draft'
);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, attempt_id TEXT REFERENCES attempts(id), exam_id TEXT NOT NULL REFERENCES exams(id), question_id TEXT,
 type TEXT NOT NULL, client_time TEXT, received_at INTEGER NOT NULL, provenance TEXT NOT NULL,
 details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_attempt ON events(attempt_id,received_at,id);
CREATE TABLE IF NOT EXISTS admin_audit (
 id TEXT PRIMARY KEY, identity TEXT NOT NULL, action TEXT NOT NULL, exam_id TEXT, attempt_id TEXT,
 received_at INTEGER NOT NULL, details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS admin_operations (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, result_exam_id TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_tokens (
 token_hash TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), expires_at INTEGER NOT NULL,
 consumed_at INTEGER, created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
 id TEXT PRIMARY KEY, target TEXT NOT NULL, attempt_id TEXT NOT NULL REFERENCES attempts(id), dedupe_key TEXT UNIQUE NOT NULL,
 kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, reference TEXT, created_at INTEGER NOT NULL, sent_at INTEGER, claim_token TEXT
);
CREATE TABLE IF NOT EXISTS registration_windows (
 key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, requests INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status,next_attempt_at,lease_until);
INSERT OR IGNORE INTO exams(id,slug,title,kind,draft_version,published_version,created_at,updated_at)
 VALUES('practice','practice','Constitutional Law I — Practice','practice',1,1,0,0);
INSERT OR IGNORE INTO exams(id,slug,title,kind,created_at,updated_at)
 VALUES('official','official','Constitutional Law I — Official Midterm','official',0,0);
INSERT OR IGNORE INTO question_versions(exam_id,version,approved_at,approved_by) VALUES('practice',1,0,'initial approved practice question');
INSERT OR IGNORE INTO questions(id,exam_id,version,number,text,instructions)
 VALUES('practice-v1-q1','practice',1,1,'Congress passes a law extending the term of Philippine Senators from six years to seven years. Supporters argue that the statute should prevail because Congress passed it and the President signed it.' || char(10) || char(10) || 'Under the principle of constitutional supremacy, is the law valid? Explain using the ALAC method (Answer, Legal Basis, Application, Conclusion).','Constitutional Law I — Constitutional Supremacy');
