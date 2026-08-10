import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { DD2026_LIMITS, DD2026ValidationError } from './duediligence-2026-core.mjs';

const PAGE = Object.freeze({ width: 595.28, height: 841.89, margin: 54 });
const NAVY = rgb(0, 33 / 255, 71 / 255);
const GOLD = rgb(197 / 255, 160 / 255, 89 / 255);
const SLATE = rgb(51 / 255, 65 / 255, 85 / 255);
const MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const RULE = rgb(226 / 255, 232 / 255, 240 / 255);
const WATERMARK = rgb(235 / 255, 228 / 255, 210 / 255);

function text(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => `${humanLabel(key)}: ${text(entry)}`)
      .filter((entry) => !entry.endsWith(': '))
      .join('\n');
  }
  return String(value);
}

function printableText(font, value) {
  const replacements = new Map([
    ['\u00a0', ' '],
    ['\u2010', '-'],
    ['\u2011', '-'],
    ['\u2012', '-'],
    ['\u2013', '-'],
    ['\u2014', '-'],
    ['\u2018', "'"],
    ['\u2019', "'"],
    ['\u201c', '"'],
    ['\u201d', '"'],
    ['\u2022', '-'],
    ['\u2026', '...'],
    ['\u20b1', 'PHP '],
  ]);
  return Array.from(text(value)).map((character) => {
    if (character === '\n') return '\n';
    if (character === '\t') return ' ';
    const replacement = replacements.get(character);
    if (replacement != null) return replacement;
    try {
      font.encodeText(character);
      return character;
    } catch {
      return '?';
    }
  }).join('');
}

function humanLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function feedbackText(feedback) {
  if (!feedback || typeof feedback !== 'object') return text(feedback);
  const preferred = [
    feedback.rationale,
    feedback.summary,
    feedback.overallFeedback,
    feedback.overall_feedback,
    feedback.coachingTips,
    feedback.coaching_tips,
    feedback.legalExplanation,
    feedback.legal_explanation,
    feedback.examinerRemarks,
    feedback.examiner_remarks,
  ].filter(Boolean);
  return preferred.map(text).filter(Boolean).join('\n\n');
}

function modelAnswerText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return text(value);
  const parts = [
    ['Answer', value.answer],
    ['Legal Basis', value.legalBasis || value.legal_basis],
    ['Application', value.application],
    ['Conclusion', value.conclusion],
  ].filter(([, entry]) => text(entry));
  return parts.length ? parts.map(([label, entry]) => `${label}:\n${text(entry)}`).join('\n\n') : text(value);
}

function listText(value) {
  if (!Array.isArray(value)) return text(value);
  return value.map((entry) => text(entry)).filter(Boolean).map((entry) => `- ${entry}`).join('\n');
}

function sourceText(sources) {
  if (!Array.isArray(sources)) return text(sources);
  return sources.map((source) => {
    if (typeof source === 'string') return source;
    return [source?.title, source?.reference, source?.url].map(text).filter(Boolean).join(' - ');
  }).filter(Boolean).join('\n');
}

function standaloneQuestion(result) {
  return {
    id: result?.questionId || `${result?.barYear || 'bar'}-${result?.questionNumber || 'question'}`,
    label: [result?.subject, result?.barYear, result?.questionNumber].filter(Boolean).join(' - '),
    question: result?.question,
    suggestedAnswer: result?.suggestedAnswer,
    userAnswer: result?.userAnswer,
    feedback: result?.feedback,
    score: result?.score,
    strengths: result?.strengths,
    omissions: result?.omissions,
    improvedAnswer: result?.improvedAnswer,
    sources: result?.sources,
  };
}

function resultSections(result) {
  if (Array.isArray(result?.sections)) {
    return result.sections.map((section, index) => ({
      id: String(section?.id ?? index + 1),
      label: text(section?.label || section?.title || `Section ${index + 1}`),
      questions: Array.isArray(section?.questions) ? section.questions : [],
    }));
  }
  if (Array.isArray(result?.questions)) {
    return [{ id: 'all', label: '', questions: result.questions }];
  }
  return [{ id: 'all', label: '', questions: [standaloneQuestion(result)] }];
}

