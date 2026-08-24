(function attachWebsiteQuestionBank(global) {
  'use strict';

  const SUBJECT_ALIASES = Object.freeze({
    'Political and Public International Law': 'Political Law',
    'Labor Law': 'Labor Law',
    'Civil Law': 'Civil Law',
    'Taxation Law': 'Taxation Law',
    'Commercial Law': 'Mercantile Law',
    'Criminal Law': 'Criminal Law',
    'Remedial Law': 'Remedial Law',
    'Legal and Judicial Ethics': 'Legal Ethics',
  });
  const MINIMUM_RECORDS = 320;
  const MAXIMUM_RECORDS = 10000;
  const MINIMUM_PER_SUBJECT = 40;

  function text(value) {
    return String(value ?? '')
      .replace(/\s*\(noun\)/gi, '')
      .replace(/[ \t]+([,.;:!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ');
  }

  function firstELibraryUrl(record) {
    const combined = `${text(record['Legal Basis / Provision'])}\n${text(record['Source URL'])}`;
    return combined.match(/https:\/\/elibrary\.judiciary\.gov\.ph[^\s;,)]*/i)?.[0] || '';
  }

  function toQuestion(record) {
    const sourceSubject = text(record.Subject);
    const subject = SUBJECT_ALIASES[sourceSubject];
    if (!subject) return null;
    const jurisprudence = text(record['Jurisprudence / Case']);
    const citation = text(record['Citation / G.R. No.']);
    return {
      id: text(record['Question ID']),
      subject,
      sourceSubject,
      topic: text(record.Topic),
      bar_year: text(record['Bar Year']),
      question_no: text(record['Question No.']),
      text: text(record['Essay Question']),
      model: text(record['Suggested Answer']),
      legalBasis: text(record['Legal Basis / Provision']),
      controllingDoctrine: text(record['Controlling Doctrine']),
      caseLaw: [jurisprudence, citation].filter(Boolean).join(', '),
      caseName: jurisprudence,
      caseCitation: citation,
      sourceTitle: [jurisprudence, citation].filter(Boolean).join(', '),
      sourceUrl: firstELibraryUrl(record),
      verified: false,
      difficulty: text(record.Difficulty),
      version: text(record.Version),
      lastReviewed: text(record['Last Reviewed']),
      editorialStatus: text(record['Editorial Status']),
      publicationReady: text(record['Publication Ready?']),
      notes: text(record.Notes),
      rawRecord: Object.freeze({ ...record }),
    };
  }

  async function load(url = 'content/question-bank/website-upload.json') {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Question bank request failed with HTTP ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload.records)
        || payload.records.length < MINIMUM_RECORDS
        || payload.records.length > MAXIMUM_RECORDS) {
      throw new Error(`The website question bank must contain ${MINIMUM_RECORDS} to ${MAXIMUM_RECORDS} records.`);
    }
    const bySubject = Object.fromEntries(
      Object.values(SUBJECT_ALIASES).map((subject) => [subject, []]),
    );
    const seenIds = new Set();
    for (const record of payload.records) {
      const question = toQuestion(record);
      if (!question || !question.id || seenIds.has(question.id)) {
        throw new Error(`Invalid or duplicate website question: ${question?.id || '(missing ID)'}.`);
      }
      seenIds.add(question.id);
      bySubject[question.subject].push(question);
    }
    for (const [subject, questions] of Object.entries(bySubject)) {
      if (questions.length < MINIMUM_PER_SUBJECT) {
        throw new Error(`${subject} must contain at least ${MINIMUM_PER_SUBJECT} approved questions.`);
      }
    }
    return Object.freeze({ payload, bySubject });
  }

  global.DueDiligenceWebsiteQuestionBank = Object.freeze({
    SUBJECT_ALIASES,
    load,
    toQuestion,
  });
}(window));
