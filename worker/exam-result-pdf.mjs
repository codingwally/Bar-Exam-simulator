import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';
import { DD2026ValidationError } from './duediligence-2026-core.mjs';

const PAGE = Object.freeze({ width: 595.28, height: 841.89, margin: 50 });
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_CHARACTERS = 2_000_000;
const MAX_PROMPT_CHARACTERS = 50_000;
const MAX_ANSWER_CHARACTERS = 20_000;
const MAX_COMMENT_CHARACTERS = 5_000;
const NAVY = rgb(0, 33 / 255, 71 / 255);
const GOLD = rgb(197 / 255, 160 / 255, 89 / 255);
const INK = rgb(28 / 255, 38 / 255, 51 / 255);
const MUTED = rgb(92 / 255, 108 / 255, 128 / 255);
const RULE = rgb(220 / 255, 226 / 255, 233 / 255);

const SCOPE_LABELS = Object.freeze({
  questions_answers: 'Questions and submitted answers',
  answers_only: 'Submitted answers only',
  grades_comments: 'Grades and Professor comments only',
});

function fontBytes() {
  const binary = atob(notoSansBase64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function safeText(value, maximum = MAX_PROMPT_CHARACTERS, { rejectOverflow = false } = {}) {
  const cleaned = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (Array.from(cleaned).length > maximum) {
    if (rejectOverflow) {
      throw new DD2026ValidationError(
        'EXAM_ROOM_RESULT_EXPORT_TOO_LARGE',
        'This candidate result is too large to prepare as one PDF.',
        413,
      );
    }
    return Array.from(cleaned).slice(0, maximum).join('').trim();
  }
  return cleaned.trim();
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
      if (fragment && font.widthOfTextAtSize(next, size) > maximumWidth) {
        lines.push(fragment);
        fragment = character;
      } else fragment = next;
    }
    current = fragment;
  }
  if (current) lines.push(current);
  return lines;
}

function wrappedLines(font, value, size, width, maximum) {
  return safeText(value, maximum, { rejectOverflow: true })
    .split('\n')
    .flatMap((line) => wrapLine(font, line, size, width));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resultQuestions(result) {
  const questions = Array.isArray(result?.questions) ? result.questions : [];
  if (questions.length < 1 || questions.length > 200) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_RESULT_EXPORT_INVALID',
      'The result package has an invalid number of questions.',
      422,
    );
  }
  const sourceCharacters = questions.reduce((total, question) => total
    + String(question?.prompt ?? '').length
    + String(question?.answer ?? '').length
    + String(question?.comment ?? '').length, 0);
  if (sourceCharacters > MAX_SOURCE_CHARACTERS) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_RESULT_EXPORT_TOO_LARGE',
      'This candidate result is too large to prepare as one PDF.',
      413,
    );
  }
  return questions;
}

