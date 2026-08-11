import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';
import { DD2026_LIMITS, DD2026ValidationError } from './duediligence-2026-core.mjs';

const PAGE = Object.freeze({ width: 595.28, height: 841.89, margin: 54 });
const NAVY = rgb(0, 33 / 255, 71 / 255);
const GOLD = rgb(197 / 255, 160 / 255, 89 / 255);
const SLATE = rgb(51 / 255, 65 / 255, 85 / 255);
const MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const RULE = rgb(226 / 255, 232 / 255, 240 / 255);
const WATERMARK = rgb(235 / 255, 228 / 255, 210 / 255);

function fontBytes() {
  const binary = atob(notoSansBase64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

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

function humanLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function feedbackText(feedback) {
  if (!feedback || typeof feedback !== 'object') return text(feedback);
  const preferred = [
    feedback.coachingTips,
    feedback.coaching_tips,
    feedback.improvements,
    feedback.errors,
    feedback.rationale,
    feedback.examinerRemarks,
    feedback.examiner_remarks,
  ].filter(Boolean);
  return preferred.length ? preferred.map(text).filter(Boolean).join('\n\n') : text(feedback);
}

function standaloneQuestion(result) {
  return {
    id: result?.questionId || `${result?.barYear || 'bar'}-${result?.questionNumber || 'question'}`,
    label: [result?.subject, result?.barYear, result?.questionNumber].filter(Boolean).join(' · '),
    question: result?.question,
    suggestedAnswer: result?.suggestedAnswer,
    improvedAnswer: result?.improvedAnswer,
    legalBasis: result?.legalBasis,
    sources: result?.sources,
    userAnswer: result?.userAnswer,
    feedback: result?.feedback,
  };
}

function improvedAnswer(question) {
  const feedback = question?.feedback;
  if (!feedback || typeof feedback !== 'object') return text(question?.improvedAnswer);
  return text(
    question?.improvedAnswer
    || feedback.improvedAlacAnswer
    || feedback.improved_alac_answer
    || feedback.modelAnswer
    || feedback.model_answer,
  );
}

function sourceText(question) {
  return text(
    question?.sources
    || question?.sourceUrls
    || question?.source_urls
    || question?.officialSources
    || question?.official_sources,
  );
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

function selectedQuestions(result, selectionKind, selectedIds) {
  const sections = resultSections(result);
  const selected = new Set(selectedIds.map(String));
  const includedSections = selectionKind === 'sections'
    ? sections.filter((section) => selected.has(section.id))
    : sections;
  const questions = includedSections.flatMap((section) => section.questions.map((question) => ({
    ...question,
    label: [section.label, question?.label].filter(Boolean).join(' · '),
  })));
  if (selectionKind !== 'questions') return questions;
  return questions.filter((question, index) => selected.has(String(question.id ?? index + 1)));
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
  const questions = selectedQuestions(result, selectionKind, selectedIds);
  if (!questions.length) {
    throw new DD2026ValidationError('EMPTY_PDF_SELECTION', 'Select at least one completed question to export.');
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes(), { subset: true });
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
    page.drawText(text(value), { x: PAGE.margin, y: cursor, size, font, color });
    cursor -= size + gap;
  }

  function drawBody(value, { size = 9.5, lineHeight = 14, color = SLATE } = {}) {
    const width = PAGE.width - PAGE.margin * 2;
    const paragraphs = wrappedParagraphs(font, value || '—', size, width);
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
  ].filter(Boolean).join(' · '), { size: 9, lineHeight: 13, color: MUTED });

  questions.forEach((question, index) => {
    ensureHeight(80);
    drawHeading(`QUESTION ${index + 1}${question.label ? ` · ${question.label}` : ''}`, { size: 12 });
    drawHeading('Complete question', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.question);
    drawHeading('Suggested answer', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.suggestedAnswer);
    const improved = improvedAnswer(question);
    if (improved && improved !== text(question.suggestedAnswer)) {
      drawHeading('Improved ALAC answer', { size: 9, color: GOLD, gap: 6 });
      drawBody(improved);
    }
    drawHeading('Your answer', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.userAnswer);
    drawHeading('Coaching tips and feedback', { size: 9, color: GOLD, gap: 6 });
    drawBody(feedbackText(question.feedback) || 'No additional coaching note was recorded.');
    drawHeading('Legal basis', { size: 9, color: GOLD, gap: 6 });
    drawBody(question.legalBasis || 'No separate legal-basis field was recorded for this legacy attempt.');
    drawHeading('Primary sources', { size: 9, color: GOLD, gap: 6 });
    drawBody(sourceText(question) || 'No separate source link was recorded for this legacy attempt.');
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
