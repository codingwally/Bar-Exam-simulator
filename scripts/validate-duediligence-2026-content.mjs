import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
});

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

const [subjects, barEasy, doctrines, chairCases, anchorCases, deploymentGates, barForecast] =
  await Promise.all(Object.keys(files).map(load));

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
  },
  distributions: {
    barEasy: distribution(barEasy),
    doctrines: distribution(doctrines),
    chairCases: distribution(chairCases),
    anchorCases: distribution(anchorCases),
    barForecast: distribution(barForecast),
  },
  chairSourcesVerified: sourceResults.length,
  sourceResults,
}, null, 2));