export async function buildExamResultPdf(result) {
  const scope = String(result?.scope || '');
  if (!Object.hasOwn(SCOPE_LABELS, scope)) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_RESULT_EXPORT_INVALID',
      'Choose a valid result download.',
    );
  }
  const questions = resultQuestions(result);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes(), { subset: true });
  const pages = [];
  let page;
  let cursor;

  function newPage() {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    page.drawRectangle({
      x: 0,
      y: PAGE.height - 8,
      width: PAGE.width,
      height: 8,
      color: NAVY,
    });
    page.drawText('DUE DILIGENCE', {
      x: PAGE.margin,
      y: PAGE.height - 43,
      size: 13,
      font,
      color: NAVY,
    });
    page.drawText('EXAMINATION ROOM', {
      x: PAGE.margin,
      y: PAGE.height - 58,
      size: 7.5,
      font,
      color: GOLD,
    });
    page.drawLine({
      start: { x: PAGE.margin, y: PAGE.height - 70 },
      end: { x: PAGE.width - PAGE.margin, y: PAGE.height - 70 },
      thickness: 0.8,
      color: RULE,
    });
    cursor = PAGE.height - 92;
  }

  function ensure(height) {
    if (!page || cursor - height < 78) newPage();
  }

  function heading(value, { size = 11, color = NAVY, gap = 7 } = {}) {
    const lines = wrapLine(font, safeText(value, 500), size, PAGE.width - PAGE.margin * 2);
    for (const line of lines) {
      ensure(size + gap);
      page.drawText(line || ' ', { x: PAGE.margin, y: cursor, size, font, color });
      cursor -= size + 3;
    }
    cursor -= gap;
  }

  function body(value, {
    size = 9.2,
    lineHeight = 13,
    color = INK,
    maximum = MAX_PROMPT_CHARACTERS,
    emptyText = 'No response recorded.',
  } = {}) {
    const lines = wrappedLines(
      font,
      value || emptyText,
      size,
      PAGE.width - PAGE.margin * 2,
      maximum,
    );
    for (const line of lines) {
      ensure(lineHeight);
      if (line) page.drawText(line, { x: PAGE.margin, y: cursor, size, font, color });
      cursor -= lineHeight;
    }
    cursor -= 6;
  }

  newPage();
  heading(safeText(result?.examTitle || 'Class examination', 200), { size: 20, gap: 8 });
  body([
    `Candidate: ${safeText(result?.candidateNumber || 'Unnumbered candidate', 120)}`,
    `Package: ${SCOPE_LABELS[scope]}`,
    result?.submittedAt ? `Submitted: ${new Date(result.submittedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : '',
    result?.generatedAt ? `Prepared: ${new Date(result.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : '',
  ].filter(Boolean).join('\n'), { size: 9, lineHeight: 13, color: MUTED });

  questions.forEach((question, index) => {
    const ordinal = Number.isSafeInteger(Number(question?.ordinal))
      ? Number(question.ordinal)
      : index + 1;
    ensure(72);
    heading(`QUESTION ${ordinal}`, { size: 12, color: GOLD, gap: 6 });
    if (scope === 'questions_answers') {
      heading('Question', { size: 9, gap: 4 });
      body(question?.prompt, { maximum: MAX_PROMPT_CHARACTERS });
      heading('Submitted answer', { size: 9, gap: 4 });
      body(question?.answer, { maximum: MAX_ANSWER_CHARACTERS, emptyText: 'Unanswered' });
    } else if (scope === 'answers_only') {
      body(question?.answer, { maximum: MAX_ANSWER_CHARACTERS, emptyText: 'Unanswered' });
    } else {
      heading('Grade', { size: 9, gap: 4 });
      body(`${finiteNumber(question?.score)} / ${finiteNumber(question?.maximumPoints)}`);
      heading('Professor comment', { size: 9, gap: 4 });
      body(question?.comment || 'No comment recorded.', { maximum: MAX_COMMENT_CHARACTERS });
    }
    if (index + 1 < questions.length) {
      ensure(16);
      page.drawLine({
        start: { x: PAGE.margin, y: cursor },
        end: { x: PAGE.width - PAGE.margin, y: cursor },
        thickness: 0.6,
        color: RULE,
      });
      cursor -= 16;
    }
  });

  if (scope === 'grades_comments' && result?.totals) {
    ensure(48);
    heading('TOTAL', { size: 11, color: GOLD, gap: 4 });
    body(`${finiteNumber(result.totals.score)} / ${finiteNumber(result.totals.maximumPoints)}`, {
      size: 11,
      lineHeight: 15,
      color: NAVY,
    });
  }

  pages.forEach((entry, index) => {
    entry.drawLine({
      start: { x: PAGE.margin, y: 60 },
      end: { x: PAGE.width - PAGE.margin, y: 60 },
      thickness: 0.6,
      color: RULE,
    });
    entry.drawText('Confidential class examination record. Professor-authorized download.', {
      x: PAGE.margin,
      y: 43,
      size: 6.8,
      font,
      color: MUTED,
    });
    entry.drawText(`${index + 1} / ${pages.length}`, {
      x: PAGE.width - PAGE.margin - 30,
      y: 43,
      size: 7,
      font,
      color: NAVY,
    });
  });

  pdf.setTitle(`Due Diligence Examination Room - ${safeText(result?.examTitle, 200)}`);
  pdf.setAuthor('Due Diligence');
  pdf.setSubject(SCOPE_LABELS[scope]);
  pdf.setProducer('Due Diligence secure Worker');
  if (result?.generatedAt && !Number.isNaN(new Date(result.generatedAt).getTime())) {
    pdf.setCreationDate(new Date(result.generatedAt));
    pdf.setModificationDate(new Date(result.generatedAt));
  }
  const bytes = await pdf.save({ useObjectStreams: true });
  if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) {
    throw new DD2026ValidationError(
      'EXAM_ROOM_RESULT_EXPORT_TOO_LARGE',
      'This candidate result is too large to prepare as one PDF.',
      413,
    );
  }
  return bytes;
}

function slug(value, fallback) {
  return safeText(value, 200)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 70) || fallback;
}

export function examResultPdfFileName(result) {
  const exam = slug(result?.examTitle, 'examination');
  const candidate = slug(result?.candidateNumber, 'candidate');
  const scope = slug(result?.scope, 'result');
  return `due-diligence-${exam}-${candidate}-${scope}.pdf`;
}
