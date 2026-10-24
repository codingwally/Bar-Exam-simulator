import {
  questionsFromCSV,
  questionsFromText,
  validateQuestions,
  scheduleFromInputs,
  CSV_TEMPLATE,
} from "./import.mjs";

const $ = (id) => document.getElementById(id);
const state = {
  id: "official",
  exam: null,
  questions: [],
  version: 0,
  dirty: false,
  review: null,
  attempts: [],
  attemptCursor: null,
  eventCursor: null,
  selected: null,
  detail: null,
  loadingAttempts: false,
  serial: 0,
  attemptSerial: 0,
  eventSerial: 0,
};
const pht = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
  timeStyle: "medium",
  hour12: false,
});
const formatTime = (value) => {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return value != null && Number.isFinite(timestamp)
    ? `${pht.format(new Date(timestamp))} PHT`
    : "Not recorded";
};
const string = (value) => (value == null ? "" : String(value));
const isPractice = () =>
  state.exam?.kind === "practice" || state.id === "practice";
const isArchived = () => state.exam?.archived === true;
const canManage = () => !["examiner", "read_only"].includes(state.role);

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = string(text);
  if (className) element.className = className;
  return element;
}

function notice(message, type = "") {
  $("notice").textContent = message;
  $("notice").className = `notice ${type}`;
  $("notice").hidden = false;
}

function loadedNotice(message, type = "") {
  const warnings = state.loadWarnings || [];
  notice(
    warnings.length
      ? `${message}\nSome sections could not load: ${warnings.join(" ")}`
      : message,
    warnings.length ? "error" : type,
  );
}

async function api(path, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api/admin${path}`, {
      ...options,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body
          ? {
              "Content-Type": "application/json",
              "X-Exam-Request": "examiner-dashboard",
            }
          : {}),
        ...options.headers,
      },
    });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error(
        "The server did not return an examiner response. Refresh and check that private access is configured.",
      );
    }
    if (!response.ok) {
      const error = new Error(
        payload.message ||
          payload.error?.message ||
          (typeof payload.error === "string" ? payload.error : "") ||
          `The request could not be completed (${response.status}).`,
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error(
        "The server response took too long. A save may have arrived; check the latest server state before repeating a scheduling or recovery action. Your current draft remains in this page.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "The server could not be reached. Keep this page open and retry after your connection returns.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function action(button, work) {
  if (button.disabled) return;
  button.disabled = true;
  state.busy = (state.busy || 0) + 1;
  $("exam").disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await work();
  } catch (error) {
    notice(
      `${error.message} Nothing is marked successful until the server confirms it.`,
      "error",
    );
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = false;
    state.busy--;
    $("exam").disabled = state.busy > 0;
    if (button.id === "schedule-save")
      button.disabled = !$("schedule-confirm").checked;
  }
}

function download(text, filename, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = node("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function markDirty() {
  state.dirty = true;
  $("draft-state").textContent = "Unsaved draft changes";
  $("schedule-review").hidden = true;
  state.review = null;
}

function errorList(errors) {
  const target = $("question-errors");
  target.replaceChildren();
  target.hidden = !errors.length;
  if (errors.length) {
    target.append(node("strong", "Check these questions before continuing."));
    const list = node("ul");
    errors.forEach((error) => list.append(node("li", error)));
    target.append(list);
  }
}

function field(labelText, value, options = {}) {
  const wrap = node("div"),
    label = node("label", labelText),
    input = node(options.multiline ? "textarea" : "input");
  input.id = options.id;
  label.htmlFor = input.id;
  if (options.multiline) input.rows = options.rows || 7;
  else input.type = options.type || "text";
  if (options.type === "number") {
    input.min = "0";
    input.step = "any";
  }
  input.value = string(value);
  input.addEventListener("input", () => {
    options.change(input.value);
    markDirty();
  });
  wrap.append(label, input);
  return wrap;
}

function questionPreview(container, questions) {
  container.replaceChildren();
  for (const q of questions) {
    const article = node("article");
    article.append(
      node("h4", `Question ${q.number}`),
      node("div", q.text, "question-text"),
    );
    if (q.instructions)
      article.append(node("p", `Instructions: ${q.instructions}`, "small"));
    if (q.points !== undefined && q.points !== null)
      article.append(node("p", `${q.points} points`, "small"));
    container.append(article);
  }
}

function renderQuestions() {
  const target = $("question-editor");
  target.replaceChildren();
  $("question-count").textContent =
    `${state.questions.length} question${state.questions.length === 1 ? "" : "s"} · complete text shown below`;
  $("empty-questions").hidden = !!state.questions.length;
  const editable = canManage() && !isPractice() && !isArchived();
  for (const [index, q] of state.questions.entries()) {
    const item = node("li", undefined, "question-item"),
      heading = node("div", undefined, "question-heading");
    heading.append(node("h3", `Question ${q.number}`));
    if (editable) {
      const actions = node("div", undefined, "question-actions");
      for (const [label, direction, disabled] of [
        ["Move up", -1, index === 0],
        ["Move down", 1, index === state.questions.length - 1],
      ]) {
        const button = node("button", label, "secondary");
        button.type = "button";
        button.disabled = disabled;
        button.setAttribute("aria-label", `${label}: question ${q.number}`);
        button.addEventListener("click", () => {
          [state.questions[index], state.questions[index + direction]] = [
            state.questions[index + direction],
            state.questions[index],
          ];
          state.questions.forEach((question, i) => (question.number = i + 1));
          markDirty();
          renderQuestions();
          $("question-editor")
            .children[index + direction]?.querySelector("textarea")
            ?.focus();
        });
        actions.append(button);
      }
      const remove = node("button", "Remove", "secondary");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove question ${q.number}`);
      remove.addEventListener("click", () => {
        if (
          q.text.trim() &&
          !confirm(
            `Remove question ${q.number} from this draft? The scheduled version is preserved.`,
          )
        )
          return;
        state.questions.splice(index, 1);
        state.questions.forEach((question, i) => (question.number = i + 1));
        markDirty();
        renderQuestions();
      });
      actions.append(remove);
      heading.append(actions);
    }
    item.append(heading);
    if (editable) {
      item.append(
        field(`Complete question ${q.number} text`, q.text, {
          multiline: true,
          id: `question-${index}`,
          change: (value) => (q.text = value),
        }),
      );
      const extras = node("div", undefined, "question-extras");
      extras.append(
        field("Instructions (optional)", q.instructions, {
          multiline: true,
          rows: 2,
          id: `instructions-${index}`,
          change: (value) => (q.instructions = value),
        }),
        field("Points (optional)", q.points, {
          type: "number",
          id: `points-${index}`,
          change: (value) => {
            if (value === "") delete q.points;
            else q.points = Number(value);
          },
        }),
      );
      item.append(extras);
    } else {
      item.append(node("div", q.text, "answer-text"));
      if (q.instructions) item.append(node("p", q.instructions));
    }
    target.append(item);
  }
  errorList([]);
}

