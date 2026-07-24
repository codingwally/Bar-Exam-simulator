import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCorpusPath = path.resolve(currentDir, '../content/labor-law-cms');
const requiredFiles = [
  'Questions.csv',
  'Suggested_Answers.csv',
  'Authorities.csv',
  'Doctrine_Cards.csv',
  'Question_Authorities.csv',
  'Rubric_Components.csv',
  'Question_Rubrics.csv',
  'Topics_Keywords.csv',
  'Review_Queue.csv',
  'Change_Log.csv',
];

const requiredHeaders = {
  'Questions.csv': ['question_id', 'subject', 'topic', 'source_type', 'bar_year', 'bar_item_no', 'essay_question', 'source_url', 'difficulty', 'content_status', 'last_updated', 'author', 'reviewer'],
  'Suggested_Answers.csv': ['answer_id', 'question_id', 'suggested_answer', 'answer_source_url', 'rights_note', 'content_status', 'last_updated', 'author', 'reviewer'],
  'Authorities.csv': ['authority_id', 'authority_type', 'citation', 'decision_date', 'source_url', 'pinpoint', 'authority_text', 'verification_status', 'last_updated', 'reviewer'],
  'Doctrine_Cards.csv': ['doctrine_id', 'authority_id', 'doctrine_text', 'source_pinpoint', 'verification_status', 'last_updated', 'reviewer'],
  'Question_Authorities.csv': ['question_id', 'authority_id', 'relationship', 'notes', 'content_status', 'last_updated', 'reviewer'],
  'Rubric_Components.csv': ['alac_component', 'maximum_points', 'description'],
  'Question_Rubrics.csv': ['question_id', 'alac_component', 'criterion_id', 'criterion_text', 'authority_id', 'maximum_points', 'expected_proposition', 'content_status', 'last_updated', 'reviewer'],
  'Topics_Keywords.csv': ['question_id', 'topic', 'important_legal_principles', 'keywords', 'content_status', 'last_updated', 'reviewer'],
  'Review_Queue.csv': ['review_id', 'question_id', 'issue_type', 'severity', 'description', 'proposed_resolution', 'status', 'submitted_by', 'assigned_to', 'submitted_at', 'resolved_at'],
  'Change_Log.csv': ['change_id', 'entity_type', 'entity_id', 'version', 'change_summary', 'changed_by', 'reviewed_by', 'changed_at', 'approval_status'],
};

export function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  if (quoted) throw new Error('CSV contains an unclosed quoted value.');
  return rows;
}

function readTable(rootPath, filename) {
  const absolutePath = path.join(rootPath, filename);
  if (!fs.existsSync(absolutePath)) return { headers: [], rows: [], missing: true };
  const matrix = parseCsv(fs.readFileSync(absolutePath, 'utf8'));
  const [headers = [], ...rows] = matrix;
  return {
    headers,
    missing: false,
    rows: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))),
  };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function hasValue(row, key) {
  return Boolean(String(row[key] ?? '').trim());
}

function valuesBy(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean));
}

function reportDuplicateValues(rows, key, filename, errors) {
  const seen = new Set();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    if (seen.has(value)) errors.push(`${filename}: duplicate ${key} '${value}'.`);
    seen.add(value);
  }
}

