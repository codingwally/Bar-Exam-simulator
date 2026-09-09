import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import notoSans from './noto-sans-latin-ext.mjs';
import { SEATS, SPEAKER_CRITERIA, scoreScorecard } from './debate-domain.mjs';

const titles = { rules: 'Accepted rules and run of show', scorecard: 'My private scorecard', result: 'Official match result', csv: 'Official match result', certificate: 'Certificate of participation', event_report: 'Event report' };
const awardTitles = { bestSpeaker: 'Best Speaker', bestDebater: 'Best Debater', bestInterpellator: 'Best Interpellator', bestRebuttalSpeaker: 'Best Rebuttalist', bestRebuttalist: 'Best Rebuttalist', bestClosing: 'Best Rebuttalist' };
const documentTitle = document => document.kind === 'certificate' && document.certificateType === 'award' ? 'Certificate of award' : titles[document.kind];
const side = value => value === 'affirmative' ? 'Affirmative' : value === 'negative' ? 'Negative' : 'Unresolved';
const text = value => String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[\u2010-\u2014]/g, '-');
const label = key => key === 'AWAITING_PREDECESSORS' ? 'Awaiting earlier match results' : text(key).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const safeName = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70).replace(/^-|-$/g, '') || 'debate';
const date = (value, zone = 'Asia/Manila') => value ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value)) : 'Not recorded';
const score = value => value?.display ?? (value == null ? 'Not available' : typeof value === 'number' ? String(value) : 'Not available');