function replaceQuestions(questions) {
  if (
    state.questions.length &&
    !confirm(
      "Replace the questions currently in the draft editor? The preserved scheduled version will not change.",
    )
  )
    return;
  state.questions = questions;
  markDirty();
  renderQuestions();
  notice(
    `Imported ${questions.length} complete questions into the draft editor. Check every item below, then save the draft.`,
  );
  $("questions-heading").scrollIntoView({ block: "start", behavior: "smooth" });
}

async function saveDraft() {
  const errors = validateQuestions(state.questions);
  errorList(errors);
  if (errors.length) {
    $("question-errors").scrollIntoView({ block: "center" });
    throw new Error("The draft has validation errors.");
  }
  const questions = structuredClone(state.questions),
    serial = state.serial;
  const examId = state.id;
  let saved;
  try {
    saved = await api(`/exams/${encodeURIComponent(examId)}/draft`, {
      method: "PUT",
      body: JSON.stringify({ questions, expected_version: state.version }),
    });
  } catch (error) {
    // A response can disappear after the server committed the draft. Verify
    // its contents before treating a retry conflict as a failed save.
    try {
      const latest = await api(`/exams/${encodeURIComponent(examId)}`);
      const canonical = (items) =>
        JSON.stringify(
          items.map((q) => ({
            number: q.number,
            text: q.text.trim(),
            instructions: q.instructions || "",
            points:
              q.points == null || q.points === "" ? null : Number(q.points),
          })),
        );
      if (canonical(latest.draft?.questions || []) !== canonical(questions))
        throw error;
      saved = latest;
    } catch {
      throw error;
    }
  }
  if (serial !== state.serial) return;
  state.version = saved.draft?.version ?? saved.version ?? state.version + 1;
  // Typing during a slow save must remain visibly unsaved rather than be discarded.
  const unchanged =
    JSON.stringify(questions) === JSON.stringify(state.questions);
  state.dirty = !unchanged;
  $("draft-state").textContent = unchanged
    ? `Draft version ${state.version} saved`
    : `Draft version ${state.version} saved; newer edits unsaved`;
  notice(
    unchanged
      ? "Draft saved. The examination opens only after you review and schedule it."
      : "The server saved the earlier draft. Your newer edits remain in the editor; save again before scheduling.",
    unchanged ? "success" : "",
  );
  if (!unchanged) throw new Error("Save the newer changes before scheduling.");
}