function normalizedQuestion(question, result) {
  const feedback = question?.feedback || question?.assessment || result?.feedback || result?.assessment || {};
  return {
    ...question,
    subject: question?.subject || result?.subject,
    question: question?.question || question?.prompt || result?.question,
    suggestedAnswer: question?.suggestedAnswer || question?.modelAnswer || result?.suggestedAnswer,
    userAnswer: question?.userAnswer || question?.answerText || result?.userAnswer,
    score: question?.score ?? question?.aiScore ?? result?.score,
    feedback,
    strengths: question?.strengths || feedback?.strengths || result?.strengths,
    omissions: question?.omissions || question?.errors || feedback?.errors || result?.omissions,
    improvements: question?.improvements || feedback?.improvements || result?.improvements,
    improvedAnswer: question?.improvedAnswer || feedback?.modelAnswerALAC || feedback?.improvedAnswer || result?.improvedAnswer,
    sources: question?.sources || feedback?.sources || result?.sources,
  };
}

function selectedQuestions(result, selectionKind, selectedIds) {
  const sections = resultSections(result);
  const selected = new Set(selectedIds.map(String));
  const includedSections = selectionKind === 'sections'
    ? sections.filter((section) => selected.has(section.id))
    : sections;
  const questions = includedSections.flatMap((section) => section.questions.map((question) => ({
    ...question,
    label: [section.label, question?.label].filter(Boolean).join(' - '),
  })));
  const included = selectionKind !== 'questions'
    ? questions
    : questions.filter((question, index) => selected.has(String(question.id ?? index + 1)));
  return included.map((question) => normalizedQuestion(question, result));
}

export function verdictPdfDocument({ result, selectionKind = 'entire_result', selectedIds = [] }) {
  const questions = selectedQuestions(result, selectionKind, selectedIds);
  return {
    title: 'THE VERDICT',
    subject: text(result?.subject),
    gradedAt: text(result?.gradedAt),
    score: result?.score,
    questions: questions.map((question, index) => ({
      id: String(question?.id ?? index + 1),
      label: text(question?.label),
      subject: text(question?.subject),
      prompt: text(question?.question),
      userAnswer: text(question?.userAnswer),
      score: question?.score,
      coaching: feedbackText(question?.feedback),
      strengths: listText(question?.strengths),
      omissions: listText(question?.omissions),
      improvements: listText(question?.improvements),
      improvedAnswer: modelAnswerText(question?.improvedAnswer),
      suggestedAnswer: text(question?.suggestedAnswer),
      legalSources: sourceText(question?.sources),
    })),
  };
}

function wrapLine(font, value, size, maximumWidth) {
  const words = String(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maximumWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maximumWidth) {
      current = word;
      continue;
    }
    let fragment = '';
    for (const character of Array.from(word)) {
      const next = fragment + character;
      if (font.widthOfTextAtSize(next, size) > maximumWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else fragment = next;
    }
    current = fragment;
  }
  if (current) lines.push(current);
  return lines;
}

function wrappedParagraphs(font, value, size, width) {
  return text(value).split('\n').flatMap((line) => wrapLine(font, line, size, width));
}

