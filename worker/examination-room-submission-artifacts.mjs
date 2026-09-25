import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';

const BUCKET = 'examination-room-submissions';
const PREFIX = 'v1';
const MIME = 'application/pdf';
const MAX_PDF_BYTES = 8 * 1024 * 1024;

function clean(value, maximum = 20_000, fallback = '') {
  const text = String(value ?? fallback).replace(/\r\n?/gu, '\n').trim();
  return text.slice(0, maximum) || fallback;
}

function safeSegment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{16,80}$/u.test(normalized)) throw new TypeError('invalid submission artifact identifier');
  return normalized;
}

function fontBytes() {
  const binary = atob(notoSansBase64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function submissionQuestions(context) {
  const manifest = context?.submissionManifest && typeof context.submissionManifest === 'object'
    ? context.submissionManifest
    : {};
  return Array.isArray(manifest.questions) ? manifest.questions.slice(0, 200) : [];
}

function answerDisplay(question) {
  const answer = question?.answer;
  if (answer === null || answer === undefined || answer === '') return 'Unanswered';
  if (question?.type === 'multiple-choice' && Number.isSafeInteger(Number(answer))) {
    const choice = Array.isArray(question?.choices) ? question.choices[Number(answer)] : null;
    if (choice !== null && choice !== undefined) return String(choice);
  }
  if (Array.isArray(answer)) return answer.map(String).join(', ');
  return String(answer);
}

function wrap(font, value, size, maximumWidth) {
  const paragraphs = clean(value, 80_000).split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/u).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maximumWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= maximumWidth) {
        line = word;
        continue;
      }
      let fragment = '';
      for (const character of [...word]) {
        const next = fragment + character;
        if (fragment && font.widthOfTextAtSize(next, size) > maximumWidth) {
          lines.push(fragment);
          fragment = character;
        } else {
          fragment = next;
        }
      }
      line = fragment;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function formatTime(value) {
  const parsed = new Date(String(value || ''));
  if (!Number.isFinite(parsed.getTime())) return clean(value, 80, 'Not available');
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Manila',
  }).format(parsed);
}

export function examinationRoomSubmissionPdfObjectKey(context) {
  return [
    PREFIX,
    safeSegment(context?.institutionId),
    safeSegment(context?.examId),
    safeSegment(context?.submissionId),
    'questions-and-answers.pdf',
  ].join('/');
}

export async function buildExaminationRoomSubmissionPdf(context) {
  const manifest = context?.submissionManifest && typeof context.submissionManifest === 'object'
    ? context.submissionManifest
    : {};
  const questions = submissionQuestions(context);
  if (!questions.length) throw new TypeError('submission has no questions');

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes(), { subset: true });
  const bold = font;
  pdf.setTitle(`${clean(manifest.title, 200, 'Examination')} - Questions and Answers`);
  pdf.setSubject(clean(context?.subject || manifest.subject, 200, 'Examination submission'));
  pdf.setCreator('Due Diligence Examination Room');
  pdf.setProducer('Due Diligence Examination Room');

  const pageSize = [595.28, 841.89];
  const margin = 48;
  const contentWidth = pageSize[0] - margin * 2;
  const navy = rgb(7 / 255, 24 / 255, 47 / 255);
  const slate = rgb(54 / 255, 65 / 255, 82 / 255);
  const muted = rgb(96 / 255, 108 / 255, 126 / 255);
  const gold = rgb(184 / 255, 147 / 255, 79 / 255);
  const rule = rgb(220 / 255, 224 / 255, 230 / 255);

  let page;
  let y;
  const newPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText('DUE DILIGENCE · EXAMINATION ROOM', {
      x: margin, y, size: 9, font: bold, color: gold,
    });
    y -= 22;
  };
  const ensure = (height = 24) => {
    if (!page || y - height < 54) newPage();
  };
  const drawText = (value, options = {}) => {
    const size = Number(options.size || 10);
    const leading = Number(options.leading || Math.max(13, size * 1.38));
    const color = options.color || slate;
    const x = Number(options.x || margin);
    const width = Number(options.width || (pageSize[0] - margin - x));
    const lines = wrap(options.font || font, value, size, width);
    for (const line of lines) {
      ensure(leading + 2);
      if (line) page.drawText(line, { x, y, size, font: options.font || font, color });
      y -= leading;
    }
    y -= Number(options.after || 0);
  };
  const drawRule = () => {
    ensure(14);
    page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: 0.7, color: rule });
    y -= 14;
  };

  newPage();
  drawText(clean(manifest.title, 300, 'Examination'), { size: 20, leading: 25, color: navy, after: 4 });
  drawText('Questions and submitted answers', { size: 13, leading: 18, color: navy, after: 8 });
  drawText(`Student: ${clean(context?.studentName, 200, 'Not provided')}`, { size: 10 });
  drawText(`Student number: ${clean(context?.studentNumber, 80, 'Not provided')}`, { size: 10 });
  drawText(`Student email: ${clean(context?.studentEmail, 320, 'Not provided')}`, { size: 10 });
  drawText(`Subject: ${clean(context?.subject || manifest.subject, 200, 'Not provided')}`, { size: 10 });
  drawText(`Submitted: ${formatTime(context?.submittedAt)}`, { size: 10 });
  drawText(`Receipt: ${clean(context?.receiptCode, 100, 'Not available')}`, { size: 10 });
  drawText(`Submission ID: ${clean(context?.submissionId, 100, 'Not available')}`, { size: 9, color: muted, after: 8 });
  drawText('Private education record. Store and transmit securely.', { size: 8.5, color: muted, after: 8 });
  drawRule();

  questions.forEach((question, index) => {
    ensure(90);
    const number = Number(question?.questionNumber || index + 1);
    const points = Number(question?.maxPoints ?? question?.points ?? 0);
    drawText(`QUESTION ${number}${Number.isFinite(points) && points > 0 ? ` · ${points} point${points === 1 ? '' : 's'}` : ''}`, {
      size: 11, leading: 16, color: navy, after: 4,
    });
    drawText(clean(question?.prompt, 60_000, 'Question prompt unavailable.'), {
      size: 10, leading: 14.5, color: slate, after: 7,
    });
    drawText('SUBMITTED ANSWER', { size: 9, leading: 13, color: gold, after: 3 });
    drawText(clean(answerDisplay(question), 80_000, 'Unanswered'), {
      size: 10, leading: 14.5, x: margin + 12, width: contentWidth - 12, color: slate, after: 7,
    });
    drawRule();
  });

  const bytes = new Uint8Array(await pdf.save({ useObjectStreams: false }));
  if (bytes.byteLength > MAX_PDF_BYTES) throw new TypeError('submission PDF exceeds storage limit');
  return bytes;
}