async function loadExam() {
  const serial = ++state.serial;
  $("desk").inert = true;
  $("desk").setAttribute("aria-busy", "true");
  try {
    state.attemptSerial++;
    state.eventSerial++;
    state.detail = null;
    state.selected = null;
    state.review = null;
    $("response").hidden = true;
    $("schedule-review").hidden = true;
    const result = await api(`/exams/${encodeURIComponent(state.id)}`);
    if (serial !== state.serial) return;
    state.exam = result.exam;
    state.questions = structuredClone(
      isPractice() || isArchived()
        ? result.published?.questions || result.draft?.questions || []
        : result.draft?.questions || [],
    );
    state.version = result.draft?.version ?? 0;
    state.dirty = false;
    const phase = state.exam.state || "UNCONFIGURED";
    $("exam-status").textContent =
      `${phase.replaceAll("_", " ")}${state.exam.starts_at ? ` · ${phase === "SCHEDULED" ? "Opens" : "Opened"} ${formatTime(state.exam.starts_at)}` : ""}`;
    $("draft-state").textContent = isArchived()
      ? "Preserved historical examination"
      : isPractice()
        ? "Fixed approved practice question"
        : `Draft version ${state.version}`;
    $("question-tools").hidden = !canManage() || isPractice() || isArchived();
    $("schedule-form").hidden =
      !canManage() ||
      isPractice() ||
      isArchived() ||
      ["OPEN", "CLOSED", "CANCELLED"].includes(phase);
    $("practice-schedule").hidden = !isPractice();
    $("schedule-help").hidden = isPractice();
    $("exceptional-controls").hidden = !canManage() || isArchived();
    $("admission-controls").hidden = !canManage() || isArchived();
    $("admission-status").textContent =
      state.exam.admission_enabled === true
        ? "New registrations are enabled while this examination is available."
        : state.exam.admission_enabled === false
          ? "New registrations are disabled. Existing attempts continue."
          : "Current registration-link status is not supplied by this server.";
    $("next-exam").hidden =
      !canManage() ||
      isPractice() ||
      isArchived() ||
      !["CLOSED", "CANCELLED", "UNCONFIGURED"].includes(phase);
    $("current-schedule").hidden =
      isPractice() || !state.exam.starts_at || !state.exam.ends_at;
    $("current-schedule").textContent =
      state.exam.starts_at && state.exam.ends_at
        ? `Confirmed schedule: opens ${formatTime(state.exam.starts_at)}; closes ${formatTime(state.exam.ends_at)}. All official examinees share this closing time.`
        : "";
    $("published-note").hidden = !result.published;
    $("published-note").textContent = result.published
      ? `The scheduled version ${result.published.version ?? ""} is preserved. Editing this draft does not change it.${["OPEN", "CLOSED"].includes(phase) ? " This examination has started; its questions and official snapshots cannot be replaced here." : " Rescheduling a changed version requires a reason and fresh confirmation."}`
      : "";
    $("published-questions").hidden = !result.published?.questions?.length;
    if (result.published?.questions)
      questionPreview($("published-preview"), result.published.questions);
    const link = state.exam.student_url;
    $("student-link").replaceChildren(node("span", "Student link: "));
    if (link) {
      const url = new URL(link, location.origin);
      if (url.protocol === "https:" || url.origin === location.origin) {
        const anchor = node("a", url.href);
        anchor.href = url.href;
        $("student-link").append(
          anchor,
          node("span", " · unchanged when questions are saved or scheduled."),
        );
      }
    } else
      $("student-link").append(
        node(
          "span",
          isArchived()
            ? "This historical examination is retained privately. The official student link belongs to the current examination."
            : "Available once the private deployment is configured.",
        ),
      );
    // Official dates intentionally remain empty until the examiner supplies them.
    for (const id of [
      "start-date",
      "start-time",
      "end-date",
      "end-time",
      "duration",
    ])
      $(id).value = "";
    renderQuestions();
    const results = await Promise.allSettled([
      loadAttempts(),
      loadEvents(),
      loadBackups(),
    ]);
    state.loadWarnings = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message);
  } finally {
    if (serial === state.serial) {
      $("desk").inert = false;
      $("desk").setAttribute("aria-busy", "false");
    }
  }
}

