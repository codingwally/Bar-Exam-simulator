import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL(
  '../content/examinations/leb-y1-y2-approved-system-test.json',
  import.meta.url,
);
const outputUrl = new URL(
  '../supabase/migrations/20260729120726_approved_examination_test_bank.sql',
  import.meta.url,
);

function sql(value) {
  if (value == null) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonSql(value) {
  return `${sql(JSON.stringify(value))}::jsonb`;
}

function extractSection(answer, label, nextLabel) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = nextLabel
    ? `(?=\\n\\s*${nextLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:)`
    : '$';
  const match = String(answer || '').match(
    new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*([\\s\\S]*?)${next}`, 'i'),
  );
  return match?.[1]?.trim() || null;
}

function sourceObjects(value) {
  return String(value || '')
    .split(/\s+\|\s+/)
    .map((entry) => {
      const match = entry.match(/^(.*?):\s*(https:\/\/\S+)$/);
      return match
        ? { title: match[1].trim(), url: match[2].trim(), type: 'stored' }
        : null;
    })
    .filter(Boolean);
}

const source = JSON.parse(await readFile(sourceUrl, 'utf8'));
if (!Array.isArray(source.rows) || source.rows.length !== 20) {
  throw new Error('Expected exactly 20 approved source rows.');
}

const tuples = source.rows.map((row) => {
  if (row.editorialStatus !== 'Approved' || row.publicationReady !== 'Yes') {
    throw new Error(`Question ${row.questionId} is not approved for publication.`);
  }
  const raw = Object.values(row).join('\u001f');
  const hash = createHash('sha256').update(raw).digest('hex');
  const application = extractSection(row.suggestedAnswer, 'Application', 'Conclusion');
  const conclusion = extractSection(row.suggestedAnswer, 'Conclusion');
  const sourceMetadata = {
    editorialStatus: row.editorialStatus,
    publicationReady: row.publicationReady,
    version: row.version,
    author: row.author,
    lastUpdated: row.lastUpdated,
    notes: row.notes,
    reservedT: row.reservedT,
    reservedU: row.reservedU,
  };
  return `  (
    ${sql(row.questionId)}, 'google_sheet', null, ${sql(row.subject)},
    ${sql(row.topic)}, ${sql(row.barYear)}::integer, ${sql(row.questionNumber)},
    ${sql(row.difficulty)}, ${sql(row.prompt)}, ${sql(row.suggestedAnswer)},
    ${sql(row.legalBasis)}, ${sql(row.doctrine)}, ${sql(application)}, ${sql(conclusion)},
    ${jsonSql([row.jurisprudence])}, ${sql(row.citation)},
    ${sql(row.legalBasis)}, ${jsonSql(sourceObjects(row.sourceUrls))}, ${jsonSql(sourceMetadata)},
    'approved', true, ${sql(hash)},
    ${sql(`${row.lastUpdated}T00:00:00Z`)}::timestamptz,
    ${sql(`${row.lastUpdated}T00:00:00Z`)}::timestamptz
  )`;
});

const output = `-- Generated only from Google Sheet rows independently verified as Approved/Yes.
-- Source: ${source.source.spreadsheetId} / ${source.source.sheetName}
-- Ranges: ${source.source.sourceRanges.join(', ')}
-- This seed does not create a complete 20-question Midterm or Final.

begin;

insert into public.examination_questions (
  source_key, source_type, owner_user_id, subject, topic, bar_year,
  question_number, difficulty, prompt_text, model_answer, legal_basis,
  doctrine, application_text, conclusion_text,
  jurisprudence, citation, governing_provision, source_urls, source_metadata,
  review_status, publication_ready, content_hash, source_updated_at, approved_at
)
values
${tuples.join(',\n')}
on conflict on constraint examination_questions_source_scope_unique
do update set
  subject = excluded.subject,
  topic = excluded.topic,
  bar_year = excluded.bar_year,
  question_number = excluded.question_number,
  difficulty = excluded.difficulty,
  prompt_text = excluded.prompt_text,
  model_answer = excluded.model_answer,
  legal_basis = excluded.legal_basis,
  doctrine = excluded.doctrine,
  application_text = excluded.application_text,
  conclusion_text = excluded.conclusion_text,
  jurisprudence = excluded.jurisprudence,
  citation = excluded.citation,
  governing_provision = excluded.governing_provision,
  source_urls = excluded.source_urls,
  source_metadata = excluded.source_metadata,
  review_status = excluded.review_status,
  publication_ready = excluded.publication_ready,
  content_hash = excluded.content_hash,
  source_updated_at = excluded.source_updated_at,
  approved_at = excluded.approved_at,
  updated_at = now()
where public.examination_questions.content_hash is distinct from excluded.content_hash
  or public.examination_questions.bar_year is distinct from excluded.bar_year
  or public.examination_questions.question_number is distinct from excluded.question_number
  or public.examination_questions.difficulty is distinct from excluded.difficulty
  or public.examination_questions.doctrine is distinct from excluded.doctrine
  or public.examination_questions.source_metadata is distinct from excluded.source_metadata;

commit;
`;

await writeFile(outputUrl, output, 'utf8');
console.log(`Wrote ${fileURLToPath(outputUrl)} with ${source.rows.length} approved questions.`);
