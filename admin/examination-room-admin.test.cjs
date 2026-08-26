'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('./examination-room-admin.js'), 'utf8');
const css = readFileSync(require.resolve('./examination-room-admin.css'), 'utf8');

test('owner command center registers without touching the surrounding Admin runtime', () => {
  const window = { ExaminationRoomV1Api: {} };
  vm.runInNewContext(source, {
    window,
    URLSearchParams,
    Intl,
    Date,
    Map,
    Set,
  });
  assert.equal(typeof window.DueDiligenceExaminationRoomAdmin?.render, 'function');
  assert.equal(typeof window.DueDiligenceExaminationRoomAdmin?.bind, 'function');
});

test('owner command center exposes all eight required no-code views', () => {
  for (const label of [
    'Overview',
    'Creator Directory',
    'Examinations',
    'Questions',
    'Students & Answers',
    'Grades & Results',
    'Keys & Email',
    'Recovery & Audit',
  ]) assert.match(source, new RegExp(label.replace(/[&]/g, '\\&')));
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(css, /\.exam-admin-tabs/);
});

test('published creator key requests are isolated in a one-click Admin queue', () => {
  const window = { ExaminationRoomV1Api: {} };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomKeyQueueTest = Object.freeze({ state, canApprove, pendingKeyRequests, renderOverview }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set });
  const harness = window.__ExaminationRoomKeyQueueTest;
  harness.state.data = {
    counts: { exams: 4 },
    exams: [
      { id: 'exam-published', title: 'Published request', publicationStatus: 'published', publishedAt: '2026-08-27T08:00:00.000Z' },
      { id: 'exam-requested', title: 'Explicit key request', publicationStatus: 'key_requested', keyRequestedAt: '2026-08-27T09:00:00.000Z' },
      { id: 'exam-active', title: 'Already active', publicationStatus: 'published', activation: { status: 'active' } },
      { id: 'exam-draft', title: 'Saved draft', publicationStatus: 'draft' },
    ],
  };

  assert.deepEqual(
    Array.from(harness.pendingKeyRequests(), (exam) => exam.id),
    ['exam-requested', 'exam-published'],
  );
  assert.equal(harness.canApprove(harness.state.data.exams[2]), false);
  const html = harness.renderOverview();
  assert.match(html, /Key requests waiting for approval/);
  assert.match(html, /Any signed-in account can build and request a key/);
  assert.match(html, /Approve & generate key/);
  assert.match(html, /no creator key entry/i);
});