function countdown(target) {
  const seconds = Math.max(
      0,
      Math.ceil((Date.parse(target) - Date.now()) / 1000),
    ),
    days = Math.floor(seconds / 86400);
  const clock = [
    Math.floor(seconds / 3600) % 24,
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return `${days ? `${days} day${days === 1 ? "" : "s"} ` : ""}${clock}`;
}

function updateCountdownExample() {
  if (!state.review) return;
  const { starts_at, ends_at } = state.review;
  const now = Date.now();
  $("countdown-example").textContent =
    now < Date.parse(starts_at)
      ? `Student preview now: Test is not available yet — examination opens in ${countdown(starts_at)}. This is the full time remaining, even days before opening.`
      : now < Date.parse(ends_at)
        ? `Student preview now: Examination in progress — closes in ${countdown(ends_at)}.`
        : "This schedule has already ended. Choose a future opening.";
}

async function reviewSchedule(event) {
  event.preventDefault();
  await action($("schedule-form").querySelector("button"), async () => {
    const schedule = scheduleFromInputs({
      startDate: $("start-date").value,
      startTime: $("start-time").value,
      endDate: $("end-date").value,
      endTime: $("end-time").value,
      durationMinutes: $("duration").value,
      mode: document.querySelector("[name=end-mode]:checked").value,
    });
    if (Date.parse(schedule.starts_at) <= Date.now())
      throw new Error("Choose a future opening time.");
    if (state.dirty) await saveDraft();
    const errors = validateQuestions(state.questions);
    errorList(errors);
    if (errors.length)
      throw new Error("Complete and save the questions before scheduling.");
    state.review = {
      ...schedule,
      version: state.version,
      questions: JSON.stringify(state.questions),
    };
    const minutes =
      (Date.parse(schedule.ends_at) - Date.parse(schedule.starts_at)) / 60000;
    $("schedule-summary").textContent =
      `${state.questions.length} questions. Opens ${formatTime(schedule.starts_at)}. Closes ${formatTime(schedule.ends_at)}. Common duration: ${minutes} minutes. Late arrivals receive only the remaining time.`;
    questionPreview($("review-questions"), state.questions);
    updateCountdownExample();
    $("schedule-confirm").checked = false;
    $("schedule-save").disabled = true;
    $("schedule-review").hidden = false;
    $("schedule-review").focus();
  });
}

async function loadAttempts(append = false) {
  const request = ++state.attemptSerial,
    serial = state.serial;
  const params = new URLSearchParams({ search: $("search").value.trim() });
  if (append && state.attemptCursor) params.set("cursor", state.attemptCursor);
  const result = await api(
    `/exams/${encodeURIComponent(state.id)}/attempts?${params}`,
  );
  if (request !== state.attemptSerial || serial !== state.serial) return;
  state.attempts = append
    ? [...state.attempts, ...(result.attempts || [])]
    : result.attempts || [];
  state.attemptCursor = result.next_cursor || null;
  $("more-attempts").hidden = !state.attemptCursor;
  $("attempt-update").textContent =
    `${state.attempts.length} attempt${state.attempts.length === 1 ? "" : "s"} shown${state.attemptCursor ? " · more available below" : ""}. Updated ${formatTime(new Date().toISOString())}. Refreshes every 20 seconds when showing the first page.`;
  const target = $("attempts");
  target.replaceChildren();
  if (!state.attempts.length) {
    target.append(
      node("p", "No registered attempts match this view.", "empty"),
    );
    return;
  }
  for (const attempt of state.attempts) {
    const row = node("article", undefined, "attempt"),
      identity = node("div"),
      meta = node("dl");
    identity.append(
      node("h3", attempt.name),
      node("p", attempt.email),
      node("p", `Attempt ${attempt.id}`, "small"),
    );
    for (const [key, value] of [
      ["Status", attempt.status],
      ["Started", formatTime(attempt.started_at)],
      [
        "Answers",
        `${attempt.answered_count ?? 0} / ${attempt.question_count ?? state.exam.question_count ?? "—"}`,
      ],
      ["Last server save", formatTime(attempt.last_saved_at)],
      ["Last observed", formatTime(attempt.last_seen_at)],
      ["Connection", "Unknown; review recorded observations"],
      [
        "Backup",
        typeof attempt.backup_status === "object"
          ? JSON.stringify(attempt.backup_status)
          : attempt.backup_status || "Check backup queue",
      ],
    ])
      meta.append(node("dt", key), node("dd", value));
    const open = node("button", "View answers", "secondary");
    open.type = "button";
    open.setAttribute("aria-label", `View answers for ${attempt.name}`);
    open.addEventListener("click", () =>
      action(open, () => openAttempt(attempt.id)),
    );
    row.append(identity, meta, open);
    target.append(row);
  }
}

function answerFor(question, answers) {
  return answers.find(
    (a) =>
      string(a.question_id) === string(question.id ?? question.number) ||
      (a.question_number != null &&
        Number(a.question_number) === Number(question.number)),
  );
}

function receiptText(receipt) {
  return typeof receipt === "string"
    ? receipt
    : JSON.stringify(receipt, null, 2);
}

function studentReport(detail) {
  const {
    attempt,
    questions = [],
    answers = [],
    receipt,
    recovered_drafts = [],
  } = detail;
  const lines = [
    "DUE DILIGENCE — CONSTITUTIONAL LAW I",
    state.exam?.label || state.id,
    `Student: ${attempt.name}`,
    `Email: ${attempt.email}`,
    `Attempt: ${attempt.id}`,
    `Status: ${attempt.status}`,
    `Deadline: ${formatTime(attempt.deadline_at)}`,
    "",
    "OFFICIAL ANSWER SET",
  ];
  for (const q of questions) {
    const answer = answerFor(q, answers);
    lines.push(
      "",
      `QUESTION ${q.number}`,
      q.text,
      q.instructions || "",
      `Revision: ${answer?.revision ?? "none"}; received: ${formatTime(answer?.saved_at)}; checksum: ${answer?.hash || "none"}`,
      answer?.text?.trim() ? answer.text : "[BLANK]",
    );
  }
  lines.push(
    "",
    "SERVER RECEIPT",
    receipt ? receiptText(receipt) : "Not finalized / no server receipt yet.",
  );
  if (recovered_drafts.length) {
    lines.push(
      "",
      "SEPARATE LATE / OFFLINE RECOVERED DRAFTS — FOR EXAMINER REVIEW",
      "These do not replace the official on-time answer set.",
    );
    for (const draft of recovered_drafts)
      lines.push("", JSON.stringify(draft, null, 2));
  }
  return lines.join("\n");
}

async function openAttempt(id) {
  const serial = state.serial;
  const result = await api(`/attempts/${encodeURIComponent(id)}`);
  if (serial !== state.serial) return;
  state.selected = id;
  state.detail = result;
  const {
    attempt,
    questions = [],
    answers = [],
    receipt,
    recovered_drafts = [],
  } = result;
  $("response-title").textContent = attempt.name;
  $("response-meta").textContent =
    `${attempt.email} · Attempt ${attempt.id} · ${attempt.status} · Original deadline ${formatTime(attempt.deadline_at)}.`;
  $("receipt").textContent = receipt
    ? `Server receipt\n${receiptText(receipt)}`
    : "No server-issued receipt yet. An active attempt is not a finalized submission.";
  $("receipt-download").hidden = !receipt;
  $("practice-readiness").hidden = !isPractice();
  $("practice-reset-control").hidden =
    !canManage() || !isPractice() || isArchived();
  $("recover").closest(".recovery").hidden = !canManage() || isArchived();
  $("readiness-checks").replaceChildren();
  if (isPractice()) {
    const labels = {
      registered: "Registration",
      typing: "Typing",
      local_save: "On-device save",
      server_save: "Server save",
      disconnect: "Disconnect exercised",
      reconnect: "Reconnect exercised",
      finalized: "Server-confirmed finalization",
    };
    for (const [key, label] of Object.entries(labels))
      $("readiness-checks").append(
        node(
          "li",
          `${label}: ${result.readiness?.[key] === true ? "Observed" : "Not yet confirmed"}`,
        ),
      );
  }
  const target = $("answer-set");
  target.replaceChildren();
  if (!questions.length)
    target.append(
      node(
        "p",
        "No question set is attached yet. A waiting registration has no answers to disclose.",
        "empty",
      ),
    );
  for (const q of questions) {
    const answer = answerFor(q, answers),
      item = node("article", undefined, "answer");
    item.append(
      node("h4", `Question ${q.number}`),
      node("div", q.text, "answer-text"),
    );
    if (q.instructions) item.append(node("p", q.instructions, "small"));
    item.append(
      node(
        "p",
        `Revision ${answer?.revision ?? "none"} · Received ${formatTime(answer?.saved_at)} · Checksum ${answer?.hash || "none"}`,
        "small",
      ),
      node("h4", "Received answer"),
      node(
        "div",
        answer?.text?.trim() ? answer.text : "[BLANK]",
        "answer-text",
      ),
    );
    target.append(item);
  }
  $("late-drafts").hidden = !recovered_drafts.length;
  $("recovered-set").replaceChildren();
  for (const draft of recovered_drafts)
    $("recovered-set").append(node("pre", JSON.stringify(draft, null, 2)));
  $("recovery-reason").value = "";
  $("recovery-confirm").checked = false;
  $("recovery-result").hidden = true;
  $("response").hidden = false;
  $("response").focus();
  await loadEvents();
}

async function loadEvents(append = false) {
  const request = ++state.eventSerial,
    serial = state.serial;
  const params = new URLSearchParams({
    search: $("event-search").value.trim(),
  });
  if (state.selected) params.set("attempt_id", state.selected);
  if (append && state.eventCursor) params.set("cursor", state.eventCursor);
  const result = await api(
    `/exams/${encodeURIComponent(state.id)}/events?${params}`,
  );
  if (request !== state.eventSerial || serial !== state.serial) return;
  state.eventCursor = result.next_cursor || null;
  $("more-events").hidden = !state.eventCursor;
  $("events-scope").textContent = state.selected
    ? `Showing attempt ${state.selected}. Client times are untrusted observations; received times come from the server.`
    : "Showing all examinees. Client times are untrusted observations; received times come from the server.";
  if (!append) $("events").replaceChildren();
  if (!append && !result.events?.length)
    $("events").append(
      node("li", "No recorded events match this view.", "empty"),
    );
  for (const event of result.events || []) {
    const li = node("li");
    li.append(
      node("strong", string(event.type).replaceAll("_", " ")),
      node(
        "p",
        `Attempt ${event.attempt_id || state.selected || "—"}${event.question_id != null ? ` · Question ${event.question_id}` : ""}`,
      ),
      node(
        "p",
        `Server received ${formatTime(event.received_at)} · Client observed ${formatTime(event.client_time)}`,
        "small",
      ),
    );
    if (event.details != null)
      li.append(
        node(
          "pre",
          typeof event.details === "string"
            ? event.details
            : JSON.stringify(event.details, null, 2),
        ),
      );
    $("events").append(li);
  }
}

async function loadBackups(append = false) {
  const serial = state.serial,
    request = (state.backupSerial = (state.backupSerial || 0) + 1);
  const params = new URLSearchParams({ status: $("backup-filter").value });
  if (append && state.backupCursor) params.set("cursor", state.backupCursor);
  const result = await api(
    `/exams/${encodeURIComponent(state.id)}/backups?${params}`,
  );
  if (serial !== state.serial || request !== state.backupSerial) return;
  state.backupCursor = result.next_cursor || null;
  state.backupJobs = append
    ? [...(state.backupJobs || []), ...(result.jobs || [])]
    : result.jobs || [];
  $("more-backups").hidden = !state.backupCursor;
  $("backup-summary").textContent = result.summary
    ? `All backup jobs: ${result.summary.sent || 0} sent / completed · ${result.summary.pending || 0} pending · ${result.summary.processing || 0} processing · ${result.summary.failed || 0} failed. ${state.backupJobs.length} jobs shown in this view${state.backupCursor ? "; more below" : ""}.`
    : `${state.backupJobs.length} backup jobs shown. Status is confirmed by the delivery service.`;
  const configuration = node("dl", undefined, "configuration");
  for (const [key, value] of Object.entries(result.configuration || {})) {
    const row = node("div");
    row.append(
      node("dt", key.replaceAll("_", " ")),
      node(
        "dd",
        typeof value === "boolean"
          ? value
            ? "Configured"
            : "Not configured — action required"
          : typeof value === "object"
            ? JSON.stringify(value)
            : value,
      ),
    );
    configuration.append(row);
  }
  $("backup-configuration").replaceChildren(configuration);
  const target = $("backup-jobs");
  target.replaceChildren();
  if (!state.backupJobs.length)
    target.append(
      node(
        "p",
        "No backup jobs in this view. Configuration alone is not proof of delivered copies.",
        "empty",
      ),
    );
  for (const job of state.backupJobs) {
    const row = node("div", undefined, "job"),
      text = node("div");
    text.append(
      node("p", `${job.target} · ${job.status}`),
      node(
        "p",
        `Attempt ${job.attempt_id || "—"} · ${job.attempts ?? 0} delivery attempts`,
        "small",
      ),
    );
    if (job.reference) {
      const reference = node("p", undefined, "small");
      try {
        const url = new URL(job.reference);
        if (
          url.protocol === "https:" &&
          url.hostname === "docs.google.com" &&
          url.pathname.startsWith("/spreadsheets/")
        ) {
          const link = node("a", "Open private Google Sheet");
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          reference.append(link);
        } else reference.textContent = `Delivery reference: ${job.reference}`;
      } catch {
        reference.textContent = `Delivery reference: ${job.reference}`;
      }
      text.append(reference);
    }
    if (job.last_error)
      text.append(node("p", `Last error: ${job.last_error}`, "small"));
    if (job.next_attempt_at)
      text.append(
        node("p", `Next retry ${formatTime(job.next_attempt_at)}`, "small"),
      );
    row.append(text);
    if (
      canManage() &&
      !["sent", "complete", "completed", "succeeded", "delivered"].includes(
        job.status,
      )
    ) {
      const retry = node("button", "Retry backup", "secondary");
      retry.type = "button";
      retry.addEventListener("click", () =>
        action(retry, async () => {
          await api(`/jobs/${encodeURIComponent(job.id)}/retry`, {
            method: "POST",
            body: "{}",
          });
          notice(
            "Retry queued. Delivery is confirmed only when its status changes to sent or complete.",
          );
          await loadBackups();
        }),
      );
      row.append(retry);
    }
    target.append(row);
  }
}

function bind() {
  $("exam").addEventListener("change", async () => {
    if (
      state.dirty &&
      !confirm(
        "Leave this unsaved draft? Save it first to keep the latest question edits.",
      )
    ) {
      $("exam").value = state.id;
      return;
    }
    const previousId = state.id;
    state.id = $("exam").value;
    try {
      await loadExam();
      loadedNotice(`${state.exam.label || "Examination"} records loaded.`);
    } catch (error) {
      state.id = previousId;
      $("exam").value = previousId;
      notice(error.message, "error");
    }
  });
  $("add-question").addEventListener("click", () => {
    state.questions.push({
      number: state.questions.length + 1,
      text: "",
      instructions: "",
    });
    markDirty();
    renderQuestions();
    $(`question-${state.questions.length - 1}`).focus();
  });
  $("save-draft").addEventListener("click", () =>
    action($("save-draft"), saveDraft),
  );
  $("download-draft").addEventListener("click", () =>
    download(
      JSON.stringify(
        { label: state.exam.label, questions: state.questions },
        null,
        2,
      ),
      `private-question-draft-${state.id}.json`,
      "application/json",
    ),
  );
  $("parse").addEventListener("click", () => {
    try {
      replaceQuestions(questionsFromText($("paste").value));
    } catch (error) {
      errorList(error.message.split("\n"));
    }
  });
  $("question-file").addEventListener("change", () =>
    action($("parse"), async () => {
      const file = $("question-file").files?.[0];
      if (!file) return;
      if (!/\.csv$/i.test(file.name))
        throw new Error(
          "Use a CSV file. DOCX and XLSX imports are not supported.",
        );
      if (file.size > 2 * 1024 * 1024)
        throw new Error(
          "CSV is larger than 2 MB. Split the file or use manual entry; no text will be truncated.",
        );
      replaceQuestions(questionsFromCSV(await file.text()));
      $("question-file").value = "";
    }),
  );
  $("template").addEventListener("click", () =>
    download(
      CSV_TEMPLATE,
      "constitutional-law-questions-template.csv",
      "text/csv;charset=utf-8",
    ),
  );
  for (const input of document.querySelectorAll("[name=end-mode]"))
    input.addEventListener("change", () => {
      const duration = input.value === "duration" && input.checked;
      $("end-fields").hidden = duration;
      $("duration-field").hidden = !duration;
      $("end-date").required = $("end-time").required = !duration;
      $("duration").required = duration;
      $("schedule-review").hidden = true;
      state.review = null;
    });
  $("schedule-form").addEventListener("input", () => {
    state.review = null;
    $("schedule-review").hidden = true;
  });
  $("schedule-form").addEventListener("submit", reviewSchedule);
  $("schedule-confirm").addEventListener("change", () => {
    $("schedule-save").disabled = !$("schedule-confirm").checked;
  });
  $("schedule-back").addEventListener("click", () => {
    state.review = null;
    $("schedule-review").hidden = true;
    $("start-date").focus();
  });
  $("schedule-save").addEventListener("click", () =>
    action($("schedule-save"), async () => {
      if (!state.review || !$("schedule-confirm").checked)
        throw new Error(
          "Review and confirm the questions and exact PHT times first.",
        );
      if (
        state.dirty ||
        state.review.version !== state.version ||
        state.review.questions !== JSON.stringify(state.questions)
      )
        throw new Error(
          "The questions changed. Review the current draft again before scheduling.",
        );
      if (Date.parse(state.review.starts_at) <= Date.now())
        throw new Error(
          "The opening time has passed. Choose a future opening and review the schedule again.",
        );
      const body = {
        starts_at: state.review.starts_at,
        ends_at: state.review.ends_at,
        expected_draft_version: state.version,
        confirmed: true,
        reason: $("schedule-reason").value.trim(),
      };
      if (state.exam.starts_at && !body.reason)
        throw new Error(
          "Enter an examiner explanation for changing the scheduled examination.",
        );
      await api(`/exams/${encodeURIComponent(state.id)}/schedule`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await loadExam();
      loadedNotice(
        "Scheduled. The confirmed questions open automatically at the exact opening time. Share the unchanged student link.",
        "success",
      );
    }),
  );
  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    action($("search-form").querySelector("button"), () => loadAttempts());
  });
  $("refresh-attempts").addEventListener("click", () =>
    action($("refresh-attempts"), () => loadAttempts()),
  );
  $("more-attempts").addEventListener("click", () =>
    action($("more-attempts"), () => loadAttempts(true)),
  );
  $("response-close").addEventListener("click", () => {
    $("response").hidden = true;
    state.selected = null;
    state.detail = null;
    loadEvents().catch((error) => notice(error.message, "error"));
  });
  $("student-report").addEventListener("click", () => {
    if (state.detail)
      download(
        studentReport(state.detail),
        `exam-response-${state.selected}.txt`,
      );
  });
  $("receipt-download").addEventListener("click", () => {
    if (state.detail?.receipt)
      download(
        receiptText(state.detail.receipt),
        `exam-receipt-${state.selected}.json`,
        "application/json",
      );
  });
  $("recover").addEventListener("click", () =>
    action($("recover"), async () => {
      const reason = $("recovery-reason").value.trim();
      if (!reason || !$("recovery-confirm").checked)
        throw new Error(
          "Verify identity, enter the recovery reason and check the authorization box.",
        );
      const result = await api(
        `/attempts/${encodeURIComponent(state.selected)}/recovery`,
        { method: "POST", body: JSON.stringify({ reason, confirmed: true }) },
      );
      if (!result.recovery_url)
        throw new Error("The server did not issue a recovery link.");
      $("recovery-result").hidden = false;
      $("recovery-result").textContent =
        `Private, one-use recovery link (expires ${formatTime(result.expires_at)}):\n${result.recovery_url}\nThe original attempt deadline remains unchanged.`;
      $("recovery-confirm").checked = false;
      notice(
        "Recovery authorization recorded. Share the one-use link privately only with the verified student.",
      );
    }),
  );
  $("practice-reset").addEventListener("click", () =>
    action($("practice-reset"), async () => {
      const reason = $("recovery-reason").value.trim();
      if (!isPractice() || !reason || !$("recovery-confirm").checked)
        throw new Error(
          "Verify identity, enter a practice reset reason and check the authorization box.",
        );
      const result = await api(
        `/attempts/${encodeURIComponent(state.selected)}/practice-reset`,
        { method: "POST", body: JSON.stringify({ reason, confirmed: true }) },
      );
      if (result.reset !== true)
        throw new Error("The server did not confirm a practice reset.");
      $("recovery-confirm").checked = false;
      notice(
        "Practice reset authorized and recorded. The student may open the practice link again for a new five-minute attempt. This old record remains preserved.",
        "success",
      );
      await loadAttempts();
    }),
  );
  $("event-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    action($("event-search-form").querySelector("button"), () => loadEvents());
  });
  $("all-events").addEventListener("click", () => {
    state.selected = null;
    action($("all-events"), () => loadEvents());
  });
  $("more-events").addEventListener("click", () =>
    action($("more-events"), () => loadEvents(true)),
  );
  $("refresh-backups").addEventListener("click", () =>
    action($("refresh-backups"), loadBackups),
  );
  $("backup-filter").addEventListener("change", () => {
    loadBackups().catch((error) => notice(error.message, "error"));
  });
  $("more-backups").addEventListener("click", () =>
    action($("more-backups"), () => loadBackups(true)),
  );
  $("export").addEventListener("click", () =>
    action($("export"), async () => {
      const response = await fetch(
        `/api/admin/exams/${encodeURIComponent(state.id)}/export.csv`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok)
        throw new Error(
          "The private export could not be downloaded. Check your examiner access and try again.",
        );
      if (!response.headers.get("Content-Type")?.includes("text/csv"))
        throw new Error(
          "The server did not return a CSV export. Nothing was downloaded.",
        );
      download(
        await response.text(),
        `${state.id}-all-responses.csv`,
        "text/csv;charset=utf-8",
      );
    }),
  );
  $("control-save").addEventListener("click", () =>
    action($("control-save"), async () => {
      const actionName = $("control-action").value,
        reason = $("control-reason").value.trim();
      if (!actionName || !reason || !$("control-confirm").checked)
        throw new Error(
          "Choose an action, give an explanation and check the authorization box.",
        );
      await api(`/exams/${encodeURIComponent(state.id)}/control`, {
        method: "POST",
        body: JSON.stringify({ action: actionName, reason, confirmed: true }),
      });
      $("control-confirm").checked = false;
      $("control-reason").value = "";
      await loadExam();
      loadedNotice(
        "The examiner action was recorded. Existing answers and receipts remain preserved.",
      );
    }),
  );
  $("admission-save").addEventListener("click", () =>
    action($("admission-save"), async () => {
      const actionName = $("admission-action").value,
        reason = $("admission-reason").value.trim();
      if (!actionName || !reason || !$("admission-confirm").checked)
        throw new Error(
          "Choose a student-link action, give an explanation and check the authorization box.",
        );
      const signature = JSON.stringify({ id: state.id, actionName, reason });
      if (state.admissionRequest?.signature !== signature)
        state.admissionRequest = {
          signature,
          body: {
            action: actionName,
            reason,
            confirmed: true,
            operation_id: crypto.randomUUID(),
          },
        };
      await api(`/exams/${encodeURIComponent(state.id)}/access-link`, {
        method: "POST",
        body: JSON.stringify(state.admissionRequest.body),
      });
      state.admissionRequest = null;
      $("admission-confirm").checked = false;
      $("admission-reason").value = "";
      await loadExam();
      loadedNotice(
        "Student-link action recorded. Use the current student link in Schedule. Existing attempts continue with their original answers and deadlines.",
      );
    }),
  );
  $("next-exam-create").addEventListener("click", () =>
    action($("next-exam-create"), async () => {
      const label = $("next-exam-label").value.trim(),
        reason = $("next-exam-reason").value.trim();
      if (!label || !reason || !$("next-exam-confirm").checked)
        throw new Error(
          "Enter the next examination title and archive reason, then check the authorization box.",
        );
      const signature = JSON.stringify({ label, reason, id: state.exam.id });
      if (state.nextRequest?.signature !== signature)
        state.nextRequest = {
          signature,
          body: {
            label,
            reason,
            confirmed: true,
            expected_current_exam_id: state.exam.id,
            operation_id: crypto.randomUUID(),
          },
        };
      const result = await api("/exams", {
        method: "POST",
        body: JSON.stringify(state.nextRequest.body),
      });
      if (!result.exam?.id)
        throw new Error("The server did not confirm a new examination.");
      const list = await api("/exams");
      populateExams(list.exams || []);
      state.id = result.exam.id;
      $("exam").value = state.id;
      state.nextRequest = null;
      $("next-exam-confirm").checked = false;
      $("next-exam-reason").value = "";
      $("next-exam-label").value = "";
      await loadExam();
      loadedNotice(
        "The prior examination is preserved in private history. The new official examination is empty and unavailable until you upload questions and schedule it. Its student link is unchanged.",
        "success",
      );
    }),
  );
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  setInterval(updateCountdownExample, 1000);
  setInterval(() => {
    if (!document.hidden && !state.attemptCursor && $("desk").hidden === false)
      loadAttempts().catch((error) =>
        notice(
          `Live refresh interrupted. ${error.message} Use Refresh to try again.`,
          "error",
        ),
      );
  }, 20000);
}

