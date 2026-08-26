import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXAMINATION_ROOM_EMAIL_ASSETS,
  buildExaminationRoomKeyEmail,
  buildExaminationRoomPublicationRequestEmail,
  buildExaminationRoomResultEmail,
  deliverExaminationRoomPublicationRequestEmail,
  deliverExaminationRoomResultReleaseEmails,
  escapeExaminationRoomEmailHtml,
  examinationRoomEmailBrand,
} from './examination-room-email.mjs';

test('key email uses the official Due Diligence logo and secure production links', () => {
  const brand = examinationRoomEmailBrand({ ALLOWED_ORIGIN: 'https://duediligence.ph' });
  assert.equal(brand.logoUrl, 'https://duediligence.ph/assets/brand/logo1-master.png');
  assert.equal(brand.workspaceUrl, 'https://duediligence.ph/examination-room/#monitor');
  assert.equal(brand.adminUrl, 'https://duediligence.ph/admin/#examination_room_v1');
  assert.equal(EXAMINATION_ROOM_EMAIL_ASSETS.logoPath, '/assets/brand/logo1-master.png');

  const fallback = examinationRoomEmailBrand({
    EXAMINATION_ROOM_PUBLIC_ORIGIN: 'javascript:alert(1)',
    ALLOWED_ORIGIN: 'http://untrusted.example',
  });
  assert.equal(fallback.logoUrl, 'https://duediligence.ph/assets/brand/logo1-master.png');
});

