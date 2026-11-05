/** Strict, dependency-free import for instructor-authored text. Never rewrites questions. */
export class ImportError extends Error {}

export function parseCSV(source) {
  source = String(source).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"') {
      if (field || closed)
        throw new ImportError(
          "Unexpected quotation mark. Put the entire field in double quotes.",
        );
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closed = false;
    } else {
      if (closed)
        throw new ImportError(
          "Unexpected characters after a closing quotation mark.",
        );
      field += c;
    }
  }
  if (quoted)
    throw new ImportError(
      "A quoted field is not closed. No questions were imported.",
    );
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}

export function validateQuestions(questions) {
  const errors = [],
    numbers = new Set(),
    texts = new Set();
  if (!Array.isArray(questions) || !questions.length)
    return ["Add at least one question."];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i],
      label = `Question ${i + 1}`;
    if (!Number.isSafeInteger(q.number) || q.number < 1)
      errors.push(`${label}: use a positive whole question number.`);
    if (numbers.has(q.number))
      errors.push(`${label}: duplicate question number ${q.number}.`);
    numbers.add(q.number);
    if (q.number !== i + 1)
      errors.push(
        `${label}: numbering must run from 1 without gaps, in the displayed order.`,
      );
    if (typeof q.text !== "string" || !q.text.trim())
      errors.push(`${label}: the question text is empty.`);
    else {
      const normalized = q.text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (texts.has(normalized))
        errors.push(`${label}: duplicates an earlier question.`);
      texts.add(normalized);
      if (q.text.length > 80000)
        errors.push(
          `${label}: text exceeds 80,000 characters. Split or shorten the item; it will never be truncated.`,
        );
      if (
        /^\s*(?:answer\s*key|suggested\s+answer|model\s+answer|correct\s+answer)\s*[:—-]?/im.test(
          `${q.text}\n${q.instructions || ""}`,
        )
      )
        errors.push(
          `${label}: possible answer key. Remove answer material before saving.`,
        );
    }
    if (typeof q.instructions === "string" && q.instructions.length > 10000)
      errors.push(
        `${label}: instructions exceed 10,000 characters. Shorten them before saving; they will never be truncated.`,
      );
    if (
      q.points !== undefined &&
      q.points !== null &&
      q.points !== "" &&
      (!Number.isFinite(Number(q.points)) ||
        Number(q.points) < 0 ||
        Number(q.points) > 10000)
    )
      errors.push(`${label}: points must be a number between 0 and 10,000.`);
  }
  return errors;
}

function checked(questions) {
  const errors = validateQuestions(questions);
  if (errors.length) throw new ImportError(errors.join("\n"));
  return questions;
}

export function questionsFromCSV(source) {
  const rows = parseCSV(source);
  if (rows.length < 2)
    throw new ImportError("The CSV needs a header and at least one question.");
  const headers = rows.shift().map((v) => v.trim().toLowerCase());
  const allowed = [
    "question_number",
    "question_text",
    "instructions",
    "points",
  ];
  if (
    headers.some((v) => !allowed.includes(v)) ||
    new Set(headers).size !== headers.length
  )
    throw new ImportError(
      "Use only question_number, question_text, instructions and points columns. Answer-key columns are not accepted.",
    );
  if (
    !headers.includes("question_number") ||
    !headers.includes("question_text")
  )
    throw new ImportError(
      "CSV must include question_number and question_text columns.",
    );
  return checked(
    rows.map((row, index) => {
      if (row.length !== headers.length)
        throw new ImportError(
          `CSV row ${index + 2} has ${row.length} fields; expected ${headers.length}. Check commas and quotation marks.`,
        );
      const values = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
      if (!/^\d+$/.test(values.question_number.trim()))
        throw new ImportError(
          `CSV row ${index + 2}: question_number must be a positive whole number.`,
        );
      return {
        number: Number(values.question_number),
        text: values.question_text.replace(/\r\n?/g, "\n").trim(),
        instructions: (values.instructions || "")
          .replace(/\r\n?/g, "\n")
          .trim(),
        ...(values.points?.trim() ? { points: Number(values.points) } : {}),
      };
    }),
  );
}

export function questionsFromText(source) {
  const lines = String(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const questions = [];
  for (const line of lines) {
    const match = line.match(
      /^\s*(?:(?:question|q)\s*)?(\d+)[.)\s:–—-]+\s*(.*)$/i,
    );
    if (match) questions.push({ number: Number(match[1]), text: match[2] });
    else if (questions.length)
      questions[questions.length - 1].text += `\n${line}`;
    else if (line.trim())
      throw new ImportError(
        "Start each question with 1., 2., and so on. Use manual entry for a single unnumbered question.",
      );
  }
  return checked(questions.map((q) => ({ ...q, text: q.text.trim() })));
}

export function phtInstant(date, time) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
    !/^\d{2}:\d{2}(?::\d{2})?$/.test(time || "")
  )
    throw new ImportError(
      "Choose a complete date and time in Philippine time.",
    );
  const input = `${date}T${time.length === 5 ? `${time}:00` : time}+08:00`;
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp))
    throw new ImportError("The schedule date or time is invalid.");
  const roundtrip = new Date(timestamp + 8 * 3600000)
    .toISOString()
    .slice(0, 19);
  if (roundtrip !== input.slice(0, 19))
    throw new ImportError("The schedule date or time is invalid.");
  return new Date(timestamp).toISOString();
}

export function scheduleFromInputs({
  startDate,
  startTime,
  endDate,
  endTime,
  durationMinutes,
  mode,
}) {
  const starts_at = phtInstant(startDate, startTime);
  let ends_at;
  if (mode === "duration") {
    const minutes = Number(durationMinutes);
    if (
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      !String(durationMinutes).trim()
    )
      throw new ImportError("Enter a duration greater than zero minutes.");
    const end = Date.parse(starts_at) + minutes * 60000;
    if (!Number.isFinite(end) || Math.abs(end) > 8.64e15)
      throw new ImportError("The duration is too large.");
    ends_at = new Date(end).toISOString();
  } else ends_at = phtInstant(endDate, endTime);
  if (Date.parse(ends_at) <= Date.parse(starts_at))
    throw new ImportError(
      "The closing time must be later than the opening time.",
    );
  return { starts_at, ends_at };
}

export function safeCSVCell(value) {
  const text = String(value ?? "");
  return `"${(/^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}

export const CSV_TEMPLATE =
  'question_number,question_text,instructions,points\r\n1,"Replace this with your complete question.","Optional instructions",\r\n';
