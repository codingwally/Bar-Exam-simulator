// Local synthetic test fixture only. Never included in browser/runtime entrypoints.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from './bar-forecast-core.mjs';
import { createForecastAttemptStore, FORECAST_RUBRIC_VERSION } from './forecast-attempt-store.mjs';
import { validateSavedForecastForExport } from './forecast-result-pdf.mjs';
import { transformContentRow } from '../scripts/import-duediligence-2026-content.mjs';

export const OWNER = '11111111-1111-4111-8111-111111111111';
const ATTEMPT = '33333333-3333-4333-8333-333333333333';
const SUBJECT = 'Civil Law and Land Titles and Deeds';
export async function curatedFixture() {
  const content = JSON.parse(await readFile(new URL('../content/duediligence-2026/bar-forecast.json', import.meta.url), 'utf8'));
  const collection = { file: 'bar-forecast.json', contentType: core.BAR_FORECAST_CONTENT_TYPE,
    sourceVersion: core.BAR_FORECAST_SOURCE_VERSION, title: (row) => `${row.editorial_ref} — ${row.title}` };
  const envelopes = content.rows.filter((row) => row.subject === SUBJECT).map((row) => {
    const item = transformContentRow(row, collection);
    return { id: item.id, contentType: item.content_type, subject: item.subject, title: item.title,
      version: item.source_version, checksum: item.checksum, payload: item.payload };
  });
  const sourceRows = core.validatedForecastRows(envelopes, SUBJECT);
  const setId = await core.forecastSetId(sourceRows);
  assert.equal(setId, core.BAR_FORECAST_APPROVED_SET_IDS[SUBJECT]);
  const rows = sourceRows.map((row, index) => ({ ...row, userAnswer: `Local synthetic resource fixture answer ${index + 1}. The controlling rule must be applied to each material fact and every required legal element before reaching a supported conclusion.${index === 19 ? ' Final editor capture: ₱149, Señor Niño, café.' : ''}` }));
  const batches = Array.from({ length: 5 }, (_, batchIndex) => ({ batchIndex, status: 'complete', result: {
    results: rows.slice(batchIndex * 4, batchIndex * 4 + 4).map((row) => ({ questionId: row.id, score: 0,
      grammar: { score: 4.7, corrections: [] }, issueSpotting: { score: 0, identified: [], missed: [] } })),
  } }));
  const snapshot = { schemaVersion: 'forecast-attempt-v1', contentVersion: core.BAR_FORECAST_SOURCE_VERSION,
    rubricVersion: FORECAST_RUBRIC_VERSION, subject: SUBJECT, setId, rows };
  let canonical;
  const store = createForecastAttemptStore({ rpc: async (_env, name, args) => {
    if (name === 'dd2026_forecast_attempt_internal') return { status: 'processing', ownerId: OWNER,
      acceptedAt: '2026-09-07T15:08:45.000Z', snapshot, batches };
    if (name === 'dd2026_forecast_attempt_finalize') { canonical = args.p_result; return { attempt: {} }; }
    throw new Error('UNEXPECTED_LOCAL_RPC');
  } });
  await store.finalize({}, ATTEMPT);
  const attempt = { id: ATTEMPT, status: 'complete', resultRevision: 1, subject: SUBJECT, setId,
    completedAt: '2026-09-07T15:20:00.000Z', result: canonical,
    questions: rows.map((row) => ({ id: row.id, number: row.number, prompt: row.prompt })),
    answers: rows.map((row) => ({ questionId: row.id, answer: row.userAnswer })) };
  validateSavedForecastForExport(attempt, OWNER);
  return attempt;
}


export function withMaximumAnswers(attempt) {
  const copy = structuredClone(attempt);
  for (let index = 0; index < 20; index += 1) {
    const row = copy.result.results[index]; const words = row.suggestedAnswer.split(/\s+/u);
    let text = ''; let block = 0;
    while (text.length < 6000) {
      const rotated = words.slice(block % words.length).concat(words.slice(0, block % words.length));
      text += `Synthetic Q${index + 1} paragraph${++block}: ${rotated.join(' ')} I would distinguish those material facts, test the alternative interpretation, and apply each legal requirement to explain my conclusion.\n\n`;
    }
    const answer = text.slice(0, 6000);
    copy.answers[index].answer = answer; copy.result.results[index] = { ...row, userAnswer: answer };
  }
  return copy;
}
