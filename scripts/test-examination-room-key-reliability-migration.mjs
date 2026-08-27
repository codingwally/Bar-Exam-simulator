import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const migrationName = '20260827190036_examination_room_key_delivery_nullable_creator.sql';
const normalizeNewlines = (value) => value.replace(/\r\n/gu, '\n');
const migration = normalizeNewlines(await readFile(
  new URL(`supabase/migrations/${migrationName}`, root),
  'utf8',
));
const greenfield = normalizeNewlines(await readFile(
  new URL('supabase/migrations/20260825183055_examination_room_v1_greenfield.sql', root),
  'utf8',
));
const ownerCommandCenter = normalizeNewlines(await readFile(
  new URL('supabase/migrations/20260826130536_examination_room_owner_command_center.sql', root),
  'utf8',
));
const worker = normalizeNewlines(await readFile(new URL('worker/index.mjs', root), 'utf8'));

const creatorEmailGuard = `    if p_operation = 'email_key' and professor_email is null then
      return examination_room_v1.api_error(
        'PROFESSOR_CONTACT_REQUIRED', 'The professor account has no verified delivery email.', 409,
        'Add the professor contact through institution onboarding, then issue and email the key again.'
      );
    end if;
`;
const mutableReplayGuard = `      if stored_key_hash <> p_payload ->> 'roomKeyHash' then
        if activation_status = 'scheduled'
           and not exists (select 1 from examination_room_v1.student_sessions s where s.activation_id = activation_id) then
          update examination_room_v1.room_activations a
          set key_hash = p_payload ->> 'roomKeyHash'
          where a.id = activation_id;
        else
          return examination_room_v1.api_error(
            'ACTIVATION_REPLAY_REQUIRES_NEW_REQUEST',
            'The prior room-key request is already open or in use and cannot be reissued with a different key.',
            409,
            'Create a new administrator request and revoke the old key if replacement is required.'
          );
        end if;
      end if;
`;
const nullableUnsafeAuditMatch = 'and persisted.professor_recipient = excluded.professor_recipient';

assert.ok(
  greenfield.includes(creatorEmailGuard),
  'the migration must target the exact installed creator-email guard',
);
assert.match(
  migration,
  /'if p_operation = ''email_key'' and professor_email is null then'/u,
);
assert.match(migration, /patched_definition := overlay\(/u);
assert.match(migration, /position\('PROFESSOR_CONTACT_REQUIRED' in patched_definition\) <> 0/u);
assert.match(migration, /'''professorEmail'', professor_email'/u);
assert.match(migration, /examination_room_v1\.api_record_audit/u);

assert.ok(
  greenfield.includes(mutableReplayGuard),
  'the strict replay migration must target the exact installed mutable replay block',
);
assert.match(migration, /'if stored_key_hash <> p_payload ->> ''roomKeyHash'' then'/u);
assert.match(migration, /replay_return_relative - 1/u);
assert.match(migration, /strict replay migration did not remove the mutable key-hash update/u);
assert.match(migration, /The prior room-key request is already bound to a different key\./u);
assert.match(migration, /Use the explicit Rotate key action/u);

assert.ok(
  ownerCommandCenter.includes(nullableUnsafeAuditMatch),
  'the migration must target the installed delivery-audit equality',
);
assert.ok(migration.includes(nullableUnsafeAuditMatch));
assert.match(
  migration,
  /persisted\.professor_recipient is not distinct from excluded\.professor_recipient/u,
);
assert.match(
  migration,
  /public\.examination_room_v1_owner_command\(text,uuid,uuid,uuid,jsonb\)/u,
);

assert.match(
  migration,
  /alter column professor_recipient drop not null/u,
);
assert.match(
  migration,
  /professor_recipient is null\s+or \(/u,
);
assert.match(
  migration,
  /Owner-copy recipients and provider outcomes remain durable even when the creator has no email\./u,
);
assert.match(migration, /notify pgrst, 'reload schema';/u);
assert.match(migration, /^begin;/u);
assert.match(migration, /commit;\s*$/u);

assert.doesNotMatch(worker, /EXAM_ROOM_V1_PROFESSOR_CONTACT_REQUIRED/u);
assert.match(worker, /activationCommitted: true/u);
assert.match(worker, /keyIssuanceStatus: recoveryActions\.length > 0/u);
assert.match(worker, /status: escrowFailure \? 'deterministic_retry_available' : 'escrowed'/u);
assert.match(worker, /const primaryRecipients = recipient \? \[recipient\] : configuredOwnerRecipients;/u);
assert.match(worker, /professorRecipient: String\(activationResult\.professorEmail \|\| ''\).*\|\| null/u);

console.log('Examination Room nullable-creator and idempotent key-reliability migration contracts passed.');
