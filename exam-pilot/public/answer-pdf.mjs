import { PDFDocument, StandardFonts, rgb, fontkit } from "./pdf-vendor/pdf.mjs";

const NAVY = rgb(0.055, 0.105, 0.17);
const GOLD = rgb(0.60, 0.48, 0.28);
const INK = rgb(0.12, 0.16, 0.21);
const MUTED = rgb(0.38, 0.42, 0.46);
const RULE = rgb(0.84, 0.83, 0.79);
const PAGE = [595.28, 841.89];
const MARGIN = 48;
const WIDTH = PAGE[0] - MARGIN * 2;
const date = (value) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value)) + " PHT";
};

export function examinationPdfData(state, draft = {}, { receiptOnly = false, exportedAt = Date.now() } = {}) {
  const attempt = state.attempt || {}, receipt = attempt.receipt;
  const finalized = !!receipt || attempt.status === "finalized";
  const questions = (attempt.questions || []).map(question => {
    const official = attempt.answers?.find(answer => answer.questionId === question.id);
    const local = draft.answers?.[question.id];
    return {
      number: question.number,
      question: question.text || "",
      instructions: question.instructions || "",
      points: question.points ?? null,
      answer: (finalized ? official?.text : local?.text ?? official?.text) ?? "",
      answerLabel: finalized ? "Submitted answer" : "Latest device answer",
      recovered: finalized && local && !local.acknowledged && local.text !== official?.text ? local.text : undefined,
      recoveredDrafts: (attempt.recoveredDrafts || []).filter(item => item.questionId === question.id).map(item => ({ text: item.text ?? "", receivedAt: date(item.receivedAt) })),
    };
  });
  return {
    title: state.exam?.title || "Examination",
    instructions: state.exam?.instructions || "",
    documentTitle: receiptOnly ? "Submission receipt" : "Examination answers",
    status: receipt ? "SUBMISSION CONFIRMED" : finalized ? "RECEIPT PENDING" : "DEVICE COPY - NOT SUBMITTED",
    notice: receipt
      ? receiptOnly ? "This receipt confirms that your examination was received. Download your examination answers separately to keep the full question and answer record." : "This receipt confirms that your examination was received. Submitted answers below are the preserved server record. Any separate late or offline writing is clearly marked and does not replace that record."
      : "This device copy does not confirm submission or on-time delivery. Keep this browser and profile, and reconnect to check your receipt. Your examiner must review any late or offline writing separately.",
    name: receipt?.name || attempt.name || "Not recorded",
    email: receipt?.email || attempt.email || "Not recorded",
    examId: receipt?.examId || state.exam?.id || "Not recorded",
    attemptId: attempt.id || receipt?.attemptId || "Not recorded",
    receiptId: receipt?.receiptId || receipt?.id || "Not yet issued",
    checksum: receipt?.checksum || "Not yet issued",
    startedAt: date(attempt.startAt || attempt.startedAt),
    submittedAt: receipt ? date(receipt.finalizedAt || receipt.submittedAt || attempt.finalizedAt || receipt.serverTime || state.serverTime) : "Not confirmed",
    exportedAt: date(exportedAt),
    submittedBy: (receipt?.finalizationType || receipt?.type || attempt.finalizationType) === "deadline" ? "Automatically at the deadline" : receipt ? "Student submission" : "Not confirmed",
    answered: `${receipt?.answeredCount ?? questions.filter(q => q.answer.trim()).length} of ${receipt?.questionCount ?? state.exam?.questionCount ?? questions.length}`,
    receiptOnly,
    questions: receiptOnly ? [] : questions,
  };
}

function preservedText(data) {
  return [
    "Due Diligence | " + data.documentTitle,
    data.title, data.status, data.notice,
    `Student: ${data.name}`, `Email: ${data.email}`, `Started: ${data.startedAt}`,
    `Submitted: ${data.submittedAt}`, `Exported: ${data.exportedAt}`,
    `Examination: ${data.examId}`, `Attempt: ${data.attemptId}`,
    `Receipt: ${data.receiptId}`, `Checksum: ${data.checksum}`,
    ...(data.receiptOnly ? [] : ["\nEXAMINATION INSTRUCTIONS", data.instructions]),
    ...data.questions.flatMap(q => [`\nQUESTION ${q.number}${q.points === null ? "" : ` (${q.points} points)`}`, q.question, q.instructions, `\n${q.answerLabel}`, q.answer || "[Blank answer]", ...(q.recovered !== undefined ? ["\nSEPARATE LATE / OFFLINE DRAFT - EXAMINER REVIEW REQUIRED", q.recovered || "[Blank draft]"] : []), ...(q.recoveredDrafts || []).flatMap(item => ["\nSEPARATE RECOVERED DRAFT - EXAMINER REVIEW REQUIRED", `Received: ${item.receivedAt}`, item.text || "[Blank draft]"])]),
  ].join("\n");
}

