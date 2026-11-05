// Server-side email presentation. Student mail is built from an explicit,
// minimal allowlist; it never serializes an examination delivery payload.
const utf8 = new TextEncoder();
const BODY_LIMIT = 130000;
const CHUNK_BYTES = 10000;
export const SUBMISSION_CONFIRMED = "You successfully submitted your answers.";

export function escapeEmailHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
const htmlText = value => escapeEmailHtml(value).replace(/\r\n|\r|\n/g, "<br>");
const byteLength = value => utf8.encode(value).byteLength;
const codePointBytes = point => point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;

export function splitEmailText(value, limit = CHUNK_BYTES) {
  if (!Number.isSafeInteger(limit) || limit < 4) throw new Error("Invalid email text limit");
  const parts = []; let part = "", size = 0;
  for (const character of String(value)) {
    const bytes = codePointBytes(character.codePointAt(0));
    if (size && size + bytes > limit) { parts.push(part); part = ""; size = 0; }
    part += character; size += bytes;
  }
  if (part || !parts.length) parts.push(part);
  return parts;
}

function receivedAt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A recorded submission time is required before email delivery");
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "long", timeStyle: "short", timeZone: "Asia/Manila",
  }).format(date) + " PHT";
}

function ownerSheetLink(value) {
  if (!value) return "";
  let url;
  try { url = new URL(value); } catch { throw new Error("The private collection link is invalid"); }
  if (url.origin !== "https://docs.google.com" || !/^\/spreadsheets\/d\/[A-Za-z0-9_-]{20,200}\/edit$/.test(url.pathname) || url.username || url.password || url.search || (url.hash && !/^#gid=\d+$/.test(url.hash)))
    throw new Error("The private collection link is invalid");
  return url.href;
}

function contentHtml(sections, owner) {
  return sections.map(section => owner
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#253447;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;">${htmlText(section.text)}</div>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 26px;"><tr><td style="padding:0 0 10px;border-bottom:1px solid #ded8cc;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1px;font-weight:bold;color:#8b6e3f;">ANSWER ${escapeEmailHtml(section.number)}${section.continued ? " — CONTINUED" : ""}</td></tr><tr><td data-answer-number="${escapeEmailHtml(section.number)}" style="padding:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.75;color:#253447;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;">${htmlText(section.text)}</td></tr></table>`).join("");
}

function renderHtml(meta, sections, part, total) {
  const owner = meta.owner;
  const title = owner ? "Examination answers received" : SUBMISSION_CONFIRMED;
  const preheader = owner ? "A preserved submission is ready in your private answer collection." : "Your submitted answers are preserved below for your records.";
  const partNotice = total > 1 ? `<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#5e6874;">Part ${part} of ${total}. Keep every part for your complete answer record.</p>` : "";
  const sheet = owner && meta.sheetUrl ? `<p style="margin:22px 0 0;"><a href="${escapeEmailHtml(meta.sheetUrl)}" style="display:inline-block;background:#b49a69;color:#112137;padding:13px 20px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;border:1px solid #a88b57;">Open your private answer collection</a></p><p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;">Owner copy. This collection link is not included in exam takers' emails.</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(title)}</title></head><body style="margin:0;padding:0;background:#f3f1eb;color:#253447;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f1eb" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#fffefa;"><tr><td bgcolor="#112137" style="padding:27px 32px;background:#112137;"><p style="margin:0;font-family:'Fraunces','Times New Roman',serif;font-size:28px;line-height:1.25;color:#f8f4e9;">Due Diligence<span style="color:#b49a69;">.</span></p><p style="margin:9px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.5;letter-spacing:1.6px;color:#c5b185;">EXAMINATION PLATFORM</p></td></tr><tr><td style="padding:32px 32px 28px;"><p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;letter-spacing:1.3px;color:#8b6e3f;">${owner ? "PRIVATE OWNER COPY" : "SUBMISSION CONFIRMED"}</p><h1 style="margin:0;font-family:'Fraunces','Times New Roman',serif;font-size:30px;line-height:1.25;font-weight:normal;color:#112137;">${escapeEmailHtml(title)}</h1><p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#4c5968;">${owner ? "The following submitted answers have been preserved for your records." : "Your answers have been received and preserved. The numbered copy below is your proof of submission."}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:24px 0 0;"><tr><td style="padding:15px 0;border-top:1px solid #ded8cc;border-bottom:1px solid #ded8cc;"><p style="margin:0;font-family:'Fraunces','Times New Roman',serif;font-size:21px;line-height:1.5;color:#112137;">${escapeEmailHtml(meta.examTitle)}</p><p style="margin:7px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#5e6874;">${escapeEmailHtml(meta.name)}<br>Submitted ${escapeEmailHtml(meta.submittedAt)}</p></td></tr></table>${partNotice}${sheet}</td></tr><tr><td style="padding:0 32px 8px;">${contentHtml(sections, owner)}</td></tr><tr><td style="padding:20px 32px 28px;border-top:1px solid #ded8cc;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#6b7280;word-break:break-all;">Submission reference: ${escapeEmailHtml(meta.receiptId)}</p><p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#6b7280;">DueDiligence.ph · Keep this email with your examination records.</p></td></tr></table></td></tr></table></body></html>`;
}

function renderText(meta, sections, part, total) {
  if (meta.owner) return `Answer backup part ${part} of ${total}. Preserve every part. Receipt ${meta.receiptId}.\n\n${sections.map(section => section.text).join("")}`;
  return [
    "Due Diligence", meta.examTitle, "", SUBMISSION_CONFIRMED,
    "Your answers have been received and preserved. The numbered copy below is your proof of submission.",
    `Name: ${meta.name}`, `Submitted: ${meta.submittedAt}`, `Submission reference: ${meta.receiptId}`,
    ...(total > 1 ? [`Part ${part} of ${total}. Keep every part for your complete answer record.`] : []), "",
    ...sections.flatMap(section => [`Answer ${section.number}${section.continued ? " — continued" : ""}`, section.text, ""]),
  ].join("\n");
}

export function buildSubmissionEmails(payload, { audience = "student", spreadsheetUrl = "", ownerPacket = "" } = {}) {
  if (!["student", "owner"].includes(audience)) throw new Error("Choose an owner or student email");
  if (!payload.receipt?.id || payload.receipt.serverTime == null) throw new Error("A final receipt is required before email delivery");
  const owner = audience === "owner";
  const meta = {
    owner,
    examTitle: String(payload.exam?.title || "Examination"),
    name: String(payload.attempt?.name || "Exam taker"),
    submittedAt: receivedAt(payload.receipt.serverTime),
    receiptId: String(payload.receipt.id),
    sheetUrl: owner ? ownerSheetLink(spreadsheetUrl) : "",
  };
  let sections;
  if (owner) {
    if (!ownerPacket) throw new Error("The complete owner answer packet is required");
    sections = splitEmailText(ownerPacket).map(text => ({ text }));
  } else {
    const answers = new Map((payload.answers || []).map(answer => [answer.questionId, answer]));
    sections = [...(payload.questions || [])].sort((a, b) => a.number - b.number).flatMap(question => {
      const answer = answers.get(question.id)?.text;
      return splitEmailText(typeof answer === "string" && answer.length ? answer : "[BLANK ANSWER]").map((text, index) => ({ number: question.number, text, continued: index > 0 }));
    });
    if (!sections.length) throw new Error("The numbered submitted answers are required");
  }
  const groups = []; let group = [];
  for (const section of sections) {
    const candidate = [...group, section];
    if (byteLength(renderText(meta, candidate, 999999, 999999)) + byteLength(renderHtml(meta, candidate, 999999, 999999)) > BODY_LIMIT) {
      if (!group.length) throw new Error("An email section exceeds the safe delivery limit");
      groups.push(group); group = [section];
    } else group = candidate;
  }
  if (group.length) groups.push(group);
  const parts = groups.map((items, index) => ({
    text: renderText(meta, items, index + 1, groups.length),
    html: renderHtml(meta, items, index + 1, groups.length),
  }));
  if (parts.some(part => byteLength(part.text) + byteLength(part.html) > BODY_LIMIT))
    throw new Error("The rendered email exceeds the safe delivery limit");
  return { subject: owner ? "Due Diligence | Examination answer collection" : "Due Diligence | Your submitted answers", parts };
}