function rowsFor(document) {
  if (!document || !titles[document.kind] || !document.eventId || !document.createdFor) throw new Error('An authorized debate document is required.');
  const rows = [], heading = value => rows.push({ type: 'heading', text: text(value) });
  const line = (name, value) => rows.push({ type: 'line', text: `${name}: ${text(value)}` });
  const para = value => rows.push({ type: 'paragraph', text: text(value) });
  const name = id => document.participants?.find(p => p.id === id)?.displayName || document.teamRoster?.find(t => t.id === id)?.name || id || 'Unassigned';
  const speaker = seat => `${seat} - ${name(document.seats?.[seat])}`;
  const awards = (summary, tournament = false) => {
    if (!summary) { para('Awards are not available.'); return; }
    if (summary.reason) para(summary.reason);
    for (const key of ['bestSpeaker', 'bestInterpellator', 'bestRebuttalSpeaker', 'bestDebater']) {
      const award = summary[key]; if (!award) continue;
      heading(awardTitles[key]); line('Status', label(award.status));
      const winners = award.winnerParticipants?.map(p => p.displayName) || (award.winners || []).map(id => tournament ? name(id) : speaker(id));
      if (winners.length) line(award.status === 'COAWARD' ? 'Shared recipients' : 'Recipient', winners.join('; '));
      if (award.reason || award.definition) para(award.reason || award.definition);
      if (tournament) for (const entry of award.eligibility || []) line(entry.displayName || name(entry.id), `${entry.matchCount} qualifying performances - ${entry.eligible ? 'Eligible' : entry.reason || 'Minimum not met'}`);
    }
  };
  line('Event', document.eventTitle); line('Match', document.matchTitle); line('Rules version', document.rulesVersion);
  if (document.resultRevision) line('Result version', `${document.resultRevision} (${document.resultVersion})`);
  if (document.rehearsal) para('REHEARSAL - this record is excluded from real competition standings.');
  const rules = document.rules;
  if (document.kind === 'rules') {
    heading('Rules accepted for this match');
    line('Format', rules.preset); line('Language', rules.language); line('Timezone', rules.timezone);
    line('Decision method', rules.judgingMode); line('Preparation', `${rules.preparationMs / 60000} minutes`);
    para('Each team has three active speakers. Its captain is one of those three. The accepted roster identifies the actual closing speaker.');
    para('The official controlling the timer selects Start and Finish stage. Zero begins overtime; it never automatically ends a speech, mutes participants or deducts points. During questioning both assigned participants have the floor.');
    line('Motion', document.motion?.text || 'Private until the organizer releases it');
    heading('Declared sanctions');
    if (!rules.sanctions?.length) para('No custom sanctions declared. No automatic penalty applies for overtime.');
    for (const policy of rules.sanctions || []) line(policy.label, `${policy.description} - ${policy.effect === 'warning' ? 'Warning without point deduction' : `Fixed team deduction: ${policy.points} points, aggregate judging only`}`);
    heading('Run of show');
    for (const [i, stage] of document.runOfShow.entries()) line(`${i + 1}. ${stage.label || label(stage.kind)}`, `${stage.durationMs == null ? 'Untimed' : `${stage.durationMs / 60000} minutes`}${stage.speakerSeats?.length ? ` - ${stage.speakerSeats.join(' / ')}` : ''}`);
    heading('Scoring and adjudication');
    if (rules.judgingMode === 'simple') para('Simple ballots declare a winner. They do not create numerical scores or numerical speech awards.');
    else {
      for (const [key, weight] of Object.entries(rules.rubric.weights)) line(rules.rubric.labels[key], `${weight} points`);
      para('Team total = mean of the three individual subtotals + one team closing score. Under the default weights this is 85 + 15 = 100. Blanks are incomplete; zero must be explicit. Exact arithmetic determines the decision before display rounding.');
      para('Majority mode counts each eligible judge once. Aggregate mode compares the declared panel average. An exact tied scorecard in majority mode needs a reasoned choice. A tied panel remains unresolved under the accepted procedure.');
    }
    para(`Provisional results allow ${rules.correctionWindowMs / 60000} minutes for procedural correction. A human official must finalize after open protests are resolved. Audience Choice is separate from the official result and awards.`);
    heading('Source notes');
    para('This is the Due Diligence Modified Oxford-Oregon format; event practices vary. The accepted version above governs this match.');
    para('Casiciaco Recoletos Seminary: https://www.recoletosdebaguio.edu.ph/2022/04/06/cares-holds-philosophical-debate-during-jornadas-de-filosofia-2022/');
    para('Mañebog tournament framework: https://ourhappyschool.com/debate/debate-tournament-framework-mechanics-guidelines-etc');
    para('DENR/DepEd event mechanics: https://catanduanes.deped.gov.ph/files/UM---Inter-Schools-Debate-for-the-Environment-and-Battle-of-Best-Partnership-Initiatives-and-Awarding-Ceremonies.pdf');
  } else if (document.kind === 'scorecard') {
    const ballot = document.ballot, draft = document.draft, card = ballot?.scorecard || draft?.scorecard;
    heading('Private to the assigned judge');
    line('Status', ballot ? 'Submitted final ballot' : 'Private draft'); line('Saved', date(ballot?.submittedAt || draft?.savedAt, rules.timezone));
    if (rules.judgingMode === 'simple') line('Choice', side(ballot?.winner || draft?.winner));
    else {
      for (const seat of SEATS) {
        heading(speaker(seat));
        for (const key of SPEAKER_CRITERIA) { const value = card?.speakers?.[seat]?.[key]; line(rules.rubric.labels[key], value == null ? 'Not entered' : `${card.encoding === 'hundredths' ? value / 100 : value} / ${rules.rubric.weights[key]}`); }
      }
      for (const team of ['affirmative', 'negative']) { const value = card?.closing?.[team]; line(`${side(team)} closing`, value == null ? 'Not entered' : `${card.encoding === 'hundredths' ? value / 100 : value} / ${rules.rubric.weights.closing}`); }
      try { const totals = scoreScorecard(card, rules); line('Affirmative total', `${totals.teams.affirmative.display} / 100`); line('Negative total', `${totals.teams.negative.display} / 100`); line('Ballot choice', side(totals.winner)); } catch { para('This scorecard is incomplete or needs review. No official total is inferred.'); }
      if (card?.tieBreakReason) line('Tie explanation', card.tieBreakReason);
    }
    if (draft?.reason) line('Reasoned decision', draft.reason);
    if (draft?.notes) { heading('Private notes'); para(draft.notes); }
  } else if (document.kind === 'certificate') {
    if (document.result?.state !== 'FINAL' || !document.participant?.id) throw new Error('A certificate requires finalized records and an identified participant.');
    heading(document.participant.displayName);
    para(`Participated in ${document.eventTitle}, ${document.matchTitle}, on the basis of the confirmed attendance record.`);
    if (document.participant.roles?.length) line('Recorded roles', document.participant.roles.map(label).join(', '));
    if (document.certificateType === 'award') {
      if (!document.award || !['AWARDED', 'COAWARD'].includes(document.award.status)) throw new Error('The certificate award must be confirmed in the final result.');
      line('Award', awardTitles[document.awardKey] || label(document.awardKey));
      if (document.award.status === 'COAWARD') para('This is a shared award under the finalized competition record.');
    }
    line('Issued by', document.issuer || 'Event organizer');
    line('Finalized', date(document.result.finalizedAt, rules.timezone));
    para(document.certificateType === 'award' ? 'This certifies the award in the referenced finalized event record.' : 'This certifies recorded participation. It does not imply an award or professional qualification.');
  } else {
    const result = document.result;
    if (!result || !['PROVISIONAL_PUBLISHED', 'FINAL'].includes(result.state)) throw new Error('A currently published result is required.');
    heading(result.state === 'FINAL' ? 'Final result' : 'Provisional result - correction window');
    line('Official winner', side(result.winner)); line('Conclusion', label(result.resultKind)); line('Decision method', result.judgingMode || rules.judgingMode);
    if (result.ballotSplit) for (const team of ['affirmative', 'negative']) line(`${side(team)} ballots`, result.ballotSplit[team] ?? 'Not available');
    if (result.teamScores) for (const team of ['affirmative', 'negative']) line(`${side(team)} panel average`, score(result.teamScores[team]));
    else para('No numerical team score is available for this decision.');
    if (result.motion?.text || document.motion?.text) line('Motion', result.motion?.text || document.motion.text);
    if (result.sanctions?.length) {
      heading('Disclosed sanctions and adjustments'); para('Raw scorecards and raw speech awards remain unchanged.');
      if (result.application === 'not_applied_exceptional_conclusion') para('Recorded sanctions are not applied to this exceptional conclusion.');
      if (result.adjustedTeamScores) for (const team of ['affirmative','negative']) line(side(team), `Raw panel score ${score(result.rawTally?.teamScores?.[team])}; adjusted official score ${score(result.adjustedTeamScores[team])}`);
      for (const entry of result.sanctions) line(entry.action === 'reverse' ? `Reversal of ${entry.recordId}` : `${entry.label} - ${entry.target.side ? side(entry.target.side) : speaker(entry.target.seat)}`, `${entry.reason}; entered by ${name(entry.actorId)}; ${date(entry.at, rules.timezone)}${entry.pointsHundredths ? `; fixed deduction ${(entry.pointsHundredths / 100).toFixed(2)} points` : ''}`);
    }
    line('Published', date(result.publishedAt, rules.timezone)); line(result.state === 'FINAL' ? 'Finalized' : 'Correction deadline', date(result.finalizedAt || result.correctionDeadline, rules.timezone));
    heading('Speech awards');
    if (result.state !== 'FINAL') para('Awards await finalization.'); else awards(result.awards);
    heading('Audience Choice');
    para('Audience Choice is a separate audience result. It does not change this official decision or award eligibility.');
    const poll = document.audienceChoice?.state === 'Published' && document.audienceChoice.result?.published ? document.audienceChoice.result : null;
    if (!poll) para('No published Audience Choice result is available.');
    else {
      line('Audience result', poll.status === 'NO_VOTES' ? 'No valid votes' : poll.status === 'TIE' ? 'Tie' : side(poll.winner));
      for (const team of ['affirmative', 'negative']) line(side(team), `${poll.counts[team]} votes${poll.choicePercentages[team] == null ? '' : ` (${poll.choicePercentages[team]}% of valid votes)`}`);
      line('Turnout', `${poll.validVotes} / ${poll.eligibleCount} eligible observers${poll.turnoutPercent == null ? '' : ` (${poll.turnoutPercent}%)`}`);
      line('Invalidated votes', poll.invalidatedCount);
    }
    if (document.kind === 'event_report') {
      heading('Standings');
      if (!document.standings?.rows?.length) para('No finalized standings.');
      for (const row of document.standings?.rows || []) line(`${row.rank}${row.tied ? ' (tied)' : ''}. ${name(row.teamId)}`, `${row.wins} wins / ${row.played} played; ${row.scoredMatches} scored matches; comparable mean ${score(row.meanScore)}`);
      if (document.standings?.unresolvedQualification) para('Qualification remains tied. Schedule the required tie resolution.');
      heading('Published pairings');
      if (!document.fixtures?.length) para('No published pairings.');
      for (const fixture of document.fixtures || []) line(`Round ${fixture.round} - ${fixture.id}`, `${fixture.affirmativeTeamId ? name(fixture.affirmativeTeamId) : 'Awaiting earlier match result'} vs ${fixture.negativeTeamId ? name(fixture.negativeTeamId) : 'Awaiting earlier match result'}; ${label(fixture.status)}${fixture.winnerTeamId ? `; winner ${name(fixture.winnerTeamId)}` : ''}${fixture.requiresReview ? '; correction review required' : ''}`);
      heading('Tournament awards');
      const tournament = document.eventAwards;
      para(`At least ${tournament?.minimumMatches || 2} actual completed comparable matches are required. Different rubrics are evaluated separately. Rehearsal and exceptional unplayed results do not supply invented scores.`);
      if (tournament?.reason) para(tournament.reason);
      if (!tournament?.comparableGroups?.length) para('No eligible comparable tournament group is available.');
      for (const [index, group] of (tournament?.comparableGroups || []).entries()) { heading(`Comparable rubric group ${index + 1}`); awards(group, true); }
    }
  }
  return rows;
}

