import { parseCsv } from './examiner-core.mjs';
import {
  SUBJECT_MATTER_COURSES,
  SUBJECT_MATTER_EXPECTED,
  SUBJECT_MATTER_PLACEMENTS,
  SUBJECT_MATTER_PLACEMENT_MANIFEST_SHA256,
} from './subject-matter-placement-manifest.mjs';

export const WEBSITE_UPLOAD_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTnIYEQTEWRiQtphCLcbOz--qfS64p14RXKTM4bVcU62GGAViwuGXEjgnnRf1sZ5-_jOx9gJ9E4jyvj/pub?gid=141335489&single=true&output=csv';

export const SUBJECT_MATTER_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTnIYEQTEWRiQtphCLcbOz--qfS64p14RXKTM4bVcU62GGAViwuGXEjgnnRf1sZ5-_jOx9gJ9E4jyvj/pub?gid=1729202601&single=true&output=csv&range=A1%3AU1623';

export const MOCK_BAR_SUBJECTS = Object.freeze([
  'Political and Public International Law',
  'Labor Law',
  'Civil Law',
  'Taxation Law',
  'Commercial Law',
  'Criminal Law',
  'Remedial Law',
  'Legal and Judicial Ethics',
]);

export const BAR_FEELS_DESTINATIONS = Object.freeze([
  Object.freeze({
    destination: 'Political and Public International Law',
    pools: Object.freeze([
      Object.freeze({ subject: 'Political and Public International Law', count: 20 }),
    ]),
    mappingRationale:
      'Political and public-international-law questions remain within the official Political and Public International Law destination.',
  }),
  Object.freeze({
    destination: 'Commercial and Taxation Laws',
    pools: Object.freeze([
      Object.freeze({ subject: 'Commercial Law', count: 10 }),
      Object.freeze({ subject: 'Taxation Law', count: 10 }),
    ]),
    mappingRationale:
      'Commercial Law and Taxation Law are combined in the official Commercial and Taxation Laws Bar grouping, with equal source-bank representation.',
  }),
  Object.freeze({
    destination: 'Civil Law',
    pools: Object.freeze([
      Object.freeze({ subject: 'Civil Law', count: 20 }),
    ]),
    mappingRationale:
      'Civil Law questions remain within the official Civil Law destination.',
  }),
  Object.freeze({
    destination: 'Labor Law and Social Legislations',
    pools: Object.freeze([
      Object.freeze({ subject: 'Labor Law', count: 20 }),
    ]),
    mappingRationale:
      'Labor Law questions map directly to the official Labor Law and Social Legislations destination.',
  }),
  Object.freeze({
    destination: 'Criminal Law',
    pools: Object.freeze([
      Object.freeze({ subject: 'Criminal Law', count: 20 }),
    ]),
    mappingRationale:
      'Criminal Law questions remain within the official Criminal Law destination.',
  }),
  Object.freeze({
    destination: 'Remedial Law, Legal and Judicial Ethics',
    pools: Object.freeze([
      Object.freeze({ subject: 'Remedial Law', count: 10 }),
      Object.freeze({ subject: 'Legal and Judicial Ethics', count: 10 }),
    ]),
    mappingRationale:
      'Remedial Law and Legal and Judicial Ethics are combined in the official final-day destination, with equal source-bank representation.',
  }),
]);

export class ReleaseContentError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'ReleaseContentError';
    this.code = code;
    this.status = status;
  }
}

function preserveText(value, maximum = 100_000) {
  const text = String(value ?? '').replace(/\u0000/g, '').replace(/\r\n/g, '\n');
  if (text.length > maximum) {
    throw new ReleaseContentError(
      'PUBLISHED_SOURCE_FIELD_TOO_LONG',
      'A source field exceeds the supported publication length.',
    );
  }
  return text.trim();
}

function rowsFromCsv(csvText) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex(
    (row) => preserveText(row[0]).replace(/^\uFEFF/, '').toLowerCase() === 'question id',
  );
  if (headerIndex < 0) {
    throw new ReleaseContentError(
      'PUBLISHED_SOURCE_HEADER_MISSING',
      'The published question source is missing its header.',
    );
  }
  const headers = rows[headerIndex].map((header) => preserveText(header, 500));
  const expected = [
    'Question ID',
    'Subject',
    'Topic',
    'Bar Year',
    'Question No.',
    'Essay Question',
    'Suggested Answer',
    'Legal Basis / Provision',
    'Controlling Doctrine',
    'Jurisprudence / Case',
    'Citation / G.R. No.',
    'Source URL',
    'Difficulty',
    'Editorial Status',
    'Version',
    'Assigned Reviewer',
    'Last Reviewed',
    'Publication Ready?',
    'Notes',
    'Feedback Count',
    'Open Feedback',
  ];
  if (expected.some((header, index) => headers[index] !== header)) {
    throw new ReleaseContentError(
      'PUBLISHED_SOURCE_SCHEMA_MISMATCH',
      'The published question source columns do not match the reviewed A:U schema.',
    );
  }
  return rows
    .slice(headerIndex + 1)
    .map((cells, offset) => ({
      rowNumber: headerIndex + offset + 2,
      row: Object.fromEntries(
        headers.map((header, index) => [header, preserveText(cells[index])]),
      ),
    }))
    .filter(({ row }) => Object.values(row).some(Boolean));
}

