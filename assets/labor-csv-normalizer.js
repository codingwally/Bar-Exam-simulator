/* Normalizes the published Labor Law question bank without changing the trainer UI. */
(function attachLaborCsvNormalizer(global) {
  'use strict';

  function text(value) {
    return String(value ?? '').trim();
  }

  function normalizeHeader(value) {
    return text(value).replace(/^\uFEFF/, '').toLowerCase().replace(/\s+/g, ' ');
  }

  function toQuestion(record) {
    const id = text(record['Question ID']);
    const subject = text(record.Subject);
    const prompt = text(record['Essay Question']);
    const suggestedAnswer = text(record['Suggested Answer']);
    if (!/^LAB-\d{3}$/.test(id) || subject !== 'Labor Law' || !prompt || !suggestedAnswer) return null;

    const jurisprudence = text(record['Jurisprudence / Case']);
    const citation = text(record['Citation / G.R. No.']);
    return {
      id,
      subject,
      topic: text(record.Topic),
      bar_year: text(record['Bar Year']),
      question_no: text(record['Question No.']),
      text: prompt,
      model: suggestedAnswer,
      legalBasis: text(record['Legal Basis / Provision']),
      controllingDoctrine: text(record['Controlling Doctrine']),
      caseLaw: [jurisprudence, citation].filter(Boolean).join(', '),
      sourceUrl: text(record['Source URL']),
      difficulty: text(record.Difficulty),
      version: text(record.Version),
      lastReviewed: text(record['Last Reviewed']),
    };
  }

  function parseRows(rows) {
    if (!Array.isArray(rows)) throw new Error('Labor Law CSV did not contain rows.');
    const headerIndex = rows.findIndex((row) => normalizeHeader(row?.[0]) === 'question id');
    if (headerIndex < 0) throw new Error('Labor Law CSV header row was not found.');

    const headers = rows[headerIndex].map((header) => text(header));
    const questions = [];
    const invalidRows = [];
    const seenIds = new Set();

    rows.slice(headerIndex + 1).forEach((cells, offset) => {
      if (!Array.isArray(cells) || cells.every((cell) => !text(cell))) return;
      const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
      const question = toQuestion(record);
      if (!question) {
        invalidRows.push({ row: headerIndex + offset + 2, reason: 'Missing required Labor Law fields.' });
        return;
      }
      if (seenIds.has(question.id)) {
        invalidRows.push({ row: headerIndex + offset + 2, reason: `Duplicate Question ID ${question.id}.` });
        return;
      }
      seenIds.add(question.id);
      questions.push(question);
    });

    questions.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
    return { headerIndex, questions, invalidRows };
  }

  global.DueDiligenceLaborCsv = Object.freeze({ parseRows });
}(window));
