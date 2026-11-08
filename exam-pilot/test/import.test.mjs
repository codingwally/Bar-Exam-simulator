import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV,
  questionsFromCSV,
  questionsFromText,
  validateQuestions,
  phtInstant,
  scheduleFromInputs,
  safeCSVCell,
} from "../public/import.mjs";

test("CSV preserves Unicode, quoted multiline facts, commas and escaped quotation marks", () => {
  const questions = questionsFromCSV(
    '\uFEFFquestion_number,question_text,instructions,points\r\n1,"Congress says, ""valid"".\r\nExplain fully — Saligang Batas.","Use ALAC.\nKeep every paragraph.",5\r\n2,"Second fact pattern",,0\r\n',
  );
  assert.equal(questions.length, 2);
  assert.equal(
    questions[0].text,
    'Congress says, "valid".\nExplain fully — Saligang Batas.',
  );
  assert.equal(questions[0].instructions, "Use ALAC.\nKeep every paragraph.");
  assert.equal(questions[1].points, 0);
});

test("CSV refuses malformed quoting and field counts without partial import", () => {
  assert.throws(() => parseCSV('"unclosed'), /not closed/);
  assert.throws(() => parseCSV('a"b,c'), /Unexpected quotation/);
  assert.throws(() => parseCSV('"a"x,c'), /Unexpected characters/);
  assert.throws(
    () => questionsFromCSV("question_number,question_text\n1,one,extra"),
    /expected 2/,
  );
  assert.throws(
    () => questionsFromCSV("question_number,question_text\n1"),
    /expected 2/,
  );
});

test("CSV rejects answer-key columns, duplicate headers and missing required columns", () => {
  for (const csv of [
    "question_number,question_text,answer_key\n1,a,secret",
    "question_number,question_text,question_text\n1,a,b",
    "number,question\n1,a",
  ])
    assert.throws(() => questionsFromCSV(csv));
});

test("questions reject missing text, duplicates, missing numbering, negative points and likely answer keys", () => {
  assert.throws(
    () => questionsFromCSV("question_number,question_text\n1,\n2,next"),
    /empty/,
  );
  assert.throws(
    () => questionsFromCSV("question_number,question_text\n1,one\n1,two"),
    /duplicate question number/,
  );
  assert.throws(
    () =>
      questionsFromCSV(
        'question_number,question_text\n1,One text\n2,"  one   text "',
      ),
    /duplicates an earlier/,
  );
  assert.throws(
    () => questionsFromCSV("question_number,question_text\n2,one"),
    /without gaps/,
  );
  assert.throws(
    () => questionsFromCSV("question_number,question_text,points\n1,one,-2"),
    /points/,
  );
  assert.throws(
    () =>
      questionsFromCSV(
        'question_number,question_text\n1,"Question\nSuggested answer: secret"',
      ),
    /possible answer key/,
  );
  assert.deepEqual(
    validateQuestions([
      { number: 1, text: "Explain your answer using a legal basis." },
    ]),
    [],
  );
});

test("paste supports numbered question styles and retains all paragraphs", () => {
  const qs = questionsFromText(
    "Question 1: Congress passes a law.\n\nExplain.\n\nQ2. A second fact pattern.\nAnswer using ALAC.",
  );
  assert.deepEqual(
    qs.map((q) => q.number),
    [1, 2],
  );
  assert.equal(qs[0].text, "Congress passes a law.\n\nExplain.");
  assert.equal(qs[1].text, "A second fact pattern.\nAnswer using ALAC.");
  assert.throws(
    () => questionsFromText("An unnumbered first question"),
    /Start each question/,
  );
  assert.throws(
    () => questionsFromText("1. First\n1. Internal ambiguous item\n2. Second"),
    /duplicate/,
  );
});

test("configurable count accepts 1, 20 and 27 full items without truncation", () => {
  for (const count of [1, 20, 27]) {
    const input = Array.from(
      { length: count },
      (_, i) => `${i + 1}. Question ${i + 1}: ${"long facts. ".repeat(60)}`,
    ).join("\n\n");
    const qs = questionsFromText(input);
    assert.equal(qs.length, count);
    assert.equal(
      qs.at(-1).text,
      `Question ${count}: ${"long facts. ".repeat(60)}`.trim(),
    );
  }
});

test("question and instruction size limits reject rather than silently truncate", () => {
  assert.deepEqual(
    validateQuestions([
      { number: 1, text: "x".repeat(80000), instructions: "y".repeat(10000) },
    ]),
    [],
  );
  assert.match(
    validateQuestions([{ number: 1, text: "x".repeat(80001) }]).join("\n"),
    /80,000/,
  );
  assert.match(
    validateQuestions([
      { number: 1, text: "Valid question", instructions: "y".repeat(10001) },
    ]).join("\n"),
    /10,000/,
  );
});

test("PHT dates convert to authoritative UTC independently of host timezone", () => {
  assert.equal(phtInstant("2027-02-28", "09:30"), "2027-02-28T01:30:00.000Z");
  assert.equal(phtInstant("2028-02-29", "00:00"), "2028-02-28T16:00:00.000Z");
  assert.throws(() => phtInstant("2027-02-29", "09:30"), /invalid/);
  assert.throws(() => phtInstant("2027-13-01", "09:30"), /invalid/);
  assert.throws(() => phtInstant("2027-02-28", "24:00"), /invalid/);
  assert.throws(() => phtInstant("", "09:30"), /complete/);
});

test("schedule accepts explicit closing or duration and rejects missing/reversed dates", () => {
  const base = { startDate: "2027-03-01", startTime: "23:30" };
  assert.deepEqual(
    scheduleFromInputs({ ...base, mode: "duration", durationMinutes: "120" }),
    {
      starts_at: "2027-03-01T15:30:00.000Z",
      ends_at: "2027-03-01T17:30:00.000Z",
    },
  );
  assert.equal(
    scheduleFromInputs({
      ...base,
      mode: "date",
      endDate: "2027-03-02",
      endTime: "01:30",
    }).ends_at,
    "2027-03-01T17:30:00.000Z",
  );
  assert.throws(
    () =>
      scheduleFromInputs({ ...base, mode: "duration", durationMinutes: "" }),
    /greater than zero/,
  );
  assert.throws(
    () =>
      scheduleFromInputs({
        ...base,
        mode: "date",
        endDate: "2027-03-01",
        endTime: "22:00",
      }),
    /later/,
  );
});

test("spreadsheet cells neutralize formulas and preserve quotes, blanks and Unicode", () => {
  for (const input of [
    "=1+1",
    "+SUM(A:A)",
    "-1+cmd",
    "@SUM(1)",
    "\t=evil",
    "\r@evil",
  ])
    assert.ok(safeCSVCell(input).startsWith("\"'"));
  assert.equal(safeCSVCell('Congress says "no"'), '"Congress says ""no"""');
  assert.equal(safeCSVCell(""), '""');
  assert.equal(safeCSVCell("Saligang Batas"), '"Saligang Batas"');
});
