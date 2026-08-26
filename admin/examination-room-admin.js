(function examinationRoomAdministration(global) {
  'use strict';

  const api = global.ExaminationRoomV1Api;
  const TABS = Object.freeze({
    overview: ['Overview', 'ph-squares-four'],
    professor_access: ['Creator Directory', 'ph-chalkboard-teacher'],
    examinations: ['Examinations', 'ph-files'],
    questions: ['Questions', 'ph-list-numbers'],
    students_answers: ['Students & Answers', 'ph-student'],
    grades_results: ['Grades & Results', 'ph-seal-check'],
    keys_email: ['Keys & Email', 'ph-key'],
    recovery_audit: ['Recovery & Audit', 'ph-database'],
  });
  const DETAIL_TABS = new Set(['examinations', 'questions', 'students_answers', 'grades_results', 'keys_email', 'recovery_audit']);
  const EXAM_PAGE_SIZE = 100;
  const SNAPSHOT_PAGE_SIZE = 100;
  const AUDIT_PAGE_SIZE = 250;
  const OWNER_ACTION_STORAGE_PREFIX = 'duediligence:examination-room:v1:pending-owner-action';
  const LEGACY_OWNER_ROTATION_STORAGE_PREFIX = 'duediligence:examination-room:v1:pending-owner-rotation';
  const PERSISTED_OWNER_ACTIONS = new Set(['approve_and_email_key', 'resend_key', 'rotate_key']);
  const PREFLIGHT_CHECKS = Object.freeze([
    Object.freeze({ id: 'owner_data_key', label: 'Room-key protection', icon: 'ph-lock-key', help: 'Confirms that issued room keys can be encrypted before storage.', recovery: 'Finish the owner room-key encryption setup, then run the system check again.' }),
    Object.freeze({ id: 'owner_email_recipients', label: 'Owner email copies', icon: 'ph-envelope-simple-open', help: 'Confirms that at least one platform-owner address receives every key copy.', recovery: 'Add at least one valid platform-owner email address, then run the system check again.' }),
    Object.freeze({ id: 'key_email_delivery', label: 'Email delivery', icon: 'ph-paper-plane-tilt', help: 'Confirms that the dedicated Examination Room email service can send room keys.', recovery: 'Finish the Examination Room email sender and provider setup, then run the system check again.' }),
    Object.freeze({ id: 'encrypted_recovery', label: 'Encrypted recovery', icon: 'ph-database', help: 'Confirms that encrypted examination backups can be written to private recovery storage.', recovery: 'Finish the encrypted recovery-key and private storage setup, then run the system check again.' }),
  ]);
  const state = {
    access: null,
    data: null,
    root: null,
    toast: () => {},
    refresh: async () => {},
    institutionId: null,
    selectedExamId: null,
    tab: 'overview',
    search: '',
    loadRequest: 0,
    busy: new Set(),
    details: new Map(),
    audit: new Map(),
    recovery: new Map(),
    currentKeys: new Map(),
    deliveries: new Map(),
    actionRequests: new Map(),
    examPaging: null,
    inlineError: null,
    preflight: null,
    preflightError: null,
    ownerUserId: '',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[character]));
  }

  function list(value) { return Array.isArray(value) ? value : []; }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function firstList(...values) { return values.find(Array.isArray) || []; }
  function camelKey(value) { return String(value).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()); }
  function uiValue(value) {
    if (Array.isArray(value)) return value.map(uiValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [camelKey(key), uiValue(entry)]));
  }
  function uiList(value) { return list(value).map(uiValue); }
  function examId(exam) { return String(exam?.examId || exam?.id || '').trim(); }
  function snapshotId(snapshot) { return String(snapshot?.snapshotId || snapshot?.id || '').trim(); }
  function isUnsupported(error) { return /UNSUPPORTED|UNKNOWN_OPERATION|NOT_IMPLEMENTED|not available|not registered/i.test(`${error?.code || ''} ${error?.message || ''}`); }
  function statusLabel(value) { return String(value || 'not_recorded').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function formatDateTime(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(date);
  }
  function searchText(...values) {
    return escapeHtml(values.flat(Infinity).filter((value) => value != null).map((value) => typeof value === 'object' ? JSON.stringify(value) : String(value)).join(' ').toLowerCase());
  }
  function statusBadge(value) {
    const status = String(value || 'not_recorded').toLowerCase();
    return `<span class="exam-admin-status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
  }
  function rawPanel(label, value) {
    return `<details class="exam-admin-raw"><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(JSON.stringify(value ?? null, null, 2))}</pre></details>`;
  }
  function errorPanel(error, retry = 'refresh') {
    return `<div class="exam-admin-error" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i><div><strong>${escapeHtml(error?.message || 'The owner action could not be completed.')}</strong><p>${escapeHtml(error?.recovery || 'Nothing was discarded. Check the connection and try again.')}</p></div>${retry ? `<button class="secondary-button" type="button" data-exam-admin-retry="${escapeHtml(retry)}">Try again</button>` : ''}</div>`;
  }
  function metric(label, value, help, icon) {
    return `<article class="exam-admin-metric"><i class="ph ${icon}" aria-hidden="true"></i><span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><em>${escapeHtml(help)}</em></span></article>`;
  }
  function fact(label, value, note = '') {
    return `<article><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || 'Not recorded')}</strong>${note ? `<span>${escapeHtml(note)}</span>` : ''}</article>`;
  }

  function normalizePreflight(value) {
    const source = uiValue(value);
    return {
      ready: source.ready === true,
      checkedAt: source.checkedAt || null,
      checks: list(source.checks).map((check) => ({
        id: String(check?.id || '').trim(),
        ok: check?.ok === true,
        status: String(check?.status || '').trim(),
        message: String(check?.message || '').trim(),
        recovery: String(check?.recovery || '').trim(),
      })),
    };
  }

  async function requestPreflight(requestToken = null) {
    try {
      const result = normalizePreflight(await api.adminQuery('preflight', {}));
      if (requestToken != null && requestToken !== state.loadRequest) return null;
      state.preflight = result;
      state.preflightError = null;
      return result;
    } catch (error) {
      if (requestToken != null && requestToken !== state.loadRequest) return null;
      state.preflight = null;
      state.preflightError = error;
      return null;
    }
  }

  function institutions() {
    return list(state.access?.institutions).filter((entry) => entry?.institutionStatus !== 'suspended' && entry?.status !== 'suspended' && entry?.ownerAccessible !== false);
  }
  function currentInstitution() {
    return state.data?.institution || institutions().find((entry) => (entry.institutionId || entry.id) === state.institutionId) || {};
  }
  function selectedExam() { return list(state.data?.exams).find((exam) => examId(exam) === state.selectedExamId) || null; }
  function selectedDetail() { return state.selectedExamId ? state.details.get(state.selectedExamId) || null : null; }
  function activationOf(exam) { return exam?.activation || firstList(exam?.activations)[0] || null; }
  function selectedRoomActivation(exam = selectedExam(), detail = selectedDetail()) {
    return firstList(detail?.activations)[0] || activationOf(detail?.exam) || activationOf(exam);
  }
  function canApprove(exam) {
    const publication = String(exam?.publicationStatus || exam?.status || '').toLowerCase();
    const room = String(activationOf(exam)?.status || activationOf(exam)?.activationStatus || '').toLowerCase();
    return ['published', 'key_requested', 'awaiting_approval', 'awaiting_activation'].includes(publication)
      && !['scheduled', 'active', 'open'].includes(room);
  }
  function pendingKeyRequests() {
    return list(state.data?.exams)
      .filter((exam) => canApprove(exam))
      .sort((left, right) => new Date(right.keyRequestedAt || right.publishedAt || right.updatedAt || 0).getTime()
        - new Date(left.keyRequestedAt || left.publishedAt || left.updatedAt || 0).getTime());
  }
  function questions(detail = selectedDetail()) {
    const source = object(detail); const exam = object(source.exam); const manifest = object(source.publicationManifest);
    return firstList(source.questions, exam.questions, source.examVersion?.questions, source.version?.questions, manifest.questions, source.data?.questions);
  }
  function students(detail = selectedDetail()) {
    const source = object(detail); const exam = object(source.exam);
    return firstList(source.students, source.roster, exam.roster, source.data?.students, source.monitor?.students);
  }
  function sessions(detail = selectedDetail()) { const source = object(detail); return firstList(source.sessions, source.studentSessions, source.monitor?.sessions, source.grading?.sessions, source.monitor?.students, source.data?.sessions); }
  function submissions(detail = selectedDetail()) { const source = object(detail); return firstList(source.submissions, source.studentSubmissions, source.monitor?.submissions, source.grading?.submissions, source.data?.submissions); }
  function answers(detail = selectedDetail()) {
    const source = object(detail); const direct = firstList(source.answers, source.answerRevisions, source.grading?.answerRevisions, source.monitor?.answerRevisions, source.data?.answers, source.data?.answerRevisions);
    if (direct.length) return direct;
    return submissions(detail).flatMap((submission) => firstList(submission.answers, submission.answerRevisions).map((answer) => ({ ...answer, sessionId: submission.sessionId, submissionId: submission.id || submission.submissionId })));
  }
  function activeReleaseForGrade(grade, allReleases = []) {
    const gradeIdentifier = grade?.gradeRevisionId || grade?.id;
    const releases = list(allReleases).length ? list(allReleases) : list(grade?.releases);
    const release = releases
      .filter((entry) => {
        const directGradeId = entry.gradeRevisionId || entry.gradeId;
        const fallbackMatch = !directGradeId && (
          (entry.submissionId && entry.submissionId === grade?.submissionId)
          || list(entry.sessionIds).includes(grade?.sessionId)
        );
        return (directGradeId === gradeIdentifier || fallbackMatch)
          && String(entry.releaseAction || entry.action || 'release').toLowerCase() === 'release';
      })
      .sort((left, right) => new Date(right.occurredAt || right.releasedAt || 0).getTime()
        - new Date(left.occurredAt || left.releasedAt || 0).getTime())
      .find((candidate) => !candidate.revokedAt && candidate.revoked !== true && !releases.some((entry) => (
        String(entry.releaseAction || entry.action || '').toLowerCase() === 'revoke'
        && (entry.supersedesReleaseId || entry.releaseId) === (candidate.id || candidate.releaseId)
      )));
    return release || null;
  }
  function decorateGrade(grade, releases = []) {
    const release = activeReleaseForGrade(grade, releases);
    return {
      ...grade,
      released: Boolean(release),
      activeRelease: release,
      releasedAt: release?.occurredAt || release?.releasedAt || null,
    };
  }
  function grades(detail = selectedDetail()) {
    const source = object(detail);
    const releases = firstList(source.releases, source.resultReleases, source.grading?.releases, source.data?.releases, source.data?.resultReleases);
    const sessionRows = sessions(detail);
    const rosterRows = students(detail);
    const submissionRows = submissions(detail);
    const questionRows = questions(detail);
    const decorated = firstList(source.grades, source.gradeRevisions, source.data?.grades, source.grading?.students, source.grading?.gradeRevisions, source.studentsWithGrades)
      .map((grade) => {
        const session = sessionRows.find((entry) => (entry.id || entry.sessionId) === grade.sessionId) || {};
        const student = rosterRows.find((entry) => (entry.id || entry.studentIdentityId) === session.studentId
          || identityOf(entry).studentNumber === session.studentNumber) || {};
        const identity = identityOf(student);
        return decorateGrade({
          ...grade,
          fullName: grade.fullName || grade.studentName || session.fullName || identity.fullName,
          studentNumber: grade.studentNumber || session.studentNumber || identity.studentNumber,
        }, releases.length ? releases : list(grade.releases));
      });
    const flatQuestionRows = decorated.filter((grade) => (
      (grade.questionId || grade.questionKey || grade.questionNumber)
      && (grade.points != null || grade.pointsAwarded != null || grade.score != null)
      && !firstList(grade.items, grade.scores, grade.manifest?.items, grade.manifest?.scores).length
    ));
    if (!flatQuestionRows.length || flatQuestionRows.length !== decorated.length) return decorated;

    const latestByQuestion = new Map();
    flatQuestionRows.forEach((grade) => {
      const questionKey = grade.questionId || grade.questionKey || grade.questionNumber;
      const key = `${grade.sessionId || grade.studentNumber || grade.fullName || 'student'}:${questionKey}`;
      const current = latestByQuestion.get(key);
      const revision = Number(grade.revision ?? grade.revisionNumber ?? 0);
      const currentRevision = Number(current?.revision ?? current?.revisionNumber ?? 0);
      const at = new Date(grade.gradedAt || grade.at || grade.createdAt || 0).getTime();
      const currentAt = new Date(current?.gradedAt || current?.at || current?.createdAt || 0).getTime();
      if (!current || revision > currentRevision || (revision === currentRevision && at >= currentAt)) latestByQuestion.set(key, grade);
    });

    const grouped = new Map();
    [...latestByQuestion.values()].forEach((grade) => {
      const groupKey = grade.sessionId || grade.studentNumber || grade.fullName || grade.id;
      const session = sessionRows.find((entry) => (entry.id || entry.sessionId) === grade.sessionId) || {};
      const submission = submissionRows.find((entry) => entry.sessionId === grade.sessionId) || {};
      const question = questionRows.find((entry) => (
        [entry.id, entry.questionId, entry.questionKey, entry.number, entry.questionNumber]
          .filter((value) => value != null)
          .map(String)
          .includes(String(grade.questionId || grade.questionKey || grade.questionNumber))
      )) || {};
      const score = Number(grade.points ?? grade.pointsAwarded ?? grade.score ?? 0);
      const maximum = Number(question.points ?? grade.maximumPoints ?? grade.maxPoints ?? 0);
      if (!grouped.has(groupKey)) grouped.set(groupKey, {
        id: grade.id,
        sessionId: grade.sessionId,
        submissionId: grade.submissionId || submission.id || submission.submissionId,
        submittedAt: grade.submittedAt || submission.submittedAt || submission.receivedAt,
        fullName: grade.fullName,
        studentNumber: grade.studentNumber,
        email: grade.email,
        gradeStatus: 'complete',
        revisionNumber: 0,
        totalScore: 0,
        maximumScore: 0,
        items: [],
        rawRevisions: [],
      });
      const group = grouped.get(groupKey);
      const revision = Number(grade.revision ?? grade.revisionNumber ?? 0);
      if (revision >= group.revisionNumber) {
        group.id = grade.id || group.id;
        group.revisionNumber = revision;
        group.gradedAt = grade.gradedAt || grade.at || grade.createdAt || group.gradedAt;
      }
      group.totalScore += Number.isFinite(score) ? score : 0;
      group.maximumScore += Number.isFinite(maximum) ? maximum : 0;
      group.items.push({
        questionId: grade.questionId || grade.questionKey,
        questionNumber: grade.questionNumber || question.questionNumber || question.number,
        questionKey: grade.questionKey || question.questionKey,
        pointsAwarded: Number.isFinite(score) ? score : grade.points,
        maximumPoints: Number.isFinite(maximum) ? maximum : question.points,
        feedback: grade.feedback || '',
        revision,
      });
      group.rawRevisions.push(grade);
    });
    return [...grouped.values()].map((grade) => ({
      ...decorateGrade(grade, releases),
      items: grade.items.sort((left, right) => Number(left.questionNumber || 0) - Number(right.questionNumber || 0)),
    }));
  }
  function normalizeSnapshot(snapshot) {
    const normalized = uiValue(snapshot);
    return {
      ...normalized,
      verified: normalized.verified === true || Boolean(normalized.verifiedAt),
    };
  }
  function snapshotVerified(snapshot) {
    return snapshot?.verified === true || Boolean(snapshot?.verifiedAt)
      || String(snapshot?.verificationStatus || '').toLowerCase() === 'verified';
  }
  function studentAcademicFacts(identity, student, examSubject = '') {
    const identityAccommodation = object(identity?.accommodations);
    const rosterAccommodation = object(student?.accommodations);
    return {
      yearLevel: identity?.yearLevel || student?.yearLevel
        || identityAccommodation.yearLevel || identityAccommodation.year_level
        || rosterAccommodation.yearLevel || rosterAccommodation.year_level || '',
      subject: identity?.subject || student?.subject
        || identityAccommodation.subject || rosterAccommodation.subject || examSubject || '',
    };
  }

  function normalizeCenter(center, directory, access) {
    const source = object(center); const people = object(directory);
    const staff = firstList(source.staff, people.staff, source.commandCenter?.staff);
    const exams = firstList(source.exams, source.examSummaries, source.commandCenter?.exams, source.data?.exams).map((exam) => {
      const professorUserId = exam.professorUserId || exam.ownerUserId || exam.createdByUserId;
      const professor = staff.find((member) => member.userId === professorUserId || member.profileId === professorUserId);
      return {
        ...exam,
        professorName: exam.professorName || exam.ownerName || professor?.displayName || professor?.fullName || null,
        professorEmail: exam.professorEmail || exam.ownerEmail || professor?.email || null,
      };
    });
    const snapshots = firstList(source.snapshots, source.recoverySnapshots, source.recovery?.snapshots).map(normalizeSnapshot);
    const derived = {
      exams: exams.length,
      awaitingActivation: exams.filter((exam) => canApprove(exam)).length,
      open: exams.filter((exam) => ['active', 'open'].includes(String(activationOf(exam)?.status || exam.status))).length,
      students: exams.reduce((total, exam) => total + Number(exam.rosterCount || exam.studentCount || 0), 0),
      submissions: exams.reduce((total, exam) => total + Number(exam.submissionCount || 0), 0),
      recoveryAttention: snapshots.filter((snapshot) => ['pending', 'failed'].includes(String(snapshot.status || snapshot.snapshotStatus))).length,
    };
    return {
      ...source,
      institution: source.institution || people.institution || institutions(access).find((entry) => (entry.institutionId || entry.id) === state.institutionId) || null,
      exams,
      staff,
      professorRequests: firstList(source.professorRequests, people.professorRequests, source.accessRequests),
      snapshots,
      audit: firstList(source.audit, source.auditEvents, source.recentAudit),
      counts: { ...derived, ...object(source.counts) },
      generatedAt: source.generatedAt || new Date().toISOString(),
    };
  }

  function examPageProgress(result, page, requestedOffset = 0, loaded = page.length) {
    const normalized = uiValue(result);
    const institution = institutions().find((entry) => (entry.institutionId || entry.id) === state.institutionId) || {};
    const parsedTotal = Number(normalized.examTotal ?? normalized.counts?.exams ?? institution.examCount);
    const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : null;
    const limitValue = Number(normalized.examLimit ?? normalized.limit);
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : EXAM_PAGE_SIZE;
    const offsetValue = Number(normalized.examOffset ?? normalized.offset);
    const offset = Number.isFinite(offsetValue) && offsetValue >= 0 ? offsetValue : requestedOffset;
    const inferredNextOffset = offset + page.length;
    const explicitHasMore = normalized.examHasMore ?? normalized.hasMore;
    const hasMore = typeof explicitHasMore === 'boolean'
      ? explicitHasMore
      : total != null ? inferredNextOffset < total : page.length === limit;
    const rawNextOffset = normalized.examNextOffset ?? normalized.nextOffset;
    const nextOffset = hasMore
      ? rawNextOffset != null && Number.isFinite(Number(rawNextOffset)) ? Number(rawNextOffset) : inferredNextOffset
      : null;
    return {
      loaded,
      total,
      limit,
      offset,
      nextOffset,
      hasMore,
      fullyLoaded: hasMore === false && (total == null || loaded >= total),
    };
  }

  function mergeExamPage(result, requestedOffset = 0) {
    const pageData = normalizeCenter(result, { staff: state.data?.staff || [] }, state.access);
    const existing = list(state.data?.exams).slice();
    const before = existing.length;
    const known = new Set(existing.map((exam) => examId(exam)).filter(Boolean));
    pageData.exams.forEach((exam) => {
      const identifier = examId(exam);
      if (!identifier || !known.has(identifier)) { if (identifier) known.add(identifier); existing.push(exam); }
    });
    if (requestedOffset > 0 && pageData.exams.length && existing.length === before) {
      throw ownerControlError('Examination paging returned records that were already loaded.', 'The examinations already loaded are safe. Refresh the command center, then choose Load all examinations again.');
    }
    state.examPaging = examPageProgress(result, pageData.exams, requestedOffset, existing.length);
    state.data = {
      ...state.data,
      exams: existing,
      counts: {
        ...object(state.data?.counts),
        ...object(pageData.counts),
        ...(state.examPaging.total != null ? { exams: state.examPaging.total } : {}),
      },
      generatedAt: pageData.generatedAt || state.data?.generatedAt,
    };
    return state.examPaging;
  }

  function normalizeOwnerDetail(value) {
    const response = object(value);
    const bundle = object(response.bundle);
    const tables = object(bundle.tables);
    if (!Object.keys(tables).length) return response;
    const exams = uiList(tables.exams);
    const versions = uiList(tables.examVersions);
    const identities = uiList(tables.studentIdentities);
    const rosterRows = uiList(tables.examRoster);
    const sessionRows = uiList(tables.studentSessions);
    const receiptRows = uiList(tables.submissionReceipts);
    const submissionRows = uiList(tables.submissions).map((submission) => {
      const receipt = receiptRows.find((entry) => entry.submissionId === submission.id) || null;
      return receipt ? {
        ...submission,
        receipt,
        receiptId: receipt.id,
        receiptCode: receipt.receiptCode,
      } : submission;
    });
    const revisionRows = uiList(tables.answerRevisions).map((row) => ({ ...row, recordType: 'answer_revision' }));
    const finalAnswerRows = uiList(tables.submissionAnswers).map((row) => ({ ...row, recordType: 'submitted_answer' }));
    const gradeRows = uiList(tables.gradeRevisions);
    const gradeItems = uiList(tables.gradeRevisionItems);
    const releases = uiList(tables.resultReleases);
    const activations = uiList(tables.roomActivations).sort((left, right) => (
      new Date(right.issuedAt || right.createdAt || 0).getTime() - new Date(left.issuedAt || left.createdAt || 0).getTime()
    ));
    const envelopes = uiList(tables.ownerKeyEnvelopes);
    const deliveries = uiList(tables.emailDeliveryEvents);
    const students = rosterRows.map((roster) => ({
      ...roster,
      identity: identities.find((identity) => identity.id === roster.studentIdentityId) || {},
      session: sessionRows.find((session) => session.rosterId === roster.id) || null,
    }));
    const grades = gradeRows.map((grade) => {
      const submission = submissionRows.find((row) => row.id === grade.submissionId) || {};
      const session = sessionRows.find((row) => row.id === submission.sessionId) || {};
      const roster = rosterRows.find((row) => row.id === session.rosterId) || {};
      const identity = identities.find((row) => row.id === roster.studentIdentityId) || {};
      const releaseIdsForGrade = new Set(releases
        .filter((release) => release.gradeRevisionId === grade.id)
        .map((release) => release.id || release.releaseId));
      const relatedReleases = releases.filter((release) => release.gradeRevisionId === grade.id
        || releaseIdsForGrade.has(release.supersedesReleaseId));
      return decorateGrade({
        ...grade,
        fullName: identity.fullName,
        studentNumber: identity.externalStudentId,
        email: identity.emailNormalized,
        items: gradeItems.filter((item) => item.gradeRevisionId === grade.id),
        releases: relatedReleases,
      }, releases);
    });
    const keys = activations.map((activation) => ({
      ...activation,
      envelope: envelopes.find((entry) => entry.activationId === activation.id) || null,
      delivery: deliveries.find((entry) => entry.activationId === activation.id) || null,
    }));
    return {
      ...response,
      bundle,
      exam: exams[0] || null,
      examVersion: versions.find((version) => version.id === bundle.currentPublishedVersionId) || versions.at(-1) || null,
      examVersions: versions,
      questions: uiList(tables.questions),
      students,
      roster: students,
      studentIdentities: identities,
      sessions: sessionRows,
      submissions: submissionRows,
      submissionReceipts: receiptRows,
      answers: [...revisionRows, ...finalAnswerRows],
      answerRevisions: revisionRows,
      submissionAnswers: finalAnswerRows,
      grades,
      gradeRevisions: grades,
      gradeRevisionItems: gradeItems,
      releases,
      resultReleases: releases,
      activations,
      keys,
      emailDeliveryEvents: deliveries,
      snapshots: list(tables.recoverySnapshots).map(normalizeSnapshot),
      auditEvents: uiList(tables.auditEvents),
    };
  }

  async function centerQuery(offset = 0) {
    const payload = { institutionId: state.institutionId, limit: EXAM_PAGE_SIZE, offset };
    try { return await api.adminQuery('command_center', payload); }
    catch (error) { if (!isUnsupported(error)) throw error; return api.adminQuery('overview', payload); }
  }
  async function load(requestToken = state.loadRequest) {
    if (!api) throw new Error('The Examination Room administration module is unavailable.');
    const access = await api.adminQuery('access');
    if (requestToken !== state.loadRequest) return null;
    state.access = access;
    const available = institutions();
    if (!available.some((entry) => (entry.institutionId || entry.id) === state.institutionId)) state.institutionId = available[0]?.institutionId || available[0]?.id || null;
    if (!state.institutionId) { state.data = null; return renderBootstrap(access); }
    const [center, directory, , ownerSession] = await Promise.all([
      centerQuery(),
      api.adminQuery('staff_directory', { institutionId: state.institutionId }).catch((error) => { if (isUnsupported(error)) return {}; throw error; }),
      requestPreflight(requestToken),
      typeof api.authSession === 'function' ? api.authSession().catch(() => null) : Promise.resolve(null),
    ]);
    if (requestToken !== state.loadRequest) return null;
    state.ownerUserId = String(ownerSession?.user?.id || access.actorUserId || access.userId || '').trim();
    state.data = normalizeCenter(center, directory, access);
    state.examPaging = examPageProgress(center, state.data.exams, 0, state.data.exams.length);
    if (state.examPaging.total != null) state.data.counts.exams = state.examPaging.total;
    if (!state.data.exams.some((exam) => examId(exam) === state.selectedExamId)) state.selectedExamId = examId(state.data.exams[0]) || null;
    return renderContent();
  }
  async function render() {
    const requestToken = ++state.loadRequest;
    try { return await load(requestToken); }
    catch (error) { return `<div class="exam-admin-page">${errorPanel(error)}</div>`; }
  }

  function examProgress() {
    const progress = object(state.examPaging);
    const loaded = list(state.data?.exams).length;
    return {
      loaded,
      total: progress.total != null && Number.isFinite(Number(progress.total)) ? Number(progress.total) : null,
      hasMore: progress.hasMore === true,
      fullyLoaded: progress.fullyLoaded === true,
    };
  }
  async function appendExamPage() {
    const current = examProgress();
    if (!current.hasMore) return current;
    const nextOffset = Number(state.examPaging?.nextOffset);
    if (!Number.isInteger(nextOffset) || nextOffset < 0 || nextOffset <= Number(state.examPaging?.offset ?? -1)) {
      throw ownerControlError('Examination paging stopped because the next page marker is invalid.', 'The records already loaded are safe. Refresh the command center, then choose Load all examinations again.');
    }
    const result = await centerQuery(nextOffset);
    const merged = mergeExamPage(result, nextOffset);
    if (merged.hasMore && merged.nextOffset <= nextOffset) {
      throw ownerControlError('Examination paging did not advance to a new page.', 'The records already loaded are safe. Refresh the command center, then try again.');
    }
    return merged;
  }
  async function loadAllExams() {
    let current = examProgress();
    const visitedOffsets = new Set();
    while (current.hasMore) {
      const offset = Number(state.examPaging?.nextOffset);
      if (visitedOffsets.has(offset)) {
        throw ownerControlError('Examination paging repeated the same page marker.', 'The records already loaded are safe. Refresh the command center, then choose Load all examinations again.');
      }
      visitedOffsets.add(offset);
      current = await appendExamPage();
    }
    if (!current.fullyLoaded) {
      throw ownerControlError('The examination list changed while its pages were loading.', 'The records already loaded are safe. Refresh the command center, then export all again.');
    }
    return current;
  }
  async function runExamLoad(mode, button) {
    const busyKey = `exams:${mode}`;
    if (state.busy.has(busyKey)) return;
    state.busy.add(busyKey); buttonBusy(button, true); state.inlineError = null;
    try {
      if (mode === 'refresh') { await refreshIntoRoot('Examination list reloaded.'); return; }
      const result = mode === 'all' ? await loadAllExams() : await appendExamPage();
      renderIntoRoot();
      state.toast(result.fullyLoaded
        ? `All ${result.loaded} examinations are loaded.`
        : `${result.loaded}${result.total != null ? ` of ${result.total}` : ''} examinations are loaded.`);
    } catch (error) {
      state.inlineError = Object.assign(error, { retry: `exams_${mode}` });
      renderIntoRoot();
    } finally {
      state.busy.delete(busyKey);
      if (button?.isConnected) buttonBusy(button, false);
    }
  }

  function institutionForm(label = 'Create school workspace') {
    return `<form class="exam-admin-role-form exam-admin-bootstrap-form" data-exam-admin-bootstrap-form><label><span>Law school name</span><input name="institutionName" minlength="2" maxlength="240" autocomplete="organization" required></label><label><span>Short school code</span><input name="institutionCode" minlength="2" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,63}" required></label><button class="primary-button" type="submit"><i class="ph ph-buildings" aria-hidden="true"></i>${escapeHtml(label)}</button><div class="exam-admin-form-status" role="status" aria-live="polite"></div></form>`;
  }
  function renderBootstrap() {
    return `<div class="exam-admin-page exam-admin-bootstrap"><header class="section-head"><div><p class="eyebrow">Owner setup</p><h2>Open the first Examination Room workspace</h2><p>Create the school workspace. Any signed-in account may enter the Professor card, create and save examinations, publish, and request a key without role approval.</p></div></header><section class="panel exam-admin-bootstrap-panel"><div class="exam-admin-bootstrap-copy"><i class="ph ph-shield-check" aria-hidden="true"></i><div><h3>No school workspace yet</h3><p>The platform-owner account is active. Create the first workspace to begin.</p></div></div>${institutionForm()}</section></div>`;
  }
  function institutionOptions() {
    return institutions().map((entry) => { const id = entry.institutionId || entry.id; return `<option value="${escapeHtml(id)}"${id === state.institutionId ? ' selected' : ''}>${escapeHtml(entry.institutionName || entry.name || entry.institutionCode || id)}</option>`; }).join('');
  }
  function professorHref(anchor = '') {
    const query = new URLSearchParams(); query.set(api?.demoEnabled?.() ? 'demo' : 'live', '1');
    if (state.institutionId) query.set('institution', state.institutionId);
    if (state.selectedExamId) query.set('exam', state.selectedExamId);
    return `../examination-room/?${query.toString()}${anchor}`;
  }
  function tabs() {
    return `<div class="exam-admin-tabs" role="tablist" aria-label="Examination Room owner views">${Object.entries(TABS).map(([key, [label, icon]]) => `<button type="button" role="tab" aria-selected="${state.tab === key}" tabindex="${state.tab === key ? '0' : '-1'}" data-exam-admin-tab="${key}"><i class="ph ${icon}" aria-hidden="true"></i><span>${escapeHtml(label)}</span></button>`).join('')}</div>`;
  }
  function toolbar(title, help) {
    const exportPrefix = ['overview', 'examinations', 'recovery_audit'].includes(state.tab) ? 'Export all ' : '';
    return `<div class="exam-admin-view-toolbar"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(help)}</p></div><label class="exam-admin-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search ${escapeHtml(title)}</span><input type="search" value="${escapeHtml(state.search)}" placeholder="Search names, IDs, titles, status…" data-exam-admin-search></label><div class="exam-admin-export-actions"><button class="secondary-button" type="button" data-exam-admin-export="json"><i class="ph ph-file-code" aria-hidden="true"></i>${exportPrefix}JSON</button><button class="secondary-button" type="button" data-exam-admin-export="csv"><i class="ph ph-file-csv" aria-hidden="true"></i>${exportPrefix}CSV</button></div></div>`;
  }
  function examSelector() {
    if (!state.data?.exams?.length) return '<div class="empty">No examination is available to inspect.</div>';
    return `<label class="exam-admin-exam-selector"><span>Selected examination</span><select data-exam-admin-exam-selector>${state.data.exams.map((exam) => `<option value="${escapeHtml(examId(exam))}"${examId(exam) === state.selectedExamId ? ' selected' : ''}>${escapeHtml(exam.title || examId(exam))}</option>`).join('')}</select></label>`;
  }
  function renderPreflightPanel() {
    const result = object(state.preflight);
    const returnedChecks = list(result.checks);
    const checks = PREFLIGHT_CHECKS.map((definition) => ({
      ...definition,
      result: returnedChecks.find((entry) => entry.id === definition.id) || null,
    }));
    const failed = checks.filter((entry) => entry.result?.ok !== true);
    const allReady = result.ready === true && failed.length === 0;
    const overallLabel = state.preflightError
      ? 'Check unavailable'
      : allReady ? 'Ready to operate' : `${failed.length} item${failed.length === 1 ? '' : 's'} need attention`;
    const checkedAt = result.checkedAt ? `Last checked ${formatDateTime(result.checkedAt)}` : 'Run the check before issuing a key.';
    const cards = checks.map(({ result: check, ...definition }) => {
      const ok = check?.ok === true;
      const suppressed = ok && check.status === 'suppressed';
      const label = suppressed ? 'Intentionally off' : ok ? 'Ready' : check ? 'Action needed' : 'Not checked';
      const message = check?.message || 'This item did not return a status.';
      const recovery = ok ? '' : check?.recovery || definition.recovery;
      return `<article class="exam-admin-preflight-check${ok ? ' ready' : ' attention'}"><i class="ph ${escapeHtml(definition.icon)}" aria-hidden="true"></i><div><span>${escapeHtml(definition.label)}</span><strong>${escapeHtml(label)}</strong><p>${escapeHtml(message)}</p><small>${escapeHtml(definition.help)}</small>${recovery ? `<em><b>How to fix:</b> ${escapeHtml(recovery)}</em>` : ''}</div></article>`;
    }).join('');
    const error = state.preflightError
      ? `<div class="exam-admin-preflight-error" role="alert"><strong>${escapeHtml(state.preflightError.message || 'The system check could not run.')}</strong><p>${escapeHtml(state.preflightError.recovery || 'Nothing was changed. Check the connection, then run the system check again.')}</p></div>`
      : '';
    return `<section class="exam-admin-preflight" aria-labelledby="exam-admin-preflight-title" aria-live="polite"><header><div><p class="eyebrow">Release readiness</p><h3 id="exam-admin-preflight-title">Examination Room system check</h3><span>${escapeHtml(checkedAt)}</span></div><div><strong class="${allReady ? 'ready' : 'attention'}"><i class="ph ${allReady ? 'ph-check-circle' : 'ph-warning-circle'}" aria-hidden="true"></i>${escapeHtml(overallLabel)}</strong><button class="secondary-button" type="button" data-exam-admin-preflight><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>Run system check</button></div></header>${error}<div class="exam-admin-preflight-grid">${cards}</div><footer>No passwords, encryption keys, provider credentials, storage bindings, or recipient addresses are shown here.</footer></section>`;
  }
  function renderContent() {
    const school = currentInstitution();
    return `<div class="exam-admin-page"><header class="section-head exam-admin-section-head"><div><p class="eyebrow">Owner command center · ${escapeHtml(school.name || school.institutionName || 'Examination Room')}</p><h2>Examination Room</h2><p>Exact questions, identities, answers, grades, room keys, email delivery, recovery records, and audit history are available to authenticated platform owners.</p></div><div class="exam-admin-head-actions">${institutions().length > 1 ? `<label><span>Law school</span><select data-exam-admin-institution>${institutionOptions()}</select></label>` : ''}<button class="secondary-button" type="button" data-exam-admin-refresh><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>Refresh</button><a class="secondary-button" href="${escapeHtml(professorHref())}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out" aria-hidden="true"></i>Open creator workspace</a></div></header><section class="exam-admin-owner-band"><i class="ph ph-crown" aria-hidden="true"></i><div><strong>Platform-owner view</strong><p>Values are shown exactly as returned. Every owner action produces a retry-safe receipt.</p></div><span>Full visibility</span></section>${renderPreflightPanel()}${tabs()}${state.inlineError ? errorPanel(state.inlineError, state.inlineError.retry || 'refresh') : ''}<section class="exam-admin-tab-panel" role="tabpanel" aria-label="${escapeHtml(TABS[state.tab]?.[0] || 'Owner records')}">${renderTab()}</section></div>`;
  }

  function renderTab() {
    if (state.tab === 'overview') return renderOverview();
    if (state.tab === 'professor_access') return renderProfessorAccess();
    if (state.tab === 'examinations') return renderExaminations();
    if (state.tab === 'questions') return renderQuestions();
    if (state.tab === 'students_answers') return renderStudentsAnswers();
    if (state.tab === 'grades_results') return renderGradesResults();
    if (state.tab === 'keys_email') return renderKeysEmail();
    return renderRecoveryAudit();
  }

  function examActions(exam, compact = false) {
    const id = examId(exam); const room = activationOf(exam); const roomStatus = String(room?.status || room?.activationStatus || '').toLowerCase();
    const exactKey = state.currentKeys.get(id);
    return `<div class="exam-admin-actions${compact ? ' compact' : ''}"><button class="secondary-button" type="button" data-exam-admin-select-exam="${escapeHtml(id)}" data-exam-admin-go-tab="examinations">Inspect</button>${canApprove(exam) ? `<button class="primary-button" type="button" data-exam-admin-action="approve_and_email_key" data-exam-id="${escapeHtml(id)}"><i class="ph ph-paper-plane-tilt" aria-hidden="true"></i>Approve & generate key</button>` : ''}${room ? `<button class="secondary-button" type="button" data-exam-admin-action="reveal_key" data-exam-id="${escapeHtml(id)}"><i class="ph ph-eye" aria-hidden="true"></i>${exactKey ? 'Refresh key' : 'Show key'}</button>` : ''}${exactKey ? `<button class="secondary-button" type="button" data-exam-admin-copy-key="${escapeHtml(id)}"><i class="ph ph-copy" aria-hidden="true"></i>Copy</button>` : ''}${['scheduled', 'active', 'open'].includes(roomStatus) ? `<button class="exam-admin-danger" type="button" data-exam-admin-action="revoke_key" data-exam-id="${escapeHtml(id)}">Revoke</button>` : ''}</div>`;
  }

  function examTable(exams = state.data?.exams || []) {
    if (!exams.length) return '<div class="empty">No examination records are available for this school.</div>';
    return `<div class="table-wrap"><table class="exam-admin-table"><thead><tr><th scope="col">Examination</th><th scope="col">Creator</th><th scope="col">Publication</th><th scope="col">Room</th><th scope="col">Students</th><th scope="col">Submissions</th><th scope="col">Owner actions</th></tr></thead><tbody>${exams.map((exam) => { const room = activationOf(exam); return `<tr data-exam-admin-searchable data-search-text="${searchText(exam)}"><td><strong>${escapeHtml(exam.title || 'Untitled examination')}</strong><small>${escapeHtml(exam.subject || examId(exam))}</small></td><td><strong>${escapeHtml(exam.professorName || exam.ownerName || 'Name not returned')}</strong><small>${escapeHtml(exam.professorEmail || exam.ownerEmail || exam.ownerUserId || 'Email not returned')}</small></td><td>${statusBadge(exam.publicationStatus || exam.status)}<small>Version ${escapeHtml(exam.versionNumber || exam.version || '—')} · ${escapeHtml(String(exam.questionCount ?? list(exam.questions).length))} questions</small></td><td>${statusBadge(room?.status || room?.activationStatus || 'not_activated')}<small>${escapeHtml(formatDateTime(room?.opensAt || exam.startsAt))}</small></td><td>${escapeHtml(String(exam.rosterCount ?? exam.studentCount ?? 0))}</td><td>${escapeHtml(String(exam.submissionCount ?? 0))}</td><td>${examActions(exam, true)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function renderOverview() {
    const counts = object(state.data?.counts); const exams = list(state.data?.exams); const requests = pendingKeyRequests();
    return `${toolbar('Operations overview', 'See what needs owner attention and open the exact record in one click.')}<div class="exam-admin-metrics exam-admin-metrics-six">${metric('Examinations', counts.exams ?? exams.length, 'All records in this school', 'ph-files')}${metric('Key requests', requests.length, 'Published and waiting for one-click approval', 'ph-hourglass-medium')}${metric('Open rooms', counts.open ?? 0, 'Accepting or monitoring students', 'ph-door-open')}${metric('Students', counts.students ?? 0, 'Exact identities recorded at entry', 'ph-student')}${metric('Submissions', counts.submissions ?? 0, 'Server receipts recorded', 'ph-file-check')}${metric('Recovery attention', counts.recoveryAttention ?? 0, 'Pending or failed checkpoints', 'ph-lifebuoy')}</div><section class="panel"><header class="exam-admin-panel-head"><div><h3>Key requests waiting for approval</h3><p>Every published request from a signed-in creator appears here. Approve once to generate the student key, email creator and owner copies, and automatically unlock the creator’s Monitoring and Grading views.</p></div><span>${statusBadge(requests.length ? 'attention' : 'clear')}</span></header>${requests.length ? examTable(requests) : '<div class="empty">No key requests are waiting. New published requests will appear after Refresh.</div>'}</section><div class="exam-admin-flow"><article><span>1</span><div><strong>Creator publishes</strong><p>Any signed-in account can build and request a key.</p></div></article><i class="ph ph-arrow-right" aria-hidden="true"></i><article><span>2</span><div><strong>Admin reviews</strong><p>See every question and answer key.</p></div></article><i class="ph ph-arrow-right" aria-hidden="true"></i><article><span>3</span><div><strong>Approve & generate</strong><p>One click creates the key and emails creator and owner copies.</p></div></article><i class="ph ph-arrow-right" aria-hidden="true"></i><article><span>4</span><div><strong>Creator monitors</strong><p>Monitoring and Grading unlock automatically—no creator key entry.</p></div></article></div><section class="panel"><header class="exam-admin-panel-head"><div><h3>Recent examinations</h3><p>Select any examination to inspect the complete owner view.</p></div><button class="secondary-button" type="button" data-exam-admin-tab="examinations">View all</button></header>${examTable(exams.slice(0, 6))}</section>`;
  }

  function roleForm() {
    return `<form class="exam-admin-role-form" data-exam-admin-role-form><label><span>Signed-in creator email</span><input name="email" type="email" maxlength="320" autocomplete="email" required><small>Optional school-directory placement only. It never gates entry, exam creation, saving, or key requests.</small></label><label><span>Exact display name</span><input name="displayName" maxlength="240" autocomplete="name"></label><label><span>Optional directory label</span><select name="staffRole"><option value="professor">Professor</option><option value="admin">Institution admin</option></select></label><label><span>Internal receipt note</span><input name="reason" minlength="5" maxlength="1000" value="Added by a platform owner to the optional Examination Room school directory." required></label><button class="primary-button" type="submit"><i class="ph ph-user-plus" aria-hidden="true"></i>Save directory assignment</button><div class="exam-admin-form-status" role="status" aria-live="polite"></div></form>`;
  }
  function requestCards() {
    const requests = list(state.data?.professorRequests);
    if (!requests.length) return '<div class="empty">No optional school-placement requests are waiting.</div>';
    return `<div class="exam-admin-professor-requests">${requests.map((request) => `<article data-exam-admin-searchable data-search-text="${searchText(request)}"><span class="exam-admin-avatar"><i class="ph ph-chalkboard-teacher" aria-hidden="true"></i></span><div><strong>${escapeHtml(request.displayName || 'Signed-in creator')}</strong><small>${escapeHtml(request.email || 'Email not returned')}</small><em>${escapeHtml(request.schoolName || request.schoolId || 'School not recorded')} · ${escapeHtml(formatDateTime(request.requestedAt))}</em><code>${escapeHtml(request.requestId || request.id || '')}</code></div><div class="exam-admin-request-actions"><button class="primary-button" type="button" data-exam-admin-approve-professor="${escapeHtml(request.requestId || request.id)}" data-exam-admin-request-email="${escapeHtml(request.email)}" data-exam-admin-request-name="${escapeHtml(request.displayName || '')}">Add to school directory</button><button class="exam-admin-danger" type="button" data-exam-admin-reject-professor="${escapeHtml(request.requestId || request.id)}" data-exam-admin-request-name="${escapeHtml(request.displayName || request.email || 'this request')}">Dismiss request</button></div></article>`).join('')}</div>`;
  }
  function staffCards() {
    const staff = list(state.data?.staff);
    if (!staff.length) return '<div class="empty">No staff assignments are recorded.</div>';
    return `<div class="exam-admin-professors">${staff.map((member) => `<article data-exam-admin-searchable data-search-text="${searchText(member)}"><span class="exam-admin-avatar"><i class="ph ${member.staffRole === 'admin' ? 'ph-shield-check' : 'ph-chalkboard-teacher'}" aria-hidden="true"></i></span><div><strong>${escapeHtml(member.displayName || 'Name not returned')}</strong><small>${escapeHtml(member.email || 'Email not returned')} · ${escapeHtml(statusLabel(member.staffRole))}</small><code>${escapeHtml(member.userId || '')}</code></div><div class="exam-admin-staff-state">${statusBadge(member.status)}${member.status === 'active' && !member.isCurrentAdministrator ? `<button class="exam-admin-danger" type="button" data-exam-admin-revoke-staff="${escapeHtml(member.membershipId || member.id)}" data-exam-admin-staff-name="${escapeHtml(member.displayName || member.email || 'this account')}">Revoke</button>` : ''}</div></article>`).join('')}</div>`;
  }
  function renderProfessorAccess() {
    return `${toolbar('Creator Directory', 'Any signed-in account can enter the Professor card, create and save an examination, publish, and request a key. This directory is optional and never grants or blocks creator access.')}<section class="panel exam-admin-role-panel"><header class="exam-admin-panel-head"><div><h3>Optional school placement requests</h3><p>Add a creator to the school directory or dismiss the request. Neither choice blocks entry, exam creation, saving, publishing, or key requests.</p></div></header>${requestCards()}</section><section class="panel exam-admin-role-panel"><header class="exam-admin-panel-head"><div><h3>Exact optional directory</h3><p>Names, email addresses, user IDs, labels, and status are not masked. Directory status is separate from the Professor card.</p></div></header>${roleForm()}${staffCards()}</section>`;
  }

  function renderRoomControl(exam, detail) {
    const activation = selectedRoomActivation(exam, detail);
    if (!activation) {
      return '<section class="exam-admin-owner-control-panel"><header><i class="ph ph-door" aria-hidden="true"></i><div><h4>Room control</h4><p>Approve and issue the first room key before opening or closing this room.</p></div></header></section>';
    }
    const roomStatus = String(activation.status || activation.activationStatus || '').toLowerCase();
    const canOpen = ['scheduled', 'active'].includes(roomStatus);
    const canClose = ['scheduled', 'open', 'active'].includes(roomStatus);
    if (!canOpen && !canClose) {
      return `<section class="exam-admin-owner-control-panel"><header><i class="ph ph-door" aria-hidden="true"></i><div><h4>Room control</h4><p>This activation is ${escapeHtml(statusLabel(roomStatus))}. Issue or rotate a room key from Keys & Email when a replacement room is needed.</p></div>${statusBadge(roomStatus)}</header></section>`;
    }
    const options = [
      canOpen ? '<option value="open">Open room now</option>' : '',
      canClose ? '<option value="close">Close room and end active sessions</option>' : '',
    ].join('');
    return `<section class="exam-admin-owner-control-panel"><header><i class="ph ph-door-open" aria-hidden="true"></i><div><h4>Room control</h4><p>Change the live room state without coding. Closing preserves every saved answer, submission, grade, and receipt.</p></div>${statusBadge(roomStatus)}</header><form class="exam-admin-owner-control-form exam-admin-room-control-form" data-exam-admin-owner-control="room_control"><input name="examId" type="hidden" value="${escapeHtml(examId(exam))}"><label><span>Room action</span><select name="action" required>${options}</select><small>Only actions supported by the current room state are listed.</small></label><label><span>Owner receipt note</span><input name="reason" minlength="5" maxlength="1000" value="Platform owner changed the room state from the Examination Room command center." required><small>This note remains in the owner audit trail.</small></label><button class="primary-button" type="submit"><i class="ph ph-check-circle" aria-hidden="true"></i>Apply room control</button><div class="exam-admin-owner-control-status" role="status" aria-live="polite">Review the action, then apply it.</div></form></section>`;
  }

  function renderExaminations() {
    const exam = selectedExam(); const detail = selectedDetail();
    const activation = selectedRoomActivation(exam, detail);
    const progress = examProgress();
    const summary = progress.fullyLoaded
      ? `All ${progress.loaded} examinations are loaded.`
      : progress.total != null ? `${progress.loaded} of ${progress.total} examinations are loaded.` : `${progress.loaded} examinations are loaded; the total is still being checked.`;
    const controls = progress.hasMore
      ? `<div class="exam-admin-audit-load-actions"><button class="secondary-button" type="button" data-exam-admin-load-exams="next">Load next ${EXAM_PAGE_SIZE}</button><button class="primary-button" type="button" data-exam-admin-load-exams="all">Load all examinations</button></div>`
      : !progress.fullyLoaded ? '<button class="secondary-button" type="button" data-exam-admin-load-exams="refresh">Reload examination list</button>' : '';
    return `${toolbar('Examinations', 'Review publication, room state, exact identifiers, and complete stored data.')}<div class="exam-admin-page-load"><p>${escapeHtml(summary)}</p>${controls}</div>${examTable()}${exam ? `<section class="panel exam-admin-record-detail"><header class="exam-admin-panel-head"><div><h3>${escapeHtml(exam.title || 'Selected examination')}</h3><p>Exact examination ID: <code>${escapeHtml(examId(exam))}</code></p></div>${examActions(exam)}</header><div class="exam-admin-detail-grid">${fact('Creator', exam.professorName || exam.ownerName || detail?.professor?.displayName, exam.professorEmail || exam.ownerEmail || detail?.professor?.email)}${fact('Publication', exam.publicationStatus || exam.status, `Version ${exam.versionNumber || exam.version || detail?.exam?.version || '—'}`)}${fact('Schedule', formatDateTime(exam.startsAt || activation?.opensAt), `Ends ${formatDateTime(exam.endsAt || activation?.closesAt)}`)}${fact('Content', `${exam.questionCount ?? questions(detail).length} questions`, `${exam.rosterCount ?? students(detail).length} students`)}</div>${renderRoomControl(exam, detail)}${detail ? rawPanel('Complete examination data', detail) : '<div class="exam-admin-loading-note">Choose another detail tab to load the complete server record.</div>'}</section>` : ''}`;
  }

  function renderQuestions() {
    const detail = selectedDetail(); const rows = questions(detail);
    return `${toolbar('Questions', 'Prompts, points, choices, correct answers, accepted answers, and grading guidance are shown to owners.')}${examSelector()}${rows.length ? `<div class="exam-admin-question-list">${rows.map((question, index) => { const config = object(question.configuration); const choices = firstList(question.choices, question.options, config.choices); const correct = question.correctOptionIndex ?? question.correctOption ?? config.correctOptionIndex; const accepted = firstList(question.acceptedAnswers, config.acceptedAnswers); const number = question.questionNumber || question.number || question.position || index + 1; return `<article data-exam-admin-searchable data-search-text="${searchText(question)}"><header><span>Question ${escapeHtml(number)}</span>${statusBadge(question.type || question.questionKind || 'question')}<strong>${escapeHtml(question.points ?? 0)} points</strong></header><h4>${escapeHtml(question.prompt || question.text || 'Prompt not returned')}</h4>${choices.length ? `<ol class="exam-admin-choice-list">${choices.map((choice, choiceIndex) => `<li class="${Number(correct) === choiceIndex ? 'correct' : ''}">${escapeHtml(typeof choice === 'object' ? choice.label || choice.text || JSON.stringify(choice) : choice)}${Number(correct) === choiceIndex ? '<strong>Correct answer</strong>' : ''}</li>`).join('')}</ol>` : ''}<div class="exam-admin-answer-key"><div><small>Accepted answers</small><p>${escapeHtml(accepted.length ? accepted.join(' · ') : question.correctAnswer || 'No separate accepted-answer list returned')}</p></div><div><small>Grading guidance</small><p>${escapeHtml(question.gradingGuidance || config.gradingGuidance || question.rubric || 'No grading guidance returned')}</p></div></div><footer><code>${escapeHtml(question.questionId || question.id || question.questionKey || '')}</code><span>${escapeHtml(question.contentSha256 || question.contentHash || '')}</span></footer>${rawPanel('Raw question record', question)}</article>`; }).join('')}</div>` : '<div class="empty">No questions were returned for the selected examination.</div>'}${detail ? rawPanel('Publication and question bundle', { publicationManifest: detail.publicationManifest || null, questions: rows }) : ''}`;
  }

  function identityOf(student) { return student.identity || student.studentIdentity || student.student || student; }
  function sessionFor(student, allSessions) {
    if (student.session) return student.session;
    const identity = identityOf(student);
    return allSessions.find((session) => session.rosterId === (student.rosterId || student.id) || session.studentIdentityId === (identity.studentIdentityId || identity.id) || session.studentNumber === (identity.studentNumber || identity.externalStudentId)) || {};
  }
  function answerValue(answer) {
    const value = answer.answer ?? answer.value ?? answer.answerPayload ?? answer.payload ?? answer.response;
    if (value == null) return 'No answer value returned';
    if (typeof value === 'object') return value.text ?? value.value ?? value.choice ?? JSON.stringify(value, null, 2);
    return String(value);
  }
  function identityCorrectionForm(student, identity) {
    const identityId = identity.id || identity.studentIdentityId || student.studentIdentityId;
    if (!identityId) return '<div class="exam-admin-owner-control-note">The student identity identifier was not returned. Refresh this examination before correcting the record.</div>';
    return `<form class="exam-admin-owner-control-form" data-exam-admin-owner-control="correct_student_identity"><input name="examId" type="hidden" value="${escapeHtml(state.selectedExamId)}"><input name="studentIdentityId" type="hidden" value="${escapeHtml(identityId)}"><label><span>Full legal name</span><input name="fullName" minlength="2" maxlength="240" autocomplete="off" value="${escapeHtml(identity.fullName || identity.displayName || '')}" required><small>Shown to the exam creator and in owner exports.</small></label><label><span>Student number</span><input name="studentNumber" maxlength="120" autocomplete="off" value="${escapeHtml(identity.studentNumber || identity.externalStudentId || '')}" required><small>Must remain unique within the school.</small></label><label><span>Email, if recorded</span><input name="email" type="email" maxlength="320" autocomplete="off" value="${escapeHtml(identity.email || identity.emailNormalized || '')}"><small>Leave blank to keep the current value. To remove a wrong stored email, select the explicit option below.</small></label><label class="exam-admin-clear-email"><input name="clearEmail" type="checkbox"><span>Remove the stored student email</span><small>This explicit choice overrides the email field and is recorded in the owner audit receipt.</small></label><label><span>Owner receipt note</span><input name="reason" minlength="5" maxlength="1000" value="Platform owner corrected the student identity after checking the school record." required><small>Explain how the correction was verified.</small></label><button class="secondary-button" type="submit"><i class="ph ph-identification-card" aria-hidden="true"></i>Save identity correction</button><div class="exam-admin-owner-control-status" role="status" aria-live="polite">No identity change has been sent.</div></form>`;
  }
  function submissionStatusForm(submission) {
    const id = submission.id || submission.submissionId;
    if (!id) return '<div class="exam-admin-owner-control-note">No submission exists yet. Refresh after the student submits to change its status.</div>';
    const current = String(submission.status || submission.submissionStatus || 'accepted').toLowerCase();
    const option = (value, label) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`;
    return `<form class="exam-admin-owner-control-form exam-admin-submission-control" data-exam-admin-owner-control="set_submission_status"><input name="examId" type="hidden" value="${escapeHtml(state.selectedExamId)}"><input name="submissionId" type="hidden" value="${escapeHtml(id)}"><label><span>Submission status</span><select name="status" required>${option('accepted', 'Accepted')}${option('under_review', 'Under review')}${option('voided', 'Voided')}</select><small>Voiding removes the submission from ordinary grading without deleting its evidence.</small></label><label><span>Owner receipt note</span><input name="reason" minlength="5" maxlength="1000" value="${escapeHtml(submission.statusReason || 'Platform owner reviewed the submission status from the Examination Room command center.')}" required><small>The reason remains visible in the audit trail.</small></label><button class="secondary-button" type="submit"><i class="ph ph-file-check" aria-hidden="true"></i>Update submission status</button><div class="exam-admin-owner-control-status" role="status" aria-live="polite">Current status: ${escapeHtml(statusLabel(current))}.</div></form>`;
  }
  function studentOwnerControls(student, identity, submission) {
    return `<section class="exam-admin-student-owner-controls"><header><i class="ph ph-crown" aria-hidden="true"></i><div><h5>Owner controls</h5><p>Correct the school identity record or change how this submission is handled. Every change requires confirmation and receives its own retry-safe receipt.</p></div></header><div>${identityCorrectionForm(student, identity)}${submissionStatusForm(submission)}</div></section>`;
  }
  function renderStudentsAnswers() {
    const detail = selectedDetail(); const roster = students(detail); const allSessions = sessions(detail); const allSubmissions = submissions(detail); const allAnswers = answers(detail);
    return `${toolbar('Students & Answers', 'Real names, student numbers, email, sessions, receipts, answers, and revisions are visible.')}${examSelector()}${roster.length ? `<div class="exam-admin-student-answer-list">${roster.map((student) => {
      const identity = identityOf(student);
      const academic = studentAcademicFacts(identity, student, selectedExam()?.subject);
      const session = sessionFor(student, allSessions);
      const sessionId = session.sessionId || session.id || student.sessionId;
      const submission = allSubmissions.find((entry) => entry.sessionId === sessionId || entry.rosterId === (student.rosterId || student.id)) || student.submission || {};
      const studentAnswers = list(student.answers).length ? student.answers : allAnswers.filter((answer) => answer.sessionId === sessionId || answer.rosterId === (student.rosterId || student.id) || answer.studentNumber === (identity.studentNumber || identity.externalStudentId));
      return `<article data-exam-admin-searchable data-search-text="${searchText(student, session, submission, studentAnswers)}"><header><div><span class="exam-admin-avatar"><i class="ph ph-student" aria-hidden="true"></i></span><div><h4>${escapeHtml(identity.fullName || identity.displayName || 'Name not returned')}</h4><p>${escapeHtml(identity.studentNumber || identity.externalStudentId || 'Student number not returned')} · ${escapeHtml(identity.email || identity.emailNormalized || 'Email not returned')}</p></div></div><div>${statusBadge(session.status || session.sessionStatus || student.status || student.rosterStatus)}${submission.id || submission.submissionId ? statusBadge(submission.status || submission.submissionStatus || 'accepted') : ''}</div></header><div class="exam-admin-student-facts">${fact('Year / subject', academic.yearLevel, academic.subject)}${fact('Session', sessionId, `Started ${formatDateTime(session.startedAt)}`)}${fact('Last heartbeat', formatDateTime(session.lastHeartbeatAt || session.lastSeenAt), session.connected === false ? 'Disconnected' : 'Connection recorded')}${fact('Submission receipt', submission.receiptCode || submission.receipt?.code, formatDateTime(submission.submittedAt || submission.receivedAt))}</div><div class="exam-admin-answer-list">${studentAnswers.length ? studentAnswers.map((answer, index) => `<section><header><strong>Question ${escapeHtml(answer.questionNumber || answer.number || answer.questionKey || index + 1)}</strong><span>${answer.flagged || answer.isFlagged ? 'Flagged by student' : `Revision ${escapeHtml(answer.revision || answer.revisionNumber || '—')}`}</span></header><p>${escapeHtml(answerValue(answer))}</p><footer><code>${escapeHtml(answer.answerRevisionId || answer.id || '')}</code><span>Saved ${escapeHtml(formatDateTime(answer.savedAt || answer.receivedAt))}</span></footer></section>`).join('') : '<div class="empty">No answer record was returned for this student.</div>'}</div>${studentOwnerControls(student, identity, submission)}${rawPanel('Exact student, session, submission, and answer data', { student, session, submission, answers: studentAnswers })}</article>`;
    }).join('')}</div>` : '<div class="empty">No roster or student session data was returned for this examination.</div>'}`;
  }

  function renderGradesResults() {
    const rows = grades();
    return `${toolbar('Grades & Results', 'All grade revisions, score items, feedback, release state, and identities are available for export.')}${examSelector()}${rows.length ? `<div class="table-wrap"><table class="exam-admin-table exam-admin-grades"><thead><tr><th scope="col">Student</th><th scope="col">Submission</th><th scope="col">Grade</th><th scope="col">Status</th><th scope="col">Feedback and score items</th></tr></thead><tbody>${rows.map((grade) => { const manifest = grade.latestGrade || grade.gradingManifest || grade.manifest || grade; const scores = firstList(grade.items, grade.scores, manifest.items, manifest.scores); const total = grade.totalScore ?? manifest.totalScore ?? manifest.score; const maximum = grade.maximumScore ?? manifest.maximumScore ?? manifest.maxScore; return `<tr data-exam-admin-searchable data-search-text="${searchText(grade)}"><td><strong>${escapeHtml(grade.fullName || grade.displayName || grade.studentName || 'Name not returned')}</strong><small>${escapeHtml(grade.studentNumber || grade.email || grade.sessionId || '')}</small></td><td><code>${escapeHtml(grade.submissionId || grade.id || '')}</code><small>${escapeHtml(formatDateTime(grade.submittedAt || grade.createdAt))}</small></td><td><strong>${escapeHtml(total ?? '—')} / ${escapeHtml(maximum ?? '—')}</strong><small>Revision ${escapeHtml(grade.revisionNumber || manifest.revision || '—')}</small></td><td><div class="exam-admin-grade-statuses">${statusBadge(grade.gradeStatus || manifest.status || 'draft')}${statusBadge(grade.released ? 'released' : 'not_released')}</div><small>${grade.released ? `Released to student ${escapeHtml(formatDateTime(grade.releasedAt))}` : 'Not released'}</small></td><td><p>${escapeHtml(grade.generalFeedback || grade.overallFeedback || manifest.generalFeedback || 'No general feedback returned')}</p>${scores.length ? `<ul>${scores.map((score) => `<li>Question ${escapeHtml(score.questionNumber || score.questionKey || '—')}: <strong>${escapeHtml(score.pointsAwarded ?? score.score ?? '—')}</strong> · ${escapeHtml(score.feedback || '')}</li>`).join('')}</ul>` : ''}${rawPanel('Raw grade and result record', grade)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No grade revision was returned. Submitted answers remain in Students & Answers.</div>'}<div class="exam-admin-grade-launch"><div><i class="ph ph-pencil-line" aria-hidden="true"></i><span><strong>Need to grade or correct a result?</strong><small>Open the verified grading workspace while the complete owner record remains here.</small></span></div><a class="primary-button" href="${escapeHtml(professorHref('#grade'))}" target="_blank" rel="noopener">Open grading workspace</a></div>`;
  }

  function keyRecords() {
    const detail = object(selectedDetail()); const records = firstList(detail.keyHistory, detail.keys, detail.roomKeys, detail.activations);
    if (records.length) return records;
    const exam = selectedExam(); return exam && activationOf(exam) ? [{ ...activationOf(exam), examId: examId(exam), examTitle: exam.title }] : [];
  }
  function deliveryRecoveryMessage(delivery) {
    const code = String(delivery?.safeErrorCode || delivery?.deliverySafeErrorCode || '').toLowerCase();
    if (code === 'owner_recipients_missing') return 'Add at least one owner-copy address, run the system check, then retry the current-key email.';
    if (code === 'recipient_missing') return 'Add the creator’s sign-in email to the examination record, then retry the current-key email.';
    if (code === 'sender_missing') return 'Configure the Examination Room sender address, run the system check, then retry.';
    if (code === 'provider_key_missing') return 'Connect the email provider, run the system check, then retry.';
    if (code === 'email_mode_invalid') return 'Enable the Examination Room email channel, run the system check, then retry.';
    if (code === 'network_error' || code.startsWith('provider_')) return 'Check provider availability, then retry the current-key email. The key itself must not be rotated.';
    return String(delivery?.recovery || delivery?.deliveryRecovery || 'Run the system check, correct the listed email item, then retry the current-key email.');
  }
  function deliveryRecoveryPanel(id, delivery, key) {
    const status = String(delivery?.status || delivery?.providerStatus || delivery?.deliveryStatus || '').toLowerCase();
    if (!status || ['sent', 'delivered', 'accepted', 'demo_delivered', 'requested', 'suppressed'].includes(status)) return '';
    const keyState = key
      ? 'The exact student key remains visible above.'
      : 'Choose Retrieve exact key to show the active student key.';
    return `<div class="exam-admin-error" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i><div><strong>Key active; email needs attention</strong><p>The creator already has automatic Monitoring and Grading access. ${escapeHtml(keyState)} ${escapeHtml(deliveryRecoveryMessage(delivery))}</p></div><button class="secondary-button" type="button" data-exam-admin-action="resend_key" data-exam-id="${escapeHtml(id)}">Retry email</button></div>`;
  }
  function renderKeysEmail() {
    const exam = selectedExam(); const record = keyRecords().find((item) => !item.examId || item.examId === state.selectedExamId) || keyRecords()[0] || {};
    if (!exam) return `${toolbar('Keys & Email', 'Reveal, copy, rotate, email, and revoke the exact current room key.')}${examSelector()}`;
    const id = examId(exam); const key = state.currentKeys.get(id) || record.roomKey || record.plaintextKey || record.currentKey || ''; const delivery = state.deliveries.get(id) || record.delivery || {};
    const history = keyRecords();
    return `${toolbar('Keys & Email', 'View, copy, resend, rotate, and revoke exact room keys. Delivery records remain downloadable.')}${examSelector()}<article class="exam-admin-key-card" data-exam-admin-searchable data-search-text="${searchText(exam, record, delivery, key)}"><header><div><span class="eyebrow">${escapeHtml(exam.subject || 'Published examination')}</span><h4>${escapeHtml(exam.title || id)}</h4><code>${escapeHtml(id)}</code></div>${statusBadge(record.status || record.activationStatus || activationOf(exam)?.status || 'not_activated')}</header><label><span>Current student room key</span><input value="${escapeHtml(key || 'Retrieve the exact current key below')}" readonly></label><div class="exam-admin-key-meta">${fact('Creator', exam.professorName || record.professorName, exam.professorEmail || record.professorEmail)}${fact('Owner email copy', delivery.adminRecipients || record.adminRecipients || 'Configured owner addresses', delivery.status || delivery.providerStatus || record.deliveryStatus)}${fact('Creator access', record.id || activationOf(exam) ? 'Monitoring and Grading unlocked' : 'Unlocks on approval', 'No creator key entry required')}${fact('Valid window', formatDateTime(record.opensAt || record.issuedAt), `Until ${formatDateTime(record.expiresAt || record.closesAt)}`)}</div>${deliveryRecoveryPanel(id, delivery, key)}<div class="exam-admin-key-actions">${canApprove(exam) ? `<button class="primary-button" type="button" data-exam-admin-action="approve_and_email_key" data-exam-id="${escapeHtml(id)}"><i class="ph ph-paper-plane-tilt" aria-hidden="true"></i>Approve & generate key</button>` : ''}${!key && (record.id || activationOf(exam)) ? `<button class="secondary-button" type="button" data-exam-admin-action="reveal_key" data-exam-id="${escapeHtml(id)}"><i class="ph ph-eye" aria-hidden="true"></i>Retrieve exact key</button>` : ''}${key ? `<button class="secondary-button" type="button" data-exam-admin-copy-key="${escapeHtml(id)}"><i class="ph ph-copy" aria-hidden="true"></i>Copy exact key</button><button class="secondary-button" type="button" data-exam-admin-action="resend_key" data-exam-id="${escapeHtml(id)}"><i class="ph ph-paper-plane-tilt" aria-hidden="true"></i>Resend current key</button>` : ''}${record.id || activationOf(exam) ? `<button class="secondary-button" type="button" data-exam-admin-action="rotate_key" data-exam-id="${escapeHtml(id)}"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>Rotate & email</button><button class="exam-admin-danger" type="button" data-exam-admin-action="revoke_key" data-exam-id="${escapeHtml(id)}">Revoke key</button>` : ''}</div>${rawPanel('Current key and delivery record', { record, delivery })}</article>${history.length > 1 ? `<section class="panel"><header class="exam-admin-panel-head"><div><h3>Complete key history</h3><p>Newest first. Revoked and replaced keys remain visible to the platform owner for audit and recovery.</p></div></header>${rawPanel('All issued key records', history)}</section>` : ''}`;
  }

  function mergeSnapshotPage(previous, result, requestedOffset = 0) {
    const prior = object(previous);
    const normalized = uiValue(result);
    const page = uiList(firstList(normalized.snapshots, normalized.items, normalized.recoverySnapshots)).map(normalizeSnapshot);
    const snapshots = requestedOffset === 0 ? [] : list(prior.snapshots).slice();
    const before = snapshots.length;
    const known = new Set(snapshots.map((snapshot, index) => snapshotId(snapshot) || `snapshot:${index}`));
    page.forEach((snapshot, index) => {
      const identifier = snapshotId(snapshot) || `snapshot:${requestedOffset + index}`;
      if (!known.has(identifier)) { known.add(identifier); snapshots.push(snapshot); }
    });
    if (requestedOffset > 0 && page.length && snapshots.length === before) {
      throw ownerControlError('Recovery paging returned checkpoints that were already loaded.', 'The checkpoints already loaded are safe. Reload Recovery & Audit, then choose Load all checkpoints again.');
    }
    const limitValue = Number(normalized.limit ?? normalized.snapshotLimit);
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : SNAPSHOT_PAGE_SIZE;
    const offsetValue = Number(normalized.offset ?? normalized.snapshotOffset);
    const offset = Number.isFinite(offsetValue) && offsetValue >= 0 ? offsetValue : requestedOffset;
    const parsedTotal = Number(normalized.total ?? normalized.snapshotTotal);
    const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : null;
    const inferredNextOffset = offset + page.length;
    const explicitHasMore = normalized.hasMore ?? normalized.snapshotHasMore;
    const hasMore = typeof explicitHasMore === 'boolean'
      ? explicitHasMore
      : total != null ? inferredNextOffset < total : page.length === limit;
    const rawNextOffset = normalized.nextOffset ?? normalized.snapshotNextOffset;
    const nextOffset = hasMore
      ? rawNextOffset != null && Number.isFinite(Number(rawNextOffset)) ? Number(rawNextOffset) : inferredNextOffset
      : null;
    return {
      ...prior,
      ...normalized,
      snapshots,
      loaded: snapshots.length,
      total,
      limit,
      offset,
      nextOffset,
      hasMore,
      fullyLoaded: hasMore === false && (total == null || snapshots.length >= total),
      unsupported: false,
    };
  }

  function snapshotRows() {
    const support = object(state.recovery.get(state.selectedExamId)); const detail = object(selectedDetail());
    return firstList(support.snapshots, support.recoverySnapshots, detail.snapshots, detail.recoverySnapshots, state.data?.snapshots)
      .map(normalizeSnapshot)
      .filter((row) => !state.selectedExamId || !row.examId || row.examId === state.selectedExamId);
  }
  function recoveryProgress() {
    const support = object(state.recovery.get(state.selectedExamId));
    const loaded = snapshotRows().length;
    return {
      loaded,
      total: support.total != null && Number.isFinite(Number(support.total)) ? Number(support.total) : null,
      hasMore: support.hasMore === true,
      fullyLoaded: support.fullyLoaded === true,
      unsupported: support.unsupported === true,
    };
  }
  function auditRows() {
    const support = object(state.audit.get(state.selectedExamId || state.institutionId)); const detail = object(selectedDetail());
    return firstList(support.events, support.audit, support.auditEvents, detail.audit, detail.auditEvents, state.data?.audit);
  }
  function auditEventIdentity(event, index = 0) {
    return String(event?.eventId || event?.id || [
      event?.occurredAt || event?.recordedAt || '',
      event?.requestId || event?.correlationId || '',
      event?.eventType || event?.type || event?.action || '',
      event?.subjectId || event?.resourceId || '',
      index,
    ].join(':'));
  }
  function mergeAuditPage(previous, result, requestedOffset = 0) {
    const prior = object(previous);
    const normalized = uiValue(result);
    const page = uiList(firstList(normalized.events, normalized.items, normalized.audit, normalized.auditEvents));
    const events = requestedOffset === 0 ? [] : list(prior.events).slice();
    const known = new Set(events.map((event, index) => auditEventIdentity(event, index)));
    page.forEach((event, index) => {
      const identifier = auditEventIdentity(event, requestedOffset + index);
      if (!known.has(identifier)) { known.add(identifier); events.push(event); }
    });
    const limit = Number.isFinite(Number(normalized.limit)) ? Number(normalized.limit) : AUDIT_PAGE_SIZE;
    const offset = Number.isFinite(Number(normalized.offset)) ? Number(normalized.offset) : requestedOffset;
    const parsedTotal = Number(normalized.total ?? normalized.totalCount);
    const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : null;
    const inferredNextOffset = offset + page.length;
    const hasMore = typeof normalized.hasMore === 'boolean'
      ? normalized.hasMore
      : total != null ? inferredNextOffset < total : page.length === limit;
    const nextOffset = hasMore
      ? normalized.nextOffset != null && Number.isFinite(Number(normalized.nextOffset)) ? Number(normalized.nextOffset) : inferredNextOffset
      : null;
    return {
      ...prior,
      ...normalized,
      events,
      loaded: events.length,
      total,
      limit,
      offset,
      nextOffset,
      hasMore,
      fullyLoaded: hasMore === false && (total == null || events.length === total),
      unsupported: false,
    };
  }
  function auditProgress() {
    const support = object(state.audit.get(state.selectedExamId || state.institutionId));
    const loaded = auditRows().length;
    return {
      loaded,
      total: support.total != null && Number.isFinite(Number(support.total)) ? Number(support.total) : null,
      hasMore: support.hasMore === true,
      fullyLoaded: support.fullyLoaded === true,
      unsupported: support.unsupported === true,
    };
  }
  function renderRecoveryAudit() {
    const snapshots = snapshotRows(); const events = auditRows();
    const recovery = recoveryProgress();
    const recoverySummary = recovery.fullyLoaded
      ? `All ${recovery.loaded} checkpoints are loaded.`
      : recovery.total != null ? `${recovery.loaded} of ${recovery.total} checkpoints are loaded.` : `${recovery.loaded} checkpoints are loaded; the total is still being checked.`;
    const recoveryControls = recovery.hasMore
      ? `<div class="exam-admin-audit-load-actions"><button class="secondary-button" type="button" data-exam-admin-load-recovery="next">Load next ${SNAPSHOT_PAGE_SIZE}</button><button class="primary-button" type="button" data-exam-admin-load-recovery="all">Load all checkpoints</button></div>`
      : recovery.unsupported
        ? '<span class="exam-admin-audit-incomplete">Full recovery paging is temporarily unavailable. Reload after the owner service is restored.</span>'
        : !recovery.fullyLoaded ? '<button class="secondary-button" type="button" data-exam-admin-load-recovery="refresh">Reload checkpoints</button>' : '';
    const progress = auditProgress();
    const auditTitle = progress.fullyLoaded ? 'Complete audit trail' : 'Audit trail';
    const auditSummary = progress.fullyLoaded
      ? `All ${progress.loaded} matching owner receipts are loaded.`
      : progress.total != null
        ? `${progress.loaded} of ${progress.total} matching owner receipts are loaded.`
        : `${progress.loaded} owner receipts are loaded. The complete total is not available yet.`;
    const auditControls = progress.hasMore
      ? `<div class="exam-admin-audit-load-actions"><button class="secondary-button" type="button" data-exam-admin-load-audit="next"><i class="ph ph-arrow-down" aria-hidden="true"></i>Load next ${AUDIT_PAGE_SIZE}</button><button class="primary-button" type="button" data-exam-admin-load-audit="all"><i class="ph ph-stack" aria-hidden="true"></i>Load all records</button></div>`
      : progress.unsupported
        ? '<span class="exam-admin-audit-incomplete">Full audit paging is temporarily unavailable. Refresh after the owner service is restored.</span>'
        : !progress.fullyLoaded
          ? '<button class="secondary-button" type="button" data-exam-admin-load-audit="refresh"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>Reload audit trail</button>'
          : '';
    return `${toolbar('Recovery & Audit', 'Create, download, verify, retry, or recover a checkpoint copy and inspect owner receipts.')}${examSelector()}<section class="panel"><header class="exam-admin-panel-head exam-admin-audit-head"><div><h3>Recovery checkpoints</h3><p>${escapeHtml(recoverySummary)} Recover copy verifies and downloads preserved evidence. It never overwrites live examination rows.</p></div><div class="exam-admin-recovery-head-actions">${recoveryControls}${state.selectedExamId ? `<button class="primary-button" type="button" data-exam-admin-action="create_snapshot" data-exam-id="${escapeHtml(state.selectedExamId)}"><i class="ph ph-database" aria-hidden="true"></i>Create full snapshot</button>` : ''}</div></header>${snapshots.length ? `<div class="table-wrap"><table class="exam-admin-table"><thead><tr><th scope="col">Checkpoint</th><th scope="col">Status</th><th scope="col">Records</th><th scope="col">Verification</th><th scope="col">Owner controls</th></tr></thead><tbody>${snapshots.map((snapshot) => { const id = snapshotId(snapshot); const status = snapshot.status || snapshot.snapshotStatus || 'available'; return `<tr data-exam-admin-searchable data-search-text="${searchText(snapshot)}"><td><strong>${escapeHtml(statusLabel(snapshot.scope || snapshot.type || snapshot.snapshotScope))}</strong><small>${escapeHtml(formatDateTime(snapshot.createdAt || snapshot.at || snapshot.requestedAt))}</small><code>${escapeHtml(id)}</code></td><td>${statusBadge(status)}</td><td>${escapeHtml(snapshot.recordCount ?? snapshot.answerRevisionCount ?? '—')}</td><td><strong>${escapeHtml(snapshotVerified(snapshot) ? 'Verified' : snapshot.verificationStatus || 'Not yet verified')}</strong><small>${escapeHtml(snapshot.verifiedAt ? `Verified ${formatDateTime(snapshot.verifiedAt)}` : snapshot.sha256 || snapshot.snapshotSha256 || '')}</small></td><td><div class="exam-admin-actions"><button class="secondary-button" type="button" data-exam-admin-download-snapshot="${escapeHtml(id)}">Download</button><button class="secondary-button" type="button" data-exam-admin-verify-snapshot="${escapeHtml(id)}">Verify</button>${['failed', 'pending'].includes(String(status)) ? `<button class="secondary-button" type="button" data-exam-admin-action="retry_snapshot" data-snapshot-id="${escapeHtml(id)}" data-exam-id="${escapeHtml(state.selectedExamId)}">Retry</button>` : ''}<button class="secondary-button" type="button" data-exam-admin-action="restore_snapshot" data-snapshot-id="${escapeHtml(id)}" data-exam-id="${escapeHtml(state.selectedExamId)}">Recover copy</button></div></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No recovery checkpoint was returned for this examination.</div>'}</section><section class="panel"><header class="exam-admin-panel-head exam-admin-audit-head"><div><h3>${auditTitle}</h3><p>${escapeHtml(auditSummary)} Actor, event, exact subject, request receipt, time, and returned data remain available.</p></div>${auditControls}</header>${events.length ? `<div class="table-wrap"><table class="exam-admin-table"><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Event</th><th scope="col">Subject / receipt</th><th scope="col">Data</th></tr></thead><tbody>${events.map((event) => `<tr data-exam-admin-searchable data-search-text="${searchText(event)}"><td>${escapeHtml(formatDateTime(event.occurredAt || event.at || event.recordedAt))}</td><td><strong>${escapeHtml(event.actorName || event.actor || event.actorRole || 'System')}</strong><small>${escapeHtml(event.actorUserId || '')}</small></td><td>${statusBadge(event.eventType || event.type || event.action)}</td><td><strong>${escapeHtml(event.subjectType || event.resourceType || '')}</strong><code>${escapeHtml(event.subjectId || event.resourceId || event.requestId || event.correlationId || '')}</code></td><td>${rawPanel('Event data', event.eventData || event.data || event)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No audit event was returned for this filter.</div>'}</section>`;
  }

  /* RENDER_SECTIONS */
  async function ensureDetail(id = state.selectedExamId, force = false) {
    if (!id || (!force && state.details.has(id))) return state.details.get(id) || null;
    let detail;
    try { detail = await api.adminQuery('exam_detail', { institutionId: state.institutionId, examId: id }); }
    catch (error) {
      if (!isUnsupported(error) || typeof api.professorQuery !== 'function') throw error;
      const [exam, monitor, grading] = await Promise.allSettled([
        api.professorQuery('exam', { institutionId: state.institutionId, examId: id }),
        api.professorQuery('monitor', { institutionId: state.institutionId, examId: id }),
        api.professorQuery('grading', { institutionId: state.institutionId, examId: id }),
      ]);
      if (exam.status === 'rejected') throw exam.reason;
      detail = { ...exam.value, monitor: monitor.status === 'fulfilled' ? monitor.value : {}, grading: grading.status === 'fulfilled' ? grading.value : {}, fallback: true };
    }
    detail = normalizeOwnerDetail(detail);
    state.details.set(id, detail);
    return detail;
  }
  async function ensureAudit(force = false) {
    const key = state.selectedExamId || state.institutionId;
    if (!key || (!force && state.audit.has(key))) return state.audit.get(key) || null;
    try {
      const result = await api.adminQuery('audit_log', {
        institutionId: state.institutionId,
        examId: state.selectedExamId,
        limit: AUDIT_PAGE_SIZE,
        offset: 0,
      });
      state.audit.set(key, mergeAuditPage(null, result, 0));
    }
    catch (error) {
      if (!isUnsupported(error)) throw error;
      const events = uiList(state.data?.audit || []);
      state.audit.set(key, {
        events,
        loaded: events.length,
        total: null,
        limit: AUDIT_PAGE_SIZE,
        offset: 0,
        nextOffset: null,
        hasMore: false,
        fullyLoaded: false,
        unsupported: true,
      });
    }
    return state.audit.get(key);
  }
  async function appendAuditPage() {
    const key = state.selectedExamId || state.institutionId;
    const current = object(await ensureAudit());
    if (!current.hasMore) return current;
    const nextOffset = Number(current.nextOffset);
    if (!Number.isInteger(nextOffset) || nextOffset < 0 || nextOffset <= Number(current.offset || -1)) {
      throw ownerControlError('Audit paging stopped because the next page marker is invalid.', 'The records already loaded are safe. Refresh Recovery & Audit, then choose Load all records again.');
    }
    const result = await api.adminQuery('audit_log', {
      institutionId: state.institutionId,
      examId: state.selectedExamId,
      limit: AUDIT_PAGE_SIZE,
      offset: nextOffset,
    });
    const merged = mergeAuditPage(current, result, nextOffset);
    if (merged.hasMore && merged.nextOffset <= nextOffset) {
      throw ownerControlError('Audit paging did not advance to a new page.', 'The records already loaded are safe. Refresh Recovery & Audit, then try again.');
    }
    state.audit.set(key, merged);
    return merged;
  }
  async function loadAllAudit() {
    let current = object(await ensureAudit());
    if (current.unsupported) {
      throw ownerControlError('The full audit service is temporarily unavailable.', 'The overview records remain visible. Refresh Recovery & Audit when the owner service is restored.');
    }
    const visitedOffsets = new Set();
    while (current.hasMore) {
      const offset = Number(current.nextOffset);
      if (visitedOffsets.has(offset)) {
        throw ownerControlError('Audit paging repeated the same page marker.', 'The records already loaded are safe. Refresh Recovery & Audit, then choose Load all records again.');
      }
      visitedOffsets.add(offset);
      current = await appendAuditPage();
    }
    if (!current.fullyLoaded) {
      throw ownerControlError('The audit trail changed while its pages were loading.', 'The records already loaded are safe. Reload the audit trail, then export all again.');
    }
    return current;
  }
  async function runAuditLoad(mode, button) {
    const busyKey = `audit:${mode}`;
    if (state.busy.has(busyKey)) return;
    state.busy.add(busyKey); buttonBusy(button, true); state.inlineError = null;
    try {
      const result = mode === 'all'
        ? await loadAllAudit()
        : mode === 'refresh' ? await ensureAudit(true) : await appendAuditPage();
      renderIntoRoot();
      state.toast(result.fullyLoaded
        ? `All ${result.loaded} matching audit records are loaded.`
        : `${result.loaded}${result.total != null ? ` of ${result.total}` : ''} audit records are loaded.`);
    } catch (error) {
      state.inlineError = Object.assign(error, { retry: `audit_${mode}` });
      renderIntoRoot();
    } finally {
      state.busy.delete(busyKey);
      if (button?.isConnected) buttonBusy(button, false);
    }
  }
  async function ensureRecovery(force = false) {
    const key = state.selectedExamId;
    if (!key || (!force && state.recovery.has(key))) return state.recovery.get(key) || null;
    try {
      const result = await api.adminQuery('recovery_detail', {
        institutionId: state.institutionId,
        examId: key,
        limit: SNAPSHOT_PAGE_SIZE,
        offset: 0,
      });
      state.recovery.set(key, mergeSnapshotPage(null, result, 0));
    }
    catch (error) {
      if (!isUnsupported(error)) throw error;
      const snapshots = list(state.data?.snapshots).filter((snapshot) => !snapshot.examId || snapshot.examId === key).map(normalizeSnapshot);
      state.recovery.set(key, {
        snapshots,
        loaded: snapshots.length,
        total: null,
        limit: SNAPSHOT_PAGE_SIZE,
        offset: 0,
        nextOffset: null,
        hasMore: false,
        fullyLoaded: false,
        unsupported: true,
      });
    }
    return state.recovery.get(key);
  }
  async function appendRecoveryPage() {
    const key = state.selectedExamId;
    const current = object(await ensureRecovery());
    if (!current.hasMore) return current;
    const nextOffset = Number(current.nextOffset);
    if (!Number.isInteger(nextOffset) || nextOffset < 0 || nextOffset <= Number(current.offset ?? -1)) {
      throw ownerControlError('Recovery paging stopped because the next page marker is invalid.', 'The checkpoints already loaded are safe. Reload Recovery & Audit, then choose Load all checkpoints again.');
    }
    const result = await api.adminQuery('recovery_detail', {
      institutionId: state.institutionId,
      examId: key,
      limit: SNAPSHOT_PAGE_SIZE,
      offset: nextOffset,
    });
    const merged = mergeSnapshotPage(current, result, nextOffset);
    if (merged.hasMore && merged.nextOffset <= nextOffset) {
      throw ownerControlError('Recovery paging did not advance to a new page.', 'The checkpoints already loaded are safe. Reload Recovery & Audit, then try again.');
    }
    state.recovery.set(key, merged);
    return merged;
  }
  async function loadAllRecovery() {
    let current = object(await ensureRecovery());
    if (current.unsupported) {
      throw ownerControlError('The full recovery index is temporarily unavailable.', 'The overview checkpoints remain visible. Reload Recovery & Audit when the owner service is restored.');
    }
    const visitedOffsets = new Set();
    while (current.hasMore) {
      const offset = Number(current.nextOffset);
      if (visitedOffsets.has(offset)) {
        throw ownerControlError('Recovery paging repeated the same page marker.', 'The checkpoints already loaded are safe. Reload Recovery & Audit, then choose Load all checkpoints again.');
      }
      visitedOffsets.add(offset);
      current = await appendRecoveryPage();
    }
    if (!current.fullyLoaded) {
      throw ownerControlError('The recovery index changed while its pages were loading.', 'The checkpoints already loaded are safe. Reload Recovery & Audit, then export all again.');
    }
    return current;
  }
  async function runRecoveryLoad(mode, button) {
    const busyKey = `recovery:${mode}`;
    if (state.busy.has(busyKey)) return;
    state.busy.add(busyKey); buttonBusy(button, true); state.inlineError = null;
    try {
      const result = mode === 'all'
        ? await loadAllRecovery()
        : mode === 'refresh' ? await ensureRecovery(true) : await appendRecoveryPage();
      renderIntoRoot();
      state.toast(result.fullyLoaded
        ? `All ${result.loaded} recovery checkpoints are loaded.`
        : `${result.loaded}${result.total != null ? ` of ${result.total}` : ''} recovery checkpoints are loaded.`);
    } catch (error) {
      state.inlineError = Object.assign(error, { retry: `recovery_${mode}` });
      renderIntoRoot();
    } finally {
      state.busy.delete(busyKey);
      if (button?.isConnected) buttonBusy(button, false);
    }
  }
  async function prepareTab(tab) {
    if (!TABS[tab]) return;
    state.tab = tab; state.search = ''; state.inlineError = null;
    if (DETAIL_TABS.has(tab)) await ensureDetail();
    if (tab === 'recovery_audit') await Promise.all([ensureRecovery(), ensureAudit()]);
  }
  function renderIntoRoot() {
    if (!state.root) return;
    state.root.innerHTML = renderContent(); applySearch(state.search);
  }
  async function refreshIntoRoot(message = '', clearCaches = true) {
    if (!state.root) return;
    const requestToken = ++state.loadRequest;
    state.root.setAttribute('aria-busy', 'true');
    if (clearCaches) { state.details.clear(); state.audit.clear(); state.recovery.clear(); }
    try {
      const html = await load(requestToken);
      if (requestToken !== state.loadRequest || html == null) return;
      if (DETAIL_TABS.has(state.tab)) await ensureDetail();
      if (state.tab === 'recovery_audit') await Promise.all([ensureRecovery(), ensureAudit()]);
      state.inlineError = null; state.root.innerHTML = renderContent();
      if (message) state.toast(message);
    } catch (error) { if (requestToken === state.loadRequest) state.root.innerHTML = `<div class="exam-admin-page">${errorPanel(error)}</div>`; }
    finally { if (requestToken === state.loadRequest) state.root.removeAttribute('aria-busy'); }
  }
  async function runPreflight(button = null) {
    const busyKey = 'owner-preflight';
    if (state.busy.has(busyKey)) return;
    state.busy.add(busyKey); buttonBusy(button, true);
    try {
      const result = await requestPreflight();
      renderIntoRoot();
      if (result?.ready === true) state.toast('System check passed for this environment.');
      else if (result) state.toast('System check complete. Follow each How to fix message, then run it again.');
      else state.toast('The system check could not run. Nothing was changed.');
    } finally {
      state.busy.delete(busyKey);
      if (button?.isConnected) buttonBusy(button, false);
    }
  }
  function buttonBusy(button, busy) {
    if (!button) return;
    if (busy) { button.dataset.examAdminOriginal = button.innerHTML; button.disabled = true; button.innerHTML = '<i class="ph ph-spinner-gap" aria-hidden="true"></i>Working…'; }
    else { button.disabled = false; if (button.dataset.examAdminOriginal) button.innerHTML = button.dataset.examAdminOriginal; delete button.dataset.examAdminOriginal; }
  }
  function ownerActionStorageKey(operation, examIdentifier, prefix = OWNER_ACTION_STORAGE_PREFIX) {
    const owner = String(state.ownerUserId || '').trim();
    const institution = String(state.institutionId || '').trim();
    const exam = String(examIdentifier || '').trim();
    const action = String(operation || '').trim();
    if (!owner || !institution || !exam || !action) return '';
    const actionSegment = prefix === LEGACY_OWNER_ROTATION_STORAGE_PREFIX ? '' : `:${encodeURIComponent(action)}`;
    return `${prefix}:${encodeURIComponent(owner)}:${encodeURIComponent(institution)}${actionSegment}:${encodeURIComponent(exam)}`;
  }
  function ownerActionStorageKeys(operation, examIdentifier) {
    const keys = [ownerActionStorageKey(operation, examIdentifier)];
    if (operation === 'rotate_key') keys.push(ownerActionStorageKey(operation, examIdentifier, LEGACY_OWNER_ROTATION_STORAGE_PREFIX));
    return keys.filter(Boolean);
  }
  function pendingOwnerAction(operation, examIdentifier) {
    const owner = String(state.ownerUserId || '').trim();
    const institution = String(state.institutionId || '').trim();
    const exam = String(examIdentifier || '').trim();
    for (const storageKey of ownerActionStorageKeys(operation, exam)) {
      try {
        const saved = JSON.parse(global.sessionStorage?.getItem(storageKey) || 'null');
        const savedRequestKeys = object(saved?.requestKeys);
        const primary = String(savedRequestKeys.primary || saved?.requestKey || '').trim();
        if (!saved || ![1, 2].includes(saved.version)
          || saved.ownerUserId !== owner
          || saved.institutionId !== institution
          || saved.examId !== exam
          || saved.operation !== operation
          || !primary) continue;
        return {
          storageKey,
          requestKeys: {
            primary,
            activate: String(savedRequestKeys.activate || '').trim(),
            email: String(savedRequestKeys.email || '').trim(),
            fallback: String(savedRequestKeys.fallback || '').trim(),
          },
        };
      } catch { /* Ignore invalid or unavailable session storage and try the next compatible key. */ }
    }
    return null;
  }
  function persistOwnerAction(operation, examIdentifier, requestKeys) {
    const storageKey = ownerActionStorageKey(operation, examIdentifier);
    if (!storageKey) return;
    try {
      global.sessionStorage?.setItem(storageKey, JSON.stringify({
        version: 2,
        ownerUserId: state.ownerUserId,
        institutionId: state.institutionId,
        examId: examIdentifier,
        operation,
        requestKey: requestKeys.primary,
        requestKeys,
        createdAt: new Date().toISOString(),
      }));
    } catch { /* Same-page retry remains protected by the in-memory request map. */ }
  }
  function clearOwnerAction(operation, examIdentifier, expectedRequestKey) {
    for (const storageKey of ownerActionStorageKeys(operation, examIdentifier)) {
      try {
        const saved = JSON.parse(global.sessionStorage?.getItem(storageKey) || 'null');
        const savedPrimary = String(saved?.requestKeys?.primary || saved?.requestKey || '').trim();
        if (savedPrimary && expectedRequestKey && savedPrimary !== expectedRequestKey) continue;
        global.sessionStorage?.removeItem(storageKey);
      } catch { /* A replay keeps the same server-side receipt and cannot repeat the action. */ }
    }
  }
  function actionRequestContext(operation, payload) {
    const actionKey = `${state.ownerUserId || 'owner'}:${state.institutionId || ''}:${operation}:${payload.examId || ''}:${payload.snapshotId || ''}`;
    let requestKeys = state.actionRequests.get(actionKey);
    if (!requestKeys) {
      const persistedAction = PERSISTED_OWNER_ACTIONS.has(operation) ? pendingOwnerAction(operation, payload.examId) : null;
      requestKeys = {
        primary: persistedAction?.requestKeys.primary || api.requestId(),
        activate: persistedAction?.requestKeys.activate || api.requestId(),
        email: persistedAction?.requestKeys.email || api.requestId(),
        fallback: persistedAction?.requestKeys.fallback || api.requestId(),
      };
      state.actionRequests.set(actionKey, requestKeys);
      if (PERSISTED_OWNER_ACTIONS.has(operation)) persistOwnerAction(operation, payload.examId, requestKeys);
    }
    return { actionKey, requestKeys };
  }
  async function approveAndEmail(id, requestKeys) {
    try { return await api.adminCommand('approve_and_email_key', { institutionId: state.institutionId, examId: id }, requestKeys.primary); }
    catch (error) {
      if (!api.demoEnabled?.() || !isUnsupported(error)) throw error;
      await api.adminCommand('activate_exam', { institutionId: state.institutionId, examId: id }, requestKeys.activate);
      return api.adminCommand('email_key', { institutionId: state.institutionId, examId: id }, requestKeys.email);
    }
  }
  async function revealKey(id, requestKeys) {
    try { return await api.adminCommand('reveal_key', { institutionId: state.institutionId, examId: id }, requestKeys.primary); }
    catch (error) { if (!api.demoEnabled?.() || !isUnsupported(error)) throw error; return api.adminCommand('email_key', { institutionId: state.institutionId, examId: id }, requestKeys.email); }
  }
  async function runAction(operation, payload, button) {
    const { actionKey: key, requestKeys } = actionRequestContext(operation, payload);
    if (state.busy.has(key)) return;
    if (operation === 'rotate_key' && !global.confirm('Rotate the current key and email the replacement to the creator and owner addresses? The old key will stop working.')) return;
    if (operation === 'revoke_key' && !global.confirm('Revoke this room key? Existing answers, submissions, grades, and receipts remain available.')) return;
    if (operation === 'restore_snapshot' && !global.confirm('Verify and recover a downloadable copy of this checkpoint? Live examination rows will not be changed.')) return;
    state.busy.add(key); buttonBusy(button, true); state.inlineError = null;
    try {
      let result;
      if (operation === 'approve_and_email_key') result = await approveAndEmail(payload.examId, requestKeys);
      else if (operation === 'reveal_key') result = await revealKey(payload.examId, requestKeys);
      else if (operation === 'rotate_key') result = await api.adminCommand('email_key', { institutionId: state.institutionId, examId: payload.examId }, requestKeys.primary);
      else if (operation === 'resend_key') result = await api.adminCommand('resend_key', { institutionId: state.institutionId, examId: payload.examId }, requestKeys.primary);
      else {
        try { result = await api.adminCommand(operation, { ...payload, institutionId: state.institutionId, ...(operation === 'create_snapshot' ? { scope: 'full_recovery' } : {}) }, requestKeys.primary); }
        catch (error) {
          if (!api.demoEnabled?.() || !isUnsupported(error)) throw error;
          if (operation === 'retry_snapshot') result = await api.adminCommand('create_snapshot', { institutionId: state.institutionId, examId: payload.examId, scope: 'full_recovery' }, requestKeys.fallback);
          else if (operation === 'restore_snapshot') result = { ok: true, demo: true, verified: true, restored: false, recoveredAt: new Date().toISOString() };
          else throw error;
        }
      }
      if (result?.roomKey && payload.examId) state.currentKeys.set(payload.examId, result.roomKey);
      if (payload.examId && (result?.deliveryStatus || result?.recipient || result?.adminRecipients)) state.deliveries.set(payload.examId, {
        status: result.deliveryStatus || 'requested',
        safeErrorCode: result.deliverySafeErrorCode || result.deliveryAttemptSafeErrorCode || '',
        recovery: result.deliveryRecovery || result.recovery || '',
        professorRecipient: result.recipient || result.professorEmail || '',
        adminRecipients: result.adminRecipients || result.ownerRecipients || '',
        at: new Date().toISOString(),
      });
      if (operation === 'reveal_key') { state.actionRequests.delete(key); renderIntoRoot(); state.toast('The exact current key is visible.'); return; }
      if (operation === 'restore_snapshot' && (result?.recoveryBundle || result?.bundle)) {
        downloadFile(`examination-room-recovered-${payload.snapshotId || 'snapshot'}.json`, 'application/json;charset=utf-8', JSON.stringify(result.recoveryBundle || result.bundle, null, 2));
      }
      const sent = ['sent', 'delivered', 'demo_delivered', 'requested'].includes(String(result?.deliveryStatus || '').toLowerCase());
      const deliveryFailure = ['approve_and_email_key', 'rotate_key', 'resend_key'].includes(operation) && !sent;
      const messages = { approve_and_email_key: 'Key generated. Monitoring and Grading are unlocked automatically for the creator; email was sent to the creator and owner addresses.', rotate_key: 'Replacement key issued and emailed.', resend_key: 'The current key was emailed again to the creator and owner addresses.', revoke_key: 'Room key revoked. Examination data was preserved.', create_snapshot: 'Full recovery snapshot requested.', retry_snapshot: 'Snapshot retry started.', restore_snapshot: 'Checkpoint verified and downloaded. Live examination rows were not changed.' };
      const message = deliveryFailure
        ? `The key is active and visible, and the creator can use Monitoring and Grading without entering it. Email was not sent. ${result?.deliveryRecovery || result?.recovery || 'Check the email configuration, then choose Resend current key.'}`
        : messages[operation] || 'Owner action completed.';
      if (PERSISTED_OWNER_ACTIONS.has(operation)) clearOwnerAction(operation, payload.examId, requestKeys.primary);
      state.actionRequests.delete(key);
      await refreshIntoRoot(message);
    } catch (error) { state.inlineError = Object.assign(error, { retry: `${operation}:${payload.examId || ''}:${payload.snapshotId || ''}` }); renderIntoRoot(); }
    finally { state.busy.delete(key); if (button?.isConnected) buttonBusy(button, false); }
  }

  function ownerControlError(message, recovery) {
    return Object.assign(new Error(message), { recovery });
  }
  function ownerControlPayload(form) {
    const operation = form.dataset.examAdminOwnerControl;
    const values = new FormData(form);
    const examIdentifier = String(values.get('examId') || state.selectedExamId || '').trim();
    if (!examIdentifier) throw ownerControlError('The examination identifier is missing.', 'Refresh the selected examination, then try again.');
    if (operation === 'correct_student_identity') {
      const studentIdentityId = String(values.get('studentIdentityId') || '').trim();
      const fullName = String(values.get('fullName') || '').trim();
      const studentNumber = String(values.get('studentNumber') || '').trim();
      const email = String(values.get('email') || '').trim().toLowerCase();
      const clearEmail = values.get('clearEmail') === 'on';
      if (!studentIdentityId || fullName.length < 2 || !studentNumber) {
        throw ownerControlError('Complete the student name and student number.', 'Refresh the record if its identity identifier is missing, then correct the highlighted fields.');
      }
      return {
        operation,
        payload: {
          examId: examIdentifier,
          studentIdentityId,
          fullName,
          studentNumber,
          ...(clearEmail ? { clearEmail: true } : email ? { email } : {}),
          reason: String(values.get('reason') || '').trim(),
        },
      };
    }
    if (operation === 'set_submission_status') {
      const status = String(values.get('status') || '').trim();
      if (!['accepted', 'under_review', 'voided'].includes(status)) {
        throw ownerControlError('Choose Accepted, Under review, or Voided.', 'Choose one listed submission status and try again.');
      }
      const submissionId = String(values.get('submissionId') || '').trim();
      if (!submissionId) throw ownerControlError('The submission identifier is missing.', 'Refresh Students & Answers, then choose the current submission.');
      return {
        operation,
        payload: {
          examId: examIdentifier,
          submissionId,
          status,
          reason: String(values.get('reason') || '').trim(),
        },
      };
    }
    if (operation === 'room_control') {
      const action = String(values.get('action') || '').trim();
      if (!['open', 'close'].includes(action)) {
        throw ownerControlError('Choose Open room now or Close room.', 'Refresh Examinations and choose one listed room action.');
      }
      return {
        operation,
        payload: {
          examId: examIdentifier,
          action,
          reason: String(values.get('reason') || '').trim(),
        },
      };
    }
    throw ownerControlError('That owner control is not available.', 'Refresh the Examination Room command center and choose a listed action.');
  }
  function ownerControlConfirmation(operation, payload) {
    if (operation === 'correct_student_identity') {
      const emailEffect = payload.clearEmail
        ? ' The stored student email will be removed.'
        : payload.email ? ` The stored email will become ${payload.email}.` : ' The stored email will remain unchanged.';
      return `Save the corrected identity for ${payload.fullName} (${payload.studentNumber})?${emailEffect} The exam creator and future owner exports will use these exact values.`;
    }
    if (operation === 'set_submission_status') {
      const consequence = payload.status === 'voided'
        ? 'The submission will leave ordinary grading, but its answers and evidence will remain available.'
        : 'The answers and evidence will remain unchanged.';
      return `Change this submission to ${statusLabel(payload.status)}? ${consequence}`;
    }
    if (payload.action === 'close') {
      return 'Close this room now? Active student sessions will end. Every saved answer, submission, grade, and receipt will remain available.';
    }
    return 'Open this scheduled room now? Students with the current key will be able to enter immediately.';
  }
  function resetOwnerControlReceipt(form) {
    if (!form) return;
    delete form.dataset.examAdminOwnerRequestKey;
    const status = form.querySelector('.exam-admin-owner-control-status');
    if (!status || status.dataset.state !== 'error') return;
    status.dataset.state = 'ready';
    status.textContent = 'The values changed. Submit again to create a new owner receipt.';
  }
  async function runOwnerControlForm(form) {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.exam-admin-owner-control-status');
    let command;
    try { command = ownerControlPayload(form); }
    catch (error) {
      if (status) {
        status.dataset.state = 'error';
        status.textContent = `${error.message} ${error.recovery || 'Correct the fields and try again.'}`;
      }
      return;
    }
    if (!global.confirm(ownerControlConfirmation(command.operation, command.payload))) {
      if (status) { status.dataset.state = 'ready'; status.textContent = 'No change was made.'; }
      return;
    }
    const requestKey = form.dataset.examAdminOwnerRequestKey || api.requestId();
    form.dataset.examAdminOwnerRequestKey = requestKey;
    const busyKey = `owner-control:${requestKey}`;
    if (state.busy.has(busyKey)) return;
    state.busy.add(busyKey);
    form.setAttribute('aria-busy', 'true');
    buttonBusy(button, true);
    if (status) { status.dataset.state = 'working'; status.textContent = 'Applying the owner action and recording its receipt…'; }
    try {
      await api.adminCommand(command.operation, {
        institutionId: state.institutionId,
        ...command.payload,
      }, requestKey);
      delete form.dataset.examAdminOwnerRequestKey;
      const messages = {
        correct_student_identity: 'Student identity corrected. The verified values and owner receipt are now visible.',
        set_submission_status: `Submission changed to ${statusLabel(command.payload.status)}. Answers and evidence were preserved.`,
        room_control: command.payload.action === 'open'
          ? 'Room opened. Students with the current key may enter now.'
          : 'Room closed. Active sessions ended and all examination records were preserved.',
      };
      if (status) { status.dataset.state = 'success'; status.textContent = messages[command.operation]; }
      await refreshIntoRoot(messages[command.operation]);
    } catch (error) {
      if (status) {
        status.dataset.state = 'error';
        status.textContent = `${error.message || 'The owner action could not be completed.'} ${error.recovery || 'Nothing was discarded. Check the connection and submit the unchanged form again.'}`;
      }
    } finally {
      state.busy.delete(busyKey);
      form.removeAttribute('aria-busy');
      if (button?.isConnected) buttonBusy(button, false);
    }
  }

  async function runBootstrap(form) {
    if (state.busy.has('bootstrap')) return;
    const values = new FormData(form); const button = form.querySelector('button[type="submit"]'); const status = form.querySelector('.exam-admin-form-status');
    state.busy.add('bootstrap'); buttonBusy(button, true); status.textContent = 'Creating the school workspace…';
    try { const result = await api.adminCommand('bootstrap_institution', { institutionName: values.get('institutionName'), institutionCode: values.get('institutionCode') }, api.requestId()); state.institutionId = result.institution?.id || null; await refreshIntoRoot('School workspace created.'); }
    catch (error) { status.textContent = `${error.message || 'The workspace could not be created.'} ${error.recovery || 'Review the fields and try again.'}`; }
    finally { state.busy.delete('bootstrap'); if (button.isConnected) buttonBusy(button, false); }
  }
  async function runRoleForm(form) {
    if (state.busy.has('assign_staff')) return;
    const values = new FormData(form); const button = form.querySelector('button[type="submit"]'); const status = form.querySelector('.exam-admin-form-status');
    state.busy.add('assign_staff'); buttonBusy(button, true); status.textContent = 'Saving the optional directory assignment…';
    try { await api.adminCommand('assign_staff', { institutionId: state.institutionId, email: values.get('email'), displayName: values.get('displayName'), staffRole: values.get('staffRole'), reason: values.get('reason') }, api.requestId()); form.reset(); await refreshIntoRoot('Directory assignment saved. Creator entry, exam creation, saving, and key requests remain independent of this list.'); }
    catch (error) { status.textContent = `${error.message || 'The directory assignment could not be saved.'} ${error.recovery || 'Review the sign-in email and try again.'}`; }
    finally { state.busy.delete('assign_staff'); if (button.isConnected) buttonBusy(button, false); }
  }
  async function approveProfessor(button) {
    buttonBusy(button, true);
    try { await api.adminCommand('assign_staff', { institutionId: state.institutionId, email: button.dataset.examAdminRequestEmail, displayName: button.dataset.examAdminRequestName, staffRole: 'professor', reason: 'Added by a platform owner to the school directory.' }, api.requestId()); await refreshIntoRoot('Creator added to the optional school directory. Entry, exam creation, saving, and key requests did not require this step.'); }
    catch (error) { state.inlineError = error; renderIntoRoot(); }
    finally { if (button.isConnected) buttonBusy(button, false); }
  }
  async function rejectProfessor(button) {
    if (!global.confirm(`Dismiss the optional directory request from ${button.dataset.examAdminRequestName || 'this creator'}? Creator entry, examination creation, saving, and key requests will not be blocked, and no examination data will be deleted.`)) return;
    buttonBusy(button, true);
    try { await api.adminCommand('reject_professor_request', { institutionId: state.institutionId, requestId: button.dataset.examAdminRejectProfessor, reason: 'Dismissed by a platform owner after review.' }, api.requestId()); await refreshIntoRoot('Optional directory request dismissed. Creator access was unchanged.'); }
    catch (error) { state.inlineError = error; renderIntoRoot(); }
    finally { if (button.isConnected) buttonBusy(button, false); }
  }
  async function revokeStaff(button) {
    if (!global.confirm(`Revoke access for ${button.dataset.examAdminStaffName || 'this account'}? Existing records remain available.`)) return;
    buttonBusy(button, true);
    try { await api.adminCommand('revoke_staff', { institutionId: state.institutionId, membershipId: button.dataset.examAdminRevokeStaff, reason: 'Access revoked by a platform owner.' }, api.requestId()); await refreshIntoRoot('Staff access revoked. Existing records were preserved.'); }
    catch (error) { state.inlineError = error; renderIntoRoot(); }
    finally { if (button.isConnected) buttonBusy(button, false); }
  }
  async function copyKey(id) {
    const value = state.currentKeys.get(id);
    if (!value) { state.toast('Choose Retrieve exact key first.'); return; }
    try { await navigator.clipboard.writeText(value); state.toast('Exact room key copied.'); }
    catch { const input = [...state.root.querySelectorAll('.exam-admin-key-card input')].find((node) => node.value === value); input?.select(); state.toast('The key is selected. Use Copy.'); }
  }

  function exportPayload() {
    const detail = selectedDetail();
    if (state.tab === 'overview') return state.data;
    if (state.tab === 'professor_access') return { institution: currentInstitution(), professorRequests: state.data?.professorRequests || [], staff: state.data?.staff || [] };
    if (state.tab === 'examinations') return { exams: state.data?.exams || [], selectedExam: selectedExam(), selectedDetail: detail };
    if (state.tab === 'questions') return { exam: selectedExam(), questions: questions(detail), publicationManifest: detail?.publicationManifest || null };
    if (state.tab === 'students_answers') return { exam: selectedExam(), students: students(detail), sessions: sessions(detail), submissions: submissions(detail), answers: answers(detail) };
    if (state.tab === 'grades_results') return { exam: selectedExam(), grades: grades(detail), releases: detail?.releases || detail?.resultReleases || [] };
    if (state.tab === 'keys_email') return { exam: selectedExam(), keys: keyRecords(), currentKey: state.currentKeys.get(state.selectedExamId) || null, delivery: state.deliveries.get(state.selectedExamId) || null };
    return { exam: selectedExam(), snapshots: snapshotRows(), audit: auditRows() };
  }
  function csvRows(payload) {
    if (Array.isArray(payload)) return payload;
    const source = object(payload);
    if (Array.isArray(source.snapshots) && Array.isArray(source.audit)) {
      return [
        ...source.snapshots.map((row) => ({ ...object(row), exportRecordType: 'recovery_snapshot' })),
        ...source.audit.map((row) => ({ ...object(row), exportRecordType: 'audit_event' })),
      ];
    }
    const rowKeys = ['answers', 'grades', 'questions', 'students', 'exams', 'snapshots', 'audit', 'staff', 'professorRequests', 'keys'];
    const key = rowKeys.find((name) => Array.isArray(source[name]) && source[name].length)
      || rowKeys.find((name) => Array.isArray(source[name]));
    return key ? source[key] : [source];
  }
  function csvText(payload) {
    const rows = csvRows(payload).map((row) => Object.fromEntries(Object.entries(object(row)).map(([key, value]) => [key, value != null && typeof value === 'object' ? JSON.stringify(value) : value ?? ''])));
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]; const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [columns.map(quote).join(','), ...rows.map((row) => columns.map((column) => quote(row[column])).join(','))].join('\r\n');
  }
  function downloadFile(filename, type, body) {
    const url = URL.createObjectURL(new Blob([body], { type })); const link = document.createElement('a');
    link.href = url; link.download = filename; link.hidden = true; document.body.appendChild(link); link.click(); link.remove(); global.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  async function exportCurrent(format, button = null) {
    const busyKey = `export:${state.tab}:${format}`;
    if (state.busy.has(busyKey)) return;
    state.busy.add(busyKey); buttonBusy(button, true);
    try {
      if (['overview', 'examinations'].includes(state.tab) && !examProgress().fullyLoaded) await loadAllExams();
      if (state.tab === 'recovery_audit') {
        await Promise.all([
          recoveryProgress().fullyLoaded ? Promise.resolve() : loadAllRecovery(),
          auditProgress().fullyLoaded ? Promise.resolve() : loadAllAudit(),
        ]);
      }
      const payload = exportPayload(); const filename = `examination-room-${state.tab.replace(/_/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
      if (format === 'csv') downloadFile(`${filename}.csv`, 'text/csv;charset=utf-8', csvText(payload));
      else downloadFile(`${filename}.json`, 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
      const completeness = state.tab === 'recovery_audit'
        ? ` All ${snapshotRows().length} checkpoints and ${auditRows().length} matching audit records are included.`
        : ['overview', 'examinations'].includes(state.tab) ? ` All ${list(state.data?.exams).length} examinations are included.` : '';
      state.toast(`${format.toUpperCase()} export prepared.${completeness}`);
    } catch (error) {
      const exams = examProgress(); const recovery = recoveryProgress(); const audit = auditProgress();
      const retry = ['overview', 'examinations'].includes(state.tab)
        ? !exams.fullyLoaded && !exams.hasMore ? 'exams_refresh' : `exams_export_${format}`
        : state.tab === 'recovery_audit' && !recovery.fullyLoaded && !recovery.hasMore
          ? 'recovery_refresh'
          : state.tab === 'recovery_audit' && !audit.fullyLoaded && !audit.hasMore
            ? 'audit_refresh'
            : `audit_export_${format}`;
      state.inlineError = Object.assign(error, { retry });
      renderIntoRoot();
    } finally {
      state.busy.delete(busyKey);
      if (button?.isConnected) buttonBusy(button, false);
    }
  }
  async function downloadSnapshot(id, button) {
    buttonBusy(button, true);
    try {
      let result;
      try { result = await api.adminQuery('recovery_detail', { institutionId: state.institutionId, examId: state.selectedExamId, snapshotId: id, includeBundle: true }); }
      catch (error) { if (!isUnsupported(error)) throw error; result = snapshotRows().find((row) => snapshotId(row) === id) || { snapshotId: id, status: 'metadata_only' }; }
      const downloadUrl = result.downloadUrl || result.snapshot?.downloadUrl;
      if (downloadUrl && /^https:\/\//i.test(downloadUrl)) global.open(downloadUrl, '_blank', 'noopener');
      else downloadFile(`examination-room-recovery-${id || 'snapshot'}.json`, 'application/json;charset=utf-8', JSON.stringify(result.bundle || result, null, 2));
      state.toast('Recovery download prepared.');
    } catch (error) { state.inlineError = error; renderIntoRoot(); }
    finally { if (button.isConnected) buttonBusy(button, false); }
  }
  async function verifySnapshot(id, button) {
    buttonBusy(button, true);
    try {
      let result;
      try { result = await api.adminQuery('recovery_detail', { institutionId: state.institutionId, examId: state.selectedExamId, snapshotId: id, verify: true }); }
      catch (error) { if (!api.demoEnabled?.() || !isUnsupported(error)) throw error; result = { verified: true, demo: true }; }
      if (result.verified === false || result.verificationStatus === 'failed') throw Object.assign(new Error('The checkpoint did not pass verification.'), { recovery: 'Choose Retry before restoring.' });
      state.toast('Recovery checkpoint verified.'); await ensureRecovery(true); renderIntoRoot();
    } catch (error) { state.inlineError = error; renderIntoRoot(); }
    finally { if (button.isConnected) buttonBusy(button, false); }
  }
  function applySearch(value = '') {
    if (!state.root) return;
    const query = String(value).trim().toLowerCase();
    state.root.querySelectorAll('[data-exam-admin-searchable]').forEach((node) => { node.hidden = Boolean(query) && !String(node.dataset.searchText || node.textContent || '').toLowerCase().includes(query); });
  }
  async function retryAction(value, button) {
    const [operation, id, snap] = String(value || '').split(':');
    if (operation === 'refresh') { await refreshIntoRoot('Examination Room refreshed.'); return; }
    if (operation === 'exams_next') { await runExamLoad('next', button); return; }
    if (operation === 'exams_all') { await runExamLoad('all', button); return; }
    if (operation === 'exams_refresh') { await runExamLoad('refresh', button); return; }
    if (operation === 'exams_export_json') { await exportCurrent('json', button); return; }
    if (operation === 'exams_export_csv') { await exportCurrent('csv', button); return; }
    if (operation === 'recovery_next') { await runRecoveryLoad('next', button); return; }
    if (operation === 'recovery_all') { await runRecoveryLoad('all', button); return; }
    if (operation === 'recovery_refresh') { await runRecoveryLoad('refresh', button); return; }
    if (operation === 'audit_next') { await runAuditLoad('next', button); return; }
    if (operation === 'audit_all') { await runAuditLoad('all', button); return; }
    if (operation === 'audit_refresh') { await runAuditLoad('refresh', button); return; }
    if (operation === 'audit_export_json') { await exportCurrent('json', button); return; }
    if (operation === 'audit_export_csv') { await exportCurrent('csv', button); return; }
    await runAction(operation, { examId: id || state.selectedExamId, snapshotId: snap || undefined }, button);
  }

  function bind({ root, toast, refresh }) {
    state.root = root; state.toast = typeof toast === 'function' ? toast : state.toast; state.refresh = typeof refresh === 'function' ? refresh : state.refresh;
    if (!root || root.dataset.examinationRoomBound === 'true') return;
    root.dataset.examinationRoomBound = 'true';
    root.addEventListener('submit', async (event) => {
      if (event.target.matches('[data-exam-admin-bootstrap-form]')) { event.preventDefault(); await runBootstrap(event.target); }
      else if (event.target.matches('[data-exam-admin-role-form]')) { event.preventDefault(); await runRoleForm(event.target); }
      else if (event.target.matches('[data-exam-admin-owner-control]')) { event.preventDefault(); await runOwnerControlForm(event.target); }
    });
    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-exam-admin-search]')) { state.search = event.target.value; applySearch(state.search); }
      else resetOwnerControlReceipt(event.target.closest('[data-exam-admin-owner-control]'));
    });
    root.addEventListener('change', async (event) => {
      if (event.target.matches('[data-exam-admin-institution]')) { state.institutionId = event.target.value; state.selectedExamId = null; state.currentKeys.clear(); state.deliveries.clear(); await refreshIntoRoot('Law-school workspace changed.'); }
      else if (event.target.matches('[data-exam-admin-exam-selector]')) { state.selectedExamId = event.target.value; state.search = ''; root.setAttribute('aria-busy', 'true'); try { await ensureDetail(); if (state.tab === 'recovery_audit') await Promise.all([ensureRecovery(), ensureAudit()]); renderIntoRoot(); } catch (error) { state.inlineError = error; renderIntoRoot(); } finally { root.removeAttribute('aria-busy'); } }
      else resetOwnerControlReceipt(event.target.closest('[data-exam-admin-owner-control]'));
    });
    root.addEventListener('click', async (event) => {
      const tab = event.target.closest('[data-exam-admin-tab]');
      if (tab) { root.setAttribute('aria-busy', 'true'); try { await prepareTab(tab.dataset.examAdminTab); renderIntoRoot(); } catch (error) { state.inlineError = error; renderIntoRoot(); } finally { root.removeAttribute('aria-busy'); } return; }
      const select = event.target.closest('[data-exam-admin-select-exam]');
      if (select) { state.selectedExamId = select.dataset.examAdminSelectExam; root.setAttribute('aria-busy', 'true'); try { await prepareTab(select.dataset.examAdminGoTab || 'examinations'); renderIntoRoot(); } catch (error) { state.inlineError = error; renderIntoRoot(); } finally { root.removeAttribute('aria-busy'); } return; }
      const action = event.target.closest('[data-exam-admin-action]'); if (action) { await runAction(action.dataset.examAdminAction, { examId: action.dataset.examId || state.selectedExamId, snapshotId: action.dataset.snapshotId || undefined }, action); return; }
      const approve = event.target.closest('[data-exam-admin-approve-professor]'); if (approve) { await approveProfessor(approve); return; }
      const reject = event.target.closest('[data-exam-admin-reject-professor]'); if (reject) { await rejectProfessor(reject); return; }
      const revoke = event.target.closest('[data-exam-admin-revoke-staff]'); if (revoke) { await revokeStaff(revoke); return; }
      const copy = event.target.closest('[data-exam-admin-copy-key]'); if (copy) { await copyKey(copy.dataset.examAdminCopyKey); return; }
      const exporter = event.target.closest('[data-exam-admin-export]'); if (exporter) { await exportCurrent(exporter.dataset.examAdminExport, exporter); return; }
      const examLoader = event.target.closest('[data-exam-admin-load-exams]'); if (examLoader) { await runExamLoad(examLoader.dataset.examAdminLoadExams, examLoader); return; }
      const recoveryLoader = event.target.closest('[data-exam-admin-load-recovery]'); if (recoveryLoader) { await runRecoveryLoad(recoveryLoader.dataset.examAdminLoadRecovery, recoveryLoader); return; }
      const auditLoader = event.target.closest('[data-exam-admin-load-audit]'); if (auditLoader) { await runAuditLoad(auditLoader.dataset.examAdminLoadAudit, auditLoader); return; }
      const download = event.target.closest('[data-exam-admin-download-snapshot]'); if (download) { await downloadSnapshot(download.dataset.examAdminDownloadSnapshot, download); return; }
      const verify = event.target.closest('[data-exam-admin-verify-snapshot]'); if (verify) { await verifySnapshot(verify.dataset.examAdminVerifySnapshot, verify); return; }
      const preflight = event.target.closest('[data-exam-admin-preflight]'); if (preflight) { await runPreflight(preflight); return; }
      if (event.target.closest('[data-exam-admin-refresh]')) { await refreshIntoRoot('Examination Room command center refreshed.'); return; }
      const retry = event.target.closest('[data-exam-admin-retry]'); if (retry) await retryAction(retry.dataset.examAdminRetry, retry);
    });
  }

  global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });
})(window);