test('owner command center uses only the greenfield Admin transport for privileged operations', () => {
  for (const operation of [
    'command_center',
    'preflight',
    'exam_detail',
    'audit_log',
    'recovery_detail',
    'approve_and_email_key',
    'reveal_key',
    'retry_snapshot',
    'restore_snapshot',
    'correct_student_identity',
    'set_submission_status',
    'room_control',
  ]) assert.match(source, new RegExp(`['\"]${operation}['\"]`));
  assert.match(source, /api\.adminQuery\(/);
  assert.match(source, /api\.adminCommand\(/);
  assert.doesNotMatch(source, /\/examinations\//);
});

test('owner controls include exact keys, email, exports, search, and complete recovery operations', () => {
  assert.match(source, /const professor = staff\.find/);
  assert.match(source, /professorEmail: exam\.professorEmail \|\| exam\.ownerEmail \|\| professor\?\.email/);
  assert.match(source, /Retrieve exact key/);
  assert.match(source, /Copy exact key/);
  assert.match(source, /Rotate & email/);
  assert.match(source, /Resend current key/);
  assert.match(source, /deliveryRecovery/);
  assert.match(source, /Approve & generate key/);
  assert.match(source, /data-exam-admin-export="json"/);
  assert.match(source, /data-exam-admin-export="csv"/);
  assert.match(source, /data-exam-admin-search/);
  assert.match(source, /Create full snapshot/);
  assert.match(source, />Download</);
  assert.match(source, />Verify</);
  assert.match(source, />Recover copy</);
  assert.match(source, /live examination rows were not changed/i);
  assert.match(source, /error\.recovery/);
});

test('owner database bundles are normalized into complete no-code views', () => {
  assert.match(source, /function normalizeOwnerDetail\(value\)/);
  for (const table of [
    'studentIdentities', 'examRoster', 'studentSessions', 'submissions',
    'submissionReceipts', 'answerRevisions', 'submissionAnswers', 'gradeRevisions',
    'gradeRevisionItems', 'resultReleases', 'ownerKeyEnvelopes',
    'emailDeliveryEvents', 'recoverySnapshots', 'auditEvents',
  ]) assert.match(source, new RegExp(`tables\\.${table}`));
  assert.match(source, /normalized\.items/);
  assert.match(source, /camelKey/);
});

test('owner no-code controls validate, confirm, retain idempotency on retry, and explain recovery', () => {
  assert.match(source, /data-exam-admin-owner-control="correct_student_identity"/);
  assert.match(source, /data-exam-admin-owner-control="set_submission_status"/);
  assert.match(source, /data-exam-admin-owner-control="room_control"/);
  assert.match(source, /Save identity correction/);
  assert.match(source, /name="clearEmail" type="checkbox"/);
  assert.match(source, /Remove the stored student email/);
  assert.match(source, /clearEmail: true/);
  assert.match(source, /Update submission status/);
  assert.match(source, /Apply room control/);
  assert.match(source, /global\.confirm\(ownerControlConfirmation/);
  assert.match(source, /form\.dataset\.examAdminOwnerRequestKey \|\| api\.requestId\(\)/);
  assert.match(source, /api\.adminCommand\(command\.operation/);
  assert.match(source, /Nothing was discarded\. Check the connection and submit the unchanged form again\./);
  assert.match(source, /resetOwnerControlReceipt/);
  assert.match(css, /\.exam-admin-owner-control-form/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(source, /Approve Professor|Professor approved|Verified sign-in email|Waiting for owner approval/);
  assert.match(source, /Any signed-in account can enter the Professor card/);
  assert.match(source, /never grants or blocks creator access/);
});

test('owner system check renders four plain-language statuses and every exact recovery without exposing returned configuration values', async () => {
  const recoveries = {
    owner_data_key: 'Add the owner encryption key in the protected Worker settings, then run this check again.',
    owner_email_recipients: 'Add a valid platform-owner email address, then run this check again.',
    key_email_delivery: 'Connect the Examination Room sender and email provider, then run this check again.',
    encrypted_recovery: 'Connect the private recovery bucket and backup key, then run this check again.',
  };
  const operations = [];
  const window = {
    ExaminationRoomV1Api: {
      async adminQuery(operation) {
        operations.push(operation);
        if (operation === 'access') return { institutions: [{ institutionId: 'institution-1', institutionName: 'Test Law School' }] };
        if (operation === 'command_center') return { exams: [], counts: {} };
        if (operation === 'staff_directory') return { staff: [] };
        if (operation === 'preflight') return {
          ready: false,
          checkedAt: '2026-08-27T08:00:00.000Z',
          recipients: ['private-owner@example.com'],
          checks: Object.entries(recoveries).map(([id, recovery]) => ({
            id, ok: false, status: 'not_configured', message: `${id} needs attention.`, recovery,
            recipients: ['private-owner@example.com'], binding: 'PRIVATE_R2_BINDING', keyVersion: 'PRIVATE_KEY_VERSION',
          })),
        };
      },
      async authSession() { return { user: { id: 'owner-1' } }; },
      demoEnabled: () => false,
    },
  };
  vm.runInNewContext(source, { window, URLSearchParams, Intl, Date, Map, Set, Promise });
  const html = await window.DueDiligenceExaminationRoomAdmin.render();

  assert.match(html, /Examination Room system check/);
  assert.match(html, /Room-key protection/);
  assert.match(html, /Owner email copies/);
  assert.match(html, /Email delivery/);
  assert.match(html, /Encrypted recovery/);
  assert.match(html, /data-exam-admin-preflight/);
  for (const recovery of Object.values(recoveries)) assert.match(html, new RegExp(recovery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /private-owner@example\.com|PRIVATE_R2_BINDING|PRIVATE_KEY_VERSION/);
  assert.deepEqual([...new Set(operations)].sort(), ['access', 'command_center', 'preflight', 'staff_directory']);
  assert.match(css, /\.exam-admin-preflight-grid/);
});

test('owner can rerun the protected system check without reloading the command center', async () => {
  let calls = 0;
  const toasts = [];
  const window = {
    ExaminationRoomV1Api: {
      async adminQuery(operation) {
        assert.equal(operation, 'preflight');
        calls += 1;
        return {
          ready: calls > 1,
          checkedAt: '2026-08-27T08:00:00.000Z',
          checks: ['owner_data_key', 'owner_email_recipients', 'key_email_delivery', 'encrypted_recovery']
            .map((id) => ({ id, ok: calls > 1, status: calls > 1 ? 'ready' : 'not_configured', message: 'Check result.', recovery: 'Complete setup, then run again.' })),
        };
      },
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomPreflightTest = Object.freeze({ state, requestPreflight, runPreflight, renderPreflightPanel }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set, Promise });
  const harness = window.__ExaminationRoomPreflightTest;
  harness.state.toast = (message) => toasts.push(message);
  await harness.requestPreflight();
  assert.equal(harness.state.preflight.ready, false);
  await harness.runPreflight();
  assert.equal(harness.state.preflight.ready, true);
  assert.equal(calls, 2);
  assert.match(toasts.at(-1), /passed for this environment/i);
  assert.match(harness.renderPreflightPanel(), /Ready to operate/);
});

test('audit trail loads and exports every record beyond the former 500-row boundary', async () => {
  const records = Array.from({ length: 1_201 }, (_, index) => ({
    id: `audit-${String(index + 1).padStart(4, '0')}`,
    event_type: 'owner.test_event',
    occurred_at: new Date(Date.UTC(2026, 7, 26, 12, 0, 0) - index * 1_000).toISOString(),
  }));
  const offsets = [];
  const window = {
    ExaminationRoomV1Api: {
      async adminQuery(operation, payload) {
        assert.equal(operation, 'audit_log');
        offsets.push(payload.offset);
        const items = records.slice(payload.offset, payload.offset + payload.limit);
        const nextOffset = payload.offset + items.length;
        return {
          ok: true,
          items,
          limit: payload.limit,
          offset: payload.offset,
          total: records.length,
          hasMore: nextOffset < records.length,
          nextOffset: nextOffset < records.length ? nextOffset : null,
        };
      },
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomAuditTest = Object.freeze({ state, ensureAudit, loadAllAudit, auditRows, exportPayload, csvRows, csvText }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set });
  const harness = window.__ExaminationRoomAuditTest;
  harness.state.institutionId = 'institution-1';
  harness.state.selectedExamId = 'exam-1';
  harness.state.tab = 'recovery_audit';
  harness.state.data = { exams: [{ id: 'exam-1', title: 'Audit scale test' }] };

  const firstPage = await harness.ensureAudit(true);
  assert.equal(firstPage.loaded, 250);
  assert.equal(firstPage.total, 1_201);
  assert.equal(firstPage.fullyLoaded, false);
  const complete = await harness.loadAllAudit();
  assert.equal(complete.loaded, 1_201);
  assert.equal(complete.fullyLoaded, true);
  assert.equal(harness.auditRows().length, 1_201);
  assert.equal(harness.exportPayload().audit.length, 1_201);
  const auditOnlyRows = harness.csvRows(harness.exportPayload());
  assert.equal(auditOnlyRows.length, 1_201);
  assert.equal(auditOnlyRows[0].exportRecordType, 'audit_event');
  assert.match(harness.csvText(harness.exportPayload()), /"audit_event"/u);
  const mixedRows = harness.csvRows({ snapshots: [{ id: 'snapshot-1' }], audit: [{ id: 'audit-1' }] });
  assert.deepEqual(
    JSON.parse(JSON.stringify(mixedRows)),
    [
      { id: 'snapshot-1', exportRecordType: 'recovery_snapshot' },
      { id: 'audit-1', exportRecordType: 'audit_event' },
    ],
  );
  assert.deepEqual(offsets, [0, 250, 500, 750, 1_000]);
  assert.match(source, /const auditTitle = progress\.fullyLoaded \? 'Complete audit trail' : 'Audit trail'/);
  assert.match(source, /auditProgress\(\)\.fullyLoaded \? Promise\.resolve\(\) : loadAllAudit\(\)/);
});

test('owner can reach every examination and recovery checkpoint beyond the 100-row overview caps', async () => {
  const exams = Array.from({ length: 251 }, (_, index) => ({
    exam_id: `exam-${String(index + 1).padStart(4, '0')}`,
    title: `Examination ${index + 1}`,
    updated_at: new Date(Date.UTC(2026, 7, 26, 12, 0, 0) - index * 1_000).toISOString(),
  }));
  const snapshots = Array.from({ length: 305 }, (_, index) => ({
    id: `snapshot-${String(index + 1).padStart(4, '0')}`,
    exam_id: 'exam-0001',
    snapshot_sequence: 305 - index,
  }));
  const examOffsets = [];
  const snapshotOffsets = [];
  const commandCenterPage = (payload) => {
    examOffsets.push(payload.offset);
    const page = exams.slice(payload.offset, payload.offset + payload.limit);
    const nextOffset = payload.offset + page.length;
    return {
      ok: true,
      exams: page,
      counts: { exams: exams.length },
      examTotal: exams.length,
      examLimit: payload.limit,
      examOffset: payload.offset,
      examHasMore: nextOffset < exams.length,
      examNextOffset: nextOffset < exams.length ? nextOffset : null,
    };
  };
  const window = {
    ExaminationRoomV1Api: {
      async adminQuery(operation, payload) {
        if (operation === 'command_center') return commandCenterPage(payload);
        assert.equal(operation, 'recovery_detail');
        snapshotOffsets.push(payload.offset);
        const page = snapshots.slice(payload.offset, payload.offset + payload.limit);
        const nextOffset = payload.offset + page.length;
        return {
          ok: true,
          snapshots: page,
          limit: payload.limit,
          offset: payload.offset,
          total: snapshots.length,
          hasMore: nextOffset < snapshots.length,
          nextOffset: nextOffset < snapshots.length ? nextOffset : null,
        };
      },
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomPagingTest = Object.freeze({ state, normalizeCenter, examPageProgress, loadAllExams, ensureRecovery, loadAllRecovery, snapshotRows, exportPayload }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set });
  const harness = window.__ExaminationRoomPagingTest;
  harness.state.institutionId = 'institution-1';
  harness.state.selectedExamId = 'exam-0001';
  harness.state.access = { institutions: [{ institutionId: 'institution-1', examCount: exams.length }] };
  const firstCenterPage = commandCenterPage({ limit: 100, offset: 0 });
  harness.state.data = harness.normalizeCenter(firstCenterPage, {}, harness.state.access);
  harness.state.examPaging = harness.examPageProgress(firstCenterPage, harness.state.data.exams, 0, harness.state.data.exams.length);

  const completeExams = await harness.loadAllExams();
  assert.equal(completeExams.loaded, 251);
  assert.equal(completeExams.fullyLoaded, true);
  harness.state.tab = 'examinations';
  assert.equal(harness.exportPayload().exams.length, 251);
  assert.deepEqual(examOffsets, [0, 100, 200]);

  const firstRecoveryPage = await harness.ensureRecovery(true);
  assert.equal(firstRecoveryPage.loaded, 100);
  const completeRecovery = await harness.loadAllRecovery();
  assert.equal(completeRecovery.loaded, 305);
  assert.equal(completeRecovery.fullyLoaded, true);
  harness.state.tab = 'recovery_audit';
  assert.equal(harness.snapshotRows().length, 305);
  assert.equal(harness.exportPayload().snapshots.length, 305);
  assert.deepEqual(snapshotOffsets, [0, 100, 200, 300]);
  assert.match(source, /data-exam-admin-load-exams="all"/);
  assert.match(source, /data-exam-admin-load-recovery="all"/);
});

test('owner mutation retry reuses every receipt key after a lost response', async () => {
  let counter = 0;
  const seen = [];
  let activateAttempts = 0;
  let snapshotAttempts = 0;
  const window = {
    confirm: () => true,
    ExaminationRoomV1Api: {
      requestId: () => `request-${++counter}`,
      demoEnabled: () => true,
      async adminCommand(operation, payload, requestKey) {
        seen.push({ operation, requestKey });
        if (operation === 'approve_and_email_key') throw Object.assign(new Error('Unsupported'), { code: 'UNSUPPORTED_OPERATION' });
        if (operation === 'activate_exam' && ++activateAttempts === 1) throw new Error('Connection lost after commit');
        if (operation === 'email_key') return { ok: true, deliveryStatus: 'sent' };
        if (operation === 'create_snapshot' && ++snapshotAttempts === 1) throw new Error('Connection lost after commit');
        return { ok: true };
      },
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomRetryTest = Object.freeze({ state, runAction }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set });
  const harness = window.__ExaminationRoomRetryTest;
  harness.state.institutionId = 'institution-1';

  await harness.runAction('approve_and_email_key', { examId: 'exam-1' }, null);
  await harness.runAction('approve_and_email_key', { examId: 'exam-1' }, null);
  const activateKeys = seen.filter((entry) => entry.operation === 'activate_exam').map((entry) => entry.requestKey);
  assert.deepEqual(activateKeys, ['request-2', 'request-2']);
  assert.equal(seen.find((entry) => entry.operation === 'email_key').requestKey, 'request-3');

  await harness.runAction('create_snapshot', { examId: 'exam-1' }, null);
  await harness.runAction('create_snapshot', { examId: 'exam-1' }, null);
  const snapshotKeys = seen.filter((entry) => entry.operation === 'create_snapshot').map((entry) => entry.requestKey);
  assert.equal(snapshotKeys.length, 2);
  assert.equal(snapshotKeys[0], snapshotKeys[1]);
  assert.equal(harness.state.actionRequests.size, 0);
});

test('pending approval reuses every scoped receipt after a page refresh and clears only after success', async () => {
  const records = new Map();
  const sessionStorage = {
    getItem(key) { return records.has(key) ? records.get(key) : null; },
    setItem(key, value) { records.set(key, String(value)); },
    removeItem(key) { records.delete(key); },
  };
  let requestCounter = 0;
  let activationAttempts = 0;
  const seen = [];
  const api = {
    requestId: () => `approval-request-${++requestCounter}`,
    demoEnabled: () => true,
    async adminCommand(operation, payload, requestKey) {
      assert.equal(payload.institutionId, 'institution-1');
      seen.push({ operation, requestKey });
      if (operation === 'approve_and_email_key') throw Object.assign(new Error('Unsupported'), { code: 'UNSUPPORTED_OPERATION' });
      if (operation === 'activate_exam') {
        activationAttempts += 1;
        if (activationAttempts === 1) throw new Error('Connection lost after the approval may have committed');
        return { ok: true };
      }
      assert.equal(operation, 'email_key');
      return { ok: true, roomKey: 'APPROVED-ROOM-KEY', deliveryStatus: 'sent' };
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomApprovalRefreshTest = Object.freeze({ state, runAction }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  const openPage = () => {
    const window = { ExaminationRoomV1Api: api, sessionStorage, confirm: () => true };
    vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set, Promise, JSON, encodeURIComponent });
    const harness = window.__ExaminationRoomApprovalRefreshTest;
    harness.state.ownerUserId = 'owner-1';
    harness.state.institutionId = 'institution-1';
    return harness;
  };

  const firstPage = openPage();
  await firstPage.runAction('approve_and_email_key', { examId: 'exam-1' }, null);
  assert.equal(records.size, 1);
  const pending = JSON.parse([...records.values()][0]);
  assert.equal(pending.version, 2);
  assert.equal(pending.operation, 'approve_and_email_key');
  assert.deepEqual(Object.keys(pending.requestKeys).sort(), ['activate', 'email', 'fallback', 'primary']);
  assert.equal(Object.prototype.hasOwnProperty.call(pending, 'roomKey'), false);

  const refreshedPage = openPage();
  await refreshedPage.runAction('approve_and_email_key', { examId: 'exam-1' }, null);
  assert.deepEqual(seen.filter((entry) => entry.operation === 'approve_and_email_key').map((entry) => entry.requestKey), [pending.requestKeys.primary, pending.requestKeys.primary]);
  assert.deepEqual(seen.filter((entry) => entry.operation === 'activate_exam').map((entry) => entry.requestKey), [pending.requestKeys.activate, pending.requestKeys.activate]);
  assert.deepEqual(seen.filter((entry) => entry.operation === 'email_key').map((entry) => entry.requestKey), [pending.requestKeys.email]);
  assert.equal(records.size, 0);
  assert.equal(refreshedPage.state.actionRequests.size, 0);
});

test('pending resend-key email reuses its scoped receipt after a page refresh and clears only after success', async () => {
  const records = new Map();
  const sessionStorage = {
    getItem(key) { return records.has(key) ? records.get(key) : null; },
    setItem(key, value) { records.set(key, String(value)); },
    removeItem(key) { records.delete(key); },
  };
  let requestCounter = 0;
  let attempts = 0;
  const seenKeys = [];
  const api = {
    requestId: () => `resend-request-${++requestCounter}`,
    demoEnabled: () => false,
    async adminCommand(operation, payload, requestKey) {
      assert.equal(operation, 'resend_key');
      assert.equal(payload.institutionId, 'institution-1');
      seenKeys.push(requestKey);
      attempts += 1;
      if (attempts === 1) throw new Error('Connection lost after the resend may have committed');
      return { ok: true, roomKey: 'CURRENT-ROOM-KEY', deliveryStatus: 'sent' };
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomResendRefreshTest = Object.freeze({ state, runAction }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  const openPage = () => {
    const window = { ExaminationRoomV1Api: api, sessionStorage, confirm: () => true };
    vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set, Promise, JSON, encodeURIComponent });
    const harness = window.__ExaminationRoomResendRefreshTest;
    harness.state.ownerUserId = 'owner-1';
    harness.state.institutionId = 'institution-1';
    return harness;
  };

  const firstPage = openPage();
  await firstPage.runAction('resend_key', { examId: 'exam-1' }, null);
  assert.equal(records.size, 1);
  const pending = JSON.parse([...records.values()][0]);
  assert.equal(pending.operation, 'resend_key');
  assert.equal(pending.requestKeys.primary, seenKeys[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(pending, 'roomKey'), false);

  const refreshedPage = openPage();
  await refreshedPage.runAction('resend_key', { examId: 'exam-1' }, null);
  assert.deepEqual(seenKeys, [pending.requestKeys.primary, pending.requestKeys.primary]);
  assert.equal(records.size, 0);
  assert.equal(refreshedPage.state.actionRequests.size, 0);
});

test('email provider failure keeps the exact key usable and gives Admin a one-click resend recovery', async () => {
  let requestCounter = 0;
  const operations = [];
  const window = {
    confirm: () => true,
    ExaminationRoomV1Api: {
      requestId: () => `delivery-request-${++requestCounter}`,
      demoEnabled: () => false,
      async adminCommand(operation, payload, requestKey) {
        operations.push({ operation, payload, requestKey });
        if (operation === 'approve_and_email_key') {
          return {
            ok: true,
            roomKey: 'ER1-ABCD-EFGH-9',
            deliveryStatus: 'failed',
            deliverySafeErrorCode: 'provider_503',
            deliveryRecovery: 'Provider unavailable. Retry the current key.',
            recipient: 'creator@example.edu.ph',
            adminRecipients: ['owner@duediligence.ph'],
          };
        }
        assert.equal(operation, 'resend_key');
        return {
          ok: true,
          roomKey: 'ER1-ABCD-EFGH-9',
          deliveryStatus: 'sent',
          recipient: 'creator@example.edu.ph',
          adminRecipients: ['owner@duediligence.ph'],
        };
      },
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomDeliveryTest = Object.freeze({ state, runAction, renderKeysEmail }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set, Promise });
  const harness = window.__ExaminationRoomDeliveryTest;
  harness.state.institutionId = 'institution-1';
  harness.state.selectedExamId = 'exam-1';
  harness.state.data = { exams: [{ id: 'exam-1', title: 'Provider recovery exam', publicationStatus: 'published' }] };
  harness.state.details.set('exam-1', { keys: [{ id: 'activation-1', status: 'scheduled' }] });

  await harness.runAction('approve_and_email_key', { examId: 'exam-1' }, null);
  assert.equal(harness.state.currentKeys.get('exam-1'), 'ER1-ABCD-EFGH-9');
  const failedHtml = harness.renderKeysEmail();
  assert.match(failedHtml, /Key active; email needs attention/);
  assert.match(failedHtml, /creator already has automatic Monitoring and Grading access/i);
  assert.match(failedHtml, /Retry email/);
  assert.match(failedHtml, /key itself must not be rotated/i);

  await harness.runAction('resend_key', { examId: 'exam-1' }, null);
  assert.equal(harness.state.currentKeys.get('exam-1'), 'ER1-ABCD-EFGH-9');
  assert.equal(harness.state.deliveries.get('exam-1').status, 'sent');
  assert.doesNotMatch(harness.renderKeysEmail(), /Key active; email needs attention/);
  harness.state.deliveries.set('exam-1', { status: 'demo_delivered' });
  assert.doesNotMatch(harness.renderKeysEmail(), /Key active; email needs attention/);
  assert.deepEqual(operations.map((entry) => entry.operation), ['approve_and_email_key', 'resend_key']);
  assert.notEqual(operations[0].requestKey, operations[1].requestKey);
});

test('pending owner key rotation reuses the same scoped receipt after a page refresh and clears it only after success', async () => {
  const records = new Map();
  const sessionStorage = {
    getItem(key) { return records.has(key) ? records.get(key) : null; },
    setItem(key, value) { records.set(key, String(value)); },
    removeItem(key) { records.delete(key); },
  };
  let requestCounter = 0;
  let attempts = 0;
  const seenKeys = [];
  const api = {
    requestId: () => `rotation-request-${++requestCounter}`,
    demoEnabled: () => false,
    async adminCommand(operation, payload, requestKey) {
      assert.equal(operation, 'email_key');
      assert.equal(payload.institutionId, 'institution-1');
      seenKeys.push(requestKey);
      attempts += 1;
      if (attempts === 1) throw new Error('Connection lost after the server may have committed');
      return { ok: true, roomKey: 'NEW-ROOM-KEY', deliveryStatus: 'sent' };
    },
  };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomRotationTest = Object.freeze({ state, runAction }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  const openPage = () => {
    const window = { ExaminationRoomV1Api: api, sessionStorage, confirm: () => true };
    vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set, Promise, JSON, encodeURIComponent });
    const harness = window.__ExaminationRoomRotationTest;
    harness.state.ownerUserId = 'owner-1';
    harness.state.institutionId = 'institution-1';
    return harness;
  };

  const firstPage = openPage();
  await firstPage.runAction('rotate_key', { examId: 'exam-1' }, null);
  assert.equal(records.size, 1);
  const pending = JSON.parse([...records.values()][0]);
  assert.equal(pending.ownerUserId, 'owner-1');
  assert.equal(pending.institutionId, 'institution-1');
  assert.equal(pending.examId, 'exam-1');
  assert.equal(pending.requestKey, seenKeys[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(pending, 'roomKey'), false);

  const refreshedPage = openPage();
  await refreshedPage.runAction('rotate_key', { examId: 'exam-1' }, null);
  assert.deepEqual(seenKeys, [pending.requestKey, pending.requestKey]);
  assert.equal(records.size, 0);
  assert.equal(refreshedPage.state.actionRequests.size, 0);
});

test('owner bundle normalizer derives release, verification, and roster academic facts', () => {
  const window = { ExaminationRoomV1Api: {} };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomAdminTest = Object.freeze({ normalizeOwnerDetail, snapshotVerified, studentAcademicFacts, sessions, submissions, answers, grades }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set });
  const normalized = window.__ExaminationRoomAdminTest.normalizeOwnerDetail({
    bundle: {
      currentPublishedVersionId: 'version-1',
      tables: {
        exams: [{ id: 'exam-1', subject: 'Fallback subject' }],
        examVersions: [{ id: 'version-1' }],
        questions: [],
        studentIdentities: [{ id: 'identity-1', full_name: 'Maria Santos', external_student_id: '2026-001' }],
        examRoster: [{ id: 'roster-1', student_identity_id: 'identity-1', accommodations: { year_level: '3L', subject: 'Civil Law' } }],
        studentSessions: [{ id: 'session-1', roster_id: 'roster-1' }],
        submissions: [{ id: 'submission-1', session_id: 'session-1' }],
        submissionReceipts: [{ id: 'receipt-1', submission_id: 'submission-1', receipt_code: 'DD26-RECEIPT-001' }],
        answerRevisions: [],
        submissionAnswers: [],
        gradeRevisions: [
          { id: 'grade-1', submission_id: 'submission-1' },
          { id: 'grade-2', submission_id: 'submission-1' },
        ],
        gradeRevisionItems: [],
        resultReleases: [
          { id: 'release-1', grade_revision_id: 'grade-1', release_action: 'release', occurred_at: '2026-08-26T08:00:00.000Z' },
          { id: 'revoke-1', release_action: 'revoke', supersedes_release_id: 'release-1', occurred_at: '2026-08-26T08:30:00.000Z' },
          { id: 'release-2', grade_revision_id: 'grade-2', release_action: 'release', occurred_at: '2026-08-26T09:00:00.000Z' },
        ],
        roomActivations: [],
        ownerKeyEnvelopes: [],
        emailDeliveryEvents: [],
        recoverySnapshots: [{ id: 'snapshot-1', verified_at: '2026-08-26T09:05:00.000Z' }],
        auditEvents: [],
      },
    },
  });

  assert.equal(normalized.grades.find((grade) => grade.id === 'grade-1').released, false);
  assert.equal(normalized.grades.find((grade) => grade.id === 'grade-2').released, true);
  assert.equal(normalized.grades.find((grade) => grade.id === 'grade-2').releasedAt, '2026-08-26T09:00:00.000Z');
  assert.equal(normalized.snapshots[0].verified, true);
  assert.equal(normalized.submissions[0].receiptCode, 'DD26-RECEIPT-001');
  assert.equal(normalized.submissions[0].receipt.id, 'receipt-1');
  assert.equal(normalized.submissionReceipts[0].submissionId, 'submission-1');
  assert.equal(window.__ExaminationRoomAdminTest.snapshotVerified(normalized.snapshots[0]), true);
  const academic = window.__ExaminationRoomAdminTest.studentAcademicFacts(
    normalized.students[0].identity,
    normalized.students[0],
    'Fallback subject',
  );
  assert.equal(academic.yearLevel, '3L');
  assert.equal(academic.subject, 'Civil Law');

  const fallback = {
    exam: { roster: [{ id: 'student-1', fullName: 'Fallback Student', studentNumber: '2026-777' }] },
    monitor: {
      sessions: [{ id: 'session-1', studentId: 'student-1', studentNumber: '2026-777' }],
      submissions: [{ id: 'submission-1', sessionId: 'session-1', status: 'accepted' }],
    },
    grading: {
      answerRevisions: [{ id: 'answer-1', sessionId: 'session-1' }],
      gradeRevisions: [{ id: 'grade-fallback', sessionId: 'session-1', submissionId: 'submission-1' }],
      releases: [{ id: 'release-fallback', sessionIds: ['session-1'], at: '2026-08-26T10:00:00.000Z' }],
    },
  };
  assert.equal(window.__ExaminationRoomAdminTest.sessions(fallback).length, 1);
  assert.equal(window.__ExaminationRoomAdminTest.submissions(fallback).length, 1);
  assert.equal(window.__ExaminationRoomAdminTest.answers(fallback).length, 1);
  const fallbackGrade = window.__ExaminationRoomAdminTest.grades(fallback)[0];
  assert.equal(fallbackGrade.fullName, 'Fallback Student');
  assert.equal(fallbackGrade.released, true);
});

test('flat question grade revisions render one released student result without changing aggregate grade payloads', () => {
  const window = { ExaminationRoomV1Api: {} };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomGradeAggregationTest = Object.freeze({ state, grades, renderGradesResults }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, { window, URLSearchParams, Intl, Date, Map, Set });
  const harness = window.__ExaminationRoomGradeAggregationTest;
  const flatDetail = {
    questions: [
      { id: 'q-1', number: 1, points: 25 },
      { id: 'q-2', number: 2, points: 25 },
      { id: 'q-3', number: 3, points: 25 },
      { id: 'q-4', number: 4, points: 25 },
    ],
    sessions: [{ id: 'session-1', fullName: 'Maria Santos', studentNumber: '2026-001' }],
    submissions: [{ id: 'submission-1', sessionId: 'session-1', submittedAt: '2026-08-27T08:00:00.000Z' }],
    gradeRevisions: [
      { id: 'grade-q1', sessionId: 'session-1', questionId: 'q-1', revision: 1, points: 25, feedback: 'Complete issue identification.', at: '2026-08-27T09:01:00.000Z' },
      { id: 'grade-q2', sessionId: 'session-1', questionId: 'q-2', revision: 1, points: 20, feedback: 'Sound rule statement.', at: '2026-08-27T09:02:00.000Z' },
      { id: 'grade-q3', sessionId: 'session-1', questionId: 'q-3', revision: 1, points: 20, feedback: 'Application needs one more authority.', at: '2026-08-27T09:03:00.000Z' },
      { id: 'grade-q4', sessionId: 'session-1', questionId: 'q-4', revision: 1, points: 25, feedback: 'Clear and well-supported conclusion.', at: '2026-08-27T09:04:00.000Z' },
    ],
    releases: [{ id: 'release-1', sessionIds: ['session-1'], at: '2026-08-27T10:00:00.000Z' }],
  };

  const results = harness.grades(flatDetail);
  assert.equal(results.length, 1);
  assert.equal(results[0].fullName, 'Maria Santos');
  assert.equal(results[0].studentNumber, '2026-001');
  assert.equal(results[0].submissionId, 'submission-1');
  assert.equal(results[0].totalScore, 90);
  assert.equal(results[0].maximumScore, 100);
  assert.equal(results[0].items.length, 4);
  assert.deepEqual(Array.from(results[0].items, (item) => item.feedback), [
    'Complete issue identification.',
    'Sound rule statement.',
    'Application needs one more authority.',
    'Clear and well-supported conclusion.',
  ]);
  assert.equal(results[0].released, true);

  harness.state.selectedExamId = 'exam-1';
  harness.state.data = { exams: [{ id: 'exam-1', title: 'Civil Law Final', subject: 'Civil Law' }] };
  harness.state.details.set('exam-1', flatDetail);
  const html = harness.renderGradesResults();
  assert.equal((html.match(/<tbody><tr /g) || []).length, 1);
  assert.match(html, /Maria Santos/);
  assert.match(html, /90 \/ 100/);
  assert.match(html, /Question 1: <strong>25<\/strong> · Complete issue identification\./);
  assert.match(html, /Question 2: <strong>20<\/strong> · Sound rule statement\./);
  assert.match(html, /Question 3: <strong>20<\/strong> · Application needs one more authority\./);
  assert.match(html, /Question 4: <strong>25<\/strong> · Clear and well-supported conclusion\./);
  assert.match(html, /exam-admin-status released/);
  assert.doesNotMatch(html, /exam-admin-status not_released/);

  const aggregatePayload = {
    grades: [{
      id: 'aggregate-grade-1',
      sessionId: 'session-2',
      submissionId: 'submission-2',
      fullName: 'Existing Aggregate Student',
      studentNumber: '2026-002',
      totalScore: 88,
      maximumScore: 100,
      gradeStatus: 'final',
      generalFeedback: 'Existing aggregate feedback.',
      items: [{ questionNumber: 1, pointsAwarded: 22, maximumPoints: 25, feedback: 'Existing item feedback.' }],
    }],
    releases: [{ id: 'aggregate-release-1', gradeRevisionId: 'aggregate-grade-1', releaseAction: 'release', occurredAt: '2026-08-27T11:00:00.000Z' }],
  };
  const aggregateResults = harness.grades(aggregatePayload);
  assert.equal(aggregateResults.length, 1);
  assert.equal(aggregateResults[0].id, 'aggregate-grade-1');
  assert.equal(aggregateResults[0].totalScore, 88);
  assert.equal(aggregateResults[0].maximumScore, 100);
  assert.equal(aggregateResults[0].generalFeedback, 'Existing aggregate feedback.');
  assert.equal(aggregateResults[0].items.length, 1);
  assert.equal(aggregateResults[0].items[0].feedback, 'Existing item feedback.');
  assert.equal(aggregateResults[0].released, true);
});

test('owner identity correction uses an explicit remove-email flag while blank keeps the stored value', () => {
  class TestFormData {
    constructor(form) { this.values = form.values; }
    get(name) { return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name] : null; }
  }
  const window = { ExaminationRoomV1Api: {} };
  const instrumented = source.replace(
    'global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
    'global.__ExaminationRoomAdminTest = Object.freeze({ ownerControlPayload, ownerControlConfirmation }); global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });',
  );
  vm.runInNewContext(instrumented, {
    window, URLSearchParams, Intl, Date, Map, Set, FormData: TestFormData,
  });
  const common = {
    examId: 'exam-1',
    studentIdentityId: 'identity-1',
    fullName: 'Maria Santos',
    studentNumber: '2026-001',
    reason: 'Checked against the registrar record.',
  };
  const keep = window.__ExaminationRoomAdminTest.ownerControlPayload({
    dataset: { examAdminOwnerControl: 'correct_student_identity' },
    values: { ...common, email: '', clearEmail: null },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(keep.payload, 'email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(keep.payload, 'clearEmail'), false);

  const clear = window.__ExaminationRoomAdminTest.ownerControlPayload({
    dataset: { examAdminOwnerControl: 'correct_student_identity' },
    values: { ...common, email: 'wrong@example.edu.ph', clearEmail: 'on' },
  });
  assert.equal(clear.payload.clearEmail, true);
  assert.equal(Object.prototype.hasOwnProperty.call(clear.payload, 'email'), false);
  assert.match(window.__ExaminationRoomAdminTest.ownerControlConfirmation(clear.operation, clear.payload), /stored student email will be removed/i);
});
