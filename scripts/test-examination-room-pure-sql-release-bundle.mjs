import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'examination-room-pure-sql-release-test-'));
const outputPath = path.join(temporaryDirectory, 'release.sql');

function assertLexicallyBalancedSql(source) {
  let index = 0;
  let state = 'normal';
  let blockCommentDepth = 0;
  let dollarTag = '';
  let parentheses = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1] || '';

    if (state === 'line-comment') {
      if (current === '\n') state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (current === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 2;
      } else if (current === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 2;
        if (blockCommentDepth === 0) state = 'normal';
      } else {
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote') {
      if (current === "'" && next === "'") {
        index += 2;
      } else if (current === '\\' && next) {
        index += 2;
      } else if (current === "'") {
        state = 'normal';
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === 'double-quote') {
      if (current === '"' && next === '"') {
        index += 2;
      } else if (current === '"') {
        state = 'normal';
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === 'dollar-quote') {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = '';
        state = 'normal';
      } else {
        index += 1;
      }
      continue;
    }

    if (current === '-' && next === '-') {
      state = 'line-comment';
      index += 2;
    } else if (current === '/' && next === '*') {
      state = 'block-comment';
      blockCommentDepth = 1;
      index += 2;
    } else if (current === "'") {
      state = 'single-quote';
      index += 1;
    } else if (current === '"') {
      state = 'double-quote';
      index += 1;
    } else if (current === '$') {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u);
      if (match) {
        dollarTag = match[0];
        state = 'dollar-quote';
        index += dollarTag.length;
      } else {
        index += 1;
      }
    } else {
      if (current === '(') parentheses += 1;
      if (current === ')') parentheses -= 1;
      assert.ok(parentheses >= 0, `Unexpected closing parenthesis at byte ${index}.`);
      index += 1;
    }
  }

  assert.ok(state === 'normal' || state === 'line-comment', `SQL ended inside ${state}.`);
  assert.equal(blockCommentDepth, 0, 'SQL ended inside a block comment.');
  assert.equal(dollarTag, '', 'SQL ended inside a dollar-quoted body.');
  assert.equal(parentheses, 0, 'SQL parentheses are unbalanced.');
}

try {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'build-examination-room-pure-sql-release-bundle.mjs'), '--output', outputPath],
    { cwd: root, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  const release = await readFile(outputPath, 'utf8');

  assert.equal(summary.releases.length, 4);
  assert.deepEqual(
    summary.releases.map(({ version }) => version),
    ['20260826130536', '20260827010000', '20260827020000', '20260827030000'],
  );
  assert.equal((release.match(/^\s*begin;\s*$/gimu) || []).length, 1);
  assert.equal((release.match(/^\s*commit;\s*$/gimu) || []).length, 1);
  assert.doesNotMatch(release, /^\s*\\/mu);
  assertLexicallyBalancedSql(release);
  assert.doesNotMatch(release, /20260827003000_paid_subscription_expiry_access/u);
  assert.doesNotMatch(release, /20260827113000_restore_historical_examination_owner_access/u);
  assert.doesNotMatch(release, /20260827133000_require_historical_examination_track/u);

  const orderedMarkers = [
    'BEGIN reviewed migration 20260826130536',
    'BEGIN reviewed migration 20260827010000',
    'BEGIN reviewed migration 20260827020000',
    'BEGIN reviewed migration 20260827030000',
  ];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const currentIndex = release.indexOf(marker);
    assert.ok(currentIndex > previousIndex, `${marker} must be present in order.`);
    previousIndex = currentIndex;
  }

  for (const required of [
    'pg_advisory_xact_lock',
    'lock table supabase_migrations.schema_migrations',
    '$examination_room_release_preflight$',
    'Partial or unrecorded Examination Room target state detected',
    'insert into supabase_migrations.schema_migrations',
    '$examination_room_release_postflight$',
    'Examination Room structural postflight failed',
    "bucket.id = 'examination-room-recovery'",
    'result_email_delivery_events',
    'prepare_student_admission(jsonb)',
    'examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)',
  ]) {
    assert.ok(release.includes(required), `Generated release must include ${required}.`);
  }

  for (const { sha256 } of summary.releases) {
    assert.match(sha256, /^[0-9a-f]{64}$/u);
    assert.ok(release.includes(`sha256:${sha256}`));
  }

  process.stdout.write(`Pure-SQL Examination Room release static checks passed (${summary.bytes} bytes, ${summary.sha256}).\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
