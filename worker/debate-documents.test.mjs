import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { renderDebateDocument } from './debate-documents.mjs';
import { DEFAULT_RULES } from './debate-domain.mjs';

const example = () => ({
  eventId: 'de-00000000000000000000000000000001', matchId: 'synthetic-match-one', createdFor: 'synthetic-organizer',
  eventTitle: 'Intercollegiate Debate Invitational', matchTitle: 'Opening match', kind: 'event_report', rehearsal: true,
  rules: structuredClone(DEFAULT_RULES), rulesVersion: 2, resultVersion: 'result-one', resultRevision: 1,
  result: { state: 'FINAL', winner: 'affirmative', resultKind: 'normal', judgingMode: 'majority', publishedAt: 100000, finalizedAt: 100001 },
});
async function csv(document) {
  return new TextDecoder().decode((await renderDebateDocument(document, { format: 'csv' })).bytes);
}
async function validPdf(document) {
  const output = await renderDebateDocument(document);
  assert.equal(output.mimeType, 'application/pdf');
  const pdf = await PDFDocument.load(output.bytes);
  assert.ok(pdf.getPageCount() > 0); assert.equal(pdf.getTitle(), document.eventTitle + ' - Event report');
}

test('empty finalized award summaries produce explicit guidance and retain any recorded reason', async () => {
  for (const summary of [undefined, null, {}, { status: 'UNAVAILABLE' }, { status: 'UNAVAILABLE', reason: 'This match used winner-only ballots.' }]) {
    const document = example(); document.result.awards = summary; const before = JSON.stringify(document);
    const text = await csv(document);
    assert.match(text, /Speech awards/); assert.match(text, /No speech awards are available for this result\./);
    if (summary?.reason) assert.ok(text.includes(summary.reason));
    assert.doesNotMatch(text, /Awards await finalization/); assert.equal(JSON.stringify(document), before);
  }
  await validPdf(example());
});

test('populated awards retain all named recipients, shared awards and definitions without an empty fallback', async () => {
  const document = example(); document.result.awards = {
    bestSpeaker: { status: 'AWARDED', winnerParticipants: [{ displayName: 'Mara Santos' }], definition: 'Highest eligible speech average.' },
    bestInterpellator: { status: 'COAWARD', winnerParticipants: [{ displayName: 'Luis Cruz' }, { displayName: 'Ana Reyes' }] },
    bestRebuttalSpeaker: { status: 'AWARDED', winnerParticipants: [{ displayName: 'Nina Ramos' }] },
    bestDebater: { status: 'UNRESOLVED', reason: 'The panel must complete its tie decision.' },
  };
  const before = JSON.stringify(document), text = await csv(document);
  for (const value of ['Best Speaker', 'Recipient: Mara Santos', 'Highest eligible speech average.', 'Best Interpellator', 'Shared recipients: Luis Cruz; Ana Reyes', 'Best Rebuttalist', 'Recipient: Nina Ramos', 'Best Debater', 'Status: UNRESOLVED', 'The panel must complete its tie decision.']) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /No speech awards are available|Awards await finalization/);
  await validPdf(document); assert.equal(JSON.stringify(document), before);
});

test('provisional results keep awards pending even when a saved summary has recipients', async () => {
  const document = example(); document.result.state = 'PROVISIONAL_PUBLISHED'; document.result.correctionDeadline = 200000;
  document.result.awards = { bestSpeaker: { status: 'AWARDED', winnerParticipants: [{ displayName: 'Pending recipient' }] } };
  const text = await csv(document);
  assert.match(text, /Awards await finalization\./); assert.doesNotMatch(text, /Pending recipient|No speech awards are available/);
  await validPdf(document);
});

test('pairing and qualification copy explains pending results without changing recorded names, states or minimums', async () => {
  const document = example(); document.teamRoster = [{ id: 'team-one', name: 'Fixture Scholars' }];
  document.fixtures = [{ id: 'se-2-1', round: 2, affirmativeTeamId: 'team-one', negativeTeamId: null, status: 'AWAITING_PREDECESSORS' }];
  document.eventAwards = { minimumMatches: 4 }; const before = JSON.stringify(document);
  const text = await csv(document);
  assert.match(text, /Published pairings/); assert.match(text, /Fixture Scholars vs Awaiting earlier match result; Awaiting earlier match results/);
  assert.match(text, /At least 4 actual completed comparable matches are required\. Different rubrics are evaluated separately\./);
  assert.match(text, /Practice matches and unplayed results do not count toward these awards\./);
  assert.match(text, /REHEARSAL - this record is excluded from real competition standings\./);
  assert.doesNotMatch(text, /Awaiting predecessor|AWAITING_PREDECESSORS|invented scores/);
  assert.equal(JSON.stringify(document), before);
  document.fixtures = []; assert.match(await csv(document), /No published pairings\./);
});
