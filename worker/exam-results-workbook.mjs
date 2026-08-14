const encoder = new TextEncoder();
const EXCEL_CELL_TEXT_LIMIT = 32_760;
const MAX_WORKBOOK_TEXT_CHARACTERS = 8_000_000;
const MAX_WORKBOOK_DETAIL_CELLS = 50_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const checksum = crc32(data);
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localParts.push(local, name, data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, offset, true);
  return concatBytes([...localParts, centralDirectory, end]);
}

function columnName(index) {
  let value = index;
  let output = '';
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function cellRef(row, column) {
  return `${columnName(column)}${row}`;
}

function safeText(value) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function splitCellText(value) {
  const characters = Array.from(String(value ?? ''));
  if (characters.length > EXCEL_CELL_TEXT_LIMIT * 2) {
    throw new Error('EXAM_ROOM_CLASS_WORKBOOK_CELL_TOO_LONG');
  }
  return [
    characters.slice(0, EXCEL_CELL_TEXT_LIMIT).join(''),
    characters.slice(EXCEL_CELL_TEXT_LIMIT).join(''),
  ];
}

function cellXml(value, row, column, style = 4, formula = null) {
  const reference = cellRef(row, column);
  if (formula) {
    const cached = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `<c r="${reference}" s="${style}"><f>${xml(formula)}</f><v>${cached}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(safeText(value))}</t></is></c>`;
}

function rowXml(rowNumber, cells, options = {}) {
  // Let Excel auto-fit long Professor questions and student answers. Explicit
  // compact heights remain useful for titles and headers only.
  const fixedHeight = options.height && Number(options.height) < 30 ? options.height : null;
  const height = fixedHeight ? ` ht="${fixedHeight}" customHeight="1"` : '';
  return `<row r="${rowNumber}"${height}>${cells.map((cell, index) => (
    cellXml(cell.value, rowNumber, index + 1, cell.style ?? 4, cell.formula)
  )).join('')}</row>`;
}

function normalizedCandidates(dataset) {
  return (Array.isArray(dataset?.candidates) ? dataset.candidates : []).map((candidate) => ({
    ...candidate,
    questions: Array.isArray(candidate?.questions)
      ? [...candidate.questions].sort((left, right) => Number(left?.ordinal) - Number(right?.ordinal))
      : [],
  }));
}

function normalizedExamQuestions(dataset) {
  return (Array.isArray(dataset?.questions) ? dataset.questions : [])
    .map((question) => ({
      ...question,
      ordinal: Number(question?.ordinal),
      prompt: String(question?.prompt || question?.promptText || ''),
      maximumPoints: number(question?.maximumPoints),
    }))
    .filter((question) => Number.isInteger(question.ordinal) && question.ordinal > 0 && question.prompt)
    .sort((left, right) => left.ordinal - right.ordinal);
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function percentage(score, maximum) {
  return maximum > 0 ? (score / maximum) : 0;
}

function classResultRows(dataset, candidates) {
  const questions = normalizedExamQuestions(dataset);
  const remaining = new Map();
  for (const candidate of candidates) {
    const candidateKey = String(candidate.candidateNumber || '').trim().toLowerCase();
    const emailKey = String(candidate.studentEmail || '').trim().toLowerCase();
    if (candidateKey) remaining.set(`candidate:${candidateKey}`, candidate);
    if (emailKey) remaining.set(`email:${emailKey}`, candidate);
  }

  const rows = (Array.isArray(dataset?.classStatuses) ? dataset.classStatuses : []).map((status) => {
    const candidateKey = String(status?.candidateNumber || '').trim().toLowerCase();
    const emailKey = String(status?.studentEmail || '').trim().toLowerCase();
    const candidate = (candidateKey && remaining.get(`candidate:${candidateKey}`))
      || (emailKey && remaining.get(`email:${emailKey}`)) || null;
    if (candidate) {
      if (candidateKey) remaining.delete(`candidate:${candidateKey}`);
      const candidateEmailKey = String(candidate.studentEmail || '').trim().toLowerCase();
      const candidateNumberKey = String(candidate.candidateNumber || '').trim().toLowerCase();
      if (candidateEmailKey) remaining.delete(`email:${candidateEmailKey}`);
      if (candidateNumberKey) remaining.delete(`candidate:${candidateNumberKey}`);
      return { ...status, ...candidate, detailsSelected: true };
    }
    return {
      ...status,
      detailsSelected: false,
      allGradesFinal: false,
      unansweredCount: null,
      incidentCount: null,
      questions: questions.map((question) => ({
        ...question,
        answer: '',
        score: null,
        gradeState: 'not_started',
        comment: '',
      })),
    };
  });

  const includedCandidates = new Set(rows.filter((row) => row?.attemptId).map((row) => row.attemptId));
  for (const candidate of candidates) {
    if (!includedCandidates.has(candidate.attemptId)) rows.push({ ...candidate, detailsSelected: true });
  }
  return rows;
}

function candidateTotals(candidate) {
  const gradedQuestions = candidate.questions.filter((question) => optionalNumber(question.score) !== null);
  const totalScore = gradedQuestions.reduce((sum, question) => sum + number(question.score), 0);
  const totalMaximum = candidate.questions.reduce((sum, question) => sum + number(question.maximumPoints), 0);
  const gradedMaximum = gradedQuestions.reduce((sum, question) => sum + number(question.maximumPoints), 0);
  return {
    totalScore,
    totalMaximum,
    gradedMaximum,
    gradedCount: gradedQuestions.length,
    questionCount: candidate.questions.length,
    complete: candidate.allGradesFinal === true,
    percentage: candidate.allGradesFinal === true ? percentage(totalScore, totalMaximum) : null,
  };
}

function dateText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
  }).format(date);
}

