import {
  DraftStore,
  readOfflineState,
  registrationCredential,
} from "./local-drafts.mjs";

export const toMillis = (value) =>
  typeof value === "number" ? value : Date.parse(value);
export function examSlug(pathname) {
  const path = pathname.replace(/^\/+|\/+$/g, "");
  return path.startsWith("exam/") ? path.slice(5) : path;
}
export function textSize(value) {
  return Math.max(14, Math.min(26, Number(value) || 18));
}
export function activityDetails(
  category,
  detail,
  groupId = () => crypto.randomUUID(),
) {
  const field =
    category === "paste"
      ? "pastedText"
      : ["copy", "cut"].includes(category)
        ? "selectedText"
        : null;
  if (
    !field ||
    typeof detail[field] !== "string" ||
    JSON.stringify(detail).length <= 210000
  )
    return [detail];
  const text = detail[field],
    chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 25000, text.length);
    // Keep surrogate pairs together so storage preserves every Unicode character.
    if (
      end < text.length &&
      /[\uD800-\uDBFF]/.test(text[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[end])
    )
      end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  const group = groupId();
  return chunks.map((chunk, index) => ({
    ...detail,
    [field]: chunk,
    groupId: group,
    part: index + 1,
    parts: chunks.length,
    originalCharacters: text.length,
  }));
}
export function activityBatch(queued, maximumBytes = 900000) {
  const events = [],
    encoder = new TextEncoder();
  let bytes = 16;
  for (const event of queued.slice(0, 50)) {
    const mapped = {
      id: event.eventId,
      type: event.category,
      questionId: event.questionId,
      clientTime: event.clientTime,
      details: { ...event.detail, provenance: event.provenance },
    };
    const size = encoder.encode(JSON.stringify(mapped)).byteLength + 1;
    if (events.length && bytes + size > maximumBytes) break;
    events.push(mapped);
    bytes += size;
  }
  return events;
}

export function countdownText(milliseconds, compact = false) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60),
    rest = seconds % 60;
  const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return days
    ? `${days} ${days === 1 ? "day" : "days"} ${time}`
    : compact && !hours
      ? time.slice(3)
      : time;
}
export class ServerClock {
  constructor(now = () => performance.now()) {
    this.tick = now;
    this.epoch = null;
    this.anchor = 0;
  }
  set(serverTime, roundTrip = 0) {
    const time = toMillis(serverTime);
    if (Number.isFinite(time)) {
      this.epoch = time + Math.min(roundTrip / 2, 2000);
      this.anchor = this.tick();
    }
  }
  now() {
    return this.epoch === null
      ? Date.now()
      : this.epoch + Math.max(0, this.tick() - this.anchor);
  }
}
export function saveSummary(store, online, formatTime) {
  const pending = store.pending().length;
  if (!store.durable)
    return {
      text: "Device storage is unavailable. Keep this page open and download a copy of your answers.",
      kind: "unsynced",
    };
  if (pending && store.persisted === false)
    return {
      text: "Saving on this device… Keep this page open.",
      kind: "unsynced",
    };
  if (pending)
    return {
      text: `Saved on this device · ${pending} ${pending === 1 ? "answer" : "answers"} not yet synced — keep this browser/profile.`,
      kind: "unsynced",
    };
  const times = Object.values(store.state.answers)
    .map((answer) => answer.savedAt)
    .filter(Boolean)
    .sort();
  return times.length
    ? {
        text: `Saved to server at ${formatTime(times.at(-1))} PHT`,
        kind: "saved",
      }
    : {
        text: online
          ? "Ready. Your answers save automatically as you write."
          : "Offline. Answers will save on this device.",
        kind: online ? "" : "unsynced",
      };
}

const formatClock = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(new Date(value));
const formatTime = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
const el = (tag, props = {}, children = []) => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === "text") element.textContent = value;
    else if (name === "class") element.className = value;
    else if (name.startsWith("on"))
      element.addEventListener(name.slice(2), value);
    else if (name in element) element[name] = value;
    else element.setAttribute(name, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
};
const p = (text, className = "") => el("p", { text, class: className });
const button = (text, onclick, className = "") =>
  el("button", { text, onclick, class: className, type: "button" });
const icon = (name) =>
  el("img", {
    src: `/icons/${name}.svg`,
    alt: "",
    width: 18,
    height: 18,
    class: "control-icon",
    "aria-hidden": "true",
  });
