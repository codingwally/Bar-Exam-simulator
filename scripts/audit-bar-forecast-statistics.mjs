import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const MANIFEST_URL = new URL('content/question-bank/verbatim-source-manifest.json', ROOT);
const BANK_URL = new URL('content/question-bank/website-upload.json', ROOT);
const UNITS_URL = new URL('content/duediligence-2026/syllabus-units.json', ROOT);
const FORECAST_URL = new URL('content/duediligence-2026/bar-forecast.json', ROOT);
const OUTPUT_URL = new URL('content/duediligence-2026/bar-forecast-statistical-audit.json', ROOT);
const DEFAULT_BASELINE_REF = 'b55bb0ad192c720b7020f0eea150a5d4b0e8c809';
const CLASSIFIER_VERSION = 'official-unit-lexical-v1';

const EXTRA_TERMS = {
  'POL-I': ['police power', 'eminent domain', 'state immunity', 'government instrumentality'],
  'POL-II': ['contiguous zone', 'exclusive economic zone', 'archipelago'],
  'POL-IV': ['legislative inquiry', 'congressional', 'appropriation rider', 'party list', 'legislative vacancy', 'special election'],
  'POL-V': ['presidential succession', 'emergency power', 'martial law', 'foreign affairs discretion'],
  'POL-VI': ['rule making power', 'judicial rule making', 'actual controversy'],
  'POL-VII': ['civil service', 'electoral tribunal', 'commission on elections', 'commission on audit'],
  'POL-VIII': ['academic freedom', 'freedom of assembly', 'non establishment', 'custodial investigation', 'double jeopardy', 'just compensation'],
  'POL-IX': ['public utility', 'land ownership', 'natural resource'],
  'POL-X': ['administrative rule making', 'condonation doctrine'],
  'POL-XI': ['public accountability', 'retirement benefit'],
  'POL-XIII': ['autonomous region', 'local ordinance', 'local taxation'],
  'POL-XIV': ['foreign state immunity', 'senate concurrence', 'law of the sea'],
  'COM-I': ['corporation by estoppel', 'corporate veil', 'derivative suit', 'pre emptive right', 'trust fund doctrine', 'stock dividend', 'board vacancy', 'stockholder meeting', 'foreign corporation', 'corporate land ownership', 'land ownership and capital'],
  'COM-II': ['double insurance', 'incontestability', 'premium'],
  'COM-III': ['contract of carriage', 'common carrier', 'ferry'],
  'COM-IV': ['deposit secrecy', 'foreign currency deposit', 'receivership', 'anti money laundering', 'splitting of deposits'],
  'COM-V': ['authorship', 'merger doctrine', 'useful article'],
  'COM-VI': ['electronic commerce', 'competition', 'dominant position', 'public services'],
  'COM-VIII': ['donor tax', 'estate tax', 'tax refund', 'gross estate', 'standard deduction', 'bureau of internal revenue'],
  'CIV-I': ['choice of law', 'foreign law'],
  'CIV-II': ['capacity to act', 'presumptive death'],
  'CIV-III': ['conjugal property', 'cohabitation', 'custody', 'void marriage', 'annulment', 'solemnize marriage'],
  'CIV-IV': ['illegitimate child', 'impugning legitimacy'],
  'CIV-V': ['acquisitive prescription', 'co owner', 'forest land', 'legal redemption', 'implied trust'],
  'CIV-VI': ['torrens', 'title and deeds', 'forged mortgage'],
  'CIV-VII': ['heir', 'testamentary', 'intestacy', 'holographic will'],
  'CIV-VIII': ['fortuitous event', 'relativity', 'penalty clause', 'interest rate'],
  'CIV-IX': ['sale', 'loan', 'commodatum', 'deposit', 'mortgage', 'donation', 'maceda law', 'right of first refusal'],
  'CIV-XI': ['employer liability'],
  'CIV-XII': ['temperate damages', 'funeral expenses'],
  'LAB-I': ['equal pay', 'discrimination', 'management policy'],
  'LAB-II': ['nonresident alien', 'nonresident aliens', 'alien employment permit', 'overseas worker', 'human trafficking'],
  'LAB-III': ['regular employee', 'probationary employment', 'employment status', 'contracting', 'independent contractor'],
  'LAB-IV': ['overtime', 'holiday pay', 'special nonworking day', 'facility', 'supplement', 'salary classification'],
  'LAB-V': ['bargaining unit', 'mass action', 'federation affiliation', 'collective bargaining agreement', 'no strike'],
  'LAB-VI': ['dismissal', 'misconduct', 'loss of trust', 'noncompetition', 'reduced workdays'],
  'LAB-VII': ['seafarer', 'sss coverage', 'medical examination', 'preexisting illness'],
  'LAB-VIII': ['jurisdiction', 'training bond', 'ofw claim', 'assumption of jurisdiction'],
  'CRIM-I': ['prospectivity', 'generality', 'territorial principle', 'constitutional limitation'],
  'CRIM-II': ['impossible crime', 'self defense', 'conspiracy', 'treachery', 'accident', 'reckless imprudence', 'praeter intentionem', 'indeterminate sentence', 'accessory', 'stages of commission', 'mitigating circumstance', 'aggravating circumstance'],
  'CRIM-III': ['murder', 'homicide', 'theft', 'robbery', 'treason', 'malversation', 'trafficking', 'graft', 'dangerous drugs', 'drug paraphernalia', 'child abuse', 'child cruelty', 'violence against women', 'voyeurism', 'unjust vexation', 'illegal gambling', 'sexual harassment', 'data privacy', 'personal information'],
  'REM-II': ['court authority', 'subject matter jurisdiction'],
  'REM-III': ['joinder', 'misjoinder', 'service', 'res judicata', 'unlawful detainer', 'fresh period', 'judgment on the pleadings', 'necessary party', 'non joinder', 'condition precedent'],
  'REM-IV': ['injunction', 'attachment'],
  'REM-V': ['rule 65', 'unlawful detainer', 'forcible entry'],
  'REM-VI': ['foreign divorce', 'estate proceeding'],
  'REM-VII': ['information', 'plea of guilty', 'warrant of arrest', 'criminal appeal', 'prejudicial question', 'cybercrime warrant', 'prosecution witness', 'conditional examination', 'deposition of prosecution witness'],
  'REM-VIII': ['child witness', 'out of court statement', 'corpus delicti', 'offer of compromise', 'cctv', 'text message', 'screenshot', 'duplicate document', 'photocopy'],
  'REM-IX': ['attorney client', 'lawyer', 'judge', 'judicial conduct', 'sub judice', 'mcle', 'ibp dues', 'disbarment', 'disciplinary proceeding', 'inhibition', 'attorney fees', 'withdrawal of counsel', 'legal advertising', 'judicial clemency'],
  'REM-X': ['draft pleading', 'affidavit', 'verification and certification', 'legal form'],
};