function isoTimestamp(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) {
    throw new Error('EXAM_ROOM_CLASS_WORKBOOK_INVALID');
  }
  return date.toISOString();
}

function analytics(candidates, dataset = {}) {
  const graded = candidates.filter((candidate) => candidate.allGradesFinal === true);
  const scores = graded.map((candidate) => candidateTotals(candidate).percentage * 100);
  const questionMap = new Map();
  for (const candidate of candidates) {
    for (const question of candidate.questions) {
      const ordinal = Number(question.ordinal);
      const item = questionMap.get(ordinal) || {
        ordinal, prompt: question.prompt || '', maximum: number(question.maximumPoints),
        scores: [], answered: 0, finals: 0,
      };
      if (String(question.answer || '').trim()) item.answered += 1;
      const score = optionalNumber(question.score);
      if (score !== null) item.scores.push(score);
      if (question.gradeState === 'final') item.finals += 1;
      questionMap.set(ordinal, item);
    }
  }
  for (const question of normalizedExamQuestions(dataset)) {
    if (!questionMap.has(question.ordinal)) {
      questionMap.set(question.ordinal, {
        ordinal: question.ordinal,
        prompt: question.prompt,
        maximum: number(question.maximumPoints),
        scores: [], answered: 0, finals: 0,
      });
    }
  }
  const questions = [...questionMap.values()].sort((left, right) => left.ordinal - right.ordinal)
    .map((item) => {
      const average = item.scores.length
        ? item.scores.reduce((sum, value) => sum + value, 0) / item.scores.length : null;
      return {
        ...item,
        average,
        averagePercentage: average === null ? null : percentage(average, item.maximum),
        highest: item.scores.length ? Math.max(...item.scores) : null,
        lowest: item.scores.length ? Math.min(...item.scores) : null,
      };
    });
  const scoredQuestions = questions.filter((question) => question.scores.length > 0);
  return {
    gradedCount: graded.length,
    averagePercentage: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    highestQuestion: [...scoredQuestions].sort((a, b) => b.averagePercentage - a.averagePercentage)[0] || null,
    lowestQuestion: [...scoredQuestions].sort((a, b) => a.averagePercentage - b.averagePercentage)[0] || null,
    questions,
  };
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>
  <fonts count="5">
    <font><sz val="11"/><color rgb="FF0B1F33"/><name val="Aptos"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Georgia"/></font>
    <font><b/><sz val="11"/><color rgb="FFF7E7B0"/><name val="Aptos"/></font>
    <font><b/><sz val="12"/><color rgb="FF061C35"/><name val="Aptos"/></font>
    <font><i/><sz val="10"/><color rgb="FF475569"/><name val="Aptos"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF061C35"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B2A4A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F4EC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1BF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD5DEE8"/></left><right style="thin"><color rgb="FFD5DEE8"/></right><top style="thin"><color rgb="FFD5DEE8"/></top><bottom style="thin"><color rgb="FFD5DEE8"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="medium"><color rgb="FFD4AF37"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function worksheetXml({ rows, widths, merges = [], freezeRows = 0, autoFilter = null, landscape = false }) {
  const cols = widths.map((width, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  )).join('');
  const pane = freezeRows
    ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  const filterXml = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane-placeholder/>${pane}</sheetView></sheetViews>
  <cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>${filterXml}${mergeXml}
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`.replace('<pane-placeholder/>', '');
}

function summarySheet(dataset, candidates, report) {
  const statuses = Array.isArray(dataset?.classStatuses) ? dataset.classStatuses : [];
  const absent = statuses.filter((entry) => entry.absent === true).length;
  const submitted = number(dataset?.submittedCount);
  const unanswered = candidates.reduce((sum, candidate) => sum + number(candidate.unansweredCount), 0);
  const incidents = candidates.reduce((sum, candidate) => sum + number(candidate.incidentCount), 0);
  const rows = [
    rowXml(1, [{ value: 'DUE DILIGENCE — CLASS RESULTS', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: dataset.title || 'Examination', style: 2 }]),
    rowXml(3, [{ value: `Generated ${dateText(dataset.generatedAt || new Date().toISOString())} · Asia/Manila · ${dataset.exportScope === 'offline_grading' ? 'Offline grading workbook' : 'Final class results'}`, style: 2 }]),
    rowXml(5, ['Metric', 'Value', 'Interpretation'].map((value) => ({ value, style: 3 })), { height: 28 }),
    rowXml(6, [{ value: 'Expected students', style: 9 }, { value: number(dataset.expectedCount), style: 6 }, { value: 'Current active roster', style: 4 }]),
    rowXml(7, [{ value: 'Submitted examinations', style: 9 }, { value: submitted, style: 6 }, { value: 'Class-wide submitted count', style: 4 }]),
    rowXml(8, [{ value: 'Detailed records in workbook', style: 9 }, { value: candidates.length, style: 6 }, { value: 'Submitted students selected for detailed answer export', style: 4 }]),
    rowXml(9, [{ value: 'Fully graded detailed records', style: 9 }, { value: report.gradedCount, style: 6 }, { value: 'Selected students with every question finalized', style: 4 }]),
    rowXml(10, [{ value: 'Final average of detailed records', style: 9 }, { value: report.averagePercentage === null ? '' : report.averagePercentage / 100, style: 7 }, { value: report.gradedCount ? 'Based on fully finalized selected grades only' : 'No fully finalized grade set yet', style: 4 }]),
    rowXml(11, [{ value: 'Absent / no-show', style: 9 }, { value: absent, style: 6 }, { value: 'Class-wide roster status', style: 4 }]),
    rowXml(12, [{ value: 'Unanswered items', style: 9 }, { value: unanswered, style: 6 }, { value: 'Blank answers across detailed submitted records', style: 4 }]),
    rowXml(13, [{ value: 'Recorded incidents', style: 9 }, { value: incidents, style: 6 }, { value: 'Integrity events across detailed submitted records', style: 4 }]),
    rowXml(16, [{ value: 'Strongest question', style: 3 }, { value: report.highestQuestion ? `Question ${report.highestQuestion.ordinal}` : '—', style: 8 }, { value: report.highestQuestion ? `${(report.highestQuestion.averagePercentage * 100).toFixed(1)}% average` : 'No scores available', style: 4 }]),
    rowXml(17, [{ value: 'Lowest-performing question', style: 3 }, { value: report.lowestQuestion ? `Question ${report.lowestQuestion.ordinal}` : '—', style: 8 }, { value: report.lowestQuestion ? `${(report.lowestQuestion.averagePercentage * 100).toFixed(1)}% average` : 'No scores available', style: 4 }]),
    rowXml(19, [{ value: 'EXAMINATION SCHEDULE', style: 3 }]),
    rowXml(20, [{ value: 'Opens', style: 9 }, { value: dateText(dataset.opensAt), style: 4 }, { value: 'Server schedule', style: 4 }]),
    rowXml(21, [{ value: 'Hard close', style: 9 }, { value: dateText(dataset.hardClosesAt), style: 4 }, { value: 'No entry or submission after this boundary unless separately authorized', style: 4 }]),
    rowXml(22, [{ value: 'Duration', style: 9 }, { value: dataset.durationMinutes ? `${number(dataset.durationMinutes)} minutes` : '', style: 4 }, { value: 'Per-student examination duration', style: 4 }]),
    rowXml(24, [{ value: 'OFFLINE GRADING INSTRUCTIONS', style: 3 }]),
    rowXml(25, [{ value: 'Use the Offline Grading sheet to review each exact question and submitted answer. Enter optional offline notes in the gold columns. The secure website remains the authoritative place to save and release official grades.', style: 2 }], { height: 44 }),
  ];
  return worksheetXml({ rows, widths: [31, 28, 68], merges: ['A1:C1', 'A2:C2', 'A3:C3', 'A19:C19', 'A24:C24', 'A25:C25'] });
}

function classResultsSheet(dataset, candidates) {
  const classRows = classResultRows(dataset, candidates);
  const ordinals = [...new Set([
    ...normalizedExamQuestions(dataset).map((question) => Number(question.ordinal)),
    ...classRows.flatMap((candidate) => candidate.questions.map((question) => Number(question.ordinal))),
  ])].filter((ordinal) => Number.isInteger(ordinal) && ordinal > 0).sort((a, b) => a - b);
  const headers = ['Overall Final Grade', 'Raw Score', 'Student Name', 'Email', 'Student Number', 'Status', 'Started At', 'Deadline', 'Submitted At', 'Final Maximum', 'Grade Status', 'Unanswered', 'Incidents', ...ordinals.flatMap((ordinal) => [`Q${ordinal} Score`, `Q${ordinal} Max`, `Q${ordinal} Comment`])];
  const rows = [
    rowXml(1, [{ value: 'CLASS RESULTS', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: `${dataset.title || 'Examination'} · complete class-list overview with ${candidates.length} detailed submitted record${candidates.length === 1 ? '' : 's'}`, style: 2 }]),
    rowXml(4, headers.map((value) => ({ value, style: 3 })), { height: 36 }),
  ];
  classRows.forEach((candidate, index) => {
    const rowNumber = index + 5;
    const totals = candidateTotals(candidate);
    const hasRecordedScore = candidate.questions.some((question) => optionalNumber(question.score) !== null);
    const detailStatus = candidate.detailsSelected === false
      ? (['submitted', 'auto_submitted', 'sealed'].includes(String(candidate.status))
        ? 'Detailed record not selected' : 'No grade recorded')
      : (candidate.allGradesFinal ? 'Final'
        : (hasRecordedScore ? `Recorded subtotal (${totals.gradedCount} of ${totals.questionCount} graded)` : 'No grade recorded'));
    const scoreColumns = ordinals.map((_, ordinalIndex) => columnName(14 + (ordinalIndex * 3)));
    const maxColumns = ordinals.map((_, ordinalIndex) => columnName(15 + (ordinalIndex * 3)));
    const values = [
      totals.complete ? { value: totals.percentage, style: 7, formula: `IFERROR(B${rowNumber}/J${rowNumber},0)` } : '',
      hasRecordedScore ? { value: totals.totalScore, style: 6, formula: scoreColumns.length ? scoreColumns.map((column) => `${column}${rowNumber}`).join('+') : null } : '',
      candidate.studentName || candidate.candidateNumber || 'Student', candidate.studentEmail || '',
      candidate.studentNumber || '', candidate.displayStatus || candidate.status || '',
      dateText(candidate.startedAt), dateText(candidate.serverDeadline), dateText(candidate.submittedAt),
      { value: totals.totalMaximum, style: 6, formula: maxColumns.length ? maxColumns.map((column) => `${column}${rowNumber}`).join('+') : null },
      detailStatus, optionalNumber(candidate.unansweredCount) ?? '', optionalNumber(candidate.incidentCount) ?? '',
      ...ordinals.flatMap((ordinal) => {
        const question = candidate.questions.find((entry) => Number(entry.ordinal) === ordinal) || {};
        return [optionalNumber(question.score) ?? '', number(question.maximumPoints), question.comment || ''];
      }),
    ];
    rows.push(rowXml(rowNumber, values.map((value, cellIndex) => (
      typeof value === 'object' && value !== null ? value : { value, style: (index % 2 ? 5 : 4) }
    )), { height: 30 }));
  });
  return worksheetXml({
    rows,
    widths: [20, 14, 24, 30, 18, 18, 22, 22, 22, 14, 20, 12, 12, ...ordinals.flatMap(() => [12, 12, 36])],
    merges: [`A1:${columnName(headers.length)}1`, `A2:${columnName(headers.length)}2`],
    freezeRows: 4,
    autoFilter: `A4:${columnName(headers.length)}${Math.max(4, classRows.length + 4)}`,
    landscape: true,
  });
}

function offlineGradingSheet(dataset, candidates) {
  const headers = ['Student Name', 'Email', 'Student Number', 'Question', 'Exact Professor Question (Part 1)', 'Exact Professor Question (Part 2)', 'Submitted Student Answer (Part 1)', 'Submitted Student Answer (Part 2)', 'Maximum Points', 'Server Score', 'Grade State', 'Professor Comment', 'Offline Score Entry', 'Offline Comment / Verification Notes'];
  const rows = [
    rowXml(1, [{ value: 'OFFLINE GRADING WORKSHEET', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: `${dataset.title || 'Examination'} · Gold cells are for offline Professor work and are not automatically uploaded.`, style: 2 }]),
    rowXml(4, headers.map((value) => ({ value, style: 3 })), { height: 42 }),
  ];
  let rowNumber = 5;
  for (const candidate of candidates) {
    for (const question of candidate.questions) {
      const promptParts = splitCellText(question.prompt);
      const answerParts = splitCellText(question.answer);
      const values = [
        candidate.studentName || candidate.candidateNumber || 'Student', candidate.studentEmail || '',
        candidate.studentNumber || '', `Question ${question.ordinal}`,
        ...promptParts, ...answerParts, number(question.maximumPoints),
        optionalNumber(question.score) ?? '', question.gradeState || 'ungraded', question.comment || '', '', '',
      ];
      rows.push(rowXml(rowNumber, values.map((value, index) => ({
        value,
        style: index >= 12 ? 10 : (index === 8 || index === 9 ? 6 : ((rowNumber % 2) ? 4 : 5)),
      })), { height: 84 }));
      rowNumber += 1;
    }
  }
  if (!candidates.length) {
    for (const question of normalizedExamQuestions(dataset)) {
      const promptParts = splitCellText(question.prompt);
      const values = [
        '', '', '', `Question ${question.ordinal}`, ...promptParts, '', '',
        number(question.maximumPoints), '', 'Not submitted', '', '', '',
      ];
      rows.push(rowXml(rowNumber, values.map((value, index) => ({
        value,
        style: index >= 12 ? 10 : (index === 8 || index === 9 ? 6 : ((rowNumber % 2) ? 4 : 5)),
      })), { height: 84 }));
      rowNumber += 1;
    }
  }
  return worksheetXml({
    rows,
    widths: [24, 30, 18, 18, 62, 62, 68, 68, 14, 14, 16, 42, 18, 46],
    merges: ['A1:N1', 'A2:N2'], freezeRows: 4,
    autoFilter: `A4:N${Math.max(4, rowNumber - 1)}`, landscape: true,
  });
}

function studentDetailSheet(dataset, candidate) {
  const totals = candidateTotals(candidate);
  const rows = [
    rowXml(1, [{ value: 'DUE DILIGENCE — STUDENT EXAMINATION RECORD', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: dataset.title || 'Examination', style: 2 }]),
    rowXml(4, ['Student', candidate.studentName || candidate.candidateNumber || 'Student'].map((value, index) => ({ value, style: index ? 4 : 9 }))),
    rowXml(5, ['Email', candidate.studentEmail || ''].map((value, index) => ({ value, style: index ? 4 : 9 }))),
    rowXml(6, ['Student number', candidate.studentNumber || ''].map((value, index) => ({ value, style: index ? 4 : 9 }))),
    rowXml(7, [totals.complete ? 'Overall score' : 'Recorded subtotal (not final)', totals.totalScore, 'Final maximum', totals.totalMaximum, 'Final percentage', totals.complete ? totals.percentage : 'Not final']
      .map((value, index) => ({ value, style: index % 2 ? (index === 5 && totals.complete ? 7 : 6) : 9 }))),
    rowXml(8, ['Grading status', totals.complete ? 'Final' : `${totals.gradedCount} of ${totals.questionCount} questions graded`]
      .map((value, index) => ({ value, style: index ? 4 : 9 }))),
    rowXml(10, ['Question', 'Exact Professor Question (Part 1)', 'Exact Professor Question (Part 2)', 'Submitted Student Answer (Part 1)', 'Submitted Student Answer (Part 2)', 'Score', 'Maximum', 'Grade State', 'Professor Comment', 'Offline Score Entry', 'Offline Comment / Verification Notes']
      .map((value) => ({ value, style: 3 })), { height: 42 }),
  ];
  candidate.questions.forEach((question, index) => {
    const promptParts = splitCellText(question.prompt);
    const answerParts = splitCellText(question.answer);
    rows.push(rowXml(index + 11, [
      `Question ${question.ordinal}`, ...promptParts, ...answerParts,
      optionalNumber(question.score) ?? '', number(question.maximumPoints),
      question.gradeState || 'ungraded', question.comment || '', '', '',
    ].map((value, cellIndex) => ({
      value,
      style: cellIndex >= 9 ? 10 : (cellIndex === 5 || cellIndex === 6 ? 6 : (index % 2 ? 5 : 4)),
    })), { height: 96 }));
  });
  return worksheetXml({
    rows,
    widths: [14, 62, 62, 68, 68, 13, 13, 16, 42, 18, 46],
    merges: ['A1:K1', 'A2:K2', 'B4:K4', 'B5:K5', 'B6:K6', 'B7:K7', 'B9:K9'],
    freezeRows: 10,
    autoFilter: `A10:K${Math.max(10, candidate.questions.length + 10)}`,
    landscape: true,
  });
}

function questionAnalyticsSheet(dataset, report, candidateCount) {
  const headers = ['Question', 'Exact Professor Question (Part 1)', 'Exact Professor Question (Part 2)', 'Responses', 'Scored', 'Final Grades', 'Average Score', 'Maximum Points', 'Average %', 'Highest', 'Lowest'];
  const rows = [
    rowXml(1, [{ value: 'QUESTION ANALYTICS', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: `${dataset.title || 'Examination'} · analytics for ${candidateCount} selected submission${candidateCount === 1 ? '' : 's'}`, style: 2 }]),
    rowXml(4, headers.map((value) => ({ value, style: 3 })), { height: 36 }),
  ];
  report.questions.forEach((question, index) => {
    const promptParts = splitCellText(question.prompt);
    rows.push(rowXml(index + 5, [
      `Question ${question.ordinal}`, ...promptParts, question.answered, question.scores.length,
      question.finals, question.average ?? '', question.maximum, question.averagePercentage ?? '',
      question.highest ?? '', question.lowest ?? '',
    ].map((value, cellIndex) => ({
      value, style: cellIndex === 8 ? 7 : (cellIndex >= 3 ? 6 : (index % 2 ? 5 : 4)),
    })), { height: 44 }));
  });
  return worksheetXml({
    rows, widths: [14, 62, 62, 12, 12, 14, 15, 15, 14, 12, 12],
    merges: ['A1:K1', 'A2:K2'], freezeRows: 4,
    autoFilter: `A4:K${Math.max(4, report.questions.length + 4)}`, landscape: true,
  });
}

function attendanceSheet(dataset) {
  const statuses = Array.isArray(dataset?.classStatuses) ? dataset.classStatuses : [];
  const headers = ['Student Name', 'Email', 'Student Number', 'Class Status', 'Started At', 'Deadline', 'Submitted At'];
  const rows = [
    rowXml(1, [{ value: 'ATTENDANCE', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: `${dataset.title || 'Examination'} · server-recorded class participation`, style: 2 }]),
    rowXml(4, headers.map((value) => ({ value, style: 3 })), { height: 36 }),
  ];
  statuses.forEach((entry, index) => {
    rows.push(rowXml(index + 5, [
      entry.studentName || entry.candidateNumber || 'Student', entry.studentEmail || '', entry.studentNumber || '',
      entry.displayStatus || entry.status || '', dateText(entry.startedAt),
      dateText(entry.serverDeadline), dateText(entry.submittedAt),
    ].map((value) => ({ value, style: index % 2 ? 5 : 4 })), { height: 30 }));
  });
  return worksheetXml({
    rows, widths: [24, 30, 18, 22, 22, 22, 22],
    merges: ['A1:G1', 'A2:G2'], freezeRows: 4,
    autoFilter: `A4:G${Math.max(4, statuses.length + 4)}`, landscape: true,
  });
}

function workbookEntries(dataset, sheets) {
  const sheetNames = sheets.map((sheet) => sheet.name);
  const workbookSheets = sheetNames.map((name, index) => (
    `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('');
  const relationships = sheetNames.map((_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join('');
  const contentOverrides = sheetNames.map((_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');
  return [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${contentOverrides}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(dataset.title || 'Due Diligence Class Results')}</dc:title><dc:creator>Due Diligence Examination Room</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${isoTimestamp(dataset.generatedAt)}</dcterms:created></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Due Diligence Examination Room</Application></Properties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets><calcPr fullCalcOnLoad="1" forceFullCalc="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheet.data })),
  ];
}

function uniqueStudentSheetNames(candidates) {
  const used = new Set(['summary', 'class results', 'offline grading', 'question analytics', 'attendance']);
  return candidates.map((candidate, index) => {
    const identity = String(candidate.studentName || candidate.candidateNumber || `Student ${index + 1}`)
      .replace(/[\\/\?*\[\]:']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || `Student ${index + 1}`;
    const prefix = `Student ${String(index + 1).padStart(2, '0')} - `;
    const base = `${prefix}${identity}`.slice(0, 31).trim();
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const marker = ` (${suffix})`;
      name = `${base.slice(0, 31 - marker.length).trim()}${marker}`;
      suffix += 1;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function assertWorkbookResourceBounds(dataset, candidates) {
  const detailCells = candidates.reduce((total, candidate) => (
    total + 16 + ((Array.isArray(candidate.questions) ? candidate.questions.length : 0) * 12)
  ), 0);
  if (detailCells > MAX_WORKBOOK_DETAIL_CELLS
      || candidates.some((candidate) => (candidate.questions || []).length > 200)) {
    throw new Error('EXAM_ROOM_CLASS_WORKBOOK_TOO_LARGE');
  }
  const stack = [dataset];
  const visited = new Set();
  let characters = 0;
  let nodes = 0;
  while (stack.length) {
    const value = stack.pop();
    nodes += 1;
    if (nodes > 250_000) throw new Error('EXAM_ROOM_CLASS_WORKBOOK_TOO_LARGE');
    if (typeof value === 'string') {
      characters += Array.from(value).length;
      if (characters > MAX_WORKBOOK_TEXT_CHARACTERS) throw new Error('EXAM_ROOM_CLASS_WORKBOOK_TOO_LARGE');
      continue;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) stack.push(...value);
    else stack.push(...Object.values(value));
  }
}

export function buildExamClassResultsWorkbook(input) {
  const dataset = input?.dataset && typeof input.dataset === 'object' ? input.dataset : input;
  const candidates = normalizedCandidates(dataset);
  if (!dataset?.examId || !dataset?.title || !dataset?.generatedAt
      || candidates.length > 500
      || (candidates.length < 1 && dataset?.exportScope !== 'offline_grading')) {
    throw new Error('EXAM_ROOM_CLASS_WORKBOOK_INVALID');
  }
  if (candidates.some((candidate) => !candidate.attemptId || !candidate.studentEmail)) {
    throw new Error('EXAM_ROOM_CLASS_WORKBOOK_INVALID');
  }
  assertWorkbookResourceBounds(dataset, candidates);
  const report = analytics(candidates, dataset);
  const studentSheetNames = uniqueStudentSheetNames(candidates);
  const sheets = [
    { name: 'Summary', data: summarySheet(dataset, candidates, report) },
    { name: 'Class Results', data: classResultsSheet(dataset, candidates) },
    { name: 'Offline Grading', data: offlineGradingSheet(dataset, candidates) },
    { name: 'Question Analytics', data: questionAnalyticsSheet(dataset, report, candidates.length) },
    { name: 'Attendance', data: attendanceSheet(dataset) },
    ...candidates.map((candidate, index) => ({
      name: studentSheetNames[index], data: studentDetailSheet(dataset, candidate),
    })),
  ];
  return zipEntries(workbookEntries(dataset, sheets));
}

export function examClassResultsWorkbookFileName(input) {
  const dataset = input?.dataset && typeof input.dataset === 'object' ? input.dataset : input;
  const title = String(dataset?.title || 'class-results').normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).toLowerCase()
    || 'class-results';
  const scope = dataset?.exportScope === 'offline_grading' ? 'offline-grading' : 'class-results';
  const date = isoTimestamp(dataset?.generatedAt).slice(0, 10).replace(/-/g, '');
  return `due-diligence-${title}-${scope}-${date}.xlsx`;
}
