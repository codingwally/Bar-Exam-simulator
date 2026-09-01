import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { projectBarForecastToQuestionBank } from './project-bar-forecast-to-question-bank.mjs';

const CONTENT_ROOT = new URL('../content/duediligence-2026/', import.meta.url);
const SOURCE_STATUS = 'AI_PREPARED_BETA';
const DEFAULT_SOURCE_VERSION = '2026.1';

const files = Object.freeze({
  subjects: 'subjects.json',
  barEasy: 'bar-easy.json',
  doctrines: 'doctrines.json',
  chairCases: 'chairs-cases.json',
  anchorCases: 'anchor-cases.json',
  deploymentGates: 'deployment-gates.json',
  barForecast: 'bar-forecast.json',
  syllabusUnits: 'syllabus-units.json',
});

const FORECAST_QUESTION_BANK_ID_PATTERN = /^FCT-2026-Q(?:00[1-9]|0[1-9]\d|1[01]\d|120)$/u;
const QUESTION_BANK_URL = new URL('../content/question-bank/website-upload.json', import.meta.url);
const METHODOLOGY_URL = new URL('../content/duediligence-2026/bar-forecast-methodology.json', import.meta.url);
const FORECAST_URL = new URL('../content/duediligence-2026/bar-forecast.json', import.meta.url);

async function load(name) {
  const value = JSON.parse(await readFile(new URL(files[name], CONTENT_ROOT), 'utf8'));
  assert.equal(value.count, value.rows.length, `${name}: declared count must match row count`);
  return value.rows;
}

function requireFields(label, rows, fields) {
  for (const [index, row] of rows.entries()) {
    for (const field of fields) {
      assert.ok(String(row[field] ?? '').trim(), `${label} row ${index + 2}: ${field} is required`);
    }
  }
}

function assertUnique(label, rows, field = 'id') {
  const values = rows.map((row) => String(row[field] ?? '').trim());
  assert.equal(new Set(values).size, rows.length, `${label}: duplicate ${field}`);
}

function assertBeta(label, rows, version = DEFAULT_SOURCE_VERSION) {
  assert.ok(rows.every((row) => row.status === SOURCE_STATUS), `${label}: invalid beta status`);
  assert.ok(rows.every((row) => row.version === version), `${label}: invalid version`);
}

function assertHttps(label, rows, field) {
  for (const row of rows) {
    const url = new URL(row[field]);
    assert.equal(url.protocol, 'https:', `${label} ${row.id}: ${field} must use HTTPS`);
    assert.equal(Boolean(url.username || url.password), false, `${label} ${row.id}: credentialed URL`);
  }
}

function distribution(rows, field = 'subject') {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const key = row[field];
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function assertDistribution(label, rows, expected) {
  assert.deepEqual(distribution(rows), Object.fromEntries(
    Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)),
  ), `${label}: unexpected subject distribution`);
}

