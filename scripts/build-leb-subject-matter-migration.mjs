import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(
  root,
  'content',
  'examinations',
  'leb-y1-y2-approved-subject-matter-20260730.json',
);
const outputPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260804_013_leb_subject_matter_approved_content.sql',
);

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const rows = Array.isArray(source.rows) ? source.rows : [];
const withheld = Array.isArray(source.withheld) ? source.withheld : [];

if (rows.length !== 11 || withheld.length !== 13) {
  throw new Error('Expected 11 approved rows and 13 explicitly withheld rows.');
}

const requiredSubjects = new Map([
  ['LEB-Y1T1-JD101-20260730-Q01', 'Philosophy of Law'],
  ['LEB-Y1T1-JD102-20260730-Q01', 'Statutory Construction'],
  ['LEB-Y1T1-JD201-20260730-Q01', 'Basic Legal and Judicial Ethics'],
  ['LEB-Y1T1-JD301-20260730-Q01', 'Constitutional Law I'],
  ['LEB-Y1T1-JD401-20260730-Q01', 'Criminal Law I'],
  ['LEB-Y1T1-JD601-20260730-Q04', 'Criminal Procedure'],
  ['LEB-Y1T2-JD103-20260730-Q01', 'Legal Research and Writing'],
  ['LEB-Y1T2-JD302-20260730-Q01', 'Constitutional Law II'],
  ['LEB-Y1T2-JD402-20260730-Q22', 'Criminal Law II'],
  ['LEB-Y1T2-JD502-20260730-Q01', 'Obligations and Contracts'],
  ['LEB-Y1T2-JD602-20260730-Q02', 'Civil Procedure I'],
  ['LEB-Y2T1-JD306-20260730-Q01', 'Public International Law'],
  ['LEB-Y2T1-JD501-20260730-Q01', 'Persons and Family Law'],
  ['LEB-Y2T1-JD603-20260730-Q01', 'Civil Procedure II'],
  ['LEB-Y2T1-JD701-20260730-Q01', 'Agency, Trust and Partnership Law'],
  ['LEB-Y2T1-JD702-20260730-Q01', 'Corporation and Basic Securities Law'],
  ['LEB-Y2T1-JD801-20260730-Q01', 'Labor Law and Social Legislation'],
  ['LEB-Y2T1-JD105-20260730-Q01', 'Clinical Legal Education'],
  ['LEB-Y2T2-JD303-20260730-Q01', 'Administrative Law and Law on Public Officers'],
  ['LEB-Y2T2-JD503-20260730-Q01', 'Property and Land Law'],
  ['LEB-Y2T2-JD504-20260730-Q01', 'Basic Succession Law'],
  ['LEB-Y2T2-JD604-20260730-Q01', 'Evidence'],
  ['LEB-Y2T2-JD703-20260730-Q01', 'Commercial Laws I'],
  ['LEB-Y2T2-JD901-20260730-Q01', 'Basic Taxation Law'],
]);

const all = [...rows, ...withheld];
const seen = new Set();
for (const row of all) {
  if (!requiredSubjects.has(row.questionId)) {
    throw new Error(`Unexpected Question ID: ${row.questionId}`);
  }
  if (requiredSubjects.get(row.questionId) !== row.subject) {
    throw new Error(`Subject mismatch for ${row.questionId}`);
  }
  if (seen.has(row.questionId)) throw new Error(`Duplicate Question ID: ${row.questionId}`);
  seen.add(row.questionId);
}
if (seen.size !== requiredSubjects.size) throw new Error('The 24-ID mapping is incomplete.');

for (const row of rows) {
  if (row.editorialStatus !== 'Approved' || row.publicationReady !== 'Yes') {
    throw new Error(`Unapproved row entered the publishable set: ${row.questionId}`);
  }
  for (const key of ['questionId', 'subject', 'prompt', 'suggestedAnswer', 'legalBasis']) {
    if (!String(row[key] ?? '').trim()) throw new Error(`${row.questionId} is missing ${key}`);
  }
  for (const section of ['answer', 'legalBasis', 'application', 'conclusion']) {
    if (!String(row.alac?.[section] ?? '').trim()) {
      throw new Error(`${row.questionId} is missing ALAC ${section}`);
    }
  }
  if (!/^A\d+:U\d+$/.test(row.sheetRange) || row.sheetRange !== `A${row.sheetRow}:U${row.sheetRow}`) {
    throw new Error(`${row.questionId} has an invalid sheet range`);
  }
}

