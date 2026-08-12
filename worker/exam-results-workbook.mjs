const encoder = new TextEncoder();
const EXCEL_CELL_TEXT_LIMIT = 32_760;

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
  const height = options.height ? ` ht="${options.height}" customHeight="1"` : '';
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

function candidateTotals(candidate) {
  const totalScore = candidate.questions.reduce((sum, question) => sum + number(question.score), 0);
  const totalMaximum = candidate.questions.reduce((sum, question) => sum + number(question.maximumPoints), 0);
  return { totalScore, totalMaximum, percentage: percentage(totalScore, totalMaximum) };
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

function analytics(candidates) {
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
  const questions = [...questionMap.values()].sort((left, right) => left.ordinal - right.ordinal)
    .map((item) => {
      const average = item.scores.length
        ? item.scores.reduce((sum, value) => sum + value, 0) / item.scores.length : 0;
      return {
        ...item,
        average,
        averagePercentage: percentage(average, item.maximum),
        highest: item.scores.length ? Math.max(...item.scores) : 0,
        lowest: item.scores.length ? Math.min(...item.scores) : 0,
      };
    });
  return {
    gradedCount: graded.length,
    averagePercentage: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
    highestQuestion: [...questions].sort((a, b) => b.averagePercentage - a.averagePercentage)[0] || null,
    lowestQuestion: [...questions].sort((a, b) => a.averagePercentage - b.averagePercentage)[0] || null,
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
  const late = statuses.filter((entry) => entry.late === true).length;
  const unanswered = candidates.reduce((sum, candidate) => sum + number(candidate.unansweredCount), 0);
  const incidents = candidates.reduce((sum, candidate) => sum + number(candidate.incidentCount), 0);
  const rows = [
    rowXml(1, [{ value: 'DUE DILIGENCE — CLASS RESULTS', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: dataset.title || 'Examination', style: 2 }]),
    rowXml(3, [{ value: `Generated ${dateText(dataset.generatedAt || new Date().toISOString())} · Asia/Manila · ${dataset.exportScope === 'offline_grading' ? 'Offline grading workbook' : 'Final class results'}`, style: 2 }]),
    rowXml(5, ['Metric', 'Value', 'Interpretation'].map((value) => ({ value, style: 3 })), { height: 28 }),
    rowXml(6, [{ value: 'Expected students', style: 9 }, { value: number(dataset.expectedCount), style: 6 }, { value: 'Current active roster', style: 4 }]),
    rowXml(7, [{ value: 'Submitted examinations', style: 9 }, { value: candidates.length, style: 6 }, { value: `${candidates.length} selected for this workbook`, style: 4 }]),
    rowXml(8, [{ value: 'Fully graded students', style: 9 }, { value: report.gradedCount, style: 6 }, { value: 'Every question finalized', style: 4 }]),
    rowXml(9, [{ value: 'Class average', style: 9 }, { value: report.averagePercentage / 100, style: 7 }, { value: report.gradedCount ? 'Based on fully finalized grades only' : 'No fully finalized grade set yet', style: 4 }]),
    rowXml(10, [{ value: 'Absent / no-show', style: 9 }, { value: absent, style: 6 }, { value: 'Rostered students without a submitted attempt', style: 4 }]),
    rowXml(11, [{ value: 'Late', style: 9 }, { value: late, style: 6 }, { value: 'Late entry or submission after the server deadline', style: 4 }]),
    rowXml(12, [{ value: 'Unanswered items', style: 9 }, { value: unanswered, style: 6 }, { value: 'Blank answers across submitted examinations', style: 4 }]),
    rowXml(13, [{ value: 'Recorded incidents', style: 9 }, { value: incidents, style: 6 }, { value: 'Integrity events for Professor review', style: 4 }]),
    rowXml(15, [{ value: 'Strongest question', style: 3 }, { value: report.highestQuestion ? `Question ${report.highestQuestion.ordinal}` : '—', style: 8 }, { value: report.highestQuestion ? `${(report.highestQuestion.averagePercentage * 100).toFixed(1)}% average` : 'No scores available', style: 4 }]),
    rowXml(16, [{ value: 'Lowest-performing question', style: 3 }, { value: report.lowestQuestion ? `Question ${report.lowestQuestion.ordinal}` : '—', style: 8 }, { value: report.lowestQuestion ? `${(report.lowestQuestion.averagePercentage * 100).toFixed(1)}% average` : 'No scores available', style: 4 }]),
    rowXml(18, [{ value: 'OFFLINE GRADING INSTRUCTIONS', style: 3 }]),
    rowXml(19, [{ value: 'Use the Offline Grading sheet to review each exact question and submitted answer. Enter optional offline notes in the gold columns. The secure website remains the authoritative place to save and release official grades.', style: 2 }], { height: 44 }),
  ];
  return worksheetXml({ rows, widths: [28, 22, 74], merges: ['A1:C1', 'A2:C2', 'A3:C3', 'A18:C18', 'A19:C19'] });
}

function classResultsSheet(dataset, candidates) {
  const ordinals = [...new Set(candidates.flatMap((candidate) => candidate.questions.map((question) => Number(question.ordinal))))].sort((a, b) => a - b);
  const headers = ['Student Name', 'Email', 'Student Number', 'Candidate Number', 'Status', 'Started At', 'Deadline', 'Submitted At', 'Timing', 'Overall Score', 'Maximum', 'Percentage', 'Grade Status', 'Unanswered', 'Incidents', ...ordinals.flatMap((ordinal) => [`Q${ordinal} Score`, `Q${ordinal} Max`, `Q${ordinal} Comment`])];
  const rows = [
    rowXml(1, [{ value: 'CLASS RESULTS', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: `${dataset.title || 'Examination'} · ${candidates.length} selected student${candidates.length === 1 ? '' : 's'}`, style: 2 }]),
    rowXml(4, headers.map((value) => ({ value, style: 3 })), { height: 36 }),
  ];
  candidates.forEach((candidate, index) => {
    const rowNumber = index + 5;
    const totals = candidateTotals(candidate);
    const scoreColumns = ordinals.map((_, ordinalIndex) => columnName(16 + (ordinalIndex * 3)));
    const maxColumns = ordinals.map((_, ordinalIndex) => columnName(17 + (ordinalIndex * 3)));
    const values = [
      candidate.studentName || candidate.candidateNumber || 'Student', candidate.studentEmail || '',
      candidate.studentNumber || '', candidate.candidateNumber || '', candidate.status || '',
      dateText(candidate.startedAt), dateText(candidate.serverDeadline), dateText(candidate.submittedAt),
      candidate.late ? 'Late' : 'On time',
      { value: totals.totalScore, style: 6, formula: scoreColumns.length ? scoreColumns.map((column) => `${column}${rowNumber}`).join('+') : null },
      { value: totals.totalMaximum, style: 6, formula: maxColumns.length ? maxColumns.map((column) => `${column}${rowNumber}`).join('+') : null },
      { value: totals.percentage, style: 7, formula: `IFERROR(J${rowNumber}/K${rowNumber},0)` },
      candidate.allGradesFinal ? 'Final' : 'Draft / incomplete', number(candidate.unansweredCount), number(candidate.incidentCount),
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
    widths: [24, 30, 18, 18, 18, 22, 22, 22, 14, 14, 14, 14, 18, 12, 12, ...ordinals.flatMap(() => [12, 12, 36])],
    merges: [`A1:${columnName(headers.length)}1`, `A2:${columnName(headers.length)}2`],
    freezeRows: 4,
    autoFilter: `A4:${columnName(headers.length)}${Math.max(4, candidates.length + 4)}`,
    landscape: true,
  });
}

function offlineGradingSheet(dataset, candidates) {
  const headers = ['Student Name', 'Email', 'Student Number', 'Candidate Number', 'Question', 'Exact Professor Question (Part 1)', 'Exact Professor Question (Part 2)', 'Submitted Student Answer (Part 1)', 'Submitted Student Answer (Part 2)', 'Maximum Points', 'Server Score', 'Grade State', 'Professor Comment', 'Offline Score Entry', 'Offline Comment / Verification Notes'];
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
        candidate.studentNumber || '', candidate.candidateNumber || '', `Question ${question.ordinal}`,
        ...promptParts, ...answerParts, number(question.maximumPoints),
        optionalNumber(question.score) ?? '', question.gradeState || 'ungraded', question.comment || '', '', '',
      ];
      rows.push(rowXml(rowNumber, values.map((value, index) => ({
        value,
        style: index >= 13 ? 10 : (index === 9 || index === 10 ? 6 : ((rowNumber % 2) ? 4 : 5)),
      })), { height: 84 }));
      rowNumber += 1;
    }
  }
  return worksheetXml({
    rows,
    widths: [24, 30, 18, 18, 12, 62, 62, 68, 68, 14, 14, 16, 42, 18, 46],
    merges: ['A1:O1', 'A2:O2'], freezeRows: 4,
    autoFilter: `A4:O${Math.max(4, rowNumber - 1)}`, landscape: true,
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
      question.finals, question.average, question.maximum, question.averagePercentage,
      question.highest, question.lowest,
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
  const headers = ['Student Name', 'Email', 'Student Number', 'Candidate Number', 'Class Status', 'Started At', 'Deadline', 'Submitted At', 'Late Entry', 'Late Submission', 'Timing'];
  const rows = [
    rowXml(1, [{ value: 'ATTENDANCE & TIMING', style: 1 }], { height: 32 }),
    rowXml(2, [{ value: `${dataset.title || 'Examination'} · server-recorded class participation`, style: 2 }]),
    rowXml(4, headers.map((value) => ({ value, style: 3 })), { height: 36 }),
  ];
  statuses.forEach((entry, index) => {
    rows.push(rowXml(index + 5, [
      entry.studentName || entry.candidateNumber || 'Student', entry.studentEmail || '', entry.studentNumber || '',
      entry.candidateNumber || '', entry.displayStatus || entry.status || '', dateText(entry.startedAt),
      dateText(entry.serverDeadline), dateText(entry.submittedAt), entry.lateEntry === true ? 'Yes' : 'No',
      entry.lateSubmission === true ? 'Yes' : 'No', entry.late === true ? 'Late' : 'On time',
    ].map((value) => ({ value, style: index % 2 ? 5 : 4 })), { height: 30 }));
  });
  return worksheetXml({
    rows, widths: [24, 30, 18, 18, 22, 22, 22, 22, 13, 16, 14],
    merges: ['A1:K1', 'A2:K2'], freezeRows: 4,
    autoFilter: `A4:K${Math.max(4, statuses.length + 4)}`, landscape: true,
  });
}

function workbookEntries(dataset, sheets) {
  const sheetNames = ['Summary', 'Class Results', 'Offline Grading', 'Question Analytics', 'Attendance & Timing'];
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
    ...sheets.map((data, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data })),
  ];
}

export function buildExamClassResultsWorkbook(input) {
  const dataset = input?.dataset && typeof input.dataset === 'object' ? input.dataset : input;
  const candidates = normalizedCandidates(dataset);
  if (!dataset?.examId || !dataset?.title || !dataset?.generatedAt
      || candidates.length < 1 || candidates.length > 500) {
    throw new Error('EXAM_ROOM_CLASS_WORKBOOK_INVALID');
  }
  if (candidates.some((candidate) => !candidate.attemptId || !candidate.studentEmail)) {
    throw new Error('EXAM_ROOM_CLASS_WORKBOOK_INVALID');
  }
  const report = analytics(candidates);
  const sheets = [
    summarySheet(dataset, candidates, report),
    classResultsSheet(dataset, candidates),
    offlineGradingSheet(dataset, candidates),
    questionAnalyticsSheet(dataset, report, candidates.length),
    attendanceSheet(dataset),
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