export async function buildVerdictPdf({ result, selectionKind = 'entire_result', selectedIds = [] }) {
  const document = verdictPdfDocument({ result, selectionKind, selectedIds });
  const questions = document.questions;
  if (!questions.length) {
    throw new DD2026ValidationError('EMPTY_PDF_SELECTION', 'Select at least one completed question to export.');
  }
  const pdf = await PDFDocument.create();
  // Use pdf-lib's native font so the generated text stream renders reliably in
  // browser PDF viewers and Poppler. The former WOFF2 embedding produced a
  // syntactically valid file whose text was invisible in affected viewers.
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = [];
  let page;
  let cursor;

  function createPage() {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE.height - 8, width: PAGE.width, height: 8, color: NAVY });
    page.drawText('DUE DILIGENCE', {
      x: PAGE.margin,
      y: PAGE.height - 47,
      size: 14,
      font,
      color: NAVY,
    });
    page.drawText('PHILIPPINE BAR EXAMINATION REVIEW', {
      x: PAGE.margin,
      y: PAGE.height - 63,
      size: 7.5,
      font,
      color: GOLD,
    });
    page.drawLine({
      start: { x: PAGE.margin, y: PAGE.height - 74 },
      end: { x: PAGE.width - PAGE.margin, y: PAGE.height - 74 },
      thickness: 0.8,
      color: RULE,
    });
    page.drawText('DUEDILIGENCE — PERSONAL USE', {
      x: 105,
      y: 375,
      size: 30,
      font,
      color: WATERMARK,
      rotate: degrees(32),
      opacity: 0.26,
    });
    cursor = PAGE.height - 96;
  }

  function ensureHeight(height) {
    if (!page || cursor - height < 82) createPage();
  }

  function drawHeading(value, { size = 11, color = NAVY, gap = 8 } = {}) {
    ensureHeight(size + gap + 4);
    page.drawText(printableText(font, value), { x: PAGE.margin, y: cursor, size, font, color });
    cursor -= size + gap;
  }

  function drawBody(value, { size = 9.5, lineHeight = 14, color = SLATE } = {}) {
    const width = PAGE.width - PAGE.margin * 2;
    const paragraphs = wrappedParagraphs(font, printableText(font, value || '-'), size, width);
    for (const line of paragraphs) {
      ensureHeight(lineHeight);
      if (line) page.drawText(line, { x: PAGE.margin, y: cursor, size, font, color });
      cursor -= lineHeight;
    }
    cursor -= 7;
  }

  createPage();
  drawHeading('THE VERDICT', { size: 22, gap: 10 });
  drawBody([
    result?.subject,
    result?.gradedAt ? `Graded ${new Date(result.gradedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : '',
    result?.score != null ? `Score: ${result.score}/5` : '',
  ].filter(Boolean).join(' - '), { size: 9, lineHeight: 13, color: MUTED });

  questions.forEach((question, index) => {
    ensureHeight(80);
    drawHeading(`QUESTION ${index + 1}${question.label ? ` - ${question.label}` : ''}`, { size: 12 });
    drawHeading('Subject', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.subject || result?.subject || '-');
    drawHeading('Complete question', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.prompt);
    drawHeading('Your answer', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.userAnswer);
    drawHeading('Score', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.score != null ? `${question.score} / 5` : 'No score was recorded.');
    drawHeading('Coaching tips and feedback', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.coaching || 'No additional coaching note was recorded.');
    drawHeading('Strengths', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.strengths || 'No specific strength was recorded.');
    drawHeading('Omissions and errors', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.omissions || 'No omission was recorded.');
    drawHeading('Prioritized improvements', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.improvements || 'No separate improvement priority was recorded.');
    drawHeading('Improved answer', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.improvedAnswer || 'No separate improved answer was recorded.');
    drawHeading('Released suggested answer', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.suggestedAnswer);
    drawHeading('Legal sources', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.legalSources || 'No source link was recorded.');
    if (index + 1 < questions.length) {
      ensureHeight(18);
      page.drawLine({
        start: { x: PAGE.margin, y: cursor },
        end: { x: PAGE.width - PAGE.margin, y: cursor },
        thickness: 0.6,
        color: RULE,
      });
      cursor -= 18;
    }
  });

  pages.forEach((entry, index) => {
    const notice = 'For personal use only. Do not distribute. Not for sale.';
    const warning = 'AI-generated educational material may contain errors or false statements. Verify independently against current law and primary authority.';
    entry.drawLine({
      start: { x: PAGE.margin, y: 64 },
      end: { x: PAGE.width - PAGE.margin, y: 64 },
      thickness: 0.6,
      color: RULE,
    });
    entry.drawText(notice, { x: PAGE.margin, y: 49, size: 6.8, font, color: MUTED });
    for (const [lineIndex, line] of wrapLine(font, warning, 6.4, PAGE.width - PAGE.margin * 2 - 55).entries()) {
      entry.drawText(line, { x: PAGE.margin, y: 37 - lineIndex * 8, size: 6.4, font, color: MUTED });
    }
    entry.drawText(`${index + 1} / ${pages.length}`, {
      x: PAGE.width - PAGE.margin - 35,
      y: 37,
      size: 7,
      font,
      color: NAVY,
    });
  });

  pdf.setTitle('Due Diligence — The Verdict');
  pdf.setAuthor('Due Diligence');
  pdf.setSubject('Personal Philippine Bar Examination review result');
  pdf.setProducer('Due Diligence secure Worker');
  const bytes = await pdf.save({ useObjectStreams: true });
  if (!bytes.length || bytes.length > DD2026_LIMITS.verdictPdfBytes) {
    throw new DD2026ValidationError(
      'PDF_SIZE_LIMIT',
      'This report is too large to export safely. Select fewer questions and try again.',
      413,
    );
  }
  return bytes;
}

export function verdictPdfFileName(result) {
  const subject = String(result?.subject || 'bar-review')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'bar-review';
  return `duediligence-verdict-${subject}.pdf`;
}