export function safeCsvCell(value) {
  let raw = text(value); if (/^[\s\uFEFF]*[=+@-]/u.test(raw)) raw = `'${raw}`;
  return `"${raw.replace(/"/g, '""')}"`;
}

/** Input is a fresh role-filtered document from the service, never browser JSON. */
export async function renderDebateDocument(document, { format = 'pdf' } = {}) {
  const rows = rowsFor(document);
  const basename = `duediligence-debate-${safeName(document.eventTitle)}-${safeName(document.kind)}-r${document.resultRevision || document.rulesVersion}`;
  if (format === 'csv') {
    if (!['csv', 'result', 'event_report'].includes(document.kind)) throw new Error('CSV is limited to authorized published results.');
    return { bytes: new TextEncoder().encode('\uFEFF' + [['Record', 'Value'], ...rows.map(r => [r.type, r.text])].map(row => row.map(safeCsvCell).join(',')).join('\r\n') + '\r\n'), mimeType: 'text/csv; charset=utf-8', filename: `${basename}.csv` };
  }
  if (format !== 'pdf') throw new Error('Unsupported debate document format.');
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setCreationDate(new Date(document.result?.publishedAt || 0)); pdf.setModificationDate(new Date(document.result?.publishedAt || 0));
  pdf.setTitle(`${document.eventTitle} - ${documentTitle(document)}`); pdf.setAuthor('Due Diligence'); pdf.setSubject(`Rules ${document.rulesVersion}; result ${document.resultRevision || 'not published'}`);
  const font = await pdf.embedFont(notoSans, { subset: true });
  const W = 595.28, H = 841.89, margin = 48, width = W - 2 * margin;
  const navy = rgb(.025, .095, .17), gold = rgb(.64, .48, .22), ink = rgb(.12, .17, .22), gray = rgb(.37, .41, .45);
  let page, y;
  function addPage() { page = pdf.addPage([W, H]); page.drawRectangle({ x: 0, y: H - 78, width: W, height: 78, color: navy }); page.drawText('DUE DILIGENCE  /  DEBATE ROOM', { x: margin, y: H - 37, size: 12, font, color: rgb(1, .97, .9) }); page.drawRectangle({ x: margin, y: H - 89, width: 55, height: 2, color: gold }); y = H - 118; }
  const wrap = (value, size) => {
    const lines = [];
    for (const paragraph of text(value).split('\n')) {
      let line = '';
      for (const char of paragraph) { if (font.widthOfTextAtSize(line + char, size) > width && line) { const breakAt = line.lastIndexOf(' '); if (breakAt > line.length / 2) { lines.push(line.slice(0, breakAt)); line = line.slice(breakAt + 1) + char; } else { lines.push(line); line = char; } } else line += char; }
      lines.push(line);
    }
    return lines;
  };
  const pageTop = H - 118, pageBottom = 60, pageCapacity = pageTop - pageBottom;
  const layout = [{ type: 'title', text: documentTitle(document) }, ...rows].map(row => {
    const size = row.type === 'title' ? 20 : row.type === 'heading' ? 13 : 10, leading = size * 1.5;
    const heading = row.type === 'heading' || row.type === 'title', before = heading ? 6 : 0, after = row.type === 'line' ? 3 : 8, lines = wrap(row.text, size);
    return { ...row, size, leading, lines, heading, before, after, height: before + lines.length * leading + after };
  });
  addPage();
  for (const [index, row] of layout.entries()) {
    const { size, leading, lines } = row;
    let keepHeight = row.height;
    if (row.heading) {
      // A section heading followed by an award heading belongs with its first
      // content rows. Keep status and recipient together instead of stranding
      // an award heading with only its status at the bottom of the page.
      let next = index + 1;
      while (layout[next]?.heading) keepHeight += layout[next++].height;
      for (let count = 0; count < 2 && layout[next] && !layout[next].heading; count++, next++) keepHeight += layout[next].height <= pageCapacity ? layout[next].height : layout[next].leading;
    }
    if (keepHeight <= pageCapacity && y - keepHeight < pageBottom && y < pageTop) addPage();
    y -= row.before;
    for (const line of lines) { if (y - leading < 60) addPage(); page.drawText(line, { x: margin, y, size, font, color: row.type === 'heading' ? gold : ink }); y -= leading; }
    y -= row.after;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => { p.drawLine({ start: { x: margin, y: 44 }, end: { x: W - margin, y: 44 }, thickness: .5, color: gold }); p.drawText(`${document.rehearsal ? 'REHEARSAL  |  ' : ''}${document.kind === 'scorecard' ? 'PRIVATE  |  ' : ''}Rules v${document.rulesVersion}${document.resultRevision ? `  |  Result v${document.resultRevision}` : ''}`, { x: margin, y: 28, size: 8, font, color: gray }); p.drawText(`${i + 1} / ${pages.length}`, { x: W - margin - 40, y: 28, size: 8, font, color: gray }); });
  return { bytes: await pdf.save(), mimeType: 'application/pdf', filename: `${basename}.pdf` };
}