const iconButton = (label, name, onclick, className = "") => {
  const control = button("", onclick, `icon-button ${className}`);
  control.setAttribute("aria-label", label);
  control.title = label;
  control.append(icon(name));
  return control;
};
const safeStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ExamApp {
  constructor(
    root,
    { slug = examSlug(location.pathname), fetcher = fetch } = {},
  ) {
    this.root = root;
    this.slug = slug;
    this.fetcher = fetcher.bind(globalThis);
    this.clock = new ServerClock();
    this.editorId = crypto.randomUUID();
    try {
      const key = `dd-exam:${slug}:editor`;
      this.editorId = sessionStorage.getItem(key) || this.editorId;
      sessionStorage.setItem(key, this.editorId);
    } catch {
      /* Server and local writer leases still protect this tab. */
    }
    this.storage = safeStorage();
    this.online = navigator.onLine;
    this.state = null;
    this.store = null;
    this.index = 0;
    this.syncing = false;
    this.refreshing = false;
    this.closedLocally = false;
    this.leaseHeld = false;
    this.submitting = false;
    this.screen = "";
    this.syncTimer = null;
    this.failedSaves = new Set();
    this.conflicts = new Set();
    this.lengthConflicts = new Set();
    this.recovered = new Set();
    this.toolsOpen =
      typeof matchMedia !== "undefined" &&
      matchMedia("(min-width: 1180px)").matches;
    this.toolTab = "display";
    this.drawer = null;
    this.base = `/api/exams/${encodeURIComponent(this.slug)}`;
    // Admission keys belong to the shared URL, never to the answer/event journal.
    this.admissionKey =
      typeof location !== "undefined"
        ? new URLSearchParams(location.search).get("access")
        : null;
  }
  apiURL(path) {
    return `${this.base}${path}${this.admissionKey ? `?access=${encodeURIComponent(this.admissionKey)}` : ""}`;
  }
  async ensureBrowserSession() {
    if (["practice", "official"].includes(this.slug)) return;
    if (!this.browserSession) {
      const establish = async () => {
        const response = await this.fetcher("/api/browser/session", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok)
          throw new Error(
            "This browser session could not be prepared. Please reconnect and try again.",
          );
      };
      // The server creates the private HttpOnly session. One browser-wide lock
      // prevents first-time tabs for different exams racing to replace it.
      this.browserSession = (
        navigator.locks
          ? navigator.locks.request("dd-exam-browser-session", establish)
          : establish()
      ).catch((error) => {
        this.browserSession = null;
        throw error;
      });
    }
    await this.browserSession;
  }
  async request(
    path = "/state",
    { method = "GET", body, timeout = 12000, sessionRetry = true } = {},
  ) {
    await this.ensureBrowserSession();
    const start = performance.now(),
      controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetcher(this.apiURL(path), {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(
          "The server returned an unreadable response. Your local answers are preserved.",
        );
      }
      if (data.serverTime)
        this.clock.set(data.serverTime, performance.now() - start);
      if (
        sessionRetry &&
        response.status === 409 &&
        data.error?.code === "browser_session_required"
      ) {
        this.browserSession = null;
        return this.request(path, {
          method,
          body,
          timeout,
          sessionRetry: false,
        });
      }
      if (!response.ok) {
        const error = new Error(
          data.error?.message || "The request could not be completed.",
        );
        error.status = response.status;
        error.code = data.error?.code;
        error.data = data;
        throw error;
      }
      this.online = true;
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  async start() {
    this.bindEvents();
    const recovery = new URLSearchParams(location.hash.slice(1)).get("recover");
    if (recovery) {
      history.replaceState(null, "", location.pathname + location.search);
      try {
        await this.request("/recover", {
          method: "POST",
          body: { token: recovery },
        });
      } catch {
        this.lastMessage =
          "The recovery code could not be used. Contact the examiner for assistance. Existing work has not been changed.";
      }
    }
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/exam-sw.mjs").catch(() => {
        /* Local drafts still work; offline reload readiness must be tested. */
      });
    try {
      await this.refresh(true);
    } catch (error) {
      if (
        error.status === 403 &&
        ["admission_link_invalid", "admission_revoked"].includes(error.code)
      ) {
        this.renderAdmissionError();
        return;
      }
      const cached = await readOfflineState(this.slug, {
        storage: this.storage,
      });
      if (cached?.attempt) {
        this.online = false;
        this.leaseHeld = true;
        this.clock.set(
          toMillis(cached.serverTime) +
            Math.max(0, Date.now() - cached.cachedAt),
        );
        await this.acceptState(cached);
        this.record("draft_recovery", { mode: "offline-reopen" });
        this.message(
          "Connection unavailable. Recovered work is saved on this device; server receipt and remaining time will be checked after reconnection.",
        );
      } else this.renderConnectionError();
    }
    this.startTimers();
    this.tick();
  }
  startTimers() {
    if (this.state?.attempt?.receipt) return;
    this.timer = setInterval(() => this.tick(), 250);
    this.poller = setInterval(
      () =>
        this.refresh().catch(() => {
          this.online = false;
          this.updateSave();
        }),
      12000,
    );
    this.heartbeat = setInterval(() => {
      this.record("heartbeat", { visible: document.visibilityState });
      this.flushEvents();
    }, 30000);
    this.leaseTimer = setInterval(() => this.acquireLease(false), 10000);
  }
  stopExamTimers() {
    for (const name of ["timer", "poller", "heartbeat", "leaseTimer"]) {
      clearInterval(this[name]);
      this[name] = null;
    }
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.leaseHeld = false;
    this.releaseDeviceLock?.();
    this.releaseDeviceLock = null;
    this.deviceLock = false;
  }
  scheduleFinalPreservation() {
    if (!this.state?.attempt?.receipt || !this.store) return;
    const pending = this.store.state.events.length || this.store.pending().some(
      answer => !this.recovered.has(answer.mutationId),
    );
    if (!pending) {
      clearTimeout(this.finalRetryTimer);
      this.finalRetryTimer = null;
      this.finalRetryDelay = 30000;
      return;
    }
    if (!this.online || this.finalRetryTimer) return;
    const wait = this.finalRetryDelay || 30000;
    this.finalRetryTimer = setTimeout(() => {
      this.finalRetryTimer = null;
      this.finalRetryDelay = Math.min(wait * 2, 300000);
      // Retry only existing evidence/recovered writing. Never create a heartbeat
      // or poll the immutable receipt merely because its tab remains open.
      this.recoverLateDrafts();
      this.flushEvents();
    }, wait);
  }
  bindEvents() {
    window.addEventListener("resize", () => this.updateToolsExpanded());
    for (const type of ["pointerdown", "keydown"])
      this.root.addEventListener(type, () => this.store?.resumePersistence());
    window.addEventListener("online", () => {
      this.online = true;
      this.record("online");
      this.record("reconnect");
      this.refresh()
        .then(() => this.sync())
        .catch(() => this.updateSave());
    });
    window.addEventListener("offline", () => {
      this.online = false;
      this.record("offline");
      this.updateSave();
    });
    window.addEventListener("focus", () => {
      this.record("window_focus");
      this.refresh().catch(() => {});
    });
    window.addEventListener("blur", () => {
      this.record("window_blur");
      this.sync();
    });
    document.addEventListener("visibilitychange", () => {
      this.record(document.hidden ? "page_hidden" : "page_visible");
      if (!document.hidden) {
        this.tick();
        this.refresh().catch(() => {});
      } else {
        this.sync();
        this.flushEvents();
      }
    });
    for (const category of ["copy", "cut"])
      this.root.addEventListener(category, () => {
        const selection =
          this.answer && document.activeElement === this.answer
            ? this.answer.value.slice(
                this.answer.selectionStart,
                this.answer.selectionEnd,
              )
            : window.getSelection()?.toString() || "";
        this.record(category, {
          selectedText: selection,
          limitation:
            "Only selection within examination content is observable.",
        });
      });
    window.addEventListener("beforeunload", (event) => {
      if (!this.store || this.state?.attempt?.receipt) return;
      this.store.beginUnload();
      this.record("navigation_attempt", { delivery: "best-effort" });
      this.record("beforeunload", { delivery: "best-effort" });
      if (
        !this.isFinalized() &&
        (this.store.pending().length || this.store.state.pendingSubmit)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    window.addEventListener("pagehide", () => {
      this.store?.beginUnload();
      this.record("pagehide", { delivery: "best-effort" });
      this.flushEvents(true);
      // Explicitly release the browser writer lock on navigation, including
      // browsers that retain the old document in their back/forward cache.
      this.releaseDeviceLock?.();
      this.releaseDeviceLock = null;
      this.deviceLock = false;
      this.store?.close();
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && this.state?.attempt)
        this.store
          .open()
          .then(() => this.state.attempt.receipt ? undefined : this.acquireDeviceLock())
          .then(() => this.state.attempt.receipt ? undefined : this.acquireLease())
          .then(() => this.refresh())
          .catch(() => this.updateSave());
    });
  }
  record(category, detail = {}) {
    if (this.state?.attempt?.receipt && !["pagehide", "save_success", "save_failure"].includes(category)) return;
    if (this.store)
      for (const part of activityDetails(category, detail))
        this.store.event(category, part, this.question()?.id || null);
  }
  question() {
    return this.state?.attempt?.questions?.[this.index];
  }
  examTitle() {
    return this.state?.exam?.title || "Examination";
  }
  isPractice() {
    return this.state?.exam?.kind === "practice" || this.slug === "practice";
  }
  durationMinutes() {
    return (
      Number(this.state?.exam?.durationMinutes) || (this.isPractice() ? 5 : 0)
    );
  }
  isFlagged(id = this.question()?.id) {
    return !!this.store?.state.flags?.[id];
  }
  isFinalized() {
    return (
      !!this.state?.attempt?.receipt ||
      ["FINALIZED", "SUBMITTED", "CLOSED"].includes(
        String(this.state?.attempt?.status || "").toUpperCase(),
      )
    );
  }
  deadline() {
    return toMillis(
      this.state?.attempt?.deadlineAt || this.state?.exam?.endAt || "",
    );
  }
  writable() {
    const id = this.question()?.id;
    return (
      this.state?.exam?.status === "OPEN" &&
      !this.isFinalized() &&
      !this.closedLocally &&
      this.leaseHeld &&
      this.deviceLock !== false &&
      !this.submitting &&
      (!this.conflicts.has(id) || this.lengthConflicts.has(id))
    );
  }
  async acquireDeviceLock() {
    if (this.deviceLock || !this.state?.attempt) return this.deviceLock;
    const key = `dd-exam-writer:${this.slug}:${this.state.attempt.id}`;
    if (navigator.locks) {
      return new Promise((resolve) => {
        navigator.locks
          .request(
            key,
            { mode: "exclusive", ifAvailable: true },
            async (lock) => {
              this.deviceLock = !!lock;
              resolve(this.deviceLock);
              if (lock)
                await new Promise((release) => {
                  this.releaseDeviceLock = release;
                });
            },
          )
          .catch(() => {
            this.deviceLock = false;
            resolve(false);
          });
      });
    }
    // Older browsers use a short, browser-local writer lease. The authoritative
    // server lease still rejects simultaneous writes from any device.
    try {
      const previous = JSON.parse(this.storage?.getItem(key) || "null");
      if (
        previous &&
        previous.editorId !== this.editorId &&
        previous.expires > Date.now()
      )
        return (this.deviceLock = false);
      this.storage.setItem(
        key,
        JSON.stringify({
          editorId: this.editorId,
          expires: Date.now() + 25000,
        }),
      );
      this.deviceLock = true;
      this.localLeaseKey = key;
      return true;
    } catch {
      this.deviceLock = true;
      return true;
    }
  }
  async refresh(initial = false) {
    if (this.state?.attempt?.receipt) {
      this.recoverLateDrafts();
      this.flushEvents();
      return;
    }
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      let data = await this.request();
      if (
        !data.attempt &&
        !["practice", "official"].includes(this.slug) &&
        ["OPEN", "SCHEDULED"].includes(data.exam.status)
      ) {
        const cached = this.state?.attempt
          ? this.state
          : await readOfflineState(this.slug, { storage: this.storage });
        if (cached?.attempt && cached.exam.id === data.exam.id) {
          const credential = await registrationCredential(this.slug, {
            storage: this.storage,
            create: false,
          });
          // A private key from the already admitted attempt can reattach this
          // exam after a first-tab cookie race. Never enroll a fresh identity.
          if (credential.durable)
            data = await this.request("/attempt", {
              method: "POST",
              body: {
                name: cached.attempt.name,
                email: cached.attempt.email,
                consent: true,
                oneBrowser: true,
                editorId: this.editorId,
                registrationId: credential.id,
              },
            });
        }
      }
      await this.acceptState(data, initial);
    } finally {
      this.refreshing = false;
    }
  }
  async acceptState(data, initial = false) {
    const previousStatus = this.state?.exam?.status,
      oldAttempt = this.state?.attempt?.id;
    this.state = data;
    if (
      this.online &&
      toMillis(data.attempt?.deadlineAt || data.exam.endAt) >
        this.clock.now() &&
      !data.attempt?.receipt
    )
      this.closedLocally = false;
    if (data.attempt && (oldAttempt !== data.attempt.id || !this.store)) {
      await this.acquireDeviceLock();
      // Observer tabs keep their own event journal and cannot overwrite the
      // active tab's browser drafts while they display the server copy.
      this.store = new DraftStore(
        `dd-exam:${this.slug}:${data.attempt.id}${this.deviceLock ? "" : `:observer:${this.editorId}`}`,
        { storage: this.storage, onStatus: () => this.updateSave() },
      );
      await this.store.open();
      this.index = Math.min(
        Math.max(0, this.store.state.current || 0),
        Math.max(0, (data.attempt.questions?.length || 1) - 1),
      );
      if (!this.store.state.sequence && data.attempt.position) {
        const position = data.attempt.questions?.findIndex(
          (question) => question.id === data.attempt.position,
        );
        if (position >= 0) this.index = position;
      }
      this.record(initial ? "session_resume" : "session_start", {
        storageAvailable: this.store.durable,
      });
      if (!this.store.durable)
        this.record("storage_failure", {
          localStorage: this.store.localAvailable,
          indexedDB: this.store.idbAvailable,
        });
    }
    const previousLocal = this.store?.state.answers[this.question()?.id];
    if (this.store) this.store.importServer(data.attempt?.answers);
    const imported = this.store?.state.answers[this.question()?.id];
    if (
      this.answer &&
      imported?.acknowledged &&
      previousLocal?.acknowledged &&
      imported.revision > previousLocal.revision
    ) {
      this.answer.value = imported.text;
      this.updateWordCount();
      this.updateNavigation();
    }
    if (data.attempt && !this.isFinalized() && this.online)
      await this.acquireLease(false);
    if (data.attempt) {
      const cached = { ...data, cachedAt: Date.now() };
      try {
        this.storage?.setItem(
          `dd-exam:${this.slug}:resume`,
          JSON.stringify(cached),
        );
      } catch {
        /* IndexedDB also retains the admitted state. */
      }
      this.store.setMetadata(cached);
    }
    const view = this.isFinalized()
      ? "receipt"
      : data.attempt &&
          data.exam.status === "OPEN" &&
          data.attempt.questions?.length
        ? "exam"
        : data.exam.status === "SCHEDULED"
          ? "waiting"
          : data.exam.status === "UNCONFIGURED"
            ? "unavailable"
            : data.exam.status === "OPEN"
              ? "entry"
              : "closed";
    if (
      this.screen !== view ||
      oldAttempt !== data.attempt?.id ||
      previousStatus !== data.exam.status
    ) {
      this.screen = view;
      this.render();
    } else {
      this.updateSave();
      this.updateWritable();
    }
    if (data.attempt?.receipt) this.stopExamTimers();
    this.tick();
    if (this.isFinalized()) this.recoverLateDrafts();
    else if (this.store && this.leaseHeld) {
      this.sync();
      if (this.store.state.pendingSubmit) this.submit();
    }
    this.flushEvents();
  }
  async acquireLease(takeover = false) {
    if (
      !this.state?.attempt ||
      this.isFinalized() ||
      !this.online ||
      this.acquiringLease
    )
      return;
    if (this.deviceLock === false) {
      this.leaseHeld = false;
      this.message(
        "This examination is open in another tab on this browser. Close that tab, then choose “Write in this tab”. Your saved work is preserved.",
      );
      this.updateWritable();
      return;
    }
    this.acquiringLease = true;
    try {
      const data = await this.request("/lease", {
        method: "POST",
        body: { editorId: this.editorId, takeover },
        timeout: 5000,
      });
      if (data.receipt) {
        this.leaseHeld = false;
        await this.refresh();
        return;
      }
      if (this.localLeaseKey)
        this.storage?.setItem(
          this.localLeaseKey,
          JSON.stringify({
            editorId: this.editorId,
            expires: Date.now() + 25000,
          }),
        );
      this.leaseHeld = !data.lease || data.lease.editorId === this.editorId;
      if (
        this.leaseHeld &&
        /^(This examination is open|Waiting to confirm)/.test(
          this.lastMessage || "",
        )
      )
        this.message("");
    } catch (error) {
      if (error.status === 423) {
        this.leaseHeld = false;
        this.record("second_session_attempt");
        this.message(
          "This examination is open in another tab. Return to that tab, or use “Write in this tab” below. Saved answers remain available.",
        );
      } else if (!this.leaseHeld)
        this.message(
          "Waiting to confirm this tab can save to the server. Your recovered answers remain on this device.",
        );
      // A network outage does not disable local writing in the previously held tab.
    } finally {
      this.acquiringLease = false;
      this.updateWritable();
    }
  }
  async register(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      this.registration ||= await registrationCredential(this.slug, {
        storage: this.storage,
      });
      if (!this.registration.durable) {
        this.message(
          "This browser is blocking examination storage. Enable site storage or use a regular browser profile, then try the practice first. Your examination has not started.",
        );
        return;
      }
      const data = await this.request("/attempt", {
        method: "POST",
        body: {
          name: form.elements.name.value.trim(),
          email: form.elements.email.value.trim(),
          consent: form.elements.consent.checked,
          oneBrowser: true,
          editorId: this.editorId,
          registrationId: this.registration.id,
        },
      });
      await this.acceptState(data);
      this.record("consent", { accepted: true, noticeVersion: "2026-10-24" });
      this.flushEvents();
    } catch (error) {
      this.message(
        error.status
          ? error.message
          : "Unable to connect. Your examination has not started here. Check your connection and try again.",
      );
    } finally {
      submit.disabled = false;
    }
  }
  privacy() {
    return el("details", { class: "privacy" }, [
      el("summary", { text: "Privacy and examination records" }),
      p(
        "Due Diligence processes your name, email, answers, save history and browser events to deliver this examination and preserve your work. Only authorized examination staff may review these records.",
      ),
      p(
        "Recorded events include question changes, copy/cut selections within this examination, pasted answer text, tab visibility, focus, connection changes and attempted navigation. Events can be delayed or missing. Only your examiner decides whether conduct is misconduct.",
      ),
      p(
        "This page cannot inspect other apps, private tabs, clipboard history or another device. It does not use your camera, microphone or screen recording.",
      ),
      p(
        "Use the same device and browser profile. Answers are stored on this device and on private server and backup services. For help, access, correction, or retention/deletion details, contact the person who shared this examination before starting.",
      ),
      p(
        "A cleared browser or a different device requires authorized examiner recovery. Your name and email alone cannot retrieve saved answers.",
      ),
    ]);
  }
  render() {
    this.closeDrawer();
    document.body.classList.toggle("in-exam", this.screen === "exam");
    document.title = `${this.examTitle()} · Due Diligence`;
    this.root.replaceChildren();
    this.root.setAttribute("aria-busy", "false");
    this.answer = null;
    this.saveText = null;
    this.messageElement = null;
    this.nav = null;
    this.progress = null;
    if (this.screen === "exam") return this.renderExam();
    if (this.screen === "receipt") return this.renderReceipt();
    const section = el("section", { class: "entry-heading" });
    section.append(
      p(this.isPractice() ? "Practice examination" : "Examination", "eyebrow"),
    );
    if (this.screen === "unavailable") {
      section.classList.add("system-screen");
      section.append(
        el("h1", { text: "Test is not available" }),
        p(
          "This examination has not been made available. Please check the details with the person who shared the link.",
        ),
      );
      this.root.append(section);
      this.appendMessage(section);
      return;
    }
    if (this.screen === "closed") {
      section.classList.add("system-screen");
      section.append(
        el("h1", {
          text:
            this.state.exam.status === "CANCELLED"
              ? "Examination cancelled"
              : this.state.exam.status === "PAUSED"
                ? "Examination paused"
                : "Examination closed",
        }),
        p(
          "New examination attempts are not available. Any existing work remains preserved. Contact your examiner if you need help.",
        ),
      );
      this.root.append(section);
      this.appendMessage(section);
      return;
    }
    if (this.screen === "waiting") {
      section.append(
        el("h1", { text: this.examTitle() }),
        p(
          "Test is not available yet. Your examination will open automatically at the scheduled time.",
        ),
        this.clockPanel(true),
        p(
          `Opens ${formatClock(this.state.exam.startAt)} PHT. Closes ${formatClock(this.state.exam.endAt)} PHT.`,
          "subtle",
        ),
      );
      if (this.state.attempt)
        section.append(
          p(
            `You are registered as ${this.state.attempt.name}. Keep this page open. Your examination will appear automatically when it opens.`,
            "notice",
          ),
        );
    } else
      section.append(
        el("h1", { text: this.examTitle() }),
        p(
          "Read the instructions, enter your details, and begin when you are ready.",
        ),
      );
    this.root.append(section);
    if (!this.state.attempt) this.renderEntry();
    else this.appendMessage(section);
  }
  clockPanel(waiting = false) {
    return el("div", { class: "clock-panel" }, [
      el("div", {}, [
        el("span", {
          class: "label",
          text: waiting ? "Time until opening" : "Time remaining",
        }),
        el("div", { class: "countdown", "data-countdown": "" }),
      ]),
      el("div", {}, [
        el("span", { class: "label", text: "Philippine time" }),
        el("div", { class: "clock", "data-clock": "" }),
      ]),
    ]);
  }
  appendMessage(parent) {
    this.messageElement = p("", "inline-message");
    this.messageElement.setAttribute("role", "status");
    parent.append(this.messageElement);
  }
  message(text) {
    this.lastMessage = text;
    if (this.messageElement) this.messageElement.textContent = text;
  }
  renderEntry() {
    const form = el("form", {
      class: "entry-form",
      onsubmit: (event) => this.register(event),
    });
    const overview = el(
      "section",
      { class: "exam-overview", "aria-labelledby": "overview-title" },
      [el("h2", { id: "overview-title", text: "Before you begin" })],
    );
    const facts = [
      ["Questions", String(this.state.exam.questionCount ?? 0)],
      [
        this.isPractice() ? "Time allowed" : "Closing time",
        this.isPractice()
          ? `${this.durationMinutes()} minutes from your start`
          : `${formatClock(this.state.exam.endAt)} PHT`,
      ],
    ];
    overview.append(
      el(
        "dl",
        { class: "exam-facts" },
        facts.flatMap(([label, value]) => [
          el("dt", { text: label }),
          el("dd", { text: value }),
        ]),
      ),
    );
    overview.append(
      p(
        this.state.exam.instructions ||
          "Answer each question in the space provided. You can move between questions and flag any you want to revisit.",
        "entry-instructions",
      ),
    );
    overview.append(
      el("ul", { class: "entry-checks" }, [
        el("li", { text: "Answers save automatically while you write." }),
        el("li", {
          text: "Return using this device and browser profile to recover your work.",
        }),
        el("li", { text: "A server receipt confirms your submission." }),
      ]),
      this.privacy(),
    );
    const identity = el(
      "section",
      { class: "identity-fields", "aria-labelledby": "identity-title" },
      [
        el("h2", { id: "identity-title", text: "Your details" }),
        p("Use the name and email your examiner will recognize.", "subtle"),
      ],
    );
    const fields = el("div", { class: "fields" }, [
      el("label", { text: "Full name" }, [
        el("input", {
          name: "name",
          autocomplete: "name",
          required: true,
          maxLength: 160,
        }),
      ]),
      el("label", { text: "Email address" }, [
        el("input", {
          name: "email",
          type: "email",
          autocomplete: "email",
          required: true,
          maxLength: 254,
          inputMode: "email",
        }),
      ]),
    ]);
    identity.append(
      fields,
      el("label", { class: "check" }, [
        el("input", { name: "consent", type: "checkbox", required: true }),
        el("span", {
          text: "I have read the privacy notice. I will use this device and browser profile, and understand that the listed browser events are recorded for examiner review.",
        }),
      ]),
      el("div", { class: "actions" }, [
        el("button", {
          type: "submit",
          text:
            this.screen === "waiting"
              ? "Enter waiting room"
              : this.isPractice()
                ? "Start practice"
                : "Begin examination",
        }),
      ]),
    );
    if (this.isPractice())
      identity.append(
        p("The timer starts only after you begin.", "entry-start-note"),
      );
    this.appendMessage(identity);
    this.message(this.lastMessage || "");
    form.append(overview, identity);
    this.root.append(form);
  }
  renderExam() {
    const attempt = this.state.attempt;
    this.shell = el("section", {
      class: `exam-shell${this.toolsOpen ? " has-tools" : ""}`,
      "aria-label": "Examination workspace",
    });
    const questionsButton = iconButton(
      "Questions",
      "menu",
      () => this.openQuestions(),
      "mobile-questions",
    );
    const title = el("div", { class: "exam-identity" }, [
      el("span", { class: "workspace-brand", text: "Due Diligence." }),
      el("h1", { text: this.examTitle(), title: this.examTitle() }),
    ]);
    const timer = el("div", { class: "exam-timer" }, [
      el("span", { class: "timer-label", text: "Time remaining" }),
      el("div", {
        class: "countdown",
        "data-countdown": "",
        role: "timer",
        "aria-live": "off",
        "aria-label": "Time remaining",
      }),
      el("span", { class: "clock", "data-clock": "" }),
    ]);
    this.toolsButton = iconButton(
      "Tools and instructions",
      "sliders-horizontal",
      () => this.toggleTools(),
      "header-tools",
    );
    this.updateToolsExpanded();
    this.shell.append(
      el("header", { class: "exam-top", "aria-label": "Examination status" }, [
        questionsButton,
        title,
        timer,
        this.toolsButton,
      ]),
    );
    this.saveText = el("span", { role: "status", "aria-live": "polite" });
    this.shell.append(
      el("div", { class: "save-bar" }, [
        this.saveText,
        button("Save now", () => this.sync(), "save-action"),
      ]),
    );
    const rail = el("aside", {
      class: "question-rail",
      "aria-label": "Questions",
    });
    rail.append(el("span", { text: "Questions", class: "rail-label" }));
    this.nav = el("nav", {
      class: "question-nav",
      "aria-label": "Question navigation",
    });
    for (let i = 0; i < attempt.questions.length; i++) {
      const item = button("", () => this.navigate(i), "question-link");
      const flag = icon("flag");
      flag.classList.add("nav-flag");
      flag.hidden = true;
      const check = icon("check");
      check.classList.add("nav-check");
      check.hidden = true;
      item.append(
        el("span", { class: "question-number", text: String(i + 1) }),
        flag,
        check,
      );
      this.nav.append(item);
    }
    this.progress = el("span", { class: "rail-progress" });
    rail.append(this.nav, this.progress);
    this.questionHeading = el("h2");
    this.questionText = p("", "question-text");
    this.instructions = p("", "question-instructions");
    this.flagButton = button(
      "Flag question",
      () => this.toggleFlag(),
      "flag-button",
    );
    this.flagButton.prepend(icon("flag"));
    const questionPane = el(
      "section",
      { class: "question-pane", "aria-labelledby": "question-heading" },
      [
        el("div", { class: "question-toolbar" }, [
          this.questionHeading,
          this.flagButton,
        ]),
        el(
          "div",
          {
            class: "question-reading",
            tabIndex: 0,
            "aria-label": "Question text",
          },
          [this.questionText, this.instructions],
        ),
      ],
    );
    this.answer = el("textarea", {
      id: "answer",
      spellcheck: false,
      autocomplete: "off",
      "aria-describedby": "answer-note",
      oninput: () => this.onInput(),
      onpaste: (event) =>
        this.record("paste", {
          pastedText: event.clipboardData?.getData("text/plain") || "",
          readable: !!event.clipboardData,
        }),
    });
    this.wordCount = el("span");
    const answerPane = el(
      "section",
      { class: "answer-pane", "aria-label": "Your answer" },
      [
        el(
          "label",
          { class: "answer-label", htmlFor: "answer", text: "Your answer" },
          [this.wordCount],
        ),
        this.answer,
        p(
          "Plain text. Your answer saves automatically as you write.",
          "answer-note",
        ),
      ],
    );
    answerPane.querySelector(".answer-note").id = "answer-note";
    this.toolPanel = el("aside", {
      class: "tool-panel",
      "aria-label": "Examination tools",
      hidden: !this.toolsOpen,
    });
    this.toolPanel.append(this.toolsContent("desktop"));
    this.shell.append(
      el("div", { class: "exam-grid" }, [
        rail,
        el("div", { class: "workspace" }, [questionPane, answerPane]),
        this.toolPanel,
      ]),
    );
    this.previous = button(
      "Previous",
      () => this.navigate(this.index - 1),
      "secondary",
    );
    this.next = button(
      "Next",
      () => this.navigate(this.index + 1),
      "secondary",
    );
    this.previous.prepend(icon("chevron-left"));
    this.next.append(icon("chevron-right"));
    this.submitButton = button(
      "Review & submit",
      () => this.review(),
      "submit-button",
    );
    this.positionLabel = el("span", { class: "position-label" });
    this.shell.append(
      el("footer", { class: "workspace-actions" }, [
        this.positionLabel,
        el("div", { class: "actions" }, [
          this.previous,
          this.next,
          this.submitButton,
        ]),
      ]),
    );
    this.takeoverButton = button(
      "Write in this tab",
      async () => {
        this.submitting = true;
        this.updateWritable();
        try {
          if (!(await this.acquireDeviceLock())) {
            this.message(
              "Close the other examination tab first, then try again. Its unsynced writing is preserved in that tab.",
            );
            return;
          }
          if (this.store.key.includes(":observer:")) {
            await this.flushEvents();
            this.store = null;
            await this.acceptState(this.state);
          }
          await this.acquireLease(true);
          await this.refresh();
          this.showQuestion();
          this.sync();
        } finally {
          this.submitting = false;
          this.updateWritable();
        }
      },
      "secondary",
    );
    const message = el("div", { class: "workspace-notice" });
    this.appendMessage(message);
    message.append(this.takeoverButton);
    this.shell.append(message);
    this.root.append(this.shell);
    this.message(this.lastMessage || "");
    this.showQuestion();
    this.applyTextSize();
    this.updateSave();
    this.updateWritable();
  }
  showQuestion() {
    const question = this.question();
    if (!question || !this.answer) return;
    this.questionHeading.id = "question-heading";
    this.questionHeading.tabIndex = -1;
    this.questionHeading.textContent = `Question ${question.number || this.index + 1}`;
    this.questionText.textContent = question.text;
    this.instructions.textContent = question.instructions || "";
    this.answer.value = this.store.state.answers[question.id]?.text || "";
    this.answer.scrollTop = 0;
    this.answer.setAttribute(
      "aria-label",
      `Your answer to question ${question.number || this.index + 1}`,
    );
    this.previous.disabled = this.index === 0;
    this.next.disabled = this.index === this.state.attempt.questions.length - 1;
    this.flagButton.lastChild.textContent = this.isFlagged(question.id)
      ? "Flagged"
      : "Flag question";
    this.flagButton.setAttribute(
      "aria-pressed",
      String(this.isFlagged(question.id)),
    );
    this.updateNavigation();
    this.updateWordCount();
    this.updateWritable();
    this.record("question_viewed", { number: question.number });
    const current = this.nav.children[this.index],
      frame = this.nav.getBoundingClientRect(),
      item = current?.getBoundingClientRect();
    if (item && frame.height) {
      if (item.top < frame.top) this.nav.scrollTop -= frame.top - item.top;
      else if (item.bottom > frame.bottom)
        this.nav.scrollTop += item.bottom - frame.bottom;
    }
  }
  updateNavigation() {
    if (!this.nav) return;
    [...this.nav.children].forEach((node, i) => {
      const answered =
        !!this.store.state.answers[
          this.state.attempt.questions[i].id
        ]?.text.trim();
      node.setAttribute("aria-current", i === this.index ? "true" : "false");
      node.classList.toggle("answered", answered);
      const flagged = this.isFlagged(this.state.attempt.questions[i].id);
      node.classList.toggle("flagged", flagged);
      node.querySelector(".nav-flag").hidden = !flagged;
      node.querySelector(".nav-check").hidden = !answered;
      node.setAttribute(
        "aria-label",
        `Question ${i + 1}${answered ? ", answered" : ", blank"}${flagged ? ", flagged" : ""}`,
      );
    });
    const answered = this.state.attempt.questions.filter((question) =>
      this.store.state.answers[question.id]?.text.trim(),
    ).length;
    if (this.progress)
      this.progress.textContent = `${answered}/${this.state.attempt.questions.length} answered`;
    if (this.positionLabel)
      this.positionLabel.textContent = `Question ${this.index + 1} of ${this.state.attempt.questions.length}`;
  }
  toggleFlag() {
    if (!this.question()) return;
    this.store.setFlag(this.question().id, !this.isFlagged());
    this.updateNavigation();
    this.flagButton.lastChild.textContent = this.isFlagged()
      ? "Flagged"
      : "Flag question";
    this.flagButton.setAttribute("aria-pressed", String(this.isFlagged()));
  }
  applyTextSize() {
    this.shell?.style.setProperty(
      "--exam-text-size",
      `${textSize(this.store?.state.preferences?.textSize)}px`,
    );
  }
  setTextSize(value) {
    this.store.setPreference("textSize", textSize(value));
    this.applyTextSize();
    this.root.querySelectorAll("[data-text-size]").forEach((control) => {
      control.value = String(textSize(value));
    });
    this.root.querySelectorAll("[data-size-output]").forEach((output) => {
      output.textContent = `${textSize(value)} px`;
    });
  }
  toolsContent(prefix) {
    const content = el("div", { class: "tools-content" });
    content.append(
      el("div", { class: "tools-heading" }, [
        el("h2", { text: "Tools" }),
        iconButton("Close tools", "x", () => this.closeTools()),
      ]),
    );
    const tabs = el("div", {
      class: "tool-tabs",
      role: "tablist",
      "aria-label": "Examination tools",
    });
    const panels = el("div", { class: "tool-panels" });
    for (const [name, label] of [
      ["display", "Display"],
      ["instructions", "Instructions"],
    ]) {
      const tab = button(
        label,
        () => {
          this.toolTab = name;
          [...tabs.children].forEach((node) => {
            const active = node.dataset.tab === name;
            node.setAttribute("aria-selected", String(active));
            node.tabIndex = active ? 0 : -1;
          });
          [...panels.children].forEach((node) => {
            node.hidden = node.dataset.panel !== name;
          });
        },
        "tool-tab",
      );
      tab.dataset.tab = name;
      tab.id = `${prefix}-${name}-tab`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `${prefix}-${name}-panel`);
      tab.setAttribute("aria-selected", String(this.toolTab === name));
      tab.tabIndex = this.toolTab === name ? 0 : -1;
      tab.addEventListener("keydown", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? tabs.firstChild
              : event.key === "End"
                ? tabs.lastChild
                : [...tabs.children].find((node) => node !== tab);
          next.click();
          next.focus();
        }
      });
      tabs.append(tab);
      const panel = el("section", {
        id: `${prefix}-${name}-panel`,
        role: "tabpanel",
        "aria-labelledby": tab.id,
        hidden: this.toolTab !== name,
      });
      panel.dataset.panel = name;
      if (name === "display") {
        const size = textSize(this.store.state.preferences?.textSize);
        panel.append(
          el(
            "label",
            { class: "tool-field", text: "Question and answer text size" },
            [
              el("input", {
                type: "range",
                min: 14,
                max: 26,
                step: 1,
                value: String(size),
                "data-text-size": "",
                oninput: (event) => this.setTextSize(event.target.value),
              }),
            ],
          ),
          el("output", {
            text: `${size} px`,
            class: "size-output",
            "data-size-output": "",
          }),
          el("div", { class: "size-actions" }, [
            button(
              "Smaller",
              () =>
                this.setTextSize(
                  textSize(this.store.state.preferences?.textSize) - 1,
                ),
              "secondary",
            ),
            button(
              "Larger",
              () =>
                this.setTextSize(
                  textSize(this.store.state.preferences?.textSize) + 1,
                ),
              "secondary",
            ),
          ]),
          p("You can also use your browser’s zoom controls.", "tool-note"),
        );
      } else
        panel.append(
          el("h3", { text: "Examination instructions" }),
          p(
            this.state.exam.instructions ||
              "Answer each question in the space provided. Move between questions using the numbered list or Previous and Next.",
            "tool-instructions",
          ),
          p(
            "Flags are personal reminders saved in this browser. They do not affect your answers.",
            "tool-note",
          ),
          p(
            "Your deadline continues while offline or while the exam is hidden.",
            "tool-note",
          ),
        );
      panels.append(panel);
    }
    content.append(
      tabs,
      panels,
      el("div", { class: "tool-actions" }, [
        button("Download answers PDF", () => this.downloadDraft(), "secondary"),
        button("Hide exam", () => this.hideExam(), "secondary"),
      ]),
    );
    return content;
  }
  toggleTools() {
    if (matchMedia("(min-width: 1180px)").matches) {
      this.toolsOpen = !this.toolsOpen;
      this.toolPanel.hidden = !this.toolsOpen;
      this.shell.classList.toggle("has-tools", this.toolsOpen);
      this.toolsButton.setAttribute("aria-expanded", String(this.toolsOpen));
    } else
      this.openDrawer(this.toolsContent("drawer"), "Tools and instructions");
  }
  updateToolsExpanded() {
    this.toolsButton?.setAttribute(
      "aria-expanded",
      String(
        this.drawer?.getAttribute("aria-label") === "Tools and instructions" ||
          (this.toolsOpen && matchMedia("(min-width: 1180px)").matches),
      ),
    );
  }
  closeTools() {
    if (this.drawer) this.closeDrawer();
    else {
      this.toolsOpen = false;
      this.toolPanel.hidden = true;
      this.shell.classList.remove("has-tools");
      this.toolsButton.setAttribute("aria-expanded", "false");
      this.toolsButton.focus();
    }
  }
  openQuestions() {
    const content = el("div", { class: "question-drawer" }, [
      el("div", { class: "tools-heading" }, [
        el("h2", { text: "Questions" }),
        iconButton("Close questions", "x", () => this.closeDrawer()),
      ]),
    ]);
    const list = el("nav", {
      class: "drawer-question-list",
      "aria-label": "Question navigation",
    });
    for (const [i, question] of this.state.attempt.questions.entries()) {
      const answered = !!this.store.state.answers[question.id]?.text.trim();
      const control = button(
        "",
        () => {
          this.closeDrawer();
          this.navigate(i);
          this.questionHeading.focus();
        },
        "drawer-question",
      );
      control.append(
        el("span", { text: `Question ${i + 1}` }),
        el("span", {
          text: `${answered ? "Answered" : "Blank"}${this.isFlagged(question.id) ? " · Flagged" : ""}`,
          class: "subtle",
        }),
      );
      control.setAttribute("aria-current", String(i === this.index));
      list.append(control);
    }
    content.append(list);
    this.openDrawer(content, "Questions");
  }
  openDrawer(content, label) {
    this.closeDrawer();
    const dialog = el(
      "dialog",
      { class: "workspace-drawer", "aria-label": label },
      [content],
    );
    this.drawer = dialog;
    this.root.append(dialog);
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        if (this.drawer === dialog) this.drawer = null;
        this.updateToolsExpanded();
      },
      { once: true },
    );
    dialog.showModal();
    this.updateToolsExpanded();
  }
  closeDrawer() {
    if (this.drawer) {
      this.drawer.close();
      this.drawer.remove();
      this.drawer = null;
      this.updateToolsExpanded();
    }
  }
  hideExam() {
    this.closeDrawer();
    const dialog = el("dialog", {
      class: "hide-exam",
      "aria-labelledby": "hidden-title",
    });
    dialog.append(
      el("div", { class: "hide-exam-content" }, [
        el("span", { class: "workspace-brand", text: "Due Diligence." }),
        el("h2", { id: "hidden-title", text: "Examination hidden" }),
        p("Your timer is still running. Your saved work remains preserved."),
        button("Resume examination", () => {
          dialog.close();
          dialog.remove();
          this.answer?.focus();
        }),
      ]),
    );
    this.root.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  }
  updateWordCount() {
    if (this.wordCount && this.answer) {
      const count = this.answer.value
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      this.wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
    }
  }
  onInput() {
    if (!this.writable()) return;
    // A user can cancel a navigation warning and continue writing.
    this.store.resumePersistence();
    // Persist before updating presentation or issuing any network request.
    const hadPending = this.store.pending().length > 0,
      question = this.question();
    this.store.write(question.id, this.answer.value);
    if (
      this.lengthConflicts.has(question.id) &&
      this.answer.value.length <= 200000
    ) {
      this.lengthConflicts.delete(question.id);
      this.conflicts.delete(question.id);
      this.message("");
    }
    if (!hadPending)
      this.record("local_unsynced", {
        unsyncedAnswers: this.store.pending().length,
      });
    if (!this.typedRecorded) {
      this.typedRecorded = true;
      this.record("local_save", { durable: this.store.durable });
    }
    if (this.answer.value.length > 200000)
      this.message(
        "This answer exceeds the supported 200,000 characters. It remains on this device. Download a copy and contact the examiner before submitting.",
      );
    this.updateWordCount();
    this.updateNavigation();
    this.updateSave();
    // A bounded throttle saves even while a student types continuously.
    if (!this.syncTimer)
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        this.sync();
      }, 650);
  }
  navigate(index) {
    if (
      index < 0 ||
      index >= this.state.attempt.questions.length ||
      index === this.index
    )
      return;
    this.index = index;
    this.store.setCurrent(index);
    this.showQuestion();
    this.record("question_changed", { index });
    this.request("/position", {
      method: "POST",
      body: { questionId: this.question().id },
    }).catch(() => {});
    this.sync();
    this.questionHeading.tabIndex = -1;
    this.questionHeading.focus({ preventScroll: true });
    this.root.querySelector(".question-reading").scrollTop = 0;
  }
  updateWritable() {
    if (this.answer) this.answer.readOnly = !this.writable();
    if (this.submitButton)
      this.submitButton.disabled =
        !this.leaseHeld ||
        this.deviceLock === false ||
        this.submitting ||
        this.closedLocally ||
        this.isFinalized();
    if (this.takeoverButton)
      this.takeoverButton.hidden = this.leaseHeld || this.isFinalized();
  }
  updateSave() {
    if (!this.store || !this.saveText) return;
    const summary = saveSummary(this.store, this.online, formatTime);
    const text =
      this.closedLocally && !this.isFinalized()
        ? "Time has ended. Checking the server for your submission receipt. Unsynced drafts remain on this device."
        : summary.text;
    if (this.saveText.textContent !== text) this.saveText.textContent = text;
    this.saveText.className = summary.kind;
  }
  async sync({ until = Infinity } = {}) {
    if (
      !this.store ||
      this.syncing ||
      !this.online ||
      !this.leaseHeld ||
      this.isFinalized() ||
      this.closedLocally
    )
      return;
    this.syncing = true;
    try {
      for (const pending of this.store.pending()) {
        if (
          this.closedLocally ||
          this.isFinalized() ||
          performance.now() >= until
        )
          break;
        if (this.conflicts.has(pending.questionId)) continue;
        const sent = { ...pending };
        try {
          const data = await this.request(
            `/answers/${encodeURIComponent(sent.questionId)}`,
            {
              method: "PUT",
              body: {
                operationId: sent.mutationId,
                editorId: this.editorId,
                revision: sent.revision,
                text: sent.text,
              },
              timeout: 7000,
            },
          );
          this.store.acknowledge(
            sent.questionId,
            sent.mutationId,
            data.answer.revision,
            data.answer.savedAt,
          );
          this.record("save_success", {
            revision: data.answer.revision,
            operationId: sent.mutationId,
            unsyncedAnswers: this.store.pending().length,
          });
          this.failedSaves.delete(sent.mutationId);
        } catch (error) {
          if (!this.failedSaves.has(sent.mutationId)) {
            this.record("save_failure", {
              revision: sent.revision,
              operationId: sent.mutationId,
              code: error.code || "connection",
              unsyncedAnswers: this.store.pending().length,
            });
            this.failedSaves.add(sent.mutationId);
          }
          if (error.status === 423) {
            this.leaseHeld = false;
            this.message(
              "Another tab is saving this examination. Use one tab to avoid conflicting changes. Your local writing is preserved.",
            );
          } else if (
            error.status === 409 &&
            /stale|revision|conflict/i.test(error.code || "")
          ) {
            this.conflicts.add(sent.questionId);
            this.message(
              "A different saved version was found. Your local writing is preserved. Download your answers and contact the examiner to reconcile the versions.",
            );
          } else if (error.status === 409 || error.status === 410) {
            this.refresh().catch(() => {});
          } else if (error.status >= 400 && error.status < 500) {
            this.conflicts.add(sent.questionId);
            if (error.code === "answer_too_large")
              this.lengthConflicts.add(sent.questionId);
            this.message(
              `${error.message} Your local answer is preserved. You can continue on other questions. Download a copy and contact the examiner.`,
            );
          } else {
            this.online = false;
          }
          break;
        }
      }
    } finally {
      this.syncing = false;
      this.updateSave();
      this.updateWritable();
      this.flushEvents();
    }
    // A response may arrive after more typing. Schedule the newer revision next.
    if (
      !this.syncTimer &&
      this.store
        .pending()
        .some((answer) => !this.conflicts.has(answer.questionId)) &&
      this.online &&
      this.leaseHeld &&
      !this.closedLocally &&
      !this.isFinalized()
    )
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        this.sync();
      }, 800);
  }
  async flushEvents(beacon = false) {
    if (
      !this.store ||
      !this.store.state.events.length ||
      this.eventsBusy ||
      !this.online
    )
      return;
    const events = activityBatch(
      this.store.state.events,
      beacon ? 50000 : 900000,
    );
    if (beacon && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(
          this.apiURL("/events"),
          new Blob([JSON.stringify({ events })], { type: "application/json" }),
        );
      } catch {
        /* Retry remains durable. */
      }
      return;
    }
    this.eventsBusy = true;
    let accepted = false;
    try {
      const data = await this.request("/events", {
        method: "POST",
        body: { events },
        timeout: 6000,
      });
      this.store.acknowledgeEvents(
        data.accepted || data.acceptedIds || events.map((event) => event.id),
      );
      accepted = true;
    } catch {
      /* Events remain queued, independently from answer saves. */
    } finally {
      this.eventsBusy = false;
    }
    if (accepted && this.store.state.events.length)
      setTimeout(() => this.flushEvents(), 0);
    this.scheduleFinalPreservation();
  }
  review() {
    const questions = this.state.attempt.questions,
      answered = questions.filter((question) =>
        this.store.state.answers[question.id]?.text.trim(),
      ).length;
    const dialog = el(
      "dialog",
      { class: "modal", "aria-labelledby": "review-title" },
      [
        el("h2", { id: "review-title", text: "Review your examination" }),
        p(
          `${answered} of ${questions.length} ${questions.length === 1 ? "question has" : "questions have"} an answer. ${questions.length - answered} ${questions.length - answered === 1 ? "is" : "are"} blank.`,
        ),
      ],
    );
    const list = el("nav", {
      class: "review-question-list",
      "aria-label": "Review questions",
    });
    for (const [i, question] of questions.entries()) {
      const filled = !!this.store.state.answers[question.id]?.text.trim();
      list.append(
        el(
          "button",
          {
            class: "review-question",
            type: "button",
            onclick: () => {
              dialog.close();
              this.navigate(i);
              this.questionHeading.focus();
            },
          },
          [
            el("span", { text: `Question ${question.number || i + 1}` }),
            el("span", {
              text: `${filled ? "Answered" : "Blank"}${this.isFlagged(question.id) ? " · Flagged" : ""}`,
            }),
          ],
        ),
      );
    }
    dialog.append(
      list,
      p(
        "Select a question to return to it. After the server confirms submission, submitted answers cannot be edited.",
      ),
      p(
        this.store.pending().length
          ? `${this.store.pending().length} answer changes still need to sync. Submission will first try to save these changes.`
          : "Your current answers have been saved to the server.",
        "subtle",
      ),
    );
    dialog.append(
      el("div", { class: "actions" }, [
        button(
          "Keep writing",
          () => {
            dialog.close();
            dialog.remove();
          },
          "secondary",
        ),
        button("Submit examination", () => {
          dialog.close();
          dialog.remove();
          this.store.setPendingSubmit(true);
          this.submit();
        }),
      ]),
    );
    this.root.append(dialog);
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
  }
  async submit() {
    if (!this.store || this.submitting || this.isFinalized()) return;
    this.store.setPendingSubmit(true);
    if (!this.online || !this.leaseHeld) {
      this.message(
        "Submission is waiting for a connection. Keep this browser/profile. Your answers and request remain on this device; the server has not confirmed receipt.",
      );
      return;
    }
    {
      // Existing autosaves do the work; never upload a bulk answer packet here.
      const until = performance.now() + 8500;
      while (this.syncing && performance.now() < until) await delay(100);
      await this.sync({ until });
      if (this.store.pending().length && this.clock.now() < this.deadline()) {
        this.message(
          "Some answer changes have not reached the server. Your submission request is saved on this device and will retry after connection returns. Keep this page open.",
        );
        return;
      }
    }
    this.submitting = true;
    this.updateWritable();
    this.record("manual_submission");
    try {
      if (!this.submitOperation) this.submitOperation = crypto.randomUUID();
      const data = await this.request("/submit", {
        method: "POST",
        body: { operationId: this.submitOperation, editorId: this.editorId },
        timeout: 10000,
      });
      if (!data.attempt?.receipt) {
        await this.refresh();
        if (!this.isFinalized())
          throw new Error("A submission receipt is not yet available.");
      } else await this.acceptState(data);
      if (this.isFinalized()) this.store.setPendingSubmit(false);
    } catch (error) {
      this.message(
        "The server has not confirmed submission yet. Your answers and request remain on this device. Reconnecting will check the receipt; at the deadline, the last answers saved to the server form your official submission.",
      );
    } finally {
      this.submitting = false;
      this.updateWritable();
    }
  }
  tick() {
    if (!this.state || this.state.attempt?.receipt) return;
    const now = this.clock.now(),
      waiting = this.state.exam.status === "SCHEDULED";
    const target = waiting
      ? toMillis(this.state.exam.startAt)
      : this.deadline();
    this.root.querySelectorAll("[data-countdown]").forEach((node) => {
      node.textContent = Number.isFinite(target)
        ? countdownText(target - now, this.isPractice() && !waiting)
        : "—";
    });
    this.root.querySelectorAll("[data-clock]").forEach((node) => {
      node.textContent = `${formatClock(now)} PHT`;
    });
    if (waiting && now >= target && !this.refreshing)
      this.refresh().catch(() =>
        this.message(
          "Opening is being checked. The examination will appear automatically when the server confirms it is open.",
        ),
      );
    if (
      this.screen === "exam" &&
      Number.isFinite(target) &&
      now >= target &&
      !this.closedLocally
    ) {
      this.closedLocally = true;
      this.updateWritable();
      this.updateSave();
      this.record("timeout");
      // A visual timer is an estimate. A timeout must ask for the server's
      // deadline decision, never send an early manual-submit command.
      this.refresh().catch(() =>
        this.message(
          "Time has ended on this device. The server receipt will be checked when the connection returns. Keep this browser/profile for any unsynced drafts.",
        ),
      );
    }
  }
  async recoverLateDrafts() {
    if (!this.store || !this.online || this.recovering) return;
    this.recovering = true;
    try {
      for (const answer of this.store.pending()) {
        if (this.recovered.has(answer.mutationId)) continue;
        const official = this.state.attempt.answers?.find(
          (item) => item.questionId === answer.questionId,
        );
        if (
          official?.text === answer.text &&
          official.revision === answer.revision
        ) {
          this.store.acknowledge(
            answer.questionId,
            answer.mutationId,
            official.revision,
            official.savedAt,
          );
          continue;
        }
        await this.request("/recovery", {
          method: "POST",
          body: {
            operationId: answer.mutationId,
            questionId: answer.questionId,
            revision: answer.revision,
            text: answer.text,
            clientTime: answer.editedAt,
          },
        });
        this.recovered.add(answer.mutationId);
        this.message(
          "Your unsynced writing was preserved separately as a late/offline recovered draft for examiner review. It has not changed your official submission.",
        );
      }
    } catch {
      this.message(
        "Some unsynced writing remains on this device. Keep this browser/profile and reconnect to preserve it separately for examiner review. Your official submission is unchanged.",
      );
    } finally {
      this.recovering = false;
      this.scheduleFinalPreservation();
    }
  }
  renderReceipt() {
    const attempt = this.state.attempt,
      receipt = attempt.receipt;
    const section = el("section", { class: "receipt" }, [
      receipt
        ? el("img", {
            src: "/icons/circle-check.svg",
            alt: "",
            width: 42,
            height: 42,
            class: "receipt-check",
            "aria-hidden": "true",
          })
        : null,
      p(receipt ? "Submission received" : "Examination ended", "eyebrow"),
      el("h1", {
        text: receipt ? "Your examination is submitted." : "Examination closed",
      }),
      p(this.examTitle(), "receipt-title"),
      p(
        receipt
          ? "Your submitted answers are saved. Keep a copy of this receipt for your records."
          : "Answers can no longer be edited. Reconnect to check your submission receipt.",
      ),
    ]);
    if (receipt) {
      const facts = [
        ["Name", receipt.name || attempt.name],
        ["Email", receipt.email || attempt.email],
        [
          "Submitted",
          `${formatClock(receipt.finalizedAt || receipt.serverTime || receipt.submittedAt || this.state.serverTime)} PHT`,
        ],
        [
          "Answers",
          `${receipt.answeredCount ?? 0} of ${receipt.questionCount ?? this.state.exam.questionCount} ${(receipt.questionCount ?? this.state.exam.questionCount) === 1 ? "question" : "questions"} answered`,
        ],
      ];
      section.append(
        el(
          "dl",
          {},
          facts.flatMap(([label, text]) => [
            el("dt", { text: label }),
            el("dd", { text, class: label === "Checksum" ? "checksum" : "" }),
          ]),
        ),
      );
      if ((receipt.finalizationType || receipt.type) === "deadline")
        section.append(p("Submitted automatically when time ended.", "subtle"));
      section.append(
        el("div", { class: "actions" }, [
          button("Download receipt PDF", () => this.downloadPdf(true)),
          button(
            "Download answers PDF",
            () => this.downloadDraft(),
            "secondary",
          ),
        ]),
      );
      const details = [
        ["Examination ID", receipt.examId || this.state.exam.id],
        [
          "Attempt / receipt",
          receipt.receiptId || receipt.id || receipt.attemptId || attempt.id,
        ],
        [
          "Submission type",
          receipt.type || receipt.finalizationType || "Server finalized",
        ],
        ["Checksum", receipt.checksum || "See downloaded receipt"],
      ];
      section.append(
        el("details", { class: "receipt-details" }, [
          el("summary", { text: "Receipt details" }),
          el(
            "dl",
            {},
            details.flatMap(([label, text]) => [
              el("dt", { text: label }),
              el("dd", { text, class: label === "Checksum" ? "checksum" : "" }),
            ]),
          ),
        ]),
      );
    }
    this.appendMessage(section);
    this.message(this.lastMessage || "");
    if (this.slug === "practice") {
      section.append(
        el("h2", {
          text: "Check your device before exam day",
          class: "readiness-heading",
        }),
        p(
          "Use this checklist to test the same browser and device. An unchecked step still needs to be tested.",
          "subtle",
        ),
        el("ol", { class: "checklist" }, [
          el("li", {
            text: "Enter your name and email and start the practice.",
          }),
          el("li", {
            text: "Type an answer. Confirm “Saved on this device” and then “Saved to server”.",
          }),
          el("li", {
            text: "Refresh the page. Confirm your writing returns and time does not restart.",
          }),
          el("li", {
            text: "Briefly disconnect, write a few words, reconnect and confirm the server-save message.",
          }),
          el("li", {
            text: "Submit or let the timer finish. Download the server-confirmed receipt.",
          }),
          el("li", {
            text: "Contact the examiner before exam day if any step fails. Do not clear this browser profile.",
          }),
        ]),
      );
    }
    this.root.append(section);
    const heading = section.querySelector("h1");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  downloadDraft() {
    return this.downloadPdf(false);
  }
  async downloadPdf(receiptOnly = false) {
    if (this.exportingPdf) return;
    this.exportingPdf = true;
    this.message("Preparing your PDF...");
    try {
      const { examinationPdfData, createExaminationPdf } = await import("./answer-pdf.mjs");
      const data = examinationPdfData(this.state, this.store?.state, { receiptOnly, exportedAt: this.clock.now() });
      const bytes = await createExaminationPdf(data);
      this.download(receiptOnly ? "DueDiligence-Examination-Receipt.pdf" : "DueDiligence-Examination-Answers.pdf", bytes, "application/pdf");
      this.message("Your PDF is ready. Keep it for your records.");
    } catch {
      this.message("Your PDF could not be prepared. Your answers remain saved. Please try again in this browser.");
    } finally {
      this.exportingPdf = false;
    }
  }
  download(filename, contents, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  renderConnectionError() {
    this.root.replaceChildren(
      el("section", { class: "screen-message" }, [
        p("Examination room", "eyebrow"),
        el("h1", { text: "Unable to connect" }),
        p(
          "The examination server could not be reached. Check your connection and try again. If you have already started, return using this same device and browser profile.",
        ),
        button(
          "Try again",
          () =>
            this.refresh(true).catch(() =>
              this.message("Still unable to connect. Please try again."),
            ),
          "secondary",
        ),
      ]),
    );
    this.appendMessage(this.root);
    this.root.setAttribute("aria-busy", "false");
  }
  renderAdmissionError() {
    this.root.replaceChildren(
      el("section", { class: "screen-message" }, [
        p("Examination room", "eyebrow"),
        el("h1", { text: "This admission link is unavailable" }),
        p(
          "Ask your examiner for the current examination link. If you have already started, return using the device and browser profile where your examination is saved.",
        ),
      ]),
    );
    this.root.setAttribute("aria-busy", "false");
  }
}

if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root) new ExamApp(root).start();
}
