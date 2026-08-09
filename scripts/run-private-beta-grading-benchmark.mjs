import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RESPONSE_SCHEMA,
  analyzeStudentAnswer,
  applyDeterministicScoreCap,
  assessmentPolicy,
  buildExaminerPrompt,
  modelAnswerQualityIssues,
  performanceLabelForScore,
  questionFromBankRow,
  sanitizeSources,
  tierForScore,
  validateExaminerResult,
} from '../worker/examiner-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchmarkPath = path.join(root, 'docs', 'qa', '20260731-cycle-1', 'grading-benchmark-v1.json');
const questionBankPath = path.join(root, 'content', 'question-bank', 'website-upload.json');
const sourceEvidencePath = path.join(root, 'docs', 'qa', '20260731-private-beta-admission', 'primary-source-verification.json');
const DEFAULT_OUTPUT = path.join(root, 'artifacts', 'private-beta-grading-benchmark.json');
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_PROVIDER_ATTEMPTS = 3;

const SYNTHETIC_ANSWERS = Object.freeze({
  'ETHICS-BARE-CONCLUSION': 'Yes.',
  'POLI-WRONG': [
    'Answer: Yes. The Senate lawfully cited Winston in contempt.',
    'Legal Basis: Congress has an unrestricted inherent power to punish any unresponsive witness, and due process does not limit that power during an inquiry.',
    'Application: Winston refused to identify the immigration officers, so the Senate could detain him immediately without first hearing his explanation.',
    'Conclusion: Therefore, the contempt citation and detention were lawful.',
  ].join('\n\n'),
  'LAB-WRONG-RULE': [
    'Answer: Yes. A was constructively dismissed.',
    'Legal Basis: Article 87 of the Labor Code requires additional compensation for work beyond eight hours.',
    'Application: The president repeatedly humiliated A after the accident, so the overtime-pay rule treats her resignation as involuntary.',
    'Conclusion: Therefore, A was constructively dismissed.',
  ].join('\n\n'),
  'CIV-WEAK-APPLICATION': [
    'Answer: Yes. Angelica is liable for damages.',
    'Legal Basis: Articles 1169, 1170, and 1174 of the Civil Code govern delay, negligence, and fortuitous events.',
    'Application: These provisions apply to the facts.',
    'Conclusion: Therefore, Angelica is liable for delayed performance.',
  ].join('\n\n'),
  'TAX-PARTIAL': [
    'Answer: No. The proclamation is unconstitutional.',
    'Legal Basis: The Constitution assigns the power to grant tax exemptions to Congress, not to the President acting alone.',
    'Application: Here, the President rather than Congress granted the exemptions. That substitution of executive action for legislation is insufficient.',
    'Conclusion: Therefore, the proclamation cannot validly create the tax exemptions.',
  ].join('\n\n'),
  'COMM-FALSE-CITATION': [
    'Answer: No. The policies do not constitute double insurance.',
    'Legal Basis: Double insurance requires the same insured person, subject, interest, and risk. The same rule was supposedly announced in the explicitly test-only and nonexistent case of Santos v. Omega Assurance, G.R. No. TEST-ONLY-000.',
    'Application: Samson insured its ownership interest, while Alibaba insured its separate carrier-liability interest. The insured persons and interests therefore differ.',
    'Conclusion: Therefore, there is no double insurance.',
  ].join('\n\n'),
  'CRIM-FAULTY-REASONING': [
    'Answer: Yes. Harry is liable for an impossible crime.',
    'Legal Basis: A person who acts with bad intent is criminally liable even when no property is actually taken.',
    'Application: Harry wanted to steal Taylor\'s money and secretly opened her electronic wallet, showing bad intent.',
    'Conclusion: Therefore, his bad intent alone makes him liable for an impossible crime.',
  ].join('\n\n'),
  'REM-DIFFERENT-WORDING': [
    'Answer: No. Wednesday\'s probate opposition should not be dismissed.',
    'Legal Basis: Article 151 of the Family Code requires earnest efforts only in family disputes capable of compromise. Under Rule 75, probate determines whether an instrument is the decedent\'s valid will.',
    'Application: This controversy concerns probate, which the relatives cannot resolve through a private compromise. The earnest-efforts condition therefore does not apply.',
    'Conclusion: Therefore, the probate opposition may proceed despite the absence of an allegation of prior earnest efforts.',
  ].join('\n\n'),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2, 4);
}

function compactWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !['answer', 'legal', 'basis', 'application', 'conclusion', 'under', 'therefore', 'which', 'their', 'these', 'those', 'with'].includes(word));
}

function tokenOverlap(left, right) {
  const a = new Set(compactWords(left));
  const b = new Set(compactWords(right));
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

export function resolveSyntheticAnswer(sample, row) {
  if (sample.answerTemplate === '') return '';
  if (sample.answerTemplate === 'stored_suggested_answer_verbatim') return String(row['Suggested Answer'] || '').trim();
  if (sample.answerTemplate === 'stored_suggested_answer_verbatim_with_accurate_primary_source_reference') {
    return `${String(row['Suggested Answer'] || '').trim()}\n\nPrimary authority: ${String(row['Legal Basis / Provision'] || '').trim()}`;
  }
  if (sample.answerTemplate === 'No.') return 'No.';
  const fixed = SYNTHETIC_ANSWERS[sample.sampleId];
  if (!fixed) throw new Error(`No frozen synthetic answer is defined for ${sample.sampleId}.`);
  return fixed;
}

function feedbackText(assessment) {
  return [
    assessment?.rationale,
    assessment?.legalExplanation,
    ...(assessment?.errors || []),
    ...(assessment?.improvements || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function defectCategory(defect) {
  const text = String(defect).toLowerCase();
  if (/no answer|wrong conclusion|correct conclusion/.test(text)) return 'answer';
  if (/legal basis|constitutional rule|authority|citation|article|doctrine|reasoning|element/.test(text)) return 'legalBasis';
  if (/application|facts|analy/.test(text)) return 'application';
  if (/conclusion/.test(text)) return 'conclusion';
  return 'other';
}

function categoryDetected(category, assessment, isBlank) {
  if (isBlank) return true;
  const text = feedbackText(assessment);
  if (category === 'answer') return /answer|conclusion|position|result|incorrect|wrong/.test(text);
  if (category === 'legalBasis') return /legal basis|authority|citation|rule|doctrine|article|section|statute|jurisprudence|reasoning|element/.test(text);
  if (category === 'application') return /application|apply|facts|fact-specific|material fact|analysis/.test(text);
  if (category === 'conclusion') return /conclusion|reaffirm|result/.test(text);
  return true;
}

function containsFabricatedAuthority(assessment) {
  const modelAnswer = JSON.stringify(assessment?.modelAnswerALAC || {}).toLowerCase();
  return /test-only|test only|omega assurance|test-?only-?000/.test(modelAnswer);
}

function falseAuthorityDetected(assessment) {
  const text = feedbackText(assessment);
  return /false|fabricat|invent|nonexistent|not (?:a )?valid authority|incorrect (?:case|citation|authority)|unsupported authority/.test(text);
}

function sourceUrlsFromRow(row) {
  return `${row['Legal Basis / Provision'] || ''}\n${row['Source URL'] || ''}`
    .match(/https:\/\/[^\s;,)]*/gi) || [];
}

function primarySourceForRow(row) {
  return sourceUrlsFromRow(row).find((url) => /elibrary\.judiciary\.gov\.ph/i.test(url)) || '';
}

function baseMockResult(row, score) {
  const context = questionFromBankRow(row);
  const sections = Object.fromEntries(
    [...String(row['Suggested Answer'] || '').matchAll(/(?:^|\n)\s*(Answer|Legal Basis|Application|Conclusion):\s*([\s\S]*?)(?=\n\s*(?:Answer|Legal Basis|Application|Conclusion):|$)/gi)]
      .map((match) => [match[1].toLowerCase().replace(/\s+/g, ''), match[2].trim()]),
  );
  return {
    score,
    maxScore: 5,
    percentagePointValue: score,
    tier: tierForScore(score),
    performanceLabel: performanceLabelForScore(score),
    assessmentType: 'question_bank',
    label: 'Question-bank assessment',
    rationale: 'Mock-mode result used only to verify the benchmark harness contract.',
    strengths: ['Answer', 'Legal basis', 'Application'],
    errors: [],
    improvements: [],
    legalExplanation: context.legalBasis,
    modelAnswerALAC: {
      answer: sections.answer || 'No. The stored answer controls.',
      legalBasis: sections.legalbasis || context.legalBasis,
      application: sections.application || 'The stored rule applies to the material facts stated in the exact question.',
      conclusion: /^Therefore,|^Accordingly,|^In view thereof,/i.test(sections.conclusion || '')
        ? sections.conclusion
        : `Therefore, ${sections.conclusion || 'the stored result follows.'}`,
    },
    sources: sanitizeSources(context.sourceUrls),
    sourceStatus: 'stored',
    reviewRequired: false,
    rubricVersion: 'alac-gemini-v2.2',
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createRequestPacer(intervalMs) {
  let nextStart = 0;
  let tail = Promise.resolve();
  return () => {
    let release;
    const previous = tail;
    tail = new Promise((resolve) => { release = resolve; });
    return (async () => {
      await previous;
      const waitMs = Math.max(0, nextStart - Date.now());
      if (waitMs) await sleep(waitMs);
      nextStart = Date.now() + intervalMs;
      release();
    })();
  };
}

async function providerRequest({ apiKey, model, prompt }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
          signal: controller.signal,
        },
      );
      const responseText = await response.text();
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        lastError = new Error(`Provider request failed with HTTP ${response.status}.`);
        if (retryable && attempt < MAX_PROVIDER_ATTEMPTS) {
          const retryAfterSeconds = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.min(retryAfterSeconds * 1_000, 60_000)
            : response.status === 429 ? 15_000 : 1_500);
          continue;
        }
        throw lastError;
      }
      const payload = JSON.parse(responseText);
      const answerText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
      if (!answerText) throw new Error('Provider returned no assessment content.');
      return {
        raw: JSON.parse(answerText),
        latencyMs: Date.now() - started,
        providerAttempt: attempt,
      };
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error('Provider request timed out.') : error;
      if (attempt >= MAX_PROVIDER_ATTEMPTS) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Provider request failed.');
}

async function assessWithProvider({ apiKey, model, sample, row, answer }) {
  const context = questionFromBankRow(row);
  const policy = assessmentPolicy(context);
  const basePrompt = buildExaminerPrompt({
    questionId: sample.questionId,
    studentAnswer: answer,
    context,
    policy,
  });
  let repairIssues = [];
  let totalLatencyMs = 0;
  let providerAttempts = 0;
  for (let repairAttempt = 0; repairAttempt < 2; repairAttempt += 1) {
    const prompt = repairAttempt === 0
      ? basePrompt
      : `${basePrompt}\n\nCONTROLLED REPAIR: The previous response failed these quality checks:\n${repairIssues.map((issue) => `- ${issue}`).join('\n')}\nRewrite the entire JSON response once. Preserve the stored legal substance, return complete schema-valid JSON, make Application fact-specific and the most developed section, and start Conclusion with "Therefore,".`;
    const provider = await providerRequest({ apiKey, model, prompt });
    totalLatencyMs += provider.latencyMs;
    providerAttempts += provider.providerAttempt;
    try {
      const validated = validateExaminerResult(provider.raw, policy, sanitizeSources(context.sourceUrls));
      repairIssues = modelAnswerQualityIssues(validated, context);
      if (repairIssues.length) throw new Error('MODEL_ANSWER_QUALITY');
      const assessment = applyDeterministicScoreCap(validated, answer, context);
      return { assessment, latencyMs: totalLatencyMs, providerAttempts, repairAttempts: repairAttempt };
    } catch (error) {
      if (repairAttempt === 1) throw error;
      if (!repairIssues.length) repairIssues = [String(error?.message || 'Schema or ALAC completeness failure.')];
    }
  }
  throw new Error('Provider assessment failed validation.');
}

async function verifyPrimarySource(row, mockMode, preverified) {
  const url = primarySourceForRow(row);
  if (!url) return { url: '', passed: false, status: null, reason: 'missing-e-library-url' };
  const evidenceValid = preverified?.url === url
    && preverified?.status === 200
    && preverified?.identityMatched === true
    && /^[A-F0-9]{64}$/.test(String(preverified?.sha256 || ''));
  if (mockMode) {
    return {
      url,
      passed: evidenceValid,
      status: preverified?.status || null,
      identityMatched: preverified?.identityMatched === true,
      evidenceSha256: preverified?.sha256 || '',
      verifiedAt: preverified?.verifiedAt || '',
      runnerReachable: null,
      reason: evidenceValid ? 'preverified-official-source-evidence' : 'missing-preverified-evidence',
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Due-Diligence-Private-Beta-Legal-Benchmark/1.0' },
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = await response.text();
    const caseTokens = compactWords(row['Jurisprudence / Case']).slice(0, 2);
    const normalizedBody = body.toLowerCase();
    const identityMatched = caseTokens.length === 0 || caseTokens.every((token) => normalizedBody.includes(token));
    const liveValid = response.ok && body.length >= 500 && identityMatched;
    return {
      url,
      passed: evidenceValid && liveValid,
      status: response.status,
      bodyBytes: Buffer.byteLength(body),
      identityMatched,
      evidenceSha256: preverified?.sha256 || '',
      verifiedAt: preverified?.verifiedAt || '',
      runnerReachable: true,
      reason: liveValid ? 'official-source-reached-and-identity-matched' : 'live-source-validation-failed',
    };
  } catch (error) {
    return {
      url,
      passed: evidenceValid,
      status: preverified?.status || null,
      identityMatched: preverified?.identityMatched === true,
      evidenceSha256: preverified?.sha256 || '',
      verifiedAt: preverified?.verifiedAt || '',
      runnerReachable: false,
      reason: evidenceValid
        ? `preverified-official-source-evidence; runner-${error?.name === 'AbortError' ? 'timeout' : 'network-error'}`
        : error?.name === 'AbortError' ? 'timeout' : 'network-error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export function calculateBenchmarkMetrics(results, sourceChecks, requestRuns) {
  const completed = results.filter((result) => Number.isFinite(result.actualScore));
  const absoluteErrors = completed.map((result) => Math.abs(result.actualScore - result.expectedScore));
  const feedbackChecks = completed.flatMap((result) => result.defectChecks || []);
  const latencies = requestRuns.filter((run) => run.ok).map((run) => run.latencyMs);
  const falseHigh = completed.filter((result) => result.actualScore - result.expectedScore > 0.5);
  const falseLow = completed.filter((result) => result.expectedScore - result.actualScore > 0.5);
  const unsafeFalseHigh = completed.filter((result) => {
    const difference = result.actualScore - result.expectedScore;
    return difference > 1
      || (result.expectedScore <= 2.5 && result.actualScore >= 4)
      || (result.expectedScore <= 1 && result.actualScore > 2.5);
  });
  const legalBasisChecks = completed.filter((result) => typeof result.legalBasisAccurate === 'boolean');
  const citationChecks = completed.filter((result) => typeof result.citationValid === 'boolean');
  const repeatDeltas = completed.map((result) => result.repeatScoreDelta).filter(Number.isFinite);
  const metrics = {
    sampleSize: results.length,
    samplesCompleted: completed.length,
    subjects: new Set(results.map((result) => result.subject)).size,
    deterministicPrefilterSamples: results.filter((result) => result.executionPath === 'deterministic-prefilter').length,
    liveProviderSamples: results.filter((result) => result.executionPath === 'gemini').length,
    liveProviderRequests: requestRuns.length,
    successfulProviderRequests: requestRuns.filter((run) => run.ok).length,
    meanAbsoluteError: absoluteErrors.length ? round(absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length) : null,
    medianAbsoluteError: median(absoluteErrors),
    agreementWithin0_5: absoluteErrors.length ? round(absoluteErrors.filter((value) => value <= 0.5).length / absoluteErrors.length) : null,
    agreementWithin1_0: absoluteErrors.length ? round(absoluteErrors.filter((value) => value <= 1).length / absoluteErrors.length) : null,
    alacIssueDetectionAgreement: feedbackChecks.length ? round(feedbackChecks.filter((check) => check.detected).length / feedbackChecks.length) : null,
    legalBasisAccuracy: legalBasisChecks.length ? round(legalBasisChecks.filter((result) => result.legalBasisAccurate).length / legalBasisChecks.length) : null,
    citationValidity: citationChecks.length ? round(citationChecks.filter((result) => result.citationValid).length / citationChecks.length) : null,
    unsupportedAuthorityDetection: completed.find((result) => result.sampleId === 'COMM-FALSE-CITATION')?.unsupportedAuthorityDetected ?? false,
    fabricatedAuthorityRate: completed.length ? round(completed.filter((result) => result.fabricatedAuthority).length / completed.length) : null,
    falseHighRate: completed.length ? round(falseHigh.length / completed.length) : null,
    unsafeFalseHighRate: completed.length ? round(unsafeFalseHigh.length / completed.length) : null,
    falseLowRate: completed.length ? round(falseLow.length / completed.length) : null,
    falseHighSamples: falseHigh.map((result) => result.sampleId),
    unsafeFalseHighSamples: unsafeFalseHigh.map((result) => result.sampleId),
    falseLowSamples: falseLow.map((result) => result.sampleId),
    repeatedSampleMeanAbsoluteDelta: repeatDeltas.length ? round(repeatDeltas.reduce((sum, value) => sum + value, 0) / repeatDeltas.length) : null,
    repeatedSampleMaximumDelta: repeatDeltas.length ? Math.max(...repeatDeltas) : null,
    parsingFailures: requestRuns.filter((run) => run.errorType === 'parsing-or-validation').length,
    requestFailures: requestRuns.filter((run) => !run.ok).length,
    requestFailureRate: requestRuns.length ? round(requestRuns.filter((run) => !run.ok).length / requestRuns.length) : 0,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      maximum: latencies.length ? Math.max(...latencies) : null,
    },
    primarySourcesChecked: sourceChecks.length,
    primarySourcesPassed: sourceChecks.filter((source) => source.passed).length,
  };
  const gates = {
    allSamplesCompleted: metrics.samplesCompleted === metrics.sampleSize,
    eightSubjectsCovered: metrics.subjects === 8,
    agreementWithin0_5: metrics.agreementWithin0_5 >= 0.8,
    noUnsafeFalseHighs: metrics.unsafeFalseHighRate <= 0.02,
    noFabricatedAuthorities: metrics.fabricatedAuthorityRate === 0,
    requestReliability: metrics.requestFailureRate <= 0.02,
    gradingLatency: metrics.latencyMs.p95 !== null && metrics.latencyMs.p95 <= 30_000,
    officialSourcesVerified: metrics.primarySourcesPassed === metrics.primarySourcesChecked && metrics.primarySourcesChecked === 8,
    falseAuthorityDetected: metrics.unsupportedAuthorityDetection === true,
    citationValidity: metrics.citationValidity === 1,
  };
  return { metrics, gates, passed: Object.values(gates).every(Boolean) };
}

export async function runBenchmark(options = {}) {
  const mockMode = options.mockMode === true;
  const repeatRuns = Number(options.repeatRuns || 2);
  const concurrency = Number(options.concurrency || 1);
  const requestIntervalMs = Number(options.requestIntervalMs ?? 7_000);
  const model = options.model || DEFAULT_MODEL;
  const apiKey = options.apiKey || '';
  if (!mockMode && !apiKey) throw new Error('GEMINI_API_KEY is required for the live non-credit benchmark.');
  if (!Number.isInteger(repeatRuns) || repeatRuns < 2 || repeatRuns > 3) throw new Error('repeatRuns must be 2 or 3.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('concurrency must be between 1 and 4.');
  if (!Number.isFinite(requestIntervalMs) || requestIntervalMs < 0 || requestIntervalMs > 60_000) throw new Error('requestIntervalMs must be between 0 and 60000.');

  const benchmarkText = fs.readFileSync(benchmarkPath, 'utf8');
  const benchmark = JSON.parse(benchmarkText);
  const bankText = fs.readFileSync(questionBankPath, 'utf8');
  const bankPayload = JSON.parse(bankText);
  const bankRows = Array.isArray(bankPayload) ? bankPayload : bankPayload.records;
  if (!Array.isArray(bankRows)) throw new Error('The website question bank has no records array.');
  const byId = new Map(bankRows.map((row) => [String(row['Question ID'] || '').trim(), row]));
  const sourceEvidenceText = fs.readFileSync(sourceEvidencePath, 'utf8');
  const sourceEvidence = JSON.parse(sourceEvidenceText);
  const preverifiedByQuestionId = new Map(sourceEvidence.sources.map((source) => [source.questionId, source]));
  const questions = benchmark.questions.map((question) => {
    const row = byId.get(question.questionId);
    if (!row) throw new Error(`Benchmark question ${question.questionId} is absent from the website question bank.`);
    return { question, row };
  });
  const sourceChecks = await mapLimit(questions, 2, ({ question, row }) => (
    verifyPrimarySource(row, mockMode, preverifiedByQuestionId.get(question.questionId))
  ));
  const sourceCheckByUrl = new Map(sourceChecks.map((check) => [check.url, check]));

  const resolvedSamples = benchmark.samples.map((sample) => {
    const row = byId.get(sample.questionId);
    if (!row) throw new Error(`Sample ${sample.sampleId} references a missing question.`);
    const answer = resolveSyntheticAnswer(sample, row);
    return { sample, row, answer };
  });

  const requestRuns = [];
  const providerJobs = resolvedSamples
    .filter(({ answer }) => answer.trim())
    .flatMap((entry) => Array.from({ length: repeatRuns }, (_, runIndex) => ({ ...entry, runIndex: runIndex + 1 })));

  const paceProviderRequest = createRequestPacer(mockMode ? 0 : requestIntervalMs);
  const providerOutputs = await mapLimit(providerJobs, concurrency, async (job) => {
    const started = Date.now();
    try {
      let output;
      if (mockMode) {
        const assessment = applyDeterministicScoreCap(
          baseMockResult(job.row, job.sample.expectedScore),
          job.answer,
          questionFromBankRow(job.row),
        );
        output = { assessment, latencyMs: 5, providerAttempts: 1, repairAttempts: 0 };
      } else {
        await paceProviderRequest();
        output = await assessWithProvider({ apiKey, model, ...job });
      }
      requestRuns.push({ sampleId: job.sample.sampleId, runIndex: job.runIndex, ok: true, latencyMs: output.latencyMs });
      return { ...job, ...output };
    } catch (error) {
      requestRuns.push({
        sampleId: job.sample.sampleId,
        runIndex: job.runIndex,
        ok: false,
        latencyMs: Date.now() - started,
        errorType: /JSON|MODEL_ANSWER_QUALITY|assessment|schema|ALAC/i.test(String(error?.message)) ? 'parsing-or-validation' : 'provider-request',
        error: String(error?.message || error).slice(0, 300),
      });
      return { ...job, error: String(error?.message || error).slice(0, 300) };
    }
  });

  const results = resolvedSamples.map(({ sample, row, answer }) => {
    const runs = providerOutputs.filter((output) => output.sample.sampleId === sample.sampleId);
    const successfulRuns = runs.filter((run) => run.assessment);
    const primaryAssessment = answer.trim() ? successfulRuns[0]?.assessment : null;
    const actualScore = answer.trim() ? primaryAssessment?.score : 0;
    const runScores = answer.trim() ? successfulRuns.map((run) => run.assessment.score) : [0];
    const context = questionFromBankRow(row);
    const defectChecks = sample.expectedDefects
      .map(defectCategory)
      .filter((category, index, categories) => categories.indexOf(category) === index)
      .map((category) => ({ category, detected: categoryDetected(category, primaryAssessment, !answer.trim()) }));
    const fabricatedAuthority = primaryAssessment ? containsFabricatedAuthority(primaryAssessment) : false;
    const legalBasisAccurate = primaryAssessment
      ? tokenOverlap(primaryAssessment.modelAnswerALAC?.legalBasis, context.legalBasis) >= 3
      : true;
    const citationValid = primaryAssessment
      ? !fabricatedAuthority && primaryAssessment.sources.every((source) => sourceUrlsFromRow(row).includes(source.url))
      : true;
    return {
      sampleId: sample.sampleId,
      questionId: sample.questionId,
      subject: row.Subject,
      qualityBand: sample.qualityBand,
      expectedScore: sample.expectedScore,
      actualScore: Number.isFinite(actualScore) ? actualScore : null,
      absoluteError: Number.isFinite(actualScore) ? round(Math.abs(actualScore - sample.expectedScore)) : null,
      runScores,
      repeatScoreDelta: runScores.length >= 2 ? round(Math.max(...runScores) - Math.min(...runScores)) : 0,
      executionPath: answer.trim() ? 'gemini' : 'deterministic-prefilter',
      answerSha256: sha256(answer),
      answerWordCount: compactWords(answer).length,
      deterministicAnalysis: analyzeStudentAnswer(answer, context),
      defectChecks,
      legalBasisAccurate,
      citationValid,
      unsupportedAuthorityDetected: sample.sampleId === 'COMM-FALSE-CITATION' ? falseAuthorityDetected(primaryAssessment) : null,
      fabricatedAuthority,
      primarySource: sourceCheckByUrl.get(primarySourceForRow(row)) || null,
      assessment: primaryAssessment || null,
      providerErrors: runs.filter((run) => run.error).map((run) => ({ runIndex: run.runIndex, error: run.error })),
    };
  });

  const evaluation = calculateBenchmarkMetrics(results, sourceChecks, requestRuns);
  return {
    benchmarkVersion: benchmark.benchmarkVersion,
    executionVersion: 'dd-private-beta-live-provider-v1',
    executedAt: new Date().toISOString(),
    mode: mockMode ? 'mock-contract-test' : 'live-non-credit-provider',
    model,
    groundingEnabled: false,
    repeatRuns,
    concurrency,
    requestIntervalMs,
    benchmarkInputSha256: sha256(benchmarkText),
    questionBankInputSha256: sha256(bankText),
    primarySourceEvidenceInputSha256: sha256(sourceEvidenceText),
    credentialsLoggedOrPersisted: false,
    memberGradingCreditsConsumed: 0,
    providerBillingScope: 'Repository release-gate harness only; no user or member attempt was created.',
    unsafeFalseHighDefinition: 'A score more than 1.0 above the frozen human score, a score of 4.0+ for an expected score of 2.5 or less, or a score above 2.5 for an expected score of 1.0 or less. Smaller calibration deltas remain reported in falseHighRate and agreement metrics.',
    blindHumanExpectationsCreatedBeforeProviderRun: benchmark.method.blindExpectedScoresCreatedBeforeProviderRun === true,
    sourceChecks,
    results,
    requestRuns,
    ...evaluation,
    verdict: evaluation.passed ? 'PASS — LEGAL-ACCURACY EXPANSION GATES MET' : 'NO-GO — ONE OR MORE LEGAL-ACCURACY GATES FAILED',
  };
}

async function main() {
  const outputFlag = process.argv.find((argument) => argument.startsWith('--output='));
  const outputPath = path.resolve(root, outputFlag ? outputFlag.slice('--output='.length) : DEFAULT_OUTPUT);
  const mockMode = process.argv.includes('--mock');
  const result = await runBenchmark({
    mockMode,
    apiKey: mockMode ? '' : process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    repeatRuns: Number(process.env.BENCHMARK_REPEAT_RUNS || 2),
    concurrency: Number(process.env.BENCHMARK_CONCURRENCY || 1),
    requestIntervalMs: Number(process.env.BENCHMARK_REQUEST_INTERVAL_MS || 7_000),
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    verdict: result.verdict,
    metrics: result.metrics,
    gates: result.gates,
    output: path.relative(root, outputPath).replace(/\\/g, '/'),
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`Private-beta grading benchmark failed: ${String(error?.message || error).slice(0, 500)}`);
    process.exitCode = 1;
  });
}
