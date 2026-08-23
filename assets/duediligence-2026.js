(function dueDiligence2026Experience(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const CONTENT_PATHS = Object.freeze({
    bar_easy: { hash: 'bar-easy', tab: 'spa-bar-easy', title: 'Quick Drills' },
    chair_case: { hash: 'chairs-cases', tab: 'spa-chairs-case', title: '2026 Bar Chair’s Cases' },
    doctrine: { hash: 'doctrines', tab: 'spa-jurisprudence', title: 'Doctrines' },
    anchor_case: { hash: 'anchor-case-digests', tab: 'spa-case-digest', title: 'Anchor Case Digests' },
    exam_room: { hash: 'examination-room', tab: 'spa-examination-room', title: 'Examination Room' },
  });
  const FLAG_NAMES = Object.freeze({
    bar_easy: 'BAR_EASY_ENABLED',
    chair_case: 'CHAIR_CASES_ENABLED',
    doctrine: 'DOCTRINES_ENABLED',
    anchor_case: 'ANCHOR_CASE_DIGESTS_ENABLED',
    exam_room: 'EXAMINATION_ROOM_2_ENABLED',
  });
  const EXAMINATION_ROOM_BASE_FLAG = 'EXAMINATION_ROOM_ENABLED';
  const RANDOMIZED_STUDY_VIEWS = new Set(['bar_easy', 'doctrine']);
  const STUDY_ROTATION_STORAGE_VERSION = 'v2';
  const EXAMINATION_ROOM_PUBLISH_WAIT_MS = 25_000;
  const EXAMINATION_ROOM_REFRESH_WAIT_MS = 8_000;
  const EXAMINATION_ROOM_MIN_HANDOFF_MS = 0;
  const PROFESSOR_ROOM_REFRESH_MS = 15_000;
  const PROFESSOR_ROOM_RETRY_MS = 30_000;
  const BEADLE_ROSTER_TEMPLATE_URL = '/assets/examination-room-beadle-class-list-template.xlsx';
  const BEADLE_ROSTER_TEMPLATE_VERSION = 'beadle-roster-v1';
  const BEADLE_STUDENT_HANDOFF_KEY = 'duediligence.exam-room.beadle-student-handoff.v1';
  const BEADLE_STUDENT_HANDOFF_MAX_AGE_MS = 36 * 60 * 60 * 1000;
  const state = {
    featureSnapshot: null,
    featureSnapshotUserId: null,
    featureSnapshotGeneration: null,
    featurePromise: null,
    featurePromiseUserId: null,
    featurePromiseGeneration: null,
    featureGeneration: 0,
    view: null,
    items: new Map(),
    filtered: [],
    selectedId: null,
    subject: 'All',
    search: '',
    result: null,
    busy: false,
    sessionUserId: null,
    exam: {
      portal: null,
      portalPromise: null,
      portalPromiseUserId: null,
      portalPromiseGeneration: null,
      portalRequestGeneration: 0,
      roomRequests: null,
      roomRequestsLoadState: 'idle',
      roomRequestsPromise: null,
      roomRequestsPromiseUserId: null,
      roomRequestsPromiseGeneration: null,
      roomRequestsPromiseForce: false,
      section: 'entry',
      intentRole: null,
      entryExamId: '',
      activeClassroomId: null,
      activeExamId: null,
      activeBeadleSnapshot: null,
      authoringSnapshots: new Map(),
      rulesAuthoringSnapshot: null,
      operationFocus: null,
      studentExamCodes: new Map(),
      rosterMode: 'professor',
      rosterPreview: null,
      rosterValidationTimer: null,
      rosterValidationGeneration: 0,
      rosterFinalization: null,
      questionPreview: null,
      attempt: null,
      attemptIndex: 0,
      entryBusy: false,
      saveTimers: new Map(),
      localSavePromises: new Map(),
      heartbeatTimer: null,
      countdownTimer: null,
      safetySaveTimer: null,
      attemptTimerKey: null,
      waitingRoomTimer: null,
      waitingRoomPollTimer: null,
      waitingRoomPolling: false,
      beadleHandoffPromise: null,
      submissionStatusTimer: null,
      serverOffsetMs: 0,
      serverClockBaseMs: 0,
      serverClockMonotonicAt: 0,
      grading: null,
      gradingModelAnswer: null,
      gradingCandidate: 0,
      gradingQuestion: 0,
      gradingFilter: 'ungraded',
      gradingDetailOpen: false,
      gradingSaveBusy: false,
      routeSubmissionId: '',
      routeQuestionOrdinal: 0,
      routeRole: '',
      resultsDashboard: null,
      monitoring: null,
      professorRoomPollTimer: null,
      professorRoomPolling: false,
      professorRoomGeneration: 0,
      professorRoomReturnExamId: null,
      preflight: null,
      submissionKey: null,
      submissionPending: false,
      offlineSince: null,
      transportFailureSince: null,
      syncing: false,
      syncRequested: false,
      maxVisitedIndex: 0,
      store: null,
      tabLease: null,
      tabReturnPending: false,
      lastIntegrityNoticeAt: 0,
      blurIncidentTimer: null,
    },
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[character]));
  }

  function codePointLength(value) { return Array.from(String(value ?? '')).length; }

  function studentInstructionsHtml(value) {
    const normalized = String(value || 'Follow the Professor’s examination instructions.')
      .replace(/\r\n?/g, '\n')
      .trim();
    const body = normalized.replace(/^instructions\b\s*[:\-–—]?\s*/i, '').trim()
      || 'Follow the Professor’s examination instructions.';
    const markerPattern = /(?:^|\s)(\d{1,2})[.)]\s+(?=\S)/g;
    const markers = [];
    let match;
    while ((match = markerPattern.exec(body)) !== null) {
      markers.push({ number: Number(match[1]), markerStart: match.index, contentStart: markerPattern.lastIndex });
    }
    const sequential = markers.length >= 2
      && markers[0].number === 1
      && markers.every((marker, index) => marker.number === index + 1);
    if (sequential) {
      const introduction = body.slice(0, markers[0].markerStart).trim();
      const items = markers.map((marker, index) => body
        .slice(marker.contentStart, markers[index + 1]?.markerStart ?? body.length)
        .trim())
        .filter(Boolean);
      return `<div class="dd26-student-instructions">${introduction ? `<p>${escapeHtml(introduction).replace(/\n/g, '<br>')}</p>` : ''}<ol>${items.map((item) => `<li>${escapeHtml(item).replace(/\n/g, '<br>')}</li>`).join('')}</ol></div>`;
    }
    const paragraphs = body.split(/\n\s*\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
    return `<div class="dd26-student-instructions">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
  }

  function randomKey(prefix = 'request') {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return `${prefix}_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
  }

  function stableRotationHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function studyRotationKey(subject = state.subject) {
    const userPartition = stableRotationHash(authenticatedUserId() || 'signed-out');
    return `duediligence.study-rotation.${STUDY_ROTATION_STORAGE_VERSION}.${userPartition}.${stableRotationHash(state.view)}.${stableRotationHash(subject)}`;
  }

  function secureRandomIndex(maximum) {
    if (!Number.isInteger(maximum) || maximum <= 1) return 0;
    const ceiling = 0x100000000;
    const acceptable = ceiling - (ceiling % maximum);
    const sample = new Uint32Array(1);
    do crypto.getRandomValues(sample); while (sample[0] >= acceptable);
    return sample[0] % maximum;
  }

  function securelyShuffle(values) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomIndex(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function readStudyRotation(items, subject = state.subject) {
    const ids = items.map((item) => String(item.id || '')).filter(Boolean);
    const allowed = new Set(ids);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(studyRotationKey(subject)) || '{}'); } catch { saved = {}; }
    const seen = Array.isArray(saved.seen)
      ? [...new Set(saved.seen.map(String).filter((id) => allowed.has(id)))]
      : [];
    const seenSet = new Set(seen);
    const remaining = Array.isArray(saved.remaining)
      ? [...new Set(saved.remaining.map(String).filter((id) => allowed.has(id) && !seenSet.has(id)))]
      : [];
    const queued = new Set(remaining);
    const additions = ids.filter((id) => !seenSet.has(id) && !queued.has(id));
    remaining.push(...securelyShuffle(additions));
    return { seen, remaining, lastId: allowed.has(String(saved.lastId || '')) ? String(saved.lastId) : '' };
  }

  function writeStudyRotation(rotation, subject = state.subject) {
    try {
      localStorage.setItem(studyRotationKey(subject), JSON.stringify({
        seen: rotation.seen,
        remaining: rotation.remaining,
        lastId: rotation.lastId,
      }));
    } catch {
      // Storage can be unavailable in strict private browsing; the current in-memory selection still works.
    }
  }

  function takeRandomStudyItem(items, subject = state.subject) {
    if (!items.length) return null;
    const ids = items.map((item) => String(item.id || '')).filter(Boolean);
    const rotation = readStudyRotation(items, subject);
    if (!rotation.remaining.length) {
      rotation.seen = [];
      rotation.remaining = securelyShuffle(ids);
      if (rotation.remaining.length > 1 && rotation.remaining[0] === rotation.lastId) {
        [rotation.remaining[0], rotation.remaining[1]] = [rotation.remaining[1], rotation.remaining[0]];
      }
    }
    const selectedId = rotation.remaining.shift() || null;
    if (selectedId) {
      rotation.seen.push(selectedId);
      rotation.lastId = selectedId;
      writeStudyRotation(rotation, subject);
    }
    return selectedId;
  }

  function consumeExplicitStudyItem(items, selectedId, subject = state.subject) {
    if (!selectedId || !items.some((item) => String(item.id) === String(selectedId))) return;
    const rotation = readStudyRotation(items, subject);
    rotation.remaining = rotation.remaining.filter((id) => id !== String(selectedId));
    if (!rotation.seen.includes(String(selectedId))) rotation.seen.push(String(selectedId));
    rotation.lastId = String(selectedId);
    writeStudyRotation(rotation, subject);
  }

  function formatDate(value) {
    if (!value) return 'Not yet scheduled';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    });
  }

  function manilaDateTime(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const raw = String(value || '').trim();
    const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (local) {
      const [, year, month, day, hour, minute, second = '0'] = local;
      return new Date(Date.UTC(
        Number(year), Number(month) - 1, Number(day),
        Number(hour) - 8, Number(minute), Number(second),
      ));
    }
    return new Date(raw);
  }

  function manilaInputValue(value) {
    const date = manilaDateTime(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  function scheduledWindowMinutes(opensAt, hardClosesAt) {
    const opensAtMs = manilaDateTime(opensAt).getTime();
    const hardClosesAtMs = manilaDateTime(hardClosesAt).getTime();
    if (!Number.isFinite(opensAtMs) || !Number.isFinite(hardClosesAtMs)
        || hardClosesAtMs <= opensAtMs) return null;
    return Math.ceil((hardClosesAtMs - opensAtMs) / 60000);
  }

  function entryClosesAtForSchedule(opensAt, hardClosesAt, lateAdmissionMinutes) {
    const opensAtMs = manilaDateTime(opensAt).getTime();
    const hardClosesAtMs = manilaDateTime(hardClosesAt).getTime();
    const lateMinutes = Number(lateAdmissionMinutes);
    if (!Number.isFinite(opensAtMs) || !Number.isFinite(hardClosesAtMs)
        || hardClosesAtMs <= opensAtMs || !Number.isSafeInteger(lateMinutes)
        || lateMinutes < 0 || lateMinutes > 480) return null;
    return new Date(Math.min(hardClosesAtMs, opensAtMs + Math.max(lateMinutes, 1) * 60000));
  }

  function entryCutoffReviewHtml(opensAt, hardClosesAt, lateAdmissionMinutes) {
    const entryClosesAt = entryClosesAtForSchedule(opensAt, hardClosesAt, lateAdmissionMinutes);
    const hardClosesAtMs = manilaDateTime(hardClosesAt).getTime();
    if (!entryClosesAt || !Number.isFinite(hardClosesAtMs)) return '';
    const closesEarly = entryClosesAt.getTime() < hardClosesAtMs;
    return `<div class="${closesEarly ? 'dd26-error' : 'dd26-success'} dd26-entry-cutoff-review" role="status"><strong>${closesEarly ? 'Student entry closes before the examination ends.' : 'Students may start until the examination ends.'}</strong> The last time a listed, signed-in student may start is ${escapeHtml(formatDate(entryClosesAt))}. ${closesEarly ? 'A student who has not started by then will be blocked.' : ''}</div>`;
  }

  function synchronizeServerClock(serverNow) {
    const serverNowMs = new Date(serverNow).getTime();
    if (!Number.isFinite(serverNowMs)) return false;
    state.exam.serverClockBaseMs = serverNowMs;
    state.exam.serverClockMonotonicAt = global.performance?.now?.() ?? 0;
    // Compatibility-only diagnostic. Countdown decisions use the monotonic
    // server baseline above, never the device wall clock as evidence.
    state.exam.serverOffsetMs = serverNowMs - Date.now();
    return true;
  }

  function currentServerTimeMs() {
    if (state.exam.serverClockBaseMs > 0 && global.performance?.now) {
      return state.exam.serverClockBaseMs
        + Math.max(0, global.performance.now() - state.exam.serverClockMonotonicAt);
    }
    return Date.now() + state.exam.serverOffsetMs;
  }

  function shortSubject(value) {
    return String(value || '')
      .replace('Political and Public International Law', 'Political')
      .replace('Commercial and Taxation Laws', 'Commercial & Tax')
      .replace('Civil Law', 'Civil')
      .replace('Labor Law and Social Legislations', 'Labor')
      .replace('Criminal Law', 'Criminal')
      .replace('Remedial Law, Legal and Judicial Ethics with Practical Exercises', 'Remedial & Ethics');
  }

  function requireAuthentication() {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    if (phase4?.getSession?.()?.access_token) return true;
    phase4?.requireAuthentication?.();
    phase4?.openSignIn?.();
    global.toast?.('Sign in to open this protected study module.', 'warn');
    return false;
  }

  function randomUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  function isClosedAttemptStatus(status) {
    return ['submitted', 'auto_submitted', 'sealed', 'final', 'released'].includes(String(status || '').toLowerCase());
  }

  function isHistoricalExam(exam, role) {
    const status = String(exam?.status || '').toLowerCase();
    if (['closed', 'grading', 'sealed'].includes(status)) return true;
    const hardClose = new Date(exam?.hardClosesAt).getTime();
    if (Number.isFinite(hardClose) && hardClose <= currentServerTimeMs()) return true;
    return role === 'student' && isClosedAttemptStatus(exam?.attemptStatus || status);
  }

  function examWorkspaceRemovalButton(exam, role) {
    if (!exam?.examId) return '';
    const title = exam.title || 'Examination';
    const status = exam.attemptStatus || exam.status || 'available';
    return `<button class="dd26-button danger" data-dd26-delete-workspace-exam="${escapeHtml(exam.examId)}" data-dd26-delete-workspace-role="${escapeHtml(role)}" data-dd26-delete-workspace-title="${escapeHtml(title)}" data-dd26-delete-workspace-status="${escapeHtml(status)}" type="button" aria-label="Delete ${escapeHtml(title)} from your ${escapeHtml(role)} workspace">Delete</button>`;
  }

  function isTransientTransportFailure(error) {
    return error instanceof TypeError
      || (!error?.code && !error?.status)
      || (error?.code === 'REQUEST_FAILED' && (!error?.status || Number(error.status) >= 500));
  }

  function isAuthenticated() {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    return Boolean(phase4?.getSession?.()?.access_token);
  }

  function authenticatedUserId() {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    const session = phase4?.getSession?.();
    return session?.access_token && session?.user?.id ? String(session.user.id) : null;
  }

  function beginExamPortalLifecycle({ clearData = false } = {}) {
    stopProfessorRoomPolling();
    state.exam.portalRequestGeneration += 1;
    state.exam.portalPromise = null;
    state.exam.portalPromiseUserId = null;
    state.exam.portalPromiseGeneration = null;
    state.exam.roomRequestsPromise = null;
    state.exam.roomRequestsPromiseUserId = null;
    state.exam.roomRequestsPromiseGeneration = null;
    state.exam.roomRequestsPromiseForce = false;
    state.exam.roomRequestsLoadState = 'idle';
    if (clearData) {
      state.exam.portal = null;
      state.exam.roomRequests = null;
    }
    return state.exam.portalRequestGeneration;
  }

  function synchronizeExamPortalIdentity(userId) {
    const normalizedUserId = userId ? String(userId) : null;
    if (state.sessionUserId === normalizedUserId) return false;
    const previousUserId = state.sessionUserId;
    state.sessionUserId = normalizedUserId;
    beginExamPortalLifecycle({ clearData: true });
    if (previousUserId && previousUserId !== normalizedUserId) {
      state.exam.intentRole = null;
      clearBeadleStudentHandoff();
    }
    return true;
  }

  function isExamRoomPageActive() {
    const page = typeof document === 'undefined' ? null : document.getElementById('page-dd2026');
    return !page || page.classList.contains('active');
  }

  function isCurrentExamPortalRequest(userId, generation) {
    return Boolean(userId)
      && state.view === 'exam_room'
      && isExamRoomPageActive()
      && state.sessionUserId === userId
      && state.exam.portalRequestGeneration === generation
      && authenticatedUserId() === userId;
  }

  function captureExamPortalLifecycle() {
    const userId = authenticatedUserId();
    if (!userId || state.view !== 'exam_room') return null;
    synchronizeExamPortalIdentity(userId);
    return { userId, generation: state.exam.portalRequestGeneration };
  }

  function isCurrentExamPortalLifecycle(lifecycle) {
    return Boolean(lifecycle)
      && isCurrentExamPortalRequest(lifecycle.userId, lifecycle.generation);
  }

  async function api(path, body) {
    const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
    if (!phase4?.request) throw new Error('The secure study service is not ready.');
    return phase4.request(path, { body });
  }

  function ensurePage() {
    let page = document.getElementById('page-dd2026');
    if (page) return page;
    page = document.createElement('section');
    page.id = 'page-dd2026';
    page.className = 'page dd26-page';
    page.innerHTML = '<div id="dd2026-app"></div>';
    document.getElementById('spa-root')?.append(page);
    return page;
  }

  function app() { return document.getElementById('dd2026-app'); }

  function invalidateFeatureCache() {
    state.featureGeneration += 1;
    state.featureSnapshot = null;
    state.featureSnapshotUserId = null;
    state.featureSnapshotGeneration = null;
    state.featurePromise = null;
    state.featurePromiseUserId = null;
    state.featurePromiseGeneration = null;
  }

  function synchronizeSessionCaches(userId) {
    const featureRequestWasPending = Boolean(state.featurePromise);
    const identityChanged = synchronizeExamPortalIdentity(userId);
    if (identityChanged || !featureRequestWasPending) invalidateFeatureCache();
    return { identityChanged, featureRequestWasPending };
  }

  function shouldReopenSessionRoute(identityChanged, routePageActive) {
    return identityChanged || !routePageActive;
  }

  function isCurrentFeatureRequest(userId, generation) {
    return Boolean(userId)
      && state.sessionUserId === userId
      && state.featureGeneration === generation
      && authenticatedUserId() === userId;
  }

  async function features({ forceFresh = false, userId = authenticatedUserId() } = {}) {
    const scopedUserId = userId ? String(userId) : null;
    if (!scopedUserId) return null;
    if (state.sessionUserId !== scopedUserId) {
      synchronizeExamPortalIdentity(scopedUserId);
      invalidateFeatureCache();
    }
    if (forceFresh) invalidateFeatureCache();
    const generation = state.featureGeneration;
    if (state.featureSnapshot
        && state.featureSnapshotUserId === scopedUserId
        && state.featureSnapshotGeneration === generation) {
      return state.featureSnapshot;
    }
    if (state.featurePromise
        && state.featurePromiseUserId === scopedUserId
        && state.featurePromiseGeneration === generation) {
      return state.featurePromise;
    }
    const pending = api('/dd2026/features', {});
    state.featurePromise = pending;
    state.featurePromiseUserId = scopedUserId;
    state.featurePromiseGeneration = generation;
    try {
      const payload = await pending;
      if (!isCurrentFeatureRequest(scopedUserId, generation)) return null;
      state.featureSnapshot = payload;
      state.featureSnapshotUserId = scopedUserId;
      state.featureSnapshotGeneration = generation;
      return payload;
    } catch (error) {
      if (!isCurrentFeatureRequest(scopedUserId, generation)) return null;
      throw error;
    } finally {
      if (state.featurePromise === pending) {
        state.featurePromise = null;
        state.featurePromiseUserId = null;
        state.featurePromiseGeneration = null;
      }
    }
  }

  function examRoomFeaturesEnabled(snapshot) {
    return snapshot?.flags?.[EXAMINATION_ROOM_BASE_FLAG] === true
      && snapshot?.flags?.[FLAG_NAMES.exam_room] === true;
  }

  async function loadExamRoomFeatures(userId) {
    let snapshot = await features({ userId });
    if (!snapshot || state.view !== 'exam_room' || authenticatedUserId() !== userId) return null;
    if (!examRoomFeaturesEnabled(snapshot)) {
      snapshot = await features({ forceFresh: true, userId });
    }
    return snapshot;
  }

  function activatePage(view, trigger, { replace = false, detailId = null } = {}) {
    ensurePage();
    const item = trigger || document.getElementById(CONTENT_PATHS[view]?.tab);
    global.showPage?.('dd2026', item, { history: false });
    const path = CONTENT_PATHS[view]?.hash || 'mock-bar';
    let hash = detailId
      ? (view === 'exam_room' ? `${path}?exam=${encodeURIComponent(detailId)}` : `${path}/${encodeURIComponent(detailId)}`)
      : path;
    if (view === 'exam_room' && detailId) {
      const parameters = new URLSearchParams({ exam: String(detailId) });
      if (state.exam.routeRole) parameters.set('role', state.exam.routeRole);
      if (state.exam.routeSubmissionId) parameters.set('submission', state.exam.routeSubmissionId);
      if (state.exam.routeQuestionOrdinal > 0) parameters.set('question', String(state.exam.routeQuestionOrdinal));
      hash = `${path}?${parameters}`;
    }
    const url = `${location.pathname}${location.search}#${hash}`;
    if (`${location.pathname}${location.search}${location.hash}` !== url) {
      history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), dueDiligence2026: view }, '', url);
    }
  }

  function loading(title) {
    app().innerHTML = `<div class="dd26-shell"><header class="dd26-header"><div><div class="dd26-kicker">Due Diligence 2026</div><h1>${escapeHtml(title)}</h1></div><span class="dd26-beta">Source-based study</span></header><div class="dd26-loading" role="status">Loading protected study material…</div></div>`;
  }

  function showError(error, retry) {
    const message = error?.message || 'This module could not be loaded.';
    app().innerHTML = `<div class="dd26-shell"><div class="dd26-error" role="alert">${escapeHtml(message)}</div><div class="dd26-actions"><button class="dd26-button" id="dd26-retry" type="button">Try again</button></div></div>`;
    document.getElementById('dd26-retry')?.addEventListener('click', retry);
  }

  async function open(view, trigger, options = {}) {
    if (!CONTENT_PATHS[view]) return false;
    if (view === 'exam_room') {
      state.exam.routeRole = String(options.role || '');
      state.exam.routeSubmissionId = String(options.submissionId || '');
      state.exam.routeQuestionOrdinal = Number(options.questionOrdinal || 0);
      if (state.exam.routeSubmissionId) state.exam.gradingDetailOpen = true;
    }
    if (view !== 'exam_room' && state.exam.grading) {
      if (!mayLeaveCurrentGrade()) return false;
      clearGradingWorkspace();
    }
    if (view !== 'exam_room' && !requireAuthentication()) return false;
    const openUserId = authenticatedUserId();
    const previousView = state.view;
    if (previousView === 'exam_room' && view !== 'exam_room') {
      stopProfessorRoomPolling();
      state.exam.monitoring = null;
    }
    if (view === 'exam_room' && openUserId) synchronizeExamPortalIdentity(openUserId);
    const portalGeneration = view === 'exam_room' || previousView === 'exam_room'
      ? beginExamPortalLifecycle()
      : null;
    state.view = view;
    state.result = null;
    activatePage(view, trigger, options);
    loading(CONTENT_PATHS[view].title);
    try {
      if (view === 'exam_room') {
        if (config?.features?.examinationRoom2 !== true) throw new Error('Examination Room 2.0 is not enabled for this environment.');
        if (options.detailId) state.exam.entryExamId = String(options.detailId).slice(0, 120);
        if (isAuthenticated()) {
          const snapshot = await loadExamRoomFeatures(openUserId);
          if (!snapshot || state.view !== view || authenticatedUserId() !== openUserId) return false;
          if (snapshot?.flags?.[EXAMINATION_ROOM_BASE_FLAG] !== true
              || snapshot?.flags?.[FLAG_NAMES.exam_room] !== true) {
            throw new Error('This module is temporarily unavailable.');
          }
        }
        if (portalGeneration !== state.exam.portalRequestGeneration) return false;
        if (!await openExamRoomView(openUserId, portalGeneration)) return false;
        if (isAuthenticated() && state.exam.routeSubmissionId && state.exam.entryExamId) {
          await loadGradingWorkspace(state.exam.entryExamId, {
            attemptId: state.exam.routeSubmissionId,
            questionOrdinal: state.exam.routeQuestionOrdinal,
          });
        } else if (state.exam.routeRole === 'student') {
          await selectExamRole('student');
        }
      } else {
        const snapshot = await features({ userId: openUserId });
        if (!snapshot || state.view !== view || authenticatedUserId() !== openUserId) return false;
        const flag = FLAG_NAMES[view];
        if (flag && snapshot?.flags?.[flag] !== true) throw new Error('This module is temporarily unavailable.');
        await openContentView(view, options.detailId || null);
      }
      return true;
    } catch (error) {
      if (state.view !== view || authenticatedUserId() !== openUserId) return false;
      showError(error, () => open(view, trigger, { ...options, replace: true }));
      return false;
    }
  }

  async function queryContent(type) {
    if (state.items.has(type)) return state.items.get(type);
    const payload = await api('/dd2026/content/query', {
      contentType: type, limit: 200, offset: 0,
    });
    const items = Array.isArray(payload.items) ? payload.items : [];
    state.items.set(type, items);
    return items;
  }

  function setContentFilter(items) {
    state.filtered = items.filter((item) => (
      (state.subject === 'All' || item.subject === state.subject)
      && (!state.search || JSON.stringify(item).toLowerCase().includes(state.search.toLowerCase()))
    ));
    if (!state.filtered.some((item) => item.id === state.selectedId)) {
      state.selectedId = RANDOMIZED_STUDY_VIEWS.has(state.view)
        ? null
        : state.filtered[0]?.id || null;
    }
  }

  async function openContentView(type, detailId) {
    const items = await queryContent(type);
    state.subject = 'All';
    state.search = '';
    state.selectedId = detailId && items.some((item) => item.id === detailId)
      ? detailId
      : RANDOMIZED_STUDY_VIEWS.has(type) ? null : items[0]?.id || null;
    setContentFilter(items);
    if (RANDOMIZED_STUDY_VIEWS.has(type) && state.selectedId) {
      consumeExplicitStudyItem(state.filtered, state.selectedId);
    }
    renderContent();
  }

  function subjectChips(items) {
    const subjects = ['All', ...new Set(items.map((item) => item.subject).filter(Boolean))];
    return `<div class="dd26-toolbar" role="group" aria-label="Filter by subject">${subjects.map((subject) => `<button class="dd26-chip${state.subject === subject ? ' is-active' : ''}" type="button" data-dd26-subject="${escapeHtml(subject)}">${escapeHtml(shortSubject(subject))}</button>`).join('')}</div>`;
  }

  function subjectSelector(items) {
    const subjects = ['All', ...new Set(items.map((item) => item.subject).filter(Boolean))];
    return `<label class="dd26-subject-picker" for="dd26-subject-select"><span>Choose a Subject</span><select class="dd26-select" id="dd26-subject-select">${subjects.map((subject) => `<option value="${escapeHtml(subject)}"${state.subject === subject ? ' selected' : ''}>${escapeHtml(subject === 'All' ? 'All subjects' : shortSubject(subject))}</option>`).join('')}</select></label>`;
  }

  function betaNotice() {
    return '<div class="dd26-notice">AI-assisted educational content. Verify every proposition independently against current law and the linked primary authority.</div>';
  }

  function renderContent() {
    const items = state.items.get(state.view) || [];
    setContentFilter(items);
    if (RANDOMIZED_STUDY_VIEWS.has(state.view) && !state.selectedId) {
      state.selectedId = takeRandomStudyItem(state.filtered);
    }
    if (state.view === 'bar_easy') renderBarEasy(items);
    else if (state.view === 'doctrine') renderDoctrines(items);
    else renderCaseLibrary(items, state.view === 'chair_case');
  }

  function selectedItem() { return state.filtered.find((item) => item.id === state.selectedId) || null; }

  function renderBarEasy(items) {
    const item = selectedItem();
    const payload = item?.payload || {};
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">Quick Drills</div><h1>Quick Drills</h1><p>Build legal reasoning with focused questions and source-based coaching.</p></div><span class="dd26-beta">Source-based study</span></header>
      ${subjectSelector(items)}
      <div class="dd26-grid">
        <section class="dd26-pane" aria-labelledby="dd26-easy-question">
          <h2 class="dd26-prompt" id="dd26-easy-question">${escapeHtml(payload.prompt || '')}</h2>
          <label class="dd26-field"><span>Your answer</span><textarea class="dd26-textarea" id="dd26-easy-answer" maxlength="5000" placeholder="Explain the rule in your own words."></textarea><small class="dd26-counter" id="dd26-easy-count">0 / 5,000</small></label>
          <div class="dd26-actions"><button class="dd26-button primary" id="dd26-easy-submit" type="button">Submit answer</button><button class="dd26-button" id="dd26-easy-next" type="button">Next question</button></div>
          <div class="dd26-privacy">Your answer text and coaching explanation are not saved. Only the completion count is recorded.</div>${betaNotice()}
        </section>
        <aside class="dd26-pane" id="dd26-easy-result"><div class="dd26-empty">Your coaching result, suggested answer, and primary source will appear here after submission.</div></aside>
      </div>
    </div>`;
    bindContentFilters();
    const answer = document.getElementById('dd26-easy-answer');
    answer?.addEventListener('input', () => { document.getElementById('dd26-easy-count').textContent = `${codePointLength(answer.value).toLocaleString()} / 5,000`; });
    document.getElementById('dd26-easy-submit')?.addEventListener('click', gradeBarEasy);
    document.getElementById('dd26-easy-next')?.addEventListener('click', () => selectNext(items));
  }

  async function gradeBarEasy() {
    if (state.busy) return;
    const item = selectedItem();
    const answer = document.getElementById('dd26-easy-answer');
    const button = document.getElementById('dd26-easy-submit');
    if (!item || !answer?.value.trim()) { global.toast?.('Write an answer before submitting.', 'warn'); return; }
    if (codePointLength(answer.value) > 5000) { global.toast?.('Quick Drills answers are limited to 5,000 characters. Nothing was truncated.', 'warn'); return; }
    state.busy = true; button.disabled = true; button.textContent = 'Reviewing…';
    try {
      const payload = await api('/dd2026/bar-easy/grade', { contentId: item.id, answer: answer.value, requestKey: randomKey('easy') });
      const result = payload.result || {};
      const study = payload.study || {};
      document.getElementById('dd26-easy-result').innerHTML = `<div class="dd26-result"><div class="dd26-kicker">Source-based coaching</div><h2 class="dd26-result-title">${escapeHtml(result.label)}</h2><section class="dd26-section"><h3>Coaching feedback</h3><p>${escapeHtml(result.feedback)}</p></section><section class="dd26-section"><h3>Suggested answer</h3><p>${escapeHtml(study.suggestedAnswer)}</p></section><section class="dd26-section"><h3>Why this works</h3><p>${escapeHtml(study.explanation)}</p></section><section class="dd26-section"><h3>Primary source</h3><p>${escapeHtml([study.primarySource?.title, study.primarySource?.citation].filter(Boolean).join(' · '))}</p>${safeSourceLink(study.primarySource?.url)}</section>${betaNotice()}</div>`;
      answer.value = '';
      answer.dispatchEvent(new Event('input'));
    } catch (error) { global.toast?.(error.message, 'warn'); }
    finally { state.busy = false; button.disabled = false; button.textContent = 'Submit answer'; }
  }

  function selectNext() {
    if (!state.filtered.length) return;
    state.selectedId = takeRandomStudyItem(state.filtered);
    state.result = null;
    renderContent();
  }

  function renderDoctrines(items) {
    const item = selectedItem();
    const payload = item?.payload || {};
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">Recall / Explain / Verify</div><h1>Doctrines</h1><p>Explain the doctrine in your own words, then compare your understanding with its canonical meaning and limits.</p></div><span class="dd26-beta">Source-based study</span></header>
      ${subjectSelector(items)}
      <div class="dd26-grid">
        <section class="dd26-pane"><div class="dd26-label">Selected doctrine</div><h2 class="dd26-prompt">${escapeHtml(item?.title || payload.doctrine_title || '')}</h2><p class="dd26-help">${escapeHtml(payload.syllabus_topic || '')}</p><label class="dd26-field"><span>Explain in your own words</span><textarea class="dd26-textarea" id="dd26-doctrine-answer" maxlength="3000" placeholder="State the meaning, required elements, and any important limit."></textarea><small class="dd26-counter" id="dd26-doctrine-count">0 / 3,000</small></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-doctrine-submit" type="button">Check mastery</button><button class="dd26-button" id="dd26-doctrine-next" type="button">Next doctrine</button></div><div class="dd26-privacy">Your answer text is not saved. Only your thumbs-up or thumbs-down mastery result is recorded.</div>${betaNotice()}</section>
        <aside class="dd26-pane" id="dd26-doctrine-result"><div class="dd26-empty">The canonical meaning, plain-language explanation, limits, and primary authority will appear after submission.</div></aside>
      </div>
    </div>`;
    bindContentFilters();
    const answer = document.getElementById('dd26-doctrine-answer');
    answer?.addEventListener('input', () => { document.getElementById('dd26-doctrine-count').textContent = `${codePointLength(answer.value).toLocaleString()} / 3,000`; });
    document.getElementById('dd26-doctrine-submit')?.addEventListener('click', gradeDoctrine);
    document.getElementById('dd26-doctrine-next')?.addEventListener('click', () => selectNext(items));
  }

  async function gradeDoctrine() {
    if (state.busy) return;
    const item = selectedItem();
    const answer = document.getElementById('dd26-doctrine-answer');
    const button = document.getElementById('dd26-doctrine-submit');
    if (!item || !answer?.value.trim()) { global.toast?.('Explain the doctrine before checking mastery.', 'warn'); return; }
    if (codePointLength(answer.value) > 3000) { global.toast?.('Doctrine answers are limited to 3,000 characters. Nothing was truncated.', 'warn'); return; }
    state.busy = true; button.disabled = true; button.textContent = 'Checking…';
    try {
      const payload = await api('/dd2026/doctrines/grade', { contentId: item.id, answer: answer.value, requestKey: randomKey('doctrine') });
      const result = payload.result || {};
      const study = payload.study || {};
      const title = result.result === 'thumbs_up' ? 'Doctrine understood' : 'Review this doctrine again';
      document.getElementById('dd26-doctrine-result').innerHTML = `<div class="dd26-result"><div class="dd26-kicker">Mastery check</div><h2 class="dd26-result-title">${escapeHtml(title)}</h2><section class="dd26-section"><h3>Feedback</h3><p>${escapeHtml(result.feedback)}</p></section><section class="dd26-section"><h3>Canonical meaning</h3><p>${escapeHtml(study.canonicalMeaning)}</p></section><section class="dd26-section"><h3>In plain language</h3><p>${escapeHtml(study.plainLanguageMeaning)}</p></section><section class="dd26-section"><h3>Limits and exceptions</h3><p>${escapeHtml(study.limits)}</p></section><section class="dd26-section"><h3>Authority</h3><p>${escapeHtml([study.authority, study.citation].filter(Boolean).join(' · '))}</p>${safeSourceLink(study.sourceUrl)}</section><div class="dd26-privacy">${escapeHtml(payload.privacy)}</div>${betaNotice()}</div>`;
      answer.value = '';
      answer.dispatchEvent(new Event('input'));
    } catch (error) { global.toast?.(error.message, 'warn'); }
    finally { state.busy = false; button.disabled = false; button.textContent = 'Check mastery'; }
  }

  function renderCaseLibrary(items, chairs) {
    const item = selectedItem();
    const payload = item?.payload || {};
    const title = chairs ? '2026 Bar Chair’s Cases' : 'Anchor Case Digests';
    const description = chairs
      ? `${items.length} decisions penned by Justice Samuel H. Gaerlan, mapped to the 2026 Bar syllabus.`
      : 'Sixty foundational decisions—ten for each official 2026 Bar subject—organized for fast ALAC recall.';
    const detailHash = item && !chairs ? item.id : null;
    if (detailHash) activatePage('anchor_case', document.getElementById('spa-case-digest'), { replace: true, detailId: detailHash });
    app().innerHTML = `<div class="dd26-shell">
      <header class="dd26-header"><div><div class="dd26-kicker">${chairs ? 'Justice Samuel H. Gaerlan / 2026' : 'Core jurisprudence / 2026'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><span class="dd26-beta">Source-based study</span></header>
      <label class="dd26-field dd26-search"><span>Search cases</span><input class="dd26-input" id="dd26-case-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search case, topic, doctrine, or citation"></label>
      ${subjectChips(items)}
      <div class="dd26-grid">
        <aside class="dd26-pane"><div class="dd26-label">${String(state.filtered.length).padStart(2, '0')} case${state.filtered.length === 1 ? '' : 's'}</div><div class="dd26-list" role="list">${state.filtered.map((entry, index) => `<button class="dd26-list-button${entry.id === state.selectedId ? ' is-active' : ''}" type="button" data-dd26-case="${escapeHtml(entry.id)}"><span class="dd26-list-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${escapeHtml(entry.payload?.short_title || entry.title)}</strong><small>${escapeHtml(shortSubject(entry.subject))}</small></span></button>`).join('') || '<div class="dd26-empty">No cases match this filter.</div>'}</div></aside>
        <article class="dd26-pane">${item ? caseDetail(payload, chairs) : '<div class="dd26-empty">Choose a case to read its digest.</div>'}</article>
      </div>
    </div>`;
    bindContentFilters();
    const search = document.getElementById('dd26-case-search');
    search?.addEventListener('input', () => { state.search = search.value; renderContent(); document.getElementById('dd26-case-search')?.focus(); });
    document.querySelectorAll('[data-dd26-case]').forEach((button) => button.addEventListener('click', () => {
      state.selectedId = button.dataset.dd26Case;
      renderContent();
    }));
  }

  function caseDetail(payload, chairs) {
    const source = payload.primary_source_url;
    return `<div class="dd26-kicker">${chairs ? `${escapeHtml(payload.relevance_rank || '')} of 30 cases` : `Rank ${escapeHtml(payload.rank_within_subject || '')} in subject`}</div><h2 class="dd26-case-title">${escapeHtml(payload.short_title || payload.case_title)}</h2><div class="dd26-case-cite"><span>${escapeHtml(payload.gr_number)}</span><span>${escapeHtml(payload.decision_date)}</span><span>${escapeHtml(payload.court_division)}</span><span>${escapeHtml(payload.ponente)}</span></div><section class="dd26-section"><h3>Why it matters for the Bar</h3><p>${escapeHtml(payload.why_bar_relevant)}</p></section>${factRow('Facts', payload.facts_digest)}${factRow('Issue', payload.issue)}${factRow('Ruling', payload.ruling)}${factRow('Controlling doctrine', payload.controlling_doctrine)}${factRow('Disposition', payload.disposition)}${chairs ? '' : factRow('ALAC use', payload.how_to_use_in_alac)}<div class="dd26-actions">${safeSourceLink(source, 'Open official full text')}<button class="dd26-button" type="button" onclick="window.print()">Print digest</button></div><div class="dd26-help">Source checked ${escapeHtml(payload.source_checked_on || '')}. Verify independently.</div>${betaNotice()}`;
  }

  function factRow(title, value) { return `<section class="dd26-fact-row"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(value || '—')}</p></section>`; }

  function safeSourceLink(value, label = 'Open primary source') {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return '';
      return `<a class="dd26-source" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } catch { return ''; }
  }

  function bindContentFilters() {
    document.getElementById('dd26-subject-select')?.addEventListener('change', (event) => {
      state.subject = event.currentTarget.value;
      state.selectedId = null;
      state.result = null;
      renderContent();
    });
    document.querySelectorAll('[data-dd26-subject]').forEach((button) => button.addEventListener('click', () => {
      state.subject = button.dataset.dd26Subject;
      state.selectedId = null;
      renderContent();
    }));
  }

  function openVerdictExport(resultId, questionId = '') {
    if (!requireAuthentication()) return false;
    const canSelectQuestion = Boolean(String(questionId || '').trim());
    openDialog(`<button class="dd26-verdict-close" data-dd26-close-dialog type="button" aria-label="Close private Analytics export">&times;</button><div class="dd26-label">Analytics / Private PDF</div><h2>Choose what to export</h2><p>Every included question contains the complete prompt, suggested answer, your answer, and coaching feedback.</p><label class="dd26-choice"><input type="radio" name="dd26-verdict-scope" value="entire_result" checked><span><strong>Entire result</strong><small>Export every available question and section.</small></span></label><label class="dd26-choice"><input type="radio" name="dd26-verdict-scope" value="questions" ${canSelectQuestion ? '' : 'disabled'}><span><strong>This question only</strong><small>${canSelectQuestion ? escapeHtml(questionId) : 'No individual question identifier is available for this legacy result.'}</small></span></label><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Back</button><button class="dd26-button primary" id="dd26-confirm-verdict-export" type="button">Generate private PDF</button></div>`);
    document.getElementById('dd26-confirm-verdict-export')?.addEventListener('click', async () => {
      const scope = document.querySelector('input[name="dd26-verdict-scope"]:checked')?.value || 'entire_result';
      const ok = await exportVerdict(resultId, scope, scope === 'questions' ? [questionId] : []);
      if (ok) closeDialog();
    });
    return true;
  }

  async function exportVerdict(resultId, selectionKind = 'entire_result', selectedIds = []) {
    if (!requireAuthentication()) return false;
    const session = (global.DueDiligencePhase4 || global.DueDiligencePhase2)?.getSession?.();
    if (!session?.access_token) return false;
    try {
      const response = await fetch(`${config.workerUrl}/dd2026/verdict/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          'X-Request-ID': randomKey('pdf_request'),
        },
        body: JSON.stringify({
          gradingResultId: Array.isArray(resultId) ? resultId[0] : resultId,
          gradingResultIds: Array.isArray(resultId) ? resultId : [resultId],
          selectionKind,
          selectedIds,
          requestKey: randomKey('verdict'),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || 'The Analytics PDF could not be generated.');
      }
      const blob = await response.blob();
      if (blob.type !== 'application/pdf' || !blob.size || blob.size > 25 * 1024 * 1024) throw new Error('The Analytics PDF response was invalid.');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'duediligence-verdict.pdf';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      global.toast?.('Your private Analytics PDF is ready.', 'ok');
      return true;
    } catch (error) {
      global.toast?.(error.message, 'warn');
      return false;
    }
  }

  async function openExamRoomView(portalUserId = authenticatedUserId(), portalGeneration = state.exam.portalRequestGeneration) {
    const localStoreApi = global.DueDiligenceExaminationRoomStore;
    if (localStoreApi?.createStore) {
      state.exam.store ||= localStoreApi.createStore();
      state.exam.store.init().then((availability) => {
        if (availability.available) return state.exam.store.cleanupConfirmed();
        return null;
      }).catch(() => { /* local retention cleanup retries on the next Examination Room open */ });
    }
    if (portalUserId) {
      if (!isCurrentExamPortalRequest(portalUserId, portalGeneration)) return false;
      const payloads = await loadInitialExamRoomPortal(portalUserId, portalGeneration);
      if (!payloads || !isCurrentExamPortalRequest(portalUserId, portalGeneration)) return false;
      const [portalPayload, requestPayload] = payloads;
      const portal = portalPayload.result || { roles: {}, classes: [], studentExams: [], beadleExams: [] };
      await enrichProfessorExamIntents(portal);
      if (!isCurrentExamPortalRequest(portalUserId, portalGeneration)) return false;
      state.exam.portal = portal;
      state.exam.roomRequests = requestPayload?.result || null;
      state.exam.roomRequestsLoadState = requestPayload?.degraded ? 'degraded' : 'ready';
    } else {
      synchronizeExamPortalIdentity(null);
      state.exam.portal = null;
      state.exam.roomRequests = null;
      state.exam.section = 'entry';
    }
    renderExamRoom();
    if (portalUserId) await restoreBeadleStudentHandoff();
    return true;
  }

  function isExamRoomAvailabilityError(error) {
    return ['EXAMINATION_ROOM_DISABLED', 'EXAMINATION_ROOM_2_DISABLED']
      .includes(String(error?.code || ''));
  }

  function roomRequestsSnapshotIsValid(snapshot) {
    return Boolean(snapshot)
      && typeof snapshot === 'object'
      && typeof snapshot.roles === 'object'
      && typeof snapshot.identity === 'object'
      && typeof snapshot.identity.email === 'string'
      && snapshot.identity.email.trim().length > 0
      && [
        snapshot.professorRequests,
        snapshot.beadleRequests,
        snapshot.administratorRequests,
        snapshot.unassignedRequests,
      ].every(Array.isArray);
  }

  function isTransientRoomRequestsError(error) {
    const status = Number(error?.status);
    return isTransientTransportFailure(error)
      || error?.code === 'EXAM_ROOM_UNAVAILABLE'
      || status === 408
      || status === 429
      || status >= 500;
  }

  async function queryRoomRequestsWithSingleRetry() {
    const query = async () => {
      const payload = await api('/exam-room/query', { operation: 'room_requests' });
      if (!roomRequestsSnapshotIsValid(payload?.result)) {
        const error = new Error('The Examination Room request response was incomplete.');
        error.code = 'REQUEST_FAILED';
        error.status = 502;
        throw error;
      }
      return payload;
    };
    try {
      return await query();
    } catch (error) {
      if (isExamRoomAvailabilityError(error) || !isTransientRoomRequestsError(error)) throw error;
      return query();
    }
  }

  async function loadInitialExamRoomPortal(userId, generation) {
    if (!isCurrentExamPortalRequest(userId, generation)) return null;
    if (state.exam.portalPromise
        && state.exam.portalPromiseUserId === userId
        && state.exam.portalPromiseGeneration === generation) {
      return state.exam.portalPromise;
    }
    const requestPortal = () => Promise.all([
      api('/exam-room/query', { operation: 'portal' }),
      queryRoomRequestsWithSingleRetry().catch((error) => {
        if (isExamRoomAvailabilityError(error)) throw error;
        return { result: state.exam.roomRequests, degraded: true };
      }),
    ]);
    const pending = (async () => {
      try {
        const payloads = await requestPortal();
        return isCurrentExamPortalRequest(userId, generation) ? payloads : null;
      } catch (error) {
        if (!isCurrentExamPortalRequest(userId, generation)) return null;
        if (!isExamRoomAvailabilityError(error)
            || config?.features?.examinationRoom2 !== true) throw error;
        const snapshot = await features({ forceFresh: true, userId });
        if (!isCurrentExamPortalRequest(userId, generation)) return null;
        if (!snapshot) return null;
        if (!examRoomFeaturesEnabled(snapshot)) throw error;
        try {
          const payloads = await requestPortal();
          return isCurrentExamPortalRequest(userId, generation) ? payloads : null;
        } catch (retryError) {
          if (!isCurrentExamPortalRequest(userId, generation)) return null;
          throw retryError;
        }
      }
    })();
    state.exam.portalPromise = pending;
    state.exam.portalPromiseUserId = userId;
    state.exam.portalPromiseGeneration = generation;
    try {
      return await pending;
    } finally {
      if (state.exam.portalPromise === pending) {
        state.exam.portalPromise = null;
        state.exam.portalPromiseUserId = null;
        state.exam.portalPromiseGeneration = null;
      }
    }
  }

  function renderExamRoom() {
    const activeAttempt = state.exam.section === 'student'
      && state.exam.attempt?.status === 'in_progress';
    if (!activeAttempt) clearAttemptTimers();
    if (state.exam.section !== 'entry' && !isAuthenticated()) {
      state.exam.portal = null;
      state.exam.section = 'entry';
    }
    const portal = state.exam.portal || { roles: {}, classes: [], studentExams: [], beadleExams: [] };
    if (state.exam.section === 'entry') {
      app().innerHTML = examEntry();
      bindExamEntry();
      return;
    }
    app().innerHTML = `<div class="dd26-shell"><button class="dd26-button dd26-exam-home-button" id="dd26-exam-role-home" type="button"><span aria-hidden="true">←</span> Return to Examination Room home</button><header class="dd26-header"><div><div class="dd26-kicker">Law school examination</div><h1>Examination Room</h1><p>One clear place to make, prepare, take, and grade a class examination.</p></div></header><main id="dd26-exam-main" tabindex="-1">${examSection(portal)}</main><p class="dd26-sr-status" id="dd26-exam-status" role="status" aria-live="polite" aria-atomic="true"></p></div>`;
    bindExamSection();
    document.getElementById('dd26-exam-role-home')?.addEventListener('click', returnToExaminationRoomHome);
    if (activeAttempt) {
      renderAttempt();
      return;
    }
    if (state.exam.preflight?.entryMode === 'beadle'
        && state.exam.preflight?.autoEnter === true
        && state.exam.preflight?.terminal !== true
        && state.exam.preflight?.blockedView !== true) {
      renderStudentWaitingRoom();
    }
  }

  async function returnToExaminationRoomHome(event) {
    if (event) event.preventDefault();
    if (state.exam.grading && !mayLeaveCurrentGrade()) return false;
    const activeAttempt = state.exam.attempt?.status === 'in_progress';
    if (activeAttempt) {
      const confirmed = global.confirm('Your examination is still running and the official clock will continue. Your latest answers must be saved before returning to the Examination Room home. Continue?');
      if (!confirmed) return false;
      try {
        await flushAllLocalSaves();
      } catch {
        global.toast?.('The latest answers could not be confirmed as saved. Stay on this page and try again.', 'warn');
        return false;
      }
      await recordIncident('focus_exit', { active: false, reason: 'returned_to_examination_room_home' });
    }
    beginExamPortalLifecycle();
    clearGradingWorkspace();
    state.exam.section = 'entry';
    closeDialog();
    clearAttemptTimers();
    state.exam.intentRole = null;
    state.exam.entryExamId = '';
    state.exam.routeRole = '';
    state.exam.routeSubmissionId = '';
    state.exam.routeQuestionOrdinal = 0;
    state.exam.gradingDetailOpen = false;
    state.exam.activeBeadleSnapshot = null;
    state.exam.rosterPreview = null;
    state.exam.questionPreview = null;
    state.exam.monitoring = null;
    if (state.exam.preflight?.entryMode === 'beadle') {
      clearBeadleStudentHandoff(state.exam.preflight.examId);
    }
    state.exam.preflight = null;
    activatePage('exam_room', document.getElementById('spa-examination-room'), { replace: true });
    renderExamRoom();
    global.scrollTo?.({ top: 0, behavior: 'smooth' });
    document.querySelector('[data-dd26-exam-role]')?.focus();
    if (activeAttempt) global.toast?.('The examination clock is still running. Choose Student to resume.', 'warn');
    return true;
  }

  function examEntry() {
    const authenticated = isAuthenticated();
    const cards = [
      ['professor', 'Professor', 'Request or make an examination', 'Request an Examination Room, prepare the questions and rules, publish, and grade.'],
      ['beadle', 'Beadle', 'Upload and confirm the class list', 'Use the invitation from the Professor, upload or paste the class list, review it once, and finish.'],
      ['student', 'Student', 'Take the examination', 'Sign in, enter the class examination code, answer, review, and submit.'],
      ['exam_administrator', 'Exam Administrator', 'Manage assigned Examination Rooms', 'Prepare quotations, issue provisional room keys, and review payment only for assigned requests.'],
    ];
    return `<div class="dd26-shell"><header class="dd26-header"><div><div class="dd26-kicker">Due Diligence / Law school examinations</div><h1>Examination Room</h1><p>Choose your role. Each choice opens one simple class flow.</p></div><span class="dd26-beta">2.0 beta</span></header><main aria-labelledby="dd26-entry-title"><h2 class="dd26-visually-hidden" id="dd26-entry-title">Choose an Examination Room role</h2><div class="dd26-role-grid">${cards.map(([id, title, subtitle, description], index) => `<button class="dd26-role-card" type="button" data-dd26-exam-role="${id}"><span class="dd26-role-number" aria-hidden="true">0${index + 1}</span><span><strong>${title}</strong><em>${subtitle}</em><small>${description}</small>${id === 'professor' ? '<span class="dd26-role-cta">Request an Examination Room</span>' : ''}</span><span class="dd26-role-arrow" aria-hidden="true">→</span></button>`).join('')}</div><div class="dd26-notice"><strong>${authenticated ? 'You are signed in.' : 'Sign-in is required to continue.'}</strong> ${authenticated ? 'Choose a role to continue. Your room access will still be checked.' : 'Students, Professors, Beadles, and Exam Administrators use their own authorized accounts.'}</div>${state.exam.entryExamId ? `<div class="dd26-deep-link"><span>Examination link detected</span><code>${escapeHtml(state.exam.entryExamId)}</code><p>The link identifies the examination only. It does not give anyone access.</p></div>` : ''}<p class="dd26-privacy">During a monitored examination, copy, cut, paste, and right-click are blocked. Leaving the exam tab is recorded and shown to the Professor and Beadle. It is reviewed by a person and is not an automatic failure. Camera collection is off.</p></main><p class="dd26-sr-status" id="dd26-exam-status" role="status" aria-live="polite" aria-atomic="true"></p></div>`;
  }

  function bindExamEntry() {
    document.querySelectorAll('[data-dd26-exam-role]').forEach((button) => button.addEventListener('click', () => selectExamRole(button.dataset.dd26ExamRole)));
  }

  async function selectExamRole(role) {
    if (!['professor', 'beadle', 'student', 'exam_administrator'].includes(role)) return;
    state.exam.intentRole = role;
    if (!isAuthenticated()) {
      const phase4 = global.DueDiligencePhase4 || global.DueDiligencePhase2;
      phase4?.requireAuthentication?.();
      phase4?.openSignIn?.();
      announceExamStatus(`Sign in to continue as ${role}.`);
      global.toast?.(`Sign in to continue as ${role}.`, 'warn');
      return;
    }
    const lifecycle = captureExamPortalLifecycle();
    if (!lifecycle) return false;
    if (!state.exam.portal) {
      const payload = await api('/exam-room/query', { operation: 'portal' });
      if (!isCurrentExamPortalLifecycle(lifecycle)) return false;
      const portal = payload.result || { roles: {}, classes: [], studentExams: [], beadleExams: [] };
      await enrichProfessorExamIntents(portal);
      if (!isCurrentExamPortalLifecycle(lifecycle)) return false;
      state.exam.portal = portal;
    }
    if (role !== 'student') await loadRoomRequests()
      .catch((error) => recoverRoomRequestsAvailability(error, false, lifecycle));
    if (!isCurrentExamPortalLifecycle(lifecycle)) return false;
    if (state.exam.section !== role) state.exam.rosterPreview = null;
    state.exam.rosterMode = role === 'beadle' ? 'beadle' : 'professor';
    state.exam.section = role;
    renderExamRoom();
    document.getElementById('dd26-exam-main')?.focus();
    return true;
  }

  function announceExamStatus(message) {
    const status = document.getElementById('dd26-exam-status');
    if (status) status.textContent = String(message || '');
  }

  function examSection(portal) {
    if (state.exam.section === 'student') return `${examRoleGuide('student')}${studentSection(portal)}`;
    if (state.exam.section === 'professor') return `${examRoleGuide('professor')}${portal.roles?.professor ? professorSection(portal) : activationSection(portal)}`;
    if (state.exam.section === 'beadle') return `${examRoleGuide('beadle')}${roomRequestLoadStatus()}${beadleSection(portal)}`;
    if (state.exam.section === 'exam_administrator') return `${examRoleGuide('exam_administrator')}${examAdministratorSection()}`;
    return '<section class="dd26-card"><div class="dd26-empty">Choose Professor, Beadle, Student, or Exam Administrator.</div></section>';
  }

  function examRoleGuide(role) {
    const guides = {
      professor: {
        label: 'Professor · Preparation steps 1 to 3',
        steps: [
          'Review and revise the examination details.',
          'Upload, review, and revise every question and its points.',
          'Save the rules draft, review it again, then publish and send the one-time Beadle key.',
        ],
      },
      beadle: {
        label: 'Beadle · Preparation steps 4 and 5',
        steps: [
          'Use the key from the Professor, then upload, paste, or enter the class list.',
          'Review the validation summary and confirm once. Due Diligence emails each listed student individually.',
        ],
      },
      student: {
        label: 'Student · Simple steps',
        steps: [
          'Sign in using the same email placed on the class list.',
          'Get the class examination code sent to your rostered email.',
          'Enter the code, check the exam details, answer, review, and submit.',
        ],
      },
      exam_administrator: {
        label: 'Exam Administrator · Assigned-room controls',
        steps: [
          'Open only a request assigned to your account.',
          'Prepare the approved quotation and issue a provisional Professor key.',
          'Review payment proof before student access can be created.',
        ],
      },
    };
    const guide = guides[role];
    if (!guide) return '';
    return `<aside class="dd26-role-guide" aria-label="${escapeHtml(guide.label)}"><div class="dd26-label">${escapeHtml(guide.label)}</div><ol>${guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></aside>`;
  }

  async function loadRoomRequests(force = false, lifecycle = captureExamPortalLifecycle()) {
    if (!isCurrentExamPortalLifecycle(lifecycle)) return null;
    if (state.exam.roomRequests && !force) return state.exam.roomRequests;
    const pending = state.exam.roomRequestsPromise;
    const pendingMatches = pending
      && state.exam.roomRequestsPromiseUserId === lifecycle.userId
      && state.exam.roomRequestsPromiseGeneration === lifecycle.generation;
    if (pendingMatches) {
      if (!force || state.exam.roomRequestsPromiseForce) return pending;
      await pending.catch(() => null);
      if (!isCurrentExamPortalLifecycle(lifecycle)) return null;
      return loadRoomRequests(true, lifecycle);
    }

    const fallback = state.exam.roomRequests;
    const request = (async () => {
      state.exam.roomRequestsLoadState = 'loading';
      try {
        const payload = await queryRoomRequestsWithSingleRetry();
        if (!isCurrentExamPortalLifecycle(lifecycle)) return null;
        const roomRequests = payload.result;
        state.exam.roomRequests = roomRequests;
        state.exam.roomRequestsLoadState = 'ready';
        return roomRequests;
      } catch (error) {
        if (!isCurrentExamPortalLifecycle(lifecycle)) return null;
        if (isExamRoomAvailabilityError(error)) {
          state.exam.roomRequestsLoadState = 'degraded';
          throw error;
        }
        // Request history is optional to the existing-room workspace. Preserve
        // the last safe snapshot without converting a failure into a false empty list or a global
        // warning-toast storm; an explicit refresh can try again later.
        state.exam.roomRequests = fallback;
        state.exam.roomRequestsLoadState = 'degraded';
        return fallback;
      }
    })();
    state.exam.roomRequestsPromise = request;
    state.exam.roomRequestsPromiseUserId = lifecycle.userId;
    state.exam.roomRequestsPromiseGeneration = lifecycle.generation;
    state.exam.roomRequestsPromiseForce = force;
    try {
      return await request;
    } finally {
      if (state.exam.roomRequestsPromise === request) {
        state.exam.roomRequestsPromise = null;
        state.exam.roomRequestsPromiseUserId = null;
        state.exam.roomRequestsPromiseGeneration = null;
        state.exam.roomRequestsPromiseForce = false;
      }
    }
  }

  async function loadRoomRequestsWithAvailabilityRecovery(force = false, lifecycle = captureExamPortalLifecycle()) {
    try {
      return await loadRoomRequests(force, lifecycle);
    } catch (error) {
      return recoverRoomRequestsAvailability(error, force, lifecycle);
    }
  }

  async function recoverRoomRequestsAvailability(error, force, lifecycle) {
    if (!isExamRoomAvailabilityError(error) || !isCurrentExamPortalLifecycle(lifecycle)) throw error;
    const snapshot = await features({ forceFresh: true, userId: lifecycle.userId });
    if (!isCurrentExamPortalLifecycle(lifecycle)) return null;
    if (!snapshot) return null;
    if (!examRoomFeaturesEnabled(snapshot)) throw error;
    return loadRoomRequests(force, lifecycle);
  }

  function roomRequestStatusLabel(status) {
    return ({
      request_submitted: 'Request submitted',
      quotation_prepared: 'Quotation prepared',
      quotation_sent: 'Quotation sent',
      awaiting_proof: 'Awaiting proof of payment',
      proof_submitted: 'Proof submitted',
      payment_under_review: 'Payment under review',
      payment_verified: 'Payment verified',
      room_activated: 'Room activated',
      cancelled: 'Cancelled',
      expired: 'Expired',
    })[String(status || '')] || 'Status pending';
  }

  function formatQuotation(amountCentavos, currency = 'PHP') {
    const amount = Number(amountCentavos);
    if (!Number.isFinite(amount) || amount <= 0) return 'Not prepared';
    return `${currency === 'PHP' ? '₱' : `${currency} `}${(amount / 100).toLocaleString('en-PH', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })}`;
  }

  function roomRequestActions(request, mode) {
    const actions = [];
    const finalState = ['cancelled', 'expired', 'room_activated'].includes(request.status);
    const hasQuote = Number(request.quotationAmountCentavos) > 0;
    const proofReviewable = ['submitted', 'under_review'].includes(request.latestProofStatus);
    if (mode === 'unassigned') {
      actions.push(`<button class="dd26-button primary" data-dd26-claim-room-request="${escapeHtml(request.requestId)}" type="button">Assign to me</button>`);
    } else if (mode === 'administrator') {
      if (!finalState) actions.push(`<button class="dd26-button" data-dd26-prepare-quotation="${escapeHtml(request.requestId)}" type="button">${hasQuote ? 'Update quotation' : 'Prepare quotation'}</button>`);
      if (hasQuote && !finalState) actions.push(`<button class="dd26-button" data-dd26-send-quotation="${escapeHtml(request.requestId)}" type="button">Send quotation</button>`);
      if (hasQuote && !request.activationIssued && !finalState) actions.push(`<button class="dd26-button primary" data-dd26-generate-room-key="${escapeHtml(request.requestId)}" type="button">Create provisional Professor key</button>`);
      if (proofReviewable && request.latestProofId) actions.push(`<button class="dd26-button primary" data-dd26-review-room-proof="${escapeHtml(request.requestId)}" data-dd26-proof-id="${escapeHtml(request.latestProofId)}" type="button">Review payment proof</button>`);
    } else {
      if (hasQuote) actions.push(`<button class="dd26-button" data-dd26-copy-quotation="${escapeHtml(request.requestId)}" type="button">Copy quotation details</button>`);
      if (hasQuote && !request.paymentVerifiedAt && !finalState) actions.push(`<button class="dd26-button primary" data-dd26-upload-room-proof="${escapeHtml(request.requestId)}" type="button">${request.latestProofStatus === 'rejected' ? 'Upload new proof' : 'Upload proof of payment'}</button>`);
    }
    return actions.join('');
  }

  function roomRequestList(requests, mode, title) {
    const rows = Array.isArray(requests) ? requests : [];
    if (!rows.length) return '';
    return `<section class="dd26-card dd26-room-request-list"><div class="dd26-question-meta"><div><div class="dd26-label">Examination Room requests</div><h2>${escapeHtml(title)}</h2></div><span class="dd26-status">${rows.length}</span></div><div class="dd26-attention-list">${rows.map((request) => `<article class="dd26-room-request-card" data-dd26-room-request-card="${escapeHtml(request.requestId)}"><div class="dd26-room-request-heading"><div><strong>${escapeHtml(request.examinationTitle || 'Examination Room')}</strong><small>${escapeHtml(request.schoolName || '')}${request.courseSubject ? ` · ${escapeHtml(request.courseSubject)}` : ''}</small></div><span class="dd26-status" data-status="${escapeHtml(request.status)}">${escapeHtml(roomRequestStatusLabel(request.status))}</span></div><dl class="dd26-room-request-summary"><div><dt>Professor</dt><dd>${escapeHtml(request.professorName || '—')}</dd></div><div><dt>Schedule</dt><dd>${escapeHtml(request.examinationDate || '—')} ${escapeHtml(String(request.startTime || '').slice(0, 5))} ${escapeHtml(request.timeZone || '')}</dd></div><div><dt>Students</dt><dd>${escapeHtml(request.estimatedStudentCount || '—')}</dd></div><div><dt>Quotation</dt><dd>${escapeHtml(formatQuotation(request.quotationAmountCentavos, request.quotationCurrency))}</dd></div>${request.latestProofStatus ? `<div><dt>Payment proof</dt><dd>${escapeHtml(roomRequestStatusLabel(request.latestProofStatus === 'verified' ? 'payment_verified' : request.latestProofStatus === 'rejected' ? 'awaiting_proof' : request.latestProofStatus === 'under_review' ? 'payment_under_review' : 'proof_submitted'))}</dd></div>` : ''}</dl>${request.quotationNotes ? `<p class="dd26-help">${escapeHtml(request.quotationNotes)}</p>` : ''}<div class="dd26-actions">${roomRequestActions(request, mode)}</div></article>`).join('')}</div></section>`;
  }

  async function refreshRoomRequestsAfterMutation(lifecycle = captureExamPortalLifecycle()) {
    if (!lifecycle) return false;
    try {
      await loadRoomRequestsWithAvailabilityRecovery(true, lifecycle);
      return isCurrentExamPortalLifecycle(lifecycle)
        && state.exam.roomRequestsLoadState === 'ready';
    } catch {
      if (isCurrentExamPortalLifecycle(lifecycle)) state.exam.roomRequestsLoadState = 'degraded';
      return false;
    }
  }

  function roomRequestLoadStatus() {
    if (state.exam.roomRequestsLoadState !== 'degraded') return '';
    const hasSnapshot = roomRequestsSnapshotIsValid(state.exam.roomRequests);
    return `<div class="dd26-notice" data-dd26-room-request-load-status role="status" aria-live="polite"><strong>${hasSnapshot ? 'Showing the last available request status.' : 'Request status is temporarily unavailable.'}</strong> ${hasSnapshot ? 'Your saved request list remains visible.' : 'Existing Examination Rooms remain available, and you can still submit a new room request.'}<div class="dd26-actions"><button class="dd26-button" data-dd26-refresh-room-requests type="button">Refresh request status</button></div></div>`;
  }

  function examAdministratorSection() {
    const snapshot = state.exam.roomRequests;
    const header = '<section class="dd26-card"><div class="dd26-label">Exam Administrator</div><h2>Assigned Examination Rooms only</h2><p>This workspace is separate from Due Diligence platform administration. It shows only requests assigned to this account and does not provide access to users, subscriptions, secrets, or unrelated rooms.</p><div class="dd26-actions"><button class="dd26-button" data-dd26-refresh-room-requests type="button">Refresh requests</button></div></section>';
    if (!roomRequestsSnapshotIsValid(snapshot)) return `${header}${roomRequestLoadStatus()}`;
    const assigned = snapshot.administratorRequests || [];
    const unassigned = snapshot.roles?.canClaimRequests ? snapshot.unassignedRequests || [] : [];
    return `${header}${roomRequestLoadStatus()}${roomRequestList(assigned, 'administrator', 'Requests assigned to you')}${roomRequestList(unassigned, 'unassigned', 'Unassigned requests available to claim')}${!assigned.length && !unassigned.length ? '<section class="dd26-card"><div class="dd26-empty">No Examination Room request is assigned to this account.</div></section>' : ''}`;
  }

  function localDateOnly(daysAhead = 1) {
    const date = new Date(Date.now() + daysAhead * 86400000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function openRoomRequestForm() {
    const sessionUser = (global.DueDiligencePhase4 || global.DueDiligencePhase2)?.getSession?.()?.user || {};
    const sessionEmail = String(sessionUser.email || '').trim();
    const metadata = sessionUser.user_metadata || {};
    const identity = (roomRequestsSnapshotIsValid(state.exam.roomRequests)
      ? state.exam.roomRequests.identity
      : null) || {
      email: sessionEmail,
      name: String(metadata.full_name || metadata.name || sessionEmail.split('@')[0] || '').trim(),
    };
    openDialog(`<div class="dd26-label">Professor request</div><h2>Request an Examination Room</h2><p>Tell Due Diligence what your class needs. Essay examinations are available now; other formats will appear only after their complete student and grading flows are ready.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Professor name</span><input class="dd26-input" id="dd26-request-professor-name" maxlength="200" value="${escapeHtml(identity.name || '')}" required></label><label class="dd26-field"><span>Signed-in Professor email</span><input class="dd26-input" value="${escapeHtml(identity.email || '')}" readonly aria-readonly="true"></label><label class="dd26-field"><span>School</span><input class="dd26-input" id="dd26-request-school" maxlength="300" required></label><label class="dd26-field"><span>Course or subject</span><input class="dd26-input" id="dd26-request-course" maxlength="200" required></label><label class="dd26-field wide"><span>Examination title</span><input class="dd26-input" id="dd26-request-title" maxlength="200" required></label><label class="dd26-field"><span>Examination date</span><input class="dd26-input" id="dd26-request-date" type="date" min="${localDateOnly(0)}" value="${localDateOnly(1)}" required></label><label class="dd26-field"><span>Start time</span><input class="dd26-input" id="dd26-request-time" type="time" value="09:00" required></label><label class="dd26-field"><span>Time zone</span><select class="dd26-select" id="dd26-request-zone"><option value="Asia/Manila" selected>Philippine Time (Asia/Manila)</option></select></label><label class="dd26-field"><span>Expected duration (minutes)</span><input class="dd26-input" id="dd26-request-duration" type="number" min="15" max="480" step="5" value="120" required></label><label class="dd26-field"><span>Estimated students</span><input class="dd26-input" id="dd26-request-students" type="number" min="1" max="500" value="40" required></label><label class="dd26-field"><span>Examination type</span><select class="dd26-select" id="dd26-request-type"><option value="essay" selected>Essay</option><option disabled>Multiple choice — not yet available</option><option disabled>Essay and multiple choice — not yet available</option><option disabled>Short answer or enumeration — not yet available</option><option disabled>Mixed assessment — not yet available</option></select></label><label class="dd26-field"><span>Send quotation to</span><select class="dd26-select" id="dd26-request-recipient"><option value="professor" selected>Me, the Professor</option><option value="beadle">The Beadle</option></select></label><div class="dd26-field wide dd26-request-beadle-fields" id="dd26-request-beadle-fields" hidden><div class="dd26-form-grid"><label class="dd26-field"><span>Beadle name</span><input class="dd26-input" id="dd26-request-beadle-name" maxlength="200"></label><label class="dd26-field"><span>Beadle email</span><input class="dd26-input" id="dd26-request-beadle-email" type="email" maxlength="254" autocomplete="email"></label></div></div><label class="dd26-field wide"><span>Useful notes (optional)</span><textarea class="dd26-textarea compact" id="dd26-request-notes" maxlength="3000"></textarea></label></div><div class="dd26-error" id="dd26-request-errors" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-submit-room-request" data-request-key="${escapeHtml(randomKey('room_request'))}" type="button">Submit request</button><button class="dd26-button" data-dd26-close-dialog type="button">Back</button></div>`);
    const recipient = document.getElementById('dd26-request-recipient');
    const updateRecipient = () => {
      const needsBeadle = recipient?.value === 'beadle';
      const fields = document.getElementById('dd26-request-beadle-fields');
      if (fields) fields.hidden = !needsBeadle;
      ['dd26-request-beadle-name', 'dd26-request-beadle-email'].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.required = needsBeadle;
      });
    };
    recipient?.addEventListener('change', updateRecipient);
    updateRecipient();
    document.getElementById('dd26-submit-room-request')?.addEventListener('click', submitRoomRequest);
  }

  async function submitRoomRequest() {
    const button = document.getElementById('dd26-submit-room-request');
    const errorHost = document.getElementById('dd26-request-errors');
    if (!button || button.disabled) return;
    const recipient = value('dd26-request-recipient');
    const formFields = [...document.querySelectorAll('#dd26-dialog-card [required]')];
    const invalid = formFields.find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
      await command({
        operation: 'submit_room_request',
        professorName: value('dd26-request-professor-name'),
        schoolName: value('dd26-request-school'),
        courseSubject: value('dd26-request-course'),
        examinationTitle: value('dd26-request-title'),
        examinationDate: value('dd26-request-date'),
        startTime: value('dd26-request-time'),
        timeZone: value('dd26-request-zone'),
        expectedDurationMinutes: Number(value('dd26-request-duration')),
        estimatedStudentCount: Number(value('dd26-request-students')),
        examinationType: value('dd26-request-type'),
        quotationRecipient: recipient,
        beadleName: recipient === 'beadle' ? value('dd26-request-beadle-name') : null,
        beadleEmail: recipient === 'beadle' ? value('dd26-request-beadle-email') : null,
        notes: value('dd26-request-notes', false),
        requestKey: button.dataset.requestKey,
      });
      await refreshRoomRequestsAfterMutation();
      closeDialog();
      renderExamRoom();
      global.toast?.('Your Examination Room request was submitted.', 'ok');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Submit request';
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = error.message; }
    }
  }

  function requestById(requestId) {
    const snapshot = state.exam.roomRequests || {};
    return ['professorRequests', 'beadleRequests', 'administratorRequests', 'unassignedRequests']
      .flatMap((key) => snapshot[key] || [])
      .find((entry) => entry.requestId === requestId) || null;
  }

  function openRoomPaymentProof(requestId) {
    const request = requestById(requestId);
    if (!request) return;
    openDialog(`<div class="dd26-label">Private payment proof</div><h2>Upload proof of payment</h2><p>This file is stored privately and can be opened only by the assigned Exam Administrator. Upload a PNG, JPEG, or PDF no larger than 8 MB.</p><dl class="dd26-publish-summary"><div><dt>Examination</dt><dd>${escapeHtml(request.examinationTitle)}</dd></div><div><dt>Quotation</dt><dd>${escapeHtml(formatQuotation(request.quotationAmountCentavos, request.quotationCurrency))}</dd></div></dl><label class="dd26-field"><span>Payment proof</span><input class="dd26-input" id="dd26-room-proof-file" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" required></label><div class="dd26-error" id="dd26-room-proof-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-submit-room-proof" data-request-id="${escapeHtml(requestId)}" data-request-key="${escapeHtml(randomKey('payment_proof'))}" type="button">Submit proof securely</button><button class="dd26-button" data-dd26-close-dialog type="button">Back</button></div>`);
    document.getElementById('dd26-submit-room-proof')?.addEventListener('click', uploadRoomPaymentProof);
  }

  async function uploadRoomPaymentProof() {
    const button = document.getElementById('dd26-submit-room-proof');
    const file = document.getElementById('dd26-room-proof-file')?.files?.[0];
    const errorHost = document.getElementById('dd26-room-proof-error');
    if (!button || button.disabled) return;
    const inferredMime = file?.type || (/\.pdf$/i.test(file?.name || '') ? 'application/pdf' : /\.png$/i.test(file?.name || '') ? 'image/png' : /\.jpe?g$/i.test(file?.name || '') ? 'image/jpeg' : '');
    if (!file || !['image/png', 'image/jpeg', 'application/pdf'].includes(inferredMime) || file.size < 1 || file.size > 8 * 1024 * 1024) {
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = 'Upload a PNG, JPEG, or PDF no larger than 8 MB.'; }
      return;
    }
    button.disabled = true;
    button.textContent = 'Uploading…';
    try {
      const encoded = await filePayload(file);
      const session = (global.DueDiligencePhase4 || global.DueDiligencePhase2)?.getSession?.();
      const response = await fetch(`${config.workerUrl}/exam-room/upload/payment-proof`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
          ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          'X-Request-ID': randomKey('payment_upload'),
        },
        body: JSON.stringify({
          requestId: button.dataset.requestId,
          fileName: encoded.fileName,
          mimeType: inferredMime,
          dataBase64: encoded.base64,
          requestKey: button.dataset.requestKey,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message || 'The payment proof could not be uploaded.');
      await refreshRoomRequestsAfterMutation();
      closeDialog();
      renderExamRoom();
      global.toast?.('Payment proof submitted for private review.', 'ok');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Submit proof securely';
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = error.message; }
    }
  }

  async function claimRoomRequest(requestId, button) {
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Assigning…'; }
    try {
      await command({ operation: 'claim_room_request', requestId, requestKey: randomKey('room_claim') });
      await refreshRoomRequestsAfterMutation();
      renderExamRoom();
      global.toast?.('The request is now assigned to this Exam Administrator account.', 'ok');
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Assign to me'; }
      global.toast?.(error.message, 'warn');
    }
  }

  function openRoomQuotation(requestId) {
    const request = requestById(requestId);
    if (!request) return;
    const amount = Number(request.quotationAmountCentavos) > 0 ? (Number(request.quotationAmountCentavos) / 100).toFixed(2) : '';
    openDialog(`<div class="dd26-label">Assigned request</div><h2>Prepare the approved quotation</h2><p>Enter only the approved amount and terms. Due Diligence does not invent rates, taxes, discounts, or payment instructions.</p><dl class="dd26-publish-summary"><div><dt>Examination</dt><dd>${escapeHtml(request.examinationTitle)}</dd></div><div><dt>Recipient</dt><dd>${escapeHtml(request.quotationRecipient === 'beadle' ? `${request.beadleName} (Beadle)` : `${request.professorName} (Professor)`)}</dd></div></dl><label class="dd26-field"><span>Approved amount (PHP)</span><input class="dd26-input" id="dd26-room-quote-amount" type="number" min="0.01" max="10000000" step="0.01" value="${escapeHtml(amount)}" required></label><label class="dd26-field"><span>Approved quotation notes (optional)</span><textarea class="dd26-textarea compact" id="dd26-room-quote-notes" maxlength="3000">${escapeHtml(request.quotationNotes || '')}</textarea></label><div class="dd26-error" id="dd26-room-quote-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-save-room-quote" data-request-id="${escapeHtml(requestId)}" data-request-key="${escapeHtml(randomKey('room_quote'))}" type="button">Save quotation</button><button class="dd26-button" data-dd26-close-dialog type="button">Back</button></div>`);
    document.getElementById('dd26-save-room-quote')?.addEventListener('click', saveRoomQuotation);
  }

  async function saveRoomQuotation() {
    const button = document.getElementById('dd26-save-room-quote');
    const errorHost = document.getElementById('dd26-room-quote-error');
    const amount = Number(value('dd26-room-quote-amount'));
    if (!button || button.disabled || !Number.isFinite(amount) || amount <= 0) {
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = 'Enter the approved quotation amount.'; }
      return;
    }
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await command({
        operation: 'prepare_room_quotation', requestId: button.dataset.requestId,
        amountCentavos: Math.round(amount * 100), notes: value('dd26-room-quote-notes', false),
        requestKey: button.dataset.requestKey,
      });
      await refreshRoomRequestsAfterMutation();
      closeDialog();
      renderExamRoom();
      global.toast?.('Quotation prepared. Review it before sending.', 'ok');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Save quotation';
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = error.message; }
    }
  }

  async function sendRoomQuotation(requestId, button) {
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    try {
      const result = await command({ operation: 'send_room_quotation', requestId, requestKey: randomKey('quote_delivery') });
      await refreshRoomRequestsAfterMutation();
      renderExamRoom();
      global.toast?.(result.deliveryStatus === 'sent' ? 'Quotation sent.' : 'Quotation saved. Email delivery is currently queued or unavailable.', result.deliveryStatus === 'sent' ? 'ok' : 'warn');
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Send quotation'; }
      global.toast?.(error.message, 'warn');
    }
  }

  function openProvisionalRoomKey(requestId) {
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
    openDialog(`<div class="dd26-label">Provisional Professor access</div><h2>Create a one-time room key</h2><p>This key lets the named Professor prepare a draft Examination Room. Student access remains blocked until payment is verified.</p><label class="dd26-field"><span>Key expires</span><input class="dd26-input" id="dd26-room-key-expiry" type="datetime-local" value="${localDateValue(expiry)}" required></label><div class="dd26-error" id="dd26-room-key-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-create-provisional-key" data-request-id="${escapeHtml(requestId)}" data-request-key="${escapeHtml(randomKey('provisional_key'))}" type="button">Create one-time key</button><button class="dd26-button" data-dd26-close-dialog type="button">Back</button></div>`);
    document.getElementById('dd26-create-provisional-key')?.addEventListener('click', generateProvisionalRoomKey);
  }

  async function generateProvisionalRoomKey() {
    const button = document.getElementById('dd26-create-provisional-key');
    const errorHost = document.getElementById('dd26-room-key-error');
    const expiresAt = new Date(value('dd26-room-key-expiry'));
    if (!button || button.disabled || !Number.isFinite(expiresAt.getTime())) {
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = 'Choose a valid key expiry time.'; }
      return;
    }
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      const result = await command({
        operation: 'generate_provisional_room_key', requestId: button.dataset.requestId,
        expiresAt: expiresAt.toISOString(), requestKey: button.dataset.requestKey,
      });
      await refreshRoomRequestsAfterMutation();
      showOneTimeSecret('Provisional Professor key', result.oneTimeProfessorKey, 'Give this key only to the named Professor. It is shown once and does not open student access before payment verification.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Create one-time key';
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = error.message; }
    }
  }

  async function openRoomProofReview(requestId, proofId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'payment_proof_review', requestId, proofId });
      const proof = payload.result;
      openDialog(`<div class="dd26-label">Private payment review</div><h2>Review proof of payment</h2><p>The link below expires shortly and is available only to the assigned Exam Administrator.</p><dl class="dd26-publish-summary"><div><dt>File</dt><dd>${escapeHtml(proof.fileName || 'Payment proof')}</dd></div><div><dt>Submitted</dt><dd>${escapeHtml(formatDate(proof.submittedAt))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(proof.status)}</dd></div></dl><div class="dd26-actions"><a class="dd26-button" href="${escapeHtml(proof.downloadUrl)}" target="_blank" rel="noopener noreferrer">Open private proof</a></div><label class="dd26-field"><span>Reason if rejecting</span><textarea class="dd26-textarea compact" id="dd26-room-proof-reason" maxlength="1000"></textarea></label><div class="dd26-error" id="dd26-room-proof-review-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" data-dd26-room-proof-decision="verified" data-request-id="${escapeHtml(requestId)}" data-proof-id="${escapeHtml(proof.proofId)}" type="button">Verify payment</button><button class="dd26-button danger" data-dd26-room-proof-decision="rejected" data-request-id="${escapeHtml(requestId)}" data-proof-id="${escapeHtml(proof.proofId)}" type="button">Reject proof</button><button class="dd26-button" data-dd26-close-dialog type="button">Back</button></div>`);
      document.querySelectorAll('[data-dd26-room-proof-decision]').forEach((button) => button.addEventListener('click', () => reviewRoomPayment(button)));
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function reviewRoomPayment(button) {
    if (!button || button.disabled) return;
    const decision = button.dataset.dd26RoomProofDecision;
    const reason = value('dd26-room-proof-reason');
    const errorHost = document.getElementById('dd26-room-proof-review-error');
    if (decision === 'rejected' && reason.length < 5) {
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = 'Explain the rejection in at least five characters.'; }
      return;
    }
    document.querySelectorAll('[data-dd26-room-proof-decision]').forEach((entry) => { entry.disabled = true; });
    try {
      await command({
        operation: 'review_room_payment', requestId: button.dataset.requestId,
        proofId: button.dataset.proofId, decision, reason,
        requestKey: randomKey('payment_review'),
      });
      await refreshRoomRequestsAfterMutation();
      closeDialog();
      renderExamRoom();
      global.toast?.(decision === 'verified' ? 'Payment verified. Student access may now be prepared.' : 'Payment proof rejected. A new proof may be submitted.', decision === 'verified' ? 'ok' : 'warn');
    } catch (error) {
      document.querySelectorAll('[data-dd26-room-proof-decision]').forEach((entry) => { entry.disabled = false; });
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = error.message; }
    }
  }

  async function copyRoomQuotation(requestId) {
    const request = requestById(requestId);
    if (!request) return;
    const text = [
      'Due Diligence Examination Room quotation',
      `Examination: ${request.examinationTitle || ''}`,
      `School: ${request.schoolName || ''}`,
      `Course or subject: ${request.courseSubject || ''}`,
      `Schedule: ${request.examinationDate || ''} ${String(request.startTime || '').slice(0, 5)} (${request.timeZone || 'Asia/Manila'})`,
      `Quotation: ${formatQuotation(request.quotationAmountCentavos, request.quotationCurrency)}`,
      request.quotationNotes ? `Notes: ${request.quotationNotes}` : '',
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); global.toast?.('Quotation details copied.', 'ok'); }
    catch { global.toast?.('Copy was not available. Keep this request open and try again.', 'warn'); }
  }

  function studentSection(portal) {
    const exams = portal.studentExams || [];
    const rows = exams.map((exam) => {
      const attemptStatus = exam.attemptStatus || exam.status;
      const primaryAction = exam.resultReleased
        ? `<button class="dd26-button" data-dd26-student-result="${escapeHtml(exam.examId)}" type="button">View result</button>`
        : exam.attemptId && isClosedAttemptStatus(attemptStatus)
          ? `<button class="dd26-button" data-dd26-submission-status="${escapeHtml(exam.attemptId)}" type="button">View receipt</button>`
          : exam.attemptId
            ? `<button class="dd26-button" data-dd26-resume-attempt="${escapeHtml(exam.attemptId)}" type="button">Resume</button>`
            : '<span class="dd26-help">Enter your current class code above</span>';
      return `<tr><td><strong>${escapeHtml(exam.title)}</strong></td><td>${escapeHtml(formatDate(exam.opensAt))}<br>to ${escapeHtml(formatDate(exam.hardClosesAt))}</td><td><span class="dd26-status">${escapeHtml(attemptStatus)}</span></td><td><div class="dd26-actions dd26-table-actions">${primaryAction}${examWorkspaceRemovalButton(exam, 'student')}</div></td></tr>`;
    }).join('');
    return `<section class="dd26-card"><div class="dd26-label">Student examination</div><h2>Enter your class access code</h2><p>Sign in with the Google account listed in the Beadle's confirmed class list, then enter the code sent for your class.</p><div class="dd26-notice"><strong>No examination link or reference is needed.</strong> The secure code resolves the correct examination without revealing questions before opening.</div><div class="dd26-form-grid"><label class="dd26-field wide"><span>Student exam code</span><input class="dd26-input" id="dd26-student-key" type="password" autocomplete="one-time-code" required><small class="dd26-help">Use the current code emailed to your rostered account.</small></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-start-attempt" type="button">Check exam details</button></div><div class="dd26-privacy">A code never replaces sign-in or the class-list check. During the exam, copy, cut, paste, and right-click are blocked. Be online to sign in and start. If the connection drops after the exam opens, answers can remain saved on this device until it reconnects. Do not clear browser data.</div></section><section class="dd26-card"><div class="dd26-label">Your examinations</div><h2>Available and completed exams</h2>${exams.length ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Examination</th><th>Schedule</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="dd26-empty">No active examination is available for this signed-in account.</div>'}</section>`;
  }

  function activationSection(portal) {
    const requests = state.exam.roomRequests?.professorRequests || [];
    return `<section class="dd26-card dd26-room-request-hero"><div class="dd26-label">Professor access</div><h2>Request or open an Examination Room</h2><p>Submit a short request for a new room. After an Exam Administrator prepares the approved quotation, a provisional one-time key can let you begin draft setup while payment is reviewed.</p><div class="dd26-actions"><button class="dd26-button primary" id="dd26-request-room" type="button">Request an Examination Room</button><button class="dd26-button" data-dd26-refresh-room-requests type="button">Refresh request status</button></div></section>${roomRequestLoadStatus()}${roomRequestList(requests, 'professor', 'Your room requests')}<section class="dd26-card"><details class="dd26-room-setup" ${requests.length ? '' : 'open'}><summary>Already have a Professor key?</summary><p>The one-time key works only with the exact signed-in Professor email and expires at the time shown by Due Diligence.</p><label class="dd26-field"><span>Professor invitation key</span><input class="dd26-input" id="dd26-activation-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-redeem-activation" type="button">Open Examination Room</button></div><div class="dd26-notice"><strong>Student access remains protected.</strong> A provisional Professor key can open draft setup, but the Beadle cannot create the student exam code before payment verification.</div></details></section>`;
  }

  function beadleSection(portal) {
    const exams = portal.beadleExams || portal.beadleAssignments || [];
    const requests = state.exam.roomRequests?.beadleRequests || [];
    return `${roomRequestList(requests, 'beadle', 'Quotation and payment requests sent to you')}<section class="dd26-card"><details class="dd26-room-setup" ${exams.length ? '' : 'open'}><summary>Open a Beadle assignment</summary><p>After publishing, the Professor gives the named Beadle a one-time key. It opens only the class-preparation and exam-day workspace for that examination.</p><label class="dd26-field"><span>Beadle key from the Professor</span><input class="dd26-input" id="dd26-beadle-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-redeem-beadle" type="button">Open Beadle workspace</button></div><div class="dd26-notice"><strong>This Beadle key is not the student exam code.</strong> Do not give it to students.</div></details></section><section class="dd26-card"><div class="dd26-question-meta"><div><div class="dd26-label">Your assigned examinations</div><h2>Prepare the class and exam-day handout</h2></div><span class="dd26-status">${exams.length} assigned</span></div>${exams.length ? `<div class="dd26-attention-list">${exams.map((exam) => `<article><div><strong>${escapeHtml(exam.title || 'Examination')}</strong><small>${escapeHtml(exam.studentAccessReady ? 'Student handout ready' : 'Class preparation required')} · Beadle access until ${escapeHtml(formatDate(exam.expiresAt))}</small></div><div class="dd26-actions"><button class="dd26-button${exam.studentAccessReady ? '' : ' primary'}" data-dd26-beadle-exam="${escapeHtml(exam.examId)}" type="button">${exam.studentAccessReady ? 'Open exam-day desk' : 'Prepare class list'}</button>${examWorkspaceRemovalButton(exam, 'beadle')}</div></article>`).join('')}</div>` : '<div class="dd26-empty">No published examination is assigned to this Beadle account.</div>'}<div class="dd26-privacy">The Beadle can prepare the class list and student handout, confirm entry, and help during the exam. Questions, answers, grades, and result release remain with the Professor.</div></section>`;
  }

  function professorExamSummary(exam, classroom = {}) {
    if (!exam) {
      return {
        status: 'Room ready — no examination created',
        schedule: 'No schedule yet',
        primaryLabel: 'Create examination',
      };
    }
    const status = String(exam.status || '').toLowerCase();
    const publicationStateKnown = exam.publicationStateKnown === true;
    const published = publicationStateKnown
      && Boolean(exam.currentPublicationId || exam.publicationId || exam.publishedVersion);
    const questionsReady = exam.questionsReady === true
      || ['confirmed', 'scheduled', 'open', 'closed', 'grading', 'sealed'].includes(status);
    const rosterCount = Number(exam.rosterCount ?? classroom.rosterCount ?? 0);
    const studentAccessReady = exam.studentAccessReady === true;
    let presentationStatus = 'Professor preparation';
    let primaryLabel = questionsReady ? 'Continue preparation' : 'Prepare questions';
    if (published && !exam.beadleAssigned) presentationStatus = exam.beadleInvitationIssued ? 'Waiting for Beadle to open' : 'Beadle invitation pending';
    else if (published && rosterCount < 1) presentationStatus = 'Waiting for class list';
    else if (published && !studentAccessReady) presentationStatus = 'Waiting for student code';
    else if (published) presentationStatus = 'Student access ready';
    if (status === 'open') { presentationStatus = 'Open now'; primaryLabel = 'Monitor exam'; }
    else if (['closed', 'grading'].includes(status)) { presentationStatus = status === 'grading' ? 'Grading' : 'Closed'; primaryLabel = 'Grade submissions'; }
    else if (['sealed', 'released'].includes(status)) { presentationStatus = 'Results ready'; primaryLabel = 'View results'; }
    else if (published) primaryLabel = 'Manage examination';
    const opens = exam.opensAt ? formatDate(exam.opensAt) : 'Not scheduled';
    const closes = exam.hardClosesAt ? formatDate(exam.hardClosesAt) : '';
    return {
      status: presentationStatus,
      schedule: closes ? `${opens} to ${closes}` : opens,
      primaryLabel,
    };
  }

  function professorExamList(classes, activeClass) {
    return `<div class="dd26-professor-exam-list" role="list" aria-label="Your examinations" tabindex="-1">${classes.map((classroom) => {
      const exam = classroom.exams?.[0] || null;
      const title = exam?.title || classroom.title || 'Examination Room';
      const summary = professorExamSummary(exam, classroom);
      const selected = classroom.classroomId === activeClass?.classroomId;
      const rosterCount = Number(exam?.rosterCount ?? classroom.rosterCount ?? 0);
      const published = Boolean(exam?.currentPublicationId || exam?.publicationId || exam?.publishedVersion);
      const primaryAction = published
        ? `<button class="dd26-button primary" type="button" data-dd26-monitor-exam="${escapeHtml(exam.examId)}" aria-label="Enter the virtual Examination Room for ${escapeHtml(title)}">Enter virtual room</button>`
        : `<button class="dd26-button primary" type="button" data-dd26-class="${escapeHtml(classroom.classroomId)}" aria-label="${escapeHtml(summary.primaryLabel)} for ${escapeHtml(title)}">${escapeHtml(summary.primaryLabel)}</button>`;
      const secondaryAction = published
        ? `<button class="dd26-button" type="button" data-dd26-class="${escapeHtml(classroom.classroomId)}" aria-label="View or prepare ${escapeHtml(title)}">View / prepare</button>`
        : '';
      return `<article class="dd26-professor-exam-row${selected ? ' is-selected' : ''}" role="listitem" ${selected ? 'aria-current="true"' : ''}><div class="dd26-professor-exam-summary"><div class="dd26-professor-exam-title"><strong>${escapeHtml(title)}</strong><span class="dd26-status">${escapeHtml(summary.status)}</span></div><div class="dd26-professor-exam-meta"><span><strong>Room</strong> ${escapeHtml(classroom.title || 'Examination Room')}</span><span><strong>Schedule</strong> ${escapeHtml(summary.schedule)}</span><span><strong>Students</strong> ${escapeHtml(rosterCount)}</span></div></div><div class="dd26-professor-exam-actions">${primaryAction}${secondaryAction}${examWorkspaceRemovalButton(exam, 'professor')}</div></article>`;
    }).join('')}</div>`;
  }

  function professorSection(portal) {
    const classes = portal.classes || [];
    const archivedProfessorExams = (Array.isArray(portal.archivedProfessorExams)
      ? portal.archivedProfessorExams
      : []).filter((exam) => isHistoricalExam(exam, 'professor'));
    const activeClass = classes.find((entry) => entry.classroomId === state.exam.activeClassroomId) || null;
    const requests = state.exam.roomRequests?.professorRequests || [];
    const requestStatus = roomRequestLoadStatus();
    const workspace = classes.length
      ? `<section class="dd26-card dd26-professor-focus"><div class="dd26-question-meta"><div><div class="dd26-label">Professor workspace</div><h2>Your examinations</h2><p>Choose an examination from the list. Published examinations open in their dedicated virtual room; drafts open in preparation.</p></div><span class="dd26-status">${escapeHtml(classes.length)} available</span></div>${professorExamList(classes, activeClass)}${activeClass ? `<div class="dd26-professor-selected-workspace"><div class="dd26-actions"><button class="dd26-button" id="dd26-back-to-professor-exam-list" type="button">Back to all examinations</button></div><div class="dd26-label">Selected examination</div>${professorClass(activeClass)}</div>` : ''}</section>`
      : '<section class="dd26-card"><div class="dd26-empty">No Examination Room is open yet. Request a room or enter a one-time Professor key below.</div></section>';
    const officialRecords = archivedProfessorExams.length
      ? `<section class="dd26-card"><div class="dd26-question-meta"><div><div class="dd26-label">Permanent Professor record</div><h2>Official grade archive</h2></div><span class="dd26-status">${escapeHtml(archivedProfessorExams.length)} preserved</span></div><p>Completed exams removed from the workspace remain available here. Their submissions, saved grades, comments, result delivery status, analytics, and workbook exports are never deleted.</p><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Examination</th><th>Room</th><th>Status</th><th>Action</th></tr></thead><tbody>${archivedProfessorExams.map((exam) => `<tr><td><strong>${escapeHtml(exam.title || 'Past examination')}</strong><br><small>${escapeHtml(formatDate(exam.sealedAt || exam.hardClosesAt))}</small></td><td>${escapeHtml(exam.classroomTitle || 'Examination Room')}</td><td><span class="dd26-status">${escapeHtml(exam.status || 'preserved')}</span></td><td><button class="dd26-button primary" data-dd26-results-dashboard="${escapeHtml(exam.examId)}" type="button">Open grade record</button></td></tr>`).join('')}</tbody></table></div></section>`
      : '';
    const setup = `<section class="dd26-card"><details class="dd26-room-setup" ${classes.length ? '' : 'open'}><summary>Room setup and access</summary><p>Use a new one-time key only when opening another Examination Room.</p><label class="dd26-field"><span>Professor invitation key</span><input class="dd26-input" id="dd26-activation-key" type="password" autocomplete="one-time-code"><small class="dd26-help">The key is tied to this signed-in Professor account and can be used once.</small></label><div class="dd26-actions"><button class="dd26-button" id="dd26-redeem-activation" type="button">Open another room</button><button class="dd26-button primary" id="dd26-request-room" type="button">Request another Examination Room</button><button class="dd26-button" data-dd26-refresh-room-requests type="button">Refresh request status</button></div></details></section>`;
    return `${workspace}${officialRecords}${requestStatus}${setup}${roomRequestList(requests, 'professor', 'Your room requests')}`;
  }

  function professorClass(classroom) {
    const exams = classroom.exams || [];
    const authoring = exams.length ? '<section class="dd26-section"><div class="dd26-notice"><strong>Continue the examination below.</strong> One Examination Room holds one examination. Each completed step unlocks the next classroom handoff.</div></section>'
      : `<section class="dd26-section">${professorFlowList(null, classroom)}<h3>Make the examination</h3><p>Enter the official details first. The examination stays private until you review every question and publish it for the Beadle.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Exam title</span><input class="dd26-input" id="dd26-exam-title" maxlength="200"></label><label class="dd26-field"><span>Number of questions</span><input class="dd26-input" id="dd26-exam-count" type="number" min="1" max="200" step="1"><small class="dd26-help">Choose 1–200 questions. The Professor decides the number.</small></label><label class="dd26-field wide"><span>Instructions for students</span><textarea class="dd26-textarea" id="dd26-exam-instructions" maxlength="10000"></textarea></label><label class="dd26-field"><span>If a student leaves the exam tab</span><select class="dd26-select" id="dd26-exam-integrity"><option value="standard" selected>Record for Professor review</option><option value="strict">Warn the student and record</option></select><small class="dd26-help">Copy, cut, paste, and right-click are blocked during the monitored exam. Leaving the tab never causes an automatic failure.</small></label><label class="dd26-field"><span>Student result when grades are sent</span><select class="dd26-select" id="dd26-exam-questionnaire"><option value="false" selected>Grades and comments only</option><option value="true">Questions, grades, and comments</option></select><small class="dd26-help">Student answers are not sent in the class result. The Professor confirms this choice again before sending.</small></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-create-exam" type="button">Create examination</button></div></section>`;
    return `<div class="dd26-question-meta"><span>${escapeHtml(classroom.title)}</span><span class="dd26-status">${classroom.rosterCount || 0} students on the class list</span></div><div class="dd26-notice"><strong>Who creates the student exam code?</strong> The Professor publishes and sends the Beadle key. The Beadle then saves the official class list and selects <em>Create student exam code</em>. One class-wide code is given to all listed students.</div>${authoring}<section class="dd26-section"><h3>Your examination</h3>${examCards(exams, classroom)}</section>`;
  }

  function professorFlowList(exam, classroom = {}) {
    const status = String(exam?.status || '').toLowerCase();
    const questionsReady = exam?.questionsReady === true
      || ['confirmed', 'scheduled', 'open', 'closed', 'grading', 'sealed'].includes(status);
    const published = Boolean(exam?.currentPublicationId || exam?.publicationId || exam?.publishedVersion);
    const rosterCount = Number(exam?.rosterCount ?? classroom.rosterCount ?? 0);
    const rosterReady = rosterCount > 0;
    const studentAccessReady = exam?.studentAccessReady === true;
    const steps = [
      {
        id: 'details', title: 'Examination details', complete: Boolean(exam),
        copy: 'Enter the title, instructions, and number of questions.',
        action: exam ? (published ? 'Review details' : 'Review & edit') : null,
      },
      {
        id: 'questions', title: 'Questions reviewed', complete: questionsReady,
        copy: 'Upload or paste every question, check the points, and confirm the student preview.',
        action: exam ? (questionsReady ? (published ? 'Review questions' : 'Review & edit') : 'Upload & review') : null,
      },
      {
        id: 'rules', title: 'Rules and publication', complete: published,
        copy: 'Set the schedule and rules. Publication gives the Professor a one-time Beadle key.',
        action: exam && (questionsReady || published) ? (published ? 'Review published rules' : 'Set rules & publish') : null,
        blockedAction: exam && !questionsReady ? 'Finish question review first' : null,
      },
      {
        id: 'roster', title: 'Class list saved', complete: rosterReady,
        copy: `The Beadle uploads and checks the students${rosterReady ? ` (${rosterCount} listed)` : ''}.`,
        action: published ? 'Review class list' : null,
      },
      {
        id: 'handout', title: 'Student handout ready', complete: studentAccessReady,
        copy: 'After the class list is confirmed, Due Diligence emails the class code to each listed student.',
        action: published ? 'Review handout' : null,
      },
    ];
    const firstPending = steps.findIndex((step) => !step.complete);
    return `<ol class="dd26-flow-list" aria-label="Five-step examination preparation">${steps.map((step, index) => {
      const { id, title, complete, copy, action, blockedAction } = step;
      const current = index === firstPending;
      const stateClass = complete ? 'is-complete' : current ? 'is-current' : 'is-blocked';
      const label = complete ? 'Complete' : current ? 'Current step' : 'Waiting';
      const actionMarkup = action
        ? `<button class="dd26-button dd26-flow-action" type="button" data-dd26-professor-step="${escapeHtml(id)}" data-dd26-step-exam="${escapeHtml(exam.examId)}">${escapeHtml(action)}</button>`
        : blockedAction
          ? `<button class="dd26-button dd26-flow-action" type="button" disabled title="Upload, review, and confirm every question before setting the exam rules.">${escapeHtml(blockedAction)}</button>`
          : '';
      return `<li class="dd26-flow-step ${stateClass}${actionMarkup ? ' has-action' : ''}" ${current ? 'aria-current="step"' : ''}><span class="dd26-flow-marker" aria-hidden="true">${index + 1}</span><span class="dd26-flow-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span><span class="dd26-status">${label}</span>${actionMarkup}</li>`;
    }).join('')}</ol>`;
  }

  function rosterPreviewHtml() {
    const preview = state.exam.rosterPreview;
    if (!preview) return '';
    const errors = preview.validation?.errors || [];
    const rows = Array.isArray(preview.rows) ? preview.rows : [];
    const beadleMode = state.exam.rosterMode === 'beadle';
    const ready = preview.validation?.ok === true;
    const statusCopy = ready
      ? `${rows.length} students are ready to save.`
      : `${errors.length || 1} item(s) must be corrected.`;
    const errorList = errors.length
      ? `<ul>${errors.map((error) => `<li>${escapeHtml(error.row ? `Row ${error.row}: ` : '')}${escapeHtml(error.message || error.code || error)}</li>`).join('')}</ul>`
      : '';
    if (beadleMode) {
      return `<section class="dd26-roster-preview" id="dd26-roster-preview" aria-labelledby="dd26-roster-preview-heading"><div class="dd26-roster-preview-head"><div><div class="dd26-label">Class-list check</div><h4 id="dd26-roster-preview-heading">Review students before confirming</h4></div><span class="dd26-status">${rows.length} student${rows.length === 1 ? '' : 's'}</span></div><div class="${ready ? 'dd26-success' : 'dd26-error'}" id="dd26-roster-preview-status" role="status">${escapeHtml(statusCopy)}${errorList}</div><div class="dd26-table-wrap"><table class="dd26-table dd26-beadle-roster-preview"><thead><tr><th>Email Address</th><th>Student Number (optional)</th><th>Student Name</th><th></th></tr></thead><tbody>${rows.map((row, index) => `<tr data-dd26-roster-row="${index}"><td><input class="dd26-input" data-dd26-roster-field="email" type="email" value="${escapeHtml(row.email || '')}" aria-label="Student ${index + 1} email"></td><td><input class="dd26-input" data-dd26-roster-field="studentNumber" value="${escapeHtml(row.studentNumber || '')}" aria-label="Student ${index + 1} number"></td><td><input class="dd26-input" data-dd26-roster-field="displayName" value="${escapeHtml(row.displayName || '')}" aria-label="Student ${index + 1} name"></td><td><button class="dd26-button danger" data-dd26-remove-roster-row="${index}" type="button" aria-label="Remove student ${index + 1}">Remove</button></td></tr>`).join('')}</tbody></table></div><div class="dd26-actions"><button class="dd26-button" id="dd26-add-roster-row" type="button">Add another student</button><button class="dd26-button" id="dd26-revalidate-roster" type="button">Check corrections</button></div></section>`;
    }
    return `<div class="${ready ? 'dd26-success' : 'dd26-error'}" id="dd26-roster-preview-status" role="status">${escapeHtml(statusCopy)}${errorList}</div><div class="dd26-table-wrap"><table class="dd26-table dd26-editable-roster"><thead><tr><th>Primary email</th><th>Student ID</th><th>Exam number</th><th>Name (optional)</th><th></th></tr></thead><tbody>${rows.map((row, index) => `<tr data-dd26-roster-row="${index}"><td><input class="dd26-input" data-dd26-roster-field="email" type="email" value="${escapeHtml(row.email)}" aria-label="Row ${index + 1} email"></td><td><input class="dd26-input" data-dd26-roster-field="studentNumber" value="${escapeHtml(row.studentNumber)}" aria-label="Row ${index + 1} student ID"></td><td><input class="dd26-input" data-dd26-roster-field="candidateNumber" value="${escapeHtml(row.candidateNumber)}" aria-label="Row ${index + 1} exam number"></td><td><input class="dd26-input" data-dd26-roster-field="displayName" value="${escapeHtml(row.displayName || '')}" aria-label="Row ${index + 1} name"></td><td><button class="dd26-button danger" data-dd26-remove-roster-row="${index}" type="button" aria-label="Remove class-list row ${index + 1}">Remove</button></td></tr>`).join('')}</tbody></table></div><div class="dd26-actions"><button class="dd26-button" id="dd26-add-roster-row" type="button">Add student</button><button class="dd26-button" id="dd26-revalidate-roster" type="button">Check corrections</button></div>`;
  }

  function examCards(exams, classroom = {}) {
    if (!exams.length) return '<div class="dd26-empty">No examination has been created for this class.</div>';
    return exams.map((exam) => {
      const publicationStateKnown = exam.publicationStateKnown === true;
      const published = publicationStateKnown
        && Boolean(exam.currentPublicationId || exam.publicationId || exam.publishedVersion);
      const versionLabel = exam.sealedAt
        ? 'Sealed'
        : (exam.publicationNumber || exam.publishedVersion)
          ? `v${escapeHtml(exam.publicationNumber || exam.publishedVersion)}`
          : published ? 'Published' : 'Draft';
      const status = String(exam.status || '').toLowerCase();
      const questionsReady = exam.questionsReady === true
        || ['confirmed', 'scheduled', 'open', 'closed', 'grading', 'sealed'].includes(status);
      const replacementAction = published && !exam.sealedAt
        ? exam.canReplacePublication === true && exam.canUploadReplacementQuestions === true
          ? `<button class="dd26-button danger" data-dd26-replace-publication="${escapeHtml(exam.examId)}" type="button">Replace before any start</button>`
          : `<button class="dd26-button" type="button" disabled title="${escapeHtml(exam.replaceBlockedReason || 'Corrected questions cannot be published now. After a student starts, issue a visible correction notice instead.')} ">Use a correction notice</button>`
        : '';
      const studentAccessReady = exam.studentAccessReady === true;
      const canOpenNow = published && !exam.sealedAt && status === 'scheduled';
      const rosterCount = Number(exam.rosterCount ?? classroom.rosterCount ?? 0);
      const preparationStatus = !published
        ? 'Professor preparation'
        : !exam.beadleAssigned
          ? (exam.beadleInvitationIssued ? 'Waiting for Beadle to open' : 'Beadle invitation pending')
          : rosterCount < 1
            ? 'Waiting for class list'
            : !studentAccessReady
              ? 'Waiting for student code'
              : 'Student access ready';
      const publishedActions = published
        ? `<button class="dd26-button" data-dd26-manage-beadles="${escapeHtml(exam.examId)}" type="button">Manage Beadle access</button><button class="dd26-button" data-dd26-refresh-professor type="button">Refresh class status</button>${canOpenNow ? `<button class="dd26-button primary" data-dd26-open-exam-now="${escapeHtml(exam.examId)}" type="button">Open exam now</button>` : ''}${studentAccessReady ? `<button class="dd26-button" data-dd26-monitor-exam="${escapeHtml(exam.examId)}" type="button">Check live exam</button>` : ''}<button class="dd26-button primary" data-dd26-grade-exam="${escapeHtml(exam.examId)}" type="button">Grade submitted exams</button><button class="dd26-button" data-dd26-results-dashboard="${escapeHtml(exam.examId)}" type="button">Class results</button>${rosterCount > 0 ? `<button class="dd26-button" data-dd26-accommodation-exam="${escapeHtml(exam.examId)}" type="button">Student accommodations</button>` : ''}<button class="dd26-button" data-dd26-erratum-exam="${escapeHtml(exam.examId)}" type="button">Send correction notice</button>`
        : '';
      const removalAction = examWorkspaceRemovalButton(exam, 'professor');
      return `<article class="dd26-card"><div class="dd26-question-meta"><span>${escapeHtml(exam.title)}</span><span class="dd26-status">${escapeHtml(preparationStatus)}</span></div><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${exam.questionCount || 0}</strong><span>Questions</span></div><div class="dd26-stat"><strong>${escapeHtml(exam.totalPoints ?? '—')}</strong><span>Total points</span></div><div class="dd26-stat"><strong>${escapeHtml(rosterCount)}</strong><span>Students listed</span></div><div class="dd26-stat"><strong>${versionLabel}</strong><span>Published version</span></div></div>${professorFlowList(exam, classroom)}<div class="dd26-help">Opens ${escapeHtml(formatDate(exam.opensAt))} · Ends ${escapeHtml(formatDate(exam.hardClosesAt))}</div><div class="dd26-actions">${replacementAction}${publishedActions}${removalAction}</div>${published ? '<div class="dd26-help dd26-after-exam-note">Submitted examinations are available for immediate grading while this room remains open. Final result delivery remains a separate action.</div>' : ''}</article>`;
    }).join('');
  }

  function bindExamNavigation() {
    document.querySelectorAll('[data-dd26-exam-section]').forEach((button) => button.addEventListener('click', () => {
      selectExamRole(button.dataset.dd26ExamSection);
    }));
  }

  async function openExamNow(button) {
    const examId = String(button?.dataset?.dd26OpenExamNow || '');
    if (!examId || button.disabled) return;
    if (!global.confirm('Open this examination now? Rostered students with the current code will be able to start immediately. The original schedule remains recorded.')) return;
    button.disabled = true;
    button.textContent = 'Opening...';
    try {
      const result = await command({
        operation: 'open_exam_now',
        examId,
        reason: 'Opened by the Professor for the present class session.',
        requestKey: randomKey('open_exam_now'),
      });
      if (result?.ok === false) throw new Error(result.message || 'The examination could not be opened.');
      global.toast?.('The examination is open. Rostered students may enter now.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Open exam now';
      global.toast?.(error.message, 'warn');
    }
  }

  function openExamWorkspaceRemoval(button) {
    const examId = String(button?.dataset?.dd26DeleteWorkspaceExam || '');
    const role = ['professor', 'beadle', 'student'].includes(button?.dataset?.dd26DeleteWorkspaceRole)
      ? button.dataset.dd26DeleteWorkspaceRole
      : state.exam.section;
    const title = String(button?.dataset?.dd26DeleteWorkspaceTitle || 'this examination');
    const status = String(button?.dataset?.dd26DeleteWorkspaceStatus || 'available');
    if (!examId) return;
    const activeWarning = ['scheduled', 'open', 'in_progress'].includes(status.toLowerCase())
      ? '<div class="dd26-notice"><strong>This examination may still be active for other participants.</strong> Removing it here does not close the examination, stop its clock, revoke access, or change another user’s workspace.</div>'
      : '';
    openDialog(`<div class="dd26-label">Your workspace</div><h2>Delete this examination from your workspace?</h2><p><strong>Are you sure?</strong> “${escapeHtml(title)}” will disappear from your ${escapeHtml(role)} workspace.</p><dl class="dd26-publish-summary"><div><dt>Current status</dt><dd>${escapeHtml(status)}</dd></div></dl>${activeWarning}<div class="dd26-notice"><strong>Official records stay preserved.</strong> This does not delete questions, submissions, autosaved answers, grades, receipts, exports, or audit history.</div><div class="dd26-error" id="dd26-delete-workspace-exam-error" role="alert" tabindex="-1" hidden></div><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-delete-workspace-exam" type="button">Delete from my workspace</button></div>`);
    document.getElementById('dd26-confirm-delete-workspace-exam')?.addEventListener('click', async (confirmButton) => {
      const action = confirmButton.currentTarget;
      const errorHost = document.getElementById('dd26-delete-workspace-exam-error');
      action.disabled = true;
      action.textContent = 'Deleting…';
      if (errorHost) errorHost.hidden = true;
      try {
        await command({
          operation: 'dismiss_past_exam',
          examId,
          requestKey: randomKey('dismiss_past_exam'),
        });
      } catch (error) {
        action.disabled = false;
        action.textContent = 'Delete from my workspace';
        if (errorHost) {
          errorHost.hidden = false;
          errorHost.textContent = error.message;
          errorHost.focus?.();
        }
        return;
      }
      const selectedClass = (state.exam.portal?.classes || [])
        .find((classroom) => classroom.classroomId === state.exam.activeClassroomId);
      if (selectedClass?.exams?.some((exam) => String(exam.examId) === examId)) {
        state.exam.activeClassroomId = null;
      }
      closeDialog();
      try {
        await refreshExamPortal(role);
        global.toast?.(`“${title}” was removed from your ${role} workspace. Official records and other participants were not affected.`, 'ok');
      } catch {
        global.toast?.('The examination was removed from your workspace. Refresh Examination Room to update this list.', 'warn');
      }
    });
  }

  function bindExamSection() {
    const openBookOption = document.querySelector('#dd26-exam-integrity option[value="custom"]');
    if (openBookOption) {
      openBookOption.value = 'open_book';
      openBookOption.textContent = 'Open book';
    }
    document.querySelectorAll('[data-dd26-class]').forEach((button) => button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      state.exam.activeClassroomId = button.dataset.dd26Class;
      state.exam.rosterPreview = null;
      renderExamRoom();
      requestAnimationFrame(() => {
        const workspace = document.querySelector('.dd26-professor-selected-workspace');
        workspace?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        (document.getElementById('dd26-exam-title') || workspace)?.focus?.({ preventScroll: true });
      });
    }));
    document.getElementById('dd26-back-to-professor-exam-list')?.addEventListener('click', () => {
      state.exam.activeClassroomId = null;
      state.exam.rosterPreview = null;
      renderExamRoom();
      document.querySelector('.dd26-professor-exam-list')?.focus?.();
    });
    document.getElementById('dd26-redeem-activation')?.addEventListener('click', redeemActivation);
    document.getElementById('dd26-redeem-beadle')?.addEventListener('click', redeemBeadleInvitation);
    document.getElementById('dd26-request-room')?.addEventListener('click', openRoomRequestForm);
    document.querySelectorAll('[data-dd26-refresh-room-requests]').forEach((button) => button.addEventListener('click', async () => {
      const lifecycle = captureExamPortalLifecycle();
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = 'Refreshing…';
      try {
        await loadRoomRequests(true, lifecycle);
        if (!isCurrentExamPortalLifecycle(lifecycle)) return;
        if (state.exam.roomRequestsLoadState === 'ready') {
          global.toast?.('Request status is up to date.', 'ok');
        }
        renderExamRoom();
      } catch (error) {
        if (!isCurrentExamPortalLifecycle(lifecycle)) return;
        state.exam.roomRequestsLoadState = 'degraded';
        global.toast?.(
          isExamRoomAvailabilityError(error)
            ? 'Examination Room request status is temporarily unavailable.'
            : 'Request status could not refresh. Your existing Examination Rooms remain available.',
          'warn',
        );
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = originalLabel;
        }
      }
    }));
    document.querySelectorAll('[data-dd26-upload-room-proof]').forEach((button) => button.addEventListener('click', () => openRoomPaymentProof(button.dataset.dd26UploadRoomProof)));
    document.querySelectorAll('[data-dd26-copy-quotation]').forEach((button) => button.addEventListener('click', () => copyRoomQuotation(button.dataset.dd26CopyQuotation)));
    document.querySelectorAll('[data-dd26-claim-room-request]').forEach((button) => button.addEventListener('click', () => claimRoomRequest(button.dataset.dd26ClaimRoomRequest, button)));
    document.querySelectorAll('[data-dd26-prepare-quotation]').forEach((button) => button.addEventListener('click', () => openRoomQuotation(button.dataset.dd26PrepareQuotation)));
    document.querySelectorAll('[data-dd26-send-quotation]').forEach((button) => button.addEventListener('click', () => sendRoomQuotation(button.dataset.dd26SendQuotation, button)));
    document.querySelectorAll('[data-dd26-generate-room-key]').forEach((button) => button.addEventListener('click', () => openProvisionalRoomKey(button.dataset.dd26GenerateRoomKey)));
    document.querySelectorAll('[data-dd26-review-room-proof]').forEach((button) => button.addEventListener('click', () => openRoomProofReview(button.dataset.dd26ReviewRoomProof, button.dataset.dd26ProofId)));
    bindRosterControls();
    const createExamButton = document.getElementById('dd26-create-exam');
    if (createExamButton && !document.getElementById('dd26-create-exam-errors')) {
      createExamButton.closest('.dd26-actions')?.insertAdjacentHTML(
        'beforebegin',
        '<div class="dd26-error" id="dd26-create-exam-errors" role="alert" tabindex="-1" hidden></div>',
      );
      ['dd26-exam-title', 'dd26-exam-count']
        .forEach((id) => document.getElementById(id)?.setAttribute('required', ''));
    }
    createExamButton?.addEventListener('click', createExam);
    const startAttemptButton = document.getElementById('dd26-start-attempt');
    if (startAttemptButton && !document.getElementById('dd26-entry-ack')) {
      startAttemptButton.textContent = 'Enter examination';
      startAttemptButton.closest('.dd26-actions')?.insertAdjacentHTML('beforebegin', '<label class="dd26-choice"><input id="dd26-entry-ack" type="checkbox"><span><strong>I reviewed the Professor\'s instructions and am ready to enter</strong><small>A valid class code enters the examination immediately when it is open, or places me in the waiting room until opening time.</small></span></label>');
    }
    startAttemptButton?.addEventListener('click', startAttempt);
    document.querySelectorAll('[data-dd26-resume-attempt]').forEach((button) => button.addEventListener('click', () => loadAttempt(button.dataset.dd26ResumeAttempt)));
    document.querySelectorAll('[data-dd26-submission-status]').forEach((button) => button.addEventListener('click', () => loadSubmissionStatus(button.dataset.dd26SubmissionStatus)));
    document.querySelectorAll('[data-dd26-student-result]').forEach((button) => button.addEventListener('click', () => loadStudentResult(button.dataset.dd26StudentResult)));
    document.querySelectorAll('[data-dd26-delete-workspace-exam]').forEach((button) => button.addEventListener('click', () => openExamWorkspaceRemoval(button)));
    document.querySelectorAll('[data-dd26-use-exam]').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById('dd26-student-exam');
      if (input) { input.value = button.dataset.dd26UseExam; input.focus(); }
    }));
    document.querySelectorAll('[data-dd26-upload-exam]').forEach((button) => button.addEventListener('click', () => openQuestionUpload(button.dataset.dd26UploadExam, Number(button.dataset.dd26QuestionCount))));
    document.querySelectorAll('[data-dd26-schedule-exam]').forEach((button) => button.addEventListener('click', () => openSchedule(button.dataset.dd26ScheduleExam)));
    document.querySelectorAll('[data-dd26-professor-step]').forEach((button) => button.addEventListener('click', () => openProfessorStep(
      button.dataset.dd26ProfessorStep,
      button.dataset.dd26StepExam,
    )));
    document.querySelectorAll('[data-dd26-replace-publication]').forEach((button) => button.addEventListener('click', () => beginReplacementPublication(button.dataset.dd26ReplacePublication)));
    document.querySelectorAll('[data-dd26-invite-beadle]').forEach((button) => button.addEventListener('click', () => openBeadleInvitation(button.dataset.dd26InviteBeadle)));
    document.querySelectorAll('[data-dd26-manage-beadles]').forEach((button) => button.addEventListener('click', () => openBeadleManagement(button.dataset.dd26ManageBeadles)));
    document.querySelectorAll('[data-dd26-accommodation-exam]').forEach((button) => button.addEventListener('click', () => openAccommodation(button.dataset.dd26AccommodationExam)));
    document.querySelectorAll('[data-dd26-erratum-exam]').forEach((button) => button.addEventListener('click', () => openErratum(button.dataset.dd26ErratumExam)));
    document.querySelectorAll('[data-dd26-beadle-exam]').forEach((button) => button.addEventListener('click', () => openBeadleOperations(button.dataset.dd26BeadleExam, { mode: 'beadle' })));
    document.querySelectorAll('[data-dd26-monitor-exam]').forEach((button) => button.addEventListener('click', () => openLiveStatus(button.dataset.dd26MonitorExam)));
    document.querySelectorAll('[data-dd26-grade-exam]').forEach((button) => button.addEventListener('click', () => openGrading(button.dataset.dd26GradeExam)));
    document.querySelectorAll('[data-dd26-results-dashboard]').forEach((button) => button.addEventListener('click', () => openResultsDashboard(button.dataset.dd26ResultsDashboard)));
    document.querySelectorAll('[data-dd26-open-exam-now]').forEach((button) => button.addEventListener('click', () => openExamNow(button)));
    document.querySelectorAll('[data-dd26-refresh-professor]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Refreshing…';
      try { await refreshExamPortal('professor'); }
      catch (error) { button.disabled = false; button.textContent = 'Refresh class status'; global.toast?.(error.message, 'warn'); }
    }));
  }

  function bindRosterControls() {
    document.getElementById('dd26-validate-roster')?.remove();
    document.getElementById('dd26-validate-roster-paste')?.remove();
    document.getElementById('dd26-revalidate-roster')?.remove();
    const confirmRoster = document.getElementById('dd26-import-roster');
    if (confirmRoster) confirmRoster.textContent = 'Confirm and Finish';
    document.getElementById('dd26-roster-file')?.addEventListener('change', async () => {
      announceExamStatus('Checking the selected class list now.');
      await validateRoster();
    });
    document.getElementById('dd26-roster-paste')?.addEventListener('input', () => {
      const pasted = value('dd26-roster-paste', false).trim();
      clearTimeout(state.exam.rosterValidationTimer);
      state.exam.rosterValidationGeneration += 1;
      if (!pasted) {
        if (state.exam.rosterPreview?.sourceKind === 'paste') {
          state.exam.rosterPreview = null;
          rerenderRosterSurface();
        }
        return;
      }
      state.exam.rosterValidationTimer = setTimeout(() => {
        validatePastedRoster();
      }, 350);
    });
    document.getElementById('dd26-add-roster-row')?.addEventListener('click', addRosterPreviewRow);
    document.getElementById('dd26-roster-add-row')?.addEventListener('click', addRosterPreviewRow);
    document.getElementById('dd26-download-roster-template')?.addEventListener('click', downloadRosterTemplate);
    document.querySelectorAll('[data-dd26-remove-roster-row]').forEach((button) => button.addEventListener('click', () => removeRosterPreviewRow(Number(button.dataset.dd26RemoveRosterRow))));
    document.getElementById('dd26-import-roster')?.addEventListener('click', importRoster);
    document.querySelectorAll('[data-dd26-roster-field]').forEach((input) => input.addEventListener('input', markRosterPreviewDirty));
  }

  function markRosterPreviewDirty() {
    if (!state.exam.rosterPreview) return;
    state.exam.rosterPreview.rows = collectRosterPreviewRows();
    state.exam.rosterPreview.sourceHash = '';
    if (state.exam.rosterMode === 'beadle') {
      state.exam.rosterPreview.templateReceiptId = '';
      state.exam.rosterPreview.templateVersion = '';
      state.exam.rosterPreview.templateReceiptExpiresAt = '';
    }
    state.exam.rosterPreview.validation = {
      ok: false,
      errors: [{ message: 'Checking the edited class list…' }],
    };
    const save = document.getElementById('dd26-import-roster');
    if (save) save.disabled = true;
    const status = document.getElementById('dd26-roster-preview-status');
    if (status) {
      status.className = 'dd26-error';
      status.textContent = 'Checking the edited class list…';
    }
    clearTimeout(state.exam.rosterValidationTimer);
    const generation = state.exam.rosterValidationGeneration += 1;
    state.exam.rosterValidationTimer = setTimeout(() => revalidateRosterPreview(generation), 350);
  }

  async function refreshExamPortal(section = state.exam.section) {
    if (!isAuthenticated()) {
      state.exam.portal = null;
      state.exam.intentRole = section;
      state.exam.section = 'entry';
      renderExamRoom();
      requireAuthentication();
      return;
    }
    const lifecycle = captureExamPortalLifecycle();
    if (!lifecycle) return false;
    const [payload] = await Promise.all([
      api('/exam-room/query', { operation: 'portal' }),
      section === 'student' ? Promise.resolve(null) : loadRoomRequestsWithAvailabilityRecovery(true, lifecycle),
    ]);
    if (!isCurrentExamPortalLifecycle(lifecycle)) return false;
    const portal = payload.result;
    await enrichProfessorExamIntents(portal);
    if (!isCurrentExamPortalLifecycle(lifecycle)) return false;
    state.exam.portal = portal;
    state.exam.section = section;
    renderExamRoom();
    return true;
  }

  async function enrichProfessorExamIntents(portal) {
    if (portal?.roles?.professor !== true) return portal;
    const exams = (portal.classes || []).flatMap((classroom) => classroom.exams || []);
    await Promise.all(exams.map(async (exam) => {
      try {
        const payload = await api('/exam-room/query', { operation: 'exam_intent', examId: exam.examId });
        const intent = payload.result || {};
        exam.currentPublicationId = intent.currentPublicationId || null;
        exam.publicationNumber = intent.publicationNumber || null;
        exam.canReplacePublication = intent.canReplacePublication === true;
        exam.canUploadReplacementQuestions = intent.canUploadReplacementQuestions === true;
        exam.canUploadQuestions = typeof intent.canUploadQuestions === 'boolean' ? intent.canUploadQuestions : null;
        exam.replaceBlockedReason = intent.replaceBlockedReason || null;
        exam.totalPoints = intent.totalPoints ?? exam.totalPoints ?? null;
        exam.rosterCount = Number(intent.rosterCount ?? exam.rosterCount ?? 0);
        exam.questionsReady = typeof intent.questionsReady === 'boolean' ? intent.questionsReady : null;
        exam.canPublish = typeof intent.canPublish === 'boolean' ? intent.canPublish : null;
        exam.publishBlockers = Array.isArray(intent.publishBlockers) ? intent.publishBlockers : [];
        exam.beadleInvitationIssued = typeof intent.beadleInvitationIssued === 'boolean' ? intent.beadleInvitationIssued : null;
        exam.beadleAssigned = typeof intent.beadleAssigned === 'boolean' ? intent.beadleAssigned : null;
        exam.studentAccessReady = typeof intent.studentAccessReady === 'boolean' ? intent.studentAccessReady : null;
        exam.gradingReady = typeof intent.gradingReady === 'boolean' ? intent.gradingReady : null;
        exam.gradingReadyAt = intent.readyAt || intent.gradingReadyAt || null;
        exam.nonTerminalAttemptCount = Number(intent.nonTerminalAttemptCount || 0);
        exam.canEditRoster = typeof intent.canEditRoster === 'boolean' ? intent.canEditRoster : null;
        exam.rosterLockedReason = intent.rosterLockedReason || null;
        exam.publicationStateKnown = true;
      } catch {
        exam.publicationStateKnown = false;
      }
    }));
    return portal;
  }

  function professorExam(examId) {
    return (state.exam.portal?.classes || [])
      .flatMap((classroom) => classroom.exams || [])
      .find((exam) => exam.examId === examId) || null;
  }

  async function loadProfessorAuthoringSnapshot(examId) {
    const payload = await api('/exam-room/query', {
      operation: 'professor_authoring_snapshot', examId,
    });
    const snapshot = payload.result;
    if (!snapshot || snapshot.ok !== true || snapshot.examId !== examId
        || !Number.isSafeInteger(Number(snapshot.workspaceRevision))) {
      throw new Error('The latest Professor workspace could not be confirmed. Refresh the Examination Room and try again.');
    }
    state.exam.authoringSnapshots.set(examId, snapshot);
    return snapshot;
  }

  function authoringCapability(snapshot, capability) {
    return snapshot?.capabilities?.[capability] === true;
  }

  function authoringBlockedCopy(snapshot, step) {
    const blockers = snapshot?.blockers;
    const reason = String(
      (blockers && !Array.isArray(blockers) ? blockers[step] : '')
      || (Array.isArray(blockers) ? blockers[0] : '')
      || '',
    ).trim();
    if (!reason) return 'This step is available for review, but the server has not authorized changes.';
    const messages = {
      ALREADY_PUBLISHED: 'This copy is already published. Review it here; use the corrected-version process before opening, or a correction notice after the exam begins.',
      CANDIDATE_ATTEMPTS_EXIST: 'A student attempt already exists, so the saved examination record cannot be changed.',
      EXAM_ALREADY_OPEN: 'The examination has opened. Use a correction notice for any change students must receive.',
      QUESTIONS_NOT_READY: 'Complete the question review before setting the exam rules.',
      EXAM_STATE_BLOCKED: 'The examination is not in an editable preparation stage.',
    };
    return messages[reason] || reason.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  }

  async function openProfessorStep(step, examId) {
    state.exam.activeExamId = examId;
    try {
      const snapshot = await loadProfessorAuthoringSnapshot(examId);
      if (step === 'roster' || step === 'handout') {
        const capability = step === 'roster' ? 'canReviewRoster' : 'canReviewHandout';
        if (!authoringCapability(snapshot, capability)) {
          openAuthoringBlockedDialog(step === 'roster' ? 'Class list review' : 'Student handout review', authoringBlockedCopy(snapshot, step));
          return;
        }
        await openBeadleOperations(examId, { mode: 'professor', focus: step });
      } else if (step === 'details') {
        openProfessorDetails(snapshot);
      } else if (step === 'questions') {
        openProfessorQuestionReview(snapshot);
      } else if (step === 'rules') {
        if (snapshot.published === true || snapshot.publication) {
          openPublishedPreparationReview(snapshot);
        } else if (authoringCapability(snapshot, 'canEditRules')) {
          openSchedule(examId, null, snapshot);
        } else {
          openAuthoringBlockedDialog('Rules and publication', authoringBlockedCopy(snapshot, 'rules'));
        }
      }
    } catch (error) {
      global.toast?.(error.message, 'warn');
      openAuthoringBlockedDialog('Professor workspace unavailable', error.message);
    }
  }

  function openAuthoringBlockedDialog(title, message) {
    openDialog(`<div class="dd26-label">Professor review</div><h2>${escapeHtml(title)}</h2><div class="dd26-error" role="alert">${escapeHtml(message || 'The server did not authorize this step.')}</div><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return</button></div>`);
  }

  async function command(body) {
    const payload = await api('/exam-room/command', body);
    if (payload.result?.ok === false) {
      const error = new Error(examCodeMessage(payload.result.code));
      Object.assign(error, payload.result);
      error.code = payload.result.code;
      throw error;
    }
    return payload.result;
  }

  function examCodeMessage(code) {
    const messages = {
      ROSTER_REQUIRED: 'This signed-in account is not on the class list for this examination.',
      ROSTER_ACCOUNT_MISMATCH: 'This student entry is already linked to another account.',
      EXAM_NOT_OPEN: 'This examination has not opened yet.',
      EXAM_CLOSED: 'This examination is closed.',
      LATE_ADMISSION_CLOSED: 'Student entry is closed for this examination.',
      DEADLINE_REACHED: 'Your examination deadline has been reached. Open the Student workspace to review the recorded status.',
      ATTEMPT_ALREADY_SUBMITTED: 'This examination was already submitted. Open the saved receipt instead.',
      EXAM_NOT_PUBLISHED: 'The Professor has not published this examination yet.',
      EXAM_ROOM_INSUFFICIENT_DAILY_ALLOWANCE: 'This examination contains more questions than remain in your Free allowance today. Open The Docket for your reset time or Early Access.',
      ADMISSION_REQUIRED: 'The examination requires a separate admission decision before entry.',
      ADMISSION_BLOCKED: 'Entry for this student account was blocked by the examination admission record.',
      IDENTITY_VERIFICATION_BLOCKED: 'The saved identity check must be resolved before entry.',
      STUDENT_NOT_ELIGIBLE: 'This signed-in account is not currently eligible for this examination.',
      EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED: 'This Beadle assignment is no longer active. Return to assigned examinations for the latest room status.',
      STUDENT_ACCESS_NOT_READY: 'The Beadle must finish the class list and create the student exam code first.',
      STUDENT_ACCESS_ISSUED: 'The class-wide student exam code is already active.',
      EXAM_ROOM_STUDENT_ACCESS_NOT_ISSUABLE: 'The student handout cannot be created yet. Check the class list and opening time.',
      EXAM_ROOM_ROSTER_LOCKED: 'The class list is locked because the student handout is already active or the examination has begun.',
      EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED: 'Use the official Beadle class-list template. Keep its three column names unchanged and upload the completed .xlsx file.',
      EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_INVALID: 'This template check is not valid for this examination. Upload the completed official template again.',
      EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_EXPIRED: 'This template check expired. Upload the completed official template again, then save the class list.',
      EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_USED: 'This checked template was already saved. Refresh the class list before continuing.',
      EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_MISMATCH: 'The class list changed after the template was checked. Update the official template and upload it again.',
      EXAM_ROOM_BEADLE_REQUIRED: 'Publish the examination to the named Beadle before continuing.',
      EXAM_ROOM_BEADLE_INVITATION_INVALID: 'The Beadle handoff was not created. Review the Beadle email and publish again safely.',
      CREDENTIAL_INVALID: 'The examination key is invalid.',
      CREDENTIAL_LOCKED: 'Too many failed key attempts. Access is locked for 15 minutes.',
      ACTIVATION_INVALID: 'This Professor invitation key is not valid for the signed-in email.',
      ACTIVATION_EXPIRED: 'This Professor invitation key has expired. Ask the Admin for a new one.',
      ACTIVATION_REVOKED: 'This Professor invitation key was cancelled. Ask the Admin for a new one.',
      ACTIVATION_ALREADY_REDEEMED: 'This Professor invitation key has already been used.',
      ACTIVATION_ROOM_SCOPE_REQUIRED: 'This older Professor key does not create an Examination Room. Ask the Admin for a new one-room key.',
      ACTIVATION_UNAVAILABLE: 'This Professor invitation cannot be opened. Ask the Admin to check its key record.',
      EXAM_ROOM_ONE_EXAM_LIMIT: 'This Examination Room already has its examination.',
      ATTEMPT_LOCKED: 'This attempt is locked. Your saved answers remain preserved.',
      SESSION_ACTIVE_ELSEWHERE: 'Another device has the active examination session. Ask the Beadle to approve a controlled transfer.',
      ANSWER_SET_MISMATCH: 'The saved answer record changed while submission was pending. Due Diligence will check the latest synchronized answers before retrying.',
      GRADING_NOT_OPEN: 'Grading opens only after the examination has ended for every student.',
      EXAM_ROOM_RESCHEDULE_TIME_REQUIRED: 'Choose a new opening and ending time before saving.',
      EXAM_ROOM_RESCHEDULE_INVALID: 'The updated schedule is not allowed. Check each time and minute setting, then review it again.',
      EXAM_ROOM_RESCHEDULE_ATTEMPTS_EXIST: 'A student has already started, so the published exam time can no longer be changed.',
      EXAM_ROOM_RESCHEDULE_NOT_ALLOWED: 'This examination is no longer in a stage where its schedule can be changed.',
      EXAM_ROOM_RESCHEDULE_PUBLICATION_INVALID: 'The published examination record changed or is incomplete. Refresh the Examination Room before making another change.',
      EXAM_ROOM_RESCHEDULE_BEADLE_HORIZON: 'The selected ending is beyond the current Beadle assignment period. Choose an earlier ending, or assign a new Beadle first.',
      EXAM_ROOM_WORKSPACE_CONFLICT: 'The Professor workspace changed while this form was open. Refresh the Examination Room before trying again.',
      EXAM_ROOM_PUBLICATION_VERSION_CONFLICT: 'The published copy changed while this form was open. Refresh the Examination Room before trying again.',
    };
    return messages[code] || String(code || 'The examination request was denied.').replace(/_/g, ' ').toLowerCase();
  }

  function rosterTemplateErrorMessage(error) {
    const code = String(error?.code || error?.details?.code || '').trim();
    if (code === 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED'
      || code.startsWith('EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_')) {
      return examCodeMessage(code);
    }
    return error?.message || 'The official class-list template could not be checked.';
  }

  async function redeemActivation() {
    try {
      const result = await command({ operation: 'redeem_activation', activationKey: value('dd26-activation-key', false) });
      global.toast?.(result?.roomTitle ? `${result.roomTitle} is ready.` : 'Examination Room opened.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function filePayload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return { fileName: file.name, mimeType: file.type || mimeForName(file.name), base64: btoa(binary) };
  }

  function mimeForName(name) {
    const lower = String(name).toLowerCase();
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'text/plain';
  }

  async function validateRoster() {
    const file = document.getElementById('dd26-roster-file')?.files?.[0];
    const beadleMode = state.exam.rosterMode === 'beadle';
    if (!file) {
      global.toast?.(beadleMode
        ? 'Choose an XLSX or CSV class list first.'
        : 'Choose a CSV or XLSX roster first.', 'warn');
      return;
    }
    const generation = state.exam.rosterValidationGeneration += 1;
    const button = document.getElementById('dd26-validate-roster');
    if (button) { button.disabled = true; button.textContent = 'Checking template...'; }
    try {
      const lowerName = String(file.name || '').toLowerCase();
      if (beadleMode && lowerName.endsWith('.csv')) {
        const text = await file.text();
        const rows = parseDelimitedRoster(text);
        const sourceHash = await sha256Text(text);
        if (generation !== state.exam.rosterValidationGeneration) return;
        await prepareClassroomRosterPreview(rows, 'csv', sourceHash, generation);
        document.getElementById('dd26-roster-file')?.removeAttribute('aria-invalid');
        return;
      }
      const scope = beadleMode
        ? { examId: state.exam.activeExamId }
        : { classroomId: state.exam.activeClassroomId };
      const payload = await api('/exam-room/upload/roster', { ...scope, ...await filePayload(file) });
      if (generation !== state.exam.rosterValidationGeneration) return;
      if (beadleMode && payload?.validation?.ok === true
        && (!payload.templateReceiptId || payload.templateVersion !== BEADLE_ROSTER_TEMPLATE_VERSION)) {
        const error = new Error('The official template check did not finish. Upload the file again.');
        error.code = 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_INVALID';
        throw error;
      }
      document.getElementById('dd26-roster-file')?.removeAttribute('aria-invalid');
      state.exam.rosterPreview = { ...payload, sourceKind: beadleMode ? 'xlsx' : 'upload' };
      rerenderRosterSurface();
    } catch (error) {
      global.toast?.(beadleMode ? rosterTemplateErrorMessage(error) : error.message, 'warn');
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Check template'; }
    }
  }

  async function redeemBeadleInvitation() {
    try {
      await command({ operation: 'redeem_beadle_invitation', invitationKey: value('dd26-beadle-key', false), requestKey: randomKey('beadle_redeem') });
      global.toast?.('Beadle assignment opened for this account.', 'ok');
      await refreshExamPortal('beadle');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openBeadleInvitation(examId) {
    state.exam.activeExamId = examId;
    const defaultExpiry = localDateValue(new Date(Date.now() + 7 * 86400000));
    openDialog(`<div class="dd26-label">Beadle access for this exam</div><h2>Invite a Beadle</h2><p>This invitation works only for the named Beadle account and this examination. It can be used once, expires, and may be cancelled. The Beadle can upload the class list and help during the exam.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Beadle account email</span><input class="dd26-input" id="dd26-beadle-email" type="email" autocomplete="email"></label><label class="dd26-field"><span>Invitation expires</span><input class="dd26-input" id="dd26-beadle-expiry" type="datetime-local" value="${defaultExpiry}"></label></div><label class="dd26-field"><span>Reason</span><input class="dd26-input" id="dd26-beadle-reason" value="Prepare the class list and assist on exam day"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-issue-beadle" type="button">Create invitation</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div><div class="dd26-privacy">The Beadle cannot edit questions or rules, see student answers or grades, grade the exam, or release results.</div>`);
    document.getElementById('dd26-issue-beadle')?.addEventListener('click', issueBeadleInvitation);
  }

  async function issueBeadleInvitation() {
    const secret = randomKey('beadle_invitation');
    try {
      const result = await command({
        operation: 'invite_beadle', examId: state.exam.activeExamId,
        targetEmail: value('dd26-beadle-email'), invitationKey: secret,
        expiresAt: new Date(value('dd26-beadle-expiry')).toISOString(),
        reason: value('dd26-beadle-reason'), requestKey: randomKey('beadle_invite'),
      });
      showOneTimeSecret('Beadle invitation key', secret, `Share this key securely with the named Beadle. It expires ${formatDate(result?.expiresAt)} and can be redeemed once by that account.`);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function openBeadleManagement(examId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'exam_intent', examId });
      const snapshot = payload.result || {};
      const beadles = Array.isArray(snapshot.beadles) ? snapshot.beadles : [];
      const invitations = Array.isArray(snapshot.pendingBeadleInvitations) ? snapshot.pendingBeadleInvitations : [];
      openDialog(`<div class="dd26-label">Exam-scoped delegation</div><h2>Manage Beadles</h2><p>Assignments remain narrow, expiring, revocable, and answer-blind.</p>${beadles.length ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Beadle account</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${beadles.map((entry) => `<tr><td><code>${escapeHtml(entry.beadleUserId)}</code></td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(formatDate(entry.expiresAt))}</td><td>${entry.status === 'active' ? `<button class="dd26-button danger" data-dd26-revoke-beadle="${escapeHtml(entry.beadleUserId)}" type="button">Revoke</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dd26-empty">No redeemed Beadle assignment.</div>'}${invitations.length ? `<details class="dd26-section"><summary>Pending invitations (${invitations.length})</summary><ul>${invitations.map((entry) => `<li>${escapeHtml(entry.targetEmail)} — expires ${escapeHtml(formatDate(entry.expiresAt))}</li>`).join('')}</ul></details>` : ''}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-invite-replacement" type="button">Invite another or replacement Beadle</button><button class="dd26-button" data-dd26-close-dialog type="button">Close</button></div>`);
      document.getElementById('dd26-invite-replacement')?.addEventListener('click', () => openBeadleInvitation(examId));
      document.querySelectorAll('[data-dd26-revoke-beadle]').forEach((button) => button.addEventListener('click', () => revokeBeadle(examId, button.dataset.dd26RevokeBeadle)));
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function revokeBeadle(examId, beadleUserId) {
    const reason = String(global.prompt('Required revocation reason:', 'Delegation replaced or no longer required') || '').trim();
    if (reason.length < 5) return;
    try {
      await command({ operation: 'revoke_beadle', examId, beadleUserId, reason, requestKey: randomKey('beadle_revoke') });
      global.toast?.('Beadle assignment revoked.', 'ok');
      await openBeadleManagement(examId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openAccommodation(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Accommodation for one student</div><h2>Set an examination accommodation</h2><p>Enter only what the student needs for this examination—not a diagnosis. Due Diligence records every change.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Student exam number</span><input class="dd26-input" id="dd26-accommodation-candidate" maxlength="120"></label><label class="dd26-field"><span>Additional minutes</span><input class="dd26-input" id="dd26-accommodation-extra" type="number" min="0" max="480" value="0"></label><label class="dd26-field"><span>This student may start at (optional)</span><input class="dd26-input" id="dd26-accommodation-opens" type="datetime-local"></label><label class="dd26-field"><span>This student’s exam ends at (optional)</span><input class="dd26-input" id="dd26-accommodation-closes" type="datetime-local"></label><label class="dd26-field"><span>Approved break minutes</span><input class="dd26-input" id="dd26-accommodation-break" type="number" min="0" max="240" value="0"></label><label class="dd26-field"><span>Extra minutes after an approved technical problem</span><input class="dd26-input" id="dd26-accommodation-incident" type="number" min="0" max="480" value="0"></label><label class="dd26-field wide"><span>Approved writing aids</span><input class="dd26-input" id="dd26-accommodation-aids" maxlength="1000"></label><label class="dd26-field wide"><span>Note for the Beadle and Professor</span><textarea class="dd26-textarea compact" id="dd26-accommodation-note" maxlength="1000"></textarea></label><label class="dd26-field wide"><span>Reason for this change</span><input class="dd26-input" id="dd26-accommodation-reason" maxlength="1000" value="Approved examination accommodation"></label></div><div class="dd26-choice-grid"><label class="dd26-choice"><input id="dd26-accommodation-fullscreen" type="checkbox"><span>Do not require full screen</span></label><label class="dd26-choice"><input id="dd26-accommodation-integrity" type="checkbox"><span>Do not record tab or window changes</span></label><label class="dd26-choice"><input id="dd26-accommodation-at" type="checkbox"><span>Allow assistive technology and clipboard use</span></label><label class="dd26-choice"><input id="dd26-accommodation-camera" type="checkbox"><span>Camera exception (camera is off in beta)</span></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-save-accommodation" type="button">Save accommodation</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-save-accommodation')?.addEventListener('click', saveAccommodation);
  }

  async function saveAccommodation() {
    const opens = value('dd26-accommodation-opens');
    const closes = value('dd26-accommodation-closes');
    try {
      await command({
        operation: 'set_accommodation',
        examId: state.exam.activeExamId,
        candidateNumber: value('dd26-accommodation-candidate'),
        accommodation: {
          extraMinutes: Number(value('dd26-accommodation-extra')) || 0,
          individualOpensAt: opens ? new Date(opens).toISOString() : null,
          individualHardClosesAt: closes ? new Date(closes).toISOString() : null,
          breakMinutes: Number(value('dd26-accommodation-break')) || 0,
          cameraExempt: Boolean(document.getElementById('dd26-accommodation-camera')?.checked),
          fullscreenExempt: Boolean(document.getElementById('dd26-accommodation-fullscreen')?.checked),
          integrityExempt: Boolean(document.getElementById('dd26-accommodation-integrity')?.checked),
          assistiveTechnology: Boolean(document.getElementById('dd26-accommodation-at')?.checked),
          permittedAids: value('dd26-accommodation-aids', false),
          incidentExtensionMinutes: Number(value('dd26-accommodation-incident')) || 0,
          operationalNote: value('dd26-accommodation-note', false),
        },
        reason: value('dd26-accommodation-reason'),
        requestKey: randomKey('accommodation'),
      });
      closeDialog();
      global.toast?.('Accommodation saved; the server recalculated any applicable deadline.', 'ok');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openErratum(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Correction during an examination</div><h2>Send a correction notice</h2><p>After a student starts, do not quietly change the questions or instructions. Send a clear notice that becomes part of the examination record.</p><div class="dd26-form-grid"><label class="dd26-field"><span>Notice type</span><select class="dd26-select" id="dd26-erratum-type"><option value="clarification">Clarification</option><option value="correction">Correction</option><option value="stop_notice">Stop notice</option><option value="replacement_notice">Replacement notice</option></select></label><label class="dd26-field"><span>Effective at</span><input class="dd26-input" id="dd26-erratum-effective" type="datetime-local" value="${localDateValue(new Date())}"></label><label class="dd26-field wide"><span>Affected question IDs (comma-separated; leave blank for the whole exam)</span><input class="dd26-input" id="dd26-erratum-questions" autocomplete="off"></label><label class="dd26-field wide"><span>Notice shown to students</span><textarea class="dd26-textarea" id="dd26-erratum-body" maxlength="5000"></textarea></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-issue-erratum" type="button">Send correction notice</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-issue-erratum')?.addEventListener('click', issueErratum);
  }

  async function issueErratum() {
    const affectedQuestionIds = value('dd26-erratum-questions', false).split(',').map((entry) => entry.trim()).filter(Boolean);
    try {
      await command({
        operation: 'issue_erratum', examId: state.exam.activeExamId,
        erratumType: value('dd26-erratum-type'), body: value('dd26-erratum-body', false),
        affectedQuestionIds, effectiveAt: new Date(value('dd26-erratum-effective')).toISOString(),
        requestKey: randomKey('erratum'),
      });
      closeDialog();
      global.toast?.('Audited erratum issued to affected candidates.', 'ok');
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function openBeadleOperations(examId, options = {}) {
    try {
      await refreshBeadleOperations(examId, options);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function refreshBeadleOperations(examId, options = {}) {
    const payload = await api('/exam-room/query', { operation: 'beadle_portal', examId });
    state.exam.activeExamId = examId;
    state.exam.rosterMode = options.mode === 'professor' ? 'professor' : options.mode === 'beadle'
      ? 'beadle' : state.exam.rosterMode;
    state.exam.operationFocus = options.focus || state.exam.operationFocus || 'roster';
    renderBeadleOperations(payload.result || { examId, candidates: [], attention: [] });
    return payload.result;
  }

  function renderBeadleOperations(snapshot) {
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    state.exam.activeBeadleSnapshot = snapshot;
    const professorView = state.exam.rosterMode === 'professor';
    const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
    const attention = Array.isArray(snapshot.attention) ? snapshot.attention : [];
    const counts = snapshot.counts || {};
    const accountLinked = candidates.filter((candidate) => candidate.accountLinked).length;
    const rosterCount = Number(counts.roster || snapshot.rosterCount || candidates.length || 0);
    const studentAccessReady = snapshot.studentAccessReady === true;
    const activeStudentCode = String(
      snapshot.activeStudentExamCode
        || snapshot.studentAccessCode
        || state.exam.studentExamCodes.get(snapshot.examId)
        || '',
    ).trim();
    if (activeStudentCode) state.exam.studentExamCodes.set(snapshot.examId, activeStudentCode);
    const canEditRoster = !professorView && snapshot.canEditRoster === true
      && snapshot.rosterLocked !== true;
    const canIssueStudentAccess = !professorView && snapshot.canIssueStudentAccess === true;
    const canReopenRoster = !professorView && snapshot.canReopenRoster === true;
    const candidateAccessCopy = snapshot.accessCodeRequired === true
      ? 'Each listed student receives the class examination code by individual email. Every student must still sign in with the exact rostered account.'
      : snapshot.accessCodeRequired === false
        ? 'No separate student access code is required. Every student must still sign in and be on the class list.'
        : 'The exam access-code rule is not available. Refresh this page or ask the Professor before giving instructions to students.';
    const rosterReadyToSave = state.exam.rosterPreview?.validation?.ok === true;
    const rosterEditor = canEditRoster ? `<details class="dd26-section" id="dd26-class-list-panel" open>
        <summary>Step 4 · Prepare and save the class list</summary>
        <div class="dd26-roster-intro"><h3>Add the class list your way</h3><p>Upload an XLSX or CSV file, paste rows, or add students manually. Due Diligence checks the same three fields before anything is confirmed.</p></div>
        <ol class="dd26-roster-template-flow" aria-label="Class-list steps">
          <li><span class="dd26-roster-step-number" aria-hidden="true">1</span><div class="dd26-roster-step-copy"><h4>Choose a file or start from the template</h4><p>An existing XLSX or CSV is accepted when it contains Email Address, Student Number, and Student Name. The optional template is available for a clean start.</p><a class="dd26-button dd26-roster-download" id="dd26-beadle-download-roster-template" href="${BEADLE_ROSTER_TEMPLATE_URL}" download="examination-room-beadle-class-list-template.xlsx">Download optional template</a></div></li>
          <li><span class="dd26-roster-step-number" aria-hidden="true">2</span><div class="dd26-roster-step-copy"><h4>Review the three student fields</h4><ul class="dd26-roster-field-list"><li><strong>Email Address</strong><span>The exact account the student uses to sign in.</span></li><li><strong>Student Number</strong><span>The school-issued student number, when available.</span></li><li><strong>Student Name</strong><span>The name the Professor will see while grading.</span></li></ul><p class="dd26-help">Use one row per student. You can correct any detected issue in the preview.</p></div></li>
          <li><span class="dd26-roster-step-number" aria-hidden="true">3</span><div class="dd26-roster-step-copy"><h4>Automatic check, then confirm once</h4><p>Due Diligence checks every row immediately, then activates the class code and queues an individual email to each listed student after confirmation.</p><label class="dd26-field dd26-roster-file-field"><span>Class list file</span><input class="dd26-input" id="dd26-roster-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"><small class="dd26-help">XLSX and CSV are supported on desktop and tablet.</small></label><div class="dd26-actions dd26-roster-actions"><button class="dd26-button primary" id="dd26-import-roster" type="button" ${rosterReadyToSave ? '' : 'disabled'}>Confirm and Finish</button></div></div></li>
        </ol>
        <label class="dd26-field"><span>Or paste a class list</span><textarea class="dd26-textarea compact" id="dd26-roster-paste" placeholder="Email Address,Student Number,Student Name"></textarea><small class="dd26-help">Pasted rows are checked automatically as you edit.</small></label><div class="dd26-actions"><button class="dd26-button" id="dd26-roster-add-row" type="button">Add one student manually</button></div>
        ${rosterPreviewHtml()}
      </details>` : `<section class="dd26-section" id="dd26-class-list-panel" tabindex="-1"><div class="dd26-label">Step 4 · Class list</div><h3>${professorView ? 'Review the class list' : 'Class list saved'}</h3><div class="dd26-notice"><strong>${professorView ? 'Professor review only.' : 'The class list is locked.'}</strong> ${escapeHtml(professorView ? 'The Beadle prepares and corrects this list. You can review its current status here without changing the handoff.' : snapshot.rosterLockedReason || 'Student access was issued, the exam opened, or a student already started.')}</div>${canReopenRoster ? '<div class="dd26-actions"><button class="dd26-button danger" id="dd26-reopen-roster" type="button">Correct class list</button></div>' : ''}</section>`;
    const codeValue = activeStudentCode
      ? `<div class="dd26-raw-key" id="dd26-active-student-code" data-dd26-sensitive>${escapeHtml(activeStudentCode)}</div>`
      : `<div class="dd26-code-unavailable">${studentAccessReady ? 'The active code is not available on this page. Create a new code to display and copy it.' : 'Save the class list, then create the student exam code.'}</div>`;
    const codeAction = activeStudentCode
      ? '<button class="dd26-button dd26-student-code-action" id="dd26-copy-active-class-handout" type="button">Copy class code</button>'
      : canIssueStudentAccess
        ? `<button class="dd26-button ${studentAccessReady ? 'danger' : 'primary'} dd26-student-code-action" id="dd26-issue-student-access" type="button">${studentAccessReady ? 'Create a new student exam code' : 'Create student exam code'}</button>`
        : `<button class="dd26-button dd26-student-code-action" type="button" disabled>${rosterCount < 1 ? 'Save the class list first' : 'Student exam code unavailable'}</button>`;
    const visibleCodeAction = professorView && !activeStudentCode ? '' : codeAction;
    const studentHandout = `<section class="dd26-section dd26-student-code-panel${activeStudentCode ? ' is-ready' : rosterCount > 0 ? ' is-actionable' : ''}" id="dd26-student-code-panel" tabindex="-1"><div class="dd26-label">Step 5 · Finished</div><h3>${professorView ? 'Review student access' : 'Student access is prepared'}</h3><p>${activeStudentCode ? (professorView ? 'The active class examination code is ready and individual student emails were queued when the class list was confirmed.' : 'Your class-list work is complete. Due Diligence queued one private access email for every listed student.') : studentAccessReady ? 'A class examination code is active and individual student emails were queued. The raw code is intentionally not redisplayed after this secure session.' : 'Confirm the class list once. Due Diligence will activate the class code and email each listed student individually.'}</p><div class="dd26-handout-fields"><div class="dd26-field"><span>Active class examination code</span>${codeValue}</div></div><div class="dd26-actions">${visibleCodeAction}</div><p class="dd26-help">${escapeHtml(candidateAccessCopy)} For delivery help, contact support@duediligence.ph.</p></section>`;
    const operatorHeading = professorView ? 'Professor · Steps 4 and 5 review' : 'Beadle · Steps 4 and 5';
    host.innerHTML = `<section class="dd26-card"><div class="dd26-question-meta"><div><div class="dd26-label">${operatorHeading}</div><h2>${escapeHtml(snapshot.title || 'Exam-day class')}</h2></div><span class="dd26-status">${escapeHtml(studentAccessReady ? 'Student access ready' : snapshot.status || 'assigned')}</span></div><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${escapeHtml(rosterCount)}</strong><span>Students listed</span></div><div class="dd26-stat"><strong>${escapeHtml(accountLinked)}</strong><span>Accounts matched</span></div><div class="dd26-stat"><strong>${escapeHtml(counts.submitted || 0)}</strong><span>Submitted</span></div><div class="dd26-stat"><strong>${escapeHtml(counts.needsAttention ?? attention.length)}</strong><span>Needs attention</span></div></div>
      ${rosterEditor}
      ${studentHandout}
      ${attention.length ? `<div class="dd26-attention-list">${attention.map((item) => `<article><div><strong>${escapeHtml(item.candidateNumber || 'Student')}</strong><small>${escapeHtml(item.label || item.type || Object.keys(item.reasons || {}).join(', ') || 'Review required')}</small></div><span class="dd26-status">${escapeHtml(item.severity || item.reasons?.incidentSeverity || 'review')}</span></article>`).join('')}</div>` : '<div class="dd26-success">No student needs attention right now.</div>'}
      <div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Student</th><th>Signed-in account</th><th>Exam status</th><th>Access</th></tr></thead><tbody>${candidates.map((candidate) => `<tr><td><strong>${escapeHtml(candidate.displayName || candidate.studentName || candidate.candidateNumber || 'Student')}</strong>${candidate.canonicalEmail || candidate.studentEmail || candidate.email ? `<small>${escapeHtml(candidate.canonicalEmail || candidate.studentEmail || candidate.email)}</small>` : ''}</td><td>${escapeHtml(candidate.accountLinked ? 'Matched' : 'Awaiting first sign-in')}</td><td>${escapeHtml(candidate.state || candidate.attemptStatus || 'On class list')}</td><td>${escapeHtml(candidate.admitted === false ? 'Review required' : 'Eligible')}</td></tr>`).join('') || '<tr><td colspan="4">No students are on the class list yet.</td></tr>'}</tbody></table></div><div class="dd26-actions"><button class="dd26-button" id="dd26-refresh-beadle" type="button">Refresh</button><button class="dd26-button${professorView ? '' : ' primary'}" id="dd26-back-beadle" type="button">${professorView ? 'Back to Professor workspace' : 'Finish Beadle duties and enter my exam'}</button></div><div class="dd26-privacy">${professorView ? 'This review does not change the Beadle handoff or any student access.' : 'No per-student approval or manual email is required. If you are on this class list, Due Diligence takes you directly to your examination or waiting room. You never need to retain or re-enter the class code. This page never shows questions, answers, grades, or the Professor’s suggested answer.'}</div></section>`;
    bindRosterControls();
    document.getElementById('dd26-upsert-beadle-row')?.addEventListener('click', upsertBeadleRosterRow);
    document.getElementById('dd26-copy-active-class-handout')?.addEventListener('click', () => copyActiveClassHandout(snapshot, activeStudentCode));
    document.getElementById('dd26-reopen-roster')?.addEventListener('click', () => openRosterCorrection(snapshot));
    const studentAccessAttempt = {};
    document.getElementById('dd26-issue-student-access')?.addEventListener('click', () => issueStudentAccess(studentAccessAttempt));
    document.getElementById('dd26-refresh-beadle')?.addEventListener('click', () => openBeadleOperations(snapshot.examId, {
      mode: professorView ? 'professor' : 'beadle', focus: state.exam.operationFocus,
    }));
    document.getElementById('dd26-back-beadle')?.addEventListener('click', () => (
      professorView
        ? refreshExamPortal('professor')
        : enterRosteredBeadleExam(snapshot)
    ));
    const focusTarget = document.getElementById(state.exam.operationFocus === 'handout'
      ? 'dd26-student-code-panel' : 'dd26-class-list-panel');
    focusTarget?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    focusTarget?.focus?.({ preventScroll: true });
  }

  function clearBeadleStudentHandoff(examId = null) {
    try {
      if (examId) {
        const saved = JSON.parse(global.localStorage?.getItem(BEADLE_STUDENT_HANDOFF_KEY) || 'null');
        if (String(saved?.examId || '') !== String(examId)) return;
      }
      global.localStorage?.removeItem(BEADLE_STUDENT_HANDOFF_KEY);
    } catch {
      global.localStorage?.removeItem?.(BEADLE_STUDENT_HANDOFF_KEY);
    }
  }

  function saveBeadleStudentHandoff(examId) {
    const userId = authenticatedUserId();
    if (!userId || !examId) return false;
    try {
      global.localStorage?.setItem(BEADLE_STUDENT_HANDOFF_KEY, JSON.stringify({
        version: 1,
        userId,
        examId: String(examId),
        createdAt: Date.now(),
      }));
      return true;
    } catch {
      return false;
    }
  }

  function readBeadleStudentHandoff() {
    try {
      const saved = JSON.parse(global.localStorage?.getItem(BEADLE_STUDENT_HANDOFF_KEY) || 'null');
      const age = Date.now() - Number(saved?.createdAt || 0);
      if (saved?.version !== 1
          || !saved?.examId
          || saved.userId !== authenticatedUserId()
          || !Number.isFinite(age)
          || age < 0
          || age > BEADLE_STUDENT_HANDOFF_MAX_AGE_MS) {
        clearBeadleStudentHandoff();
        return null;
      }
      return saved;
    } catch {
      clearBeadleStudentHandoff();
      return null;
    }
  }

  function stopStudentWaitingRoom(check = state.exam.preflight) {
    clearInterval(state.exam.waitingRoomTimer);
    clearTimeout(state.exam.waitingRoomPollTimer);
    state.exam.waitingRoomTimer = null;
    state.exam.waitingRoomPollTimer = null;
    state.exam.waitingRoomPolling = false;
    if (check) {
      check.requestBusy = false;
      check.autoEntryBusy = false;
    }
  }

  function directBeadleServerCode(server = {}) {
    return String(server.startBlockerCode || server.code || '').trim().toUpperCase();
  }

  function directBeadleAttempt(server = {}) {
    return server.attempt && typeof server.attempt === 'object' ? server.attempt : {};
  }

  function directBeadleTerminalState(server = {}) {
    const code = directBeadleServerCode(server);
    const attempt = directBeadleAttempt(server);
    const attemptStatus = String(attempt.status || server.attemptStatus || '').toLowerCase();
    const sessionConflict = server.sessionConflict === true || server.checks?.sessionConflict === true;
    if (sessionConflict) {
      return {
        code: 'SESSION_ACTIVE_ELSEWHERE', kind: 'session',
        title: 'Your examination is already open on another session',
        message: 'Due Diligence stopped automatic entry to protect the answers already in progress. Open the Student workspace to resume or follow the controlled session-recovery steps.',
        attemptId: attempt.attemptId || server.attemptId || null,
      };
    }
    if (code === 'ATTEMPT_ALREADY_SUBMITTED' || isClosedAttemptStatus(attemptStatus)) {
      return {
        code: code || 'ATTEMPT_ALREADY_SUBMITTED', kind: 'receipt',
        title: 'This examination was already submitted',
        message: 'Your recorded submission remains available. No new attempt was created and no class code is needed.',
        attemptId: attempt.attemptId || server.attemptId || null,
      };
    }
    if (['READY', 'RESUME_READY', 'EXAM_NOT_OPEN'].includes(code)) return null;
    if (server.waitingRoomState !== 'blocked'
        && server.eligible === true
        && (server.canStart === true || code === 'EXAM_NOT_OPEN')) return null;
    return {
      code: code || 'STUDENT_NOT_ELIGIBLE', kind: 'blocked',
      title: code === 'ROSTER_REQUIRED'
        ? 'Your account is not on this class list'
        : 'Automatic examination entry is not available',
      message: examCodeMessage(code || 'STUDENT_NOT_ELIGIBLE'),
      attemptId: attempt.attemptId || server.attemptId || null,
    };
  }

  function isRetryableBeadleHandoffError(error) {
    const status = Number(error?.status);
    return error instanceof TypeError
      || (error?.code === 'REQUEST_FAILED' && (!Number.isFinite(status) || status >= 500))
      || status === 408
      || status === 425
      || status === 429
      || status >= 500;
  }

  async function returnToBeadleWorkspace(message = '') {
    const check = state.exam.preflight;
    stopStudentWaitingRoom(check);
    clearBeadleStudentHandoff(check?.examId);
    state.exam.preflight = null;
    state.exam.section = 'beadle';
    renderExamRoom();
    document.getElementById('dd26-exam-main')?.focus();
    try {
      await refreshExamPortal('beadle');
    } catch {
      global.toast?.(message || 'The saved Beadle workspace is shown. Refresh when your connection returns.', 'warn');
    }
  }

  function renderDirectBeadleHandoffBlocker(check, failure = {}) {
    if (!check) return;
    stopStudentWaitingRoom(check);
    check.terminal = failure.terminal !== false;
    check.blockedView = true;
    state.exam.preflight = check;
    state.exam.section = 'beadle';
    if (check.terminal) clearBeadleStudentHandoff(check.examId);
    renderExamRoom();
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    const attemptId = failure.attemptId || directBeadleAttempt(check.server).attemptId || null;
    const primaryAction = failure.kind === 'receipt' && attemptId
      ? '<button class="dd26-button primary" id="dd26-direct-view-receipt" type="button">View submission receipt</button>'
      : failure.kind === 'session'
        ? '<button class="dd26-button primary" id="dd26-direct-open-student" type="button">Open Student recovery</button>'
        : failure.retryable === true
          ? '<button class="dd26-button primary" id="dd26-direct-retry" type="button">Try secure handoff again</button>'
          : '';
    host.innerHTML = `<section class="dd26-card"><div class="dd26-label">Secure Beadle handoff</div><h2>${escapeHtml(failure.title || 'Your examination could not be opened')}</h2><div class="${failure.retryable ? 'dd26-notice' : 'dd26-error'}" role="alert"><strong>No class code was lost or exposed.</strong> ${escapeHtml(failure.message || 'Due Diligence stopped safely before creating or opening an attempt.')}</div><div class="dd26-actions">${primaryAction}<button class="dd26-button" id="dd26-direct-return-beadle" type="button">Return to Beadle workspace</button></div><p class="dd26-privacy">No per-student approval or manual email is required. Every retry is checked again against the signed-in account, active Beadle assignment, and official class list. This page never shows questions, answers, grades, or the Professor’s suggested answer.</p></section>`;
    document.getElementById('dd26-direct-view-receipt')?.addEventListener('click', () => {
      clearBeadleStudentHandoff(check.examId);
      state.exam.preflight = null;
      state.exam.section = 'student';
      void loadSubmissionStatus(attemptId);
    });
    document.getElementById('dd26-direct-open-student')?.addEventListener('click', () => {
      clearBeadleStudentHandoff(check.examId);
      state.exam.preflight = null;
      void refreshExamPortal('student').catch(() => {
        state.exam.section = 'student';
        renderExamRoom();
        global.toast?.('Student recovery could not refresh. Your saved Examination Room remains available.', 'warn');
      });
    });
    document.getElementById('dd26-direct-retry')?.addEventListener('click', () => {
      check.terminal = false;
      check.blockedView = false;
      void enterRosteredBeadleExam({ examId: check.examId }, { restored: true });
    });
    document.getElementById('dd26-direct-return-beadle')?.addEventListener('click', () => {
      void returnToBeadleWorkspace();
    });
    host.focus();
  }

  function enterRosteredBeadleExam(snapshot, options = {}) {
    const examId = String(snapshot?.examId || '').trim();
    if (!examId) return Promise.resolve(false);
    if (state.exam.beadleHandoffPromise) return state.exam.beadleHandoffPromise;
    const pending = prepareRosteredBeadleExam(examId, options);
    state.exam.beadleHandoffPromise = pending;
    return pending.finally(() => {
      if (state.exam.beadleHandoffPromise === pending) state.exam.beadleHandoffPromise = null;
    });
  }

  async function prepareRosteredBeadleExam(examId, options = {}) {
    if (!isAuthenticated()) {
      clearBeadleStudentHandoff(examId);
      requireAuthentication();
      return false;
    }
    const handoffUserId = authenticatedUserId();
    const button = document.getElementById('dd26-back-beadle');
    if (!options.restored && button?.disabled) return false;
    if (button) {
      button.disabled = true;
      button.textContent = 'Opening your examination…';
    }
    saveBeadleStudentHandoff(examId);
    let check = null;
    try {
      const storageApi = global.DueDiligenceExaminationRoomStore;
      state.exam.store ||= storageApi?.createStore?.();
      const storage = state.exam.store
        ? await state.exam.store.init()
        : { available: false, code: 'module_unavailable' };
      const persistent = storage.available && navigator.storage?.persist
        ? await navigator.storage.persist().catch(() => false)
        : false;
      const deviceSupported = Math.min(
        global.screen?.width || global.innerWidth,
        global.screen?.height || global.innerHeight,
      ) >= 600;
      const startedAt = performance.now();
      const deviceInstanceHash = storage.available
        ? await state.exam.store.getDeviceInstanceHash()
        : null;
      const payload = await api('/exam-room/query', {
        operation: 'beadle_student_entry',
        examId,
        deviceInstanceHash,
      });
      if (authenticatedUserId() !== handoffUserId) return false;
      const reachabilityMs = Math.max(0, Math.round(performance.now() - startedAt));
      check = {
        examId,
        studentKey: null,
        entryMode: 'beadle',
        autoEnter: true,
        autoEntryBusy: false,
        autoEntryRetryAt: 0,
        retryCount: 0,
        requestBusy: false,
        terminal: false,
        storage,
        persistent,
        deviceSupported,
        deviceInstanceHash,
        reachabilityMs,
        server: payload.result || {},
      };
      state.exam.preflight = check;
      synchronizeServerClock(
        check.server.serverNow || check.server.checks?.serverNow,
      );
      const terminal = directBeadleTerminalState(check.server);
      if (terminal) {
        renderDirectBeadleHandoffBlocker(check, { ...terminal, terminal: true });
        return false;
      }
      if (!storage.available || !deviceSupported) {
        const message = !deviceSupported
          ? 'Use a desktop or tablet-sized screen for this formal examination. Your assignment and exam remain saved.'
          : `${storage.message || 'Secure answer storage is unavailable in this browser.'} Enable normal browser storage, then try again.`;
        renderDirectBeadleHandoffBlocker(check, {
          terminal: false,
          retryable: true,
          title: 'This device needs attention before the exam can open',
          message,
        });
        return false;
      }
      state.exam.section = 'student';
      renderExamRoom();
      return true;
    } catch (error) {
      if (authenticatedUserId() !== handoffUserId) return false;
      const retryable = isRetryableBeadleHandoffError(error);
      check ||= {
        examId,
        entryMode: 'beadle',
        autoEnter: true,
        autoEntryBusy: false,
        autoEntryRetryAt: 0,
        retryCount: 0,
        requestBusy: false,
        storage: { available: false },
        deviceSupported: true,
        server: {},
      };
      renderDirectBeadleHandoffBlocker(check, {
        terminal: !retryable,
        retryable,
        title: retryable ? 'The connection was interrupted' : 'Secure examination entry was declined',
        message: retryable
          ? 'Your no-code handoff is preserved on this device. Reconnect and try again; no duplicate attempt will be created.'
          : (error.message || 'Your Beadle assignment or student eligibility could not be verified.'),
      });
      if (button) {
        button.disabled = false;
        button.textContent = 'Finish Beadle duties and enter my exam';
      }
      return false;
    }
  }

  async function restoreBeadleStudentHandoff() {
    const saved = readBeadleStudentHandoff();
    if (!saved || state.exam.attempt) return false;
    if (state.exam.preflight?.entryMode === 'beadle'
        && state.exam.preflight?.examId === saved.examId
        && state.exam.preflight?.terminal !== true) {
      state.exam.section = 'student';
      renderExamRoom();
      return true;
    }
    return enterRosteredBeadleExam({ examId: saved.examId }, { restored: true });
  }

  function openRosterCorrection(snapshot) {
    if (state.exam.rosterMode !== 'beadle' || snapshot?.canReopenRoster !== true) return;
    openDialog(`<div class="dd26-label">Step 4 · Correct class list</div><h2>Reopen the class list?</h2><div class="dd26-error" role="alert"><strong>The current student exam code will stop working immediately.</strong> After correcting and saving the class list, create a fresh Step 5 code and give the new handout to the class.</div><label class="dd26-field"><span>Reason for reopening the class list</span><textarea class="dd26-textarea compact" id="dd26-roster-reopen-reason" minlength="10" maxlength="1000" required></textarea><small class="dd26-help">Explain the correction in at least 10 characters.</small></label><label class="dd26-choice"><input id="dd26-roster-reopen-ack" type="checkbox"><span><strong>I understand the current student code will stop working</strong><small>A fresh code must be created after the corrected list is saved.</small></span></label><div class="dd26-error" id="dd26-roster-reopen-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-roster-reopen" type="button" disabled>Reopen class list</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    const reason = document.getElementById('dd26-roster-reopen-reason');
    const acknowledgement = document.getElementById('dd26-roster-reopen-ack');
    const confirmButton = document.getElementById('dd26-confirm-roster-reopen');
    const update = () => { confirmButton.disabled = !acknowledgement.checked || reason.value.trim().length < 10; };
    reason?.addEventListener('input', update);
    acknowledgement?.addEventListener('change', update);
    confirmButton?.addEventListener('click', () => reopenRoster(snapshot));
  }

  async function reopenRoster(snapshot) {
    if (state.exam.rosterMode !== 'beadle' || snapshot?.canReopenRoster !== true) return;
    const reason = value('dd26-roster-reopen-reason');
    const acknowledgement = document.getElementById('dd26-roster-reopen-ack');
    if (!acknowledgement?.checked || reason.length < 10) return;
    const button = document.getElementById('dd26-confirm-roster-reopen');
    if (button) { button.disabled = true; button.textContent = 'Reopening…'; }
    try {
      await command({
        operation: 'reopen_exam_roster', examId: snapshot.examId, reason,
        requestKey: randomKey('roster_reopen'),
      });
      state.exam.studentExamCodes.delete(snapshot.examId);
      state.exam.rosterPreview = null;
      closeDialog();
      await refreshBeadleOperations(snapshot.examId, { mode: 'beadle', focus: 'roster' });
      global.toast?.('Class list reopened. Save every correction, then create a fresh student exam code.', 'ok');
    } catch (error) {
      const host = document.getElementById('dd26-roster-reopen-error');
      if (host) { host.hidden = false; host.textContent = error.message || 'The class list could not be reopened.'; }
      if (button) { button.disabled = false; button.textContent = 'Reopen class list'; }
    }
  }

  function beadleCandidateAction(operation, candidateNumber, examId) {
    const admitting = operation === 'set_candidate_admission';
    const title = admitting ? 'Allow this student to enter' : 'Record the identity check';
    const defaultNote = admitting
      ? 'Class-list identity confirmed by the Beadle'
      : 'Student identity checked in person by the Beadle';
    openDialog(`<div class="dd26-label">Beadle · One student</div><h2>${escapeHtml(title)}</h2><p>${admitting ? 'Use this only after confirming the student against the saved class list.' : 'Record only what you checked in person. Do not add private notes that are unrelated to the examination.'}</p><dl class="dd26-publish-summary"><div><dt>Exam number</dt><dd>${escapeHtml(candidateNumber)}</dd></div></dl><label class="dd26-field"><span>${admitting ? 'Reason for allowing entry' : 'Identity-check note'}</span><textarea class="dd26-textarea compact" id="dd26-beadle-decision-note" minlength="5" maxlength="1000" required>${escapeHtml(defaultNote)}</textarea><small class="dd26-help">Enter at least 5 characters.</small></label><div class="dd26-error" id="dd26-beadle-decision-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-confirm-beadle-decision" type="button">${admitting ? 'Allow entry' : 'Save identity check'}</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-confirm-beadle-decision')?.addEventListener('click', () => confirmBeadleCandidateAction(operation, candidateNumber, examId));
  }

  async function confirmBeadleCandidateAction(operation, candidateNumber, examId) {
    const reason = value('dd26-beadle-decision-note');
    const errorHost = document.getElementById('dd26-beadle-decision-error');
    const note = document.getElementById('dd26-beadle-decision-note');
    if (reason.length < 5) {
      if (errorHost) {
        errorHost.hidden = false;
        errorHost.textContent = 'Enter a short reason before saving this decision.';
      }
      note?.setAttribute('aria-invalid', 'true');
      note?.focus();
      return;
    }
    note?.removeAttribute('aria-invalid');
    const button = document.getElementById('dd26-confirm-beadle-decision');
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    try {
      const body = operation === 'set_candidate_admission'
        ? { operation, examId, candidateNumber, decision: 'admit', reason, requestKey: randomKey('admission') }
        : { operation, examId, candidateNumber, method: 'physical', outcome: 'verified', note: reason, requestKey: randomKey('verification') };
      await command(body);
      closeDialog();
      global.toast?.(operation === 'set_candidate_admission' ? 'Student entry allowed.' : 'Identity check saved.', 'ok');
      await openBeadleOperations(examId);
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = operation === 'set_candidate_admission' ? 'Allow entry' : 'Save identity check';
      }
      if (errorHost) {
        errorHost.hidden = false;
        errorHost.textContent = error.message;
      }
      global.toast?.(error.message, 'warn');
    }
  }

  async function beadleLeaveReturn(leaveId, attemptId, examId) {
    try {
      await command({ operation: 'acknowledge_leave', attemptId, leaveId, action: 'record_return', note: 'Return recorded by Beadle', requestKey: randomKey('leave_return') });
      await openBeadleOperations(examId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function beadleLeaveAcknowledge(leaveId, attemptId, examId) {
    try {
      await command({ operation: 'acknowledge_leave', attemptId, leaveId, action: 'acknowledge', note: 'Temporary leave acknowledged by Beadle', requestKey: randomKey('leave_ack') });
      global.toast?.('Temporary leave acknowledged. The exam timer continues.', 'ok');
      await openBeadleOperations(examId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openSessionTransfer(attemptId, candidateNumber, examId) {
    openDialog(`<div class="dd26-label">Device help for one student</div><h2>Move student ${escapeHtml(candidateNumber)} to a new device</h2><div class="dd26-error"><strong>Verify the student in person first.</strong> The new device restores only answers already received by Due Diligence. The previous device immediately loses exam access, and the change is recorded.</div><div class="dd26-form-grid"><label class="dd26-field"><span>Current exam-session number shown to the student</span><input class="dd26-input" id="dd26-transfer-epoch" type="number" min="1" step="1"></label><label class="dd26-field"><span>New-device recovery reference (64 characters)</span><input class="dd26-input" id="dd26-transfer-device" minlength="64" maxlength="64" autocomplete="off"></label><label class="dd26-field wide"><span>Required reason</span><input class="dd26-input" id="dd26-transfer-reason" maxlength="1000" value="Student verified in person after device failure"></label></div><label class="dd26-choice"><input id="dd26-transfer-verified" type="checkbox"><span><strong>I verified this student and the new device in person</strong><small>The previous device will immediately lose exam access.</small></span></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-transfer" type="button" disabled>Move exam to the new device</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    const acknowledgment = document.getElementById('dd26-transfer-verified');
    const submit = document.getElementById('dd26-confirm-transfer');
    acknowledgment?.addEventListener('change', () => { submit.disabled = !acknowledgment.checked; });
    submit?.addEventListener('click', async () => {
      submit.disabled = true;
      try {
        await command({
          operation: 'transfer_session', attemptId,
          expectedEpoch: Number(value('dd26-transfer-epoch')),
          deviceInstanceHash: value('dd26-transfer-device').toLowerCase(),
          reason: value('dd26-transfer-reason'), requestKey: randomKey('session_transfer'),
        });
        closeDialog();
        global.toast?.('Session transferred; the previous device can no longer write.', 'ok');
        await openBeadleOperations(examId);
      } catch (error) { submit.disabled = false; global.toast?.(error.message, 'warn'); }
    });
  }

  function parseDelimitedRoster(text) {
    const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!source) return [];
    const delimiter = source.includes('\t') ? '\t' : ',';
    const records = [];
    let record = []; let cell = ''; let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted && character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (!quoted && character === delimiter) { record.push(cell); cell = ''; }
      else if (!quoted && character === '\n') { record.push(cell.replace(/\r$/, '')); records.push(record); record = []; cell = ''; }
      else cell += character;
    }
    if (quoted) throw new Error('The class list contains an unfinished quoted value. Correct the file and try again.');
    record.push(cell.replace(/\r$/, '')); records.push(record);
    while (records.length && records[records.length - 1].every((entry) => !String(entry).trim())) records.pop();
    if (!records.length) return [];
    const aliases = new Map([
      ['email', 'email'], ['email address', 'email'], ['primary email', 'email'],
      ['student number', 'studentNumber'], ['student id', 'studentNumber'], ['student no', 'studentNumber'],
      ['candidate number', 'candidateNumber'], ['candidate id', 'candidateNumber'], ['candidate no', 'candidateNumber'],
      ['name', 'displayName'], ['display name', 'displayName'], ['student name', 'displayName'],
    ]);
    const headers = records.shift()?.map((entry) => {
      const header = String(entry).trim().toLowerCase();
      if (header.includes('student name')) return 'displayName';
      return aliases.get(header) || null;
    }) || [];
    const recognizedHeaders = headers.filter(Boolean);
    if (!recognizedHeaders.includes('email') || !recognizedHeaders.includes('displayName')) {
      throw new Error('The class list must include Email Address and Student Name columns.');
    }
    if (new Set(recognizedHeaders).size !== recognizedHeaders.length) {
      throw new Error('The class list repeats a required column. Keep only one Email Address, Student Number, Candidate Number, and Student Name column.');
    }
    return records.map((row) => Object.fromEntries(
      headers.map((header, index) => [header, String(row[index] ?? '').trim()]).filter(([header]) => header),
    ));
  }

  async function sha256Text(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function validatePastedRoster() {
    const generation = state.exam.rosterValidationGeneration += 1;
    try {
      const source = value('dd26-roster-paste', false);
      const rows = parseDelimitedRoster(source);
      if (!rows.length) throw new Error('Paste a header row and at least one candidate row.');
      if (state.exam.rosterMode === 'beadle') {
        const sourceHash = await sha256Text(source);
        if (generation !== state.exam.rosterValidationGeneration) return;
        await prepareClassroomRosterPreview(rows, 'paste', sourceHash, generation);
        return;
      }
      await validateRosterRows(rows, generation);
    } catch (error) {
      if (generation !== state.exam.rosterValidationGeneration) return;
      state.exam.rosterPreview = null;
      rerenderRosterSurface();
      global.toast?.(error.message, 'warn');
    }
  }

  async function prepareClassroomRosterPreview(rows, sourceKind = 'manual', sourceHash = '', generation = state.exam.rosterValidationGeneration) {
    const normalizedRows = rows.map((row) => ({
      email: String(row.email || '').trim().toLowerCase(),
      studentNumber: String(row.studentNumber || '').trim(),
      candidateNumber: String(row.candidateNumber || '').trim(),
      displayName: String(row.displayName || row.name || '').trim(),
    }));
    const errors = [];
    const emails = new Set();
    const studentNumbers = new Set();
    const candidateNumbers = new Set();
    normalizedRows.forEach((row, index) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email)) errors.push({ row: index + 1, message: 'Enter a valid sign-in email.' });
      if (row.displayName.length < 2) errors.push({ row: index + 1, message: 'Enter the student name.' });
      if (emails.has(row.email)) errors.push({ row: index + 1, message: 'This email appears more than once.' });
      emails.add(row.email);
      const studentNumberKey = row.studentNumber.toLocaleLowerCase('en-US');
      const candidateNumberKey = row.candidateNumber.toLocaleLowerCase('en-US');
      if (studentNumberKey && studentNumbers.has(studentNumberKey)) errors.push({ row: index + 1, message: 'This student number appears more than once.' });
      if (candidateNumberKey && candidateNumbers.has(candidateNumberKey)) errors.push({ row: index + 1, message: 'This candidate number appears more than once.' });
      if (studentNumberKey) studentNumbers.add(studentNumberKey);
      if (candidateNumberKey) candidateNumbers.add(candidateNumberKey);
    });
    if (generation !== state.exam.rosterValidationGeneration) return;
    state.exam.rosterPreview = {
      rows: normalizedRows,
      sourceKind,
      sourceHash: sourceHash || await sha256Text(JSON.stringify(normalizedRows)),
      validation: { ok: normalizedRows.length > 0 && errors.length === 0, errors },
    };
    rerenderRosterSurface();
  }

  function collectRosterPreviewRows() {
    const previous = Array.isArray(state.exam.rosterPreview?.rows) ? state.exam.rosterPreview.rows : [];
    return [...document.querySelectorAll('[data-dd26-roster-row]')].map((row, index) => {
      const fields = Object.fromEntries(
        [...row.querySelectorAll('[data-dd26-roster-field]')].map((input) => [input.dataset.dd26RosterField, input.value]),
      );
      const collected = { ...(previous[index] || {}), ...fields };
      if (state.exam.rosterMode === 'beadle') collected.candidateNumber = String(collected.studentNumber || '').trim();
      return collected;
    });
  }

  async function validateRosterRows(rows, generation = state.exam.rosterValidationGeneration) {
    if (state.exam.rosterMode === 'beadle') {
      await prepareClassroomRosterPreview(rows, state.exam.rosterPreview?.sourceKind || 'manual', '', generation);
      return;
    }
    try {
      const normalizedRows = rows.map((row) => ({
        email: String(row.email || '').trim(),
        studentNumber: String(row.studentNumber || '').trim(),
        candidateNumber: String(row.candidateNumber || '').trim(),
        displayName: String(row.displayName || '').trim(),
      }));
      const validation = await command({
        operation: 'validate_roster', classroomId: state.exam.activeClassroomId, rows: normalizedRows,
      });
      if (generation !== state.exam.rosterValidationGeneration) return;
      state.exam.rosterPreview = {
        rows: normalizedRows,
        sourceHash: await sha256Text(JSON.stringify(normalizedRows)),
        validation,
      };
      rerenderRosterSurface();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function revalidateRosterPreview(generation = state.exam.rosterValidationGeneration) {
    await validateRosterRows(collectRosterPreviewRows(), generation);
  }

  function addRosterPreviewRow() {
    const rows = collectRosterPreviewRows();
    rows.push({ email: '', studentNumber: '', candidateNumber: '', displayName: '' });
    state.exam.rosterPreview = { rows, sourceKind: 'manual', sourceHash: '', validation: { ok: false, errors: [{ message: 'Enter the student name and email, then check corrections.' }] } };
    rerenderRosterSurface();
    markRosterPreviewDirty();
  }

  function removeRosterPreviewRow(index) {
    const rows = collectRosterPreviewRows();
    rows.splice(index, 1);
    state.exam.rosterPreview = { rows, sourceKind: state.exam.rosterPreview?.sourceKind || 'manual', sourceHash: '', validation: { ok: false, errors: [{ message: 'Check the corrected class list.' }] } };
    rerenderRosterSurface();
    const generation = state.exam.rosterValidationGeneration += 1;
    setTimeout(() => revalidateRosterPreview(generation), 0);
  }

  function downloadRosterTemplate() {
    const blob = new Blob(['email,student number,candidate number,name\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'duediligence-examination-roster-template.csv';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importRoster() {
    const preview = state.exam.rosterPreview;
    if (!preview?.validation?.ok) return;
    const button = document.getElementById('dd26-import-roster');
    if (state.exam.rosterFinalization?.busy) return;
    try {
      if (state.exam.rosterMode === 'beadle') {
        const sourceHash = preview.sourceHash || await sha256Text(JSON.stringify(preview.rows));
        let finalization = state.exam.rosterFinalization;
        if (!finalization || finalization.sourceHash !== sourceHash) {
          finalization = {
            sourceHash,
            studentKey: randomKey('student_exam'),
            requestKey: randomKey('roster_finalize'),
            busy: false,
          };
          state.exam.rosterFinalization = finalization;
        }
        finalization.busy = true;
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Confirming…'; }
        const result = await command({
          operation: 'finalize_roster_access', examId: state.exam.activeExamId,
          rows: preview.rows,
          sourceKind: preview.sourceKind || 'manual',
          sourceHash,
          studentKey: finalization.studentKey,
          requestKey: finalization.requestKey,
        });
        if (result?.ok !== true || result?.studentAccessReady !== true) {
          throw new Error('The server did not confirm the class list and student access code. Nothing was announced as complete.');
        }
        state.exam.studentExamCodes.set(state.exam.activeExamId, finalization.studentKey);
        finalization.studentKey = '';
        state.exam.rosterFinalization = null;
      } else {
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Confirming…'; }
        await command({ operation: 'import_roster', classroomId: state.exam.activeClassroomId, rows: preview.rows, sourceHash: preview.sourceHash, requestKey: randomKey('roster') });
      }
      state.exam.rosterPreview = null;
      if (state.exam.rosterMode === 'beadle') {
        global.toast?.('Class list confirmed. Individual access-code emails were queued. Your work is finished.', 'ok');
        await openBeadleOperations(state.exam.activeExamId);
        const codePanel = document.getElementById('dd26-student-code-panel');
        codePanel?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        codePanel?.focus?.({ preventScroll: true });
        announceExamStatus('Class list confirmed, student access emails queued, and Beadle work complete.');
      } else {
        global.toast?.('Roster imported without duplicates.', 'ok');
        await refreshExamPortal('professor');
      }
    } catch (error) {
      if (state.exam.rosterFinalization) state.exam.rosterFinalization.busy = false;
      if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'Confirm and Finish'; }
      global.toast?.(state.exam.rosterMode === 'beadle'
        ? rosterTemplateErrorMessage(error)
        : error.message, 'warn');
    }
  }

  function rerenderRosterSurface() {
    if (state.exam.rosterMode === 'beadle' && state.exam.activeBeadleSnapshot) {
      renderBeadleOperations(state.exam.activeBeadleSnapshot);
      return;
    }
    renderExamRoom();
  }

  async function upsertBeadleRosterRow() {
    const row = {
      email: value('dd26-beadle-row-email'),
      studentNumber: value('dd26-beadle-row-student'),
      candidateNumber: value('dd26-beadle-row-candidate'),
      displayName: value('dd26-beadle-row-name', false),
    };
    try {
      await command({
        operation: 'upsert_exam_roster_row',
        examId: state.exam.activeExamId,
        row,
        reason: value('dd26-beadle-row-reason'),
        requestKey: randomKey('roster_row'),
      });
      global.toast?.('Roster row saved with an audit record.', 'ok');
      await openBeadleOperations(state.exam.activeExamId);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function copyBeadleExamLink() {
    const input = document.getElementById('dd26-beadle-exam-link');
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      document.getElementById('dd26-copy-exam-link').textContent = 'Copied';
    } catch {
      input.focus();
      input.select();
      global.toast?.('Copy was unavailable. The link is selected for manual copying.', 'warn');
    }
  }

  async function copyActiveClassHandout(snapshot, studentCode, buttonId = 'dd26-copy-active-class-handout') {
    if (!studentCode) return;
    const handout = [
      snapshot.title || 'Class examination',
      `Class examination code: ${studentCode}`,
      `Opens: ${formatDate(snapshot.opensAt)}`,
      `Entry closes: ${formatDate(snapshot.entryClosesAt)}`,
      'Students must sign in with the account listed on the class list.',
      'Open https://duediligence.ph and choose Examination Room → Student.',
      'For access help: support@duediligence.ph',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(handout);
      const button = document.getElementById(buttonId);
      if (button) button.textContent = 'Class code copied';
      global.toast?.('Class code copied for the approved class channel.', 'ok');
    } catch {
      global.toast?.('Copy was unavailable. Select and copy the class examination code.', 'warn');
    }
  }

  async function issueStudentAccess(attempt = {}) {
    const snapshot = state.exam.activeBeadleSnapshot || {};
    const replacing = snapshot.studentAccessReady === true;
    if (replacing && !global.confirm('Replace the current student exam code? The old code will stop working immediately.')) return;
    attempt.studentKey ||= randomKey('student_exam');
    attempt.requestKey ||= randomKey('student_access');
    const button = document.getElementById('dd26-issue-student-access');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = replacing ? 'Replacing code…' : 'Creating student exam code…'; }
    try {
      const result = await withBoundedPublishWait(command({
        operation: 'issue_student_access',
        examId: state.exam.activeExamId,
        studentKey: attempt.studentKey,
        requestKey: attempt.requestKey,
      }));
      if (result?.ok !== true || result.studentAccessReady !== true
          || result.oneTimeStudentAccessCode !== attempt.studentKey
          || (result.activeStudentExamCode && result.activeStudentExamCode !== attempt.studentKey)) {
        const error = new Error('The server did not confirm the complete student handout. No code can be displayed.');
        error.code = 'EXAM_ROOM_STUDENT_ACCESS_CONFIRMATION_INCOMPLETE';
        throw error;
      }
      const examId = state.exam.activeExamId;
      let studentCode = String(result.activeStudentExamCode || attempt.studentKey || '');
      state.exam.studentExamCodes.set(examId, studentCode);
      const handoutTitle = snapshot.title || 'Class examination';
      const handoutOpens = formatDate(result.opensAt);
      const handoutEntryCloses = formatDate(result.entryClosesAt);
      openDialog(`<div class="dd26-label">Student access</div><h2>${result.rotated ? 'New class examination code created' : 'Class examination code created'}</h2><div class="dd26-success" role="status"><strong>The code is ready.</strong> Due Diligence queues individual emails to the validated class list. No examination link or per-student approval is required.</div><label class="dd26-field"><span>Active class examination code</span><div class="dd26-raw-key" id="dd26-student-handout-code" data-dd26-sensitive>${escapeHtml(studentCode)}</div></label><div class="dd26-notice"><strong>Student entry still requires sign-in.</strong> The signed-in email must exactly match the saved class list. The shared code is not sufficient authorization by itself.</div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-copy-class-handout" type="button">Copy class code</button><button class="dd26-button" data-dd26-close-dialog type="button">Done</button></div>`, {
        persistent: true,
        sensitive: true,
        onClose: () => {
          studentCode = '';
          attempt.studentKey = '';
          attempt.requestKey = '';
          if (state.exam.section === 'beadle'
              && state.exam.activeBeadleSnapshot?.studentAccessReady !== true) {
            void refreshBeadleOperations(examId).catch(() => {
              global.toast?.('Refresh the Beadle workspace to see the student handout status.', 'warn');
            });
          }
        },
      });
      bindSecretCopyButtons();
      document.getElementById('dd26-copy-class-handout')?.addEventListener('click', async (event) => {
        await copyActiveClassHandout({
          title: handoutTitle,
          opensAt: result.opensAt || handoutOpens,
          entryClosesAt: result.entryClosesAt || handoutEntryCloses,
        }, state.exam.studentExamCodes.get(examId) || '', event.currentTarget.id);
      });
      attempt.studentKey = '';
      attempt.requestKey = '';
      studentCode = '';
      result.oneTimeStudentAccessCode = '';
      await withBoundedPublishWait(refreshBeadleOperations(examId), EXAMINATION_ROOM_REFRESH_WAIT_MS).catch(() => false);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = replacing ? 'Create a new student exam code' : 'Create student exam code'; }
      global.toast?.(error.message || 'The student handout could not be created.', 'warn');
    }
  }

  function examDraftValidation(input = {}) {
    const errors = [];
    const add = (field, message) => errors.push({ field, message });
    const title = String(input.title || '').trim();
    const instructions = String(input.instructions || '');
    const questionCount = Number(input.questionCount);
    if (!title) add('dd26-exam-title', 'Enter a title for the examination.');
    else if (codePointLength(title) > 200) add('dd26-exam-title', 'The examination title must be 200 characters or fewer.');
    if (String(input.questionCount ?? '').trim() === '' || !Number.isSafeInteger(questionCount)
        || questionCount < 1 || questionCount > 200) {
      add('dd26-exam-count', 'The number of questions must be a whole number from 1 to 200.');
    }
    if (codePointLength(instructions) > 10_000) {
      add('dd26-exam-instructions', 'Instructions must be 10,000 characters or fewer.');
    }
    if (!['standard', 'strict', 'open_book'].includes(String(input.integrityPreset || ''))) {
      add('dd26-exam-integrity', 'Choose how tab changes should be handled.');
    }
    if (!input.classroomId) add(null, 'Choose an Examination Room before making the exam.');
    return { errors, title, instructions, questionCount };
  }

  function showCreateExamErrors(errors) {
    const host = document.getElementById('dd26-create-exam-errors');
    if (!host) return;
    host.closest('.dd26-section')?.querySelectorAll('[aria-invalid="true"]')
      .forEach((field) => field.removeAttribute('aria-invalid'));
    host.hidden = errors.length === 0;
    host.innerHTML = errors.length
      ? `<strong>Correct these items before creating the exam:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`
      : '';
    if (!errors.length) return;
    const firstField = errors.find((error) => error.field)?.field;
    const target = firstField ? document.getElementById(firstField) : host;
    target?.setAttribute?.('aria-invalid', 'true');
    target?.focus?.();
  }

  async function createExam() {
    const validation = examDraftValidation({
      title: value('dd26-exam-title'),
      instructions: value('dd26-exam-instructions', false),
      questionCount: value('dd26-exam-count'),
      integrityPreset: value('dd26-exam-integrity'),
      classroomId: state.exam.activeClassroomId,
    });
    showCreateExamErrors(validation.errors);
    if (validation.errors.length) {
      global.toast?.('Correct the highlighted exam details before continuing.', 'warn');
      return;
    }
    const button = document.getElementById('dd26-create-exam');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Creating exam…'; }
    let examCreated = false;
    try {
      await command({ operation: 'create_exam', classroomId: state.exam.activeClassroomId, title: validation.title, instructions: validation.instructions, questionCount: validation.questionCount, integrityPreset: value('dd26-exam-integrity'), includeQuestionnaire: value('dd26-exam-questionnaire') === 'true' });
      examCreated = true;
      global.toast?.('Examination draft created.', 'ok');
      await refreshExamPortal('professor');
    } catch (error) {
      const message = examCreated
        ? 'The exam was created, but the screen could not refresh. Refresh the Examination Room; do not create it again.'
        : (error.message || 'The exam could not be created. Review the details and try again.');
      showCreateExamErrors([{ field: null, message }]);
      global.toast?.(message, 'warn');
      if (button) {
        button.disabled = examCreated;
        button.textContent = examCreated ? 'Exam created — refresh the room' : 'Create exam draft';
      }
    }
  }

  function openProfessorDetails(snapshot) {
    const details = snapshot?.details;
    if (!details || typeof details.title !== 'string'
        || typeof details.instructions !== 'string'
        || !Number.isSafeInteger(Number(details.questionCount))
        || !['standard', 'strict', 'open_book'].includes(details.integrityPreset)
        || typeof details.includeQuestionnaire !== 'boolean') {
      openAuthoringBlockedDialog('Examination details unavailable', 'The server did not return a complete examination-detail record. Nothing can be changed.');
      return;
    }
    const editable = snapshot.published !== true
      && authoringCapability(snapshot, 'canEditDetails');
    const blocked = editable ? '' : authoringBlockedCopy(snapshot, 'details');
    const selected = (value, expected) => String(value) === expected ? 'selected' : '';
    const locked = editable ? '' : 'disabled';
    openDialog(`<div class="dd26-label">Step 1 · Examination details</div><h2>${editable ? 'Review and edit the examination details' : 'Review the saved examination details'}</h2>${editable ? '<p>Return here as often as needed before publication. If the number of questions changes, Step 2 must be reviewed again.</p>' : `<div class="dd26-notice"><strong>Review only.</strong> ${escapeHtml(blocked)}</div>`}<div class="dd26-form-grid"><label class="dd26-field"><span>Exam title</span><input class="dd26-input" id="dd26-exam-title" maxlength="200" value="${escapeHtml(details.title)}" ${locked}></label><label class="dd26-field"><span>Number of questions</span><input class="dd26-input" id="dd26-exam-count" type="number" min="1" max="200" step="1" value="${escapeHtml(details.questionCount)}" ${locked}></label><label class="dd26-field wide"><span>Instructions for students</span><textarea class="dd26-textarea" id="dd26-exam-instructions" maxlength="10000" ${locked}>${escapeHtml(details.instructions || '')}</textarea></label><label class="dd26-field"><span>If a student leaves the exam tab</span><select class="dd26-select" id="dd26-exam-integrity" ${locked}><option value="standard" ${selected(details.integrityPreset, 'standard')}>Record for Professor review</option><option value="strict" ${selected(details.integrityPreset, 'strict')}>Warn the student and record</option><option value="open_book" ${selected(details.integrityPreset, 'open_book')}>Open book</option></select></label><label class="dd26-field"><span>Student result when grades are sent</span><select class="dd26-select" id="dd26-exam-questionnaire" ${locked}><option value="false" ${details.includeQuestionnaire === true ? '' : 'selected'}>Grades and comments only</option><option value="true" ${details.includeQuestionnaire === true ? 'selected' : ''}>Questions, grades, and comments</option></select></label></div><div class="dd26-error" id="dd26-detail-review-errors" role="alert" tabindex="-1" hidden></div><div class="dd26-actions">${editable ? '<button class="dd26-button primary" id="dd26-save-exam-details" type="button">Save changes</button>' : ''}<button class="dd26-button" data-dd26-close-dialog type="button">Return to five-step review</button></div>`);
    document.getElementById('dd26-save-exam-details')?.addEventListener('click', () => saveProfessorDetails(snapshot));
  }

  function showProfessorDetailErrors(errors) {
    const host = document.getElementById('dd26-detail-review-errors');
    if (!host) return;
    document.querySelectorAll('#dd26-dialog-card [aria-invalid="true"]')
      .forEach((field) => field.removeAttribute('aria-invalid'));
    host.hidden = errors.length === 0;
    host.innerHTML = errors.length
      ? `<strong>Correct these details before saving:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`
      : '';
    if (!errors.length) return;
    const firstField = errors.find((error) => error.field)?.field;
    const target = firstField ? document.getElementById(firstField) : host;
    target?.setAttribute?.('aria-invalid', 'true');
    target?.focus?.();
  }

  async function saveProfessorDetails(snapshot) {
    if (!authoringCapability(snapshot, 'canEditDetails')) return;
    const validation = examDraftValidation({
      title: value('dd26-exam-title'),
      instructions: value('dd26-exam-instructions', false),
      questionCount: value('dd26-exam-count'),
      integrityPreset: value('dd26-exam-integrity'),
      classroomId: state.exam.activeClassroomId || 'current-room',
    });
    showProfessorDetailErrors(validation.errors);
    if (validation.errors.length) return;
    const button = document.getElementById('dd26-save-exam-details');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Saving changes…'; }
    try {
      const result = await command({
        operation: 'update_exam_details',
        examId: snapshot.examId,
        expectedRevision: Number(snapshot.workspaceRevision),
        title: validation.title,
        instructions: validation.instructions,
        questionCount: validation.questionCount,
        integrityPreset: value('dd26-exam-integrity'),
        includeQuestionnaire: value('dd26-exam-questionnaire') === 'true',
        requestKey: randomKey('exam_details'),
      });
      state.exam.authoringSnapshots.delete(snapshot.examId);
      await loadProfessorAuthoringSnapshot(snapshot.examId).catch(() => null);
      closeDialog();
      global.toast?.(result?.questionsRequireReview
        ? 'Details saved. Review the questions again because the question count changed.'
        : 'Examination details saved.', 'ok');
      await refreshExamPortal('professor').catch(() => {
        global.toast?.('The details were saved, but the workspace could not refresh. Refresh the Examination Room before making another change.', 'warn');
      });
    } catch (error) {
      showProfessorDetailErrors([{ field: null, message: error.message || 'The examination details could not be saved.' }]);
      if (button) { button.disabled = false; button.textContent = 'Save changes'; }
    }
  }

  function openProfessorQuestionReview(snapshot) {
    const published = snapshot.published === true || Boolean(snapshot.publication);
    const source = snapshot.questions;
    const questions = source?.rows;
    const hasSavedQuestions = Array.isArray(questions) && questions.length > 0;
    const expectedCount = Number(
      (published ? snapshot.publication?.questionCount : snapshot.details?.questionCount)
      ?? questions?.length,
    );
    const canUploadInitial = !published && !hasSavedQuestions && !source?.questionVersionId
      && Number.isSafeInteger(expectedCount) && expectedCount > 0
      && professorExam(snapshot.examId)?.canUploadQuestions === true;
    const canEdit = !published && hasSavedQuestions
      && authoringCapability(snapshot, 'canEditQuestions');
    if (canUploadInitial) {
      openQuestionUpload(snapshot.examId, Number(snapshot.details?.questionCount));
      return;
    }
    if (!Array.isArray(questions) || !Number.isSafeInteger(expectedCount) || expectedCount < 1) {
      openAuthoringBlockedDialog('Question review unavailable', 'The server did not return a complete saved question version. Nothing can be changed.');
      return;
    }
    const expectedQuestionVersionId = source?.questionVersionId;
    if (canEdit && !expectedQuestionVersionId) {
      openAuthoringBlockedDialog('Question revision unavailable', 'The server did not identify the active question version. Changes are blocked to protect the saved examination.');
      return;
    }
    state.exam.questionUploadIntent = {
      mode: canEdit ? 'revision' : 'review',
      expectedRevision: Number(snapshot.workspaceRevision),
      expectedQuestionVersionId: expectedQuestionVersionId || null,
    };
    state.exam.questionPreview = {
      examId: snapshot.examId,
      questionCount: expectedCount,
      questions: questions.map((question, index) => ({
        ordinal: Number(question.ordinal) || index + 1,
        prompt: String(question.prompt || ''),
        maximumPoints: Number(question.maximumPoints),
      })),
      fileName: source?.sourceFileName || (published ? `Published version ${snapshot.publication?.publicationNumber || ''}`.trim() : 'Current reviewed questions'),
      warnings: [],
      readOnly: !canEdit,
    };
    openDialog(`<div class="dd26-label">Step 2 · Questions reviewed</div><h2>${canEdit ? 'Review and revise every question' : 'Review the saved questions'}</h2>${canEdit ? '<p>Change the wording, order, or points as often as needed before publication. Saving creates a new reviewed version and preserves the earlier version.</p>' : `<div class="dd26-notice"><strong>Review only.</strong> ${escapeHtml(authoringBlockedCopy(snapshot, 'questions'))}</div>`}<div id="dd26-question-preview"></div><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return to five-step review</button></div>`);
    renderQuestionPreview();
  }

  function openPublishedPreparationReview(snapshot) {
    const publication = snapshot?.publication;
    const rules = publication?.rules;
    if (!publication || !rules || typeof rules !== 'object') {
      openAuthoringBlockedDialog('Published rules unavailable', 'The server did not return the fixed published copy. Nothing can be changed.');
      return;
    }
    const exam = professorExam(snapshot.examId);
    const rows = [
      ['Published version', publication.publicationNumber || 'Published'],
      ['Schedule', `${formatDate(rules.opensAt)} to ${formatDate(rules.hardClosesAt)}`],
      ['Time allowed', `${rules.durationMinutes ?? '—'} minutes`],
      ['Late entry', `${rules.lateAdmissionMinutes ?? 0} minutes`],
      ['Reconnect and submission time', `${rules.submissionGraceMinutes ?? 0} minutes`],
      ['Allowed materials', rules.allowedMaterials || 'None stated'],
      ['Moving between questions', rules.navigationMode === 'one_way' ? 'Forward only' : 'Students may move between questions'],
      ['Leaving the exam tab', rules.integrityMode === 'warn_and_record' ? 'Warn and record' : 'Record for Professor review'],
      ['Student entry', rules.admissionMode === 'beadle_approval' ? 'Beadle approval' : 'Automatic after all checks'],
    ];
    const canReschedule = authoringCapability(snapshot, 'canReschedulePublication');
    const rescheduleControl = canReschedule
      ? '<button class="dd26-button primary dd26-reschedule-action" id="dd26-change-exam-time" type="button">Change exam time</button>'
      : `<div class="dd26-notice dd26-reschedule-blocker"><strong>Exam time cannot be changed here.</strong> ${escapeHtml(rescheduleBlockerCopy(snapshot))}</div>`;
    openDialog(`<div class="dd26-label">Step 3 · Rules and publication</div><h2>Review the published examination rules</h2><div class="dd26-notice"><strong>This is the fixed class copy.</strong> Review remains available at any time. Before opening and before any student starts, use a corrected version. Afterward, use a correction notice.</div><dl class="dd26-publish-summary">${rows.map(([label, copy]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(copy)}</dd></div>`).join('')}</dl>${canReschedule ? '' : rescheduleControl}<div class="dd26-actions">${canReschedule ? rescheduleControl : ''}${exam?.canReplacePublication === true ? '<button class="dd26-button danger" id="dd26-review-replace-publication" type="button">Prepare corrected version</button>' : ''}<button class="dd26-button" id="dd26-review-erratum" type="button">Send correction notice</button><button class="dd26-button" data-dd26-close-dialog type="button">Return to five-step review</button></div>`);
    document.getElementById('dd26-change-exam-time')?.addEventListener('click', () => openPublicationReschedule(snapshot));
    document.getElementById('dd26-review-replace-publication')?.addEventListener('click', () => beginReplacementPublication(snapshot.examId));
    document.getElementById('dd26-review-erratum')?.addEventListener('click', () => openErratum(snapshot.examId));
  }

  function rescheduleBlockerCopy(snapshot) {
    const code = String(snapshot?.blockers?.rescheduleBlocker || '').trim();
    const messages = {
      CANDIDATE_ATTEMPTS_EXIST: 'A student has already started, so the published exam time can no longer be changed here. Use a correction notice if the class needs an update.',
      RESULTS_SEALED: 'The grades have been finalized, so this examination record is closed.',
      RESULTS_RELEASED: 'Results have already been sent, so this examination record is closed.',
      NOT_PUBLISHED: 'Publish the examination before changing a published schedule.',
      EXAM_STATE_BLOCKED: 'This examination is not in a stage where its schedule can be changed.',
    };
    return messages[code]
      || 'The server has not authorized an exam-time change. Refresh the Examination Room, or use a correction notice if a student has already started.';
  }

  const RESCHEDULE_TERMINAL_FAILURE_CODES = new Set([
    'EXAM_ROOM_WORKSPACE_CONFLICT',
    'EXAM_ROOM_PUBLICATION_VERSION_CONFLICT',
    'EXAM_ROOM_RESCHEDULE_ATTEMPTS_EXIST',
    'EXAM_ROOM_RESCHEDULE_NOT_ALLOWED',
    'EXAM_ROOM_RESCHEDULE_PUBLICATION_INVALID',
  ]);

  function rescheduleFailureNeedsRefresh(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    return RESCHEDULE_TERMINAL_FAILURE_CODES.has(code)
      || RESCHEDULE_TERMINAL_FAILURE_CODES.has(`EXAM_ROOM_${code}`);
  }

  function rescheduleRetryIsSafe(error) {
    if (rescheduleFailureNeedsRefresh(error)) return false;
    return error?.code === 'EXAM_ROOM_PUBLISH_WAIT_TIMEOUT'
      || error?.code === 'EXAM_ROOM_RESCHEDULE_CONFIRMATION_INCOMPLETE'
      || Number(error?.status) >= 500
      || isTransientTransportFailure(error);
  }

  function discardPublicationRescheduleDraft(change) {
    if (!change || typeof change !== 'object') return;
    Object.keys(change).forEach((key) => { delete change[key]; });
  }

  function publicationRescheduleValidation(input = {}) {
    const errors = [];
    const add = (field, message) => errors.push({ field, message });
    const opensAt = manilaDateTime(input.opensAt);
    const hardClosesAt = manilaDateTime(input.hardClosesAt);
    if (!Number.isFinite(opensAt.getTime())) add('dd26-reschedule-opens-at', 'Choose the new opening date and time.');
    if (!Number.isFinite(hardClosesAt.getTime())) add('dd26-reschedule-closes-at', 'Choose the new ending date and time.');
    if (Number.isFinite(opensAt.getTime()) && Number.isFinite(hardClosesAt.getTime())
        && hardClosesAt <= opensAt) {
      add('dd26-reschedule-closes-at', 'The examination must end after it opens.');
    }
    const integer = (raw, field, label, minimum, maximum) => {
      const parsed = Number(raw);
      if (String(raw ?? '').trim() === '' || !Number.isSafeInteger(parsed)
          || parsed < minimum || parsed > maximum) {
        add(field, `${label} must be a whole number from ${minimum} to ${maximum}.`);
      }
      return parsed;
    };
    const durationMinutes = scheduledWindowMinutes(opensAt, hardClosesAt);
    if (Number.isSafeInteger(durationMinutes) && durationMinutes > 480) {
      add('dd26-reschedule-closes-at', 'The examination window cannot exceed 480 minutes.');
    }
    const lateAdmissionMinutes = integer(input.lateAdmissionMinutes, 'dd26-reschedule-late-admission', 'Late entry', 0, 480);
    const submissionGraceMinutes = integer(input.submissionGraceMinutes, 'dd26-reschedule-submission-grace', 'Reconnect and submission time', 0, 120);
    const reason = String(input.reason || '').trim();
    if (reason.length < 10 || reason.length > 1_000) {
      add('dd26-reschedule-reason', 'Give a short reason between 10 and 1,000 characters.');
    }
    return {
      errors,
      opensAt: Number.isFinite(opensAt.getTime()) ? opensAt.toISOString() : '',
      hardClosesAt: Number.isFinite(hardClosesAt.getTime()) ? hardClosesAt.toISOString() : '',
      durationMinutes: Number.isSafeInteger(durationMinutes) ? durationMinutes : 0,
      lateAdmissionMinutes,
      submissionGraceMinutes,
      reason,
    };
  }

  function showPublicationRescheduleErrors(errors) {
    const host = document.getElementById('dd26-reschedule-errors');
    document.querySelectorAll('#dd26-dialog-card [aria-invalid="true"]').forEach((field) => {
      field.removeAttribute('aria-invalid');
    });
    if (!host) return;
    host.hidden = errors.length === 0;
    host.innerHTML = errors.length
      ? `<strong>Correct these items before continuing:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`
      : '';
    if (!errors.length) return;
    const firstField = errors.find((error) => error.field)?.field;
    const target = firstField ? document.getElementById(firstField) : host;
    target?.setAttribute?.('aria-invalid', 'true');
    target?.focus?.();
  }

  function openPublicationReschedule(snapshot, draft = null) {
    const publication = snapshot?.publication;
    const rules = publication?.rules;
    if (!authoringCapability(snapshot, 'canReschedulePublication') || !publication?.publicationId
        || !rules || typeof rules !== 'object'
        || !Number.isSafeInteger(Number(snapshot.workspaceRevision))) {
      openAuthoringBlockedDialog('Exam time cannot be changed', rescheduleBlockerCopy(snapshot));
      return;
    }
    const saved = draft || rules;
    const opensAt = new Date(saved.opensAt);
    const hardClosesAt = new Date(saved.hardClosesAt);
    if (!Number.isFinite(opensAt.getTime()) || !Number.isFinite(hardClosesAt.getTime())) {
      openAuthoringBlockedDialog('Published schedule unavailable', 'The server did not return a complete published schedule. Refresh the Examination Room before trying again.');
      return;
    }
    const existingWindowMinutes = scheduledWindowMinutes(opensAt, hardClosesAt);
    const existingLateMinutes = Number(saved.lateAdmissionMinutes ?? 0);
    const entryUntilEnd = Number.isSafeInteger(existingWindowMinutes)
      && existingWindowMinutes <= 480 && existingLateMinutes >= existingWindowMinutes;
    openDialog(`<div class="dd26-label">Step 3 · Change exam time</div><h2>Set the updated examination schedule</h2><div class="dd26-notice"><strong>Only the exam time changes.</strong> Questions, the class list, Beadle access, and the student exam code stay with this examination.</div><div class="dd26-error" id="dd26-reschedule-errors" role="alert" tabindex="-1" hidden></div><div class="dd26-form-grid"><label class="dd26-field"><span>Exam opens</span><input class="dd26-input" id="dd26-reschedule-opens-at" type="datetime-local" value="${escapeHtml(localDateValue(opensAt))}" required><small class="dd26-help">Choose an immediate or future opening time.</small></label><label class="dd26-field"><span>Exam ends</span><input class="dd26-input" id="dd26-reschedule-closes-at" type="datetime-local" value="${escapeHtml(localDateValue(hardClosesAt))}" required></label><label class="dd26-field"><span>Time allowed in minutes</span><input class="dd26-input" id="dd26-reschedule-duration" type="number" min="1" max="480" step="1" value="${escapeHtml(saved.durationMinutes ?? '')}" required></label><label class="dd26-field wide"><span>When may a student start?</span><select class="dd26-select" id="dd26-reschedule-entry-window-mode"><option value="until_end" ${entryUntilEnd ? 'selected' : ''}>Allow entry until the exam ends</option><option value="custom" ${entryUntilEnd ? '' : 'selected'}>Close student entry earlier</option></select><small class="dd26-help">Your current Professor setting is kept unless you change this choice.</small></label><label class="dd26-field"><span>Minutes after opening when entry closes</span><input class="dd26-input" id="dd26-reschedule-late-admission" type="number" min="0" max="480" step="1" value="${escapeHtml(saved.lateAdmissionMinutes ?? 0)}" required><small class="dd26-help">Use a shorter time only when students who have not started should be blocked before the exam ends.</small></label><div class="dd26-notice" id="dd26-reschedule-entry-cutoff" role="status"></div><label class="dd26-field"><span>Extra time to reconnect and submit</span><input class="dd26-input" id="dd26-reschedule-submission-grace" type="number" min="0" max="120" step="1" value="${escapeHtml(saved.submissionGraceMinutes ?? 0)}" required></label><label class="dd26-field wide"><span>Reason for changing the time</span><textarea class="dd26-textarea compact" id="dd26-reschedule-reason" minlength="10" maxlength="1000" required>${escapeHtml(draft?.reason || '')}</textarea><small class="dd26-help">This reason becomes part of the examination record.</small></label></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-review-reschedule" type="button">Review time change</button><button class="dd26-button" id="dd26-cancel-reschedule" type="button">Return without changing</button></div>`);
    const rescheduleDuration = document.getElementById('dd26-reschedule-duration');
    const rescheduleOpensLabel = document.getElementById('dd26-reschedule-opens-at')?.closest('label')?.querySelector('span');
    const rescheduleClosesLabel = document.getElementById('dd26-reschedule-closes-at')?.closest('label')?.querySelector('span');
    if (rescheduleOpensLabel) rescheduleOpensLabel.textContent = 'Exam opens (Philippine Time)';
    if (rescheduleClosesLabel) rescheduleClosesLabel.textContent = 'Exam ends (Philippine Time)';
    if (rescheduleDuration) {
      rescheduleDuration.type = 'hidden';
      rescheduleDuration.removeAttribute('required');
      rescheduleDuration.value = String(existingWindowMinutes || '');
      rescheduleDuration.closest('label')?.querySelector('span')?.replaceChildren('Automatically calculated duration');
      rescheduleDuration.insertAdjacentHTML('beforebegin', `<output class="dd26-notice" id="dd26-reschedule-duration-display" for="dd26-reschedule-opens-at dd26-reschedule-closes-at">${Number.isSafeInteger(existingWindowMinutes) ? `${escapeHtml(existingWindowMinutes)} minutes` : 'Choose a valid opening and ending time'}</output>`);
      rescheduleDuration.insertAdjacentHTML('afterend', '<small class="dd26-help">Calculated from the opening and ending times in Philippine Time.</small>');
    }
    const entryMode = document.getElementById('dd26-reschedule-entry-window-mode');
    const lateEntry = document.getElementById('dd26-reschedule-late-admission');
    const preservedEarlierCutoff = entryUntilEnd ? '' : String(saved.lateAdmissionMinutes ?? 0);
    const updateRescheduleEntryCutoff = ({ restoreEarlier = false } = {}) => {
      const windowMinutes = scheduledWindowMinutes(
        value('dd26-reschedule-opens-at'),
        value('dd26-reschedule-closes-at'),
      );
      if (rescheduleDuration) rescheduleDuration.value = Number.isSafeInteger(windowMinutes) ? String(windowMinutes) : '';
      const durationDisplay = document.getElementById('dd26-reschedule-duration-display');
      if (durationDisplay) durationDisplay.textContent = Number.isSafeInteger(windowMinutes)
        ? `${windowMinutes} minutes` : 'Choose a valid opening and ending time';
      const untilEnd = entryMode?.value === 'until_end';
      if (untilEnd && Number.isSafeInteger(windowMinutes) && windowMinutes <= 480) {
        lateEntry.value = String(windowMinutes);
        lateEntry.readOnly = true;
      } else {
        lateEntry.readOnly = false;
        if (restoreEarlier) lateEntry.value = preservedEarlierCutoff;
      }
      const summary = document.getElementById('dd26-reschedule-entry-cutoff');
      const cutoff = entryClosesAtForSchedule(
        value('dd26-reschedule-opens-at'),
        value('dd26-reschedule-closes-at'),
        lateEntry.value,
      );
      if (summary) {
        summary.innerHTML = cutoff
          ? `<strong>Student entry closes ${escapeHtml(formatDate(cutoff))}.</strong> Students who already started keep their own examination deadline.`
          : '<strong>Choose a valid opening, ending, and entry time.</strong>';
      }
    };
    entryMode?.addEventListener('change', () => updateRescheduleEntryCutoff({
      restoreEarlier: entryMode.value === 'custom',
    }));
    ['dd26-reschedule-opens-at', 'dd26-reschedule-closes-at']
      .forEach((id) => document.getElementById(id)?.addEventListener('input', updateRescheduleEntryCutoff));
    lateEntry?.addEventListener('input', updateRescheduleEntryCutoff);
    updateRescheduleEntryCutoff();
    document.getElementById('dd26-review-reschedule')?.addEventListener('click', () => {
      const validation = publicationRescheduleValidation({
        opensAt: value('dd26-reschedule-opens-at'),
        hardClosesAt: value('dd26-reschedule-closes-at'),
        durationMinutes: value('dd26-reschedule-duration'),
        lateAdmissionMinutes: value('dd26-reschedule-late-admission'),
        submissionGraceMinutes: value('dd26-reschedule-submission-grace'),
        reason: value('dd26-reschedule-reason'),
      });
      showPublicationRescheduleErrors(validation.errors);
      if (!validation.errors.length) openPublicationRescheduleReview(snapshot, validation);
    });
    document.getElementById('dd26-cancel-reschedule')?.addEventListener('click', () => openPublishedPreparationReview(snapshot));
  }

  function openPublicationRescheduleReview(snapshot, change) {
    const current = snapshot.publication.rules;
    change.requestKey ||= randomKey('reschedule_publication');
    const rows = [
      ['Exam opens', formatDate(current.opensAt), formatDate(change.opensAt)],
      ['Exam ends', formatDate(current.hardClosesAt), formatDate(change.hardClosesAt)],
      ['Time allowed', `${current.durationMinutes ?? '—'} minutes`, `${change.durationMinutes} minutes`],
      ['Late entry', `${current.lateAdmissionMinutes ?? 0} minutes`, `${change.lateAdmissionMinutes} minutes`],
      ['Reconnect and submission time', `${current.submissionGraceMinutes ?? 0} minutes`, `${change.submissionGraceMinutes} minutes`],
    ];
    const entryCutoffReview = entryCutoffReviewHtml(
      change.opensAt,
      change.hardClosesAt,
      change.lateAdmissionMinutes,
    );
    openDialog(`<div class="dd26-label">Step 3 · Final review</div><h2>Confirm the updated exam time</h2><div class="dd26-reschedule-comparison" role="group" aria-label="Current and updated examination schedule"><div class="dd26-reschedule-comparison-head"><strong>Setting</strong><strong>Current</strong><strong>Updated</strong></div>${rows.map(([label, before, after]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(before)}</span><span>${escapeHtml(after)}</span></div>`).join('')}</div>${entryCutoffReview}<dl class="dd26-publish-summary"><div><dt>Reason</dt><dd>${escapeHtml(change.reason)}</dd></div></dl><div class="dd26-success"><strong>The examination content and class handoff stay in place.</strong> Questions, the class list, Beadle access, and the student exam code are not replaced by this time change.</div><div class="dd26-error" id="dd26-reschedule-save-error" role="alert" tabindex="-1" hidden></div><label class="dd26-choice"><input id="dd26-reschedule-ack" type="checkbox"><span><strong>I reviewed the updated schedule and student entry cutoff</strong><small>After saving, I will give both times to the Beadle and the class.</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-confirm-reschedule" type="button" disabled>Save updated exam time</button><button class="dd26-button primary" id="dd26-refresh-reschedule" type="button" hidden style="display:none">Refresh latest examination</button><button class="dd26-button" id="dd26-edit-reschedule" type="button">Back and edit</button><button class="dd26-button" id="dd26-abandon-reschedule" type="button">Return without changing</button></div>`);
    const acknowledgement = document.getElementById('dd26-reschedule-ack');
    const confirm = document.getElementById('dd26-confirm-reschedule');
    acknowledgement?.addEventListener('change', () => { confirm.disabled = !acknowledgement.checked; });
    confirm?.addEventListener('click', () => savePublicationReschedule(snapshot, change));
    document.getElementById('dd26-refresh-reschedule')?.addEventListener('click', () => refreshLatestPublicationAfterReschedule(snapshot.examId));
    document.getElementById('dd26-edit-reschedule')?.addEventListener('click', () => openPublicationReschedule(snapshot, change));
    document.getElementById('dd26-abandon-reschedule')?.addEventListener('click', () => openPublishedPreparationReview(snapshot));
  }

  function normalizeReschedulePublicationSuccess(result, expectedExamId) {
    const {
      ok, examId, publicationId, publicationNumber, workspaceRevision,
      opensAt, hardClosesAt, durationMinutes, lateAdmissionMinutes,
      submissionGraceMinutes, preserved,
    } = result || {};
    const normalized = {
      ok, examId, publicationId, publicationNumber, workspaceRevision,
      opensAt, hardClosesAt, durationMinutes, lateAdmissionMinutes,
      submissionGraceMinutes, preserved,
    };
    const opensAtMs = new Date(opensAt).getTime();
    const hardClosesAtMs = new Date(hardClosesAt).getTime();
    const validInteger = (entry, minimum, maximum) => Number.isSafeInteger(Number(entry))
      && Number(entry) >= minimum && Number(entry) <= maximum;
    if (ok !== true || examId !== expectedExamId || !String(publicationId || '').trim()
        || !Number.isSafeInteger(Number(publicationNumber)) || Number(publicationNumber) < 2
        || !Number.isSafeInteger(Number(workspaceRevision))
        || !Number.isFinite(opensAtMs) || !Number.isFinite(hardClosesAtMs) || hardClosesAtMs <= opensAtMs
        || !validInteger(durationMinutes, 1, 480)
        || !validInteger(lateAdmissionMinutes, 0, 480)
        || !validInteger(submissionGraceMinutes, 0, 120)) {
      throw new Error('The time change was not confirmed completely. Refresh the Examination Room before trying again.');
    }
    return normalized;
  }

  async function refreshLatestPublicationAfterReschedule(examId) {
    const refreshButton = document.getElementById('dd26-refresh-reschedule');
    const errorHost = document.getElementById('dd26-reschedule-save-error');
    if (!String(examId || '').trim() || refreshButton?.disabled) return;
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = 'Refreshing latest examination...';
    }
    state.exam.authoringSnapshots.delete(examId);
    try {
      const [latestSnapshot, portalRefreshed] = await Promise.all([
        withBoundedPublishWait(
          loadProfessorAuthoringSnapshot(examId),
          EXAMINATION_ROOM_REFRESH_WAIT_MS,
        ),
        withBoundedPublishWait(
          refreshPortalSilently(),
          EXAMINATION_ROOM_REFRESH_WAIT_MS,
        ).catch(() => false),
      ]);
      closeDialog();
      state.exam.section = 'professor';
      renderExamRoom();
      openPublishedPreparationReview(latestSnapshot);
      if (!portalRefreshed) {
        global.toast?.('The latest examination is open. The class summary may need another refresh.', 'warn');
      }
    } catch (error) {
      if (errorHost) {
        errorHost.hidden = false;
        errorHost.textContent = error.message || 'The latest examination could not be loaded. Try refreshing again.';
        errorHost.focus();
      }
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = 'Refresh latest examination';
      }
    }
  }

  async function savePublicationReschedule(snapshot, change) {
    if (!authoringCapability(snapshot, 'canReschedulePublication')) return;
    const button = document.getElementById('dd26-confirm-reschedule');
    const errorHost = document.getElementById('dd26-reschedule-save-error');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Saving updated time...'; }
    if (errorHost) { errorHost.hidden = true; errorHost.textContent = ''; }
    try {
      const result = await withBoundedPublishWait(command({
        operation: 'reschedule_publication',
        examId: snapshot.examId,
        expectedPublicationId: snapshot.publication.publicationId,
        expectedWorkspaceRevision: Number(snapshot.workspaceRevision),
        opensAt: change.opensAt,
        hardClosesAt: change.hardClosesAt,
        durationMinutes: change.durationMinutes,
        lateAdmissionMinutes: change.lateAdmissionMinutes,
        submissionGraceMinutes: change.submissionGraceMinutes,
        reason: change.reason,
        requestKey: change.requestKey,
      }));
      const confirmed = normalizeReschedulePublicationSuccess(result, snapshot.examId);
      state.exam.authoringSnapshots.delete(snapshot.examId);
      const [refreshedSnapshot, portalRefreshed] = await Promise.all([
        withBoundedPublishWait(
          loadProfessorAuthoringSnapshot(snapshot.examId),
          EXAMINATION_ROOM_REFRESH_WAIT_MS,
        ).catch(() => null),
        withBoundedPublishWait(
          refreshPortalSilently(),
          EXAMINATION_ROOM_REFRESH_WAIT_MS,
        ).catch(() => false),
      ]);
      if (refreshedSnapshot) state.exam.authoringSnapshots.set(snapshot.examId, refreshedSnapshot);
      renderExamRoom();
      openDialog(`<div class="dd26-label">Exam time updated</div><h2>The updated schedule is saved</h2><dl class="dd26-publish-summary"><div><dt>Exam opens</dt><dd>${escapeHtml(formatDate(confirmed.opensAt))}</dd></div><div><dt>Exam ends</dt><dd>${escapeHtml(formatDate(confirmed.hardClosesAt))}</dd></div><div><dt>Time allowed</dt><dd>${escapeHtml(confirmed.durationMinutes)} minutes</dd></div><div><dt>Late entry</dt><dd>${escapeHtml(confirmed.lateAdmissionMinutes)} minutes</dd></div><div><dt>Reconnect and submission time</dt><dd>${escapeHtml(confirmed.submissionGraceMinutes)} minutes</dd></div></dl><div class="dd26-success"><strong>Questions, the class list, Beadle access, and the student exam code are unchanged.</strong> Give the updated schedule to the Beadle and the class.</div>${refreshedSnapshot && portalRefreshed ? '' : '<div class="dd26-notice">The new schedule was saved, but this page could not refresh every detail. Return to the Examination Room and refresh before making another change.</div>'}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-return-after-reschedule" type="button">Return to Professor workspace</button></div>`);
      document.getElementById('dd26-return-after-reschedule')?.addEventListener('click', () => {
        closeDialog();
        state.exam.section = 'professor';
        renderExamRoom();
      });
      global.toast?.('Exam time updated. Give the new schedule to the class.', 'ok');
    } catch (error) {
      if (errorHost) {
        errorHost.hidden = false;
        errorHost.textContent = error.message || 'The exam time could not be changed.';
        errorHost.focus();
      }
      if (rescheduleRetryIsSafe(error)) {
        if (button) { button.disabled = false; button.textContent = 'Retry saving updated time'; }
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = 'Review required';
      }
      if (rescheduleFailureNeedsRefresh(error)) {
        discardPublicationRescheduleDraft(change);
        if (button) button.hidden = true;
        const acknowledgement = document.getElementById('dd26-reschedule-ack');
        const editButton = document.getElementById('dd26-edit-reschedule');
        const abandonButton = document.getElementById('dd26-abandon-reschedule');
        const refreshButton = document.getElementById('dd26-refresh-reschedule');
        if (acknowledgement) acknowledgement.disabled = true;
        if (editButton) editButton.hidden = true;
        if (abandonButton) abandonButton.hidden = true;
        if (refreshButton) {
          refreshButton.hidden = false;
          refreshButton.style.display = '';
        }
        if (errorHost) {
          errorHost.textContent = `${error.message || 'The examination changed while this form was open.'} Load the latest examination before making another change.`;
        }
      }
    }
  }

  function openQuestionUpload(examId, questionCount, uploadIntent = null) {
    state.exam.activeExamId = examId;
    state.exam.questionUploadIntent = uploadIntent?.mode === 'replacement'
      ? uploadIntent : { mode: 'initial' };
    const replacement = state.exam.questionUploadIntent.mode === 'replacement';
    openDialog(`<div class="dd26-label">Step 2 · Upload and review questions${replacement ? ' · corrected version' : ''}</div><h2>${replacement ? 'Prepare corrected replacement questions' : 'Prepare examination questions'}</h2>${replacement ? '<div class="dd26-notice"><strong>Safe staging:</strong> this creates a separate confirmed question version. It does not alter the currently published examination unless the later replacement publication succeeds.</div>' : ''}<p>Upload a PDF, DOCX, or UTF-8 TXT file, or paste formatted/plain text. Nothing is published automatically. PDF files that cannot be extracted safely fall back to manual construction.</p><label class="dd26-field"><span>Source file</span><input class="dd26-input" id="dd26-question-file" type="file" accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label><div class="dd26-divider" aria-hidden="true">or</div><label class="dd26-field"><span>Paste questions</span><textarea class="dd26-textarea compact" id="dd26-question-paste" maxlength="200000" placeholder="1. First question…&#10;&#10;2. Second question…"></textarea></label><input id="dd26-question-count" type="hidden" value="${questionCount}"><div class="dd26-actions"><button class="dd26-button primary" id="dd26-preview-questions" type="button">Open editable review</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div><div class="dd26-privacy">Encrypted or active-content PDFs are rejected. OCR, malware scanning, and direct Google Docs import are not claimed in this beta.</div><div id="dd26-question-preview"></div>`);
    document.getElementById('dd26-preview-questions')?.addEventListener('click', previewQuestions);
  }

  async function previewQuestions() {
    const file = document.getElementById('dd26-question-file')?.files?.[0];
    const pasted = value('dd26-question-paste', false).trim();
    const questionCount = Number(value('dd26-question-count'));
    if (!file && !pasted) { global.toast?.('Choose a PDF, TXT, or DOCX source, or paste the questions.', 'warn'); return; }
    try {
      const source = file
        ? await filePayload(file)
        : await filePayload(new File([pasted], 'pasted-examination.txt', { type: 'text/plain' }));
      const payload = await api('/exam-room/upload/questions', { examId: state.exam.activeExamId, questionCount, ...source });
      state.exam.questionPreview = payload.preview;
      renderQuestionPreview();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function renderQuestionPreview() {
    const preview = state.exam.questionPreview;
    const host = document.getElementById('dd26-question-preview');
    if (!host || !preview) return;
    const totalPoints = preview.questions.reduce((total, question) => total + (Number(question.maximumPoints) || 0), 0);
    const revision = state.exam.questionUploadIntent?.mode === 'revision';
    const controls = preview.readOnly
      ? ''
      : `<div class="dd26-actions"><button class="dd26-button" id="dd26-add-question" type="button">Add question manually</button><button class="dd26-button primary" id="dd26-confirm-questions" type="button">${revision ? 'Save revised questions' : 'Confirm review-ready version'}</button></div>`;
    host.innerHTML = `<div class="dd26-notice">${escapeHtml(preview.fileName)} · ${preview.questions.length} questions found, ${preview.questionCount} expected · <span id="dd26-question-total-points">${escapeHtml(totalPoints)}</span> total points</div>${preview.warnings?.length ? `<div class="dd26-error" role="alert">${preview.warnings.map(escapeHtml).join('<br>')}</div>` : ''}<div id="dd26-question-editors">${preview.questions.map((question, index) => questionEditor(question, index, preview.readOnly === true)).join('')}</div><details class="dd26-student-preview"><summary>Student preview</summary><div class="dd26-question-nav" aria-label="Preview question navigation">${preview.questions.map((_, index) => `<button class="dd26-chip" type="button" data-dd26-student-preview-nav="${index}" aria-label="Preview question ${index + 1}">${index + 1}</button>`).join('')}</div>${preview.questions.map((question, index) => `<section data-dd26-student-preview-question="${index}" tabindex="-1"><small>Question ${index + 1} · <span data-dd26-student-preview-points>${escapeHtml(question.maximumPoints ?? 5)}</span> points</small><p data-dd26-student-preview-prompt>${escapeHtml(question.prompt)}</p></section>`).join('') || '<p>Add questions manually to build the preview.</p>'}</details>${controls}`;
    document.getElementById('dd26-confirm-questions')?.closest('.dd26-actions')?.insertAdjacentHTML(
      'beforebegin',
      '<div class="dd26-error" id="dd26-question-review-errors" role="alert" tabindex="-1" hidden></div>',
    );
    bindQuestionEditors();
  }

  function questionEditor(question, index, readOnly = false) {
    const tools = readOnly ? '' : '<div class="dd26-question-editor-tools"><button class="dd26-button" data-dd26-question-up type="button">Up</button><button class="dd26-button" data-dd26-question-down type="button">Down</button><button class="dd26-button" data-dd26-question-split type="button">Split at cursor</button><button class="dd26-button" data-dd26-question-merge type="button">Merge above</button><button class="dd26-button danger" data-dd26-question-remove type="button">Remove</button></div>';
    return `<section class="dd26-question-editor${readOnly ? ' is-read-only' : ''}" data-dd26-question-index="${index}"><div class="dd26-question-editor-head"><strong>Question ${index + 1}</strong>${tools}</div><textarea class="dd26-textarea" data-dd26-question-prompt maxlength="50000" ${readOnly ? 'readonly' : ''}>${escapeHtml(question.prompt)}</textarea><label class="dd26-field"><span>Maximum points</span><input class="dd26-input" data-dd26-question-points type="number" min="0.1" max="1000" step="0.1" value="${escapeHtml(question.maximumPoints || 5)}" ${readOnly ? 'readonly' : ''}></label></section>`;
  }

  function collectQuestionEditors() {
    return [...document.querySelectorAll('[data-dd26-question-index]')].map((section, index) => ({
      ordinal: index + 1,
      prompt: section.querySelector('[data-dd26-question-prompt]').value,
      maximumPoints: Number(section.querySelector('[data-dd26-question-points]').value),
    }));
  }

  function updatePreviewQuestions(rows) {
    state.exam.questionPreview.questions = rows.map((row, index) => ({ ...row, ordinal: index + 1 }));
    state.exam.questionPreview.warnings = rows.length === state.exam.questionPreview.questionCount ? [] : [`Preview contains ${rows.length} questions; the professor selected ${state.exam.questionPreview.questionCount}.`];
    renderQuestionPreview();
  }

  function bindQuestionEditors() {
    document.getElementById('dd26-add-question')?.addEventListener('click', () => updatePreviewQuestions([...collectQuestionEditors(), { prompt: '', maximumPoints: 5 }]));
    document.getElementById('dd26-confirm-questions')?.addEventListener('click', confirmQuestions);
    document.querySelectorAll('[data-dd26-student-preview-nav]').forEach((button) => button.addEventListener('click', () => {
      const target = document.querySelector(`[data-dd26-student-preview-question="${button.dataset.dd26StudentPreviewNav}"]`);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      target?.focus?.({ preventScroll: true });
    }));
    document.querySelectorAll('[data-dd26-question-index]').forEach((section) => {
      const index = Number(section.dataset.dd26QuestionIndex);
      const synchronizeCurrentPreview = () => {
        const rows = collectQuestionEditors();
        state.exam.questionPreview.questions = rows.map((row, rowIndex) => ({ ...row, ordinal: rowIndex + 1 }));
        const studentPreview = document.querySelector(`[data-dd26-student-preview-question="${index}"]`);
        const row = rows[index];
        if (studentPreview && row) {
          const prompt = studentPreview.querySelector('[data-dd26-student-preview-prompt]');
          const points = studentPreview.querySelector('[data-dd26-student-preview-points]');
          if (prompt) prompt.textContent = row.prompt;
          if (points) points.textContent = Number.isFinite(row.maximumPoints) ? String(row.maximumPoints) : '—';
        }
        const total = rows.reduce((sum, entry) => sum + (Number(entry.maximumPoints) || 0), 0);
        const totalHost = document.getElementById('dd26-question-total-points');
        if (totalHost) totalHost.textContent = String(total);
      };
      section.querySelector('[data-dd26-question-prompt]')?.addEventListener('input', synchronizeCurrentPreview);
      section.querySelector('[data-dd26-question-points]')?.addEventListener('input', synchronizeCurrentPreview);
      section.querySelector('[data-dd26-question-up]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); if (index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-down]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); if (index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]]; updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-remove]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); rows.splice(index, 1); updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-merge]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); if (index < 1) return; rows[index - 1].prompt = `${rows[index - 1].prompt}\n\n${rows[index].prompt}`; rows.splice(index, 1); updatePreviewQuestions(rows); });
      section.querySelector('[data-dd26-question-split]')?.addEventListener('click', () => { const rows = collectQuestionEditors(); const area = section.querySelector('[data-dd26-question-prompt]'); const point = area.selectionStart; if (!point || point >= area.value.length) { global.toast?.('Place the text cursor where the question should split.', 'warn'); return; } const before = area.value.slice(0, point).trim(); const after = area.value.slice(point).trim(); if (!before || !after) return; rows.splice(index, 1, { ...rows[index], prompt: before }, { ...rows[index], prompt: after }); updatePreviewQuestions(rows); });
    });
  }

  function questionReviewValidation(questions, expectedCount) {
    const errors = [];
    const expected = Number(expectedCount);
    if (!Number.isSafeInteger(expected) || expected < 1 || expected > 200) {
      errors.push({ index: null, field: 'prompt', message: 'The expected question count is unavailable. Return and reopen the question upload.' });
    } else if (questions.length !== expected) {
      errors.push({ index: null, field: 'prompt', message: `Exactly ${expected} questions must be reviewed. There are currently ${questions.length}.` });
    }
    questions.forEach((question, index) => {
      const prompt = String(question.prompt || '');
      if (!prompt.trim()) {
        errors.push({ index, field: 'prompt', message: `Question ${index + 1} needs question text.` });
      } else if (codePointLength(prompt) > 50_000) {
        errors.push({ index, field: 'prompt', message: `Question ${index + 1} must be 50,000 characters or fewer.` });
      }
      const points = Number(question.maximumPoints);
      if (!Number.isFinite(points) || points <= 0 || points > 1_000) {
        errors.push({ index, field: 'points', message: `Question ${index + 1} points must be greater than 0 and no more than 1,000.` });
      }
    });
    return errors;
  }

  function showQuestionReviewErrors(errors) {
    const host = document.getElementById('dd26-question-review-errors');
    if (!host) return;
    document.getElementById('dd26-question-editors')?.querySelectorAll('[aria-invalid="true"]')
      .forEach((field) => field.removeAttribute('aria-invalid'));
    host.hidden = errors.length === 0;
    host.innerHTML = errors.length
      ? `<strong>Correct these questions before continuing:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`
      : '';
    if (!errors.length) return;
    const first = errors.find((error) => Number.isInteger(error.index));
    const section = first ? document.querySelector(`[data-dd26-question-index="${first.index}"]`) : null;
    const target = first?.field === 'points'
      ? section?.querySelector('[data-dd26-question-points]')
      : section?.querySelector('[data-dd26-question-prompt]');
    (target || host)?.setAttribute?.('aria-invalid', 'true');
    (target || host)?.focus?.();
  }

  async function confirmQuestions() {
    const preview = state.exam.questionPreview;
    const questions = collectQuestionEditors();
    const errors = questionReviewValidation(questions, preview.questionCount);
    showQuestionReviewErrors(errors);
    if (errors.length) {
      global.toast?.('Correct the highlighted questions before continuing.', 'warn');
      return;
    }
    const uploadIntent = state.exam.questionUploadIntent || { mode: 'initial' };
    const replacement = uploadIntent.mode === 'replacement';
    const revision = uploadIntent.mode === 'revision';
    const button = document.getElementById('dd26-confirm-questions');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Confirming questions…'; }
    try {
      const result = await command(revision ? {
        operation: 'revise_draft_questions',
        examId: preview.examId,
        expectedRevision: Number(uploadIntent.expectedRevision),
        expectedQuestionVersionId: uploadIntent.expectedQuestionVersionId,
        questions,
        requestKey: uploadIntent.questionRequestKey ||= randomKey('question_revision'),
      } : {
        operation: replacement ? 'confirm_replacement_questions' : 'confirm_questions',
        examId: preview.examId,
        ...(replacement ? {
          expectedPublicationId: uploadIntent.expectedPublicationId,
          requestKey: uploadIntent.questionRequestKey ||= randomKey('replacement_questions'),
        } : {}),
        objectPath: preview.objectPath,
        fileName: preview.fileName,
        mimeType: preview.mimeType,
        sizeBytes: preview.sizeBytes,
        pageCount: preview.pageCount,
        contentHash: preview.contentHash,
        questionCount: questions.length,
        questions,
        warnings: [],
      });
      if (replacement && (result?.ok !== true || result.staged !== true
          || !result.replacementQuestionVersionId
          || result.expectedPublicationId !== uploadIntent.expectedPublicationId)) {
        throw new Error('The server did not confirm a safely staged replacement question version.');
      }
      if (replacement) {
        closeDialog();
        global.toast?.('Corrected questions staged separately; the live publication is unchanged.', 'ok');
        openSchedule(preview.examId, {
          ...uploadIntent,
          replacementQuestionVersionId: result.replacementQuestionVersionId,
          replacementQuestionVersionNumber: result.questionVersionNumber,
          replacementQuestionSnapshotHash: result.snapshotHash,
        });
      } else if (revision) {
        state.exam.authoringSnapshots.delete(preview.examId);
        await loadProfessorAuthoringSnapshot(preview.examId).catch(() => null);
        closeDialog();
        global.toast?.('Revised questions saved as the latest reviewed version.', 'ok');
        await refreshExamPortal('professor').catch(() => {
          global.toast?.('The revised questions were saved, but the workspace could not refresh. Refresh the Examination Room before making another change.', 'warn');
        });
      } else {
        state.exam.authoringSnapshots.delete(preview.examId);
        await loadProfessorAuthoringSnapshot(preview.examId).catch(() => null);
        closeDialog();
        global.toast?.('Question version confirmed and ready for the rules step.', 'ok');
        await refreshExamPortal('professor').catch(() => {
          global.toast?.('The questions were confirmed, but the workspace could not refresh. Refresh the Examination Room before making another change.', 'warn');
        });
      }
    } catch (error) {
      showQuestionReviewErrors([{ index: null, field: 'prompt', message: error.message || 'The questions could not be confirmed. Review them and try again.' }]);
      global.toast?.(error.message, 'warn');
      if (button) { button.disabled = false; button.textContent = revision ? 'Save revised questions' : 'Confirm review-ready version'; }
    }
  }

  async function beginReplacementPublication(examId) {
    state.exam.activeExamId = examId;
    try {
      const payload = await api('/exam-room/query', { operation: 'exam_intent', examId });
      const intent = payload.result || {};
      if (intent.roles?.professor !== true || intent.canReplacePublication !== true
          || intent.canUploadReplacementQuestions !== true
          || !intent.currentPublicationId) {
        const reason = intent.replaceBlockedReason
          || 'The server did not confirm that this publication is still before opening with zero candidate attempts.';
        openDialog(`<div class="dd26-label">Corrected exam blocked</div><h2>The current exam cannot be replaced</h2><div class="dd26-error" role="alert">${escapeHtml(reason)}</div><p>Nothing was changed. If a student has already started, send a correction or stop notice. Otherwise, refresh and review the corrected questions again.</p><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return</button></div>`);
        return;
      }
      openDialog(`<div class="dd26-label">Before the exam opens</div><h2>Prepare a corrected exam?</h2><div class="dd26-error" role="alert"><strong>This is allowed only before the exam opens and before any student starts.</strong> The current exam remains unchanged unless the corrected version is fully reviewed and published.</div><p>You will upload the corrected questions, review them, and publish again. The earlier copy remains saved for the school record, and the earlier exam codes will stop working only after the replacement succeeds.</p><label class="dd26-field"><span>Reason for the correction</span><textarea class="dd26-textarea compact" id="dd26-replacement-reason" minlength="20" maxlength="1000" required></textarea></label><label class="dd26-choice"><input id="dd26-replacement-ack" type="checkbox"><span><strong>I intend to replace published version ${escapeHtml(intent.publicationNumber || intent.currentPublicationId)}</strong><small>I understand that the earlier copy stays on record and new exam codes will be created.</small></span></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-continue-replacement" type="button" disabled>Upload corrected questions</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
      const acknowledgement = document.getElementById('dd26-replacement-ack');
      const continueButton = document.getElementById('dd26-continue-replacement');
      const updateState = () => {
        continueButton.disabled = !acknowledgement.checked
          || value('dd26-replacement-reason').length < 20;
      };
      acknowledgement?.addEventListener('change', updateState);
      document.getElementById('dd26-replacement-reason')?.addEventListener('input', updateState);
      continueButton?.addEventListener('click', () => {
        const reason = value('dd26-replacement-reason');
        if (!acknowledgement.checked || reason.length < 20) return;
        const exam = (state.exam.portal?.classes || [])
          .flatMap((classroom) => classroom.exams || [])
          .find((entry) => entry.examId === examId);
        const questionCount = Number(exam?.questionCount);
        if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 200) {
          global.toast?.('The server did not provide the examination question count. Refresh before staging a replacement.', 'warn');
          return;
        }
        openQuestionUpload(examId, questionCount, {
          mode: 'replacement',
          expectedPublicationId: intent.currentPublicationId,
          publicationNumber: intent.publicationNumber,
          reason,
        });
      });
    } catch (error) {
      openDialog(`<div class="dd26-label">Replacement publication unavailable</div><h2>The eligibility check failed closed</h2><div class="dd26-error" role="alert">${escapeHtml(error.message || 'The server did not authorize a replacement check.')}</div><p>No publication or credential was changed. Refresh and try again, or use an erratum if any candidate has started.</p><div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return</button></div>`);
    }
  }

  function publishStepValidation(input = {}) {
    const errors = [];
    const add = (field, message) => errors.push({ field, message });
    const opensAt = manilaDateTime(input.opensAt);
    const hardClosesAt = manilaDateTime(input.hardClosesAt);
    if (!Number.isFinite(opensAt.getTime())) add('dd26-opens-at', 'Choose when the examination opens.');
    if (!Number.isFinite(hardClosesAt.getTime())) add('dd26-closes-at', 'Choose when the examination ends.');
    if (Number.isFinite(opensAt.getTime()) && Number.isFinite(hardClosesAt.getTime())
        && hardClosesAt <= opensAt) {
      add('dd26-closes-at', 'The examination must end after it opens.');
    }
    if (Number.isFinite(hardClosesAt.getTime()) && hardClosesAt.getTime() <= Number(input.nowMs || Date.now())) {
      add('dd26-closes-at', 'Choose an examination end time that is still in the future.');
    }
    const integer = (raw, field, label, minimum, maximum) => {
      const parsed = Number(raw);
      if (String(raw ?? '').trim() === '' || !Number.isSafeInteger(parsed)
          || parsed < minimum || parsed > maximum) {
        add(field, `${label} must be a whole number from ${minimum} to ${maximum}.`);
      }
      return parsed;
    };
    const durationMinutes = scheduledWindowMinutes(opensAt, hardClosesAt);
    if (Number.isSafeInteger(durationMinutes) && durationMinutes > 480) {
      add('dd26-closes-at', 'The examination window cannot exceed 480 minutes.');
    }
    const lateAdmissionMinutes = integer(input.lateAdmissionMinutes, 'dd26-late-admission', 'Late entry', 0, 480);
    const submissionGraceMinutes = integer(input.submissionGraceMinutes, 'dd26-submission-grace', 'Reconnect and submission time', 0, 120);
    if (String(input.allowedMaterials ?? '').length > 2_000) {
      add('dd26-allowed-materials', 'Allowed materials must be 2,000 characters or fewer.');
    }
    if (!['none', 'paste'].includes(String(input.suggestedAnswerMode || ''))) {
      add('dd26-model-answer-mode', 'Choose no suggested answer or paste a suggested answer.');
    } else if (input.suggestedAnswerMode === 'paste' && !String(input.suggestedAnswer || '').trim()) {
      add('dd26-model-answer', 'Paste the suggested answer, or choose None.');
    }
    const beadleEmail = String(input.beadleEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(beadleEmail) || beadleEmail.length > 254) {
      add('dd26-publish-beadle-email', 'Enter the Beadle’s complete account email.');
    }
    const exam = input.exam;
    const replacement = input.replacement === true;
    if (!exam) {
      add(null, 'The examination record is unavailable. Return to the Examination Room and refresh it.');
    } else {
      if (exam.publicationStateKnown !== true) {
        add(null, 'The latest publication status could not be confirmed. Return and refresh the Examination Room.');
      }
      const status = String(exam.status || '').toLowerCase();
      if (replacement) {
        if (status !== 'scheduled' || !exam.currentPublicationId) {
          add(null, 'This published examination is no longer eligible for replacement. Return and refresh it.');
        }
      } else if (!['confirmed', 'scheduled'].includes(status)) {
        add(null, 'Upload, review, and confirm every question before setting the exam rules.');
      } else if (!replacement && exam.canPublish !== true) {
        add(null, (exam.publishBlockers || []).join(' ')
          || 'Due Diligence has not confirmed that this examination is ready to publish. Return and refresh the Examination Room.');
      }
      const questionCount = Number(exam.questionCount);
      if (!Number.isSafeInteger(questionCount) || questionCount < 1 || questionCount > 200) {
        add(null, 'The confirmed question count is unavailable. Return and complete the question review.');
      }
    }
    return {
      errors,
      opensAt,
      hardClosesAt,
      durationMinutes: Number.isSafeInteger(durationMinutes) ? durationMinutes : 0,
      lateAdmissionMinutes,
      submissionGraceMinutes,
      beadleEmail,
    };
  }

  function showPublishStepErrors(errors) {
    const host = document.getElementById('dd26-publish-rule-errors');
    document.querySelectorAll('#dd26-dialog-card [aria-invalid="true"]').forEach((field) => {
      field.removeAttribute('aria-invalid');
    });
    if (!host) return;
    host.hidden = errors.length === 0;
    host.innerHTML = errors.length
      ? `<strong>Correct these items before continuing:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`
      : '';
    if (!errors.length) return;
    const firstField = errors.find((error) => error.field)?.field;
    const target = firstField ? document.getElementById(firstField) : host;
    target?.setAttribute?.('aria-invalid', 'true');
    target?.focus?.();
  }

  function openSchedule(examId, publicationIntent = null, authoringSnapshot = null) {
    state.exam.activeExamId = examId;
    state.exam.publishIntent = publicationIntent?.mode === 'replacement'
      ? publicationIntent
      : { mode: 'initial' };
    const replacement = state.exam.publishIntent.mode === 'replacement';
    if (!replacement && (!authoringSnapshot
        || authoringSnapshot.examId !== examId
        || !authoringCapability(authoringSnapshot, 'canEditRules'))) {
      openAuthoringBlockedDialog('Rules and publication', authoringBlockedCopy(authoringSnapshot, 'rules'));
      return;
    }
    state.exam.rulesAuthoringSnapshot = authoringSnapshot;
    const storedDraft = !replacement && authoringSnapshot?.rulesDraft?.rules
      && typeof authoringSnapshot.rulesDraft.rules === 'object'
      ? authoringSnapshot.rulesDraft : null;
    const saved = storedDraft?.rules || {};
    const defaultOpen = new Date();
    const savedOpen = new Date(saved.opensAt || '');
    const now = Number.isFinite(savedOpen.getTime()) ? savedOpen : defaultOpen;
    const savedClose = new Date(saved.hardClosesAt || '');
    const close = Number.isFinite(savedClose.getTime())
      ? savedClose : new Date(now.getTime() + 2 * 3600000);
    const durationValue = scheduledWindowMinutes(now, close) || 120;
    const lateAdmissionWasChosen = saved.lateAdmissionMinutes != null
      && String(saved.lateAdmissionMinutes).trim() !== '';
    const lateAdmissionValue = lateAdmissionWasChosen
      ? Number(saved.lateAdmissionMinutes) : durationValue;
    const selected = (value, expected, fallback = false) => (
      String(value ?? (fallback ? expected : '')) === expected ? 'selected' : ''
    );
    const replacementNotice = state.exam.publishIntent.mode === 'replacement'
      ? `<div class="dd26-error" role="alert"><strong>Replacement exam in progress.</strong> You are preparing a corrected version to replace version ${escapeHtml(state.exam.publishIntent.publicationNumber || 'currently published')}. Due Diligence will confirm that no student has started before accepting it.</div>`
      : '';
    openDialog(`<div class="dd26-label">Step 3 · Set exam rules${replacement ? ' / replacement' : ''}</div><h2>Set the schedule and exam rules</h2>${replacementNotice}${storedDraft ? `<div class="dd26-success">Your saved rules draft from ${escapeHtml(formatDate(storedDraft.updatedAt))} is open for further review.</div>` : '<div class="dd26-notice"><strong>Open now or schedule ahead.</strong> The examination may open immediately. Student access still requires the Beadle class list and class code.</div>'}<div class="dd26-form-grid"><label class="dd26-field"><span>Exam opens</span><input class="dd26-input" id="dd26-opens-at" type="datetime-local" value="${localDateValue(now)}"><small class="dd26-help">Choose an immediate or future opening time.</small></label><label class="dd26-field"><span>Exam ends</span><input class="dd26-input" id="dd26-closes-at" type="datetime-local" value="${localDateValue(close)}"></label><label class="dd26-field"><span>Time allowed in minutes</span><input class="dd26-input" id="dd26-duration" type="number" min="1" max="480" value="${escapeHtml(saved.durationMinutes ?? 120)}"></label><label class="dd26-field"><span>Late entry allowed (minutes)</span><input class="dd26-input" id="dd26-late-admission" type="number" min="0" max="480" value="${escapeHtml(saved.lateAdmissionMinutes ?? 15)}"><small class="dd26-help">Late entry does not extend the published exam end time.</small></label><label class="dd26-field"><span>Extra time to reconnect and submit</span><input class="dd26-input" id="dd26-submission-grace" type="number" min="0" max="120" value="${escapeHtml(saved.submissionGraceMinutes ?? 15)}"><small class="dd26-help">Answers written after the exam ends are kept separately for review and are not silently added to the submitted answers.</small></label><label class="dd26-field"><span>Allowed materials</span><input class="dd26-input" id="dd26-allowed-materials" maxlength="2000" value="${escapeHtml(saved.allowedMaterials ?? 'Professor-published materials only')}"></label><label class="dd26-field"><span>Moving between questions</span><select class="dd26-select" id="dd26-navigation-mode"><option value="free" ${selected(saved.navigationMode, 'free', true)}>Students may move between questions</option><option value="one_way" ${selected(saved.navigationMode, 'one_way')}>Move forward only</option></select></label><label class="dd26-field"><span>If a student leaves the exam tab</span><select class="dd26-select" id="dd26-monitoring-mode"><option value="record_only" ${selected(saved.integrityMode, 'record_only', true)}>Record for Professor review</option><option value="warn_and_record" ${selected(saved.integrityMode, 'warn_and_record')}>Warn the student and record</option></select><small class="dd26-help">Copy, cut, paste, and right-click are blocked during the monitored exam. A recorded event is never an automatic failure.</small></label><label class="dd26-field"><span>Full screen</span><select class="dd26-select" id="dd26-fullscreen-policy"><option value="requested" ${selected(saved.fullscreenPolicy, 'requested', true)}>Ask students to use full screen</option><option value="off" ${selected(saved.fullscreenPolicy, 'off')}>Do not ask for full screen</option><option value="required_with_exemptions" ${selected(saved.fullscreenPolicy, 'required_with_exemptions')}>Require full screen, with approved exemptions</option></select></label><label class="dd26-field"><span>Student entry</span><select class="dd26-select" id="dd26-admission-mode"><option value="automatic" selected>Allow after sign-in, code, and class-list checks</option></select><small class="dd26-help">The Beadle does not approve students one by one.</small></label><label class="dd26-field"><span>Temporary leave</span><select class="dd26-select" id="dd26-leave-policy"><option value="false" selected>Student records leaving and returning</option></select><small class="dd26-help">The event is recorded for Professor review; no Beadle acknowledgment is required.</small></label><label class="dd26-field"><span>Suggested answer for grading</span><select class="dd26-select" id="dd26-model-answer-mode"><option value="none" ${selected(saved.suggestedAnswerMode, 'none', true)}>None</option><option value="paste" ${selected(saved.suggestedAnswerMode, 'paste')}>Paste before publishing</option><option value="upload">Upload a private source</option></select></label></div><label class="dd26-choice"><input id="dd26-student-access-code-required" type="checkbox" checked><span><strong>Require the class examination code</strong><small>This is an extra check. Every student must still sign in with the exact class-list account and meet the entry rules.</small></span></label><label class="dd26-field" id="dd26-model-answer-field" ${saved.suggestedAnswerMode === 'paste' ? '' : 'hidden'}><span>Suggested answer for grading</span><textarea class="dd26-textarea" id="dd26-model-answer" maxlength="100000">${escapeHtml(saved.suggestedAnswer || '')}</textarea></label><label class="dd26-field" id="dd26-model-answer-upload-field" hidden><span>Private suggested-answer source</span><input class="dd26-input" id="dd26-model-answer-file" type="file" accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><small class="dd26-help">TXT, DOCX, or an inactive unencrypted PDF, maximum 10 MB. Students never receive this file.</small></label><details class="dd26-advanced"><summary>More about exam safeguards</summary><p>Leaving the tab or exam window is recorded for the Professor to review. Copy, cut, paste, and right-click are blocked during the exam unless an approved accommodation requires otherwise. These records are not proof by themselves and never automatically fail, submit, close, or erase an examination. Camera collection and AI grading are off.</p></details><div class="dd26-actions"><button class="dd26-button primary" id="dd26-review-publish" type="button">Review before publishing</button>${replacement ? '' : '<button class="dd26-button" id="dd26-save-rules-draft" type="button">Save draft and return</button>'}<button class="dd26-button" data-dd26-close-dialog type="button">Return without saving</button></div>`);
    const durationField = document.getElementById('dd26-duration');
    const lateAdmissionField = document.getElementById('dd26-late-admission');
    const opensLabel = document.getElementById('dd26-opens-at')?.closest('label')?.querySelector('span');
    const closesLabel = document.getElementById('dd26-closes-at')?.closest('label')?.querySelector('span');
    if (opensLabel) opensLabel.textContent = 'Exam opens (Philippine Time)';
    if (closesLabel) closesLabel.textContent = 'Exam ends (Philippine Time)';
    if (durationField) {
      durationField.value = String(durationValue);
      durationField.type = 'hidden';
      durationField.removeAttribute('required');
      durationField.closest('label')?.querySelector('span')?.replaceChildren('Automatically calculated duration');
      durationField.insertAdjacentHTML('beforebegin', `<output class="dd26-notice" id="dd26-duration-display" for="dd26-opens-at dd26-closes-at">${escapeHtml(durationValue)} minutes</output>`);
      const help = durationField.closest('label')?.querySelector('small');
      if (help) help.textContent = 'Calculated from the opening and ending times in Philippine Time.';
      else durationField.insertAdjacentHTML('afterend', '<small class="dd26-help">Calculated from the opening and ending times in Philippine Time.</small>');
    }
    if (lateAdmissionField) {
      lateAdmissionField.value = String(lateAdmissionValue);
      const lateAdmissionLabel = lateAdmissionField.closest('label');
      const labelText = lateAdmissionLabel?.querySelector('span');
      const helpText = lateAdmissionLabel?.querySelector('small');
      if (labelText) labelText.textContent = 'Minutes after opening when student entry closes';
      if (helpText) helpText.textContent = 'This starts at the full exam duration. Enter a shorter time only if students who have not started should be blocked before the exam ends.';
      lateAdmissionLabel?.insertAdjacentHTML('afterend', '<div class="dd26-notice" id="dd26-entry-cutoff-preview" role="status"></div>');
    }
    let lateAdmissionUntouched = !lateAdmissionWasChosen;
    const updateDraftEntryCutoff = () => {
      const windowMinutes = scheduledWindowMinutes(value('dd26-opens-at'), value('dd26-closes-at'));
      if (durationField) durationField.value = Number.isSafeInteger(windowMinutes) ? String(windowMinutes) : '';
      const durationDisplay = document.getElementById('dd26-duration-display');
      if (durationDisplay) durationDisplay.textContent = Number.isSafeInteger(windowMinutes)
        ? `${windowMinutes} minutes` : 'Choose a valid opening and ending time';
      if (lateAdmissionUntouched && lateAdmissionField && Number.isSafeInteger(windowMinutes)) {
        lateAdmissionField.value = String(windowMinutes);
      }
      const cutoff = entryClosesAtForSchedule(
        value('dd26-opens-at'), value('dd26-closes-at'), lateAdmissionField?.value,
      );
      const preview = document.getElementById('dd26-entry-cutoff-preview');
      if (preview) preview.innerHTML = cutoff
        ? `<strong>Student entry closes ${escapeHtml(formatDate(cutoff))}.</strong> Students who already started keep their own examination deadline.`
        : '<strong>Choose a valid opening, ending, and entry time.</strong>';
    };
    lateAdmissionField?.addEventListener('input', () => {
      lateAdmissionUntouched = false;
      updateDraftEntryCutoff();
    });
    ['dd26-opens-at', 'dd26-closes-at']
      .forEach((id) => document.getElementById(id)?.addEventListener('input', updateDraftEntryCutoff));
    updateDraftEntryCutoff();
    document.querySelector('#dd26-dialog-card .dd26-actions')?.insertAdjacentHTML(
      'beforebegin',
      '<div class="dd26-error" id="dd26-publish-rule-errors" role="alert" tabindex="-1" hidden></div>',
    );
    ['dd26-opens-at', 'dd26-closes-at', 'dd26-late-admission', 'dd26-submission-grace']
      .forEach((id) => document.getElementById(id)?.setAttribute('required', ''));
    document.getElementById('dd26-student-access-code-required')?.closest('label')?.remove();
    document.querySelector('#dd26-dialog-card .dd26-advanced')?.insertAdjacentHTML(
      'beforebegin',
      `<section class="dd26-section"><div class="dd26-label">Beadle handoff</div><h3>Who will prepare the class list?</h3><label class="dd26-field"><span>Beadle account email</span><input class="dd26-input" id="dd26-publish-beadle-email" type="email" autocomplete="email" maxlength="254" required value="${escapeHtml(storedDraft?.beadleEmail || '')}"><small class="dd26-help">After publication, the Professor receives one Beadle invitation key for this exact account. The Beadle then uploads the class list and prepares the student handout.</small></label></section>`,
    );
    const oneWayOption = document.querySelector('#dd26-navigation-mode option[value="one_way"]');
    if (oneWayOption) {
      oneWayOption.disabled = true;
      oneWayOption.textContent = 'One-way navigation — unavailable until durable reload enforcement is verified';
    }
    const modelAnswerUploadOption = document.querySelector('#dd26-model-answer-mode option[value="upload"]');
    if (modelAnswerUploadOption) {
      modelAnswerUploadOption.disabled = true;
      modelAnswerUploadOption.textContent = 'Upload — unavailable until owner-only retrieval is verified';
    }
    document.getElementById('dd26-model-answer-mode')?.addEventListener('change', (event) => {
      document.getElementById('dd26-model-answer-field').hidden = event.target.value !== 'paste';
      document.getElementById('dd26-model-answer-upload-field').hidden = event.target.value !== 'upload';
    });
    document.getElementById('dd26-review-publish')?.addEventListener('click', reviewPublish);
    document.getElementById('dd26-save-rules-draft')?.addEventListener('click', saveRulesDraft);
  }

  function collectRulesForm() {
    const suggestedAnswerMode = value('dd26-model-answer-mode');
    const suggestedAnswerFile = document.getElementById('dd26-model-answer-file')?.files?.[0] || null;
    const exam = professorExam(state.exam.activeExamId);
    const validation = publishStepValidation({
      opensAt: value('dd26-opens-at'),
      hardClosesAt: value('dd26-closes-at'),
      durationMinutes: value('dd26-duration'),
      lateAdmissionMinutes: value('dd26-late-admission'),
      submissionGraceMinutes: value('dd26-submission-grace'),
      allowedMaterials: value('dd26-allowed-materials', false),
      suggestedAnswerMode,
      suggestedAnswer: value('dd26-model-answer', false),
      beadleEmail: value('dd26-publish-beadle-email'),
      exam,
      replacement: state.exam.publishIntent?.mode === 'replacement',
    });
    if (validation.errors.length) return { validation, exam, suggestedAnswerFile };
    const {
      opensAt, hardClosesAt, durationMinutes,
      lateAdmissionMinutes, submissionGraceMinutes, beadleEmail,
    } = validation;
    return {
      validation,
      exam,
      suggestedAnswerFile,
      beadleEmail,
      rules: {
        opensAt: opensAt.toISOString(),
        hardClosesAt: hardClosesAt.toISOString(),
        durationMinutes,
        lateAdmissionMinutes,
        submissionGraceMinutes,
        allowedMaterials: value('dd26-allowed-materials', false),
        navigationMode: value('dd26-navigation-mode'),
        integrityMode: value('dd26-monitoring-mode'),
        fullscreenPolicy: value('dd26-fullscreen-policy'),
        admissionMode: value('dd26-admission-mode'),
        temporaryLeaveAcknowledgment: value('dd26-leave-policy') === 'true',
        studentAccessCodeRequired: true,
        suggestedAnswerMode,
        suggestedAnswer: suggestedAnswerMode === 'paste' ? value('dd26-model-answer', false) : null,
        suggestedAnswerObjectPath: null,
        aiGradingEnabled: false,
      },
    };
  }

  async function saveRulesDraft() {
    const snapshot = state.exam.rulesAuthoringSnapshot;
    if (!snapshot || !authoringCapability(snapshot, 'canEditRules')) return;
    const form = collectRulesForm();
    showPublishStepErrors(form.validation.errors);
    if (form.validation.errors.length) {
      global.toast?.('Correct the highlighted rules before saving this draft.', 'warn');
      return;
    }
    const button = document.getElementById('dd26-save-rules-draft');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Saving draft…'; }
    try {
      await command({
        operation: 'save_rules_draft',
        examId: snapshot.examId,
        expectedRevision: Number(snapshot.workspaceRevision),
        rules: form.rules,
        beadleEmail: form.beadleEmail,
        requestKey: randomKey('rules_draft'),
      });
      state.exam.authoringSnapshots.delete(snapshot.examId);
      await loadProfessorAuthoringSnapshot(snapshot.examId).catch(() => null);
      closeDialog();
      global.toast?.('Exam rules draft saved. You can return and change it again before publication.', 'ok');
      await refreshExamPortal('professor').catch(() => {
        global.toast?.('The rules draft was saved, but the workspace could not refresh. Refresh the Examination Room before making another change.', 'warn');
      });
    } catch (error) {
      showPublishStepErrors([{ field: null, message: error.message || 'The rules draft could not be saved.' }]);
      if (button) { button.disabled = false; button.textContent = 'Save draft and return'; }
    }
  }

  async function reviewPublish() {
    if (state.exam.publishIntent?.mode === 'replacement'
        && !state.exam.publishIntent.replacementQuestionVersionId) {
      showPublishStepErrors([{
        field: null,
        message: 'Return and complete the corrected-question review before replacing the publication.',
      }]);
      return;
    }
    const suggestedAnswerMode = value('dd26-model-answer-mode');
    const suggestedAnswerFile = document.getElementById('dd26-model-answer-file')?.files?.[0] || null;
    const exam = (state.exam.portal?.classes || [])
      .flatMap((classroom) => classroom.exams || [])
      .find((entry) => entry.examId === state.exam.activeExamId) || null;
    const validation = publishStepValidation({
      opensAt: value('dd26-opens-at'),
      hardClosesAt: value('dd26-closes-at'),
      durationMinutes: value('dd26-duration'),
      lateAdmissionMinutes: value('dd26-late-admission'),
      submissionGraceMinutes: value('dd26-submission-grace'),
      allowedMaterials: value('dd26-allowed-materials', false),
      suggestedAnswerMode,
      suggestedAnswer: value('dd26-model-answer', false),
      beadleEmail: value('dd26-publish-beadle-email'),
      exam,
      replacement: state.exam.publishIntent?.mode === 'replacement',
    });
    showPublishStepErrors(validation.errors);
    if (validation.errors.length) {
      global.toast?.('Correct the highlighted exam details before continuing.', 'warn');
      return;
    }
    const {
      opensAt, hardClosesAt, durationMinutes,
      lateAdmissionMinutes, submissionGraceMinutes, beadleEmail,
    } = validation;
    const rules = {
      opensAt: opensAt.toISOString(),
      hardClosesAt: hardClosesAt.toISOString(),
      durationMinutes,
      lateAdmissionMinutes,
      submissionGraceMinutes,
      allowedMaterials: value('dd26-allowed-materials', false),
      navigationMode: value('dd26-navigation-mode'),
      integrityMode: value('dd26-monitoring-mode'),
      fullscreenPolicy: value('dd26-fullscreen-policy'),
      admissionMode: value('dd26-admission-mode'),
      temporaryLeaveAcknowledgment: value('dd26-leave-policy') === 'true',
      studentAccessCodeRequired: true,
      suggestedAnswerMode,
      suggestedAnswer: suggestedAnswerMode === 'paste' ? value('dd26-model-answer', false) : null,
      suggestedAnswerObjectPath: null,
      aiGradingEnabled: false,
    };
    state.exam.publishDraft = {
      rules,
      suggestedAnswerFile,
      beadleEmail,
      beadleExpiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      beadleReason: 'Prepare the class list and assist on exam day',
      intent: state.exam.publishIntent || { mode: 'initial' },
    };
    if (state.exam.publishDraft.intent.mode !== 'replacement') {
      const snapshot = state.exam.rulesAuthoringSnapshot;
      if (!snapshot || !authoringCapability(snapshot, 'canEditRules')) {
        showPublishStepErrors([{ field: null, message: 'The latest rules workspace is unavailable. Return to the five-step review and reopen Step 3.' }]);
        return;
      }
      const reviewButton = document.getElementById('dd26-review-publish');
      if (reviewButton) { reviewButton.disabled = true; reviewButton.textContent = 'Saving rules draft…'; }
      try {
        await command({
          operation: 'save_rules_draft',
          examId: snapshot.examId,
          expectedRevision: Number(snapshot.workspaceRevision),
          rules,
          beadleEmail,
          requestKey: randomKey('rules_review'),
        });
        state.exam.authoringSnapshots.delete(snapshot.examId);
        state.exam.rulesAuthoringSnapshot = await loadProfessorAuthoringSnapshot(snapshot.examId);
        state.exam.publishDraft.expectedRevision = Number(
          state.exam.rulesAuthoringSnapshot.workspaceRevision,
        );
      } catch (error) {
        showPublishStepErrors([{ field: null, message: error.message || 'The rules draft could not be saved before final review.' }]);
        if (reviewButton) { reviewButton.disabled = false; reviewButton.textContent = 'Review before publishing'; }
        return;
      }
    }
    const notes = [
      rules.navigationMode === 'one_way' && 'One-way navigation is enabled and should be justified.',
      rules.fullscreenPolicy === 'required_with_exemptions' && 'Fullscreen remains a browser policy, not operating-system lockdown.',
    ].filter(Boolean);
    const warnings = notes;
    const replacement = state.exam.publishDraft.intent.mode === 'replacement';
    const immutableNotice = replacement
      ? `This will replace published version ${state.exam.publishDraft.intent.publicationNumber || state.exam.publishDraft.intent.expectedPublicationId}. It is allowed only before the exam opens and before any student starts. The earlier copy stays on record, its exam codes stop working, and new codes are created. After a student starts, send a correction or stop notice instead.`
      : 'Publishing saves one fixed copy of the questions, instructions, points, and rules. Before any student starts, you may publish a corrected copy after a clear warning. After the exam begins, send a correction or stop notice instead.';
    const replacementQuestionSummary = replacement
      ? `<div><dt>Corrected questions</dt><dd>Review completed for corrected copy ${escapeHtml(state.exam.publishDraft.intent.replacementQuestionVersionNumber || 'ready to publish')}</dd></div>`
      : '';
    const admissionCopy = rules.admissionMode === 'beadle_approval'
      ? 'The Beadle confirms each student before entry'
      : 'Students enter after sign-in, class-list, code, and schedule checks';
    const monitoringCopy = rules.integrityMode === 'warn_and_record'
      ? 'Warn the student and record each time the exam tab is left'
      : 'Record each time the exam tab is left for Professor review';
    const fullscreenCopy = rules.fullscreenPolicy === 'off'
      ? 'Full screen is not requested'
      : rules.fullscreenPolicy === 'required_with_exemptions'
        ? 'Full screen is required unless an approved exemption applies'
        : 'Students are asked to use full screen';
    const suggestedAnswerCopy = rules.suggestedAnswerMode === 'paste'
      ? 'Professor-only suggested answer saved for grading'
      : 'No suggested answer';
    openDialog(`<div class="dd26-label">Step 3 · ${replacement ? 'Replace publication' : 'Publish for class preparation'}</div><h2>${replacement ? 'Final replacement review' : 'Review before publishing'}</h2><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${escapeHtml(exam.questionCount || '—')}</strong><span>Questions</span></div><div class="dd26-stat"><strong>${escapeHtml(exam.totalPoints ?? '—')}</strong><span>Total points</span></div><div class="dd26-stat"><strong>${escapeHtml(durationMinutes)}</strong><span>Minutes</span></div><div class="dd26-stat"><strong>${escapeHtml(state.exam.portal?.classes?.find((entry) => entry.classroomId === state.exam.activeClassroomId)?.rosterCount || 0)}</strong><span>Students currently listed</span></div></div><dl class="dd26-publish-summary">${replacementQuestionSummary}<div><dt>Schedule</dt><dd>${escapeHtml(formatDate(opensAt))} to ${escapeHtml(formatDate(hardClosesAt))}</dd></div><div><dt>Class preparation</dt><dd>Publish first; the Beadle then uploads the class list and creates the separate student exam code</dd></div><div><dt>Student entry</dt><dd>${escapeHtml(admissionCopy)}</dd></div><div><dt>Question movement</dt><dd>Students may move between questions</dd></div><div><dt>Leaving the exam tab</dt><dd>${escapeHtml(monitoringCopy)}</dd></div><div><dt>Full screen</dt><dd>${escapeHtml(fullscreenCopy)}</dd></div><div><dt>Suggested answer</dt><dd>${escapeHtml(suggestedAnswerCopy)}</dd></div><div><dt>Individual arrangements</dt><dd>Approved extra time and exemptions are applied to the named student</dd></div><div><dt>AI grading and camera</dt><dd>Not used</dd></div></dl>${warnings.length ? `<div class="dd26-notice">${warnings.map(escapeHtml).join('<br>')}</div>` : '<div class="dd26-success">Questions, schedule, and exam rules are ready.</div>'}<div class="dd26-notice">${escapeHtml(immutableNotice)}</div><label class="dd26-choice"><input id="dd26-publish-ack" type="checkbox"><span><strong>${replacement ? 'I intend to replace the current publication' : 'I reviewed the questions, schedule, and class flow'}</strong><small>${replacement ? 'The previous version remains preserved and issued exam codes will rotate.' : 'Publication freezes this examination and creates the one-time Beadle key.'}</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-publish-confirm" type="button" disabled>${replacement ? 'Replace published version' : 'Publish and create Beadle key'}</button><button class="dd26-button" data-dd26-close-dialog type="button">Return without publishing</button></div>`);
    document.querySelector('#dd26-dialog-card .dd26-publish-summary')?.insertAdjacentHTML(
      'afterend',
      entryCutoffReviewHtml(opensAt, hardClosesAt, lateAdmissionMinutes),
    );
    document.querySelector('#dd26-dialog-card .dd26-publish-summary')?.insertAdjacentHTML(
      'beforeend',
      `<div><dt>Beadle</dt><dd>${escapeHtml(beadleEmail)}</dd></div>`,
    );
    document.getElementById('dd26-publish-ack')?.closest('label')?.insertAdjacentHTML(
      'beforebegin',
      '<div class="dd26-notice" id="dd26-publish-operation-status" role="status" aria-live="polite" tabindex="-1" hidden></div>',
    );
    const acknowledgement = document.getElementById('dd26-publish-ack');
    const publish = document.getElementById('dd26-publish-confirm');
    const publicationAttempt = {};
    acknowledgement?.addEventListener('change', () => { publish.disabled = !acknowledgement.checked; });
    publish?.addEventListener('click', () => scheduleExam(publicationAttempt));
  }

  async function withBoundedPublishWait(operation, timeoutMs = EXAMINATION_ROOM_PUBLISH_WAIT_MS) {
    let timeoutId = null;
    const timeout = new Promise((resolve, reject) => {
      timeoutId = global.setTimeout(() => {
        const error = new Error('The server did not answer in time.');
        error.code = 'EXAM_ROOM_PUBLISH_WAIT_TIMEOUT';
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  function publishOperationMessage(error) {
    const messages = {
      EXAM_ROOM_PUBLISH_WAIT_TIMEOUT: 'The server did not answer within 25 seconds. Publication was not assumed to have failed or succeeded.',
      EXAM_ROOM_ROSTER_REQUIRED: 'The examination could not be finalized because the server treated the later class list as required. Return and refresh the Examination Room.',
      ROSTER_REQUIRED: 'The examination could not be finalized because the server treated the later class list as required. Return and refresh the Examination Room.',
      EXAM_ROOM_EXAM_NOT_SCHEDULED: 'The examination is not ready. Return and confirm the questions and schedule.',
      EXAM_ROOM_EXAM_NOT_SCHEDULABLE: 'The examination changed while you were reviewing it. Return and refresh before trying again.',
      EXAM_ROOM_PUBLICATION_PRECONDITION_FAILED: 'A required item is missing. Return and check the confirmed questions, schedule, and grading access.',
      EXAM_ROOM_CLASS_HANDOFF_INVALID: 'The publication or Beadle handoff is incomplete. Check the Beadle email, schedule, and exam rules.',
      EXAM_ROOM_HANDOFF_TIME_REQUIRED: 'Choose a valid examination opening time and try again.',
      EXAM_ROOM_EXAM_NOT_PUBLISHABLE: 'This examination changed and is no longer ready to publish. Return and refresh it.',
      EXAM_ROOM_WORKSPACE_CONFLICT: 'The examination changed in another tab after your review. Return to the five-step workspace, review the latest copy, and publish again.',
      EXAM_ROOM_BEADLE_INVITATION_FAILED: 'The examination was not published because the Beadle key could not be issued safely.',
      EXAM_ROOM_STUDENT_ACCESS_CODE_MISMATCH: 'The class access code no longer matches this examination. Return and start the publication review again.',
      EXAM_ROOM_ALREADY_PUBLISHED: 'This examination is already published. Return to the Examination Room to view the published version.',
      EXAM_ROOM_RULES_INVALID: 'One or more exam rules were not accepted. Return and review every schedule and rule field.',
      INVALID_SCHEDULE: 'The examination must have a valid opening time and a later end time.',
      INVALID_REQUEST: 'One or more exam details are incomplete or outside the allowed limits. Return and correct them.',
    };
    if (messages[error?.code]) return messages[error.code];
    const message = String(error?.message || '').trim();
    if (message && !/^[A-Z0-9_]+$/.test(message)) return message;
    return 'The examination was not published. Return and review the questions, schedule, and rules.';
  }

  function publishRetryIsSafe(error) {
    return error?.code === 'EXAM_ROOM_PUBLISH_WAIT_TIMEOUT'
      || error?.code === 'EXAM_ROOM_PUBLICATION_CONFIRMATION_INCOMPLETE'
      || isTransientTransportFailure(error);
  }

  function setPublishOperationStatus(message, type = 'progress') {
    const host = document.getElementById('dd26-publish-operation-status');
    if (!host) return;
    host.hidden = false;
    host.className = type === 'error' ? 'dd26-error' : type === 'success' ? 'dd26-success' : 'dd26-notice';
    host.textContent = String(message || '');
  }

  function publicationSecretsMayBeDisplayed(result, draft, publicationAttempt = {}) {
    const publication = result?.publication || result;
    if (result?.ok !== true || publication?.ok !== true || !publication.publicationId) return false;
    if (typeof publication.accessCodeRequired !== 'boolean'
        || publication.accessCodeRequired !== (draft?.rules?.studentAccessCodeRequired === true)) return false;
    if (draft?.intent?.mode !== 'replacement') {
      return result.studentAccessReady === false
        && result.beadleInvitation?.ok === true
        && result.oneTimeBeadleKey === publicationAttempt.beadleKey;
    }
    return publication.credentialsRotated === true
      && publication.questionVersionChanged === true
      && publication.replacementQuestionVersionId === draft.intent.replacementQuestionVersionId;
  }

  async function scheduleExam(publicationAttempt = {}) {
    const draft = state.exam.publishDraft;
    if (!draft?.rules || draft.busy) return;
    const opensAtMs = new Date(draft.rules.opensAt).getTime();
    if (!Number.isFinite(opensAtMs)) {
      const message = 'Choose a valid examination opening time and try again.';
      setPublishOperationStatus(message, 'error');
      const blockedButton = document.getElementById('dd26-publish-confirm');
      if (blockedButton) {
        blockedButton.disabled = true;
        blockedButton.textContent = 'Return and change the opening time';
      }
      global.toast?.(message, 'warn');
      return;
    }
    const replacement = draft.intent?.mode === 'replacement';
    if (replacement) publicationAttempt.studentKey ||= randomKey('student_exam');
    else publicationAttempt.studentKey = null;
    publicationAttempt.gradingKey ||= randomKey('professor_grading');
    if (!replacement) publicationAttempt.beadleKey ||= randomKey('beadle_invitation');
    let studentKey = publicationAttempt.studentKey;
    let gradingKey = publicationAttempt.gradingKey;
    draft.requestKey ||= randomKey(replacement ? 'replace_publication' : 'publish');
    draft.busy = true;
    const publishButton = document.getElementById('dd26-publish-confirm');
    if (publishButton) { publishButton.disabled = true; publishButton.textContent = replacement ? 'Replacing…' : 'Publishing…'; }
    setPublishOperationStatus(replacement ? 'Replacing the published version securely…' : 'Publishing the examination and preparing the Beadle key…');
    try {
      if (draft.rules.suggestedAnswerMode === 'upload' && !draft.rules.suggestedAnswerObjectPath) {
        const uploaded = await api('/exam-room/upload/model-answer', {
          examId: state.exam.activeExamId,
          ...await filePayload(draft.suggestedAnswerFile),
          requestKey: draft.modelAnswerRequestKey ||= randomKey('model_answer'),
        });
        if (!uploaded.source?.objectPath) throw new Error('The private suggested-answer source was not registered.');
        draft.rules.suggestedAnswerObjectPath = uploaded.source.objectPath;
      }
      setPublishOperationStatus(replacement ? 'Publishing the corrected version…' : 'Freezing the examination and issuing Beadle access…');
      const publicationOperation = replacement
        ? command({
          operation: 'replace_publication',
          examId: state.exam.activeExamId,
          expectedPublicationId: draft.intent.expectedPublicationId,
          replacementQuestionVersionId: draft.intent.replacementQuestionVersionId,
          rules: draft.rules,
          studentKey,
          gradingKey,
          reason: draft.intent.reason,
          requestKey: draft.requestKey,
        })
        : command({
          operation: 'publish_for_beadle',
          examId: state.exam.activeExamId,
          expectedRevision: draft.expectedRevision,
          rules: draft.rules,
          gradingKey,
          beadleEmail: draft.beadleEmail,
          beadleInvitationKey: publicationAttempt.beadleKey,
          beadleExpiresAt: draft.beadleExpiresAt,
          reason: draft.beadleReason,
          requestKey: draft.requestKey,
        });
      const result = await withBoundedPublishWait(publicationOperation);
      if (!publicationSecretsMayBeDisplayed(result, draft, publicationAttempt)) {
        const error = new Error('The server did not confirm a complete publication.');
        error.code = 'EXAM_ROOM_PUBLICATION_CONFIRMATION_INCOMPLETE';
        throw error;
      }
      draft.busy = false;
      const publication = result.publication || result;
      const version = publication.publicationNumber || publication.versionNumber || publication.version || 1;
      let handoffSecret = replacement
        ? `<div class="dd26-field"><span>Replacement student exam code</span><div class="dd26-secret-row"><div class="dd26-raw-key" id="dd26-student-secret" data-dd26-sensitive>${escapeHtml(studentKey)}</div><button class="dd26-button" data-dd26-copy-secret="dd26-student-secret" type="button">Copy</button></div><small class="dd26-help">Give this replacement code to the Beadle. The previous student code no longer works.</small></div>`
        : `<div class="dd26-field"><span>Beadle key</span><div class="dd26-secret-row"><div class="dd26-raw-key" id="dd26-beadle-publish-secret" data-dd26-sensitive>${escapeHtml(publicationAttempt.beadleKey)}</div><button class="dd26-button" data-dd26-copy-secret="dd26-beadle-publish-secret" type="button">Copy</button></div><small class="dd26-help">Send this only to ${escapeHtml(draft.beadleEmail)}. It opens the Beadle workspace for this examination and can be used once.</small></div>`;
      const nextStep = replacement
        ? 'Give the replacement student code to the Beadle before the scheduled opening.'
        : 'Send the Beadle key now. The Beadle will upload the class list, then Due Diligence will create the separate student exam code.';
      openDialog(`<div class="dd26-label">Published · One-time keys</div><h2>${replacement ? 'Replacement published' : 'Examination published for class preparation'}</h2><p>Published copy ${escapeHtml(version)} is now saved${replacement ? ' and replaces the earlier copy for student entry' : ''}. Copy both keys now; Due Diligence protects them and cannot show these exact keys again.</p>${handoffSecret}<div class="dd26-field"><span>Professor grading key</span><div class="dd26-secret-row"><div class="dd26-raw-key" id="dd26-grading-secret" data-dd26-sensitive>${escapeHtml(gradingKey)}</div><button class="dd26-button" data-dd26-copy-secret="dd26-grading-secret" type="button">Copy</button></div><small class="dd26-help">Keep this private. Redeem it once to grade each submitted examination immediately, including while classmates are still answering.</small></div><div class="dd26-success"><strong>Next step:</strong> ${escapeHtml(nextStep)}</div><div class="dd26-notice">The Beadle key, class examination code, and Professor grading key are separate. None of them replaces student sign-in and the class-list check.</div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-enter-published-room" type="button">I saved both keys — enter virtual room</button><button class="dd26-button" id="dd26-publish-return" type="button">Return to Professor workspace</button></div>`, {
        persistent: true,
        sensitive: true,
        onClose: () => {
          publicationAttempt.studentKey = '';
          publicationAttempt.gradingKey = '';
          publicationAttempt.beadleKey = '';
          studentKey = '';
          gradingKey = '';
        },
      });
      bindSecretCopyButtons();
      document.getElementById('dd26-enter-published-room')?.addEventListener('click', () => {
        const examId = state.exam.activeExamId;
        let oneTimeKey = String(document.getElementById('dd26-grading-secret')?.textContent || '');
        closeDialog();
        void openLiveStatus(examId, oneTimeKey).finally(() => { oneTimeKey = ''; });
      });
      document.getElementById('dd26-publish-return')?.addEventListener('click', closeDialog);
      publicationAttempt.studentKey = '';
      publicationAttempt.gradingKey = '';
      publicationAttempt.beadleKey = '';
      result.oneTimeBeadleKey = '';
      if ('oneTimeStudentAccessCode' in result) result.oneTimeStudentAccessCode = '';
      handoffSecret = '';
      studentKey = '';
      gradingKey = '';
      state.exam.publishDraft = null;
      const refreshed = await withBoundedPublishWait(refreshPortalSilently(), EXAMINATION_ROOM_REFRESH_WAIT_MS).catch(() => false);
      if (refreshed) {
        state.exam.section = 'professor';
        renderExamRoom();
      }
    } catch (error) {
      draft.busy = false;
      const retryAuthorized = publishRetryIsSafe(error);
      await withBoundedPublishWait(refreshPortalSilently(), EXAMINATION_ROOM_REFRESH_WAIT_MS).catch(() => false);
      const button = document.getElementById('dd26-publish-confirm');
      if (button) {
        button.disabled = !retryAuthorized;
        button.textContent = retryAuthorized
          ? (replacement ? 'Retry replacement safely' : 'Retry publication safely')
          : 'Publication stopped';
      }
      const message = publishOperationMessage(error);
      setPublishOperationStatus(
        retryAuthorized
          ? `${message} Use Retry publication safely. It reuses this same secure request and cannot create a second publication.`
          : `${message} Use Return without publishing to correct the examination.`,
        'error',
      );
      global.toast?.(message, 'warn');
    }
  }

  function localDateValue(date) {
    return manilaInputValue(date);
  }

  async function startAttempt() {
    if (!isAuthenticated()) {
      state.exam.portal = null;
      state.exam.intentRole = 'student';
      state.exam.section = 'entry';
      renderExamRoom();
      requireAuthentication();
      return;
    }
    if (document.getElementById('dd26-entry-ack')?.checked !== true) {
      global.toast?.('Review the acknowledgement before entering the examination.', 'warn');
      document.getElementById('dd26-entry-ack')?.focus();
      return;
    }
    const studentKey = value('dd26-student-key', false).trim();
    if (!studentKey) { global.toast?.('Enter the current student exam code.', 'warn'); return; }
    if (state.exam.entryBusy) return;
    state.exam.entryBusy = true;
    const entryButton = document.getElementById('dd26-start-attempt');
    if (entryButton) {
      entryButton.disabled = true;
      entryButton.setAttribute('aria-busy', 'true');
      entryButton.textContent = 'Checking access…';
    }
    try {
      const storageApi = global.DueDiligenceExaminationRoomStore;
      state.exam.store ||= storageApi?.createStore?.();
      const storage = state.exam.store ? await state.exam.store.init() : { available: false, code: 'module_unavailable' };
      const persistent = storage.available && navigator.storage?.persist
        ? await navigator.storage.persist().catch(() => false)
        : false;
      const deviceSupported = Math.min(global.screen?.width || global.innerWidth, global.screen?.height || global.innerHeight) >= 600;
      const startedAt = performance.now();
      const deviceInstanceHash = storage.available ? await state.exam.store.getDeviceInstanceHash() : null;
      const payload = await api('/exam-room/query', {
        operation: 'student_entry', studentKey, deviceInstanceHash,
      });
      const reachabilityMs = Math.max(0, Math.round(performance.now() - startedAt));
      const examId = String(payload.result?.examId || '');
      state.exam.preflight = {
        examId, studentKey, storage, persistent, deviceSupported, deviceInstanceHash,
        reachabilityMs, server: payload.result || {}, autoEnter: true, acknowledged: true,
      };
      synchronizeServerClock(state.exam.preflight.server.serverNow || state.exam.preflight.server.checks?.serverNow);
      if (shouldRenderStudentWaitingRoom(state.exam.preflight)) renderStudentWaitingRoom();
      else if (waitingRoomChecks(state.exam.preflight).ready
          && studentStartReadiness(state.exam.preflight.server).canStart) {
        await beginAttemptAfterPreflight(null, true);
      } else renderPreflight();
    } catch (error) { global.toast?.(error.message, 'warn'); }
    finally {
      state.exam.entryBusy = false;
      if (entryButton?.isConnected) {
        entryButton.disabled = false;
        entryButton.removeAttribute('aria-busy');
        entryButton.textContent = 'Enter examination';
      }
    }
  }

  function accessCodePreflightPolicy(server = {}, studentKey = null) {
    const primary = server.accessCodeRequired;
    const nested = server.checks?.accessCodeRequired;
    const known = typeof primary === 'boolean' || typeof nested === 'boolean';
    const required = primary === true || nested === true;
    const beadleAuthorized = server.beadleDirectEntry === true
      && server.accessAuthorization === 'active_beadle_assignment';
    return {
      known,
      required,
      beadleAuthorized,
      ready: known && (
        !required
        || beadleAuthorized
        || Boolean(String(studentKey || '').trim())
      ),
    };
  }

  function studentAccessCodeState(server = {}, studentKey = null) {
    const policy = accessCodePreflightPolicy(server, studentKey);
    const blocker = String(server.startBlockerCode || server.code || '');
    const status = String(server.accessCodeStatus || '').toLowerCase();
    const accepted = !policy.required || server.accessCodeAccepted === true
      || status === 'accepted' || server.accessCodeValid === true
      || server.checks?.accessCodeValid === true;
    if (!policy.known) return { accepted: false, className: 'is-fail', copy: 'Due Diligence could not confirm this examination’s student-code requirement. Return and refresh before trying again.' };
    if (!policy.required) return { accepted: true, className: 'is-pass', copy: 'This examination does not require a separate student exam code.' };
    if (policy.beadleAuthorized && accepted) return { accepted: true, className: 'is-pass', copy: 'Your active Beadle assignment securely authorizes this handoff. No class code is needed.' };
    if (accepted) return { accepted: true, className: 'is-pass', copy: 'The student exam code is correct for this examination.' };
    if (!policy.ready || blocker === 'STUDENT_ACCESS_CODE_REQUIRED') return { accepted: false, className: 'is-fail', copy: 'Enter the active student exam code provided by the Beadle.' };
    if (blocker === 'CREDENTIAL_LOCKED' || status === 'locked') return { accepted: false, className: 'is-fail', copy: 'Too many incorrect code attempts. Student-code entry is locked for 15 minutes.' };
    if (blocker === 'CREDENTIAL_NOT_ACTIVE' || blocker === 'STUDENT_ACCESS_NOT_READY' || status === 'not_issued') return { accepted: false, className: 'is-fail', copy: 'No active student exam code matches this examination. Ask the Beadle for the current handout.' };
    if (blocker === 'CREDENTIAL_INVALID' || status === 'invalid') return { accepted: false, className: 'is-fail', copy: 'This student exam code is incorrect for this examination. Copy the active code from the Beadle’s current handout.' };
    return { accepted: false, className: 'is-fail', copy: 'Due Diligence could not validate this student exam code. Return and enter the active code from the Beadle.' };
  }

  function studentEntryTiming(server = {}, officialNowMs = currentServerTimeMs()) {
    const nowMs = Number(officialNowMs);
    const opensAtMs = new Date(server.opensAt).getTime();
    const entryClosesAt = server.entryClosesAt || server.hardClosesAt;
    const entryClosesAtMs = new Date(entryClosesAt).getTime();
    const hardClosesAtMs = new Date(server.hardClosesAt).getTime();
    const blocker = String(server.startBlockerCode || server.code || '');
    if (blocker === 'EXAM_CLOSED' || (Number.isFinite(hardClosesAtMs) && nowMs >= hardClosesAtMs)) {
      return { state: 'exam_closed', className: 'is-fail', copy: `The examination closed ${formatDate(server.hardClosesAt)}.` };
    }
    if (Number.isFinite(opensAtMs) && nowMs < opensAtMs) {
      return { state: 'before_open', className: 'is-warn', copy: `The examination opens ${formatDate(server.opensAt)}. A student with a valid code may wait in the waiting room.` };
    }
    if (blocker === 'LATE_ADMISSION_CLOSED'
        || (Number.isFinite(entryClosesAtMs) && nowMs >= entryClosesAtMs)) {
      return { state: 'entry_closed', className: 'is-fail', copy: `Student entry closed ${formatDate(entryClosesAt)}. Students who already started may resume until their own deadline.` };
    }
    if (Number.isFinite(opensAtMs) && nowMs >= opensAtMs) {
      return { state: 'open', className: 'is-pass', copy: `Student entry is open until ${formatDate(entryClosesAt)}.` };
    }
    return { state: 'unknown', className: 'is-fail', copy: 'Due Diligence did not return a complete opening and entry schedule. Starting is blocked.' };
  }

  function studentStartReadiness(server = {}) {
    const reported = typeof server.canStart === 'boolean';
    const canStart = reported && server.canStart === true;
    const code = String(server.startBlockerCode || server.code || '');
    const blockers = {
      STUDENT_ACCESS_NOT_READY: 'The Beadle has not finished the class handout yet.',
      STUDENT_ACCESS_CODE_REQUIRED: 'Enter the active student exam code provided by the Beadle.',
      CREDENTIAL_INVALID: 'This student exam code is incorrect for this examination.',
      CREDENTIAL_LOCKED: 'Too many incorrect code attempts. Student-code entry is locked for 15 minutes.',
      CREDENTIAL_NOT_ACTIVE: 'No active student exam code matches this examination. Ask the Beadle for the current handout.',
      EXAM_NOT_OPEN: `The examination opens ${formatDate(server.opensAt)}.`,
      LATE_ADMISSION_CLOSED: `Student entry closed ${formatDate(server.entryClosesAt || server.hardClosesAt)}.`,
      EXAM_CLOSED: 'This examination is closed.',
      ADMISSION_REQUIRED: 'The Beadle must allow this student to enter.',
      EXAM_ROOM_INSUFFICIENT_DAILY_ALLOWANCE: `This examination needs ${Number(server.commercialAllowance?.requiredCount) || 'more'} successful submissions, but only ${Number(server.commercialAllowance?.remainingToday) || 0} remain today. Your Free allowance resets ${formatDate(server.commercialAllowance?.resetAt)}.`,
    };
    return {
      reported,
      canStart,
      copy: canStart
        ? `Entry is open. Student entry closes ${formatDate(server.entryClosesAt || server.hardClosesAt)}.`
        : blockers[code] || (reported
          ? 'The examination cannot be started at this time.'
          : 'Due Diligence did not confirm that entry is open. Starting is blocked.'),
    };
  }

  function waitingRoomChecks(check = {}) {
    const server = check.server || {};
    const access = accessCodePreflightPolicy(server, check.studentKey);
    const directBeadleAuthorized = check.entryMode !== 'beadle'
      || (server.beadleDirectEntry === true
        && server.accessAuthorization === 'active_beadle_assignment');
    const accessCodeValidated = !access.required
      || server.accessCodeAccepted === true
      || server.accessCodeStatus === 'accepted'
      || server.accessCodeValid === true
      || server.checks?.accessCodeValid === true;
    const sessionConflict = server.sessionConflict === true || server.checks?.sessionConflict === true;
    return {
      access,
      accessCodeValidated,
      sessionConflict,
      ready: check.storage?.available === true
        && check.deviceSupported === true
        && server.eligible === true
        && access.known
        && access.ready
        && directBeadleAuthorized
        && accessCodeValidated
        && !sessionConflict,
    };
  }

  function studentPreflightQuery(check = {}) {
    if (check.entryMode === 'beadle') {
      return {
        operation: 'beadle_student_entry',
        examId: check.examId,
        deviceInstanceHash: check.deviceInstanceHash,
      };
    }
    return {
      operation: 'preflight',
      examId: check.examId,
      studentKey: check.studentKey,
      deviceInstanceHash: check.deviceInstanceHash,
    };
  }

  function shouldRenderStudentWaitingRoom(check = {}) {
    const server = check.server || {};
    const blocker = String(server.startBlockerCode || server.code || '');
    const checks = waitingRoomChecks(check);
    const waitingState = String(server.waitingRoomState || '');
    return (server.waitingRoom === true || blocker === 'EXAM_NOT_OPEN')
      && (!waitingState || waitingState === 'waiting')
      && blocker === 'EXAM_NOT_OPEN'
      && server.eligible === true
      && checks.access.known
      && checks.access.ready
      && checks.accessCodeValidated
      && !checks.sessionConflict
      && Number.isFinite(new Date(server.opensAt).getTime());
  }

  function waitingRoomCountdownText(milliseconds) {
    const seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
  }

  function updateStudentWaitingRoomClock() {
    const check = state.exam.preflight;
    const countdown = document.getElementById('dd26-waiting-countdown');
    const status = document.getElementById('dd26-waiting-status');
    const start = document.getElementById('dd26-preflight-start');
    const acknowledgement = document.getElementById('dd26-preflight-ack');
    if (!check || !countdown || !status || !start) {
      clearInterval(state.exam.waitingRoomTimer);
      state.exam.waitingRoomTimer = null;
      return;
    }
    const opensAtMs = new Date(check.server?.opensAt).getTime();
    const entryClosesAtMs = new Date(check.server?.entryClosesAt || check.server?.hardClosesAt).getTime();
    const officialNow = currentServerTimeMs();
    const remaining = opensAtMs - officialNow;
    countdown.textContent = waitingRoomCountdownText(remaining);
    const openingReached = remaining <= 0;
    const entryClosed = Number.isFinite(entryClosesAtMs) && officialNow >= entryClosesAtMs;
    const checks = waitingRoomChecks(check);
    const automaticEntry = check.autoEnter === true;
    start.disabled = automaticEntry
      || !checks.ready
      || !openingReached
      || entryClosed
      || acknowledgement?.checked !== true;
    if (entryClosed) status.textContent = 'Student entry has closed. Ask the Professor or Beadle for instructions.';
    else if (!openingReached) status.textContent = `Start unlocks when the official countdown reaches zero at ${formatDate(check.server.opensAt)}.`;
    else if (automaticEntry && checks.ready) {
      status.textContent = check.autoEntryBusy
        ? 'Opening time reached. Due Diligence is entering your examination now…'
        : 'Opening time reached. Automatic entry is starting now…';
      if (!check.autoEntryBusy && Date.now() >= Number(check.autoEntryRetryAt || 0)) {
        void enterExamFromWaitingRoom({ automatic: true });
      }
    } else status.textContent = 'Opening time reached. Review the acknowledgement, then select Start examination.';
  }

  async function pollStudentWaitingRoom() {
    const check = state.exam.preflight;
    if (!check || check.terminal || check.requestBusy || state.exam.waitingRoomPolling
        || !document.getElementById('dd26-waiting-countdown')) return;
    state.exam.waitingRoomPolling = true;
    check.requestBusy = true;
    try {
      const payload = await api('/exam-room/query', studentPreflightQuery(check));
      if (state.exam.preflight !== check || check.terminal) return;
      check.server = payload.result || {};
      check.retryCount = 0;
      check.autoEntryRetryAt = 0;
      synchronizeServerClock(check.server.serverNow || check.server.checks?.serverNow);
      const terminal = check.entryMode === 'beadle' ? directBeadleTerminalState(check.server) : null;
      if (terminal) {
        renderDirectBeadleHandoffBlocker(check, { ...terminal, terminal: true });
        return;
      }
      updateStudentWaitingRoomClock();
      if (String(check.server.waitingRoomState || '') === 'blocked') {
        check.terminal = true;
        stopStudentWaitingRoom(check);
        renderPreflight();
      }
    } catch (error) {
      if (state.exam.preflight !== check || check.terminal) return;
      if (check.entryMode === 'beadle' && !isRetryableBeadleHandoffError(error)) {
        renderDirectBeadleHandoffBlocker(check, {
          terminal: true,
          title: 'Secure examination entry was declined',
          message: error.message || 'Your active Beadle assignment or class-list identity could not be confirmed.',
        });
        return;
      }
      check.retryCount = Math.min(4, Number(check.retryCount || 0) + 1);
      check.autoEntryRetryAt = Date.now() + waitingRoomRetryDelay(check);
      const status = document.getElementById('dd26-waiting-status');
      if (status) status.textContent = navigator.onLine === false
        ? 'You are offline. Due Diligence will recheck immediately when this device reconnects.'
        : 'The official time check will retry safely. Keep this page open.';
    } finally {
      state.exam.waitingRoomPolling = false;
      check.requestBusy = false;
      if (state.exam.preflight === check
          && !check.terminal
          && document.getElementById('dd26-waiting-countdown')
          && (
            check.server?.pollAfterMs != null
            || check.autoEnter === true
          )) {
        scheduleStudentWaitingRoomPoll();
      }
    }
  }

  function waitingRoomRetryDelay(check = state.exam.preflight) {
    const retryIndex = Math.max(0, Math.min(4, Number(check?.retryCount || 1) - 1));
    return [5_000, 10_000, 20_000, 30_000, 30_000][retryIndex];
  }

  function scheduleStudentWaitingRoomPoll(delayOverride = null) {
    clearTimeout(state.exam.waitingRoomPollTimer);
    const check = state.exam.preflight;
    if (!check || check.terminal) return;
    const serverDelay = Number(state.exam.preflight?.server?.pollAfterMs);
    const requestedDelay = Number(delayOverride);
    const delay = Number.isFinite(requestedDelay)
      ? Math.max(0, Math.min(30_000, requestedDelay))
      : Number(check.retryCount || 0) > 0
        ? waitingRoomRetryDelay(check)
        : Number.isFinite(serverDelay)
      ? Math.max(5000, Math.min(30_000, serverDelay))
      : 15_000;
    state.exam.waitingRoomPollTimer = setTimeout(() => {
      state.exam.waitingRoomPollTimer = null;
      void pollStudentWaitingRoom();
    }, delay);
  }

  function renderStudentWaitingRoom() {
    if (!isAuthenticated()) {
      state.exam.preflight = null;
      state.exam.section = 'entry';
      renderExamRoom();
      requireAuthentication();
      return;
    }
    const check = state.exam.preflight;
    const server = check?.server || {};
    const host = document.getElementById('dd26-exam-main');
    if (!check || !host) return;
    closeDialog();
    clearInterval(state.exam.waitingRoomTimer);
    clearTimeout(state.exam.waitingRoomPollTimer);
    const rules = server.rules || {};
    const checks = waitingRoomChecks(check);
    const automaticEntry = check.autoEnter === true;
    const accountLabel = server.studentEmail || server.signedInEmail || server.candidateEmail || 'Signed-in account confirmed';
    const accessLabel = automaticEntry ? 'Secure Beadle handoff' : 'Student exam code';
    const accessCopy = automaticEntry
      ? 'Your active Beadle assignment and rostered account were verified; no code re-entry is needed'
      : checks.accessCodeValidated
        ? 'The code from the Beadle is valid for this examination'
        : 'The student exam code could not be validated';
    host.innerHTML = `<section class="dd26-card dd26-waiting-room" aria-labelledby="dd26-waiting-title"><div class="dd26-label">Student waiting room</div><div class="dd26-question-meta"><div><h2 id="dd26-waiting-title">${escapeHtml(server.title || server.examTitle || 'Your examination')}</h2><p>${automaticEntry ? 'Your Beadle assignment and class-list identity have been checked. Keep this page open; Due Diligence will enter the examination automatically when the Professor opens it.' : 'Your identity, class-list entry, and student exam code have been checked. Examination questions are not shown before opening time.'}</p></div><span class="dd26-status">${automaticEntry ? 'Automatic entry armed' : 'Ready for opening time'}</span></div><div class="dd26-waiting-clock" role="timer" aria-live="off"><span>Examination opens in</span><strong id="dd26-waiting-countdown">--:--:--</strong><small>Official Due Diligence countdown · opens ${escapeHtml(formatDate(server.opensAt))}</small></div><ul class="dd26-check-list dd26-waiting-checks"><li class="is-pass"><strong>Signed-in student</strong><span>${escapeHtml(accountLabel)}</span></li><li class="${server.eligible === true ? 'is-pass' : 'is-fail'}"><strong>Official class list</strong><span>${server.eligible === true ? 'Your signed-in account matches the saved class list' : 'Your account could not be matched to the class list'}</span></li><li class="${checks.accessCodeValidated ? 'is-pass' : 'is-fail'}"><strong>${accessLabel}</strong><span>${accessCopy}</span></li><li class="${check.storage?.available && check.deviceSupported ? 'is-pass' : 'is-fail'}"><strong>Device and answer saving</strong><span>${check.storage?.available && check.deviceSupported ? 'This device is ready to save examination answers' : 'This device is not ready to open the examination'}</span></li></ul><section class="dd26-waiting-instructions"><div class="dd26-label">Professor’s instructions</div>${studentInstructionsHtml(server.instructions)}</section><dl class="dd26-publish-summary"><div><dt>Exam time</dt><dd>${escapeHtml(formatDate(server.opensAt))} to ${escapeHtml(formatDate(server.serverDeadline || server.hardClosesAt))}</dd></div><div><dt>Allowed materials</dt><dd>${escapeHtml(rules.allowedMaterials || 'See the Professor’s instructions')}</dd></div><div><dt>Moving between questions</dt><dd>${escapeHtml(rules.navigationMode === 'one_way' ? 'Move forward only' : 'You may move between questions')}</dd></div><div><dt>Leaving the exam tab</dt><dd>${escapeHtml(rules.integrityMode === 'off' ? 'Not recorded under this exam setting' : 'Recorded for Professor review; it is not an automatic failure')}</dd></div></dl><label class="dd26-choice"><input id="dd26-preflight-ack" type="checkbox" ${automaticEntry ? 'checked disabled' : checks.ready ? '' : 'disabled'}><span><strong>${automaticEntry ? 'Enter automatically when the examination opens' : 'I reviewed the Professor’s instructions and exam rules'}</strong><small>${automaticEntry ? 'This was requested when you finished the Beadle workflow. Keep this page open; you may cancel below.' : 'The official examination clock continues even if I leave this page after the exam starts.'}</small></span></label><p class="dd26-waiting-status" id="dd26-waiting-status" role="status" aria-live="polite"></p><div class="dd26-actions"><button class="dd26-button primary" id="dd26-preflight-start" type="button" disabled>${automaticEntry ? 'Waiting for automatic entry' : 'Start examination'}</button><button class="dd26-button" id="dd26-waiting-room-return" type="button">${automaticEntry ? 'Cancel and return to Beadle workspace' : 'Return to Student page'}</button></div><div class="dd26-privacy">No attempt is created and no examination question is shown before the server confirms that opening time has arrived.</div></section>`;
    document.getElementById('dd26-preflight-ack')?.addEventListener('change', updateStudentWaitingRoomClock);
    document.getElementById('dd26-preflight-start')?.addEventListener('click', enterExamFromWaitingRoom);
    document.getElementById('dd26-waiting-room-return')?.addEventListener('click', () => {
      if (automaticEntry) {
        void returnToBeadleWorkspace();
      } else {
        stopStudentWaitingRoom(check);
        state.exam.preflight = null;
        renderExamRoom();
        document.getElementById('dd26-exam-main')?.focus();
      }
    });
    updateStudentWaitingRoomClock();
    state.exam.waitingRoomTimer = setInterval(updateStudentWaitingRoomClock, 1000);
    scheduleStudentWaitingRoomPoll();
  }

  async function enterExamFromWaitingRoom(options = {}) {
    const check = state.exam.preflight;
    const button = document.getElementById('dd26-preflight-start');
    if (!check || !button || !document.getElementById('dd26-preflight-ack')?.checked) return;
    const automatic = options?.automatic === true;
    if (check.terminal || check.requestBusy) return;
    if (automatic) {
      if (check.autoEntryBusy || Date.now() < Number(check.autoEntryRetryAt || 0)) return;
      check.autoEntryBusy = true;
    }
    check.requestBusy = true;
    const shouldRequestFullscreen = check.server?.rules?.fullscreenPolicy !== 'off'
      && !check.server?.accommodation?.fullscreenExempt;
    const fullscreenRequest = shouldRequestFullscreen && !automatic
      ? requestFullscreen()
      : Promise.resolve(false);
    button.disabled = true;
    button.textContent = 'Checking opening time…';
    try {
      const payload = await api('/exam-room/query', studentPreflightQuery(check));
      if (state.exam.preflight !== check || check.terminal) return;
      check.server = payload.result || {};
      check.retryCount = 0;
      check.autoEntryRetryAt = 0;
      synchronizeServerClock(check.server.serverNow || check.server.checks?.serverNow);
      const terminal = check.entryMode === 'beadle' ? directBeadleTerminalState(check.server) : null;
      if (terminal) {
        renderDirectBeadleHandoffBlocker(check, { ...terminal, terminal: true });
        return;
      }
      if (!studentStartReadiness(check.server).canStart) {
        const enteredFullscreen = await fullscreenRequest;
        if (enteredFullscreen && document.fullscreenElement) await document.exitFullscreen?.().catch(() => null);
        check.requestBusy = false;
        check.autoEntryBusy = false;
        renderStudentWaitingRoom();
        if (!automatic) global.toast?.(studentStartReadiness(check.server).copy, 'warn');
        return;
      }
      const started = await beginAttemptAfterPreflight(fullscreenRequest);
      if (!started && automatic) {
        const startError = check.lastStartError;
        if (startError && !isRetryableBeadleHandoffError(startError)) {
          renderDirectBeadleHandoffBlocker(check, {
            terminal: true,
            title: 'Secure examination entry was declined',
            message: startError.message || 'The server did not authorize this attempt to open.',
          });
          return;
        }
        check.autoEntryBusy = false;
        check.retryCount = Math.min(4, Number(check.retryCount || 0) + 1);
        check.autoEntryRetryAt = Date.now() + waitingRoomRetryDelay(check);
      }
    } catch (error) {
      if (state.exam.preflight !== check || check.terminal) return;
      const enteredFullscreen = await fullscreenRequest;
      if (enteredFullscreen && document.fullscreenElement) await document.exitFullscreen?.().catch(() => null);
      if (check.entryMode === 'beadle' && !isRetryableBeadleHandoffError(error)) {
        renderDirectBeadleHandoffBlocker(check, {
          terminal: true,
          title: 'Secure examination entry was declined',
          message: error.message || 'The server did not authorize this attempt to open.',
        });
        return;
      }
      button.disabled = false;
      button.textContent = automatic ? 'Waiting for automatic entry' : 'Start examination';
      if (automatic) {
        check.autoEntryBusy = false;
        check.retryCount = Math.min(4, Number(check.retryCount || 0) + 1);
        check.autoEntryRetryAt = Date.now() + waitingRoomRetryDelay(check);
        const status = document.getElementById('dd26-waiting-status');
        if (status) status.textContent = navigator.onLine === false
          ? 'You are offline. Automatic entry will resume when this device reconnects.'
          : 'Automatic entry will retry safely. Keep this page open.';
      } else {
        global.toast?.(error.message || 'Opening time could not be confirmed.', 'warn');
      }
    } finally {
      if (state.exam.preflight === check) check.requestBusy = false;
    }
  }

  function examIntegrityPolicy(rules = {}, accommodation = {}) {
    const integrityMode = typeof rules.integrityMode === 'string' ? rules.integrityMode : 'off';
    const recordingEnabled = integrityMode !== 'off'
      && accommodation.integrityExempt !== true;
    return {
      recordingEnabled,
      clipboardBlocked: recordingEnabled
        && accommodation.assistiveTechnology !== true
        && accommodation.assistiveTechnologyAllowed !== true,
    };
  }

  function clipboardEventTouchesAttempt(event, surface, selection = document.getSelection?.()) {
    if (!event || !surface) return false;
    const targetInside = Boolean(event.target && surface.contains(event.target));
    if (event.type === 'paste' || event.type === 'cut') return targetInside;
    if (event.type !== 'copy' || targetInside) return targetInside;
    if (!selection) return false;
    for (let index = 0; index < Number(selection.rangeCount || 0); index += 1) {
      try {
        if (selection.getRangeAt(index).intersectsNode(surface)) return true;
      } catch { /* a detached selection is outside the active examination surface */ }
    }
    return Boolean(
      (selection.anchorNode && surface.contains(selection.anchorNode))
      || (selection.focusNode && surface.contains(selection.focusNode)),
    );
  }

  function renderPreflight() {
    if (!isAuthenticated()) {
      state.exam.preflight = null;
      closeDialog();
      state.exam.portal = null;
      state.exam.section = 'entry';
      renderExamRoom();
      return;
    }
    const check = state.exam.preflight;
    if (!check) return;
    const server = check.server || {};
    const rules = server.rules || {};
    const integrity = examIntegrityPolicy(rules, server.accommodation || {});
    const eligible = server.eligible === true;
    const sessionConflict = server.sessionConflict === true || server.checks?.sessionConflict === true;
    const accessCodePolicy = accessCodePreflightPolicy(server, check.studentKey);
    const accessCodeRequired = accessCodePolicy.required;
    const accessCodeReady = accessCodePolicy.ready;
    const accessCodeState = studentAccessCodeState(server, check.studentKey);
    const accessCodeValidated = accessCodeState.accepted;
    const startReadiness = studentStartReadiness(server);
    const entryTiming = studentEntryTiming(server);
    const allowance = server.commercialAllowance || {};
    const allowanceSufficient = allowance.available !== true
      || allowance.sufficient === true;
    const allowanceCopy = allowance.available !== true
      ? 'Allowance will be verified again before the examination opens.'
      : allowance.unlimited === true
        ? `${allowance.accountLabel || 'Unlimited access'} covers all ${Number(allowance.requiredCount) || 0} questions.`
        : allowanceSufficient
          ? `${Number(allowance.requiredCount) || 0} questions will be held from today’s ${Number(allowance.dailyLimit) || 5}-submission Free allowance before entry.`
          : `This examination needs ${Number(allowance.requiredCount) || 0} submissions, but only ${Number(allowance.remainingToday) || 0} remain today. Reset: ${formatDate(allowance.resetAt)}.`;
    const passing = check.storage.available && check.deviceSupported && eligible
      && !sessionConflict && accessCodeReady && accessCodeValidated
      && allowanceSufficient && startReadiness.canStart;
    const accessCodePolicyCopy = accessCodeState.copy;
    const accessCodeClass = accessCodeState.className;
    openDialog(`<div class="dd26-label">Student exam check</div><h2>Check before starting</h2><p>This check confirms that you are signed in, on the class list, and opening the correct exam. The official exam clock comes from Due Diligence.</p><ul class="dd26-check-list"><li class="${check.deviceSupported ? 'is-pass' : 'is-fail'}"><strong>Device</strong><span>${check.deviceSupported ? 'Desktop or tablet is ready' : 'This phone-size screen is not supported for a formal beta exam'}</span></li><li class="${check.storage.available ? 'is-pass' : 'is-fail'}"><strong>Answer saving</strong><span>${escapeHtml(check.storage.message || check.storage.code)}</span></li><li class="${check.persistent ? 'is-pass' : 'is-warn'}"><strong>Keep answers on this device</strong><span>${check.persistent ? 'Allowed by this browser' : 'The browser may remove local data; keep the exam page open'}</span></li><li class="is-pass"><strong>Connection</strong><span>Due Diligence responded in ${escapeHtml(check.reachabilityMs)} ms · official time ${escapeHtml(formatDate(server.serverNow || server.checks?.serverNow))}</span></li><li class="${allowanceSufficient ? 'is-pass' : 'is-fail'}"><strong>Daily submission allowance</strong><span>${escapeHtml(allowanceCopy)}</span></li><li class="${eligible ? 'is-pass' : 'is-fail'}"><strong>Class list and entry</strong><span>${eligible ? 'This signed-in student is on the class list' : escapeHtml(server.message || 'This signed-in account cannot start this examination')}</span></li><li class="${accessCodeClass}"><strong>Student exam code</strong><span>${escapeHtml(accessCodePolicyCopy)}</span></li><li class="${startReadiness.canStart ? 'is-pass' : 'is-fail'}"><strong>Opening and entry time</strong><span>${escapeHtml(startReadiness.copy)}</span></li><li class="${sessionConflict ? 'is-fail' : 'is-pass'}"><strong>Open exam session</strong><span>${sessionConflict ? 'Another open session must be resolved with the Beadle' : 'No other open session was found'}</span></li><li class="${integrity.recordingEnabled ? 'is-pass' : 'is-warn'}"><strong>Exam integrity</strong><span>${integrity.recordingEnabled ? `${integrity.clipboardBlocked ? 'Copy, cut, paste, and right-click are blocked. ' : 'Exam-menu restrictions are off for an approved arrangement. '}Leaving the exam tab or window is recorded for the Professor to review. It is not automatic proof and does not automatically fail or lock the exam.` : 'Tab recording and exam-menu restrictions are off for this exam or an approved accommodation.'}</span></li></ul><details open class="dd26-rules-summary"><summary>Instructions and exam rules</summary>${studentInstructionsHtml(server.instructions)}<dl><div><dt>Exam time</dt><dd>${escapeHtml(formatDate(server.opensAt))} to ${escapeHtml(formatDate(server.serverDeadline || server.hardClosesAt))}</dd></div><div><dt>Allowed materials</dt><dd>${escapeHtml(rules.allowedMaterials || 'See the Professor’s instructions')}</dd></div><div><dt>Questions</dt><dd>${escapeHtml(rules.navigationMode === 'one_way' ? 'Move forward only' : 'You may move between questions')}</dd></div><div><dt>Leaving the exam tab</dt><dd>${escapeHtml(integrity.recordingEnabled ? 'Recorded for Professor review' : 'Not recorded for this exam or accommodation')}</dd></div><div><dt>Full screen</dt><dd>${escapeHtml(rules.fullscreenPolicy === 'off' ? 'Not requested' : 'Requested when the exam starts')}</dd></div><div><dt>Entry</dt><dd>${escapeHtml(rules.admissionMode === 'beadle_approval' ? 'Beadle confirms entry' : 'Automatic after all checks pass')}</dd></div></dl></details><label class="dd26-choice"><input id="dd26-preflight-ack" type="checkbox" ${passing ? '' : 'disabled'}><span><strong>I reviewed the instructions and exam rules</strong><small>I understand that the exam is submitted only after Due Diligence shows a receipt.</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-preflight-start" type="button" disabled>Start examination</button><button class="dd26-button" data-dd26-close-dialog type="button">Return</button></div><div class="dd26-privacy">No camera permission is requested.</div>`);
    const openingRow = [...document.querySelectorAll('.dd26-check-list li')]
      .find((row) => row.querySelector('strong')?.textContent === 'Opening and entry time');
    if (openingRow) {
      openingRow.className = entryTiming.className;
      const copy = openingRow.querySelector('span');
      if (copy) copy.textContent = entryTiming.copy;
    }
    if (sessionConflict && check.deviceInstanceHash) {
      document.querySelector('.dd26-rules-summary')?.insertAdjacentHTML('beforebegin', `<div class="dd26-notice"><strong>Device recovery reference</strong><div class="dd26-secret-row"><code id="dd26-recovery-device-reference">${escapeHtml(check.deviceInstanceHash)}</code><button class="dd26-button" data-dd26-copy-secret="dd26-recovery-device-reference" type="button">Copy</button></div><small>Give this reference and the current exam-session number ${escapeHtml(server.activeEpoch || 'shown by Due Diligence')} to the Beadle only after an in-person identity check. It is not an access key.</small></div>`);
      bindSecretCopyButtons();
    }
    const acknowledgement = document.getElementById('dd26-preflight-ack');
    const start = document.getElementById('dd26-preflight-start');
    acknowledgement?.addEventListener('change', () => { start.disabled = !acknowledgement.checked; });
    start?.addEventListener('click', () => beginAttemptAfterPreflight());
  }

  async function beginAttemptAfterPreflight(preparedFullscreenRequest = null, acknowledged = false) {
    if (!isAuthenticated()) {
      state.exam.preflight = null;
      closeDialog();
      state.exam.portal = null;
      state.exam.section = 'entry';
      renderExamRoom();
      requireAuthentication();
      return false;
    }
    const check = state.exam.preflight;
    if (!check || !(acknowledged || check.acknowledged === true
        || document.getElementById('dd26-preflight-ack')?.checked)) return false;
    if (!studentStartReadiness(check.server).canStart) {
      global.toast?.('Starting is blocked because the examination is not open for entry.', 'warn');
      return false;
    }
    if (!accessCodePreflightPolicy(check.server, check.studentKey).ready) {
      global.toast?.('Starting is blocked because the publication access-code policy is missing or unsatisfied.', 'warn');
      return false;
    }
    const shouldRequestFullscreen = check.server?.rules?.fullscreenPolicy !== 'off'
      && !check.server?.accommodation?.fullscreenExempt;
    // The browser permits full screen only while handling the student's click.
    // Start the request now, before the first network wait.
    const fullscreenRequest = preparedFullscreenRequest || (shouldRequestFullscreen
      ? requestFullscreen()
      : Promise.resolve(false));
    const button = document.getElementById('dd26-preflight-start') || document.getElementById('dd26-start-attempt');
    if (button) { button.disabled = true; button.textContent = 'Starting…'; }
    check.lastStartError = null;
    try {
      const result = check.startedAttempt || await command(check.entryMode === 'beadle'
        ? { operation: 'start_beadle_attempt', examId: check.examId }
        : { operation: 'start_attempt_by_code', studentKey: check.studentKey });
      check.startedAttempt = result;
      const session = check.startedSession || await command({
        operation: 'open_session', attemptId: result.attemptId,
        deviceInstanceHash: check.deviceInstanceHash,
        requestKey: check.sessionRequestKey ||= randomKey('session_open'),
      });
      check.startedSession = session;
      closeDialog();
      await fullscreenRequest;
      await loadAttempt(
        result.attemptId,
        { ...session, publicationId: result.publicationId },
        { throwOnFailure: true },
      );
      clearInterval(state.exam.waitingRoomTimer);
      clearTimeout(state.exam.waitingRoomPollTimer);
      state.exam.waitingRoomTimer = null;
      state.exam.waitingRoomPollTimer = null;
      if (check.entryMode === 'beadle') clearBeadleStudentHandoff(check.examId);
      state.exam.preflight = null;
      return true;
    } catch (error) {
      check.lastStartError = error;
      const enteredFullscreen = await fullscreenRequest;
      if (enteredFullscreen && document.fullscreenElement) {
        await document.exitFullscreen?.().catch(() => null);
      }
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Enter examination'; }
      if (!check.autoEntryBusy) global.toast?.(error.message, 'warn');
      return false;
    }
  }

  async function loadAttempt(attemptId, sessionSeed = null, options = {}) {
    let session = sessionSeed;
    let deviceInstanceHash = null;
    try {
      state.exam.store ||= global.DueDiligenceExaminationRoomStore?.createStore?.();
      const availability = await state.exam.store?.init?.();
      if (!availability?.available) throw new Error(availability?.message || 'IndexedDB is unavailable for this examination.');
      deviceInstanceHash = await state.exam.store.getDeviceInstanceHash();
      if (!session?.sessionId) {
        const retainedSession = await state.exam.store.getSessionEnvelope(attemptId, deviceInstanceHash);
        const retainedEpoch = Number(retainedSession?.sessionEpoch);
        if (retainedSession && Number.isInteger(retainedEpoch) && retainedEpoch > 0) {
          session = { ...retainedSession, epoch: retainedEpoch, restoredFromDevice: true };
        } else {
          if (retainedSession) await state.exam.store.clearSessionEnvelope(attemptId);
          session = await command({
            operation: 'open_session', attemptId,
            deviceInstanceHash,
            requestKey: randomKey('session_open'),
          });
        }
      }
      let payload;
      let recoveredOfflineBundle = false;
      try {
        payload = await api('/exam-room/query', {
          operation: 'attempt', attemptId,
          sessionId: session.sessionId,
          sessionEpoch: session.epoch,
        });
      } catch (error) {
        if (!session?.restoredFromDevice || !isTransientTransportFailure(error)) throw error;
        const retainedBundle = await state.exam.store.getAttemptBundle(attemptId);
        if (!retainedBundle?.bundle) throw error;
        payload = { result: retainedBundle.bundle };
        recoveredOfflineBundle = true;
        state.exam.offlineSince ||= new Date().toISOString();
      }
      state.exam.attempt = {
        ...payload.result,
        examVersionId: payload.result.examVersionId || payload.result.publicationId || session?.publicationId,
        sessionId: session.sessionId,
        sessionEpoch: session.epoch,
        answerSetHash: payload.result.answerSetHash || session.answerSetHash || null,
        offlineBundle: recoveredOfflineBundle,
        serverClockUnavailable: recoveredOfflineBundle,
      };
      if (!recoveredOfflineBundle) {
        await state.exam.store.saveAttemptBundle({
          examId: state.exam.attempt.examId,
          examVersionId: state.exam.attempt.examVersionId,
          attemptId: state.exam.attempt.attemptId,
          sessionEpoch: state.exam.attempt.sessionEpoch,
          bundle: payload.result,
        });
      }
      await state.exam.store.saveSessionEnvelope({
        examId: state.exam.attempt.examId,
        examVersionId: state.exam.attempt.examVersionId,
        attemptId: state.exam.attempt.attemptId,
        sessionId: state.exam.attempt.sessionId,
        sessionEpoch: state.exam.attempt.sessionEpoch,
        deviceInstanceHash,
        serverDeadline: state.exam.attempt.serverDeadline,
        answerSetHash: state.exam.attempt.answerSetHash,
      });
      if (!recoveredOfflineBundle) synchronizeServerClock(payload.result.serverNow);
      state.exam.attemptIndex = Math.min(state.exam.attemptIndex, Math.max(0, payload.result.questions.length - 1));
      state.exam.maxVisitedIndex = Math.max(state.exam.attemptIndex, Number(payload.result.navigationProgressIndex) || 0);
      await initializeAttemptPersistence();
      renderAttempt();
    } catch (error) {
      if (error.code === 'ATTEMPT_CLOSED') await loadSubmissionStatus(attemptId);
      else if (session?.restoredFromDevice
        && ['SESSION_EPOCH_STALE', 'EXAM_ROOM_SESSION_STALE', 'EXAM_ROOM_SESSION_EPOCH_CONFLICT', 'SESSION_ACTIVE_ELSEWHERE', 'EXAM_ROOM_V2_SESSION_REQUIRED'].includes(error.code)) {
        await state.exam.store?.quarantineAttemptQueue?.(session, error.code).catch(() => null);
        await state.exam.store?.clearSessionEnvelope?.(attemptId).catch(() => null);
        renderSubmissionRecoveryRequired('The retained writing session is no longer authoritative. Local work remains preserved for Beadle-assisted recovery.');
      }
      else global.toast?.(error.message, 'warn');
      if (options.throwOnFailure === true) throw error;
    }
  }

  function attemptScope(questionId = null) {
    const attempt = state.exam.attempt || {};
    if (!attempt.examId || !(attempt.examVersionId || attempt.publicationId) || !attempt.attemptId || attempt.sessionEpoch == null) {
      throw new Error('The server did not provide a complete immutable examination/session scope. Keep this page open and contact the Beadle.');
    }
    const scope = {
      examId: String(attempt.examId),
      examVersionId: String(attempt.examVersionId || attempt.publicationId),
      attemptId: String(attempt.attemptId),
      sessionEpoch: String(attempt.sessionEpoch),
    };
    if (questionId) scope.questionId = String(questionId);
    return scope;
  }

  async function initializeAttemptPersistence() {
    const attempt = state.exam.attempt;
    const storageApi = global.DueDiligenceExaminationRoomStore;
    if (!attempt || !storageApi) throw new Error('Secure local answer storage did not load. Keep this page open and contact the Beadle.');
    state.exam.store ||= storageApi.createStore();
    const availability = await state.exam.store.init();
    if (!availability.available) throw new Error(availability.message || 'IndexedDB is unavailable for this examination.');
    const [localAnswers, localHistory, localFlags] = await Promise.all([
      state.exam.store.getLatestAnswers(attemptScope()),
      state.exam.store.getAnswerHistory(attemptScope()),
      state.exam.store.getQuestionFlags(attemptScope()),
    ]);
    const flaggedQuestionIds = new Set(localFlags.map(String));
    let recovered = 0;
    for (const question of attempt.questions) {
      question.flagged = question.flagged === true || flaggedQuestionIds.has(String(question.id));
      const pendingForQuestion = localHistory.filter((operation) => String(operation.questionId) === String(question.id) && operation.state === 'queued');
      question.nextExpectedRevision = Math.max(
        Number(question.revision) || 0,
        ...pendingForQuestion.map((operation) => (Number(operation.baseRevision) || 0) + 1),
      );
      question.lastLocalContent = question.answer;
    }
    for (const local of localAnswers) {
      const question = attempt.questions.find((entry) => String(entry.id) === String(local.questionId));
      if (!question || local.content === question.answer) continue;
      question.answer = local.content;
      question.localOperationId = local.operationId;
      question.lastLocalContent = local.content;
      question.localOnly = local.state !== 'server_acknowledged';
      recovered += 1;
    }
    attempt.recoveryAvailable = recovered > 0;
    attempt.unresolvedConflicts = (await state.exam.store.listConflicts(attemptScope()))
      .filter((conflict) => conflict.state === 'unresolved' && conflict.reason !== 'late_evidence_quarantined');
    if (attempt.unresolvedConflicts.length) attempt.recoveryAvailable = true;
    state.exam.tabLease?.stop?.();
    attempt.readonlyTab = false;
    state.exam.tabLease = storageApi.createLeaseCoordinator({
      attemptId: attemptScope().attemptId,
      examVersionId: attemptScope().examVersionId,
      sessionEpoch: attemptScope().sessionEpoch,
      allowUncoordinatedWrite: true,
    });
    state.exam.tabLease.subscribe((lease) => {
      if (!state.exam.attempt) return;
      lease.readonly = false;
      const changed = state.exam.attempt.readonlyTab !== lease.readonly;
      state.exam.attempt.readonlyTab = lease.readonly;
      if (changed) renderAttempt();
      if (lease.readonly) setSaveStatus('Another tab is active — this tab is read-only', 'error');
    });
    await state.exam.tabLease.start();
    global.removeEventListener('online', reconnectAttempt);
    global.removeEventListener('offline', disconnectAttempt);
    global.addEventListener('online', reconnectAttempt);
    global.addEventListener('offline', disconnectAttempt);
    flushSyncQueue();
  }

  function attentionReturnMarkup() {
    return '<div class="dd26-error dd26-attention-return" id="dd26-attention-return" role="alert"><strong>You returned to the examination.</strong> Leaving the exam tab or window was recorded for the Professor and Beadle. Your answers were not erased and the timer continued. This does not automatically fail or lock your examination.<div class="dd26-actions"><button class="dd26-button primary" id="dd26-continue-after-attention" type="button">Continue examination</button></div></div>';
  }

  function dismissAttentionReturnNotice() {
    if (state.exam.attempt) state.exam.attempt.attentionReturnNotice = false;
    document.getElementById('dd26-attention-return')?.remove();
    document.getElementById('dd26-attempt-answer')?.focus();
  }

  function bindAttentionReturnNotice() {
    const button = document.getElementById('dd26-continue-after-attention');
    if (!button || button.dataset.dd26AttentionBound === 'true') return;
    button.dataset.dd26AttentionBound = 'true';
    button.addEventListener('click', dismissAttentionReturnNotice, { once: true });
  }

  function showAttentionReturnNotice() {
    const attempt = state.exam.attempt;
    const surface = document.getElementById('dd26-attempt-surface');
    if (!attempt || !surface) return;
    attempt.attentionReturnNotice = true;
    if (!document.getElementById('dd26-attention-return')) {
      const top = surface.querySelector('.dd26-attempt-top');
      if (top) top.insertAdjacentHTML('afterend', attentionReturnMarkup());
      else surface.insertAdjacentHTML('afterbegin', attentionReturnMarkup());
    }
    bindAttentionReturnNotice();
    const message = 'Leaving the exam tab or window was recorded for review. Your answers were not erased and the timer continued.';
    announceExamStatus(message);
    global.toast?.(message, 'warn');
    if (document.getElementById('dd26-dialog')?.open !== true) {
      const continueButton = document.getElementById('dd26-continue-after-attention');
      continueButton?.scrollIntoView?.({ block: 'nearest' });
      continueButton?.focus();
    }
  }

  function renderAttempt() {
    const attempt = state.exam.attempt;
    const question = attempt?.questions?.[state.exam.attemptIndex];
    if (!attempt || !question) return;
    const mutable = attempt.status === 'in_progress';
    const oneWay = attempt.rules?.navigationMode === 'one_way';
    const integrity = examIntegrityPolicy(attempt.rules || {}, attempt.accommodation || {});
    const fullscreenSignalsEnabled = integrity.recordingEnabled
      && attempt.rules?.fullscreenPolicy !== 'off'
      && !attempt.accommodation?.fullscreenExempt;
    document.body.classList.add('dd26-attempt-active');
    const answered = attempt.questions.filter((entry) => String(entry.answer || '').trim()).length;
    const flagged = attempt.questions.filter((entry) => entry.flagged).length;
    const unresolvedConflicts = attempt.unresolvedConflicts || [];
    const initialSaveState = attempt.recoveryAvailable
      ? 'Recovery available — local work restored on this device'
      : (question.localOnly ? 'Saved on this device' : question.savedAt ? `Synced at ${formatDate(question.savedAt)}` : 'Ready — changes save on this device first');
    const errataHtml = (attempt.errata || []).length
      ? `<section class="dd26-error" role="alert"><strong>Professor correction notice</strong><ul>${attempt.errata.map((entry) => `<li><strong>${escapeHtml(entry.type || 'clarification')}</strong> — ${escapeHtml(entry.body)} <small>Effective ${escapeHtml(formatDate(entry.effectiveAt || entry.issuedAt))}</small></li>`).join('')}</ul></section>`
      : '';
    const recoveryHtml = unresolvedConflicts.length
      ? `<div class="dd26-error" role="alert"><strong>${unresolvedConflicts.length} answer recovery decision${unresolvedConflicts.length === 1 ? '' : 's'} required.</strong> The local text shown here is not yet included in the answers saved by Due Diligence. Resolve it before submission.<div class="dd26-actions"><button class="dd26-button" id="dd26-resolve-conflicts" type="button">Resolve recovery</button></div></div>`
      : attempt.recoveryAvailable
        ? '<div class="dd26-notice" role="status">Local work from this examination was recovered on this device. Review it before submission; a new device can restore only server-synchronized work.</div>'
        : '';
    const offlineBundleNotice = attempt.offlineBundle
      ? '<div class="dd26-error" role="status"><strong>Offline recovery mode.</strong> This device restored the last authorized examination bundle and local answer journal. Server time is unavailable, so the browser will not decide the deadline or claim submission. Keep working here and reconnect as soon as possible.</div>'
      : '';
    const monitoringDisclosure = integrity.recordingEnabled
      ? integrity.clipboardBlocked
        ? `Examination safeguards are on. Copy, cut, and paste are blocked here. Leaving this tab or exam window${fullscreenSignalsEnabled ? ', or leaving full screen' : ''}, is recorded for the Professor and Beadle to review. Your answers remain saved, and no recorded event automatically fails, locks, submits, closes, or erases this examination.`
        : `Clipboard restrictions are off for your approved examination setup. Leaving this tab or exam window${fullscreenSignalsEnabled ? ', or leaving full screen' : ''}, is still recorded for the Professor and Beadle to review. No recorded event is automatic proof or an automatic failure.`
      : 'Tab recording and clipboard restrictions are off for this examination or approved accommodation. Connection and answer-saving problems may still be recorded so the school can help.';
    const attentionReturnHtml = attempt.attentionReturnNotice ? attentionReturnMarkup() : '';
    const navigatorHtml = attempt.questions.map((entry, index) => {
      const blockedByOneWay = oneWay && index !== state.exam.attemptIndex && index !== state.exam.attemptIndex + 1;
      return `<button type="button" data-dd26-attempt-question="${index}" class="${index === state.exam.attemptIndex ? 'is-active' : ''}${String(entry.answer || '').trim() ? ' is-saved' : ''}${entry.flagged ? ' is-flagged' : ''}" ${index === state.exam.attemptIndex ? 'aria-current="step"' : ''} ${blockedByOneWay ? 'disabled' : ''} aria-label="Question ${entry.ordinal}${String(entry.answer || '').trim() ? ', answered' : ', unanswered'}${entry.flagged ? ', flagged for review' : ''}${blockedByOneWay ? ', unavailable under one-way navigation' : ''}">${entry.ordinal}</button>`;
    }).join('');
    document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card dd26-attempt-workspace" id="dd26-attempt-surface" aria-labelledby="dd26-attempt-title"><div class="dd26-attempt-top"><div><div class="dd26-label" id="dd26-attempt-title">${escapeHtml(attempt.title)}</div><span class="dd26-save-state${mutable ? '' : ' is-error'}" id="dd26-save-state" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(mutable ? initialSaveState : 'Answer editing is unavailable; preserved work remains visible')}</span></div><div><div class="dd26-clock" id="dd26-attempt-clock" role="timer" aria-label="Time remaining">--:--:--</div><small class="dd26-clock-label">Official exam clock</small></div></div>${attentionReturnHtml}${offlineBundleNotice}${recoveryHtml}${attempt.readonlyTab ? '<div class="dd26-error" role="alert">Another tab holds the active writing lease. This tab is read-only to prevent conflicting edits.</div>' : ''}${mutable ? '' : '<div class="dd26-error" role="status">This attempt is not editable. You may review preserved answers, but no answer can change until an authorized recovery or reopen action.</div>'}${errataHtml}<details class="dd26-instructions"><summary>Examination instructions</summary>${studentInstructionsHtml(attempt.instructions || 'Follow the published instructions and permitted-materials policy.')}</details>${oneWay ? '<div class="dd26-notice"><strong>One-way navigation is enabled.</strong> After moving forward, earlier questions cannot be reopened in this workspace.</div>' : ''}<div class="dd26-integrity">${escapeHtml(monitoringDisclosure)}</div><div class="dd26-progress-summary"><span>${answered} of ${attempt.questions.length} answered</span><span>${flagged} flagged for review</span></div><div class="dd26-question-nav" aria-label="Question navigator">${navigatorHtml}</div><div class="dd26-question-meta"><span>Question ${question.ordinal} of ${attempt.questions.length}</span><span>${escapeHtml(question.maximumPoints)} points</span></div><h2 class="dd26-prompt">${escapeHtml(question.prompt)}</h2><label class="dd26-field"><span>Your answer</span><textarea class="dd26-textarea dd26-essay-editor" id="dd26-attempt-answer" maxlength="20000" ${mutable ? '' : 'readonly aria-readonly="true"'}>${escapeHtml(question.answer)}</textarea><small class="dd26-counter"><span id="dd26-attempt-words">${String(question.answer || '').trim() ? String(question.answer).trim().split(/\s+/u).length : 0} words</span><span id="dd26-attempt-count">${codePointLength(question.answer).toLocaleString()} / 20,000 characters</span></small></label><div class="dd26-actions dd26-attempt-primary-actions" aria-label="Examination controls"><button class="dd26-button" id="dd26-attempt-prev" type="button" ${oneWay || state.exam.attemptIndex === 0 ? 'disabled' : ''}>Previous</button><button class="dd26-button" id="dd26-attempt-next" type="button" ${state.exam.attemptIndex === attempt.questions.length - 1 ? 'disabled' : ''}>Next</button><button class="dd26-button ${question.flagged ? 'is-active' : ''}" id="dd26-attempt-flag" type="button" ${mutable ? '' : 'disabled'}>${question.flagged ? 'Remove flag' : 'Flag'}</button><button class="dd26-button" id="dd26-attempt-review" type="button">Review All Answers</button><button class="dd26-button primary" id="dd26-attempt-submit" type="button" ${mutable ? '' : 'disabled'}>Submit</button></div><details class="dd26-instructions dd26-attempt-support"><summary>Need to leave briefly or report a problem?</summary><div class="dd26-actions"><button class="dd26-button" id="dd26-attempt-leave" type="button" ${mutable ? '' : 'disabled'}>${attempt.activeLeave ? 'Return from temporary leave' : 'Temporary leave'}</button><button class="dd26-button" id="dd26-report-technical" type="button">Report technical issue</button></div></details>${attempt.activeLeave ? `<div class="dd26-notice">Temporary leave began ${escapeHtml(formatDate(attempt.activeLeave.departedAt))}. The examination timer continues. Return when ready; no automatic grading penalty is applied.</div>` : ''}</section>`;
    bindAttempt();
    startAttemptTimers();
  }

  function bindAttempt() {
    document.querySelectorAll('[data-dd26-attempt-question]').forEach((button) => button.addEventListener('click', () => navigateAttempt(Number(button.dataset.dd26AttemptQuestion))));
    document.getElementById('dd26-attempt-prev')?.addEventListener('click', () => navigateAttempt(state.exam.attemptIndex - 1));
    document.getElementById('dd26-attempt-next')?.addEventListener('click', () => navigateAttempt(state.exam.attemptIndex + 1));
    document.getElementById('dd26-attempt-review')?.addEventListener('click', openSubmissionReview);
    document.getElementById('dd26-attempt-submit')?.addEventListener('click', openSubmissionReview);
    document.getElementById('dd26-resolve-conflicts')?.addEventListener('click', openConflictRecovery);
    document.getElementById('dd26-attempt-flag')?.addEventListener('click', async () => {
      const question = state.exam.attempt.questions[state.exam.attemptIndex];
      question.flagged = !question.flagged;
      renderAttempt();
      try {
        await state.exam.store.saveQuestionFlags({
          ...attemptScope(),
          questionIds: state.exam.attempt.questions.filter((entry) => entry.flagged).map((entry) => entry.id),
        });
      } catch (error) {
        global.toast?.(`The flag could not be preserved on this device: ${error.message}`, 'warn');
      }
    });
    document.getElementById('dd26-attempt-leave')?.addEventListener('click', toggleTemporaryLeave);
    document.getElementById('dd26-report-technical')?.addEventListener('click', reportTechnicalIssue);
    bindAttentionReturnNotice();
    const answer = document.getElementById('dd26-attempt-answer');
    if (state.exam.attempt.status === 'in_progress') answer?.addEventListener('input', () => {
      const question = state.exam.attempt.questions[state.exam.attemptIndex];
      question.answer = answer.value;
      document.getElementById('dd26-attempt-count').textContent = `${codePointLength(answer.value).toLocaleString()} / 20,000 characters`;
      document.getElementById('dd26-attempt-words').textContent = `${answer.value.trim() ? answer.value.trim().split(/\s+/u).length : 0} words`;
      queueAnswerSave(question);
    });
    document.removeEventListener('visibilitychange', visibilityIncident);
    global.removeEventListener('blur', blurIncident);
    global.removeEventListener('focus', focusReturnIncident);
    document.removeEventListener('fullscreenchange', fullscreenIncident);
    document.removeEventListener('copy', clipboardIncident, true);
    document.removeEventListener('cut', clipboardIncident, true);
    document.removeEventListener('paste', clipboardIncident, true);
    document.removeEventListener('contextmenu', contextMenuIncident, true);
    const integrity = examIntegrityPolicy(state.exam.attempt.rules || {}, state.exam.attempt.accommodation || {});
    if (integrity.recordingEnabled && state.exam.attempt.status === 'in_progress') {
      document.addEventListener('visibilitychange', visibilityIncident);
      global.addEventListener('blur', blurIncident);
      global.addEventListener('focus', focusReturnIncident);
      if (state.exam.attempt.rules?.fullscreenPolicy !== 'off'
        && !state.exam.attempt.accommodation?.fullscreenExempt) {
        document.addEventListener('fullscreenchange', fullscreenIncident);
      }
    }
    if (integrity.clipboardBlocked && state.exam.attempt.status === 'in_progress') {
      document.addEventListener('copy', clipboardIncident, true);
      document.addEventListener('cut', clipboardIncident, true);
      document.addEventListener('paste', clipboardIncident, true);
      document.addEventListener('contextmenu', contextMenuIncident, true);
    }
  }

  async function navigateAttempt(index) {
    const oneWay = state.exam.attempt?.rules?.navigationMode === 'one_way';
    if (oneWay && (index < state.exam.attemptIndex || index > state.exam.attemptIndex + 1)) {
      global.toast?.('Earlier or skipped questions are unavailable under the published one-way navigation policy.', 'warn');
      return;
    }
    const question = state.exam.attempt?.questions?.[state.exam.attemptIndex];
    if (question) await flushLocalAnswer(question);
    state.exam.attemptIndex = Math.max(0, Math.min(index, state.exam.attempt.questions.length - 1));
    state.exam.maxVisitedIndex = Math.max(state.exam.maxVisitedIndex, state.exam.attemptIndex);
    renderAttempt();
    document.getElementById('dd26-attempt-answer')?.focus();
  }

  function flushBeforeAttentionExit() {
    void flushAllLocalSaves().catch(() => {
      setSaveStatus('Save problem — keep this page open and contact the Beadle', 'error');
    });
  }

  function visibilityIncident() {
    if (!state.exam.attempt) return;
    if (document.hidden) {
      clearTimeout(state.exam.blurIncidentTimer);
      state.exam.blurIncidentTimer = null;
      state.exam.tabReturnPending = 'visibility';
      flushBeforeAttentionExit();
      recordIncident('visibility_exit', { visibilityState: document.visibilityState });
      return;
    }
    if (state.exam.tabReturnPending === 'visibility') {
      state.exam.tabReturnPending = false;
      showAttentionReturnNotice();
    }
  }

  function blurIncident() {
    if (!state.exam.attempt) return;
    clearTimeout(state.exam.blurIncidentTimer);
    state.exam.blurIncidentTimer = setTimeout(() => {
      if (document.hidden || document.hasFocus() || !state.exam.attempt) return;
      state.exam.tabReturnPending = 'focus';
      flushBeforeAttentionExit();
      recordIncident('focus_exit', { active: false });
    }, 150);
  }

  function focusReturnIncident() {
    clearTimeout(state.exam.blurIncidentTimer);
    state.exam.blurIncidentTimer = null;
    if (state.exam.tabReturnPending !== 'focus' || !state.exam.attempt) return;
    state.exam.tabReturnPending = false;
    showAttentionReturnNotice();
  }

  function clipboardIncident(event) {
    const attempt = state.exam.attempt;
    const surface = document.getElementById('dd26-attempt-surface');
    if (!attempt || attempt.status !== 'in_progress' || !surface
        || !examIntegrityPolicy(attempt.rules || {}, attempt.accommodation || {}).clipboardBlocked
        || !clipboardEventTouchesAttempt(event, surface)) return;
    event.preventDefault();
    const eventType = event.type === 'paste' ? 'paste_attempt' : 'copy_attempt';
    recordIncident(eventType, { action: event.type, blocked: true, surface: 'examination' });
    const now = Date.now();
    if (now - state.exam.lastIntegrityNoticeAt > 1200) {
      state.exam.lastIntegrityNoticeAt = now;
      const message = 'Copy, cut, and paste are blocked during this examination.';
      announceExamStatus(message);
      global.toast?.(message, 'warn');
    }
  }

  function contextMenuIncident(event) {
    const attempt = state.exam.attempt;
    const surface = document.getElementById('dd26-attempt-surface');
    if (!attempt || attempt.status !== 'in_progress' || !surface
        || !examIntegrityPolicy(attempt.rules || {}, attempt.accommodation || {}).clipboardBlocked
        || !event.target || !surface.contains(event.target)) return;
    event.preventDefault();
    recordIncident('context_menu_attempt', { action: 'right_click', blocked: true, surface: 'examination' });
    const now = Date.now();
    if (now - state.exam.lastIntegrityNoticeAt > 1200) {
      state.exam.lastIntegrityNoticeAt = now;
      global.toast?.('Right-click is blocked during this examination.', 'warn');
    }
  }

  function fullscreenIncident() { if (state.exam.attempt && !document.fullscreenElement) recordIncident('fullscreen_exit', { fullscreen: false }); }

  async function recordIncident(eventType, details) {
    const attempt = state.exam.attempt;
    if (!attempt) return;
    if (['network_gap', 'heartbeat_gap'].includes(eventType)) {
      const mappedType = eventType === 'heartbeat_gap'
        ? 'sync_problem'
        : details?.state === 'reconnected' ? 'connectivity_restored' : 'connectivity_lost';
      await recordTechnicalIncident(mappedType, details);
      return;
    }
    if (attempt.rules?.integrityMode === 'off' || attempt.accommodation?.integrityExempt) return;
    try {
      await command({
        operation: 'record_integrity_event',
        attemptId: attempt.attemptId,
        sessionId: attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
        clientEventId: randomUuid(),
        eventType,
        details,
        clientOccurredAt: new Date().toISOString(),
      });
      if (['visibility_exit', 'focus_exit'].includes(eventType)) {
        attempt.attentionDepartureCount = Number(attempt.attentionDepartureCount || 0) + 1;
      }
      if (attempt.rules?.integrityMode === 'warn_and_record'
          && ['visibility_exit', 'focus_exit'].includes(eventType)
          && Number(attempt.attentionDepartureCount) === 2) {
        global.toast?.('Repeated browser attention changes were recorded for human review. They are signals, not proof.', 'warn');
      }
    } catch { /* incident transport failures are surfaced through heartbeat state */ }
  }

  async function recordTechnicalIncident(eventType, details = {}) {
    const attempt = state.exam.attempt;
    if (!attempt) return false;
    try {
      await command({
        operation: 'record_technical_incident',
        attemptId: attempt.attemptId,
        sessionId: attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
        clientEventId: randomUuid(),
        eventType,
        details,
        clientOccurredAt: new Date().toISOString(),
      });
      return true;
    } catch { return false; /* technical reporting is non-authoritative and must not block answering */ }
  }

  async function reportTechnicalIssue() {
    const note = String(global.prompt('Briefly describe the technical issue. Do not include an answer, password, diagnosis, or other unnecessary personal data.', '') || '').trim();
    if (!note) return;
    if (note.length > 500) {
      global.toast?.('Keep the technical note to 500 characters or fewer.', 'warn');
      return;
    }
    const recorded = await recordTechnicalIncident('support_requested', { note });
    global.toast?.(recorded
      ? 'Technical issue recorded for the Beadle and Professor. Continue working if you safely can.'
      : 'The technical note could not reach the server. Your answers remain saved on this device; tell the Beadle directly if you safely can.', recorded ? 'ok' : 'warn');
  }

  function queueAnswerSave(question) {
    setSaveStatus('Saving on this device…');
    clearTimeout(state.exam.saveTimers.get(question.id));
    state.exam.saveTimers.set(question.id, setTimeout(() => flushLocalAnswer(question), 350));
  }

  function setSaveStatus(message, tone = '') {
    const status = document.getElementById('dd26-save-state');
    if (!status) return;
    status.textContent = message;
    status.className = `dd26-save-state${tone === 'saved' ? ' is-saved' : tone === 'error' ? ' is-error' : ''}`;
  }

  async function flushLocalAnswer(question) {
    if (!question || !state.exam.store) return null;
    clearTimeout(state.exam.saveTimers.get(question.id));
    state.exam.saveTimers.delete(question.id);
    const inFlight = state.exam.localSavePromises.get(question.id);
    if (inFlight) return inFlight;
    if (question.lastLocalContent === question.answer) return question.localOperationId || null;
    const savePromise = (async () => {
      while (question.lastLocalContent !== question.answer) {
        const contentAtStart = String(question.answer ?? '');
        const baseRevision = Number(question.nextExpectedRevision ?? question.revision) || 0;
        const saved = await state.exam.store.saveAnswer({
          ...attemptScope(question.id),
          content: contentAtStart,
          baseRevision,
          offlineSince: state.exam.offlineSince ? new Date(state.exam.offlineSince).getTime() : null,
          outageEvidence: state.exam.offlineSince ? { clientReportedOffline: true } : null,
        });
        question.localOperationId = saved.operation.operationId;
        question.localContentHash = saved.operation.contentHash;
        question.localSequence = saved.operation.localSequence;
        question.nextExpectedRevision = baseRevision + 1;
        question.lastLocalContent = contentAtStart;
        question.localOnly = true;
      }
      setSaveStatus(global.navigator.onLine === false ? 'Offline — saved on this device' : 'Saved on this device', 'saved');
      flushSyncQueue();
      return question.localOperationId || null;
    })();
    state.exam.localSavePromises.set(question.id, savePromise);
    try {
      return await savePromise;
    } catch (error) {
      setSaveStatus('Save problem — keep this page open and contact the Beadle', 'error');
      global.toast?.(error.message, 'warn');
      throw error;
    } finally {
      if (state.exam.localSavePromises.get(question.id) === savePromise) {
        state.exam.localSavePromises.delete(question.id);
      }
    }
  }

  async function flushAllLocalSaves() {
    const questions = state.exam.attempt?.questions || [];
    const results = await Promise.allSettled(questions.map((question) => flushLocalAnswer(question)));
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) {
      throw new AggregateError(failures, 'One or more answers could not be preserved in IndexedDB. Keep this page open and contact the Beadle.');
    }
  }

  async function flushSyncQueue() {
    if (!state.exam.store || !state.exam.attempt) return;
    if (state.exam.syncing) {
      state.exam.syncRequested = true;
      return;
    }
    state.exam.syncing = true;
    state.exam.syncRequested = false;
    clearTimeout(state.exam.syncTimer);
    try {
      const scope = attemptScope();
      const pending = await state.exam.store.getPendingOperations({
        availableAt: Number.MAX_SAFE_INTEGER,
        limit: 250,
        attemptId: scope.attemptId,
        sessionEpoch: scope.sessionEpoch,
      });
      const relevant = pending
        .filter((operation) => operation.attemptId === scope.attemptId && operation.sessionEpoch === scope.sessionEpoch)
        .sort((left, right) => left.localSequence - right.localSequence);
      for (const operation of relevant) {
        if (Number(operation.nextAttemptAt) > Date.now()) {
          state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(250, Number(operation.nextAttemptAt) - Date.now()));
          break;
        }
        if (operation.kind === 'attempt.submit') {
          try { await sendPendingSubmission(operation); } catch { /* retained for bounded retry */ }
          break;
        }
        if (operation.kind !== 'answer.save') continue;
        setSaveStatus('Syncing…');
        try {
          const result = await command({
            operation: 'save_answer_operation',
            operationId: operation.operationId,
            examId: operation.examId,
            examVersionId: operation.examVersionId,
            attemptId: operation.attemptId,
            questionId: operation.questionId,
            sessionId: state.exam.attempt.sessionId,
            sessionEpoch: operation.sessionEpoch,
            localSequence: operation.localSequence,
            expectedRevision: operation.baseRevision,
            answerText: operation.content,
            contentHash: operation.contentHash,
            clientSavedAt: new Date(operation.clientSavedAt || operation.createdAt).toISOString(),
            offlineSince: operation.offlineSince == null ? null : new Date(operation.offlineSince).toISOString(),
            outageEvidence: operation.outageEvidence || {},
          });
          if (result.acceptedAsAnswer === false || result.disposition === 'late_evidence') {
            await state.exam.store.recordConflict({
              conflictId: result.conflictBranchId,
              operationId: operation.operationId,
              serverRevision: result.serverRevision,
              serverContentHash: result.serverContentHash,
              serverContent: result.serverAnswerText,
              reason: 'late_evidence_quarantined',
            });
            const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(operation.questionId));
            if (question) { question.localOnly = true; question.lateEvidence = true; }
            state.exam.attempt.answerSetHash = result.answerSetHash || state.exam.attempt.answerSetHash;
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.excludedLocalWork = true;
            setSaveStatus('Recovery available — a post-deadline local edit was preserved as evidence, not accepted as an answer', 'error');
            continue;
          }
          const revision = result.acceptedRevision ?? result.revision;
          await state.exam.store.acknowledgeOperation({ operationId: operation.operationId, serverRevision: revision, acknowledgedAt: Date.now() });
          const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(operation.questionId));
          if (question && question.localOperationId === operation.operationId) {
            question.revision = revision;
            question.nextExpectedRevision = Math.max(Number(question.nextExpectedRevision) || 0, Number(revision) || 0);
            question.savedAt = result.savedAt || result.acknowledgedAt || new Date().toISOString();
            question.localOnly = false;
          }
          state.exam.attempt.answerSetHash = result.answerSetHash || state.exam.attempt.answerSetHash;
          setSaveStatus(`Synced at ${formatDate(result.savedAt || result.acknowledgedAt || new Date().toISOString())}`, 'saved');
        } catch (error) {
          if (['ANSWER_CONFLICT', 'STALE_ANSWER', 'EXAM_ROOM_LOCAL_SEQUENCE_REUSED', 'LOCAL_SEQUENCE_REUSED'].includes(error.code)) {
            if (['EXAM_ROOM_LOCAL_SEQUENCE_REUSED', 'LOCAL_SEQUENCE_REUSED'].includes(error.code)) {
              try {
                const latest = await api('/exam-room/query', {
                  operation: 'attempt', attemptId: operation.attemptId,
                  sessionId: state.exam.attempt.sessionId,
                  sessionEpoch: operation.sessionEpoch,
                });
                const serverQuestion = latest.result?.questions?.find((entry) => String(entry.id) === String(operation.questionId));
                if (serverQuestion) {
                  error.serverRevision = serverQuestion.revision;
                  error.serverContentHash = serverQuestion.contentHash;
                  error.serverAnswerText = serverQuestion.answer;
                }
              } catch { /* retain the local branch even if the refresh also fails */ }
            }
            const conflict = await state.exam.store.recordConflict({
              conflictId: error.conflictBranchId,
              operationId: operation.operationId,
              serverRevision: error.serverRevision,
              serverContentHash: error.serverContentHash,
              serverContent: error.serverAnswerText,
              reason: error.code,
            });
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.unresolvedConflicts ||= [];
            if (!state.exam.attempt.unresolvedConflicts.some((entry) => entry.conflictId === conflict.conflictId)) {
              state.exam.attempt.unresolvedConflicts.push(conflict);
            }
            setSaveStatus('Recovery available — a newer server revision was preserved', 'error');
          } else if (['SESSION_EPOCH_STALE', 'EXAM_ROOM_SESSION_STALE', 'EXAM_ROOM_SESSION_EPOCH_CONFLICT', 'SESSION_ACTIVE_ELSEWHERE'].includes(error.code)) {
            await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
            await state.exam.store.clearSessionEnvelope(state.exam.attempt.attemptId);
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.status = 'recovery_pending';
            state.exam.attempt.readonlyTab = true;
            setSaveStatus('Recovery required — this session can no longer write', 'error');
            renderAttempt();
          } else if (['ATTEMPT_CLOSED', 'EXAM_ROOM_ATTEMPT_CLOSED'].includes(error.code)) {
            await state.exam.store.recordConflict({
              operationId: operation.operationId,
              serverRevision: error.serverRevision,
              serverContentHash: error.serverContentHash,
              serverContent: error.serverAnswerText,
              reason: 'attempt_closed_unaccepted',
            });
            state.exam.attempt.recoveryAvailable = true;
            state.exam.attempt.excludedLocalWork = true;
            await loadSubmissionStatus(operation.attemptId);
          } else {
            const retryOptions = { errorCode: error.code || 'network_error' };
            if (isTransientTransportFailure(error)) {
              const observedAt = Date.now();
              const localSavedAt = Number(operation.clientSavedAt || operation.createdAt || observedAt);
              state.exam.transportFailureSince ||= observedAt;
              state.exam.offlineSince ||= new Date(Math.min(localSavedAt, observedAt)).toISOString();
              retryOptions.offlineSince = Math.min(localSavedAt, observedAt);
              retryOptions.outageEvidence = {
                clientReportedTransportFailure: true,
                firstObservedAt: new Date(state.exam.transportFailureSince).toISOString(),
                lastObservedAt: new Date(observedAt).toISOString(),
              };
            }
            const retry = await state.exam.store.markOperationAttempt(operation.operationId, retryOptions);
            setSaveStatus(global.navigator.onLine === false ? 'Offline — saved on this device' : 'Reconnecting…');
            state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(250, (retry?.nextAttemptAt || Date.now() + 1000) - Date.now()));
          }
          break;
        }
      }
      if (state.exam.attempt && relevant.length === 250 && !state.exam.syncTimer) {
        state.exam.syncRequested = true;
      }
      if (state.exam.attempt && !state.exam.submissionPending) {
        const remaining = await state.exam.store.getPendingOperations({
          availableAt: Number.MAX_SAFE_INTEGER,
          limit: 1,
          attemptId: scope.attemptId,
          sessionEpoch: scope.sessionEpoch,
        });
        if (!remaining.some((operation) => operation.kind === 'answer.save')) {
          state.exam.offlineSince = null;
          state.exam.transportFailureSince = null;
        }
      }
    } finally {
      state.exam.syncing = false;
      if (state.exam.syncRequested) {
        state.exam.syncRequested = false;
        queueMicrotask(flushSyncQueue);
      }
    }
  }

  function disconnectAttempt() {
    if (!state.exam.attempt) return;
    state.exam.offlineSince ||= new Date().toISOString();
    setSaveStatus('Offline — saved on this device', 'saved');
    recordIncident('network_gap', { state: 'offline' });
  }

  function reconnectAttempt() {
    if (!state.exam.attempt) return;
    setSaveStatus('Reconnecting…');
    recordIncident('network_gap', { state: 'reconnected' });
    flushSyncQueue();
    sendHeartbeat();
  }

  function startAttemptTimers() {
    const attempt = state.exam.attempt;
    const timerKey = attempt
      ? `${attempt.attemptId || ''}:${attempt.sessionId || ''}:${attempt.sessionEpoch || ''}`
      : null;
    if (timerKey && state.exam.attemptTimerKey === timerKey
        && state.exam.countdownTimer && state.exam.heartbeatTimer && state.exam.safetySaveTimer) {
      updateAttemptClock();
      return;
    }
    clearInterval(state.exam.countdownTimer);
    clearInterval(state.exam.heartbeatTimer);
    clearInterval(state.exam.safetySaveTimer);
    clearTimeout(state.exam.submissionStatusTimer);
    state.exam.attemptTimerKey = timerKey;
    updateAttemptClock();
    state.exam.countdownTimer = setInterval(updateAttemptClock, 1000);
    state.exam.heartbeatTimer = setInterval(sendHeartbeat, 60000);
    state.exam.safetySaveTimer = setInterval(() => {
      if (!state.exam.attempt || state.exam.attempt.status !== 'in_progress') return;
      void flushAllLocalSaves()
        .then(() => flushSyncQueue())
        .catch(() => setSaveStatus('Draft held on this device — keep this page open', 'error'));
    }, 30000);
  }

  function clearAttemptTimers() {
    clearInterval(state.exam.countdownTimer);
    clearInterval(state.exam.heartbeatTimer);
    clearInterval(state.exam.safetySaveTimer);
    clearInterval(state.exam.waitingRoomTimer);
    clearTimeout(state.exam.waitingRoomPollTimer);
    clearTimeout(state.exam.submissionStatusTimer);
    clearTimeout(state.exam.professorRoomPollTimer);
    state.exam.countdownTimer = null;
    state.exam.heartbeatTimer = null;
    state.exam.safetySaveTimer = null;
    state.exam.attemptTimerKey = null;
    state.exam.waitingRoomTimer = null;
    state.exam.waitingRoomPollTimer = null;
    state.exam.waitingRoomPolling = false;
    state.exam.submissionStatusTimer = null;
    state.exam.professorRoomPollTimer = null;
    state.exam.professorRoomPolling = false;
    state.exam.professorRoomGeneration += 1;
    document.removeEventListener('visibilitychange', visibilityIncident);
    global.removeEventListener('blur', blurIncident);
    global.removeEventListener('focus', focusReturnIncident);
    document.removeEventListener('fullscreenchange', fullscreenIncident);
    document.removeEventListener('copy', clipboardIncident, true);
    document.removeEventListener('cut', clipboardIncident, true);
    document.removeEventListener('paste', clipboardIncident, true);
    document.removeEventListener('contextmenu', contextMenuIncident, true);
    global.removeEventListener('online', reconnectAttempt);
    global.removeEventListener('offline', disconnectAttempt);
    document.body.classList.remove('dd26-attempt-active');
    state.exam.tabLease?.stop?.();
    state.exam.tabLease = null;
    clearTimeout(state.exam.syncTimer);
    clearTimeout(state.exam.blurIncidentTimer);
    state.exam.blurIncidentTimer = null;
    state.exam.tabReturnPending = false;
    state.exam.lastIntegrityNoticeAt = 0;
    if (state.exam.attempt) state.exam.attempt.attentionReturnNotice = false;
  }

  function updateAttemptClock() {
    const clock = document.getElementById('dd26-attempt-clock');
    if (!clock || !state.exam.attempt) return;
    if (state.exam.attempt.serverClockUnavailable) {
      clock.textContent = 'OFFLINE';
      clock.setAttribute('aria-label', 'Server countdown unavailable while offline');
      clock.classList.add('is-alert');
      const label = clock.nextElementSibling;
      if (label) label.textContent = 'Reconnect for server time';
      return;
    }
    const remaining = Math.max(0, new Date(state.exam.attempt.serverDeadline).getTime() - currentServerTimeMs());
    const seconds = Math.ceil(remaining / 1000);
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60;
    clock.textContent = [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
    clock.classList.toggle('is-alert', seconds <= 300);
    if (seconds === 0) {
      clearInterval(state.exam.countdownTimer);
      clearInterval(state.exam.heartbeatTimer);
      clearInterval(state.exam.safetySaveTimer);
      state.exam.countdownTimer = null;
      state.exam.heartbeatTimer = null;
      state.exam.safetySaveTimer = null;
      if (state.exam.attempt.status === 'in_progress') submitAttempt(true);
      else loadSubmissionStatus(state.exam.attempt.attemptId);
    }
  }

  async function sendHeartbeat() {
    try {
      const result = await command({
        operation: 'heartbeat_v2',
        attemptId: state.exam.attempt.attemptId,
        sessionId: state.exam.attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
      });
      if (result.serverNow) synchronizeServerClock(result.serverNow);
      state.exam.attempt.offlineBundle = false;
      state.exam.attempt.serverClockUnavailable = false;
      state.exam.attempt.serverDeadline = result.serverDeadline || state.exam.attempt.serverDeadline;
      if (result.status !== 'in_progress') await loadSubmissionStatus(state.exam.attempt.attemptId);
    } catch { recordIncident('heartbeat_gap', { durationSeconds: 60 }); }
  }

  async function toggleTemporaryLeave() {
    const attempt = state.exam.attempt;
    if (!attempt) return;
    if (attempt.readonlyTab || attempt.status !== 'in_progress') {
      global.toast?.('This tab is read-only. Use the active writing tab for leave controls.', 'warn');
      return;
    }
    try {
      if (attempt.activeLeave) {
        const result = await command({ operation: 'end_leave', attemptId: attempt.attemptId, sessionId: attempt.sessionId, sessionEpoch: attemptScope().sessionEpoch, requestKey: randomKey('leave_end') });
        attempt.activeLeave = null;
        global.toast?.(`Temporary leave ended after ${result.elapsedMinutes || 'the recorded'} minutes.`, 'ok');
      } else {
        const entered = String(global.prompt('Leave type: comfort_room, medical, technical, or other. Do not include diagnosis details.', 'comfort_room') || '').trim().toLowerCase();
        if (!['comfort_room', 'medical', 'technical', 'other'].includes(entered)) { global.toast?.('Choose a listed leave type.', 'warn'); return; }
        const result = await command({ operation: 'start_leave', attemptId: attempt.attemptId, sessionId: attempt.sessionId, sessionEpoch: attemptScope().sessionEpoch, reasonCode: entered, requestKey: randomKey('leave_start') });
        attempt.activeLeave = { id: result.leaveId, departedAt: result.departedAt || new Date().toISOString() };
        global.toast?.('Temporary leave recorded. The examination timer continues.', 'ok');
      }
      renderAttempt();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function unresolvedAnswerConflicts() {
    if (!state.exam.store || !state.exam.attempt) return [];
    const conflicts = await state.exam.store.listConflicts(attemptScope());
    const unresolved = conflicts.filter((conflict) => conflict.state === 'unresolved'
      && conflict.reason !== 'late_evidence_quarantined');
    state.exam.attempt.unresolvedConflicts = unresolved;
    return unresolved;
  }

  async function openConflictRecovery() {
    const conflicts = await unresolvedAnswerConflicts();
    if (!conflicts.length) {
      global.toast?.('No unresolved answer recovery remains.', 'ok');
      renderAttempt();
      return;
    }
    openDialog(`<div class="dd26-label">Answer recovery</div><h2>Choose which text to continue with</h2><div class="dd26-error" role="alert">These local answers are not yet included in the answers saved by Due Diligence. Submission is blocked until you choose the correct text for each question. A new retry may still require Professor review if the exam deadline has passed.</div>${conflicts.map((conflict) => { const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(conflict.localOperation?.questionId)); return `<section class="dd26-section"><h3>Question ${escapeHtml(question?.ordinal || conflict.localOperation?.questionId || '')}</h3><div class="dd26-form-grid"><div><div class="dd26-label">Preserved on this device</div><p class="dd26-long-cell">${escapeHtml(conflict.localOperation?.content || 'No local text')}</p></div><div><div class="dd26-label">Saved by Due Diligence</div><p class="dd26-long-cell">${escapeHtml(conflict.serverContent || 'No server text')}</p></div></div><div class="dd26-actions"><button class="dd26-button" data-dd26-conflict-server="${escapeHtml(conflict.conflictId)}" type="button">Use saved version</button><button class="dd26-button primary" data-dd26-conflict-retry="${escapeHtml(conflict.conflictId)}" type="button">Retry my device version</button></div></section>`; }).join('')}<div class="dd26-actions"><button class="dd26-button" data-dd26-close-dialog type="button">Return without deciding</button></div>`, { persistent: true });
    document.querySelectorAll('[data-dd26-conflict-server]').forEach((button) => button.addEventListener('click', () => resolveAnswerConflict(button.dataset.dd26ConflictServer, 'accept_server')));
    document.querySelectorAll('[data-dd26-conflict-retry]').forEach((button) => button.addEventListener('click', () => resolveAnswerConflict(button.dataset.dd26ConflictRetry, 'retry_local')));
  }

  async function resolveAnswerConflict(conflictId, resolution) {
    const conflicts = await unresolvedAnswerConflicts();
    const conflict = conflicts.find((entry) => entry.conflictId === conflictId);
    if (!conflict) return;
    const question = state.exam.attempt.questions.find((entry) => String(entry.id) === String(conflict.localOperation?.questionId));
    if (!question) {
      global.toast?.('The conflicted question is not in this immutable examination version.', 'warn');
      return;
    }
    try {
      if (resolution === 'retry_local') {
        const content = String(conflict.localOperation?.content || '');
        const saved = await state.exam.store.saveAnswer({
          ...attemptScope(question.id),
          content,
          baseRevision: Number(conflict.serverRevision) || 0,
          offlineSince: state.exam.offlineSince ? new Date(state.exam.offlineSince).getTime() : null,
          outageEvidence: state.exam.offlineSince ? { clientReportedOffline: true } : null,
        });
        await state.exam.store.resolveConflict({ conflictId, resolution });
        question.answer = content;
        question.lastLocalContent = content;
        question.localOperationId = saved.operation.operationId;
        question.localContentHash = saved.operation.contentHash;
        question.localSequence = saved.operation.localSequence;
        question.revision = Number(conflict.serverRevision) || 0;
        question.nextExpectedRevision = (Number(conflict.serverRevision) || 0) + 1;
        question.localOnly = true;
        flushSyncQueue();
      } else {
        await state.exam.store.resolveConflict({ conflictId, resolution });
        question.answer = String(conflict.serverContent || '');
        question.lastLocalContent = question.answer;
        question.localOperationId = null;
        question.revision = Number(conflict.serverRevision) || 0;
        question.nextExpectedRevision = Number(conflict.serverRevision) || 0;
        question.localOnly = false;
      }
      const remaining = await unresolvedAnswerConflicts();
      if (remaining.length) await openConflictRecovery();
      else {
        state.exam.attempt.recoveryAvailable = Boolean(state.exam.attempt.excludedLocalWork);
        closeDialog();
        renderAttempt();
        global.toast?.('Answer recovery decision recorded.', 'ok');
      }
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function openSubmissionReview() {
    try {
      if (state.exam.attempt?.status !== 'in_progress') {
        global.toast?.('This examination is not currently open for submission.', 'warn');
        return;
      }
      await flushAllLocalSaves();
      if ((await unresolvedAnswerConflicts()).length) {
        await openConflictRecovery();
        return;
      }
      const questions = state.exam.attempt?.questions || [];
      const unanswered = questions.filter((question) => !String(question.answer || '').trim());
      const flagged = questions.filter((question) => question.flagged);
      openDialog(`<div class="dd26-label">Final review</div><h2>Review before submission</h2><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${questions.length - unanswered.length}</strong><span>Answered</span></div><div class="dd26-stat"><strong>${unanswered.length}</strong><span>Unanswered</span></div><div class="dd26-stat"><strong>${flagged.length}</strong><span>Flagged</span></div><div class="dd26-stat"><strong>${questions.length}</strong><span>Total</span></div></div>${unanswered.length ? `<div class="dd26-error">Unanswered: ${unanswered.map((question) => question.ordinal).join(', ')}</div>` : '<div class="dd26-success">Every question has an answer on this device.</div>'}${flagged.length ? `<div class="dd26-notice">Flagged for review: ${flagged.map((question) => question.ordinal).join(', ')}</div>` : ''}<p>Due Diligence will first synchronize queued answer operations, then request one server receipt using the same stable submission key on every retry.</p><label class="dd26-choice"><input id="dd26-submit-ack" type="checkbox"><span><strong>I intend to submit this examination</strong><small>I understand that only a server receipt confirms submission. If offline, the intent remains pending and local work stays on this device.</small></span></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-confirm-submit" type="button" disabled>Submit and request receipt</button><button class="dd26-button" data-dd26-close-dialog type="button">Return to answers</button></div>`);
      const acknowledgement = document.getElementById('dd26-submit-ack')?.closest('.dd26-choice');
      const review = document.createElement('section');
      review.className = 'dd26-section dd26-submission-answer-review';
      review.setAttribute('aria-label', 'Question and answer review');
      review.innerHTML = `<h3>Review every question and answer</h3>${questions.map((entry, index) => {
        const mayEdit = state.exam.attempt.rules?.navigationMode !== 'one_way' || index >= state.exam.attemptIndex;
        return `<article class="dd26-card"><div class="dd26-question-meta"><strong>Question ${escapeHtml(entry.ordinal)}</strong>${entry.flagged ? '<span class="dd26-status">Flagged</span>' : ''}</div><p class="dd26-prompt">${escapeHtml(entry.prompt)}</p><div class="dd26-notice"><strong>Your answer</strong><p class="dd26-long-cell">${escapeHtml(String(entry.answer || '').trim() || 'No answer entered.')}</p></div><button class="dd26-button compact" data-dd26-review-edit="${index}" type="button" ${mayEdit ? '' : 'disabled'}>${mayEdit ? 'Edit this answer' : 'Earlier answer locked by one-way navigation'}</button></article>`;
      }).join('')}`;
      acknowledgement?.before(review);
      review.querySelectorAll('[data-dd26-review-edit]').forEach((button) => button.addEventListener('click', async () => {
        closeDialog();
        await navigateAttempt(Number(button.dataset.dd26ReviewEdit));
      }));
      const checkbox = document.getElementById('dd26-submit-ack');
      const submit = document.getElementById('dd26-confirm-submit');
      checkbox?.addEventListener('change', () => { submit.disabled = !checkbox.checked; });
      submit?.addEventListener('click', () => submitAttempt(false));
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function submitAttempt(automatic = false) {
    try {
      if (!automatic && state.exam.attempt?.status !== 'in_progress') {
        global.toast?.('This examination is not currently open for submission.', 'warn');
        return;
      }
      await flushAllLocalSaves();
      const conflicts = await unresolvedAnswerConflicts();
      if (conflicts.length && !automatic) {
        await openConflictRecovery();
        return;
      }
      if (conflicts.length) state.exam.attempt.excludedLocalWork = true;
      const localAnswers = await state.exam.store.getLatestAnswers(attemptScope());
      const clientPendingAt = Date.now();
      const offlineSince = global.navigator.onLine === false
        ? Math.min(new Date(state.exam.offlineSince || clientPendingAt).getTime(), clientPendingAt)
        : null;
      const intentResult = await state.exam.store.ensureSubmissionIntent(attemptScope(), {
        intentId: state.exam.submissionKey || undefined,
        answerOperationIds: localAnswers.map((answer) => answer.operationId),
        clientPendingAt,
        offlineSince,
        outageEvidence: offlineSince == null ? null : { clientReportedOffline: true },
      });
      state.exam.submissionKey = intentResult.intent.intentId;
      state.exam.submissionPending = true;
      closeDialog();
      renderPendingSubmission(automatic);
      await flushSyncQueue();
    } catch (error) {
      closeDialog();
      if (state.exam.submissionKey) {
        state.exam.submissionPending = true;
        renderPendingSubmission(automatic, error.message);
      } else {
        state.exam.submissionPending = false;
        renderSubmissionPreparationFailure(automatic, error.message);
      }
    }
  }

  function renderSubmissionPreparationFailure(automatic = false, detail = '') {
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    host.innerHTML = `<section class="dd26-card"><div class="dd26-label">${automatic ? 'Deadline reached' : 'Submission preparation'}</div><h2>Submission was not prepared</h2><div class="dd26-error" role="alert"><strong>No server receipt or durable submission intent was created.</strong> One or more answers could not be confirmed in local IndexedDB. Keep this page open and do not clear browser data.</div>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-retry-preparation" type="button">Retry preservation and submission</button><button class="dd26-button" id="dd26-return-answers" type="button">Return to answers</button></div></section>`;
    document.getElementById('dd26-retry-preparation')?.addEventListener('click', () => submitAttempt(automatic));
    document.getElementById('dd26-return-answers')?.addEventListener('click', renderAttempt);
  }

  async function sendPendingSubmission(operation) {
    if (!state.exam.attempt || operation.attemptId !== attemptScope().attemptId) return;
    const allQueued = await state.exam.store.getPendingOperations({
      availableAt: Number.MAX_SAFE_INTEGER,
      limit: 250,
      attemptId: operation.attemptId,
      sessionEpoch: operation.sessionEpoch,
    });
    const unsyncedAnswers = allQueued.filter((entry) => entry.kind === 'answer.save'
      && entry.attemptId === operation.attemptId && entry.sessionEpoch === operation.sessionEpoch);
    if (unsyncedAnswers.length) {
      setSaveStatus('Syncing answers before submission…');
      const nextAttemptAt = Math.min(...unsyncedAnswers.map((entry) => Number(entry.nextAttemptAt) || Date.now() + 1000));
      state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(250, nextAttemptAt - Date.now()));
      return false;
    }
    if (!state.exam.attempt.answerSetHash) {
      renderPendingSubmission(false, 'Waiting for Due Diligence to confirm the saved answers.');
      state.exam.syncTimer = setTimeout(() => refreshAttemptHash(operation.attemptId), 1000);
      return false;
    }
    try {
      const result = await command({
        operation: 'submit_attempt_generation',
        attemptId: operation.attemptId,
        sessionId: state.exam.attempt.sessionId,
        sessionEpoch: operation.sessionEpoch,
        requestKey: operation.intentId,
        answerSetHash: state.exam.attempt.answerSetHash,
        clientPendingAt: new Date(operation.clientPendingAt || operation.createdAt).toISOString(),
        offlineSince: operation.offlineSince == null ? null : new Date(operation.offlineSince).toISOString(),
        outageEvidence: operation.outageEvidence || {},
      });
      const receipt = result.receipt || result;
      await state.exam.store.confirmSubmissionReceipt({
        intentId: operation.intentId,
        receiptId: receipt.receiptId || receipt.submissionId,
        receiptToken: receipt.receiptToken,
        submittedAt: new Date(receipt.receivedAt || receipt.submittedAt || Date.now()).getTime(),
      });
      state.exam.submissionPending = false;
      state.exam.offlineSince = null;
      showSubmissionReceipt(receipt);
    } catch (error) {
      if (error.code === 'ANSWER_SET_MISMATCH') {
        state.exam.attempt.answerSetHash = null;
        const retry = await state.exam.store.markOperationAttempt(operation.operationId, { errorCode: error.code });
        state.exam.submissionPending = true;
        renderPendingSubmission(false, examCodeMessage(error.code));
        state.exam.syncTimer = setTimeout(
          () => refreshAttemptHash(operation.attemptId),
          Math.max(500, (retry?.nextAttemptAt || Date.now() + 1000) - Date.now()),
        );
        return false;
      }
      if (['SESSION_EPOCH_STALE', 'EXAM_ROOM_SESSION_STALE', 'EXAM_ROOM_SESSION_EPOCH_CONFLICT', 'SESSION_ACTIVE_ELSEWHERE', 'EXAM_ROOM_V2_SESSION_REQUIRED'].includes(error.code)) {
        await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
        await state.exam.store.clearSessionEnvelope(state.exam.attempt.attemptId);
        state.exam.submissionPending = false;
        state.exam.attempt.recoveryAvailable = true;
        state.exam.attempt.status = 'recovery_pending';
        state.exam.attempt.readonlyTab = true;
        renderSubmissionRecoveryRequired('This writing session is no longer authoritative. Local work was retained for recovery; the Beadle must verify the candidate before an authorized session transfer.');
        return false;
      }
      if (['ATTEMPT_CLOSED', 'EXAM_ROOM_ATTEMPT_CLOSED'].includes(error.code)) {
        await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
        state.exam.submissionPending = false;
        state.exam.attempt.recoveryAvailable = true;
        state.exam.attempt.excludedLocalWork = true;
        await loadSubmissionStatus(operation.attemptId);
        return false;
      }
      if (error.code === 'EXAM_ROOM_SUBMISSION_REQUEST_CONFLICT') {
        await state.exam.store.quarantineAttemptQueue(attemptScope(), error.code);
        state.exam.submissionPending = false;
        state.exam.attempt.recoveryAvailable = true;
        state.exam.attempt.status = 'recovery_pending';
        state.exam.attempt.readonlyTab = true;
        renderSubmissionRecoveryRequired('The stable submission key was previously used with different content. No retry is safe. Local work was retained; contact the Professor or Beadle for an audited review.');
        return false;
      }
      const retryOptions = { errorCode: error.code || 'submission_transport_error' };
      if (isTransientTransportFailure(error)) {
        const observedAt = Date.now();
        const intentCreatedAt = Number(operation.createdAt || operation.clientPendingAt || observedAt);
        state.exam.transportFailureSince ||= observedAt;
        state.exam.offlineSince ||= new Date(Math.min(intentCreatedAt, observedAt)).toISOString();
        retryOptions.offlineSince = Math.min(intentCreatedAt, observedAt);
        retryOptions.outageEvidence = {
          clientReportedTransportFailure: true,
          firstObservedAt: new Date(state.exam.transportFailureSince).toISOString(),
          lastObservedAt: new Date(observedAt).toISOString(),
        };
      }
      const retry = await state.exam.store.markOperationAttempt(operation.operationId, retryOptions);
      state.exam.submissionPending = true;
      renderPendingSubmission(false, error.message);
      state.exam.syncTimer = setTimeout(flushSyncQueue, Math.max(500, (retry?.nextAttemptAt || Date.now() + 1000) - Date.now()));
      throw error;
    }
  }

  function renderSubmissionRecoveryRequired(detail) {
    clearAttemptTimers();
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    host.innerHTML = `<section class="dd26-card"><div class="dd26-label">Submission recovery</div><h2>Operator review required</h2><div class="dd26-error" role="alert"><strong>No new server receipt was issued.</strong> ${escapeHtml(detail)}</div><p>Do not clear browser data. A new device can restore only server-synchronized work; this device retains a bounded recovery copy for review.</p><div class="dd26-actions"><button class="dd26-button" id="dd26-return-recovery-portal" type="button">Return to Examination Room</button></div></section>`;
    document.getElementById('dd26-return-recovery-portal')?.addEventListener('click', () => refreshExamPortal('student'));
  }

  async function refreshAttemptHash(attemptId) {
    try {
      const attempt = state.exam.attempt;
      if (!attempt || attempt.attemptId !== attemptId) return;
      const payload = await api('/exam-room/query', {
        operation: 'attempt', attemptId,
        sessionId: attempt.sessionId,
        sessionEpoch: attemptScope().sessionEpoch,
      });
      state.exam.attempt.answerSetHash = payload.result?.answerSetHash || state.exam.attempt.answerSetHash;
      flushSyncQueue();
    } catch { state.exam.syncTimer = setTimeout(() => refreshAttemptHash(attemptId), 2000); }
  }

  function renderPendingSubmission(automatic = false, detail = '') {
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    host.innerHTML = `<section class="dd26-card"><div class="dd26-label">${automatic ? 'Deadline reached' : 'Final submission'}</div><h2>Submission pending — not yet received by Due Diligence</h2><div class="dd26-notice" role="status">Your submission intent and latest local answer journal remain on this device. Keep this page open and reconnect. Do not treat this screen as a receipt.</div>${detail ? `<div class="dd26-error">${escapeHtml(detail)}</div>` : ''}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-retry-submission" type="button">Retry synchronization</button></div><p class="dd26-privacy">A late server receipt is evaluated under the professor’s configured grace/review policy with outage evidence; the device clock is not authoritative.</p></section>`;
    document.getElementById('dd26-retry-submission')?.addEventListener('click', () => {
      setSaveStatus('Reconnecting…');
      flushSyncQueue();
    });
  }

  async function loadSubmissionStatus(attemptId, pollCount = 0) {
    try {
      clearTimeout(state.exam.submissionStatusTimer);
      state.exam.submissionStatusTimer = null;
      const payload = await api('/exam-room/query', { operation: 'submission_status', attemptId });
      const status = payload.result;
      if (status?.ok !== true) throw new Error(examCodeMessage(status?.code));
      if (status.receiptId && status.receivedAt && isClosedAttemptStatus(status.status)) {
        try {
          state.exam.store ||= global.DueDiligenceExaminationRoomStore?.createStore?.();
          const availability = await state.exam.store?.init?.();
          if (availability?.available) {
            await state.exam.store.reconcileServerReceipt({
              attemptId: status.attemptId || attemptId,
              examId: status.examId,
              examVersionId: status.examVersionId,
              receiptId: status.receiptId,
              receivedAt: status.receivedAt,
              submittedAt: status.submittedAt,
              snapshotHash: status.snapshotHash,
            });
            await state.exam.store.cleanupConfirmed();
          }
        } catch (localError) {
          status.localRetentionWarning = 'The server receipt is valid, but this browser could not schedule its local recovery-data cleanup. Do not clear data needed for a dispute; retry from this device later.';
          console.warn('Examination Room receipt reconciliation failed.', localError);
        }
        showSubmissionReceipt(status);
        return;
      }
      clearAttemptTimers();
      const host = document.getElementById('dd26-exam-main');
      if (!host) return;
      host.innerHTML = `<section class="dd26-card"><div class="dd26-label">Server finalization</div><h2>Deadline reached — server receipt pending</h2><div class="dd26-notice" role="status">The server has not issued a receipt yet. This is not a “Submitted” confirmation. Due Diligence will check again without asking the browser clock to decide the result.</div><dl class="dd26-publish-summary"><div><dt>Attempt</dt><dd>${escapeHtml(status.attemptId || attemptId)}</dd></div><div><dt>Current server state</dt><dd>${escapeHtml(status.status || 'processing')}</dd></div><div><dt>Last checked</dt><dd>${escapeHtml(formatDate(status.serverNow))}</dd></div></dl><div class="dd26-actions"><button class="dd26-button primary" id="dd26-refresh-submission-status" type="button">Check for receipt</button><button class="dd26-button" id="dd26-return-status-portal" type="button">Return to Examination Room</button></div></section>`;
      document.getElementById('dd26-refresh-submission-status')?.addEventListener('click', () => loadSubmissionStatus(attemptId, 0));
      document.getElementById('dd26-return-status-portal')?.addEventListener('click', () => refreshExamPortal('student'));
      if (pollCount < 20) {
        state.exam.submissionStatusTimer = setTimeout(() => loadSubmissionStatus(attemptId, pollCount + 1), 3000);
      }
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function downloadSubmissionAnswerCopy(receipt, attempt) {
    const questions = Array.isArray(attempt?.questions) ? attempt.questions : [];
    const lines = [
      'DUE DILIGENCE — EXAMINATION ANSWER COPY',
      `Examination: ${attempt?.title || receipt.examVersionId || 'Examination'}`,
      `Receipt: ${receipt.receiptId || receipt.submissionId || 'Recorded'}`,
      `Received: ${formatDate(receipt.receivedAt || receipt.submittedAt)}`,
      '',
      ...questions.flatMap((question) => [
        `QUESTION ${question.ordinal}`,
        String(question.prompt || ''),
        '',
        'YOUR ANSWER',
        String(question.answer || '').trim() || '[No answer entered]',
        '',
        '────────────────────────────────────────',
        '',
      ]),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `due-diligence-answer-copy-${String(receipt.receiptId || 'receipt').replace(/[^a-zA-Z0-9_-]/g, '-')}.txt`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function showSubmissionReceipt(receipt) {
    clearAttemptTimers();
    const host = document.getElementById('dd26-exam-main');
    if (!host) return;
    const activeAttempt = state.exam.attempt;
    const recoveryEvidenceCount = Number(receipt.lateRecoveryEvidenceCount) || 0;
    const excludedLocalWork = activeAttempt?.excludedLocalWork === true || recoveryEvidenceCount > 0;
    const examVersionId = receipt.examVersionId || activeAttempt?.examVersionId || activeAttempt?.publicationId || 'Recorded in server receipt';
    const receiptAttemptId = receipt.attemptId || activeAttempt?.attemptId || 'Recorded in server receipt';
    if (receiptAttemptId && receiptAttemptId !== 'Recorded in server receipt') {
      state.exam.store?.clearSessionEnvelope?.(receiptAttemptId).catch(() => null);
    }
    host.innerHTML = `<section class="dd26-card"><div class="dd26-success" role="status"><strong>Submission received by Due Diligence.</strong> This receipt—not the earlier pending screen—confirms delivery.</div>${excludedLocalWork ? `<div class="dd26-error" role="alert"><strong>A saved answer needs review.</strong> ${recoveryEvidenceCount || 'At least one'} local edit${recoveryEvidenceCount === 1 ? '' : 's'} was kept separately and was not included in the answers confirmed by this receipt. Contact the Professor or Beadle and give them this receipt number.</div>` : ''}<div class="dd26-receipt"><div class="dd26-label">Submission receipt</div><h2>${escapeHtml(receipt.receiptId || receipt.submissionId || 'Receipt recorded')}</h2><dl><div><dt>Examination</dt><dd>${escapeHtml(examVersionId)}</dd></div><div><dt>Due Diligence exam record</dt><dd>${escapeHtml(receiptAttemptId)}</dd></div><div><dt>Received by Due Diligence</dt><dd>${escapeHtml(formatDate(receipt.receivedAt || receipt.submittedAt))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(receipt.status || 'received')}</dd></div><div><dt>Confirmation number</dt><dd><code>${escapeHtml(receipt.answerSnapshotHash || receipt.snapshotHash || 'Recorded in this receipt')}</code></dd></div><div><dt>Connection and exam review</dt><dd>${escapeHtml(receipt.incidentReviewStatus || (excludedLocalWork ? 'A saved answer is waiting for review' : 'No record automatically determines misconduct'))}</dd></div></dl></div><div class="dd26-actions"><button class="dd26-button" id="dd26-return-portal" type="button">Return to Examination Room</button></div><p class="dd26-privacy">Local work remains for a short recovery period after this confirmed receipt; storage on this browser is not permanent.</p></section>`;
    const receiptActions = host.querySelector('.dd26-actions');
    if (receiptActions && activeAttempt?.questions?.length && !excludedLocalWork) {
      const answerCopyButton = document.createElement('button');
      answerCopyButton.className = 'dd26-button';
      answerCopyButton.id = 'dd26-download-answer-copy';
      answerCopyButton.type = 'button';
      answerCopyButton.textContent = 'Download my answer copy';
      answerCopyButton.addEventListener('click', () => downloadSubmissionAnswerCopy(receipt, activeAttempt));
      receiptActions.prepend(answerCopyButton);
    }
    if (receipt.localRetentionWarning) {
      const localRetentionNotice = document.createElement('div');
      localRetentionNotice.className = 'dd26-notice';
      localRetentionNotice.setAttribute('role', 'status');
      localRetentionNotice.textContent = receipt.localRetentionWarning;
      host.querySelector('.dd26-success')?.insertAdjacentElement('afterend', localRetentionNotice);
    }
    const retentionNotice = host.querySelector('.dd26-privacy');
    if (retentionNotice) retentionNotice.textContent = 'Confirmed local recovery data is retained for up to seven days and removed on a later Examination Room open; browser-local storage is not permanent.';
    state.exam.attempt = null;
    document.getElementById('dd26-return-portal')?.addEventListener('click', () => refreshExamPortal('student'));
  }

  async function loadStudentResult(examId) {
    try {
      const payload = await api('/exam-room/query', { operation: 'student_result', examId });
      const result = payload.result;
      document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><div class="dd26-label">Released result</div><h2>${escapeHtml(result.title)}</h2><p>Student exam number ${escapeHtml(result.candidateNumber)} · Released ${escapeHtml(formatDate(result.releasedAt))}</p><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Question</th>${result.includeQuestionnaire ? '<th>Questionnaire</th>' : ''}<th>Score</th><th>Professor comment</th></tr></thead><tbody>${(result.grades || []).map((grade) => `<tr><td>${grade.ordinal}</td>${result.includeQuestionnaire ? `<td>${escapeHtml(grade.question)}</td>` : ''}<td>${escapeHtml(grade.score)} / ${escapeHtml(grade.maximumPoints)}</td><td>${escapeHtml(grade.comment)}</td></tr>`).join('')}</tbody></table></div></section>`;
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function stopProfessorRoomPolling() {
    clearTimeout(state.exam.professorRoomPollTimer);
    state.exam.professorRoomPollTimer = null;
    state.exam.professorRoomPolling = false;
    state.exam.professorRoomGeneration += 1;
  }

  function professorRoomAccessPrompt(examId, message = '') {
    openDialog(`<div class="dd26-label">Professor virtual room</div><h2>Verify this Professor account once</h2><p>${escapeHtml(message || 'Enter the one-time Professor grading key. After verification, this signed-in Professor account can return on another device without entering the key again.')}</p><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-monitor-key" type="password" autocomplete="one-time-code"></label><div class="dd26-error" id="dd26-monitor-access-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-load-monitor" type="button">Enter virtual room</button></div>`);
    state.exam.activeExamId = examId;
    document.getElementById('dd26-load-monitor')?.addEventListener('click', loadLiveStatus);
  }

  function professorCandidateStatus(candidate) {
    const status = String(candidate?.status || candidate?.state || 'not_started').toLowerCase();
    if (status === 'submitted') return 'Submitted';
    if (status === 'auto_submitted') return 'Auto-submitted';
    if (status === 'locked') return 'Present · needs assistance';
    if (status === 'active' || status === 'in_progress') return 'Present · taking exam';
    if (status === 'closed') return 'Exam closed';
    return 'Not yet present';
  }

  function normalizeProfessorRoomCandidates(value) {
    return (Array.isArray(value) ? value : []).map((candidate) => ({
      ...candidate,
      status: candidate.state || candidate.status || 'not_started',
      canReopenSubmission: candidate.canReopenSubmission === true,
      reopenBlockedReason: candidate.reopenBlockedReason || 'REOPEN_ELIGIBILITY_UNAVAILABLE',
      priorReceiptId: candidate.priorReceiptId || candidate.latestReceiptId,
      incidentCount: Number(candidate.incidentCount) || 0,
      focusExitCount: Number(candidate.focusExitCount) || 0,
      clipboardAttemptCount: Number(candidate.clipboardAttemptCount) || 0,
    }));
  }

  function scheduleProfessorRoomRefresh(examId, generation, delay = PROFESSOR_ROOM_REFRESH_MS) {
    clearTimeout(state.exam.professorRoomPollTimer);
    if (!examId || generation !== state.exam.professorRoomGeneration) return;
    state.exam.professorRoomPollTimer = setTimeout(() => {
      if (generation !== state.exam.professorRoomGeneration || state.exam.activeExamId !== examId) return;
      void refreshProfessorVirtualRoom({ examId, generation, silent: true });
    }, document.hidden ? Math.max(delay, PROFESSOR_ROOM_RETRY_MS) : delay);
  }

  async function refreshProfessorVirtualRoom({
    examId = state.exam.activeExamId,
    gradingKey = '',
    generation = state.exam.professorRoomGeneration,
    silent = false,
  } = {}) {
    if (!examId || generation !== state.exam.professorRoomGeneration) return false;
    if (state.exam.professorRoomPolling) {
      if (!silent) global.toast?.('The virtual room is already refreshing.', 'ok');
      return false;
    }
    state.exam.professorRoomPolling = true;
    try {
      const payload = await api('/exam-room/query', {
        operation: 'live_status_v2', examId, gradingKey: String(gradingKey || ''),
      });
      if (generation !== state.exam.professorRoomGeneration || state.exam.activeExamId !== examId) return false;
      const result = payload?.result || {};
      if (result.ok !== true) {
        const error = new Error(result.code === 'GRADING_KEY_REQUIRED'
          ? 'Enter the Professor grading key once to open this virtual room.'
          : 'Professor access to this virtual room could not be verified.');
        error.code = result.code || 'EXAM_ROOM_LIVE_STATUS_DENIED';
        throw error;
      }
      state.exam.monitoring = {
        ...result,
        candidates: normalizeProfessorRoomCandidates(result.candidates),
        loading: false,
        refreshError: '',
        refreshedAt: new Date().toISOString(),
      };
      const accessPromptIsOpen = Boolean(document.getElementById('dd26-monitor-key'));
      if (accessPromptIsOpen) closeDialog();
      const unrelatedDialogIsOpen = document.getElementById('dd26-dialog')?.open === true;
      if (!unrelatedDialogIsOpen) renderLiveStatus({ focus: !silent });
      scheduleProfessorRoomRefresh(examId, generation);
      return true;
    } catch (error) {
      if (generation !== state.exam.professorRoomGeneration || state.exam.activeExamId !== examId) return false;
      const needsKey = ['GRADING_KEY_REQUIRED', 'CREDENTIAL_INVALID', 'CREDENTIAL_LOCKED', 'CREDENTIAL_NOT_ACTIVE']
        .includes(String(error.code || ''));
      if (needsKey) {
        stopProfessorRoomPolling();
        state.exam.monitoring = null;
        professorRoomAccessPrompt(examId, error.message);
        return false;
      }
      state.exam.monitoring = {
        ...(state.exam.monitoring || { examId, candidates: [] }),
        loading: false,
        refreshError: 'Live status could not refresh. The last confirmed classroom view remains on screen.',
      };
      if (document.getElementById('dd26-dialog')?.open !== true) renderLiveStatus({ focus: !silent });
      scheduleProfessorRoomRefresh(examId, generation, PROFESSOR_ROOM_RETRY_MS);
      if (!silent) global.toast?.(error.message, 'warn');
      return false;
    } finally {
      if (generation === state.exam.professorRoomGeneration) state.exam.professorRoomPolling = false;
    }
  }

  async function openLiveStatus(examId, gradingKey = '') {
    if (!examId) return false;
    stopProfessorRoomPolling();
    const generation = state.exam.professorRoomGeneration;
    state.exam.activeExamId = examId;
    state.exam.professorRoomReturnExamId = null;
    state.exam.monitoring = {
      examId,
      title: 'Professor virtual Examination Room',
      status: 'Loading',
      candidates: [],
      loading: true,
      refreshError: '',
    };
    renderLiveStatus();
    return refreshProfessorVirtualRoom({ examId, gradingKey, generation });
  }

  async function loadLiveStatus() {
    const keyInput = document.getElementById('dd26-monitor-key');
    const gradingKey = String(keyInput?.value || '');
    const errorHost = document.getElementById('dd26-monitor-access-error');
    if (!gradingKey) {
      if (errorHost) {
        errorHost.hidden = false;
        errorHost.textContent = 'Enter the one-time Professor grading key.';
      }
      keyInput?.focus();
      return false;
    }
    if (keyInput) keyInput.value = '';
    const examId = state.exam.activeExamId;
    closeDialog();
    return openLiveStatus(examId, gradingKey);
  }

  function renderLiveStatus({ focus = true } = {}) {
    const monitor = state.exam.monitoring;
    const host = document.getElementById('dd26-exam-main');
    if (!host || !monitor) return;
    const activeControl = !focus && host.contains(document.activeElement) ? document.activeElement : null;
    const activeControlIdentity = activeControl ? {
      id: activeControl.id || '',
      unlockAttemptId: activeControl.dataset?.dd26UnlockLive || '',
      reopenAttemptId: activeControl.dataset?.dd26ReopenSubmission || '',
    } : null;
    const candidates = Array.isArray(monitor.candidates) ? monitor.candidates : [];
    const submitted = candidates.filter((candidate) => ['submitted', 'auto_submitted'].includes(String(candidate.status))).length;
    const taking = candidates.filter((candidate) => ['active', 'in_progress', 'locked'].includes(String(candidate.status))).length;
    const notPresent = candidates.filter((candidate) => !candidate.startedAt && !['submitted', 'auto_submitted'].includes(String(candidate.status))).length;
    const incidents = candidates.reduce((total, candidate) => total + (Number(candidate.incidentCount) || 0), 0);
    if (monitor.loading) {
      host.innerHTML = `<section class="dd26-card dd26-professor-room"><div class="dd26-professor-room-loading" role="status" aria-live="polite"><span class="dd26-room-spinner" aria-hidden="true"></span><div><div class="dd26-label">Professor virtual Examination Room</div><h2>Opening the live classroom…</h2><p>Confirming your saved Professor access and the latest class status.</p></div></div><div class="dd26-actions"><button class="dd26-button" id="dd26-return-professor" type="button">Back to Professor workspace</button></div></section>`;
      document.getElementById('dd26-return-professor')?.addEventListener('click', () => {
        stopProfessorRoomPolling();
        state.exam.monitoring = null;
        void refreshExamPortal('professor');
      });
      return;
    }
    const candidateRows = candidates.map((candidate) => {
      const closed = ['submitted', 'auto_submitted'].includes(String(candidate.status));
      const reopenAction = candidate.canReopenSubmission === true && candidate.attemptId
        ? `<button class="dd26-button compact danger" data-dd26-reopen-submission="${escapeHtml(candidate.attemptId)}" type="button">Allow another submission</button>`
        : closed
          ? `<span class="dd26-help" title="${escapeHtml(candidate.reopenBlockedReason || 'Another submission is unavailable.')}">Receipt saved</span>`
          : '';
      const unlockAction = candidate.status === 'locked' && candidate.attemptId
        ? `<button class="dd26-button compact danger" data-dd26-unlock-live="${escapeHtml(candidate.attemptId)}" type="button">Unlock</button>`
        : '';
      const incidentCopy = candidate.incidentCount
        ? `<strong>${escapeHtml(candidate.incidentCount)} for review</strong><small>${escapeHtml(candidate.focusExitCount)} tab/focus · ${escapeHtml(candidate.clipboardAttemptCount)} copy/paste/right-click</small>`
        : '<span>No recorded incidents</span>';
      return `<tr><td><strong>${escapeHtml(candidate.studentName || candidate.candidateNumber || 'Student')}</strong><br><small>${escapeHtml(candidate.studentNumber || candidate.candidateNumber || 'No student number')}</small></td><td><span class="dd26-live-state is-${escapeHtml(String(candidate.status || 'not_started').replace(/[^a-z0-9_-]/gi, '-'))}">${escapeHtml(professorCandidateStatus(candidate))}</span><br><small>${candidate.submittedAt ? `Submitted ${escapeHtml(formatDate(candidate.submittedAt))}` : candidate.startedAt ? `Entered ${escapeHtml(formatDate(candidate.startedAt))}` : 'Waiting for student entry'}</small></td><td class="dd26-integrity-summary">${incidentCopy}${candidate.lastIncidentAt ? `<small>Latest ${escapeHtml(formatDate(candidate.lastIncidentAt))}</small>` : ''}</td><td>${candidate.lastHeartbeatAt ? escapeHtml(formatDate(candidate.lastHeartbeatAt)) : 'No connection yet'}</td><td><div class="dd26-actions">${unlockAction}${reopenAction}${!unlockAction && !reopenAction ? '—' : ''}</div></td></tr>`;
    }).join('');
    const waitingCopy = !monitor.rosterReady
      ? `<div class="dd26-professor-room-waiting" role="status"><span class="dd26-room-spinner" aria-hidden="true"></span><div><strong>Waiting for the Beadle to upload and confirm a valid class list.</strong><p>This room will update automatically. The Professor may safely leave and return on any signed-in device.</p></div></div>`
      : !monitor.studentAccessReady
        ? '<div class="dd26-notice" role="status"><strong>Class list confirmed.</strong> Waiting for the Beadle to create the student examination code.</div>'
        : '';
    const refreshWarning = monitor.refreshError
      ? `<div class="dd26-notice dd26-professor-room-warning" role="status">${escapeHtml(monitor.refreshError)}</div>` : '';
    host.innerHTML = `<section class="dd26-card dd26-professor-room"><section class="dd26-section"><div class="dd26-question-meta"><div><div class="dd26-label">Professor virtual Examination Room</div><h2>${escapeHtml(monitor.title || 'Live classroom')}</h2><p>Attendance, submission progress, and recorded integrity events update here. Active student answers remain private; submitted examinations open only in grading.</p></div><span class="dd26-status">${escapeHtml(monitor.status || 'Published')}</span></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-room-grade-submitted" type="button" ${submitted ? '' : 'disabled'}>Grade submitted exams${submitted ? ` (${escapeHtml(submitted)})` : ''}</button><button class="dd26-button" id="dd26-room-download" type="button">Download current workbook</button><button class="dd26-button" id="dd26-room-results" type="button">Class results dashboard</button><button class="dd26-button" id="dd26-refresh-monitor" type="button">Refresh now</button><button class="dd26-button" id="dd26-return-professor" type="button">Back to Professor workspace</button></div><p class="dd26-help">Saved Professor access works across signed-in devices. Live status refreshes every 15 seconds with one bounded request at a time. Last confirmed ${escapeHtml(formatDate(monitor.refreshedAt))}.</p></section>${refreshWarning}<div class="dd26-stat-grid dd26-professor-room-stats"><div class="dd26-stat"><strong>${escapeHtml(taking)}</strong><span>Present and taking</span></div><div class="dd26-stat"><strong>${escapeHtml(notPresent)}</strong><span>Not yet present</span></div><div class="dd26-stat"><strong>${escapeHtml(submitted)}</strong><span>Submitted</span></div><div class="dd26-stat"><strong>${escapeHtml(incidents)}</strong><span>Events for review</span></div></div>${waitingCopy}${candidates.length ? `<section class="dd26-section"><div class="dd26-question-meta"><h3>Class attendance and progress</h3><span class="dd26-status">${escapeHtml(candidates.length)} on class list</span></div><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Student</th><th>Current status</th><th>Integrity review</th><th>Last connection</th><th>Professor action</th></tr></thead><tbody>${candidateRows}</tbody></table></div></section>` : '<div class="dd26-empty">No students are on the confirmed class list yet.</div>'}</section>`;
    document.getElementById('dd26-refresh-monitor')?.addEventListener('click', () => {
      const generation = state.exam.professorRoomGeneration;
      void refreshProfessorVirtualRoom({ examId: monitor.examId, generation, silent: false });
    });
    document.getElementById('dd26-room-grade-submitted')?.addEventListener('click', () => {
      state.exam.professorRoomReturnExamId = monitor.examId;
      openGrading(monitor.examId);
    });
    document.getElementById('dd26-room-download')?.addEventListener('click', () => openClassResultsDialog(monitor.examId));
    document.getElementById('dd26-room-results')?.addEventListener('click', () => {
      stopProfessorRoomPolling();
      void openResultsDashboard(monitor.examId);
    });
    document.getElementById('dd26-return-professor')?.addEventListener('click', () => {
      stopProfessorRoomPolling();
      state.exam.monitoring = null;
      void refreshExamPortal('professor');
    });
    document.querySelectorAll('[data-dd26-unlock-live]').forEach((button) => button.addEventListener('click', () => openUnlockMonitoredAttempt(button.dataset.dd26UnlockLive)));
    document.querySelectorAll('[data-dd26-reopen-submission]').forEach((button) => button.addEventListener('click', () => openReopenSubmission(button.dataset.dd26ReopenSubmission)));
    if (focus) {
      host.focus();
    } else if (activeControlIdentity) {
      const replacement = (activeControlIdentity.id && document.getElementById(activeControlIdentity.id))
        || [...host.querySelectorAll('[data-dd26-unlock-live]')]
          .find((button) => button.dataset.dd26UnlockLive === activeControlIdentity.unlockAttemptId)
        || [...host.querySelectorAll('[data-dd26-reopen-submission]')]
          .find((button) => button.dataset.dd26ReopenSubmission === activeControlIdentity.reopenAttemptId);
      replacement?.focus({ preventScroll: true });
    }
  }

  function openReopenSubmission(attemptId) {
    const candidate = (state.exam.monitoring?.candidates || [])
      .find((entry) => entry.attemptId === attemptId);
    if (!candidate || candidate.canReopenSubmission !== true) {
      global.toast?.('Due Diligence did not allow another submission for this student.', 'warn');
      return;
    }
    const now = new Date();
    const defaultDeadline = new Date(now.getTime() + 60 * 60 * 1000);
    openDialog(`<div class="dd26-label">Special action for one student</div><h2>Allow another submission</h2><div class="dd26-error" role="alert"><strong>The first submission is never opened or replaced.</strong> Its receipt and submitted answers remain saved. This gives the student one new answer session and a new deadline.</div><dl class="dd26-publish-summary"><div><dt>Student</dt><dd>${escapeHtml(candidate.candidateNumber)}</dd></div><div><dt>Current submission round</dt><dd>${escapeHtml(candidate.generation || 1)}</dd></div><div><dt>First receipt</dt><dd>${escapeHtml(candidate.priorReceiptId || candidate.receiptId || 'Saved by Due Diligence')}</dd></div></dl><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-reopen-grading-key" type="password" autocomplete="one-time-code" required><small class="dd26-help">Used only for this request and then cleared.</small></label><label class="dd26-field"><span>New deadline (maximum four hours from now)</span><input class="dd26-input" id="dd26-reopen-deadline" type="datetime-local" min="${localDateValue(now)}" max="${localDateValue(new Date(now.getTime() + 4 * 60 * 60 * 1000))}" value="${localDateValue(defaultDeadline)}" required></label><label class="dd26-field"><span>Reason</span><textarea class="dd26-textarea compact" id="dd26-reopen-reason" minlength="20" maxlength="1000" required></textarea></label><label class="dd26-choice"><input id="dd26-reopen-ack" type="checkbox"><span><strong>I authorize one new answer session for this student only</strong><small>The first submission and receipt remain saved. Due Diligence will reject a deadline more than four hours from now.</small></span></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-reopen" type="button" disabled>Allow another submission</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    const acknowledgement = document.getElementById('dd26-reopen-ack');
    const confirmButton = document.getElementById('dd26-confirm-reopen');
    const updateState = () => {
      const deadline = new Date(value('dd26-reopen-deadline'));
      const deadlineMs = deadline.getTime();
      const currentMs = Date.now();
      confirmButton.disabled = !acknowledgement.checked
        || !value('dd26-reopen-grading-key', false)
        || value('dd26-reopen-reason').length < 20
        || !Number.isFinite(deadlineMs)
        || deadlineMs <= currentMs
        || deadlineMs > currentMs + (4 * 60 * 60 * 1000);
    };
    acknowledgement?.addEventListener('change', updateState);
    document.getElementById('dd26-reopen-reason')?.addEventListener('input', updateState);
    document.getElementById('dd26-reopen-grading-key')?.addEventListener('input', updateState);
    document.getElementById('dd26-reopen-deadline')?.addEventListener('input', updateState);
    confirmButton?.addEventListener('click', () => reopenSubmission(attemptId));
  }

  async function reopenSubmission(attemptId) {
    const button = document.getElementById('dd26-confirm-reopen');
    if (!button || !document.getElementById('dd26-reopen-ack')?.checked) return;
    const reason = value('dd26-reopen-reason');
    const gradingKeyInput = document.getElementById('dd26-reopen-grading-key');
    const gradingKey = String(gradingKeyInput?.value || '');
    const newDeadline = new Date(value('dd26-reopen-deadline'));
    if (!gradingKey || reason.length < 20 || !Number.isFinite(newDeadline.getTime())) return;
    gradingKeyInput.value = '';
    button.disabled = true;
    button.textContent = 'Opening another answer session…';
    try {
      const result = await command({
        operation: 'reopen_submission', attemptId,
        newDeadline: newDeadline.toISOString(), reason,
        gradingKey,
        requestKey: randomKey('reopen_submission'),
      });
      if (result?.ok !== true || result.attemptId !== attemptId
          || result.requiresNewSession !== true
          || !(Number(result.generation) > Number(result.priorGeneration))
          || !result.priorReceiptId || !result.priorSnapshotHash) {
        throw new Error('Due Diligence did not confirm the earlier receipt and the new answer session together.');
      }
      try {
        const payload = await api('/exam-room/query', {
          operation: 'live_status_v2', examId: state.exam.activeExamId, gradingKey,
        });
        state.exam.monitoring = {
          ...payload.result,
          candidates: (payload.result?.candidates || []).map((candidate) => ({
            ...candidate,
            status: candidate.state || candidate.status,
            canReopenSubmission: candidate.canReopenSubmission === true,
            reopenBlockedReason: candidate.reopenBlockedReason || 'REOPEN_ELIGIBILITY_UNAVAILABLE',
            priorReceiptId: candidate.priorReceiptId || candidate.latestReceiptId,
          })),
        };
      } catch { /* reopen succeeded; a later explicit keyed refresh will reconcile the monitor */ }
      openDialog(`<div class="dd26-label">Another submission allowed</div><h2>A new answer session is ready</h2><div class="dd26-success"><strong>Answer session ${escapeHtml(result.generation)} is open until ${escapeHtml(formatDate(result.serverDeadline || result.expiresAt))}.</strong></div><p>The earlier answer session ${escapeHtml(result.priorGeneration)} and receipt <code>${escapeHtml(result.priorReceiptId)}</code> remain saved. The student must sign in with the same class-list account and start the new session. The earlier session remains closed.</p><div class="dd26-actions"><button class="dd26-button primary" data-dd26-close-dialog type="button">Return to exam status</button></div>`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Allow another submission';
      global.toast?.(`No new answer session was opened. ${error.message}`, 'warn');
    }
  }

  function openUnlockMonitoredAttempt(attemptId) {
    openDialog(`<div class="dd26-label">Help for one student</div><h2>Unlock this saved exam attempt</h2><p>This action helps with an unfinished locked attempt. It does not reopen or replace an answer session that the student already submitted, and it never changes an earlier receipt.</p><label class="dd26-field"><span>Professor grading key</span><input class="dd26-input" id="dd26-unlock-grading-key" type="password" autocomplete="one-time-code" required></label><label class="dd26-field"><span>Required reason</span><textarea class="dd26-textarea compact" id="dd26-unlock-reason" minlength="10" maxlength="1000" required></textarea></label><div class="dd26-actions"><button class="dd26-button danger" id="dd26-confirm-unlock" type="button">Unlock this attempt</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-confirm-unlock')?.addEventListener('click', () => unlockMonitoredAttempt(attemptId));
  }

  async function unlockMonitoredAttempt(attemptId) {
    const gradingKeyInput = document.getElementById('dd26-unlock-grading-key');
    const gradingKey = String(gradingKeyInput?.value || '');
    const reason = value('dd26-unlock-reason');
    if (!gradingKey || reason.length < 10) {
      global.toast?.('Enter the grading key and a reason of at least 10 characters.', 'warn');
      return;
    }
    gradingKeyInput.value = '';
    try {
      await command({
        operation: 'unlock_attempt', attemptId, reason,
        gradingKey,
      });
      global.toast?.('Attempt unlocked with an audit record.', 'ok');
      const candidate = (state.exam.monitoring?.candidates || [])
        .find((entry) => entry.attemptId === attemptId);
      if (candidate) candidate.status = 'active';
      closeDialog();
      renderLiveStatus();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function openGrading(examId) {
    state.exam.activeExamId = examId;
    openDialog(`<div class="dd26-label">Professor grading</div><h2>Grade submitted exams</h2><p>Each submitted student appears here immediately, even while classmates are still answering or absent. Enter the grading key the first time only; leave it blank if this account has already verified access to this examination.</p><label class="dd26-field"><span>Professor grading key <small>(first visit only)</small></span><input class="dd26-input" id="dd26-grading-key" type="password" autocomplete="one-time-code"></label><div class="dd26-actions"><button class="dd26-button primary" id="dd26-load-grading" type="button">Open submitted exams</button><button class="dd26-button" data-dd26-close-dialog type="button">Cancel</button></div>`);
    document.getElementById('dd26-load-grading')?.addEventListener('click', loadGrading);
  }

  async function loadGrading() {
    const gradingKeyInput = document.getElementById('dd26-grading-key');
    const gradingKey = String(gradingKeyInput?.value || '');
    if (gradingKeyInput) gradingKeyInput.value = '';
    await loadGradingWorkspace(state.exam.activeExamId, { gradingKey });
  }

  async function loadGradingWorkspace(examId, options = {}) {
    const gradingKey = String(options.gradingKey || '');
    try {
      const payload = await api('/exam-room/query', { operation: 'grading_workspace', examId, gradingKey });
      state.exam.grading = { ...payload.result, gradingKey, unsavedChanges: false };
      state.exam.gradingModelAnswer = null;
      state.exam.activeExamId = examId;
      const candidates = state.exam.grading.candidates || [];
      const candidateIndex = options.attemptId
        ? candidates.findIndex((entry) => entry.attemptId === options.attemptId)
        : 0;
      if (options.attemptId && candidateIndex < 0) {
        state.exam.gradingDetailOpen = false;
        state.exam.routeSubmissionId = '';
        state.exam.routeQuestionOrdinal = 0;
        closeDialog();
        renderGrading();
        global.toast?.('That submitted examination is unavailable or is not authorized for this Professor account.', 'warn');
        return;
      }
      const candidate = state.exam.grading.candidates?.[candidateIndex];
      const questionIndex = Number(options.questionOrdinal) > 0
        ? (candidate?.questions || []).findIndex((entry) => Number(entry.ordinal) === Number(options.questionOrdinal))
        : 0;
      if (Number(options.questionOrdinal) > 0 && questionIndex < 0) {
        state.exam.gradingDetailOpen = false;
        state.exam.routeSubmissionId = '';
        state.exam.routeQuestionOrdinal = 0;
        closeDialog();
        renderGrading();
        global.toast?.('That question is unavailable for the selected submitted examination.', 'warn');
        return;
      }
      state.exam.gradingCandidate = candidateIndex;
      state.exam.gradingQuestion = questionIndex;
      state.exam.gradingFilter = preferredGradingFilter(state.exam.grading);
      state.exam.gradingDetailOpen = Boolean(options.attemptId);
      state.exam.routeSubmissionId = state.exam.gradingDetailOpen ? String(candidate?.attemptId || '') : '';
      state.exam.routeQuestionOrdinal = state.exam.gradingDetailOpen
        ? Number(candidate?.questions?.[questionIndex]?.ordinal || 0) : 0;
      if (state.exam.professorRoomReturnExamId === examId) stopProfessorRoomPolling();
      closeDialog();
      renderGrading();
    } catch (error) {
      global.toast?.(error.message, 'warn');
    }
  }

  function gradingQuestions(grading = state.exam.grading) {
    return (grading?.candidates || []).flatMap((candidate) => candidate.questions || []);
  }

  function gradingEntries(grading = state.exam.grading, filter = state.exam.gradingFilter) {
    const entries = [];
    (grading?.candidates || []).forEach((candidate, candidateIndex) => {
      (candidate.questions || []).forEach((question, questionIndex) => {
        const isGraded = question.gradeState === 'final';
        const hasDraft = !isGraded && Number(question.gradeRevision || 0) > 0;
        const isLate = candidate.late === true || candidate.lateSubmission === true
          || /late/i.test(String(candidate.status || ''));
        const isFlagged = question.flagged === true || candidate.flagged === true
          || Number(candidate.incidentCount || 0) > 0;
        const matches = filter === 'all'
          || (filter === 'ungraded' && !isGraded && !hasDraft)
          || (filter === 'draft' && hasDraft)
          || (filter === 'graded' && isGraded)
          || (filter === 'late' && isLate)
          || (filter === 'flagged' && isFlagged);
        if (matches) entries.push({ candidate, question, candidateIndex, questionIndex });
      });
    });
    return entries;
  }

  function preferredGradingFilter(grading = state.exam.grading) {
    if (gradingEntries(grading, 'ungraded').length) return 'ungraded';
    if (gradingEntries(grading, 'draft').length) return 'draft';
    if (gradingEntries(grading, 'graded').length) return 'graded';
    return 'all';
  }

  const GRADING_FILTERS = ['ungraded', 'draft', 'graded', 'active', 'absent', 'accommodated', 'flagged', 'all'];

  function gradingFilterLabel(filter) {
    return filter === 'draft' ? 'Grading Draft' : `${filter[0].toUpperCase()}${filter.slice(1)}`;
  }

  function gradingStatusEntries(grading = state.exam.grading, filter = state.exam.gradingFilter) {
    const entries = Array.isArray(grading?.classStatuses) ? grading.classStatuses : [];
    if (filter === 'active') return entries.filter((entry) => entry.active === true);
    if (filter === 'absent') return entries.filter((entry) => entry.absent === true);
    if (filter === 'accommodated') return entries.filter((entry) => entry.accommodated === true);
    return [];
  }

  function gradingDraftKey(grading, candidate, question) {
    const session = (global.DueDiligencePhase4 || global.DueDiligencePhase2)?.getSession?.();
    const userId = session?.user?.id || 'signed-in-professor';
    return `dd:exam-room:grading:${userId}:${grading?.examId || 'exam'}:${candidate?.attemptId || 'attempt'}:${question?.questionId || question?.ordinal || 'question'}`;
  }

  function readGradingDraft(grading, candidate, question) {
    try {
      const value = global.localStorage?.getItem(gradingDraftKey(grading, candidate, question));
      if (!value) return null;
      const draft = JSON.parse(value);
      if (!draft || draft.version !== 1 || !Number.isFinite(Number(draft.updatedAt))) return null;
      return draft;
    } catch { return null; }
  }

  function persistCurrentGradingDraft() {
    const grading = state.exam.grading;
    const candidate = grading?.candidates?.[state.exam.gradingCandidate];
    const question = candidate?.questions?.[state.exam.gradingQuestion];
    if (!grading || !candidate || !question) return false;
    const score = document.getElementById('dd26-grade-score');
    const gradeState = document.getElementById('dd26-grade-state');
    const comment = document.getElementById('dd26-grade-comment');
    const reason = document.getElementById('dd26-grade-reason');
    if (!score || !gradeState || !comment || !reason) return false;
    try {
      global.localStorage?.setItem(gradingDraftKey(grading, candidate, question), JSON.stringify({
        version: 1,
        score: String(score.value || ''),
        gradeState: String(gradeState.value || 'draft'),
        comment: String(comment.value || ''),
        reason: String(reason.value || ''),
        updatedAt: Date.now(),
      }));
      const status = document.getElementById('dd26-grading-draft-status');
      if (status) status.textContent = 'Draft saved on this device';
      return true;
    } catch {
      const status = document.getElementById('dd26-grading-draft-status');
      if (status) status.textContent = 'Draft could not be saved on this device';
      return false;
    }
  }

  function clearCurrentGradingDraft(grading, candidate, question) {
    try { global.localStorage?.removeItem(gradingDraftKey(grading, candidate, question)); }
    catch { /* the confirmed server grade remains authoritative */ }
  }

  function currentCandidateGradesAreFinal() {
    const candidate = state.exam.grading?.candidates?.[state.exam.gradingCandidate];
    const questions = candidate?.questions || [];
    return questions.length > 0 && questions.every((question) => question.gradeState === 'final');
  }

  function markGradingUnsaved() {
    const grading = state.exam.grading;
    if (!grading) return;
    grading.unsavedChanges = true;
    persistCurrentGradingDraft();
    const notice = document.getElementById('dd26-grading-unsaved');
    if (notice) notice.hidden = false;
    ['dd26-download-answer-sheet', 'dd26-download-grade-report'].forEach((id) => {
      const download = document.getElementById(id);
      if (download) download.disabled = true;
    });
    const release = document.getElementById('dd26-review-class-results');
    if (release) release.disabled = true;
    const modelAnswer = document.getElementById('dd26-load-model-answer');
    if (modelAnswer) modelAnswer.disabled = true;
    const unlock = document.getElementById('dd26-unlock-attempt');
    if (unlock) unlock.disabled = true;
  }

  function mayLeaveCurrentGrade() {
    if (!state.exam.grading?.unsavedChanges) return true;
    return global.confirm('This grade has unsaved changes. Leave without saving them?');
  }

  function clearGradingWorkspace() {
    if (state.exam.grading) {
      state.exam.grading.gradingKey = '';
      state.exam.grading.unsavedChanges = false;
    }
    state.exam.grading = null;
    state.exam.gradingModelAnswer = null;
    state.exam.gradingCandidate = 0;
    state.exam.gradingQuestion = 0;
    state.exam.gradingDetailOpen = false;
    state.exam.gradingSaveBusy = false;
    state.exam.routeSubmissionId = '';
    state.exam.routeQuestionOrdinal = 0;
  }

  function leaveGradingWorkspace() {
    if (!mayLeaveCurrentGrade()) return;
    const returnExamId = state.exam.professorRoomReturnExamId;
    const examId = state.exam.grading?.examId || state.exam.activeExamId;
    clearGradingWorkspace();
    state.exam.routeRole = 'professor';
    if (examId) activatePage('exam_room', document.getElementById('spa-examination-room'), { replace: true, detailId: examId });
    if (returnExamId) {
      state.exam.professorRoomReturnExamId = null;
      void openLiveStatus(returnExamId);
      return;
    }
    renderExamRoom();
    document.getElementById('dd26-exam-main')?.focus();
  }

  function gradingQueueHtml(grading) {
    const candidates = Array.isArray(grading?.candidates) ? grading.candidates : [];
    const completed = candidates.filter((candidate) => (candidate.questions || []).length > 0
      && candidate.questions.every((question) => question.gradeState === 'final')).length;
    const rows = candidates.map((candidate, candidateIndex) => {
      const questions = Array.isArray(candidate.questions) ? candidate.questions : [];
      const finalCount = questions.filter((question) => question.gradeState === 'final').length;
      const totals = classResultCandidateTotals(candidate);
      const firstUnfinished = questions.findIndex((question) => question.gradeState !== 'final');
      const nextQuestion = firstUnfinished >= 0 ? firstUnfinished : 0;
      const current = candidateIndex === state.exam.gradingCandidate;
      return `<tr class="${current ? 'is-current' : ''}"><td><strong>${escapeHtml(candidate.studentName || candidate.candidateNumber || 'Student')}</strong><br><small>${escapeHtml(candidate.studentNumber || candidate.candidateNumber || 'No student number')}</small></td><td>${escapeHtml(candidate.studentEmail || '—')}</td><td><strong>${escapeHtml(finalCount)} / ${escapeHtml(questions.length)}</strong><br><small>${finalCount === questions.length && questions.length ? 'Complete' : 'Needs grading'}</small></td><td>${escapeHtml(totals.score.toFixed(2))} / ${escapeHtml(totals.maximum.toFixed(2))}<br><small>${escapeHtml(totals.percentage.toFixed(1))}% current</small></td><td><button class="dd26-button compact" data-dd26-open-grading-candidate="${candidateIndex}" data-dd26-open-grading-question="${nextQuestion}" type="button" ${current ? 'aria-current="true"' : ''}>${current ? 'Continue' : 'Open'}</button></td></tr>`;
    }).join('');
    return `<details class="dd26-section dd26-grading-queue" open><summary><strong>Class grading queue</strong> — ${escapeHtml(completed)} of ${escapeHtml(candidates.length)} students complete</summary><p>Review the whole class at a glance, then open any student. Save and Next continues through the selected grading filter.</p><div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Student</th><th>Email</th><th>Final items</th><th>Current score</th><th>Grade</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }

  function bindGradingQueue() {
    document.querySelectorAll('[data-dd26-open-grading-candidate]').forEach((button) => button.addEventListener('click', () => {
      if (!mayLeaveCurrentGrade()) return;
      state.exam.gradingFilter = 'all';
      state.exam.gradingCandidate = Number(button.dataset.dd26OpenGradingCandidate);
      state.exam.gradingQuestion = Number(button.dataset.dd26OpenGradingQuestion) || 0;
      state.exam.gradingDetailOpen = true;
      updateGradingRoute(false);
      renderGrading();
      document.getElementById('dd26-grade-score')?.focus();
    }));
  }

  function updateGradingRoute(replace = true) {
    const grading = state.exam.grading;
    const candidate = grading?.candidates?.[state.exam.gradingCandidate];
    const question = candidate?.questions?.[state.exam.gradingQuestion];
    state.exam.routeRole = 'professor';
    state.exam.routeSubmissionId = state.exam.gradingDetailOpen ? String(candidate?.attemptId || '') : '';
    state.exam.routeQuestionOrdinal = state.exam.gradingDetailOpen ? Number(question?.ordinal || 0) : 0;
    activatePage('exam_room', document.getElementById('spa-examination-room'), {
      replace, detailId: grading?.examId || state.exam.activeExamId,
    });
  }

  function returnToGradingQueue() {
    if (!mayLeaveCurrentGrade()) return;
    state.exam.gradingDetailOpen = false;
    state.exam.routeSubmissionId = '';
    state.exam.routeQuestionOrdinal = 0;
    updateGradingRoute(false);
    renderGrading();
    document.querySelector('.dd26-grading-queue')?.focus?.();
  }

  function renderGrading() {
    const grading = state.exam.grading;
    const filteredEntries = gradingEntries(grading);
    const statusOnlyFilter = ['active', 'absent', 'accommodated'].includes(state.exam.gradingFilter);
    const statusEntries = gradingStatusEntries(grading);
    const allQuestions = gradingQuestions(grading);
    const finalCount = allQuestions.filter((entry) => entry.gradeState === 'final').length;
    const unfinishedCount = allQuestions.length - finalCount;
    if (!state.exam.gradingDetailOpen && !statusOnlyFilter) {
      document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><section class="dd26-section"><div class="dd26-label">Professor grading / ${escapeHtml(grading?.title || 'Examination')}</div><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${escapeHtml(grading?.candidates?.length || 0)}</strong><span>Submitted exams</span></div><div class="dd26-stat"><strong>${escapeHtml(finalCount)}</strong><span>Final grades</span></div><div class="dd26-stat"><strong>${escapeHtml(unfinishedCount)}</strong><span>Needs grading</span></div><div class="dd26-stat"><strong>Professor</strong><span>Official decision</span></div></div><div class="dd26-grading-filter" role="group" aria-label="Filter grading work">${GRADING_FILTERS.map((filter) => `<button class="dd26-chip${state.exam.gradingFilter === filter ? ' is-active' : ''}" data-dd26-grading-filter="${filter}" type="button" aria-pressed="${state.exam.gradingFilter === filter}">${escapeHtml(gradingFilterLabel(filter))}</button>`).join('')}</div>${gradingQueueHtml(grading)}<div class="dd26-actions"><button class="dd26-button primary" id="dd26-open-saved-class-results" type="button">Open class results</button><button class="dd26-button" id="dd26-leave-grading" type="button">Return to Professor workspace</button></div></section></section>`;
      document.querySelectorAll('[data-dd26-grading-filter]').forEach((button) => button.addEventListener('click', () => {
        state.exam.gradingFilter = button.dataset.dd26GradingFilter;
        renderGrading();
      }));
      bindGradingQueue();
      document.getElementById('dd26-open-saved-class-results')?.addEventListener('click', () => openResultsDashboard(grading.examId));
      document.getElementById('dd26-leave-grading')?.addEventListener('click', leaveGradingWorkspace);
      return;
    }
    if (statusOnlyFilter) {
      document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card"><section class="dd26-section"><div class="dd26-label">Professor grading / ${escapeHtml(grading?.title || 'Examination')}</div><h2>${escapeHtml(gradingFilterLabel(state.exam.gradingFilter))} students</h2><p>This status view never exposes an active student’s autosaved answers. Only a final submitted examination can be opened for grading.</p><div class="dd26-grading-filter" role="group" aria-label="Filter grading work">${GRADING_FILTERS.map((filter) => `<button class="dd26-chip${state.exam.gradingFilter === filter ? ' is-active' : ''}" data-dd26-grading-filter="${filter}" type="button" aria-pressed="${state.exam.gradingFilter === filter}">${escapeHtml(gradingFilterLabel(filter))}</button>`).join('')}</div>${statusEntries.length ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Student</th><th>Email</th><th>Status</th><th>Submission</th></tr></thead><tbody>${statusEntries.map((entry) => `<tr><td><strong>${escapeHtml(entry.studentName || entry.candidateNumber || 'Student')}</strong></td><td>${escapeHtml(entry.studentEmail || '—')}</td><td>${escapeHtml(entry.displayStatus || entry.status || state.exam.gradingFilter)}</td><td>${entry.submittedAt ? escapeHtml(formatDate(entry.submittedAt)) : 'Not submitted'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="dd26-empty" role="status">No students match the ${escapeHtml(gradingFilterLabel(state.exam.gradingFilter))} filter.</div>`}<div class="dd26-actions"><button class="dd26-button" id="dd26-leave-grading" type="button">Return to Professor workspace</button></div></section></section>`;
      document.querySelectorAll('[data-dd26-grading-filter]').forEach((button) => button.addEventListener('click', () => {
        state.exam.gradingFilter = button.dataset.dd26GradingFilter;
        renderGrading();
      }));
      document.getElementById('dd26-leave-grading')?.addEventListener('click', leaveGradingWorkspace);
      return;
    }
    const currentMatches = filteredEntries.some((entry) => entry.candidateIndex === state.exam.gradingCandidate
      && entry.questionIndex === state.exam.gradingQuestion);
    if (!currentMatches && filteredEntries.length) {
      state.exam.gradingCandidate = filteredEntries[0].candidateIndex;
      state.exam.gradingQuestion = filteredEntries[0].questionIndex;
    }
    const candidate = grading?.candidates?.[state.exam.gradingCandidate];
    const question = candidate?.questions?.[state.exam.gradingQuestion];
    if (!candidate || !question) {
      document.getElementById('dd26-exam-main').innerHTML = '<section class="dd26-card"><div class="dd26-empty">No student submissions are available for grading.</div><div class="dd26-actions"><button class="dd26-button" id="dd26-leave-grading" type="button">Return to Professor workspace</button></div></section>';
      document.getElementById('dd26-leave-grading')?.addEventListener('click', leaveGradingWorkspace);
      return;
    }
    if (!filteredEntries.length) {
      document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card">
        <section class="dd26-section">
          <div class="dd26-label">Professor grading / ${escapeHtml(grading.title)}</div>
          <div class="dd26-stat-grid">
            <div class="dd26-stat"><strong>${escapeHtml(grading.candidates.length)}</strong><span>Submitted exams</span></div>
            <div class="dd26-stat"><strong>${escapeHtml(finalCount)}</strong><span>Final grades</span></div>
            <div class="dd26-stat"><strong>${escapeHtml(unfinishedCount)}</strong><span>Needs grading</span></div>
            <div class="dd26-stat"><strong>Professor</strong><span>Official decision</span></div>
          </div>
          <div class="dd26-grading-filter" role="group" aria-label="Filter grading work">
            ${GRADING_FILTERS.map((filter) => `<button class="dd26-chip${state.exam.gradingFilter === filter ? ' is-active' : ''}" data-dd26-grading-filter="${filter}" type="button" aria-pressed="${state.exam.gradingFilter === filter}">${escapeHtml(gradingFilterLabel(filter))}</button>`).join('')}
          </div>
          <div class="dd26-empty" role="status"><strong>No answers match the ${escapeHtml(state.exam.gradingFilter)} filter.</strong>${finalCount ? '<br>Your saved grades remain in the official examination record.' : ''}</div>
          <div class="dd26-actions">${finalCount ? '<button class="dd26-button primary" id="dd26-open-saved-grades" type="button">View saved grades</button><button class="dd26-button" id="dd26-open-saved-class-results" type="button">Open class results</button>' : ''}<button class="dd26-button" id="dd26-leave-grading" type="button">Return to Professor workspace</button></div>
        </section>
      </section>`;
      document.querySelectorAll('[data-dd26-grading-filter]').forEach((button) => button.addEventListener('click', () => {
        state.exam.gradingFilter = button.dataset.dd26GradingFilter;
        renderGrading();
      }));
      document.getElementById('dd26-open-saved-grades')?.addEventListener('click', () => {
        state.exam.gradingFilter = 'graded';
        renderGrading();
      });
      document.getElementById('dd26-open-saved-class-results')?.addEventListener('click', () => openResultsDashboard(grading.examId));
      document.getElementById('dd26-leave-grading')?.addEventListener('click', leaveGradingWorkspace);
      return;
    }
    const draft = readGradingDraft(grading, candidate, question);
    grading.unsavedChanges = Boolean(draft);
    const allGradesFinal = allQuestions.length > 0 && unfinishedCount === 0;
    const candidateGradesFinal = currentCandidateGradesAreFinal();
    const modelAnswer = state.exam.gradingModelAnswer;
    const currentFilteredIndex = Math.max(0, filteredEntries.findIndex((entry) => entry.candidateIndex === state.exam.gradingCandidate
      && entry.questionIndex === state.exam.gradingQuestion));
    const scoreValue = draft ? draft.score : (question.score ?? '');
    const gradeStateValue = draft?.gradeState || (question.gradeState === 'draft' ? 'draft' : 'final');
    const commentValue = draft ? draft.comment : (question.comment || '');
    const reasonValue = draft?.reason || 'Initial Professor assessment';
    const candidateNameCounts = new Map();
    grading.candidates.forEach((entry) => {
      const name = String(entry.studentName || entry.candidateNumber || 'Student').trim().toLowerCase();
      candidateNameCounts.set(name, (candidateNameCounts.get(name) || 0) + 1);
    });
    const candidateLabel = (entry) => {
      const name = String(entry.studentName || entry.candidateNumber || 'Student').trim();
      const duplicate = (candidateNameCounts.get(name.toLowerCase()) || 0) > 1;
      return duplicate && entry.studentEmail ? `${name} — ${entry.studentEmail}` : name;
    };
    document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card">
      <section class="dd26-section">
        <div class="dd26-label">Professor grading / ${escapeHtml(grading.title)}</div>
        <div class="dd26-stat-grid">
          <div class="dd26-stat"><strong>${escapeHtml(grading.candidates.length)}</strong><span>Submitted exams</span></div>
          <div class="dd26-stat"><strong>${escapeHtml(finalCount)}</strong><span>Final grades</span></div>
          <div class="dd26-stat"><strong>${escapeHtml(unfinishedCount)}</strong><span>Needs grading</span></div>
          <div class="dd26-stat"><strong>Professor</strong><span>Official decision</span></div>
        </div>
        <div class="dd26-grading-filter" role="group" aria-label="Filter grading work">
          ${GRADING_FILTERS.map((filter) => `<button class="dd26-chip${state.exam.gradingFilter === filter ? ' is-active' : ''}" data-dd26-grading-filter="${filter}" type="button" aria-pressed="${state.exam.gradingFilter === filter}">${escapeHtml(gradingFilterLabel(filter))}</button>`).join('')}
        </div>
        <div class="dd26-form-grid">
          <label class="dd26-field"><span>Student</span><select class="dd26-select" id="dd26-grading-candidate">${grading.candidates.map((entry, index) => `<option value="${index}" ${index === state.exam.gradingCandidate ? 'selected' : ''}>${escapeHtml(candidateLabel(entry))}</option>`).join('')}</select></label>
          <label class="dd26-field"><span>Question</span><select class="dd26-select" id="dd26-grading-question">${candidate.questions.map((entry, index) => `<option value="${index}" ${index === state.exam.gradingQuestion ? 'selected' : ''}>Question ${escapeHtml(entry.ordinal)}</option>`).join('')}</select></label>
        </div>
        <div class="dd26-notice"><strong>Professor judgment is required.</strong> AI grading is off and no suggestion can finalize or send a grade.</div>
        <div class="dd26-notice" id="dd26-grading-unsaved" role="status" ${draft ? '' : 'hidden'}><strong>${draft ? 'Draft restored.' : 'Unsaved changes.'}</strong> ${draft ? 'Your grading draft was restored from this device.' : 'Save this grade before moving to another student or question.'}</div>
        <div class="dd26-progress-summary"><span>${escapeHtml(currentFilteredIndex + 1)} of ${escapeHtml(Math.max(filteredEntries.length, 1))} in ${escapeHtml(state.exam.gradingFilter)}</span><span id="dd26-grading-draft-status">${draft ? `Draft saved ${escapeHtml(formatDate(draft.updatedAt))}` : 'Saved grade loaded'}</span></div>
        <div class="dd26-actions"><button class="dd26-button" id="dd26-load-model-answer" type="button">${modelAnswer ? 'Refresh suggested answer' : 'Load suggested answer'}</button></div>
        ${modelAnswer && !(modelAnswer.mode === 'paste' && modelAnswer.available) ? `<div class="dd26-notice">${escapeHtml(modelAnswer.code || 'No usable suggested answer is configured for this examination.')}${modelAnswer.safeFileName ? ` File: ${escapeHtml(modelAnswer.safeFileName)}` : ''}</div>` : ''}
      </section>
      <div class="dd26-question-meta"><span><strong>${escapeHtml(candidate.studentName || candidate.candidateNumber)}</strong>${candidate.studentEmail ? ` <small>${escapeHtml(candidate.studentEmail)}</small>` : ''}</span><span>Question ${escapeHtml(question.ordinal)} of ${escapeHtml(grading.questionCount)}</span></div>
      <div class="dd26-grading-split"><section class="dd26-grading-source"><h2 class="dd26-prompt">${escapeHtml(question.prompt)}</h2><section class="dd26-section"><h3>Student answer</h3><p>${escapeHtml(question.answer || 'No answer submitted.')}</p></section>${modelAnswer?.mode === 'paste' && modelAnswer.available ? `<details class="dd26-section"><summary>Professor-only suggested answer</summary><p class="dd26-long-cell">${escapeHtml(modelAnswer.answerText)}</p></details>` : ''}</section><section class="dd26-grading-form"><div class="dd26-error" id="dd26-grade-errors" role="alert" tabindex="-1" hidden></div><div class="dd26-form-grid"><label class="dd26-field"><span>Score / ${escapeHtml(question.maximumPoints)}</span><input class="dd26-input" id="dd26-grade-score" type="number" min="0" max="${escapeHtml(question.maximumPoints)}" step="0.1" value="${escapeHtml(scoreValue)}" aria-describedby="dd26-grade-errors" required></label><label class="dd26-field"><span>Grade status</span><select class="dd26-select" id="dd26-grade-state"><option value="draft" ${gradeStateValue === 'draft' ? 'selected' : ''}>Draft</option><option value="final" ${gradeStateValue === 'final' ? 'selected' : ''}>Final</option></select></label><label class="dd26-field wide"><span>Professor comment</span><textarea class="dd26-textarea" id="dd26-grade-comment" maxlength="5000">${escapeHtml(commentValue)}</textarea></label><label class="dd26-field wide"><span>Reason for this grade</span><input class="dd26-input" id="dd26-grade-reason" maxlength="1000" value="${escapeHtml(reasonValue)}"></label></div></section></div>
      <div class="dd26-actions dd26-grading-actions"><button class="dd26-button" id="dd26-previous-grade" type="button">Previous</button><button class="dd26-button" id="dd26-save-grade" type="button">Save</button><button class="dd26-button primary" id="dd26-save-next-grade" type="button">Save and Next</button><button class="dd26-button" id="dd26-next-ungraded" type="button">Next</button>${candidate.status === 'locked' ? '<button class="dd26-button danger" id="dd26-unlock-attempt" type="button">Review access</button>' : ''}</div>
      <section class="dd26-section" aria-labelledby="dd26-candidate-download-heading">
        <h3 id="dd26-candidate-download-heading">Download this student&rsquo;s records</h3>
        <p>Answer sheets and grade reports are separate private documents. Downloading either file does not send results or change the examination.</p>
        <div class="dd26-actions"><button class="dd26-button" id="dd26-download-answer-sheet" type="button">Download student answer PDF</button><button class="dd26-button" id="dd26-download-grade-report" type="button" ${candidateGradesFinal ? '' : 'disabled'}>Download final grade PDF</button></div>
        ${candidateGradesFinal ? '' : '<p class="dd26-help">The exact questions and submitted answers are available now. Finalize every grade before downloading the grade report.</p>'}
      </section>
      <section class="dd26-section" aria-labelledby="dd26-class-results-heading">
        <h3 id="dd26-class-results-heading">Class results and offline grading</h3>
        <p>Choose any submitted students and download an Excel workbook containing the Professor&rsquo;s exact questions, submitted answers, roster details, timing, current scores, comments, and analysis. Send each selected student only their own finalized result; releasing one result does not close the examination or affect the rest of the class.</p>
        <div class="dd26-actions"><button class="dd26-button primary" id="dd26-review-class-results" type="button">Review send / download</button><button class="dd26-button" id="dd26-leave-grading" type="button">Return to Professor workspace</button></div>
        ${allGradesFinal ? '<p class="dd26-help">All grades are final. You may send every student their own result and download the final class workbook.</p>' : `<p class="dd26-help">An offline-grading workbook is available now. Finalize ${escapeHtml(unfinishedCount)} remaining grade${unfinishedCount === 1 ? '' : 's'} in the secure workspace before sending official results.</p>`}
      </section>
    </section>`;
    document.querySelector('#dd26-exam-main .dd26-card > .dd26-section')?.insertAdjacentHTML('afterbegin', '<div class="dd26-actions"><button class="dd26-button" id="dd26-back-to-grading-queue" type="button">Back to grading list</button></div>');
    document.getElementById('dd26-back-to-grading-queue')?.addEventListener('click', returnToGradingQueue);
    updateGradingRoute(true);
    const saveGradeButton = document.getElementById('dd26-save-grade');
    const saveNextGradeButton = document.getElementById('dd26-save-next-grade');
    if (saveGradeButton) saveGradeButton.textContent = gradeStateValue === 'final' ? 'Save final grade' : 'Save draft';
    if (saveNextGradeButton) saveNextGradeButton.textContent = gradeStateValue === 'final' ? 'Save final grade & next' : 'Save draft & next';
    document.getElementById('dd26-grading-candidate')?.addEventListener('change', (event) => {
      if (!mayLeaveCurrentGrade()) {
        event.target.value = String(state.exam.gradingCandidate);
        return;
      }
      state.exam.gradingCandidate = Number(event.target.value);
      state.exam.gradingQuestion = 0;
      renderGrading();
    });
    document.getElementById('dd26-grading-question')?.addEventListener('change', (event) => {
      if (!mayLeaveCurrentGrade()) {
        event.target.value = String(state.exam.gradingQuestion);
        return;
      }
      state.exam.gradingQuestion = Number(event.target.value);
      renderGrading();
    });
    document.querySelectorAll('[data-dd26-grading-filter]').forEach((button) => button.addEventListener('click', () => {
      if (!mayLeaveCurrentGrade()) return;
      state.exam.gradingFilter = button.dataset.dd26GradingFilter;
      renderGrading();
    }));
    bindGradingQueue();
    ['dd26-grade-score', 'dd26-grade-state', 'dd26-grade-comment', 'dd26-grade-reason'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', markGradingUnsaved);
      document.getElementById(id)?.addEventListener('change', markGradingUnsaved);
    });
    document.getElementById('dd26-load-model-answer')?.addEventListener('click', loadGradingModelAnswer);
    document.getElementById('dd26-save-grade')?.addEventListener('click', () => saveGrade(false));
    document.getElementById('dd26-save-next-grade')?.addEventListener('click', () => saveGrade(true));
    document.getElementById('dd26-previous-grade')?.addEventListener('click', previousGrade);
    document.getElementById('dd26-next-ungraded')?.addEventListener('click', nextGrade);
    document.getElementById('dd26-unlock-attempt')?.addEventListener('click', unlockAttempt);
    document.getElementById('dd26-review-class-results')?.addEventListener('click', releaseResults);
    document.getElementById('dd26-download-answer-sheet')?.addEventListener('click', () => downloadCandidateResult('questions_answers'));
    document.getElementById('dd26-download-grade-report')?.addEventListener('click', () => downloadCandidateResult('grades_comments'));
    document.getElementById('dd26-leave-grading')?.addEventListener('click', leaveGradingWorkspace);
    const gradingHost = document.getElementById('dd26-exam-main');
    if (gradingHost) gradingHost.onkeydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveGrade(false);
      } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        nextGrade();
      } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        previousGrade();
      }
    };
    document.getElementById('dd26-exam-role-home')?.addEventListener('click', (event) => {
      if (!mayLeaveCurrentGrade()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      clearGradingWorkspace();
    }, { capture: true });
  }

  async function loadGradingModelAnswer() {
    const grading = state.exam.grading;
    if (!grading) return;
    try {
      const payload = await api('/exam-room/query', {
        operation: 'grading_model_answer', examId: grading.examId, gradingKey: grading.gradingKey,
      });
      state.exam.gradingModelAnswer = payload.result;
      renderGrading();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  async function saveGrade(advanceAfterSave = false) {
    const grading = state.exam.grading;
    if (!grading || state.exam.gradingSaveBusy) return;
    const candidate = grading.candidates[state.exam.gradingCandidate];
    const question = candidate.questions[state.exam.gradingQuestion];
    const scoreInput = document.getElementById('dd26-grade-score');
    const rawScore = String(scoreInput?.value || '').trim();
    const score = Number(rawScore);
    const maximumPoints = Number(question.maximumPoints);
    const errorHost = document.getElementById('dd26-grade-errors');
    let errorMessage = '';
    if (!rawScore) errorMessage = 'Enter a score. A blank score is never saved as zero.';
    else if (!Number.isFinite(score)) errorMessage = 'Enter a valid number for the score.';
    else if (!Number.isFinite(maximumPoints) || score < 0 || score > maximumPoints) errorMessage = `Enter a score from 0 to ${question.maximumPoints}.`;
    if (errorMessage) {
      scoreInput?.setAttribute('aria-invalid', 'true');
      if (errorHost) {
        errorHost.textContent = errorMessage;
        errorHost.hidden = false;
      }
      scoreInput?.focus();
      return;
    }
    scoreInput?.removeAttribute('aria-invalid');
    if (errorHost) {
      errorHost.textContent = '';
      errorHost.hidden = true;
    }
    const comment = value('dd26-grade-comment', false);
    const gradeState = value('dd26-grade-state');
    const changeReason = value('dd26-grade-reason');
    state.exam.gradingSaveBusy = true;
    const saveButton = document.getElementById(advanceAfterSave ? 'dd26-save-next-grade' : 'dd26-save-grade');
    const saveButtons = ['dd26-save-grade', 'dd26-save-next-grade']
      .map((id) => document.getElementById(id)).filter(Boolean);
    saveButtons.forEach((button) => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
    }
    try {
      const result = await command({ operation: 'save_grade', examId: grading.examId, attemptId: candidate.attemptId, questionId: question.questionId, score, comment, gradeState, expectedRevision: question.gradeRevision || 0, changeReason, gradingKey: grading.gradingKey });
      question.score = score;
      question.comment = comment;
      question.gradeState = gradeState;
      question.gradeRevision = result.revision;
      grading.unsavedChanges = false;
      clearCurrentGradingDraft(grading, candidate, question);
      global.toast?.('Grade saved with version history.', 'ok');
      if (advanceAfterSave) moveGrade(1, true);
      else {
        if (!gradingEntries(grading).length) state.exam.gradingFilter = preferredGradingFilter(grading);
        renderGrading();
      }
    } catch (error) {
      if (errorHost) {
        errorHost.textContent = error.message;
        errorHost.hidden = false;
      }
      global.toast?.(error.message, 'warn');
    } finally {
      state.exam.gradingSaveBusy = false;
      saveButtons.forEach((button) => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = button.id === 'dd26-save-next-grade' ? 'Save and Next' : 'Save';
      });
    }
  }

  function moveGrade(direction, skipUnsavedCheck = false) {
    const grading = state.exam.grading;
    if (!grading || (!skipUnsavedCheck && !mayLeaveCurrentGrade())) return;
    let entries = gradingEntries(grading);
    if (!entries.length) {
      state.exam.gradingFilter = preferredGradingFilter(grading);
      entries = gradingEntries(grading);
    }
    if (!entries.length) return;
    const currentIndex = entries.findIndex((entry) => entry.candidateIndex === state.exam.gradingCandidate
      && entry.questionIndex === state.exam.gradingQuestion);
    const nextIndex = (Math.max(currentIndex, 0) + direction + entries.length) % entries.length;
    state.exam.gradingCandidate = entries[nextIndex].candidateIndex;
    state.exam.gradingQuestion = entries[nextIndex].questionIndex;
    renderGrading();
  }

  function nextGrade() { moveGrade(1); }
  function previousGrade() { moveGrade(-1); }

  async function unlockAttempt() {
    const grading = state.exam.grading;
    const candidate = grading.candidates[state.exam.gradingCandidate];
    const reason = global.prompt('Enter the required reason for unlocking this preserved attempt:');
    if (!reason) return;
    try {
      await command({ operation: 'unlock_attempt', attemptId: candidate.attemptId, reason, gradingKey: grading.gradingKey });
      candidate.status = 'in_progress';
      global.toast?.('Attempt unlocked with an audit record.', 'ok');
      renderGrading();
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function classResultCandidates(report = state.exam.resultsDashboard) {
    return Array.isArray(report?.candidates) ? report.candidates : [];
  }

  function classResultCandidateTotals(candidate) {
    const questions = Array.isArray(candidate?.questions) ? candidate.questions : [];
    const gradedQuestions = questions.filter((question) => question.score !== null
      && question.score !== undefined && question.score !== ''
      && Number.isFinite(Number(question.score)));
    const score = questions.reduce((sum, question) => {
      if (question.score === null || question.score === undefined || question.score === '') return sum;
      return sum + (Number.isFinite(Number(question.score)) ? Number(question.score) : 0);
    }, 0);
    const maximum = questions.reduce((sum, question) => sum + (Number.isFinite(Number(question.maximumPoints)) ? Number(question.maximumPoints) : 0), 0);
    return {
      score,
      maximum,
      percentage: maximum > 0 ? (score / maximum) * 100 : 0,
      gradedCount: gradedQuestions.length,
      questionCount: questions.length,
      complete: candidate?.allGradesFinal === true,
    };
  }

  function classResultsAnalytics(report = state.exam.resultsDashboard) {
    const candidates = classResultCandidates(report);
    const statuses = Array.isArray(report?.classStatuses) ? report.classStatuses : [];
    const finalized = candidates.filter((candidate) => candidate.allGradesFinal === true);
    const percentages = finalized.map((candidate) => classResultCandidateTotals(candidate).percentage);
    const sortedPercentages = [...percentages].sort((left, right) => left - right);
    const median = sortedPercentages.length
      ? sortedPercentages.length % 2
        ? sortedPercentages[(sortedPercentages.length - 1) / 2]
        : (sortedPercentages[(sortedPercentages.length / 2) - 1] + sortedPercentages[sortedPercentages.length / 2]) / 2
      : 0;
    const questions = new Map();
    candidates.forEach((candidate) => (candidate.questions || []).forEach((question) => {
      const ordinal = Number(question.ordinal);
      const current = questions.get(ordinal) || { ordinal, prompt: question.prompt || '', maximum: Number(question.maximumPoints) || 0, scores: [], answered: 0, finals: 0 };
      if (String(question.answer || '').trim()) current.answered += 1;
      if (question.score !== null && question.score !== undefined && question.score !== ''
          && Number.isFinite(Number(question.score))) current.scores.push(Number(question.score));
      if (question.gradeState === 'final') current.finals += 1;
      questions.set(ordinal, current);
    }));
    const questionAnalytics = [...questions.values()].sort((left, right) => left.ordinal - right.ordinal).map((question) => {
      const averageScore = question.scores.length
        ? question.scores.reduce((sum, score) => sum + score, 0) / question.scores.length : 0;
      return { ...question, averageScore, averagePercentage: question.maximum > 0 ? (averageScore / question.maximum) * 100 : 0 };
    });
    return {
      expected: Number(report?.expectedCount) || statuses.length,
      submitted: candidates.length,
      finalized: finalized.length,
      ungraded: candidates.length - finalized.length,
      absent: statuses.filter((entry) => entry.absent === true).length,
      late: statuses.filter((entry) => entry.late === true).length,
      average: percentages.length ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length : 0,
      median,
      highestQuestion: [...questionAnalytics].sort((left, right) => right.averagePercentage - left.averagePercentage)[0] || null,
      lowestQuestion: [...questionAnalytics].sort((left, right) => left.averagePercentage - right.averagePercentage)[0] || null,
      questionAnalytics,
    };
  }

  async function loadResultsDashboard(examId) {
    const [payload, deliveryPayload] = await Promise.all([
      api('/exam-room/query', { operation: 'results_dashboard', examId }),
      api('/exam-room/query', { operation: 'result_delivery_report', examId }).catch(() => null),
    ]);
    if (payload?.result?.ok === false) throw new Error(payload.result.message || 'Class results are unavailable.');
    const report = {
      ...(payload.result || {}),
      resultDelivery: deliveryPayload?.result?.ok === true ? deliveryPayload.result : null,
    };
    state.exam.activeExamId = examId;
    state.exam.resultsDashboard = report;
    return report;
  }

  function resultDeliveryByAttempt(report = state.exam.resultsDashboard) {
    return new Map((Array.isArray(report?.resultDelivery?.candidates)
      ? report.resultDelivery.candidates : [])
      .map((entry) => [String(entry?.attemptId || ''), entry]));
  }

  function resultDeliveryLabel(delivery) {
    const status = String(delivery?.deliveryStatus || (delivery ? 'pending' : 'not_queued'));
    if (status === 'delivered') return 'Delivered to mail server';
    if (status === 'accepted') return 'Accepted by email provider; delivery not yet confirmed';
    if (status === 'delayed') return 'Delivery delayed; provider is retrying';
    if (status === 'bounced') return 'Bounced; verify the student email';
    if (status === 'complained') return 'Delivered, then reported as spam';
    if (status === 'failed') return 'Delivery failed';
    if (status === 'suppressed') return 'Email suppressed in this environment';
    return 'Queued for delivery';
  }

  async function retryStudentResultEmail(button) {
    const report = state.exam.resultsDashboard;
    const attemptId = String(button?.dataset?.dd26RetryResultEmail || '');
    if (!report?.examId || !attemptId || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Queueing retry\u2026';
    try {
      await command({
        operation: 'retry_student_result_email',
        examId: report.examId,
        attemptId,
        requestKey: randomKey('result_email_retry'),
      });
      global.toast?.('The student result was queued for a safe email retry.', 'ok');
      const refreshed = await loadResultsDashboard(report.examId);
      renderProfessorResultsDashboard(refreshed);
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      global.toast?.(error.message, 'warn');
    }
  }

  async function openResultsDashboard(examId = state.exam.activeExamId) {
    if (!examId) return;
    try {
      const report = await loadResultsDashboard(examId);
      renderProfessorResultsDashboard(report);
    } catch (error) { global.toast?.(error.message, 'warn'); }
  }

  function selectedClassResultAttemptIds() {
    return [...document.querySelectorAll('[data-dd26-class-result-candidate]:checked')]
      .map((input) => String(input.value || ''))
      .filter(Boolean);
  }

  function refreshClassResultsSelectionState() {
    const checkboxes = [...document.querySelectorAll('[data-dd26-class-result-candidate]')];
    const selected = checkboxes.filter((input) => input.checked);
    const master = document.getElementById('dd26-class-result-select-all');
    if (master) {
      master.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
      master.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
    }
    const count = document.getElementById('dd26-class-result-selection-count');
    if (count) count.textContent = `${selected.length} of ${checkboxes.length} students selected`;
    const download = document.getElementById('dd26-download-class-workbook');
    if (download) download.disabled = checkboxes.length > 0 && selected.length < 1;
    const send = document.getElementById('dd26-confirm-release-results');
    if (send) {
      const selectedIds = new Set(selected.map((input) => String(input.value || '')));
      const selectedCandidates = classResultCandidates().filter((candidate) => selectedIds.has(String(candidate.attemptId || '')));
      send.disabled = selectedCandidates.length < 1
        || selectedCandidates.some((candidate) => candidate.allGradesFinal !== true);
      send.textContent = selectedCandidates.length === 1
        ? 'Send selected student result'
        : `Send ${selectedCandidates.length || ''} selected results`.trim();
    }
  }

  function candidateSelectionScoreText(candidate, totals = classResultCandidateTotals(candidate)) {
    return totals.complete
      ? `${totals.score.toFixed(1)}/${totals.maximum.toFixed(1)} Final`
      : `Recorded subtotal ${totals.score.toFixed(1)} · ${totals.gradedCount}/${totals.questionCount} graded · Not final`;
  }

  async function openClassResultsDialog(examId = state.exam.grading?.examId || state.exam.activeExamId) {
    if (!examId) return;
    if (state.exam.grading?.unsavedChanges) {
      global.toast?.('Save the current grade before preparing class results.', 'warn');
      return;
    }
    let report;
    try { report = await loadResultsDashboard(examId); }
    catch (error) { global.toast?.(error.message, 'warn'); return; }
    const candidates = classResultCandidates(report);
    const hasCandidates = candidates.length > 0;
    const portalExam = (state.exam.portal?.classes || [])
      .flatMap((classroom) => classroom.exams || [])
      .find((exam) => exam.examId === examId);
    const defaultIncludesQuestions = state.exam.grading?.includeQuestionnaire === true
      || state.exam.grading?.defaultIncludeQuestionnaire === true
      || portalExam?.includeQuestionnaire === true;
    const selection = hasCandidates
      ? `<label class="dd26-choice dd26-results-select-all"><input id="dd26-class-result-select-all" type="checkbox" checked><span><strong>Select all submitted students</strong><small id="dd26-class-result-selection-count">${escapeHtml(candidates.length)} of ${escapeHtml(candidates.length)} students selected</small></span></label><div class="dd26-result-selection" role="group" aria-label="Choose students for class results download">${candidates.map((candidate) => { const totals = classResultCandidateTotals(candidate); return `<label class="dd26-choice"><input data-dd26-class-result-candidate type="checkbox" value="${escapeHtml(candidate.attemptId)}" checked><span><strong>${escapeHtml(candidate.studentName || candidate.candidateNumber || 'Student')}</strong><small>${escapeHtml(candidate.studentNumber || 'No student number')} &middot; ${escapeHtml(candidate.studentEmail || '')} &middot; ${escapeHtml(candidateSelectionScoreText(candidate, totals))}</small></span></label>`; }).join('')}</div>`
      : '<div class="dd26-notice"><strong>No student has submitted yet.</strong> Download the current roster, attendance state, schedule, and empty offline-grading template now. Submitted answers and per-student tabs will appear automatically in later downloads.</div>';
    openDialog(`<div class="dd26-label">Professor class results</div><h2>Send grades or download an offline workbook</h2><p>${hasCandidates ? 'Select students for the workbook. It includes each selected student&rsquo;s name, email, student number, exact examination questions, submitted answers, current grades, comments, timing, and question analytics.' : 'A Professor workbook is available at every stage of the examination, including before the first submission.'}</p><div class="dd26-notice"><strong>The Professor controls this examination record.</strong> Downloading never changes or sends grades. Sending applies only to selected, fully graded students and does not close the examination or affect anyone else.</div>${selection}${hasCandidates ? `<label class="dd26-choice"><input id="dd26-release-questionnaire" type="checkbox" ${defaultIncludesQuestions ? 'checked' : ''}><span><strong>Include examination questions in student result emails</strong><small>The downloaded Professor workbook always includes questions and submitted answers.</small></span></label>` : ''}<div class="dd26-error" id="dd26-class-results-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button" id="dd26-download-class-workbook" type="button">${hasCandidates ? 'Download selected workbook' : 'Download current workbook'}</button>${report.released || !hasCandidates ? '' : '<button class="dd26-button primary" id="dd26-confirm-release-results" type="button">Send selected results</button>'}</div>${report.released || !hasCandidates ? '' : '<p class="dd26-help">Select only students whose grading is complete. Other students may remain active, submitted, or ungraded.</p>'}`);
    const notice = document.querySelector('#dd26-dialog .dd26-notice');
    if (notice) notice.innerHTML = '<strong>The Professor controls this examination record.</strong> Downloading never changes or sends grades. Sending applies only to the selected fully graded students and does not close the exam, revoke access, or affect any other student.';
    const help = document.querySelector('#dd26-dialog .dd26-help');
    if (help && hasCandidates) help.textContent = 'Select only students whose grading is complete. Other students may remain active, submitted, or ungraded.';
    const sendButton = document.getElementById('dd26-confirm-release-results');
    if (!sendButton && hasCandidates && !report.released) {
      const actions = document.querySelector('#dd26-dialog .dd26-actions');
      const candidateSend = document.createElement('button');
      candidateSend.className = 'dd26-button primary';
      candidateSend.id = 'dd26-confirm-release-results';
      candidateSend.type = 'button';
      candidateSend.textContent = 'Send selected results';
      actions?.append(candidateSend);
    }
    document.getElementById('dd26-class-result-select-all')?.addEventListener('change', (event) => {
      document.querySelectorAll('[data-dd26-class-result-candidate]').forEach((input) => { input.checked = event.target.checked; });
      refreshClassResultsSelectionState();
    });
    document.querySelectorAll('[data-dd26-class-result-candidate]').forEach((input) => input.addEventListener('change', refreshClassResultsSelectionState));
    document.getElementById('dd26-download-class-workbook')?.addEventListener('click', downloadSelectedClassWorkbook);
    document.getElementById('dd26-confirm-release-results')?.addEventListener('click', confirmReleaseResults);
    refreshClassResultsSelectionState();
  }

  function classWorkbookFileName(response, report) {
    const disposition = response.headers.get('Content-Disposition') || '';
    const supplied = disposition.match(/filename="([^"]+)"/i)?.[1] || '';
    const safeSupplied = supplied.replace(/[^a-zA-Z0-9._-]/g, '-');
    return safeSupplied || `due-diligence-${String(report?.title || 'class-results').replace(/[^a-zA-Z0-9_-]/g, '-')}.xlsx`;
  }

  async function downloadClassWorkbook(report, attemptIds, scope, button = null) {
    const session = (global.DueDiligencePhase4 || global.DueDiligencePhase2)?.getSession?.();
    if (!session?.access_token) {
      requireAuthentication();
      throw new Error('Sign in again before downloading class results.');
    }
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Preparing workbook…';
    }
    try {
      const response = await fetch(`${config.workerUrl}/exam-room/results/workbook`, {
        method: 'POST', credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`,
          ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          'X-Request-ID': randomKey('exam_class_workbook'),
        },
        body: JSON.stringify({ examId: report.examId, attemptIds, scope, requestKey: randomKey('class_workbook') }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || 'The class workbook could not be prepared.');
      }
      const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!contentType.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          || bytes.length < 4 || bytes.length > 25 * 1024 * 1024
          || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
        throw new Error('The class workbook response was invalid.');
      }
      const blob = new Blob([bytes], { type: contentType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = classWorkbookFileName(response, report);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Download selected workbook';
        delete button.dataset.originalText;
      }
    }
  }

  async function downloadSelectedClassWorkbook() {
    const report = state.exam.resultsDashboard;
    const attemptIds = selectedClassResultAttemptIds();
    if (!report) return;
    const candidates = classResultCandidates(report);
    if (candidates.length && !attemptIds.length) return;
    const selected = candidates.filter((candidate) => attemptIds.includes(candidate.attemptId));
    const scope = selected.length > 0 && selected.every((candidate) => candidate.allGradesFinal === true)
      ? 'class_results' : 'offline_grading';
    const button = document.getElementById('dd26-download-class-workbook');
    const errorHost = document.getElementById('dd26-class-results-error');
    try {
      await downloadClassWorkbook(report, attemptIds, scope, button);
      stopProfessorRoomPolling();
      closeDialog();
      renderProfessorResultsDashboard(report);
      global.toast?.(scope === 'class_results' ? 'The selected class-results workbook is ready.' : 'The offline-grading workbook is ready.', 'ok');
    } catch (error) {
      if (errorHost) { errorHost.hidden = false; errorHost.textContent = error.message; }
      global.toast?.(error.message, 'warn');
    }
  }

  async function releaseResults() {
    const grading = state.exam.grading;
    const report = state.exam.resultsDashboard;
    if (grading?.unsavedChanges) {
      global.toast?.('Save the current grade before reviewing class results.', 'warn');
      return;
    }
    const examId = grading?.examId || report?.examId || state.exam.activeExamId;
    if (!examId) return;
    await openClassResultsDialog(examId);
  }

  async function confirmReleaseResults() {
    const grading = state.exam.grading;
    const reportBeforeRelease = state.exam.resultsDashboard;
    const candidates = classResultCandidates(reportBeforeRelease);
    const attemptIds = selectedClassResultAttemptIds();
    const selectedCandidates = candidates.filter((candidate) => attemptIds.includes(String(candidate.attemptId || '')));
    const unfinished = selectedCandidates.filter((candidate) => candidate.allGradesFinal !== true);
    if (!selectedCandidates.length || unfinished.length) {
      global.toast?.(selectedCandidates.length
        ? `${unfinished.length} selected student grade set${unfinished.length === 1 ? ' is' : 's are'} not final.`
        : 'Select at least one submitted student.', 'warn');
      return;
    }
    const includeQuestionnaire = document.getElementById('dd26-release-questionnaire')?.checked === true;
    const examId = grading?.examId || reportBeforeRelease?.examId || state.exam.activeExamId;
    const button = document.getElementById('dd26-confirm-release-results');
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    try {
      await command({ operation: 'release_candidate_results', examId, attemptIds, requestKey: randomKey('candidate_release'), includeQuestionnaire, gradingKey: grading?.gradingKey || '' });
      let report;
      try { report = await loadResultsDashboard(examId); }
      catch { report = { ...reportBeforeRelease, released: true, resultDelivery: null }; state.exam.resultsDashboard = report; }
      let workbookReady = false;
      try { workbookReady = await downloadClassWorkbook(report, attemptIds, 'class_results', button); }
      catch (downloadError) { global.toast?.(`Results were sent, but the workbook needs a retry: ${downloadError.message}`, 'warn'); }
      closeDialog();
      renderProfessorResultsDashboard(report);
      global.toast?.(workbookReady
        ? 'Selected student results were queued for delivery verification, and the selected workbook is ready.'
        : 'Selected student results were queued for delivery verification. Retry the workbook from the dashboard.', 'ok');
      await refreshPortalSilently();
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = 'Send graded results';
      }
      global.toast?.(error.message, 'warn');
    }
  }

  function candidateScoreDisclosure(candidate) {
    const totals = classResultCandidateTotals(candidate);
    const questions = Array.isArray(candidate?.questions) ? candidate.questions : [];
    const breakdown = questions.length
      ? `<ol>${questions.map((question) => {
        const hasScore = question.score !== null && question.score !== undefined && question.score !== ''
          && Number.isFinite(Number(question.score));
        const score = hasScore ? Number(question.score).toFixed(2) : 'Pending';
        const maximum = Number(question.maximumPoints || question.maximum || 0).toFixed(2);
        return `<li><span>Question ${escapeHtml(question.ordinal || '')}</span><strong>${escapeHtml(score)} / ${escapeHtml(maximum)}</strong><small>${escapeHtml(question.gradeState === 'final' ? 'Final' : 'Draft / ungraded')}</small></li>`;
      }).join('')}</ol>`
      : '<p>No question-level grades are available yet.</p>';
    const headline = totals.complete
      ? `<span>${escapeHtml(totals.score.toFixed(2))} / ${escapeHtml(totals.maximum.toFixed(2))}</span><strong>${escapeHtml(totals.percentage.toFixed(1))}%</strong>`
      : `<span>Recorded subtotal: ${escapeHtml(totals.score.toFixed(2))}</span><strong>Not final</strong>`;
    const status = totals.complete
      ? 'Final total'
      : `${totals.gradedCount} of ${totals.questionCount} questions graded`;
    const accessibleScore = totals.complete
      ? `Final score ${totals.score.toFixed(2)} out of ${totals.maximum.toFixed(2)}, ${totals.percentage.toFixed(1)} percent`
      : `Recorded subtotal ${totals.score.toFixed(2)}, not final, ${totals.gradedCount} of ${totals.questionCount} questions graded`;
    return `<details class="dd26-score-disclosure"><summary aria-label="${escapeHtml(accessibleScore)}. Open score breakdown for ${escapeHtml(candidate.studentName || candidate.candidateNumber || 'student')}">${headline}<small>${escapeHtml(status)} &middot; View breakdown</small></summary>${breakdown}</details>`;
  }

  function openExamLifecycleDialog(action) {
    const report = state.exam.resultsDashboard;
    if (!report?.examId || !['end_access', 'complete', 'archive'].includes(action)) return;
    const labels = {
      end_access: ['End student access', 'Stops new student entry without submitting, grading, or sending any result. Active answer records remain preserved.'],
      complete: ['Mark examination complete', 'Marks the administrative examination work complete. Student access must be ended first. Results remain available.'],
      archive: ['Archive examination', 'Moves the completed examination to the permanent Professor archive. Complete the examination first.'],
    };
    const [title, explanation] = labels[action];
    openDialog(`<div class="dd26-label">Separate lifecycle control</div><h2>${escapeHtml(title)}</h2><div class="dd26-notice"><strong>This action never sends grades.</strong> ${escapeHtml(explanation)}</div><label class="dd26-field"><span>Reason</span><textarea class="dd26-textarea compact" id="dd26-lifecycle-reason" minlength="5" maxlength="1000" required></textarea></label><label class="dd26-field"><span>Professor grading key (only if this device has not been remembered)</span><input class="dd26-input" id="dd26-lifecycle-key" type="password" autocomplete="one-time-code"></label><div class="dd26-error" id="dd26-lifecycle-error" role="alert" hidden></div><div class="dd26-actions"><button class="dd26-button primary" id="dd26-confirm-lifecycle" type="button">${escapeHtml(title)}</button><button class="dd26-button" data-dd26-close-dialog type="button">Back</button></div>`);
    document.getElementById('dd26-confirm-lifecycle')?.addEventListener('click', async () => {
      const reason = value('dd26-lifecycle-reason');
      const gradingKey = value('dd26-lifecycle-key');
      const errorHost = document.getElementById('dd26-lifecycle-error');
      if (reason.length < 5) {
        errorHost.hidden = false;
        errorHost.textContent = 'Enter a short reason of at least five characters.';
        return;
      }
      const button = document.getElementById('dd26-confirm-lifecycle');
      button.disabled = true;
      try {
        await command({ operation: 'update_exam_lifecycle', examId: report.examId, action, reason, gradingKey, requestKey: randomKey('exam_lifecycle') });
        closeDialog();
        const refreshed = await loadResultsDashboard(report.examId);
        renderProfessorResultsDashboard(refreshed);
        global.toast?.(`${title} was recorded. No grades were sent.`, 'ok');
        await refreshPortalSilently();
      } catch (error) {
        button.disabled = false;
        errorHost.hidden = false;
        errorHost.textContent = error.message;
      }
    });
  }

  function renderProfessorResultsDashboard(report = state.exam.resultsDashboard) {
    if (!report) return;
    state.exam.resultsDashboard = report;
    const analytics = classResultsAnalytics(report);
    const candidates = classResultCandidates(report);
    const deliveryByAttempt = resultDeliveryByAttempt(report);
    const deliverySummary = report?.resultDelivery?.summary || {};
    const gradeRate = analytics.submitted ? (analytics.finalized / analytics.submitted) * 100 : 0;
    const participation = analytics.expected ? (analytics.submitted / analytics.expected) * 100 : 0;
    const questionRows = analytics.questionAnalytics.map((question) => `<tr><td><strong>Question ${escapeHtml(question.ordinal)}</strong></td><td class="dd26-long-cell">${escapeHtml(question.prompt)}</td><td>${escapeHtml(question.answered)} / ${escapeHtml(analytics.submitted)}</td><td>${escapeHtml(question.finals)}</td><td>${escapeHtml(question.averageScore.toFixed(2))} / ${escapeHtml(question.maximum.toFixed(2))}</td><td><div class="dd26-result-bar" aria-label="Question ${escapeHtml(question.ordinal)} average ${escapeHtml(question.averagePercentage.toFixed(1))} percent"><span style="width:${Math.max(0, Math.min(100, question.averagePercentage))}%"></span></div><strong>${escapeHtml(question.averagePercentage.toFixed(1))}%</strong></td></tr>`).join('');
    const candidateRows = candidates.map((candidate) => {
      const delivery = deliveryByAttempt.get(String(candidate.attemptId || ''));
      const released = candidate.released === true || report.released === true;
      const retry = released && delivery?.retryable === true
        ? `<button class="dd26-button compact" data-dd26-retry-result-email="${escapeHtml(candidate.attemptId)}" type="button">Retry grade email</button>`
        : '';
      return `<tr><td><strong>${escapeHtml(candidate.studentName || candidate.candidateNumber || 'Student')}</strong><br><small>${escapeHtml(candidate.studentNumber || 'No student number')}</small></td><td>${escapeHtml(candidate.studentEmail || '')}</td><td>${escapeHtml(candidate.status || '')}</td><td>${candidateScoreDisclosure(candidate)}</td><td>${candidate.allGradesFinal ? 'Final' : 'Draft / incomplete'}</td><td>${released ? `<span class="dd26-delivery-status is-${escapeHtml(delivery?.deliveryStatus || candidate.deliveryStatus || 'pending')}">${escapeHtml(resultDeliveryLabel(delivery || candidate))}</span>${retry}` : 'Not sent'}</td></tr>`;
    }).join('');
    const deliveryMetrics = report.resultDelivery ? `<section class="dd26-section dd26-delivery-panel"><div class="dd26-question-meta"><div><div class="dd26-label">Student email delivery</div><h3>Provider-confirmed result delivery</h3></div><button class="dd26-button compact" id="dd26-refresh-delivery" type="button">Refresh delivery status</button></div><p>Email-provider acceptance is not shown as successful delivery. A student is marked Delivered only after the recipient mail server accepts the message.</p><div class="dd26-stat-grid"><div class="dd26-stat"><strong>${escapeHtml(deliverySummary.delivered || 0)}</strong><span>Delivered</span></div><div class="dd26-stat"><strong>${escapeHtml(deliverySummary.accepted || 0)}</strong><span>Awaiting confirmation</span></div><div class="dd26-stat"><strong>${escapeHtml(deliverySummary.delayed || 0)}</strong><span>Delayed</span></div><div class="dd26-stat"><strong>${escapeHtml(deliverySummary.failed || 0)}</strong><span>Failed / bounced</span></div></div></section>` : '';
    document.getElementById('dd26-exam-main').innerHTML = `<section class="dd26-card dd26-results-dashboard"><section class="dd26-section"><div class="dd26-label">Professor results dashboard</div><div class="dd26-question-meta"><h2>${escapeHtml(report.title || 'Class results')}</h2><span class="dd26-status">${report.released ? 'Released and sealed' : 'Professor working record'}</span></div><p>Authoritative class analysis for the owning Professor. Workbook downloads contain the exact examination questions and each selected student&rsquo;s final submitted answers for verification or offline grading.</p><div class="dd26-actions"><button class="dd26-button primary" id="dd26-dashboard-download" type="button">Choose students / download</button>${!report.released && analytics.submitted > 0 && analytics.ungraded === 0 ? '<button class="dd26-button" id="dd26-dashboard-send" type="button">Send final grades</button>' : ''}<button class="dd26-button" id="dd26-dashboard-refresh" type="button">Refresh dashboard</button><button class="dd26-button" id="dd26-dashboard-back" type="button">Return to Professor workspace</button></div><p class="dd26-help">Server-saved view refreshed ${escapeHtml(formatDate(report.generatedAt || new Date().toISOString()))}. Final totals open to show the question-by-question breakdown; incomplete grading is labeled as a recorded subtotal.</p></section><div class="dd26-stat-grid dd26-result-metrics"><div class="dd26-stat"><strong>${escapeHtml(analytics.submitted)}</strong><span>Submitted of ${escapeHtml(analytics.expected)} expected</span></div><div class="dd26-stat"><strong>${escapeHtml(participation.toFixed(1))}%</strong><span>Participation</span></div><div class="dd26-stat"><strong>${escapeHtml(analytics.average.toFixed(1))}%</strong><span>Class average</span></div><div class="dd26-stat"><strong>${escapeHtml(analytics.median.toFixed(1))}%</strong><span>Median score</span></div><div class="dd26-stat"><strong>${escapeHtml(analytics.finalized)}</strong><span>Fully graded</span></div><div class="dd26-stat"><strong>${escapeHtml(gradeRate.toFixed(1))}%</strong><span>Grading complete</span></div><div class="dd26-stat"><strong>${escapeHtml(analytics.absent)}</strong><span>Absent / no-show</span></div></div>${deliveryMetrics}<section class="dd26-section"><div class="dd26-result-extremes"><div><span>Strongest item</span><strong>${analytics.highestQuestion ? `Question ${escapeHtml(analytics.highestQuestion.ordinal)} &middot; ${escapeHtml(analytics.highestQuestion.averagePercentage.toFixed(1))}%` : 'No finalized score data'}</strong></div><div><span>Lowest-performing item</span><strong>${analytics.lowestQuestion ? `Question ${escapeHtml(analytics.lowestQuestion.ordinal)} &middot; ${escapeHtml(analytics.lowestQuestion.averagePercentage.toFixed(1))}%` : 'No finalized score data'}</strong></div></div><h3>Question performance</h3>${questionRows ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Item</th><th>Professor question</th><th>Answered</th><th>Final</th><th>Average score</th><th>Performance</th></tr></thead><tbody>${questionRows}</tbody></table></div>` : '<div class="dd26-empty">No question-level grades are available.</div>'}</section><section class="dd26-section"><h3>Student results</h3>${candidateRows ? `<div class="dd26-table-wrap"><table class="dd26-table"><thead><tr><th>Student</th><th>Email</th><th>Status</th><th>Total score</th><th>Grade status</th><th>Email delivery</th></tr></thead><tbody>${candidateRows}</tbody></table></div>` : '<div class="dd26-empty">No submitted student examinations are available.</div>'}</section></section>`;
    const dashboardActions = document.querySelector('.dd26-results-dashboard > .dd26-section .dd26-actions');
    if (!document.getElementById('dd26-dashboard-send') && !report.released && analytics.finalized > 0) {
      const send = document.createElement('button');
      send.className = 'dd26-button';
      send.id = 'dd26-dashboard-send';
      send.type = 'button';
      send.textContent = 'Send selected grades';
      dashboardActions?.insertBefore(send, document.getElementById('dd26-dashboard-refresh'));
    }
    if (!report.released) {
      const lifecycle = document.createElement('div');
      lifecycle.className = 'dd26-actions dd26-lifecycle-actions';
      lifecycle.setAttribute('aria-label', 'Separate examination lifecycle controls');
      lifecycle.innerHTML = '<button class="dd26-button" data-dd26-lifecycle="end_access" type="button">End student access</button><button class="dd26-button" data-dd26-lifecycle="complete" type="button">Mark exam complete</button><button class="dd26-button" data-dd26-lifecycle="archive" type="button">Archive exam</button>';
      dashboardActions?.after(lifecycle);
    }
    document.getElementById('dd26-dashboard-download')?.addEventListener('click', () => openClassResultsDialog(report.examId));
    document.getElementById('dd26-dashboard-send')?.addEventListener('click', releaseResults);
    document.getElementById('dd26-dashboard-refresh')?.addEventListener('click', () => openResultsDashboard(report.examId));
    document.getElementById('dd26-refresh-delivery')?.addEventListener('click', () => openResultsDashboard(report.examId));
    document.querySelectorAll('[data-dd26-lifecycle]').forEach((button) => button.addEventListener('click', () => openExamLifecycleDialog(button.dataset.dd26Lifecycle)));
    document.querySelectorAll('[data-dd26-retry-result-email]').forEach((button) => button.addEventListener('click', () => retryStudentResultEmail(button)));
    document.getElementById('dd26-dashboard-back')?.addEventListener('click', async () => {
      state.exam.resultsDashboard = null;
      clearGradingWorkspace();
      await refreshExamPortal('professor');
    });
    document.getElementById('dd26-exam-main')?.focus();
  }

  function resultPdfFileName(response, candidate, scope) {
    const disposition = response.headers.get('Content-Disposition') || '';
    const supplied = disposition.match(/filename="([^"]+)"/i)?.[1] || '';
    const safeSupplied = supplied.replace(/[^a-zA-Z0-9._-]/g, '-');
    return safeSupplied || `due-diligence-${String(candidate || 'student').replace(/[^a-zA-Z0-9_-]/g, '-')}-${scope}.pdf`;
  }

  async function downloadCandidateResult(scope = 'questions_answers') {
    const grading = state.exam.grading;
    const candidate = grading?.candidates?.[state.exam.gradingCandidate];
    if (!grading || !candidate) return;
    if (grading.unsavedChanges) {
      global.toast?.('Save the current grade before downloading this result.', 'warn');
      return;
    }
    if (scope === 'grades_comments' && !currentCandidateGradesAreFinal()) {
      global.toast?.('Finalize every grade for this student before downloading the result.', 'warn');
      return;
    }
    if (!['questions_answers', 'grades_comments'].includes(scope)) return;
    const session = (global.DueDiligencePhase4 || global.DueDiligencePhase2)?.getSession?.();
    if (!session?.access_token) {
      requireAuthentication();
      return;
    }
    const button = document.getElementById(scope === 'grades_comments' ? 'dd26-download-grade-report' : 'dd26-download-answer-sheet');
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing PDF…';
    }
    try {
      const response = await fetch(`${config.workerUrl}/exam-room/results/pdf`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          'X-Request-ID': randomKey('exam_result_pdf'),
        },
        body: JSON.stringify({ examId: grading.examId, attemptId: candidate.attemptId, scope, gradingKey: grading.gradingKey, requestKey: randomKey('exam_result') }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || 'This student result PDF could not be prepared.');
      }
      const contentType = response.headers.get('Content-Type') || '';
      const blob = await response.blob();
      if (!contentType.toLowerCase().startsWith('application/pdf') || !blob.size || blob.size > 5 * 1024 * 1024) {
        throw new Error('The student result PDF response was invalid.');
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = resultPdfFileName(response, candidate.candidateNumber, scope);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      global.toast?.('This student’s private PDF is ready.', 'ok');
    } catch (error) {
      global.toast?.(error.message, 'warn');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = scope === 'grades_comments' ? 'Download final grade PDF' : 'Download student answer PDF';
      }
    }
  }

  async function requestFullscreen() {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return false;
    try {
      await document.documentElement.requestFullscreen();
      return Boolean(document.fullscreenElement);
    } catch {
      global.toast?.('Full screen could not be opened. You may continue; the Professor can review that full screen was unavailable.', 'warn');
      return false;
    }
  }

  let dialogReturnFocus = null;
  let dialogCleanup = null;

  function finishDialogLifecycle(dialog = document.getElementById('dd26-dialog')) {
    if (!dialog) return;
    const card = document.getElementById('dd26-dialog-card');
    card?.querySelectorAll('input[type="password"], [data-dd26-sensitive]').forEach((node) => {
      if ('value' in node) node.value = '';
      node.textContent = '';
    });
    if (dialog.dataset.sensitive === 'true') card?.replaceChildren();
    dialog.dataset.sensitive = 'false';
    const cleanup = dialogCleanup;
    dialogCleanup = null;
    try { cleanup?.(); } catch { /* secrets are already removed from the dialog */ }
  }

  function openDialog(content, options = {}) {
    let dialog = document.getElementById('dd26-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'dd26-dialog';
      dialog.className = 'dd26-modal';
      dialog.setAttribute('aria-labelledby', 'dd26-dialog-heading');
      dialog.innerHTML = '<div class="dd26-modal-card" id="dd26-dialog-card" tabindex="-1"></div>';
      document.body.append(dialog);
      dialog.addEventListener('cancel', (event) => {
        if (dialog.dataset.persistent === 'true') event.preventDefault();
      });
      dialog.addEventListener('close', () => {
        finishDialogLifecycle(dialog);
        dialogReturnFocus?.focus?.();
        dialogReturnFocus = null;
      });
    }
    const nextReturnFocus = document.activeElement;
    const preserveOriginalFocus = dialog.open && dialogReturnFocus?.isConnected;
    finishDialogLifecycle(dialog);
    if (!preserveOriginalFocus) dialogReturnFocus = nextReturnFocus;
    dialog.dataset.persistent = options.persistent ? 'true' : 'false';
    dialog.dataset.sensitive = options.sensitive ? 'true' : 'false';
    dialogCleanup = typeof options.onClose === 'function' ? options.onClose : null;
    const card = document.getElementById('dd26-dialog-card');
    card.innerHTML = content.replace(/<h2(\s|>)/, '<h2 id="dd26-dialog-heading"$1');
    if (!card.querySelector('.dd26-dialog-close, .dd26-verdict-close')) {
      card.insertAdjacentHTML('afterbegin', '<button class="dd26-dialog-close" data-dd26-close-dialog type="button" aria-label="Close dialog and go back">&times;</button>');
    }
    let actions = card.querySelector('.dd26-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'dd26-actions';
      card.append(actions);
    }
    let back = actions.querySelector('[data-dd26-close-dialog]');
    if (!back) {
      back = document.createElement('button');
      back.type = 'button';
      back.className = 'dd26-button';
      back.dataset.dd26CloseDialog = 'true';
      actions.append(back);
    }
    back.textContent = 'Back';
    back.setAttribute('aria-label', 'Back');
    back.classList.remove('primary', 'danger');
    document.querySelectorAll('[data-dd26-close-dialog]').forEach((button) => button.addEventListener('click', closeDialog));
    if (!dialog.open) dialog.showModal();
    document.getElementById('dd26-dialog-card')?.focus();
  }

  function closeDialog() {
    const dialog = document.getElementById('dd26-dialog');
    finishDialogLifecycle(dialog);
    if (dialog?.open) dialog.close();
  }
  function showOneTimeSecret(title, secret, help) {
    openDialog(`<div class="dd26-label">One-time key</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(help)}</p><div class="dd26-secret-row"><div class="dd26-raw-key" id="dd26-one-time-secret" data-dd26-sensitive>${escapeHtml(secret)}</div><button class="dd26-button" data-dd26-copy-secret="dd26-one-time-secret" type="button">Copy</button></div><div class="dd26-actions"><button class="dd26-button primary" data-dd26-close-dialog type="button">I stored it securely</button></div>`, { persistent: true, sensitive: true });
    secret = '';
    bindSecretCopyButtons();
  }

  function bindSecretCopyButtons() {
    document.querySelectorAll('[data-dd26-copy-secret]').forEach((button) => button.addEventListener('click', async () => {
      const text = document.getElementById(button.dataset.dd26CopySecret)?.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
      } catch { global.toast?.('Copy was not available. Select the displayed secret manually.', 'warn'); }
    }));
  }
  function value(id, trim = true) { const result = document.getElementById(id)?.value ?? ''; return trim ? String(result).trim() : String(result); }
  async function refreshPortalSilently() {
    const lifecycle = captureExamPortalLifecycle();
    if (!lifecycle) return false;
    try {
      const payload = await api('/exam-room/query', { operation: 'portal' });
      if (!isCurrentExamPortalLifecycle(lifecycle)) return false;
      const portal = payload.result;
      await enrichProfessorExamIntents(portal);
      if (!isCurrentExamPortalLifecycle(lifecycle)) return false;
      state.exam.portal = portal;
      return true;
    } catch { return false; }
  }

  global.addEventListener?.('pagehide', () => {
    persistCurrentGradingDraft();
  }, { capture: true });
  global.addEventListener?.('pageshow', (event) => {
    if (event.persisted && state.view === 'exam_room') {
      if (state.exam.attempt?.status === 'in_progress') state.exam.section = 'student';
      renderExamRoom();
      announceExamStatus(state.exam.attempt?.status === 'in_progress'
        ? 'Your examination was restored at the exact question you left. The official timer continued.'
        : 'Examination Room restored. Your current workspace was preserved.');
    }
  }, { capture: true });
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistCurrentGradingDraft();
  }, { capture: true });

  function routeFromHash() {
    let raw = '';
    try { raw = decodeURIComponent(location.hash.replace(/^#/, '')); }
    catch { return null; }
    if (raw === 'bar-easy') return ['bar_easy'];
    if (raw === 'chairs-cases') return ['chair_case'];
    if (raw === 'doctrines') return ['doctrine'];
    if (raw === 'examination-room') return ['exam_room'];
    if (raw.startsWith('examination-room?')) {
      const parameters = new URLSearchParams(raw.slice('examination-room?'.length));
      const allowed = new Set(['exam', 'submission', 'question', 'role']);
      const keys = [...parameters.keys()];
      if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) return null;
      const examId = String(parameters.get('exam') || '').trim();
      const role = ['student', 'professor'].includes(parameters.get('role')) ? parameters.get('role') : '';
      const submissionId = String(parameters.get('submission') || '').trim();
      const questionOrdinal = Number(parameters.get('question') || 0);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuid.test(examId) || (submissionId && !uuid.test(submissionId))
          || (questionOrdinal && (!Number.isSafeInteger(questionOrdinal) || questionOrdinal < 1 || questionOrdinal > 200))
          || (submissionId && role !== 'professor')
          || (questionOrdinal && !submissionId)) return null;
      return ['exam_room', examId, {
        role,
        submissionId,
        questionOrdinal,
      }];
    }
    if (raw === 'anchor-case-digests') return ['anchor_case'];
    if (raw.startsWith('anchor-case-digests/')) return ['anchor_case', raw.slice('anchor-case-digests/'.length)];
    return null;
  }

  function restoreRoute() {
    const route = routeFromHash();
    if (route) open(route[0], document.getElementById(CONTENT_PATHS[route[0]].tab), {
      replace: true, detailId: route[1] || null, ...(route[2] || {}),
    });
  }

  global.DueDiligence2026 = Object.freeze({ open, exportVerdict, openVerdictExport, refreshExamPortal, restoreRoute });
  global.openBarEasy = () => open('bar_easy', document.getElementById('spa-bar-easy'));
  global.openChairCases = () => open('chair_case', document.getElementById('spa-chairs-case'));
  global.openDoctrines = () => open('doctrine', document.getElementById('spa-jurisprudence'));
  global.openAnchorCases = () => open('anchor_case', document.getElementById('spa-case-digest'));
  global.openExaminationRoom = async () => {
    const moduleIsOpen = state.view === 'exam_room'
      && document.getElementById('page-dd2026')?.classList.contains('active');
    if (moduleIsOpen) {
      const returnedHome = await returnToExaminationRoomHome();
      if (!returnedHome) return false;
    }
    state.exam.section = 'entry';
    state.exam.intentRole = null;
    state.exam.entryExamId = '';
    state.exam.routeRole = '';
    state.exam.routeSubmissionId = '';
    state.exam.routeQuestionOrdinal = 0;
    state.exam.gradingDetailOpen = false;
    return open('exam_room', document.getElementById('spa-examination-room'));
  };
  global.addEventListener('popstate', restoreRoute);
  global.addEventListener('duediligence:session', (event) => {
    const sessionUserId = event.detail?.authenticated ? event.detail?.userId || null : null;
    const { identityChanged } = synchronizeSessionCaches(sessionUserId);
    if (event.detail?.authenticated) {
      const activeWritingSession = state.view === 'exam_room'
        && state.exam.attempt?.status === 'in_progress'
        && state.sessionUserId === sessionUserId
        && authenticatedUserId() === sessionUserId;
      if (activeWritingSession) {
        state.exam.section = 'student';
        if (!document.getElementById('dd26-attempt-surface')) renderExamRoom();
        return;
      }
      const route = routeFromHash();
      const routePageActive = document.getElementById('page-dd2026')?.classList.contains('active');
      if (route?.[0] === 'exam_room') {
        if (!shouldReopenSessionRoute(identityChanged, routePageActive)) return;
        open('exam_room', document.getElementById(CONTENT_PATHS.exam_room.tab), {
          replace: true, detailId: route[1] || null, ...(route[2] || {}),
        })
          .then((opened) => {
            if (opened !== true
                || state.sessionUserId !== sessionUserId
                || authenticatedUserId() !== sessionUserId) return;
            if (state.exam.intentRole) selectExamRole(state.exam.intentRole);
          });
      } else if (route && shouldReopenSessionRoute(identityChanged, routePageActive)) restoreRoute();
      return;
    }
    if (state.view === 'exam_room') {
      clearAttemptTimers();
      state.exam.studentExamCodes.clear();
      state.exam.preflight = null;
      state.exam.attempt = null;
      state.exam.grading = null;
      state.exam.gradingModelAnswer = null;
      state.exam.monitoring = null;
      closeDialog();
    }
    if (document.getElementById('page-dd2026')?.classList.contains('active')) {
      if (state.view === 'exam_room') {
        state.exam.portal = null;
        state.exam.section = 'entry';
        renderExamRoom();
      } else global.showPage?.('mock', document.getElementById('spa-mock'));
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restoreRoute, { once: true });
  else restoreRoute();
}(window));