function storageConfiguration(env) {
  const baseUrl = String(env?.SUPABASE_URL || '').trim().replace(/\/+$/u, '');
  const serviceKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https:\/\/[^/]+$/u.test(baseUrl) || !serviceKey) throw new TypeError('submission PDF storage is not configured');
  return {
    baseUrl,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
    },
  };
}

function encodedPath(value) {
  return String(value).split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function storageObject(env, context, { method = 'GET', body = null } = {}) {
  const config = storageConfiguration(env);
  const key = examinationRoomSubmissionPdfObjectKey(context);
  const url = `${config.baseUrl}/storage/v1/object/${method === 'GET' ? 'authenticated/' : ''}${encodeURIComponent(BUCKET)}/${encodedPath(key)}`;
  const response = await fetch(url, {
    method,
    headers: {
      ...config.headers,
      ...(method === 'GET' ? {} : {
        'content-type': MIME,
        'cache-control': 'private, no-store',
        'x-upsert': 'true',
      }),
    },
    ...(body ? { body } : {}),
  });
  return { response, key };
}

export async function storeExaminationRoomSubmissionPdf(env, context, bytes) {
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { response, key } = await storageObject(env, context, { method: 'POST', body: payload });
  if (!response.ok) throw new TypeError(`submission PDF upload failed (${response.status})`);
  return { objectKey: key, size: payload.byteLength, contentType: MIME };
}

export async function loadExaminationRoomSubmissionPdf(env, context) {
  const { response, key } = await storageObject(env, context);
  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok) throw new TypeError(`submission PDF read failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 5 || bytes.byteLength > MAX_PDF_BYTES) throw new TypeError('stored submission PDF is invalid');
  return { objectKey: key, size: bytes.byteLength, contentType: MIME, bytes };
}

export async function ensureExaminationRoomSubmissionPdf(env, context) {
  const existing = await loadExaminationRoomSubmissionPdf(env, context).catch(() => null);
  if (existing) return { ...existing, created: false };
  const bytes = await buildExaminationRoomSubmissionPdf(context);
  const stored = await storeExaminationRoomSubmissionPdf(env, context, bytes);
  return { ...stored, bytes, created: true };
}

export function examinationRoomSubmissionPdfFilename(context) {
  const student = clean(context?.studentName, 120, 'student')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase() || 'student';
  return `${student}-questions-and-answers.pdf`;
}

export function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < source.length; offset += 0x8000) {
    binary += String.fromCharCode(...source.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export const EXAMINATION_ROOM_SUBMISSION_PDF_BUCKET = BUCKET;