for (const row of withheld) {
  if (row.editorialStatus === 'Approved' && row.publicationReady === 'Yes') {
    throw new Error(`Publishable row was incorrectly withheld: ${row.questionId}`);
  }
}

const publishablePayload = rows.map((row) => ({
  questionId: row.questionId,
  subject: row.subject,
  topic: row.topic,
  barYear: row.barYear,
  questionNumber: row.questionNumber,
  prompt: row.prompt,
  suggestedAnswer: row.suggestedAnswer,
  legalBasis: row.legalBasis,
  doctrine: row.doctrine,
  jurisprudence: row.jurisprudence,
  citation: row.citation,
  sourceUrlText: row.sourceUrlText,
  sourceUrls: row.sourceUrls,
  difficulty: row.difficulty,
  editorialStatus: row.editorialStatus,
  version: row.version,
  lastUpdated: row.lastUpdated,
  publicationReady: row.publicationReady,
  sheetRow: row.sheetRow,
  sheetRange: row.sheetRange,
  yearLevel: row.yearLevel,
  term: row.term,
  courseCode: row.courseCode,
  alac: row.alac,
}));

const payloadJson = JSON.stringify(publishablePayload, null, 2);
if (payloadJson.includes('$leb$')) throw new Error('Unsafe SQL dollar-quote delimiter in source data.');

const sourceDigest = createHash('sha256')
  .update(JSON.stringify({ rows, withheld }))
  .digest('hex');