function populateExams(exams) {
  if (!exams.length) return;
  $("exam").replaceChildren();
  for (const exam of exams) {
    const option = node(
      "option",
      `${exam.label || exam.title || exam.id}${exam.archived ? " (Archived)" : ""}`,
    );
    option.value = exam.id;
    $("exam").append(option);
  }
}

async function init() {
  bind();
  try {
    const result = await api("/exams");
    state.role = result.identity?.role;
    $("identity").textContent =
      `${typeof result.identity === "object" ? result.identity.email || "Authorized examiner" : result.identity || "Authorized examiner"}${canManage() ? "" : " · Examiner · read only"}`;
    const exams = result.exams || [];
    if (exams.length) {
      populateExams(exams);
      state.id = (
        exams.find((exam) => exam.kind === "official" && !exam.archived) ||
        exams[0]
      ).id;
      $("exam").value = state.id;
    }
    await loadExam();
    $("desk").hidden = false;
    loadedNotice(
      "Private access confirmed. Server saves and delivery statuses are shown below.",
    );
  } catch (error) {
    $("desk").hidden = true;
    notice(
      error.status === 401 || error.status === 403
        ? "Examiner sign-in is required. Open this private address through the configured staff sign-in and refresh. Student name or email never grants examiner access."
        : `Examiner desk is not ready. ${error.message} Private access and the required server resources must be configured before use.`,
      "error",
    );
  }
}

init();