// Each line is measured against the same font used to render it. Long tokens,
// paragraphs, blank lines and surrogate-pair characters never disappear.
export function wrapPdfText(text, measure, width) {
  const lines = [];
  for (const paragraph of String(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let line = "";
    for (const token of paragraph.split(/(\s+)/u)) {
      if (!token) continue;
      if (measure(line + token) <= width) { line += token; continue; }
      if (line) { lines.push(line); line = ""; }
      if (measure(token) <= width) { line = token; continue; }
      for (const character of token) {
        if (line && measure(line + character) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function browserGlyphLine(pdf, text, { size, family, color, maxWidth }) {
  if (!globalThis.document) throw new Error("A browser font fallback is required to preserve these characters.");
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(maxWidth * scale);
  canvas.height = Math.ceil(size * 1.7 * scale);
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.font = `${size}px ${family}, sans-serif`;
  context.fillStyle = `rgb(${Math.round(color.red * 255)},${Math.round(color.green * 255)},${Math.round(color.blue * 255)})`;
  context.textBaseline = "alphabetic";
  context.fillText(text, 0, size * 1.2);
  return { image: await pdf.embedPng(canvas.toDataURL("image/png")), width: maxWidth, height: size * 1.7, offset: size * .5 };
}

export async function createExaminationPdf(data, { fontBytes, loadFont = async name => {
  const response = await fetch(`/fonts/${name}-pdf.ttf`);
  if (!response.ok) throw new Error("Brand font unavailable");
  return new Uint8Array(await response.arrayBuffer());
}, glyphLine = browserGlyphLine } = {}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${data.title} - ${data.documentTitle}`);
  pdf.setAuthor("Due Diligence");
  pdf.setCreator("DueDiligence.ph examination platform");
  pdf.setSubject(data.status);
  pdf.setLanguage("en-PH");
  const fonts = {};
  for (const [key, name, standard] of [["body", "inter", StandardFonts.Helvetica], ["heading", "fraunces", StandardFonts.TimesRoman]]) {
    try { fonts[key] = await pdf.embedFont(fontBytes?.[name] || await loadFont(name), { subset: true }); }
    catch { fonts[key] = await pdf.embedFont(standard); }
  }
  const charset = new Map(Object.values(fonts).map(font => [font, new Set(font.getCharacterSet())]));
  const canDraw = (text, font) => [...text].every(char => charset.get(font).has(char.codePointAt(0)));
  const canvas = globalThis.document?.createElement("canvas");
  const context = canvas?.getContext("2d");
  const family = font => font === fonts.heading ? "Fraunces" : "Inter";
  const measure = (text, font, size) => {
    if (canDraw(text, font)) return font.widthOfTextAtSize(text, size);
    if (!context) throw new Error("A browser font fallback is required to preserve these characters.");
    context.font = `${size}px ${family(font)}, sans-serif`;
    return context.measureText(text).width;
  };
  if (globalThis.document?.fonts) await Promise.allSettled([document.fonts.load("12px Inter"), document.fonts.load("18px Fraunces")]);
  let page, y;
  const line = async (text, { font = fonts.body, size = 11, color = INK, x = MARGIN } = {}) => {
    if (!text) return;
    if (canDraw(text, font)) page.drawText(text, { x, y, font, size, color });
    else {
      const rendered = await glyphLine(pdf, text, { size, family: family(font), color, maxWidth: WIDTH });
      page.drawImage(rendered.image, { x, y: y - rendered.offset, width: rendered.width, height: rendered.height });
    }
  };
  const newPage = async () => {
    page = pdf.addPage(PAGE);
    page.drawRectangle({ x: 0, y: PAGE[1] - 11, width: PAGE[0], height: 11, color: NAVY });
    y = PAGE[1] - 44;
    await line("Due Diligence", { font: fonts.heading, size: 17, color: NAVY });
    y -= 18;
    await line("EXAMINATION PLATFORM", { size: 7.4, color: GOLD });
    page.drawLine({ start: { x: MARGIN, y: y - 12 }, end: { x: PAGE[0] - MARGIN, y: y - 12 }, thickness: .65, color: RULE });
    y -= 40;
  };
  const ensure = async space => { if (y - space < 63) await newPage(); };
  const paragraph = async (text, { font = fonts.body, size = 11, color = INK, leading = 16, gap = 10 } = {}) => {
    const normalized = String(text).replaceAll("\t", "    ");
    for (const textLine of wrapPdfText(normalized, value => measure(value, font, size), WIDTH)) {
      await ensure(leading);
      await line(textLine, { font, size, color });
      y -= leading;
    }
    y -= gap;
  };
  const label = async text => {
    await ensure(38);
    await paragraph(text, { size: 8, color: GOLD, leading: 12, gap: 6 });
  };
  const fact = async (name, value) => {
    await label(name.toUpperCase());
    await paragraph(value, { size: 10.5, leading: 15, gap: 9 });
  };
  await newPage();
  await paragraph(data.documentTitle, { font: fonts.heading, size: 26, leading: 32, gap: 9 });
  await paragraph(data.title, { font: fonts.heading, size: 16, leading: 22, gap: 18 });
  await label(data.status);
  await paragraph(data.notice, { size: 9.5, leading: 14, color: MUTED, gap: 15 });
  await fact("Student", data.name);
  await fact("Email", data.email);
  await fact("Submitted", `${data.submittedAt} | ${data.submittedBy}`);
  await fact("Answers recorded", data.answered);
  await fact("Examination started", data.startedAt);
  await fact("PDF created", data.exportedAt);
  if (!data.receiptOnly) {
    if (data.instructions) {
      await label("EXAMINATION INSTRUCTIONS");
      await paragraph(data.instructions, { size: 10, leading: 15 });
    }
    for (const question of data.questions) {
      await newPage();
      await label(`QUESTION ${question.number}${question.points === null ? "" : ` | ${question.points} POINTS`}`);
      await paragraph(question.question, { font: fonts.heading, size: 13, leading: 19, gap: 17 });
      if (question.instructions) await paragraph(question.instructions, { size: 10, leading: 15, color: MUTED, gap: 14 });
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE[0] - MARGIN, y: y + 4 }, thickness: .65, color: RULE });
      y -= 15;
      await label(question.answerLabel.toUpperCase());
      await paragraph(question.answer || "[Blank answer]", { size: 11, leading: 17, gap: 18 });
      if (question.recovered !== undefined) {
        await ensure(85);
        await label("SEPARATE LATE / OFFLINE DRAFT");
        await paragraph("For examiner review. This writing is not part of the submitted answer above.", { size: 9, color: MUTED, leading: 14, gap: 12 });
        await paragraph(question.recovered || "[Blank draft]", { size: 11, leading: 17 });
      }
      for (const recovered of question.recoveredDrafts || []) {
        await ensure(85);
        await label("SEPARATE RECOVERED DRAFT");
        await paragraph(`For examiner review. Received ${recovered.receivedAt}. This writing does not replace the submitted answer.`, { size: 9, color: MUTED, leading: 14, gap: 12 });
        await paragraph(recovered.text || "[Blank draft]", { size: 11, leading: 17 });
      }
    }
  }
  await ensure(200);
  await label("RECEIPT & RECORD DETAILS");
  for (const [name, value] of [["Examination", data.examId], ["Attempt", data.attemptId], ["Receipt", data.receiptId], ["Record checksum", data.checksum]]) {
    await paragraph(`${name}: ${value}`, { size: 8.5, leading: 13, color: MUTED, gap: 6 });
  }
  const pages = pdf.getPages();
  for (let index = 0; index < pages.length; index++) {
    page = pages[index];
    page.drawLine({ start: { x: MARGIN, y: 46 }, end: { x: PAGE[0] - MARGIN, y: 46 }, thickness: .65, color: RULE });
    y = 30;
    await line("DueDiligence.ph | Private examination record", { size: 7.5, color: MUTED });
    await line(`${index + 1} / ${pages.length}`, { size: 7.5, color: MUTED, x: PAGE[0] - MARGIN - 35 });
  }
  // The user receives one PDF. Its embedded readable UTF-8 archival copy keeps
  // exact answer text, including characters outside the brand font's subset.
  await pdf.attach(new TextEncoder().encode(preservedText(data)), "complete-examination-record.txt", { mimeType: "text/plain;charset=utf-8", description: "Exact complete text of this examination record" });
  return pdf.save();
}