function sourceHeadingMatches(row, html) {
  const normalized = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&amp;|&#38;/gi, ' ')
    .replace(/\s+/g, ' ');
  const docketNumbers = String(row.gr_number).match(/\d{2,6}/g) || [];
  const iso = String(row.decision_date).split('-');
  const date = new Date(`${row.decision_date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
  const unpadded = date.replace(/ 0(\d),/, ' $1,');
  const titleToken = String(row.case_title || row.short_title)
    .split(/\s+v\.?\s+/i)[0]
    .split(',')[0]
    .replace(/[^A-Za-z]/g, '');
  return {
    docket: docketNumbers.length > 0 && docketNumbers.every((number) => normalized.includes(number)),
    date: normalized.includes(date) || normalized.includes(unpadded)
      || normalized.includes(`${iso[1]}/${iso[2]}/${iso[0]}`),
    division: new RegExp(row.court_division.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(normalized),
    authorship: /GAERLAN\s*,\s*J\s*\.:/i.test(normalized),
    title: normalized.replace(/[^A-Za-z]/g, '').toLowerCase().includes(titleToken.toLowerCase()),
  };
}

async function verifyChairSources(rows) {
  const results = [];
  for (const row of rows) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(row.primary_source_url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'DueDiligence-Content-Validator/2026.1' },
      });
      assert.equal(response.ok, true, `${row.id}: source returned ${response.status}`);
      const checks = sourceHeadingMatches(row, await response.text());
      assert.ok(Object.values(checks).every(Boolean), `${row.id}: source heading mismatch ${JSON.stringify(checks)}`);
      results.push({ id: row.id, url: row.primary_source_url, ...checks, ok: true });
    } finally {
      clearTimeout(timeout);
    }
  }
  return results;
}

const [subjects, barEasy, doctrines, chairCases, anchorCases, deploymentGates, barForecast, syllabusUnits] =
  await Promise.all(Object.keys(files).map(load));
const [barForecastDocument, questionBankDocument, methodology] = await Promise.all([
  readFile(FORECAST_URL, 'utf8').then(JSON.parse),
  readFile(QUESTION_BANK_URL, 'utf8').then(JSON.parse),
  readFile(METHODOLOGY_URL, 'utf8').then(JSON.parse),
]);

assert.equal(subjects.length, 6);
assert.equal(subjects.reduce((sum, row) => sum + Number(row.weight_percent), 0), 100);
assert.equal(subjects.reduce((sum, row) => sum + Number(row.doctrine_target), 0), 100);
assert.equal(subjects.reduce((sum, row) => sum + Number(row.anchor_case_target), 0), 60);

assert.equal(barEasy.length, 50);
assertUnique('Bar Easy', barEasy);
assertBeta('Bar Easy', barEasy);
requireFields('Bar Easy', barEasy, [
  'id', 'subject', 'syllabus_topic', 'prompt', 'suggested_answer', 'explanation',
  'required_concepts', 'accepted_paraphrases', 'modification_triggers', 'denial_triggers',
  'source_title', 'source_citation', 'source_url', 'status', 'version',
]);
assertHttps('Bar Easy', barEasy, 'source_url');
assertDistribution('Bar Easy', barEasy, {
  'Political and Public International Law': 8,
  'Commercial and Taxation Laws': 8,
  'Civil Law and Land Titles and Deeds': 8,
  'Labor Law and Social Legislation': 8,
  'Criminal Law': 8,
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises': 8,
  'General Philippine Legal System': 2,
});

assert.equal(doctrines.length, 100);
assertUnique('Doctrines', doctrines);
assertBeta('Doctrines', doctrines);
requireFields('Doctrines', doctrines, [
  'id', 'subject', 'syllabus_topic', 'doctrine_title', 'canonical_meaning',
  'plain_language_meaning', 'required_concepts', 'accepted_paraphrases',
  'material_contradictions', 'exceptions_or_limits', 'primary_authority',
  'citation', 'source_url', 'status', 'version',
]);
assertHttps('Doctrines', doctrines, 'source_url');
assertDistribution('Doctrines', doctrines, {
  'Political and Public International Law': 15,
  'Commercial and Taxation Laws': 20,
  'Civil Law and Land Titles and Deeds': 20,
  'Labor Law and Social Legislation': 10,
  'Criminal Law': 10,
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises': 25,
});

assert.equal(chairCases.length, 30);
assertUnique("Chair's Cases", chairCases);
assertBeta("Chair's Cases", chairCases);
requireFields("Chair's Cases", chairCases, [
  'id', 'collection', 'bar_year', 'chair', 'subject', 'syllabus_topic',
  'relevance_rank', 'case_title', 'short_title', 'gr_number', 'decision_date',
  'ponente', 'court_division', 'authorship_evidence', 'facts_digest', 'issue',
  'ruling', 'controlling_doctrine', 'disposition', 'why_bar_relevant',
  'primary_source_url', 'source_checked_on', 'status', 'version',
]);
assertHttps("Chair's Cases", chairCases, 'primary_source_url');
assert.ok(chairCases.every((row) => row.collection === 'GAERLAN_CHAIR_CASES_2026'));
assert.ok(chairCases.every((row) => row.ponente === 'Justice Samuel H. Gaerlan'));
assert.ok(chairCases.every((row) => /GAERLAN\s*,\s*J\./i.test(row.authorship_evidence)));
assertDistribution("Chair's Cases", chairCases, {
  'Political and Public International Law': 5,
  'Commercial and Taxation Laws': 5,
  'Civil Law and Land Titles and Deeds': 5,
  'Labor Law and Social Legislation': 5,
  'Criminal Law': 4,
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises': 6,
});

assert.equal(anchorCases.length, 60);
assertUnique('Anchor Case Digests', anchorCases);
assertBeta('Anchor Case Digests', anchorCases);
requireFields('Anchor Case Digests', anchorCases, [
  'id', 'collection', 'subject', 'syllabus_topic', 'rank_within_subject',
  'case_title', 'short_title', 'gr_number', 'decision_date', 'ponente',
  'court_division', 'facts_digest', 'issue', 'ruling', 'controlling_doctrine',
  'disposition', 'why_bar_relevant', 'how_to_use_in_alac', 'primary_source_url',
  'source_checked_on', 'status', 'version',
]);
assertHttps('Anchor Case Digests', anchorCases, 'primary_source_url');
assertDistribution('Anchor Case Digests', anchorCases, {
  'Political and Public International Law': 10,
  'Commercial and Taxation Laws': 10,
  'Civil Law and Land Titles and Deeds': 10,
  'Labor Law and Social Legislation': 10,
  'Criminal Law': 10,
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises': 10,
});

assert.equal(barForecast.length, 120);
assertUnique('2026 Bar Forecast', barForecast);
assertBeta('2026 Bar Forecast', barForecast, '2026.3');
requireFields('2026 Bar Forecast', barForecast, [
  'id', 'subject', 'syllabus_topic', 'title', 'prompt', 'suggested_answer',
  'legal_basis', 'controlling_doctrine', 'jurisprudence', 'citation',
  'primary_source_url', 'prediction_rationale', 'editorial_ref',
  'editorial_standard', 'status', 'version', 'publication_readiness',
  'syllabus_unit_id', 'syllabus_path', 'controlling_doctrine_id',
  'doctrine_key', 'authority_key', 'question_bank_id', 'question_bank_subject',
  'legal_basis_source_url', 'prediction_model_version', 'examinable_cutoff',
  'authority_date', 'cutoff_result', 'legal_review_status',
  'prediction_score_unrounded',
]);
assertHttps('2026 Bar Forecast', barForecast, 'primary_source_url');
assertDistribution('2026 Bar Forecast', barForecast, {
  'Political and Public International Law': 20,
  'Commercial and Taxation Laws': 20,
  'Civil Law and Land Titles and Deeds': 20,
  'Labor Law and Social Legislation': 20,
  'Criminal Law': 20,
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises': 20,
});

for (const row of barForecast) {
  assert.match(row.prompt.trim(), /\?$/, `${row.id}: Forecast prompt must end in a question mark`);
  assert.match(
    row.prompt.trim(),
    /\b(?:May|Is|Are|Was|Were|Can|Could|Should|Would|Did|Does|Do|Must|Will|Has|Have)\b[^?]*\?$/i,
    `${row.id}: Forecast prompt must be answerable by yes or no`,
  );
  assert.match(row.suggested_answer, /^Answer:\s+(?:Yes|No)\./, `${row.id}: answer must begin Yes or No`);
  assert.equal((row.suggested_answer.match(/\n\nLegal Basis:/g) || []).length, 1,
    `${row.id}: answer must contain one Legal Basis section`);
  assert.equal((row.suggested_answer.match(/\n\nApplication:/g) || []).length, 1,
    `${row.id}: answer must contain one Application section`);
  assert.equal((row.suggested_answer.match(/\n\nConclusion:/g) || []).length, 1,
    `${row.id}: answer must contain one Conclusion section`);
  assert.match(
    row.suggested_answer,
    /\n\nConclusion:\s+(?:Thus|Hence|Wherefore),\s+\S/i,
    `${row.id}: conclusion must begin with Thus, Hence, or Wherefore and give a reason`,
  );
  assert.equal(row.publication_readiness, 'HUMAN_LEGAL_REVIEW_REQUIRED');
  assert.equal(row.editorial_standard,
    '2025_BAR_ONE_QUESTION_ONE_DOCTRINE_ALAC_YES_NO_REASONED_CONCLUSION');
  assert.ok(Array.isArray(row.source_links) && row.source_links.length >= 1,
    `${row.id}: at least one source link is required`);
}

assert.equal(syllabusUnits.length, 54);
assertUnique('2026 syllabus units', syllabusUnits);
requireFields('2026 syllabus units', syllabusUnits, [
  'id', 'subject', 'roman', 'heading', 'target_questions',
  'leb_prior_weight', 'syllabus_centrality', 'question_bank_subject',
]);
const unitById = new Map(syllabusUnits.map((unit) => [unit.id, unit]));
for (const unit of syllabusUnits) {
  assert.ok(Array.isArray(unit.leb_course_basis) && unit.leb_course_basis.length >= 1,
    `${unit.id}: an official LEB course basis is required`);
  const mappedUnits = unit.leb_course_basis.reduce((sum, entry) => {
    assert.ok(String(entry.course || '').trim(), `${unit.id}: LEB course name is required`);
    assert.ok(Number(entry.units) > 0, `${unit.id}: LEB course units must be positive`);
    return sum + Number(entry.units);
  }, 0);
  assert.equal(Number(unit.leb_prior_weight), mappedUnits,
    `${unit.id}: LEB prior must equal independently mapped published course units`);
  assert.equal(Number(unit.syllabus_centrality), 1,
    `${unit.id}: official top-level headings must receive equal syllabus eligibility`);
}

const forecastUnitCounts = distribution(barForecast, 'syllabus_unit_id');
for (const subject of Object.keys(distribution(barForecast))) {
  const subjectUnits = syllabusUnits.filter((unit) => unit.subject === subject);
  assert.equal(subjectUnits.reduce((sum, unit) => sum + Number(unit.target_questions), 0), 20,
    `${subject}: syllabus-unit targets must total 20`);
}
for (const unit of syllabusUnits) {
  assert.equal(forecastUnitCounts[unit.id] || 0, Number(unit.target_questions),
    `${unit.id}: Forecast must match its exact allocation target`);
}

const weightedMaximums = Object.freeze({
  historical_frequency: 35,
  leb_curriculum_prior: 25,
  official_syllabus_centrality: 20,
  cutoff_compliant_jurisprudence: 10,
  contemporary_or_technology_relevance: 5,
  attributable_educator_signal: 5,
});
assert.equal(methodology.weights.reduce((sum, entry) => sum + Number(entry.weight_percent), 0), 100,
  'Forecast methodology weights must total 100');
assert.equal(methodology.mode, 'STANDARD_ACCURACY_FIRST');
assert.equal(methodology.examinable_cutoff, '2025-06-30');
assert.equal(
  methodology.corpus_snapshot.external_official_questionnaire_checks[0].direct_election_law_question_count,
  1,
  '2025 official Political questionnaire concentration check must remain one direct Election Law question',
);

for (const subject of Object.keys(distribution(barForecast))) {
  const rows = barForecast.filter((row) => row.subject === subject);
  assertUnique(`${subject} Forecast doctrines`, rows, 'doctrine_key');
  assertUnique(`${subject} Forecast primary authorities`, rows, 'authority_key');
}

for (const row of barForecast) {
  assert.ok(unitById.has(row.syllabus_unit_id), `${row.id}: unknown syllabus unit`);
  assert.match(row.question_bank_id, FORECAST_QUESTION_BANK_ID_PATTERN,
    `${row.id}: invalid Forecast question-bank ID`);
  assert.equal(row.examinable_cutoff, '2025-06-30');
  assert.ok(row.authority_date <= row.examinable_cutoff,
    `${row.id}: controlling authority exceeds the examinability cutoff`);
  assert.equal(row.cutoff_result, 'PASS_ON_OR_BEFORE_2025-06-30');
  assert.equal(row.legal_review_status, 'HUMAN_LEGAL_REVIEW_REQUIRED');
  assert.ok(Array.isArray(row.leb_course_basis) && row.leb_course_basis.length >= 1,
    `${row.id}: LEB course basis is required`);
  assert.ok(Array.isArray(row.concept_ids) && row.concept_ids.length >= 2,
    `${row.id}: syllabus and canonical concept identifiers are required`);
  assert.ok(Array.isArray(row.case_ids), `${row.id}: case_ids must be an array`);
  assert.ok(Array.isArray(row.historical_question_ids),
    `${row.id}: historical_question_ids must be an array even when no match exists`);
  assert.ok(row.historical_subject_year_denominators
    && typeof row.historical_subject_year_denominators === 'object',
  `${row.id}: historical subject-year denominators are required`);
  assert.ok(row.historical_yearly_shares && typeof row.historical_yearly_shares === 'object',
    `${row.id}: historical yearly shares are required`);
  assert.ok(Array.isArray(row.official_source_urls) && row.official_source_urls.length >= 2,
    `${row.id}: official source URLs are required`);
  const officialHosts = new Set([
    'elibrary.judiciary.gov.ph',
    'sc.judiciary.gov.ph',
    'www.un.org',
    'un.org',
    'bir-cdn.bir.gov.ph',
    'bir.gov.ph',
    'www.bir.gov.ph',
  ]);
  for (const sourceUrl of row.official_source_urls) {
    const source = new URL(sourceUrl);
    assert.equal(source.protocol, 'https:', `${row.id}: official source must use HTTPS`);
    assert.ok(officialHosts.has(source.hostname),
      `${row.id}: official_source_urls contains a non-official host ${source.hostname}`);
  }
  for (const sourceUrl of row.source_links || []) {
    const source = new URL(sourceUrl);
    assert.ok(![
      'scribd.com', 'www.scribd.com', 'studocu.com', 'www.studocu.com',
      'facebook.com', 'www.facebook.com', 'youtube.com', 'www.youtube.com', 'youtu.be',
    ].includes(source.hostname), `${row.id}: displayed source_links contains a user-upload or social host`);
  }
  if (row.chair_authorship_evidence) {
    assert.ok(row.chair_case_id,
      `${row.id}: chair authorship evidence cannot exist without a verified chair_case_id`);
  }
  const legalSource = new URL(row.legal_basis_source_url);
  assert.equal(legalSource.protocol, 'https:', `${row.id}: legal basis source must use HTTPS`);
  assert.ok(
    legalSource.hostname === 'elibrary.judiciary.gov.ph'
      || (
        ['un.org', 'www.un.org'].includes(legalSource.hostname)
        && legalSource.pathname === '/depts/los/convention_agreements/texts/unclos/part12.htm'
      ),
    `${row.id}: legal basis source must be an approved official authority`,
  );
  let scoreSum = 0;
  for (const [component, maximum] of Object.entries(weightedMaximums)) {
    const raw = Number(row.component_raw_scores?.[component]);
    const weighted = Number(row.component_weighted_scores?.[component]);
    assert.ok(Number.isFinite(raw) && raw >= 0 && raw <= 1,
      `${row.id}: ${component} raw score must be between 0 and 1`);
    assert.ok(Number.isFinite(weighted) && weighted >= 0 && weighted <= maximum,
      `${row.id}: ${component} weighted score must be between 0 and ${maximum}`);
    assert.ok(Math.abs(weighted - (raw * maximum)) < 0.00001,
      `${row.id}: ${component} must not be rounded before the final score`);
    scoreSum += weighted;
  }
  assert.ok(Math.abs(row.prediction_score_unrounded - scoreSum) < 0.00001,
    `${row.id}: stored unrounded score must equal the component sum`);
  assert.equal(row.prediction_score, Number(scoreSum.toFixed(1)),
    `${row.id}: only the final prediction score may be rounded`);
  assert.equal(row.final_score, row.prediction_score, `${row.id}: final score drift`);
  if (/\bG\.R\.\s*(?:Nos?\.)?/iu.test(row.citation)) {
    assert.ok(row.component_raw_scores.cutoff_compliant_jurisprudence >= 0.5,
      `${row.id}: verified case authority must receive the methodology floor`);
  } else {
    assert.equal(row.component_raw_scores.cutoff_compliant_jurisprudence, 1,
      `${row.id}: verified statute, rule, or constitutional text must score 1`);
  }
}
assertUnique('2026 Forecast Q&A projection IDs', barForecast, 'question_bank_id');

const electionContextPattern = /\b(?:elections?|candidacy|suffrage|COMELEC|electoral tribunals?|election protests?|election offenses?|election remedies?)\b/iu;
const politicalElectionRows = barForecast.filter((row) => (
  row.subject === 'Political and Public International Law'
    && electionContextPattern.test([
      row.title,
      row.prompt,
      row.syllabus_topic,
      row.controlling_doctrine,
      row.jurisprudence,
    ].join(' '))
));
assert.equal(politicalElectionRows.length, 1,
  'Political Forecast must contain exactly one direct election-law context');
assert.equal(politicalElectionRows[0].syllabus_unit_id, 'POL-XII');

const projectedQuestionBank = projectBarForecastToQuestionBank(
  barForecastDocument,
  questionBankDocument,
);
assert.equal(questionBankDocument.records.length, 920,
  'Canonical local Q&A bank must contain 800 preserved plus 120 Forecast rows');
assert.deepEqual(projectedQuestionBank.records, questionBankDocument.records,
  'Canonical local Q&A bank must be the idempotent exact Forecast projection');

const sourceResults = process.argv.includes('--sources') ? await verifyChairSources(chairCases) : [];

console.log(JSON.stringify({
  ok: true,
  counts: {
    subjects: subjects.length,
    barEasy: barEasy.length,
    doctrines: doctrines.length,
    chairCases: chairCases.length,
    anchorCases: anchorCases.length,
    deploymentGates: deploymentGates.length,
    barForecast: barForecast.length,
    syllabusUnits: syllabusUnits.length,
    questionBank: questionBankDocument.records.length,
  },
  distributions: {
    barEasy: distribution(barEasy),
    doctrines: distribution(doctrines),
    chairCases: distribution(chairCases),
    anchorCases: distribution(anchorCases),
    barForecast: distribution(barForecast),
    barForecastUnits: forecastUnitCounts,
  },
  politicalElectionContextCount: politicalElectionRows.length,
  chairSourcesVerified: sourceResults.length,
  sourceResults,
}, null, 2));