function parseArgs(argv) {
  const options = { baselineRef: DEFAULT_BASELINE_REF, output: fileURLToPath(OUTPUT_URL) };
  for (const arg of argv) {
    if (arg.startsWith('--baseline-ref=')) options.baselineRef = arg.slice('--baseline-ref='.length);
    else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function phraseMatch(text, term) {
  const haystack = ` ${normalize(text)} `;
  const needle = normalize(term);
  if (!needle) return false;
  if (haystack.includes(` ${needle} `)) return true;
  const tokens = needle.split(' ').filter((token) => token.length >= 3);
  return tokens.length > 1 && tokens.every((token) => haystack.includes(` ${token} `));
}

function candidateUnits(record, units) {
  return units.filter((unit) => unit.question_bank_subject === record.Subject);
}

function classificationFields(record) {
  return [
    ['topic', record.Topic || record.title || record.syllabus_unit || record.syllabus_topic, 8],
    ['title', record.title, 7],
    ['syllabus', [record.syllabus_topic, record.syllabus_leaf, record.syllabus_path].filter(Boolean).join(' '), 7],
    ['doctrine', record['Controlling Doctrine'] || record.controlling_doctrine, 5],
    ['legal_basis', record['Legal Basis / Provision'] || record.legal_basis, 3],
    ['prompt', record['Essay Question'] || record.prompt, 2],
    ['case', record['Jurisprudence / Case'] || record.jurisprudence, 1],
  ].filter(([, value]) => value);
}

function lexicalClassification(record, units) {
  const candidates = candidateUnits(record, units);
  if (!candidates.length) throw new Error(`No official unit candidate for source subject ${record.Subject}`);

  // These source disciplines each map to one top-level 2026 unit. This is a
  // taxonomy routing rule, not a keyword inference.
  if (record.Subject === 'Taxation Law') {
    return { unitId: 'COM-VIII', method: 'discipline-route', score: null, runnerUp: null, ambiguous: false, matchedTerms: ['Taxation Law discipline'] };
  }
  if (record.Subject === 'Legal and Judicial Ethics') {
    const practical = ['draft pleading', 'legal form', 'verification and certification', 'affidavit']
      .filter((term) => classificationFields(record).some(([, value]) => phraseMatch(value, term)));
    return {
      unitId: practical.length ? 'REM-X' : 'REM-IX',
      method: practical.length ? 'discipline-route-practical-exercise' : 'discipline-route-ethics',
      score: null,
      runnerUp: null,
      ambiguous: false,
      matchedTerms: practical.length ? practical : ['Legal and Judicial Ethics discipline'],
    };
  }

  const fields = classificationFields(record);
  const ranked = candidates.map((unit) => {
    const terms = [...new Set([unit.heading, ...unit.historical_terms, ...(EXTRA_TERMS[unit.id] || [])])];
    let score = 0;
    const matches = [];
    for (const term of terms) {
      const specificity = Math.min(2, Math.max(1, normalize(term).split(' ').length / 2));
      for (const [field, value, weight] of fields) {
        if (!phraseMatch(value, term)) continue;
        score += weight * specificity;
        matches.push(`${field}:${term}`);
      }
    }
    return { unitId: unit.id, score: Number(score.toFixed(3)), matchedTerms: [...new Set(matches)] };
  }).sort((a, b) => b.score - a.score || a.unitId.localeCompare(b.unitId));

  const first = ranked[0];
  const second = ranked[1];
  if (first.score > 0) {
    const margin = second ? (first.score - second.score) / first.score : 1;
    return {
      unitId: first.unitId,
      method: 'weighted-lexical-taxonomy',
      score: first.score,
      runnerUp: second ? { unit_id: second.unitId, score: second.score } : null,
      ambiguous: Boolean(second && (first.score === second.score || margin < 0.15)),
      matchedTerms: first.matchedTerms,
    };
  }

  const fallbackByDiscipline = {
    'Political and Public International Law': 'POL-VIII',
    'Commercial Law': 'COM-I',
    'Civil Law': 'CIV-VIII',
    'Labor Law': 'LAB-VI',
    'Criminal Law': 'CRIM-III',
    'Remedial Law': 'REM-III',
  };
  const unitId = fallbackByDiscipline[record.Subject];
  if (!unitId) throw new Error(`No documented fallback for ${record.Subject}`);
  return { unitId, method: 'subject-default-fallback', score: 0, runnerUp: null, ambiguous: true, matchedTerms: [] };
}

function mapRecord(record, units, metadata = {}) {
  const assignment = lexicalClassification(record, units);
  const unit = units.find((candidate) => candidate.id === assignment.unitId);
  if (!unit) throw new Error(`Classifier returned unknown unit ${assignment.unitId}`);
  return {
    question_id: record['Question ID'] || record.id,
    bar_year: Number(record['Bar Year'] || record.bar_year) || null,
    source_discipline: record.Subject || record.question_bank_subject || record.source_legacy_subject,
    forecast_subject: unit.subject,
    syllabus_unit_id: unit.id,
    syllabus_unit: unit.heading,
    classification_method: assignment.method,
    classification_score: assignment.score,
    runner_up: assignment.runnerUp,
    ambiguity_flag: assignment.ambiguous,
    matched_terms: assignment.matchedTerms,
    ...metadata,
  };
}

function countBy(values, key) {
  const result = {};
  for (const value of values) {
    const label = typeof key === 'function' ? key(value) : value[key];
    result[label] = (result[label] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function concentration(rows, units, authoritativeUnitField = false) {
  const results = [];
  for (const subject of [...new Set(units.map((unit) => unit.subject))]) {
    const subjectUnits = units.filter((unit) => unit.subject === subject);
    const subjectRows = rows.filter((row) => row.subject === subject);
    const mapped = subjectRows.map((row) => {
      if (authoritativeUnitField) {
        const unit = units.find((candidate) => candidate.id === row.syllabus_unit_id);
        if (!unit || unit.subject !== subject) throw new Error(`${row.id}: invalid revised syllabus unit`);
        return { syllabus_unit_id: unit.id, ambiguity_flag: false, classification_method: 'published-exact-unit' };
      }
      const record = {
        ...row,
        Subject: row.source_legacy_subject || units.find((unit) => unit.subject === subject)?.question_bank_subject,
        Topic: row.title || row.syllabus_topic,
      };
      return mapRecord(record, units, { source: 'prior-forecast' });
    });
    const counts = Object.fromEntries(subjectUnits.map((unit) => [unit.id, mapped.filter((row) => row.syllabus_unit_id === unit.id).length]));
    const n = Math.max(1, mapped.length);
    const hhi = Object.values(counts).reduce((sum, count) => sum + (count / n) ** 2, 0);
    const minimumHhi = 1 / subjectUnits.length;
    const normalizedHhi = subjectUnits.length === 1 ? 0 : (hhi - minimumHhi) / (1 - minimumHhi);
    const targetAbsDeviation = subjectUnits.reduce((sum, unit) => sum + Math.abs((counts[unit.id] || 0) - unit.target_questions), 0);
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    results.push({
      subject,
      question_count: mapped.length,
      official_unit_count: subjectUnits.length,
      units_covered: Object.values(counts).filter((count) => count > 0).length,
      unit_coverage_rate: round(Object.values(counts).filter((count) => count > 0).length / subjectUnits.length),
      hhi: round(hhi, 6),
      normalized_hhi: round(normalizedHhi, 6),
      largest_unit_share: round((sorted[0]?.[1] || 0) / n, 6),
      largest_unit_id: sorted[0]?.[0] || null,
      target_absolute_deviation_questions: targetAbsDeviation,
      classification_ambiguity_count: mapped.filter((row) => row.ambiguity_flag).length,
      classification_fallback_count: mapped.filter((row) => row.classification_method === 'subject-default-fallback').length,
      counts_by_unit: counts,
    });
  }
  return results;
}

function rankUnitShares(unitIds, rows, years) {
  const yearly = years.map((year) => {
    const yearRows = rows.filter((row) => row.bar_year === year);
    return Object.fromEntries(unitIds.map((unitId) => [unitId, yearRows.filter((row) => row.syllabus_unit_id === unitId).length / Math.max(1, yearRows.length)]));
  });
  return Object.fromEntries(unitIds.map((unitId) => [
    unitId,
    yearly.reduce((sum, shares) => sum + shares[unitId], 0) / Math.max(1, yearly.length),
  ]));
}

function rankedUnitIds(shares) {
  return Object.entries(shares).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([unitId]) => unitId);
}

function backtests(mappedHistory, units) {
  const results = [];
  for (const subject of [...new Set(units.map((unit) => unit.subject))]) {
    const subjectRows = mappedHistory.filter((row) => row.forecast_subject === subject);
    const subjectUnits = units.filter((unit) => unit.subject === subject);
    const years = [...new Set(subjectRows.map((row) => row.bar_year))].sort((a, b) => a - b);
    if (years.length < 2) {
      results.push({ subject, status: 'not-feasible', reason: 'Fewer than two certified years are present.' });
      continue;
    }
    const holdoutYear = years.at(-1);
    const trainingYears = years.slice(0, -1);
    const trainingRows = subjectRows.filter((row) => trainingYears.includes(row.bar_year));
    const holdoutRows = subjectRows.filter((row) => row.bar_year === holdoutYear);
    const unitIds = subjectUnits.map((unit) => unit.id);
    const predictedShares = rankUnitShares(unitIds, trainingRows, trainingYears);
    const actualShares = rankUnitShares(unitIds, holdoutRows, [holdoutYear]);
    const k = Math.min(5, unitIds.length);
    const predictedTop = rankedUnitIds(predictedShares).slice(0, k);
    const actualTop = rankedUnitIds(actualShares).slice(0, k);
    const overlap = predictedTop.filter((unitId) => actualTop.includes(unitId)).length;
    const coveredRecords = holdoutRows.filter((row) => predictedTop.includes(row.syllabus_unit_id)).length;
    const actualBoundaryShare = actualShares[actualTop.at(-1)] || 0;
    const actualBoundaryTieCount = Object.values(actualShares).filter((share) => share === actualBoundaryShare).length;
    results.push({
      subject,
      status: 'diagnostic-latest-available-year-holdout',
      strict_complete_year_holdout: false,
      strict_complete_year_reason: 'The source manifest certifies individual records but does not attest that any subject-year is a complete questionnaire census.',
      training_years: trainingYears,
      training_records: trainingRows.length,
      holdout_year: holdoutYear,
      holdout_records: holdoutRows.length,
      k,
      predicted_top_k_units: predictedTop,
      actual_top_k_units: actualTop,
      top_k_overlap_count: overlap,
      top_k_overlap_rate: round(overlap / k),
      holdout_record_recall_at_k: round(coveredRecords / Math.max(1, holdoutRows.length)),
      uniform_unit_reference_rate: round(k / unitIds.length),
      top_k_tie_sensitive: actualBoundaryTieCount > 1,
      actual_boundary_tie_unit_count: actualBoundaryTieCount,
      holdout_ambiguity_count: holdoutRows.filter((row) => row.ambiguity_flag).length,
      holdout_fallback_count: holdoutRows.filter((row) => row.classification_method === 'subject-default-fallback').length,
      training_equal_weight_yearly_unit_shares: Object.fromEntries(Object.entries(predictedShares).map(([id, value]) => [id, round(value, 6)])),
      holdout_unit_shares: Object.fromEntries(Object.entries(actualShares).map(([id, value]) => [id, round(value, 6)])),
    });
  }
  return results;
}

const options = parseArgs(process.argv.slice(2));
const [scriptText, manifestText, bankText, unitsText, forecastText] = await Promise.all([
  readFile(new URL(import.meta.url), 'utf8'),
  readFile(MANIFEST_URL, 'utf8'),
  readFile(BANK_URL, 'utf8'),
  readFile(UNITS_URL, 'utf8'),
  readFile(FORECAST_URL, 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const bank = JSON.parse(bankText);
const unitDocument = JSON.parse(unitsText);
const revisedForecast = JSON.parse(forecastText);
const baselineText = execFileSync('git', ['show', `${options.baselineRef}:content/duediligence-2026/bar-forecast.json`], {
  cwd: fileURLToPath(ROOT),
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
const baselineForecast = JSON.parse(baselineText);
const units = unitDocument.rows;
const bankById = new Map(bank.records.map((record) => [record['Question ID'], record]));
const certifiedEntries = manifest.records.filter((entry) => entry.status === 'source-certified');
if (certifiedEntries.length !== 318) throw new Error(`Expected 318 source-certified records, received ${certifiedEntries.length}`);
if (Number(manifest.summary?.sourceCertified) !== certifiedEntries.length) throw new Error('Manifest source-certified summary does not match its records.');
const missing = certifiedEntries.filter((entry) => !bankById.has(entry.questionId));
if (missing.length) throw new Error(`Certified records missing from question bank: ${missing.map((entry) => entry.questionId).join(', ')}`);

const historicalMapping = certifiedEntries.map((entry) => mapRecord(bankById.get(entry.questionId), units, {
  source_status: entry.status,
  source_url: entry.sourceUrl,
}));
const duplicateHistoricalIds = Object.entries(countBy(historicalMapping, 'question_id')).filter(([, count]) => count !== 1);
if (duplicateHistoricalIds.length) throw new Error(`Historical mapping is not one-to-one: ${JSON.stringify(duplicateHistoricalIds)}`);
if (historicalMapping.some((row) => !units.some((unit) => unit.id === row.syllabus_unit_id))) throw new Error('Historical mapping contains an unknown unit.');

const baselineConcentration = concentration(baselineForecast.rows, units, false);
const revisedConcentration = concentration(revisedForecast.rows, units, true);
for (const result of revisedConcentration) {
  if (result.question_count !== 20) throw new Error(`${result.subject}: revised Forecast must contain exactly 20 questions`);
  if (result.target_absolute_deviation_questions !== 0) throw new Error(`${result.subject}: revised Forecast does not satisfy exact unit targets`);
}

const holdouts = backtests(historicalMapping, units);
const methodCounts = countBy(historicalMapping, 'classification_method');
const ambiguityCount = historicalMapping.filter((row) => row.ambiguity_flag).length;
const fallbackCount = historicalMapping.filter((row) => row.classification_method === 'subject-default-fallback').length;
if (fallbackCount) throw new Error(`${fallbackCount} historical records require a subject-default fallback; expand and review the taxonomy before using the audit.`);
for (const result of baselineConcentration) {
  if (result.question_count !== 20) throw new Error(`${result.subject}: prior Forecast baseline must contain exactly 20 questions`);
}
const beforeMeanHhi = baselineConcentration.reduce((sum, row) => sum + row.hhi, 0) / baselineConcentration.length;
const revisedMeanHhi = revisedConcentration.reduce((sum, row) => sum + row.hhi, 0) / revisedConcentration.length;

const output = {
  schema_version: '1.0',
  generated_on: new Date().toISOString().slice(0, 10),
  title: '2026 Bar Forecast statistical audit and diagnostic backtest',
  interpretation_guardrail: 'All Forecast scores and audit ranks are comparative training-priority rankings, not probabilities, leaks, guarantees, or estimates of the chance that a question will appear.',
  reproducibility: {
    command: `node scripts/audit-bar-forecast-statistics.mjs --baseline-ref=${options.baselineRef}`,
    baseline_ref: options.baselineRef,
    classifier_version: CLASSIFIER_VERSION,
    audit_script_sha256: sha256(scriptText),
    input_sha256: {
      source_manifest: sha256(manifestText),
      question_bank_projection: sha256(bankText),
      syllabus_units: sha256(unitsText),
      revised_forecast: sha256(forecastText),
      prior_forecast: sha256(baselineText),
    },
  },
  dataset_and_grain: {
    source_certified_record_count: certifiedEntries.length,
    mapped_record_count: historicalMapping.length,
    mapping_grain: 'One source-certified historical question record to exactly one official top-level 2026 syllabus unit.',
    forecast_grain: 'Twenty revised Forecast questions per subject.',
    historical_year_counts: countBy(historicalMapping, 'bar_year'),
    historical_forecast_subject_counts: countBy(historicalMapping, 'forecast_subject'),
  },
  classification_method: {
    candidate_scope: 'Only official top-level units whose question_bank_subject equals the record source discipline are eligible.',
    direct_routes: 'Taxation Law routes to the sole Taxation unit. Legal and Judicial Ethics routes to Ethics unless explicit practical-drafting terms route it to Practical Exercises.',
    lexical_rule: 'Remaining records are scored against the frozen official heading, historical_terms, and versioned EXTRA_TERMS. Matches in Topic, title, and syllabus fields receive more weight than doctrine, legal basis, prompt, or case text. Highest score wins; unit ID is the deterministic tie-break.',
    ambiguity_rule: 'Flag a lexical result when the lead is tied or less than 15 percent above the runner-up. A no-match subject-default assignment is always flagged and retained only to make coverage limitations inspectable.',
    method_counts: methodCounts,
    ambiguity_count: ambiguityCount,
    ambiguity_rate: round(ambiguityCount / historicalMapping.length),
    ambiguous_question_ids: historicalMapping.filter((row) => row.ambiguity_flag).map((row) => row.question_id),
    fallback_count: fallbackCount,
    fallback_rate: round(fallbackCount / historicalMapping.length),
  },
  concentration_and_coverage: {
    metric_definition: 'HHI is the sum of squared question shares across official top-level units within a subject. Lower HHI indicates broader distribution; it does not measure legal quality or predictive accuracy.',
    prior_forecast_baseline_note: 'The prior Forecast did not store official unit IDs, so its units are reconstructed with the same frozen classifier and its ambiguity counts are reported.',
    mean_subject_hhi_before: round(beforeMeanHhi, 6),
    mean_subject_hhi_revised: round(revisedMeanHhi, 6),
    mean_subject_hhi_change: round(revisedMeanHhi - beforeMeanHhi, 6),
    official_top_level_unit_count: units.length,
    units_covered_before: baselineConcentration.reduce((sum, row) => sum + row.units_covered, 0),
    units_covered_revised: revisedConcentration.reduce((sum, row) => sum + row.units_covered, 0),
    official_unit_coverage_rate_before: round(baselineConcentration.reduce((sum, row) => sum + row.units_covered, 0) / units.length),
    official_unit_coverage_rate_revised: round(revisedConcentration.reduce((sum, row) => sum + row.units_covered, 0) / units.length),
    before: baselineConcentration,
    revised: revisedConcentration,
  },
  backtest: {
    target: 'Historical-frequency unit ranking only. Other 2026-specific score components cannot be honestly reconstructed at each historical cutoff from this snapshot.',
    design: 'For each Forecast subject, hold out the latest available certified year and rank units from equal-weight within-subject yearly shares in all earlier available years. Report deterministic top-k overlap and the share of held-out records captured by training top-k units.',
    strict_leave_latest_complete_year_out_feasible: false,
    reason_not_strict: 'The source manifest certifies 318 individual records but contains no completeness attestation for any subject-year. The reported runs are latest-available-year sensitivity diagnostics, not strict complete-questionnaire backtests.',
    results: holdouts,
  },
  limitations: [
    'The 318-record corpus is uneven by subject and year and is not documented as a complete census of every Bar questionnaire.',
    'There are no 2020 records, and only Civil and Labor have certified 2025 rows in this snapshot.',
    'Top-k overlap is tie-sensitive when several held-out units have equal shares; the audit flags that condition and also reports record recall at k.',
    'Lexical classification can confuse cross-cutting doctrines. Ambiguity and fallback flags require legal-editorial review before treating unit-level counts as authoritative.',
    'The official 2026 taxonomy is applied retrospectively to older questions; older syllabi may have grouped concepts differently.',
    'A lower HHI proves broader unit allocation only. It does not prove that the revised Forecast is more likely to match the actual 2026 examination.',
    'Educator and luminary signals are not independently backtested here because the repository does not contain a versioned historical prediction corpus with outcomes.',
    'Scores are rankings, not calibrated probabilities. No confidence interval or statistical significance claim is justified by this non-random, incomplete corpus.',
  ],
  required_follow_up: [
    'Have a named Philippine-law reviewer resolve every ambiguity flag, keep fallback count at zero, then version the corrected mapping and rerun this audit.',
    'Add complete official questionnaires with subject-year completeness metadata before calling any holdout a strict leave-latest-complete-year-out backtest.',
    'Build a dated, attributable educator-prediction dataset before estimating whether that signal adds out-of-sample value.',
  ],
  historical_record_unit_mapping: historicalMapping,
};

await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${options.output}`);
console.log(`Mapped ${historicalMapping.length} source-certified records; ambiguity ${ambiguityCount}; fallback ${fallbackCount}.`);
console.log(`Mean subject HHI: ${round(beforeMeanHhi, 6)} before -> ${round(revisedMeanHhi, 6)} revised.`);
for (const result of holdouts) {
  if (result.status === 'not-feasible') console.log(`${result.subject}: not feasible (${result.reason})`);
  else console.log(`${result.subject}: ${result.holdout_year} n=${result.holdout_records}, overlap@${result.k}=${result.top_k_overlap_rate}, record recall=${result.holdout_record_recall_at_k}`);
}