const sql = `-- Due Diligence: editorially approved LEB Year I Subject Matter practice content.
-- Generated from the live "LEB Y1-Y2 Exam Bank" A:U rows on 2026-07-30.
-- Source digest: ${sourceDigest}
-- Exactly 11 rows are publishable. Thirteen Year II rows remain intentionally
-- withheld because the authoritative Sheet marks them For Review / No.

begin;

alter table public.examination_definitions
  drop constraint if exists examination_definitions_assessment_kind_check;
alter table public.examination_definitions
  add constraint examination_definitions_assessment_kind_check check (
    assessment_kind in ('midterm', 'final', 'quiz', 'curated', 'uploaded', 'system_test')
  );

alter table public.examination_definitions
  drop constraint if exists examination_definitions_track_kind_check;
alter table public.examination_definitions
  add constraint examination_definitions_track_kind_check check (
    (track = 'per_subject' and assessment_kind in ('midterm', 'final', 'quiz', 'system_test'))
    or (track = 'bar_feels' and assessment_kind in ('curated', 'uploaded', 'system_test'))
  );

do $migration$
declare
  v_actor uuid;
  v_row jsonb;
  v_question_id uuid;
  v_exam_id uuid;
  v_exam_public_id uuid;
  v_version_id uuid;
  v_uuid_hash text;
  v_question_hash text;
  v_version_hash text;
  v_existing_hash text;
  v_existing_question_count integer;
  v_rows jsonb := $leb$
${payloadJson}
$leb$::jsonb;
begin
  select ur.user_id
  into v_actor
  from public.user_roles ur
  join auth.users au on au.id = ur.user_id
  where ur.role in ('super_admin', 'founder_admin')
  order by case ur.role when 'super_admin' then 0 else 1 end, ur.user_id
  limit 1;

  if v_actor is null then
    raise exception 'LEB_CONTENT_ADMIN_REQUIRED';
  end if;

  if jsonb_array_length(v_rows) <> 11 then
    raise exception 'LEB_CONTENT_APPROVED_COUNT_MISMATCH';
  end if;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    if v_row->>'editorialStatus' <> 'Approved'
       or v_row->>'publicationReady' <> 'Yes'
       or nullif(btrim(v_row->>'prompt'), '') is null
       or nullif(btrim(v_row->>'suggestedAnswer'), '') is null
       or nullif(btrim(v_row->>'legalBasis'), '') is null
       or nullif(btrim(v_row#>>'{alac,answer}'), '') is null
       or nullif(btrim(v_row#>>'{alac,legalBasis}'), '') is null
       or nullif(btrim(v_row#>>'{alac,application}'), '') is null
       or nullif(btrim(v_row#>>'{alac,conclusion}'), '') is null
    then
      raise exception 'LEB_CONTENT_VALIDATION_FAILED: %', v_row->>'questionId';
    end if;

    -- Preserve deterministic identifiers while setting RFC 4122 version 5 and
    -- variant bits so every ID passes the Worker UUID boundary validator.
    v_uuid_hash := md5('leb-question:' || (v_row->>'questionId'));
    v_question_id := (
      substr(v_uuid_hash, 1, 12) || '5' || substr(v_uuid_hash, 14, 3)
      || '8' || substr(v_uuid_hash, 18)
    )::uuid;
    v_uuid_hash := md5('leb-exam:' || (v_row->>'questionId'));
    v_exam_id := (
      substr(v_uuid_hash, 1, 12) || '5' || substr(v_uuid_hash, 14, 3)
      || '8' || substr(v_uuid_hash, 18)
    )::uuid;
    v_uuid_hash := md5('leb-exam-public:' || (v_row->>'questionId'));
    v_exam_public_id := (
      substr(v_uuid_hash, 1, 12) || '5' || substr(v_uuid_hash, 14, 3)
      || '8' || substr(v_uuid_hash, 18)
    )::uuid;
    v_uuid_hash := md5('leb-version:' || (v_row->>'questionId') || ':1');
    v_version_id := (
      substr(v_uuid_hash, 1, 12) || '5' || substr(v_uuid_hash, 14, 3)
      || '8' || substr(v_uuid_hash, 18)
    )::uuid;
    v_question_hash := encode(extensions.digest(
      concat_ws(E'\\n',
        v_row->>'questionId',
        v_row->>'subject',
        v_row->>'prompt',
        v_row->>'suggestedAnswer',
        v_row->>'legalBasis',
        coalesce(v_row->>'doctrine', ''),
        coalesce(v_row->>'jurisprudence', ''),
        coalesce(v_row->>'citation', ''),
        coalesce(v_row->>'sourceUrlText', '')
      ),
      'sha256'
    ), 'hex');
    v_version_hash := encode(extensions.digest(
      v_question_hash || ':' || v_version_id::text,
      'sha256'
    ), 'hex');

    select q.content_hash into v_existing_hash
    from public.examination_questions q
    where q.id = v_question_id;
    if v_existing_hash is not null and v_existing_hash <> v_question_hash then
      raise exception 'LEB_CONTENT_IMMUTABLE_CONFLICT: %', v_row->>'questionId';
    end if;

    insert into public.examination_questions (
      id, source_key, source_type, owner_user_id, subject, topic, bar_year,
      question_number, difficulty, prompt_text, model_answer, legal_basis,
      doctrine, application_text, conclusion_text, jurisprudence, citation,
      governing_provision, source_urls, source_metadata, review_status,
      publication_ready, content_hash, source_updated_at, approved_at,
      approved_by
    )
    values (
      v_question_id,
      v_row->>'questionId',
      'google_sheet',
      null,
      v_row->>'subject',
      nullif(v_row->>'topic', ''),
      nullif(v_row->>'barYear', '')::integer,
      nullif(v_row->>'questionNumber', ''),
      nullif(v_row->>'difficulty', ''),
      v_row->>'prompt',
      v_row->>'suggestedAnswer',
      v_row->>'legalBasis',
      nullif(v_row->>'doctrine', ''),
      v_row#>>'{alac,application}',
      v_row#>>'{alac,conclusion}',
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'case', nullif(v_row->>'jurisprudence', ''),
        'citation', nullif(v_row->>'citation', '')
      ))),
      nullif(v_row->>'citation', ''),
      v_row->>'legalBasis',
      coalesce(v_row->'sourceUrls', '[]'::jsonb),
      jsonb_build_object(
        'spreadsheetId', '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A',
        'sheetName', 'LEB Y1-Y2 Exam Bank',
        'sheetRow', (v_row->>'sheetRow')::integer,
        'sheetRange', v_row->>'sheetRange',
        'yearLevel', (v_row->>'yearLevel')::integer,
        'term', (v_row->>'term')::integer,
        'courseCode', v_row->>'courseCode',
        'sourceVersion', v_row->>'version',
        'lastUpdated', v_row->>'lastUpdated',
        'sourceUrlText', v_row->>'sourceUrlText'
      ),
      'approved',
      true,
      v_question_hash,
      (v_row->>'lastUpdated')::date::timestamptz,
      now(),
      v_actor
    )
    on conflict (id) do nothing;

    insert into public.examination_definitions (
      id, public_id, track, assessment_kind, title, subject, year_level,
      semester, owner_user_id, test_only, status, active_version_id,
      created_by
    )
    values (
      v_exam_id,
      v_exam_public_id,
      'per_subject',
      'quiz',
      (v_row->>'subject') || ' — Subject Matter Practice',
      v_row->>'subject',
      (v_row->>'yearLevel')::smallint,
      (v_row->>'term')::smallint,
      null,
      false,
      'published',
      null,
      v_actor
    )
    on conflict (id) do update
    set title = excluded.title,
        subject = excluded.subject,
        year_level = excluded.year_level,
        semester = excluded.semester,
        status = 'published',
        updated_at = now();

    select ev.snapshot_hash, ev.question_count
    into v_existing_hash, v_existing_question_count
    from public.examination_versions ev
    where ev.id = v_version_id;
    if v_existing_hash is not null
       and (
         v_existing_hash <> v_version_hash
         or v_existing_question_count <> 1
       )
    then
      raise exception 'LEB_VERSION_IMMUTABLE_CONFLICT: %', v_row->>'questionId';
    end if;

    insert into public.examination_versions (
      id, exam_id, version_number, label, duration_seconds,
      default_timer_mode, allowed_timer_modes, grading_route,
      answer_release_rule, release_at, instructions, syllabus,
      question_count, status, snapshot_hash, created_by, published_at
    )
    values (
      v_version_id,
      v_exam_id,
      1,
      '2026-07-30 approved one-question practice',
      420,
      'strict',
      '["strict","selfPaced","none"]'::jsonb,
      'ai',
      'after_ai',
      null,
      'Answer the single essay using A.L.A.C.: Answer, Legal Basis, Application, and Conclusion. The suggested answer remains sealed until the authorized post-submission review stage.',
      jsonb_build_array(v_row->>'topic'),
      1,
      'draft',
      v_version_hash,
      v_actor,
      null
    )
    on conflict (id) do nothing;

    if not exists (
      select 1
      from public.examination_version_questions
      where version_id = v_version_id and question_id = v_question_id
    ) then
      insert into public.examination_version_questions (
        version_id, question_id, ordinal, prompt_snapshot,
        model_answer_snapshot, legal_basis_snapshot, application_snapshot,
        conclusion_snapshot, jurisprudence_snapshot, citation_snapshot,
        governing_provision_snapshot, source_urls_snapshot, snapshot_hash
      )
      values (
        v_version_id,
        v_question_id,
        1,
        v_row->>'prompt',
        v_row->>'suggestedAnswer',
        v_row->>'legalBasis',
        v_row#>>'{alac,application}',
        v_row#>>'{alac,conclusion}',
        jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'case', nullif(v_row->>'jurisprudence', ''),
          'citation', nullif(v_row->>'citation', '')
        ))),
        nullif(v_row->>'citation', ''),
        v_row->>'legalBasis',
        coalesce(v_row->'sourceUrls', '[]'::jsonb),
        v_question_hash
      );
    end if;

    update public.examination_versions
    set status = 'published',
        published_at = coalesce(published_at, now())
    where id = v_version_id and status = 'draft';

    update public.examination_definitions
    set active_version_id = v_version_id,
        status = 'published',
        updated_at = now()
    where id = v_exam_id;
  end loop;

  if (
    select count(*)
    from public.examination_questions
    where source_type = 'google_sheet'
      and source_key in (select value->>'questionId' from jsonb_array_elements(v_rows))
      and review_status = 'approved'
      and publication_ready
  ) <> 11 then
    raise exception 'LEB_CONTENT_FINAL_COUNT_MISMATCH';
  end if;
end;
$migration$;

commit;
`;

await writeFile(outputPath, sql, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)} from 11 approved rows.`);
