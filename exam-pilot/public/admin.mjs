import { validateQuestions } from "./import.mjs";
import {
  examFromText,
  examDirections,
  readExamFile,
} from "./document-import.mjs";
const $ = (id) => document.getElementById(id),
  draftKey = "dd-exam-desk-draft-v2";
const state = {
  exams: [],
  questions: [],
  source: "",
  dirty: false,
  exam: null,
  detail: null,
  cursor: null,
  eventCursor: null,
  backupCursor: null,
  role: "owner",
};
const canManage = () => state.role !== "examiner";
const time = (value) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)) + " PHT"
    : "Not recorded";
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text ?? "");
  if (cls) n.className = cls;
  return n;
};
function message(text, kind = "") {
  $("message").textContent = text;
  $("message").className = `message ${kind}`;
}
function view(name) {
  for (const id of ["list", "create", "share", "responses"])
    $(`${id}-view`).hidden = id !== name;
  window.scrollTo(0, 0);
}
async function api(path, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api/admin${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const data = await response.json();
    if (
      response.status === 401 &&
      (state.authMode === "builtin" ||
        data.auth_mode === "builtin" ||
        data.error?.auth_mode === "builtin")
    ) {
      if (state.dirty && !saveLocal()) {
        $("sign-in-again").hidden = false;
        throw new Error(
          "Your sign-in expired. Keep this page open. Choose Sign in again to use another tab, then return here and retry.",
        );
      }
      state.dirty = false;
      location.assign("/admin/login");
      throw new Error(
        "Please sign in again. Your unfinished exam remains in this browser.",
      );
    }
    if (!response.ok)
      throw new Error(
        data.error?.message || "This could not be completed. Please try again.",
      );
    return data;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error(
        "The response is taking too long. Your questions remain in this browser. Check My exams before creating another link, or retry the same request.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function busy(button, work) {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await work();
  } catch (error) {
    message(
      error.message || "Please check your connection and try again.",
      "error",
    );
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}
function saveLocal() {
  try {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        questions: state.questions,
        source: state.source,
        originalSource: state.originalSource,
        sourceName: state.sourceName,
        sourceFormat: state.sourceFormat,
        instructions: $("exam-instructions").value,
        title: $("exam-title").value,
        duration: $("exam-duration").value,
        operation: state.operation,
      }),
    );
    return true;
  } catch {
    message(
      "This browser could not keep an unfinished copy. Keep this page open until your exam link is created.",
      "error",
    );
    return false;
  }
}
function persist() {
  state.dirty = true;
  state.operation = null;
  $("review-confirm").checked = false;
  saveLocal();
}
function renumber() {
  state.questions.forEach((q, i) => (q.number = i + 1));
}
function grow(input) {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 3}px`;
}
function renderQuestions() {
  renumber();
  $("question-count").textContent =
    `${state.questions.length} question${state.questions.length === 1 ? "" : "s"} · numbered in the order students will see`;
  $("question-list").replaceChildren();
  $("review-panel").hidden = false;
  for (const [index, q] of state.questions.entries()) {
    const li = node("li", undefined, "question"),
      head = node("div", undefined, "section-heading"),
      tools = node("div", undefined, "question-tools"),
      text = node("textarea");
    head.append(node("h3", `Question ${index + 1}`));
    text.id = `question-${index}`;
    text.value = q.text;
    text.setAttribute("aria-label", `Question ${index + 1} text`);
    text.addEventListener("input", () => {
      q.text = text.value;
      grow(text);
      persist();
    });
    const tool = (label, fn, disabled = false) => {
      const button = node("button", label);
      button.type = "button";
      button.disabled = disabled;
      button.setAttribute("aria-label", `${label} question ${index + 1}`);
      button.addEventListener("click", () => {
        if (fn() === false) return;
        renumber();
        persist();
        renderQuestions();
      });
      tools.append(button);
    };
    tool(
      "Move up",
      () => {
        [state.questions[index - 1], state.questions[index]] = [
          q,
          state.questions[index - 1],
        ];
      },
      index === 0,
    );
    tool(
      "Move down",
      () => {
        [state.questions[index + 1], state.questions[index]] = [
          q,
          state.questions[index + 1],
        ];
      },
      index === state.questions.length - 1,
    );
    tool("Split", () => {
      const at = text.selectionStart;
      if (at < 1 || at >= q.text.length) {
        message(
          "Place the text cursor where the next question should begin, then choose Split.",
          "error",
        );
        return false;
      }
      const first = q.text.slice(0, at).trim(),
        second = q.text.slice(at).trim();
      if (!first || !second) return false;
      q.text = first;
      state.questions.splice(index + 1, 0, {
        number: index + 2,
        text: second,
        instructions: "",
      });
    });
    tool(
      "Combine with next",
      () => {
        q.text += "\n\n" + state.questions[index + 1].text;
        q.instructions = [
          q.instructions,
          state.questions[index + 1].instructions,
        ]
          .filter(Boolean)
          .join("\n");
        state.questions.splice(index + 1, 1);
      },
      index === state.questions.length - 1,
    );
    tool("Remove", () => {
      if (q.text.trim() && !confirm(`Remove question ${index + 1}?`))
        return false;
      state.questions.splice(index, 1);
    });
    head.append(tools);
    li.append(head, text);
    if (q.instructions) {
      const label = node("label", "Instructions for this question"),
        instructions = node("textarea");
      instructions.className = "sub-instructions";
      instructions.value = q.instructions;
      instructions.id = `instructions-${index}`;
      label.htmlFor = instructions.id;
      instructions.addEventListener("input", () => {
        q.instructions = instructions.value;
        persist();
      });
      li.append(label, instructions);
    }
    $("question-list").append(li);
    grow(text);
  }
}
function acceptExtracted(
  result,
  { keepOriginal = false, name = "Pasted text", format = "text" } = {},
) {
  if (!result.questions.length && state.questions.length) {
    message(
      "No numbered questions were found. Your current questions and instructions are unchanged.",
      "error",
    );
    return;
  }
  if (!keepOriginal) {
    state.originalSource = result.sourceText;
    state.sourceName = name;
    state.sourceFormat = format;
  }
  state.source = result.sourceText;
  state.questions = result.questions;
  $("original-text").value = state.source;
  $("exam-instructions").value = examDirections(result.instructions);
  $("import-note").hidden = !result.warnings?.length;
  $("import-note").textContent = (result.warnings || []).join("\n");
  if (!$("exam-title").value) {
    const first = result.instructions?.split("\n").find((line) => line.trim());
    if (
      first &&
      first.length <= 120 &&
      !/^(?:instructions|directions|answer|write|read)\b/i.test(first) &&
      !/[.!?]$/.test(first)
    )
      $("exam-title").value = first;
  }
  persist();
  renderQuestions();
  message(
    result.questions.length
      ? `Read ${result.questions.length} questions. Check the complete text below before creating your link.`
      : "The text was read, but the question boundaries need your help. Add questions below or correct the numbering in the original text.",
  );
}
async function readFile(file) {
  if (!file) return;
  if (
    state.questions.length &&
    !confirm(
      "Replace the questions in this unfinished exam with this document?",
    )
  )
    return;
  state.readController?.abort();
  const controller = new AbortController();
  state.readController = controller;
  const draftSnapshot = () =>
    JSON.stringify([
      state.questions,
      state.source,
      $("exam-instructions").value,
      $("exam-title").value,
      $("exam-duration").value,
    ]);
  const beforeReading = draftSnapshot();
  $("reading-progress").hidden = false;
  $("cancel-reading").hidden = false;
  try {
    const result = await readExamFile(file, {
      signal: controller.signal,
      onProgress: (text) => ($("reading-progress").textContent = text),
    });
    if (state.readController !== controller) return;
    if (draftSnapshot() !== beforeReading) {
      message(
        "You edited this exam while the document was being read. Your edits are unchanged. Upload the document again when you are ready to replace them.",
        "error",
      );
      return;
    }
    if (!result.questions.length && state.questions.length) {
      message(
        "No numbered questions were found in this document. Your existing questions and instructions are unchanged. Paste the new questions or add them manually.",
        "error",
      );
      return;
    }
    acceptExtracted(result, { name: file.name, format: result.format });
  } catch (error) {
    if (error.name === "AbortError")
      message("Reading cancelled. Your current questions are unchanged.");
    else {
      if (error.sourceText !== undefined && !state.questions.length) {
        state.source = error.sourceText;
        $("original-text").value = state.source;
        $("review-panel").hidden = false;
        $("original-panel").open = true;
      }
      message(
        `${error.message}${state.questions.length ? " Your existing questions and instructions are unchanged." : ""}`,
        "error",
      );
    }
  } finally {
    if (state.readController === controller) {
      $("reading-progress").hidden = true;
      $("cancel-reading").hidden = true;
      $("exam-file").value = "";
    }
  }
}
function addQuestion() {
  state.questions.push({
    number: state.questions.length + 1,
    text: "",
    instructions: "",
  });
  renderQuestions();
  persist();
  $(`question-${state.questions.length - 1}`).focus();
}
function resumeDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey));
    if (!draft) return false;
    state.questions = draft.questions || [];
    state.source = draft.source || "";
    state.originalSource = draft.originalSource ?? state.source;
    state.sourceName = draft.sourceName || "Pasted text";
    state.sourceFormat = draft.sourceFormat || "text";
    state.operation = draft.operation;
    $("original-text").value = state.source;
    $("exam-instructions").value = draft.instructions || examDirections("");
    $("exam-title").value = draft.title || "";
    $("exam-duration").value = draft.duration || 5;
    view("create");
    renderQuestions();
    state.dirty = true;
    message(
      "Your unfinished exam is restored on this browser. Review it before creating a link.",
    );
    return true;
  } catch {
    return false;
  }
}
function startCreate() {
  state.questions = [];
  state.source = "";
  state.originalSource = "";
  state.sourceName = "";
  state.sourceFormat = "text";
  state.operation = null;
  state.dirty = false;
  $("exam-file").value = "";
  $("paste-text").value = "";
  $("original-text").value = "";
  $("exam-title").value = "";
  $("exam-duration").value = 5;
  $("exam-instructions").value = examDirections("");
  $("review-confirm").checked = false;
  $("review-panel").hidden = true;
  $("paste-panel").open = false;
  view("create");
  message("");
}
function fullLink(exam) {
  if (!exam.student_url) return "";
  const url = new URL(exam.student_url, location.origin);
  return url.origin === location.origin ? url.href : "";
}
const examSummary = (exam) =>
  `${exam.question_count || 0} question${exam.question_count === 1 ? "" : "s"} · ${exam.kind === "practice" ? `${exam.duration_minutes || 5} minutes per student` : "Scheduled examination"}`;
function showShare(exam) {
  state.exam = exam;
  $("share-title").textContent = exam.label || exam.title;
  $("share-summary").textContent = examSummary(exam);
  $("share-link").value = fullLink(exam);
  $("open-exam").href = fullLink(exam);
  view("share");
}
async function copyLink(exam) {
  const link = fullLink(exam);
  if (!link) throw new Error("This exam does not have a student link.");
  try {
    await navigator.clipboard.writeText(link);
    message(
      "Exam link copied. You can paste it into your message to students.",
      "success",
    );
  } catch {
    showShare(exam);
    $("share-link").select();
    message("Select and copy the exam link shown below.");
  }
}
function examRow(exam) {
  const row = node("article", undefined, "exam-row"),
    info = node("div"),
    actions = node("div", undefined, "actions");
  info.append(
    node("h2", exam.label || exam.title),
    node("p", `${examSummary(exam)}${exam.archived ? " · Past exam" : ""}`),
  );
  if (exam.student_url) {
    const copy = node("button", "Copy link", "secondary");
    copy.addEventListener("click", () => busy(copy, () => copyLink(exam)));
    actions.append(copy);
  }
  const responses = node("button", "Responses", "secondary");
  responses.addEventListener("click", () =>
    busy(responses, () => openResponses(exam)),
  );
  actions.append(responses);
  row.append(info, actions);
  return row;
}
async function loadList() {
  const data = await api("/exams");
  state.exams = data.exams || [];
  state.role = data.identity?.role || "owner";
  state.authMode = data.identity?.auth_mode;
  $("sign-out").hidden = state.authMode !== "builtin";
  $("sign-in-again").hidden = true;
  $("new-exam").hidden = !canManage();
  $("signed-in").textContent = canManage()
    ? "Private examiner access"
    : "Examiner · view responses";
  $("exam-list").replaceChildren();
  $("history-list").replaceChildren();
  const current = state.exams.filter(
      (exam) => !exam.archived && exam.question_count > 0,
    ),
    history = state.exams.filter((exam) => exam.archived);
  if (!current.length)
    $("exam-list").append(
      node(
        "p",
        "No exams yet. Create your first exam to get a link for your students.",
        "empty",
      ),
    );
  current.forEach((exam) => $("exam-list").append(examRow(exam)));
  history.forEach((exam) => $("history-list").append(examRow(exam)));
  $("history").hidden = !history.length;
  try {
    $("resume-draft").hidden = !canManage() || !localStorage.getItem(draftKey);
  } catch {
    $("resume-draft").hidden = true;
  }
}
async function createLink() {
  if (!canManage()) throw new Error("Only the owner can create an exam.");
  if (!$("reading-progress").hidden)
    throw new Error(
      "Wait for the document to finish reading, or cancel reading, before creating the exam link.",
    );
  const errors = validateQuestions(state.questions);
  if (errors.length) throw new Error(errors.join("\n"));
  const title = $("exam-title").value.trim(),
    duration = Number($("exam-duration").value);
  if (!title) throw new Error("Give your exam a title.");
  if (!Number.isInteger(duration) || duration < 1 || duration > 360)
    throw new Error("Choose a whole number of minutes from 1 to 360.");
  if (!$("review-confirm").checked)
    throw new Error(
      "Check the questions and time allowed, then tick the review confirmation.",
    );
  const payload = {
      source_text: state.originalSource || state.source || "",
      source_name: state.sourceName || "Manual entry",
      source_format: state.sourceFormat || "text",
      title,
      kind: "practice",
      duration_minutes: duration,
      instructions: $("exam-instructions").value,
      questions: state.questions.map((q) => ({
        number: q.number,
        text: q.text,
        instructions: q.instructions || "",
      })),
    },
    signature = JSON.stringify(payload);
  if (state.operation?.signature !== signature)
    state.operation = {
      signature,
      body: { ...payload, operation_id: crypto.randomUUID() },
    };
  saveLocal();
  $("create-view").inert = true;
  try {
    const result = await api("/exams/create", {
      method: "POST",
      body: JSON.stringify(state.operation.body),
    });
    if (!result.exam?.student_url)
      throw new Error(
        "The exam link has not been confirmed. Check My exams before trying again.",
      );
    state.dirty = false;
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    showShare(result.exam);
    message(
      "Your exam is ready. Copy the link and send it to your students.",
      "success",
    );
  } finally {
    $("create-view").inert = false;
  }
}
async function openResponses(exam) {
  state.exam = exam;
  state.detail = null;
  $("student-response").hidden = true;
  $("responses-title").textContent = exam.label || exam.title;
  $("responses-summary").textContent =
    "All students who use this link are collected here. Blank answers are kept with each submission.";
  $("student-search").value = "";
  $("response-link").hidden = !exam.student_url;
  $("recovery-controls").hidden = !canManage() || exam.archived;
  $("support-exam-description").textContent =
    `Record reference: ${exam.id}. Answers and submission receipts are kept here. Check each delivery below for the status of additional copies.`;
  deliveryOverview().replaceChildren(
    node("h2", "Answer copies"),
    node("p", "Checking automatic Google Sheet and email delivery…"),
  );
  view("responses");
  await loadStudents();
  await loadBackups().catch((error) => {
    deliveryOverview().replaceChildren(
      node("h2", "Answer copies"),
      node("p", "Delivery status could not be checked. Student answers remain available in this desk."),
    );
    message(
      `Responses are available. Backup delivery could not be checked: ${error.message}`,
      "error",
    );
  });
}
async function loadStudents(append = false) {
  const request = (state.studentListRequest =
    (state.studentListRequest || 0) + 1);
  const id = state.exam.id,
    params = new URLSearchParams({ search: $("student-search").value });
  if (append && state.cursor) params.set("cursor", state.cursor);
  const data = await api(`/exams/${encodeURIComponent(id)}/attempts?${params}`);
  if (id !== state.exam.id || request !== state.studentListRequest) return;
  state.cursor = data.next_cursor;
  $("more-students").hidden = !state.cursor;
  if (!append) $("student-list").replaceChildren();
  if (!data.attempts?.length && !append)
    $("student-list").append(
      node(
        "p",
        "No responses yet. Share the exam link with your students.",
        "empty",
      ),
    );
  for (const attempt of data.attempts || []) {
    const row = node("article", undefined, "student-row"),
      info = node("div"),
      status =
        attempt.status === "finalized"
          ? "Submitted"
          : attempt.status === "waiting"
            ? "Waiting"
            : "In progress";
    info.append(
      node("h3", attempt.name),
      node("p", attempt.email),
      node(
        "p",
        `${status} · ${attempt.answered_count || 0} of ${attempt.question_count || state.exam.question_count || 0} answered`,
      ),
    );
    const button = node("button", "View answers", "secondary");
    button.addEventListener("click", () =>
      busy(button, () => openStudent(attempt.id)),
    );
    row.append(info, button);
    $("student-list").append(row);
  }
}
const answerFor = (question, answers) =>
  answers.find(
    (answer) =>
      answer.question_id === (question.id ?? question.number) ||
      answer.question_number === question.number,
  );
async function openStudent(id) {
  const request = (state.studentRequest = (state.studentRequest || 0) + 1);
  const examId = state.exam.id;
  const data = await api(`/attempts/${encodeURIComponent(id)}`);
  if (request !== state.studentRequest || examId !== state.exam.id) return;
  state.detail = data;
  state.eventCursor = null;
  $("student-name").textContent = data.attempt.name;
  $("student-info").textContent =
    `${data.attempt.email} · ${data.receipt ? "Submitted " + time(data.receipt.serverTime) : "In progress — received answers shown below"}`;
  $("student-answers").replaceChildren();
  for (const question of data.questions || []) {
    const article = node("section", undefined, "answer"),
      answer = answerFor(question, data.answers || []);
    article.append(
      node("h3", `Question ${question.number}`),
      node("div", question.text, "question-text"),
    );
    if (question.instructions)
      article.append(node("p", question.instructions, "small"));
    article.append(
      node("h3", "Answer"),
      node(
        "div",
        answer?.text?.trim() ? answer.text : "No answer submitted.",
        "answer-text",
      ),
    );
    $("student-answers").append(article);
  }
  $("support-receipt").textContent = data.receipt
    ? JSON.stringify(data.receipt, null, 2)
    : "No server-confirmed submission receipt yet.";
  $("recovered-drafts").replaceChildren();
  if (data.recovered_drafts?.length) {
    $("recovered-drafts").append(
      node("h3", "Separate late / offline recovered writing"),
      node(
        "p",
        "This writing does not replace the official submitted answer. It is retained for examiner review.",
      ),
    );
    for (const draft of data.recovered_drafts)
      $("recovered-drafts").append(node("pre", JSON.stringify(draft, null, 2)));
  }
  $("support-drawer").open = false;
  $("recovery-result").hidden = true;
  $("recovery-confirm").checked = false;
  $("recovery-reason").value = "";
  $("student-response").hidden = false;
  await loadEvents();
  $("student-response").focus();
  $("student-response").scrollIntoView({ block: "start" });
}
async function loadEvents(append = false) {
  if (!state.detail) return;
  const id = state.detail.attempt.id,
    params = new URLSearchParams();
  if (append && state.eventCursor) params.set("cursor", state.eventCursor);
  const data = await api(
    `/attempts/${encodeURIComponent(id)}/events?${params}`,
  );
  if (id !== state.detail?.attempt.id) return;
  state.eventCursor = data.next_cursor;
  $("more-events").hidden = !state.eventCursor;
  if (!append) $("support-events").replaceChildren();
  for (const event of data.events || []) {
    const li = node("li");
    li.append(
      node(
        "strong",
        `${String(event.type).replaceAll("_", " ")} · ${time(event.received_at)}`,
      ),
      node("pre", JSON.stringify(event.details || {}, null, 2)),
    );
    $("support-events").append(li);
  }
}
function deliveryOverview() {
  let overview = $("delivery-overview");
  if (!overview) {
    overview = node("section", undefined, "delivery-overview");
    overview.id = "delivery-overview";
    overview.setAttribute("aria-label", "Answer copies");
    $("responses-view").insertBefore(
      overview,
      $("responses-view").querySelector(".response-tools"),
    );
  }
  return overview;
}
function spreadsheetLink(value) {
  try {
    const url = new URL(value);
    if (
      url.origin !== "https://docs.google.com" ||
      url.username ||
      url.password ||
      !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/edit)?\/?$/.test(url.pathname)
    )
      return null;
    const link = node("a", "Open answer collection", "button secondary");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch {
    return null;
  }
}
function renderDeliveryStatus(data) {
  const configuration = data.configuration || {},
    counts = data.summary || {},
    overview = deliveryOverview(),
    connections = node("div", undefined, "delivery-connections");
  overview.replaceChildren(node("h2", "Answer copies"));
  for (const [key, title, connected, disconnected] of [
    ["sheets", "Google Sheet", "Connected for automatic copies. Check the delivery jobs below for each student's result.", "Not connected. Automatic answer copies are not being sent to the Sheet."],
    ["email", "Email to your account", "Connected for automatic sending. A completed delivery job confirms acceptance for sending; check your inbox for arrival.", "Not connected. Submission emails are not being sent automatically."],
  ]) {
    const connection = node("div", undefined, "delivery-connection");
    connection.append(node("h3", title));
    connection.append(
      node("p", configuration[key] === true ? connected : disconnected,
        configuration[key] === true ? "small" : "delivery-unavailable"),
    );
    if (key === "sheets") {
      const link = spreadsheetLink(configuration.spreadsheetUrl);
      if (link) connection.append(link);
      if (link && configuration.sheets !== true)
        connection.append(node("p", "This existing workbook can be opened, but automatic copying still needs to be connected.", "small"));
    }
    connections.append(connection);
  }
  overview.append(connections);
  overview.append(node("p", "Student answers and confirmed submission receipts remain available in this desk even when an additional copy has not been delivered.", "small"));
  $("backup-status").replaceChildren(
    node("p", `${counts.sent || 0} completed delivery jobs · ${counts.pending || 0} waiting · ${counts.processing || 0} processing · ${counts.failed || 0} need attention`),
  );
}
async function loadBackups(append = false) {
  const id = state.exam.id,
    params = new URLSearchParams();
  if (append && state.backupCursor) params.set("cursor", state.backupCursor);
  const data = await api(`/exams/${encodeURIComponent(id)}/backups?${params}`);
  if (id !== state.exam.id) return;
  state.backupCursor = data.next_cursor;
  $("more-backups").hidden = !state.backupCursor;
  renderDeliveryStatus(data);
  if (!append) $("backup-list").replaceChildren();
  for (const job of data.jobs || []) {
    const item = node("div", undefined, "backup-job");
    const title = { sheets: "Google Sheet", owner_email: "Owner email", student_receipt: "Student receipt email", r2: "Private archive" }[job.target] || "Additional answer copy",
      key = job.target === "student_receipt" ? "studentReceipt" : job.target === "owner_email" ? "email" : job.target,
      connected = data.configuration?.[key] === true,
      status = job.status === "sent" ? "Completed" : !connected ? "Not connected" : { pending: "Waiting", processing: "Processing", failed: "Needs attention" }[job.status] || "Awaiting confirmation";
    item.append(node("p", `${title} · ${status}`));
    if (job.reference) item.append(node("p", `Reference: ${job.reference}`));
    if (job.status !== "sent" && !connected)
      item.append(node("p", "Automatic delivery is not connected. This student's saved answers remain available in the responses above."));
    else if (job.last_error) item.append(node("p", job.last_error));
    if (canManage() && job.status !== "sent" && connected) {
      const retry = node("button", "Retry delivery", "secondary");
      retry.addEventListener("click", () =>
        busy(retry, async () => {
          await api(`/jobs/${encodeURIComponent(job.id)}/retry`, {
            method: "POST",
            body: "{}",
          });
          await loadBackups();
          message(
            "Delivery retry requested. Its status will confirm when it is complete.",
          );
        }),
      );
      item.append(retry);
    }
    $("backup-list").append(item);
  }
}
function download(content, name, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = node("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function studentPdfData(exam, detail, makePdfData) {
  const data = makePdfData({
    exam: {
      ...exam,
      title: exam.label || exam.title,
      questionCount: detail.questions?.length ?? exam.question_count,
    },
    attempt: {
      ...detail.attempt,
      startAt: detail.attempt.started_at,
      questions: detail.questions || [],
      answers: (detail.answers || []).map(answer => ({
        ...answer,
        questionId: answer.question_id,
      })),
      recoveredDrafts: (detail.recovered_drafts || []).map(draft => ({
        ...draft,
        questionId: draft.question_id,
        receivedAt: draft.received_at,
        clientTime: draft.client_time,
      })),
      receipt: detail.receipt,
    },
  });
  if (!detail.receipt) {
    if (detail.attempt.status === "finalized") {
      data.notice = "This professor copy contains the finalized answer record. Its submission receipt has not yet been confirmed. Any separately recovered late or offline writing is marked for examiner review.";
    } else {
      data.status = "SAVED ANSWERS - NOT SUBMITTED";
      data.notice = "This professor copy contains answers received by the examination service. It does not confirm final submission. Any separately recovered late or offline writing is marked for examiner review.";
      for (const question of data.questions) question.answerLabel = "Received answer";
    }
  }
  return data;
}
function bind() {
  $("sign-out").onclick = () =>
    busy($("sign-out"), async () => {
      if (state.dirty) {
        const saved = saveLocal();
        const prompt = saved
          ? "Your unfinished exam is saved on this browser. Sign out now?"
          : "This browser could not keep your unfinished exam. Copy your questions before signing out. Sign out anyway?";
        if (!confirm(prompt)) return;
      }
      const result = await api("/logout", { method: "POST", body: "{}" });
      if (!result.signed_out)
        throw new Error("Sign-out could not be confirmed. Please try again.");
      state.dirty = false;
      location.assign("/admin/login");
    });
  $("new-exam").onclick = () => {
    if (state.dirty && resumeDraft()) return;
    startCreate();
  };
  $("resume-draft").onclick = resumeDraft;
  for (const id of ["back-list", "share-back", "responses-back"])
    $(id).onclick = () =>
      busy($(id), async () => {
        await loadList();
        view("list");
        message("");
      });
  $("exam-file").onchange = () => readFile($("exam-file").files[0]);
  $("cancel-reading").onclick = () => state.readController?.abort();
  const drop = $("upload-area");
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("dragover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("dragover");
    readFile(event.dataTransfer.files[0]);
  });
  $("read-paste").onclick = () =>
    busy($("read-paste"), async () => {
      acceptExtracted(examFromText($("paste-text").value));
    });
  $("read-original").onclick = () =>
    busy($("read-original"), async () => {
      acceptExtracted(examFromText($("original-text").value), {
        keepOriginal: true,
      });
    });
  $("original-text").oninput = () => {
    state.source = $("original-text").value;
    persist();
  };
  $("download-original").onclick = () =>
    download(
      state.originalSource || state.source,
      "original-question-paper.txt",
    );
  $("manual-question").onclick = $("add-question").onclick = addQuestion;
  for (const id of ["exam-title", "exam-duration", "exam-instructions"])
    $(id).addEventListener("input", persist);
  $("create-link").onclick = () => busy($("create-link"), createLink);
  $("copy-link").onclick = () =>
    busy($("copy-link"), () => copyLink(state.exam));
  $("response-link").onclick = () =>
    busy($("response-link"), () => copyLink(state.exam));
  $("share-responses").onclick = () =>
    busy($("share-responses"), () => openResponses(state.exam));
  $("search-students").onclick = () =>
    busy($("search-students"), () => loadStudents());
  $("refresh-students").onclick = () =>
    busy($("refresh-students"), () => loadStudents());
  $("student-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("search-students").click();
  });
  $("more-students").onclick = () =>
    busy($("more-students"), () => loadStudents(true));
  $("close-response").onclick = () => {
    $("student-response").hidden = true;
    state.detail = null;
  };
  $("more-events").onclick = () =>
    busy($("more-events"), () => loadEvents(true));
  $("refresh-backups").onclick = () =>
    busy($("refresh-backups"), () => loadBackups());
  $("more-backups").onclick = () =>
    busy($("more-backups"), () => loadBackups(true));
  $("recover-student").onclick = () =>
    busy($("recover-student"), async () => {
      const reason = $("recovery-reason").value.trim();
      if (!reason || !$("recovery-confirm").checked)
        throw new Error(
          "Verify identity, enter a reason and check the recovery confirmation.",
        );
      const result = await api(
        `/attempts/${encodeURIComponent(state.detail.attempt.id)}/recovery`,
        { method: "POST", body: JSON.stringify({ reason, confirmed: true }) },
      );
      $("recovery-result").hidden = false;
      $("recovery-result").textContent =
        `Share this one-use link privately with the verified student only. Expires ${time(result.expires_at)}.\n${result.recovery_url}`;
      $("recovery-confirm").checked = false;
    });
  $("download-all").onclick = () =>
    busy($("download-all"), async () => {
      const response = await fetch(
        `/api/admin/exams/${encodeURIComponent(state.exam.id)}/export.csv`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("text/csv")
      )
        throw new Error(
          "The answer download could not be confirmed. Please try again.",
        );
      download(
        await response.text(),
        "exam-answers.csv",
        "text/csv;charset=utf-8",
      );
    });
  $("download-student").onclick = () =>
    busy($("download-student"), async () => {
      const detail = state.detail, exam = state.exam;
      if (!detail) throw new Error("Open a student's answers before downloading the PDF.");
      message("Preparing the student's PDF…");
      try {
        const { examinationPdfData, createExaminationPdf } = await import("./answer-pdf.mjs"),
          data = studentPdfData(exam, detail, examinationPdfData),
          bytes = await createExaminationPdf(data);
        download(bytes, "DueDiligence-Student-Answers.pdf", "application/pdf");
        message("The student PDF is ready. It contains the complete questions and received answers.", "success");
      } catch {
        throw new Error("The student PDF could not be prepared. The saved answers remain available here. Please try again.");
      }
    });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  setInterval(() => {
    if (!document.hidden && !$("responses-view").hidden && !state.cursor)
      loadStudents().catch(() => {});
  }, 20000);
}
async function init() {
  bind();
  try {
    await loadList();
    view("list");
    message("");
  } catch (error) {
    message(
      `Your examiner desk is not available. ${error.message} Sign in through the private examiner address, or contact the site owner.`,
      "error",
    );
  }
}
init();