test('key email escapes every creator-controlled HTML value while retaining exact plain text', () => {
  const email = buildExaminationRoomKeyEmail({}, {
    creatorName: 'Atty. <img src=x onerror=alert(1)> & Co.',
    examTitle: 'Obligations </h1><script>alert("x")</script>',
    roomKey: 'ER1-ABCD-<EFG>-9',
    expiresAt: '<never>',
  });

  assert.doesNotMatch(email.html, /<script>|<img src=x/iu);
  assert.match(email.html, /Atty\. &lt;img src=x onerror=alert\(1\)&gt; &amp; Co\./u);
  assert.match(email.html, /Obligations &lt;\/h1&gt;&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/u);
  assert.match(email.html, /ER1-ABCD-&lt;EFG&gt;-9/u);
  assert.match(email.text, /Atty\. <img src=x onerror=alert\(1\)> & Co\./u);
  assert.equal(escapeExaminationRoomEmailHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#039;');
});

test('key email is responsive, accessible, and explains automatic creator access', () => {
  const email = buildExaminationRoomKeyEmail({}, {
    creatorName: 'Prof. Elena Villanueva',
    examTitle: 'Constitutional Law Midterm',
    roomKey: 'ER1-ABCD-EFGH-9',
    expiresAt: '2099-08-26T08:30:00.000Z',
  });

  assert.match(email.subject, /^Your Examination Room key is ready/u);
  assert.match(email.html, /<html lang="en">/u);
  assert.match(email.html, /name="viewport"/u);
  assert.match(email.html, /@media only screen and \(max-width: 620px\)/u);
  assert.match(email.html, /alt="Due Diligence"/u);
  assert.match(email.html, /role="presentation"/u);
  assert.match(email.html, /'Playfair Display',Cambria,serif/u);
  assert.doesNotMatch(email.html, /Georgia|Courier New/u);
  assert.match(email.html, /Open Monitoring and Grading/u);
  assert.match(email.html, /do not need to enter this key/u);
  assert.match(email.text, /unlocked automatically/u);
  assert.match(email.text, /Anyone with the key may enter unless you selected the email-list entry option/u);
});

test('publication request email is branded, accessible, and escapes examination facts', () => {
  const email = buildExaminationRoomPublicationRequestEmail({}, {
    examId: 'exam-<script>',
    examTitle: 'Remedial Law <img src=x onerror=alert(1)>',
    subject: 'Procedure & Evidence',
    questionCount: 12,
    version: 3,
    publishedAt: '2099-08-26T08:30:00.000Z',
  });

  assert.match(email.subject, /^Key approval requested/u);
  assert.match(email.html, /https:\/\/duediligence\.ph\/assets\/brand\/logo1-master\.png/u);
  assert.match(email.html, /https:\/\/duediligence\.ph\/admin\/#examination_room_v1/u);
  assert.match(email.html, /alt="Due Diligence"/u);
  assert.match(email.html, /role="presentation"/u);
  assert.match(email.html, /@media only screen and \(max-width:620px\)/u);
  assert.doesNotMatch(email.html, /<img src=x|<script>/iu);
  assert.match(email.html, /Procedure &amp; Evidence/u);
  assert.match(email.text, /Approve & generate key once/u);
  assert.match(email.text, /request remains visible in the owner command center/u);
});

test('publication request delivery deduplicates owner recipients, uses BCC, and is retry-idempotent', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: `email-${calls.length}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const environment = {
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_FROM: 'Due Diligence <exams@duediligence.ph>',
    RESEND_API_KEY: 'test-provider-key',
  };
  const message = {
    recipients: ['OWNER@EXAMPLE.COM', 'second@example.com', 'owner@example.com', 'invalid'],
    idempotencyHash: 'a'.repeat(64),
    examId: '44444444-4444-4444-8444-444444444444',
    examTitle: 'Constitutional Law Midterm',
    subject: 'Constitutional Law',
    questionCount: 20,
    version: 1,
    publishedAt: '2099-08-26T08:30:00.000Z',
  };

  const first = await deliverExaminationRoomPublicationRequestEmail(environment, message, transport);
  const retry = await deliverExaminationRoomPublicationRequestEmail(environment, message, transport);
  assert.equal(first.status, 'sent');
  assert.equal(retry.status, 'sent');
  assert.deepEqual(calls[0].body.to, ['owner@example.com']);
  assert.deepEqual(calls[0].body.bcc, ['second@example.com']);
  assert.equal(calls[0].headers['Idempotency-Key'], `exam-room-request-${'a'.repeat(64)}`);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.match(calls[0].body.html, /official|Due Diligence/iu);
});

test('publication request delivery returns recoverable provider and configuration states', async () => {
  const environment = {
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_FROM: 'Due Diligence <exams@duediligence.ph>',
    RESEND_API_KEY: 'test-provider-key',
  };
  const message = { recipients: ['owner@example.com'], idempotencyHash: 'b'.repeat(64) };
  const providerFailure = await deliverExaminationRoomPublicationRequestEmail(
    environment,
    message,
    async () => new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503 }),
  );
  const networkFailure = await deliverExaminationRoomPublicationRequestEmail(
    environment,
    message,
    async () => { throw new TypeError('offline'); },
  );
  const missingOwners = await deliverExaminationRoomPublicationRequestEmail(
    environment,
    { ...message, recipients: [] },
    async () => { throw new Error('must not send'); },
  );

  assert.deepEqual(providerFailure, { status: 'failed', providerId: null, safeErrorCode: 'provider_503' });
  assert.deepEqual(networkFailure, { status: 'failed', providerId: null, safeErrorCode: 'network_error' });
  assert.equal(missingOwners.status, 'not_configured');
  assert.equal(missingOwners.safeErrorCode, 'owner_recipients_missing');
});

test('result email is branded, escapes student data, and links only to the protected result door', () => {
  const email = buildExaminationRoomResultEmail({}, {
    studentName: 'Maria <img src=x onerror=alert(1)> & Reyes',
    examTitle: 'Constitutional Law </h1><script>alert(1)</script>',
    subject: 'Public Law & Remedies',
    totalScore: 90,
    maximumScore: 100,
    releasedAt: '2099-08-26T08:30:00.000Z',
  });

  assert.match(email.subject, /^Your examination result is ready/u);
  assert.match(email.html, /https:\/\/duediligence\.ph\/assets\/brand\/logo1-master\.png/u);
  assert.match(email.studentResultUrl, /\/examination-room\/student\.html#result$/u);
  assert.match(email.html, /90 <span[^>]*>\/ 100/u);
  assert.match(email.text, /Score: 90 \/ 100/u);
  assert.match(email.text, /does not contain the room key, answers, or per-question feedback/u);
  assert.doesNotMatch(email.html, /<script>|<img src=x/iu);
  assert.match(email.html, /Maria &lt;img src=x onerror=alert\(1\)&gt; &amp; Reyes/u);
  assert.equal(examinationRoomEmailBrand({}).studentResultUrl, 'https://duediligence.ph/examination-room/student.html#result');
});

test('result delivery batches unique student messages, returns provider IDs, and keeps retries idempotent', async () => {
  const calls = [];
  const transport = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, headers: options.headers, body });
    return new Response(JSON.stringify({
      data: body.map((_, index) => ({ id: `result-email-${calls.length}-${index + 1}` })),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const environment = {
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_FROM: 'Due Diligence <exams@duediligence.ph>',
    RESEND_API_KEY: 'test-provider-key',
  };
  const recipients = Array.from({ length: 101 }, (_, index) => ({
    sessionId: `session-${String(index + 1).padStart(3, '0')}`,
    releaseId: `release-${String(index + 1).padStart(3, '0')}`,
    recipient: `student-${index + 1}@example.edu.ph`,
    studentName: `Student ${index + 1}`,
    examTitle: 'Constitutional Law Final',
    subject: 'Constitutional Law',
    totalScore: 90,
    maximumScore: 100,
    releasedAt: '2099-08-26T08:30:00.000Z',
  }));
  recipients.push({ sessionId: 'session-missing-email', releaseId: 'release-missing-email' });

  const first = await deliverExaminationRoomResultReleaseEmails(environment, {
    recipients,
    idempotencyHash: 'c'.repeat(64),
  }, transport);
  const retry = await deliverExaminationRoomResultReleaseEmails(environment, {
    recipients,
    idempotencyHash: 'c'.repeat(64),
  }, transport);

  assert.equal(first.status, 'partial');
  assert.equal(first.acceptedCount, 101);
  assert.equal(first.skippedCount, 1);
  assert.equal(first.failedCount, 0);
  assert.equal(first.outcomes.length, 102);
  assert.equal(first.providerBatchIds.length, 2);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, 'https://api.resend.com/emails/batch');
  assert.equal(calls[0].body.length, 100);
  assert.equal(calls[1].body.length, 1);
  assert.deepEqual(calls[0].body[0].to, ['student-1@example.edu.ph']);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[2].headers['Idempotency-Key']);
  assert.equal(calls[1].headers['Idempotency-Key'], calls[3].headers['Idempotency-Key']);
  assert.equal(retry.acceptedCount, 101);
});

test('result delivery reports suppressed and recoverable provider failures per student', async () => {
  const recipients = [{
    sessionId: 'session-1',
    releaseId: 'release-1',
    recipient: 'student@example.edu.ph',
    studentName: 'Student One',
    examTitle: 'Civil Law Final',
    totalScore: 88,
    maximumScore: 100,
    releasedAt: '2099-08-26T08:30:00.000Z',
  }];
  const suppressed = await deliverExaminationRoomResultReleaseEmails({
    EXAMINATION_ROOM_EMAIL_MODE: 'suppressed',
  }, { recipients, idempotencyHash: 'd'.repeat(64) }, async () => {
    throw new Error('suppressed delivery must not contact a provider');
  });
  const failed = await deliverExaminationRoomResultReleaseEmails({
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_FROM: 'Due Diligence <exams@duediligence.ph>',
    RESEND_API_KEY: 'test-provider-key',
  }, { recipients, idempotencyHash: 'e'.repeat(64) }, async () => (
    new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503 })
  ));

  assert.equal(suppressed.status, 'suppressed');
  assert.equal(suppressed.outcomes[0].safeErrorCode, 'email_suppressed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.outcomes[0].safeErrorCode, 'provider_503');
});