export function validateCorpus(rootPath = defaultCorpusPath, mode = 'template') {
  const errors = [];
  const warnings = [];
  const tables = {};

  for (const filename of requiredFiles) {
    const table = readTable(rootPath, filename);
    tables[filename] = table;
    if (table.missing) {
      errors.push(`Missing required file: ${filename}`);
      continue;
    }
    const absent = requiredHeaders[filename].filter((header) => !table.headers.includes(header));
    if (absent.length) errors.push(`${filename}: missing required column(s): ${absent.join(', ')}.`);
  }

  const questions = tables['Questions.csv']?.rows ?? [];
  const answers = tables['Suggested_Answers.csv']?.rows ?? [];
  const topics = tables['Topics_Keywords.csv']?.rows ?? [];
  const components = tables['Rubric_Components.csv']?.rows ?? [];
  const authorities = tables['Authorities.csv']?.rows ?? [];
  const doctrines = tables['Doctrine_Cards.csv']?.rows ?? [];
  const questionAuthorities = tables['Question_Authorities.csv']?.rows ?? [];
  const questionRubrics = tables['Question_Rubrics.csv']?.rows ?? [];

  if (questions.length !== 30) errors.push(`Questions.csv: expected exactly 30 Phase 1 Labor Law rows; found ${questions.length}.`);
  reportDuplicateValues(questions, 'question_id', 'Questions.csv', errors);
  reportDuplicateValues(answers, 'question_id', 'Suggested_Answers.csv', errors);
  reportDuplicateValues(authorities, 'authority_id', 'Authorities.csv', errors);
  reportDuplicateValues(doctrines, 'doctrine_id', 'Doctrine_Cards.csv', errors);

  const questionIds = valuesBy(questions, 'question_id');
  for (const question of questions) {
    if (!/^LABOR-\d{3}$/.test(question.question_id)) errors.push(`Questions.csv: '${question.question_id}' must use the LABOR-001 format.`);
    if (question.subject !== 'Labor Law and Social Legislation') errors.push(`Questions.csv: ${question.question_id} must retain the Phase 1 subject label.`);
    if (!hasValue(question, 'content_status')) errors.push(`Questions.csv: ${question.question_id} has no content_status.`);
  }

  const answerIds = valuesBy(answers, 'question_id');
  const topicIds = valuesBy(topics, 'question_id');
  for (const questionId of questionIds) {
    if (!answerIds.has(questionId)) errors.push(`Suggested_Answers.csv: missing row for ${questionId}.`);
    if (!topicIds.has(questionId)) errors.push(`Topics_Keywords.csv: missing row for ${questionId}.`);
  }

  const expectedComponents = new Map([['ANSWER', 20], ['LEGAL_BASIS', 30], ['APPLICATION', 30], ['CONCLUSION', 20]]);
  const componentTotal = components.reduce((total, row) => total + Number(row.maximum_points || 0), 0);
  if (components.length !== 4 || componentTotal !== 100) errors.push('Rubric_Components.csv: the four ALAC components must total exactly 100 points.');
  for (const [component, points] of expectedComponents) {
    const row = components.find((item) => item.alac_component === component);
    if (!row || Number(row.maximum_points) !== points) errors.push(`Rubric_Components.csv: ${component} must be ${points} points.`);
  }

  if (mode === 'template') {
    for (const question of questions) {
      if (question.content_status !== 'DRAFT') warnings.push(`Template: ${question.question_id} is expected to remain DRAFT until legally reviewed.`);
    }
    return { errors, warnings, stats: { questions: questions.length, answers: answers.length, authorities: authorities.length, mode } };
  }

  const authorityIds = valuesBy(authorities, 'authority_id');
  const doctrineAuthorityIds = valuesBy(doctrines, 'authority_id');
  const questionAuthorityIds = new Map();
  for (const row of questionAuthorities) {
    if (!questionIds.has(row.question_id)) errors.push(`Question_Authorities.csv: unknown question_id '${row.question_id}'.`);
    if (!authorityIds.has(row.authority_id)) errors.push(`Question_Authorities.csv: unknown authority_id '${row.authority_id}'.`);
    questionAuthorityIds.set(row.question_id, (questionAuthorityIds.get(row.question_id) ?? 0) + 1);
  }

  for (const question of questions) {
    const id = question.question_id;
    const mandatoryFields = ['topic', 'source_type', 'bar_year', 'bar_item_no', 'essay_question', 'source_url', 'difficulty', 'last_updated', 'author', 'reviewer'];
    for (const field of mandatoryFields) if (!hasValue(question, field)) errors.push(`Questions.csv: ${id} is missing ${field} for release.`);
    if (!['OFFICIAL_BAR', 'ADAPTED'].includes(question.source_type)) errors.push(`Questions.csv: ${id} must be OFFICIAL_BAR or ADAPTED for release.`);
    if (!/^https:\/\//.test(question.source_url)) errors.push(`Questions.csv: ${id} must have a HTTPS source_url.`);
    if (!isIsoDate(question.last_updated)) errors.push(`Questions.csv: ${id} last_updated must be YYYY-MM-DD.`);
    if (question.content_status !== 'APPROVED') errors.push(`Questions.csv: ${id} must be APPROVED for release.`);
    if (!questionAuthorityIds.get(id)) errors.push(`Question_Authorities.csv: ${id} needs at least one linked authority.`);

    const answer = answers.find((item) => item.question_id === id);
    if (!answer || !['suggested_answer', 'answer_source_url', 'rights_note', 'last_updated', 'author', 'reviewer'].every((field) => hasValue(answer ?? {}, field)) || answer.content_status !== 'APPROVED') {
      errors.push(`Suggested_Answers.csv: ${id} needs an APPROVED, sourced, reviewed answer for release.`);
    }

    const rubrics = questionRubrics.filter((item) => item.question_id === id && item.content_status === 'APPROVED');
    const byComponent = new Map(rubrics.map((item) => [item.alac_component, Number(item.maximum_points || 0)]));
    for (const [component, points] of expectedComponents) if (byComponent.get(component) !== points) errors.push(`Question_Rubrics.csv: ${id} must have approved ${component} criterion worth ${points} points.`);
    if ([...byComponent.values()].reduce((total, points) => total + points, 0) !== 100) errors.push(`Question_Rubrics.csv: ${id} approved rubric must total 100 points.`);
  }

  for (const authority of authorities) {
    const fields = ['authority_type', 'citation', 'source_url', 'pinpoint', 'authority_text', 'last_updated', 'reviewer'];
    for (const field of fields) if (!hasValue(authority, field)) errors.push(`Authorities.csv: ${authority.authority_id || '(missing ID)'} lacks ${field}.`);
    if (authority.verification_status !== 'VERIFIED') errors.push(`Authorities.csv: ${authority.authority_id} must be VERIFIED for release.`);
    if (!/^https:\/\//.test(authority.source_url)) errors.push(`Authorities.csv: ${authority.authority_id} requires a HTTPS source_url.`);
    if (!doctrineAuthorityIds.has(authority.authority_id)) errors.push(`Doctrine_Cards.csv: ${authority.authority_id} needs a verified doctrine card.`);
  }

  for (const doctrine of doctrines) {
    if (!authorityIds.has(doctrine.authority_id)) errors.push(`Doctrine_Cards.csv: unknown authority_id '${doctrine.authority_id}'.`);
    if (doctrine.verification_status !== 'VERIFIED') errors.push(`Doctrine_Cards.csv: ${doctrine.doctrine_id} must be VERIFIED for release.`);
  }

  return { errors, warnings, stats: { questions: questions.length, answers: answers.length, authorities: authorities.length, mode } };
}

function runCli() {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'template';
  if (!['template', 'release'].includes(mode)) throw new Error('--mode must be template or release.');
  const report = validateCorpus(defaultCorpusPath, mode);
  console.log(`Labor CMS validation (${report.stats.mode}): ${report.stats.questions} questions, ${report.stats.answers} answers, ${report.stats.authorities} authorities.`);
  for (const warning of report.warnings) console.warn(`WARN  ${warning}`);
  for (const error of report.errors) console.error(`ERROR ${error}`);
  if (report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