function extractUrls(sourceText) {
  const matches = preserveText(sourceText).match(/https:\/\/[^\s;,]+/gi) || [];
  return [...new Set(matches.map((value) => value.replace(/[.)\]}]+$/, '')))]
    .map((url, index) => ({
      title: index === 0 ? 'Primary legal source' : `Supporting legal source ${index + 1}`,
      url,
      type: /(?:elibrary|sc\.judiciary|officialgazette|dole|congress|senate)\./i.test(url)
        ? 'primary'
        : 'stored',
    }));
}

function parseAlac(answer) {
  const source = preserveText(answer);
  const headings = [
    ['answer', /(?:^|\n)\s*(?:I\.\s*)?Answer\s*:\s*/i],
    ['legalBasis', /(?:^|\n)\s*(?:II\.\s*)?Legal Basis\s*:\s*/i],
    ['application', /(?:^|\n)\s*(?:III\.\s*)?Application\s*:\s*/i],
    ['conclusion', /(?:^|\n)\s*(?:IV\.\s*)?Conclusion\s*:\s*/i],
  ];
  const positions = headings
    .map(([key, pattern]) => {
      const match = pattern.exec(source);
      return match ? { key, start: match.index, contentStart: match.index + match[0].length } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  const result = {};
  positions.forEach((current, index) => {
    result[current.key] = source
      .slice(current.contentStart, positions[index + 1]?.start ?? source.length)
      .trim();
  });
  return result;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function inferAcademicPlacement(row) {
  const id = preserveText(row['Question ID']);
  const topic = preserveText(row.Topic);
  const idMatch = id.match(/LEB-Y(\d)T(\d)-([A-Z]{2,8}\d{2,4})/i);
  const topicMatch = topic.match(/Year\s*(\d).*?Term\s*(\d).*?([A-Z]{2,8}\d{2,4})/i);
  return {
    yearLevel: Number(idMatch?.[1] || topicMatch?.[1] || 1),
    term: Number(idMatch?.[2] || topicMatch?.[2] || 1),
    courseCode: preserveText(idMatch?.[3] || topicMatch?.[3] || ''),
  };
}

async function normalizeSourceRow(row, rowNumber) {
  const questionId = preserveText(row['Question ID'], 200);
  const subject = preserveText(row.Subject, 500);
  const prompt = preserveText(row['Essay Question']);
  const suggestedAnswer = preserveText(row['Suggested Answer']);
  const legalBasis = preserveText(row['Legal Basis / Provision']);
  if (!questionId || !subject || !prompt || !suggestedAnswer || !legalBasis) {
    throw new ReleaseContentError(
      'PUBLISHED_SOURCE_ROW_INCOMPLETE',
      `Published source row ${rowNumber} is missing substantive content.`,
    );
  }
  const placement = inferAcademicPlacement(row);
  const alac = parseAlac(suggestedAnswer);
  const sourceUrlText = preserveText(row['Source URL']);
  const normalized = {
    questionId,
    subject,
    topic: preserveText(row.Topic),
    barYear: preserveText(row['Bar Year'], 20),
    questionNumber: preserveText(row['Question No.'], 120),
    prompt,
    suggestedAnswer,
    legalBasis,
    doctrine: preserveText(row['Controlling Doctrine']),
    jurisprudence: [{
      case: preserveText(row['Jurisprudence / Case']),
      citation: preserveText(row['Citation / G.R. No.']),
    }].filter((item) => item.case || item.citation),
    citation: preserveText(row['Citation / G.R. No.']),
    sourceUrlText,
    sourceUrls: extractUrls(sourceUrlText),
    difficulty: preserveText(row.Difficulty, 120),
    editorialStatus: preserveText(row['Editorial Status'], 120),
    version: preserveText(row.Version, 120),
    lastUpdated: preserveText(row['Last Reviewed'], 120),
    publicationReady: preserveText(row['Publication Ready?'], 120),
    sheetRow: rowNumber,
    sheetRange: `A${rowNumber}:U${rowNumber}`,
    ...placement,
    alac,
  };
  normalized.contentHash = await sha256([
    normalized.questionId,
    normalized.subject,
    normalized.topic,
    normalized.barYear,
    normalized.questionNumber,
    normalized.prompt,
    normalized.suggestedAnswer,
    normalized.legalBasis,
    normalized.doctrine,
    JSON.stringify(normalized.jurisprudence),
    normalized.citation,
    normalized.sourceUrlText,
  ].join('\n'));
  return normalized;
}

function stableRank(seed, id) {
  let hash = 2166136261;
  const source = `${seed}:${id}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function parseSubjectMatterSource(csvText) {
  const sourceRows = rowsFromCsv(csvText);
  const seen = new Set();
  const rows = [];
  for (const { row, rowNumber } of sourceRows) {
    const normalized = await normalizeSourceRow(row, rowNumber);
    if (seen.has(normalized.questionId)) {
      throw new ReleaseContentError(
        'PUBLISHED_SOURCE_DUPLICATE_ID',
        `The Subject Matter source repeats ${normalized.questionId}.`,
      );
    }
    seen.add(normalized.questionId);
    rows.push(normalized);
  }
  if (rows.length !== SUBJECT_MATTER_EXPECTED.destinationRows) {
    throw new ReleaseContentError(
      'SUBJECT_MATTER_COUNT_MISMATCH',
      `The Subject Matter source contains ${rows.length} rows; ${SUBJECT_MATTER_EXPECTED.destinationRows} are required.`,
    );
  }
  return {
    rows,
    digest: await sha256(csvText),
    subjectCount: new Set(rows.map((row) => row.subject)).size,
  };
}

export function buildSubjectMatterPlacements(rows) {
  if (!Array.isArray(rows) || rows.length !== SUBJECT_MATTER_EXPECTED.destinationRows) {
    throw new ReleaseContentError(
      'SUBJECT_MATTER_PLACEMENT_SOURCE_INVALID',
      'The Subject Matter placement manifest requires the complete canonical destination bank.',
    );
  }

  const sourceById = new Map(rows.map((row) => [row.questionId, row]));
  const courseByCode = new Map(SUBJECT_MATTER_COURSES.map((course) => [course.code, course]));
  const slotKeys = new Set();
  const courseQuestionKeys = new Set();
  const canonicalCounts = new Map();
  const courseCounts = new Map();
  const courseDifficultyCounts = new Map();
  const placements = SUBJECT_MATTER_PLACEMENTS.map((entry) => {
    const [courseCode, slot, questionId, feederSubject, difficulty, placementType] = entry;
    const course = courseByCode.get(courseCode);
    const source = sourceById.get(questionId);
    if (!course || !source) {
      throw new ReleaseContentError(
        'SUBJECT_MATTER_PLACEMENT_REFERENCE_INVALID',
        `The Subject Matter placement manifest references an unknown course or canonical question (${courseCode}/${questionId}).`,
      );
    }
    if (!Number.isInteger(slot) || slot < 1 || slot > course.target) {
      throw new ReleaseContentError(
        'SUBJECT_MATTER_PLACEMENT_SLOT_INVALID',
        `The Subject Matter placement slot is invalid (${courseCode}/${slot}).`,
      );
    }
    if (!['direct', 'integration'].includes(placementType)
        || !['Easy', 'Medium', 'Hard'].includes(difficulty)) {
      throw new ReleaseContentError(
        'SUBJECT_MATTER_PLACEMENT_CLASSIFICATION_INVALID',
        `The Subject Matter placement classification is invalid (${courseCode}/${slot}).`,
      );
    }
    const slotKey = `${courseCode}:${slot}`;
    const courseQuestionKey = `${courseCode}:${questionId}`;
    if (slotKeys.has(slotKey) || courseQuestionKeys.has(courseQuestionKey)) {
      throw new ReleaseContentError(
        'SUBJECT_MATTER_PLACEMENT_DUPLICATE',
        `The Subject Matter placement manifest repeats a slot or course question (${courseCode}/${slot}).`,
      );
    }
    slotKeys.add(slotKey);
    courseQuestionKeys.add(courseQuestionKey);
    canonicalCounts.set(questionId, (canonicalCounts.get(questionId) || 0) + 1);
    courseCounts.set(courseCode, (courseCounts.get(courseCode) || 0) + 1);
    const difficultyKey = `${courseCode}:${difficulty}`;
    courseDifficultyCounts.set(
      difficultyKey,
      (courseDifficultyCounts.get(difficultyKey) || 0) + 1,
    );
    return {
      courseCode,
      courseName: course.name,
      yearLevel: course.year,
      term: course.term,
      classification: course.classification,
      slot,
      questionId,
      feederSubject,
      difficulty,
      placementType,
      sourceContentHash: source.contentHash,
    };
  });

  const directCount = placements.filter((placement) => placement.placementType === 'direct').length;
  const integrationCount = placements.length - directCount;
  const reused = [...canonicalCounts.values()].filter((count) => count === 2).length;
  if (placements.length !== SUBJECT_MATTER_EXPECTED.placements
      || directCount !== SUBJECT_MATTER_EXPECTED.directPlacements
      || integrationCount !== SUBJECT_MATTER_EXPECTED.integrationPlacements
      || canonicalCounts.size !== SUBJECT_MATTER_EXPECTED.canonicalQuestions
      || reused !== SUBJECT_MATTER_EXPECTED.integrationPlacements
      || Math.max(...canonicalCounts.values()) !== 2) {
    throw new ReleaseContentError(
      'SUBJECT_MATTER_PLACEMENT_TOTAL_INVALID',
      'The Subject Matter placement manifest does not satisfy the reviewed direct/integration totals.',
    );
  }

  for (const course of SUBJECT_MATTER_COURSES) {
    if (courseCounts.get(course.code) !== course.target
        || Object.entries(course.difficulty).some(([difficulty, count]) => (
          courseDifficultyCounts.get(`${course.code}:${difficulty}`) !== count
        ))) {
      throw new ReleaseContentError(
        'SUBJECT_MATTER_COURSE_ALLOCATION_INVALID',
        `The Subject Matter placement allocation is invalid for ${course.code}.`,
      );
    }
  }

  return {
    placements,
    courses: SUBJECT_MATTER_COURSES,
    digest: SUBJECT_MATTER_PLACEMENT_MANIFEST_SHA256,
  };
}

export async function parseWebsiteUploadSource(csvText) {
  const sourceRows = rowsFromCsv(csvText);
  const seen = new Set();
  const rows = [];
  for (const { row, rowNumber } of sourceRows) {
    const normalized = await normalizeSourceRow(row, rowNumber);
    if (seen.has(normalized.questionId)) {
      throw new ReleaseContentError(
        'PUBLISHED_SOURCE_DUPLICATE_ID',
        `The Mock Bar source repeats ${normalized.questionId}.`,
      );
    }
    seen.add(normalized.questionId);
    rows.push(normalized);
  }
  if (rows.length !== 320) {
    throw new ReleaseContentError(
      'MOCK_BAR_COUNT_MISMATCH',
      `The Mock Bar source contains ${rows.length} rows; 320 are required.`,
    );
  }
  const counts = Object.fromEntries(
    MOCK_BAR_SUBJECTS.map((subject) => [
      subject,
      rows.filter((row) => row.subject === subject).length,
    ]),
  );
  if (Object.values(counts).some((count) => count !== 40)) {
    throw new ReleaseContentError(
      'MOCK_BAR_SUBJECT_COUNT_MISMATCH',
      'Every Mock Bar source subject must contain exactly 40 questions.',
    );
  }
  return { rows, counts, digest: await sha256(csvText) };
}

export function buildBarFeelsManifest(rows, seed = 'duediligence-bar-feels-20260730') {
  const assigned = new Set();
  const groups = BAR_FEELS_DESTINATIONS.map((definition) => {
    const selected = definition.pools.flatMap(({ subject, count }) => {
      const pool = rows
        .filter((row) => row.subject === subject)
        .sort((left, right) => (
          stableRank(seed, left.questionId) - stableRank(seed, right.questionId)
          || left.questionId.localeCompare(right.questionId)
        ))
        .slice(0, count);
      if (pool.length !== count) {
        throw new ReleaseContentError(
          'BAR_FEELS_POOL_INCOMPLETE',
          `${subject} cannot supply ${count} unique questions.`,
        );
      }
      return pool;
    });
    selected.forEach((row) => {
      if (assigned.has(row.questionId)) {
        throw new ReleaseContentError(
          'BAR_FEELS_DUPLICATE_ASSIGNMENT',
          `Bar Feels repeats ${row.questionId}.`,
        );
      }
      assigned.add(row.questionId);
    });
    return {
      destination: definition.destination,
      mappingRationale: definition.mappingRationale,
      rows: selected,
    };
  });
  if (assigned.size !== 120 || groups.some((group) => group.rows.length !== 20)) {
    throw new ReleaseContentError(
      'BAR_FEELS_MANIFEST_INVALID',
      'The Bar Feels manifest must contain six groups of twenty unique questions.',
    );
  }
  return groups;
}
