import assert from 'node:assert/strict';

/** Local/disposable test server only. Never run this synthetic schedule against production. */
export async function runAdminReview(browser, baseURL, { evidenceDir } = {}) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Synthetic examiner review is restricted to a local disposable test server.');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const outcomes = [];
  try {
    await page.goto(`${baseURL}/admin/exams`);
    await page.locator('#desk').waitFor({ state: 'visible' });
    const examId = await page.locator('#exam').inputValue();
    assert.match(await page.locator('#notice').innerText(), /Private access confirmed/);
    outcomes.push('Private examiner UI loads with authenticated server response and no script errors.');

    const synthetic = Array.from({ length: 20 }, (_, i) => `${i + 1}. SYNTHETIC TEST QUESTION ${i + 1}\nA fictional public body considers scenario ${i + 1}. Preserve this full second paragraph.\n\nExplain every relevant issue. Literal text <img src=x onerror=alert(1)> stays text.`).join('\n\n');
    await page.locator('#questions details').first().locator('summary').click();
    await page.locator('#paste').fill(synthetic);
    await page.locator('#parse').click();
    assert.equal(await page.locator('.question-item').count(), 20);
    assert.match(await page.locator('#question-19').inputValue(), /SYNTHETIC TEST QUESTION 20/);
    assert.match(await page.locator('#question-19').inputValue(), /Literal text <img/);
    assert.equal(await page.locator('#question-editor img').count(), 0);
    await page.locator('#save-draft').click();
    await page.waitForFunction(() => document.querySelector('#draft-state').textContent.includes('saved') && !document.querySelector('#save-draft').disabled);
    outcomes.push('All 20 pasted multiline questions are previewed, kept as text, and saved as a server draft.');

    const start = new Date(Date.now() + 5 * 60000), pht = new Date(start.getTime() + 8 * 3600000).toISOString();
    await page.locator('#start-date').fill(pht.slice(0, 10));
    await page.locator('#start-time').fill(pht.slice(11, 16));
    await page.locator('[name=end-mode][value=duration]').check();
    await page.locator('#duration').fill('180');
    await page.locator('#schedule-form button').click();
    await page.locator('#schedule-review').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#review-questions article').count(), 20);
    assert.match(await page.locator('#schedule-summary').innerText(), /20 questions.+PHT.+180 minutes/);
    assert.equal(await page.locator('#schedule-save').isDisabled(), true);
    await page.locator('#schedule-reason').fill('Synthetic local examiner interface verification.');
    await page.locator('#schedule-confirm').check();
    assert.equal(await page.locator('#schedule-save').isEnabled(), true);
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/admin-schedule-review-desktop.png` });
    await page.locator('#schedule-save').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Scheduled.'));
    assert.match(await page.locator('#exam-status').innerText(), /SCHEDULED/);
    outcomes.push('PHT schedule is reviewed with every question and requires explicit confirmation; server confirms scheduling.');

    const before = await page.evaluate(async id => (await (await fetch(`/api/admin/exams/${id}`)).json()), examId);
    assert.equal(before.published.questions.length, 20);
    await page.locator('#question-0').fill('SYNTHETIC: revised draft, not the published examination.');
    await page.locator('#save-draft').click();
    await page.waitForFunction(() => !document.querySelector('#save-draft').disabled && document.querySelector('#draft-state').textContent.includes('saved'));
    const after = await page.evaluate(async id => (await (await fetch(`/api/admin/exams/${id}`)).json()), examId);
    assert.equal(after.published.questions[0].text, before.published.questions[0].text);
    assert.equal(after.draft.questions[0].text, 'SYNTHETIC: revised draft, not the published examination.');
    outcomes.push('Editing/saving a later draft does not replace the preserved scheduled question set.');

    // Keep subsequent synthetic student tests on the published version and make
    // the editor match it again without changing the scheduled version.
    await page.locator('#question-0').fill(before.published.questions[0].text);
    await page.locator('#save-draft').click();
    await page.waitForFunction(() => !document.querySelector('#save-draft').disabled && document.querySelector('#draft-state').textContent.includes('saved'));

    for (const width of [1440, 1024, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(50);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `Examiner layout overflow at ${width}px`);
      assert.ok(await page.locator('#exam').isVisible());
      if (evidenceDir && [1440, 390, 320].includes(width)) await page.screenshot({ path: `${evidenceDir}/admin-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Examiner layout overflow at 200% zoom');
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    outcomes.push('Examiner layout has no horizontal overflow at 1440/1024/768/390/375/320px and 200% zoom.');

    await page.locator('#exam').selectOption('practice');
    await page.waitForFunction(() => document.querySelector('#exam-status').textContent.startsWith('OPEN') && document.querySelector('#question-tools').hidden);
    assert.equal(await page.locator('.question-item').count(), 1);
    assert.match(await page.locator('.question-item').innerText(), /constitutional supremacy/i);
    assert.equal(await page.locator('#schedule-form').isVisible(), false);
    outcomes.push('Practice remains separate, exactly one approved question, fixed individual five-minute schedule.');
    assert.deepEqual(errors, []);
    return { passed: true, outcomes, scheduled: { starts_at: before.exam.starts_at, ends_at: before.exam.ends_at }, screenshots: evidenceDir || null };
  } finally { await context.close(); }
}

/** Run after synthetic official exam closure; preserves its data in history. */
export async function runAdminControlsReview(browser, baseURL, { evidenceDir } = {}) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Examiner controls review requires a disposable local server.');
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const page = await context.newPage(), student = await context.newPage(), outcomes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  student.on('dialog', dialog => dialog.accept());
  page.on('dialog', dialog => dialog.accept());
  const marker = `controls-${Date.now()}`;
  try {
    await student.goto(`${baseURL}/practice`);
    await student.getByRole('textbox', { name: 'Full name' }).fill('Synthetic controls student');
    await student.getByRole('textbox', { name: 'Email address' }).fill(`${marker}@example.invalid`);
    await student.getByRole('checkbox').check();
    await student.getByRole('button', { name: 'Start practice', exact: true }).click();
    await student.getByRole('textbox', { name: /Your answer to question/ }).fill('Synthetic preserved practice answer for authorized reset testing.');
    await student.getByText(/Saved to server at/).waitFor();
    await student.getByRole('button', { name: 'Review & submit', exact: true }).click();
    await student.getByRole('button', { name: 'Submit examination', exact: true }).click();
    await student.getByRole('heading', { name: 'Your examination is submitted.' }).waitFor();
    const first = await student.evaluate(async () => (await (await fetch('/api/exams/practice/state')).json()).attempt);
    assert.ok(first.receipt);

    await page.goto(`${baseURL}/admin/exams`);
    await page.locator('#desk').waitFor({ state: 'visible' });
    await page.locator('#exam').selectOption('practice');
    await page.waitForFunction(() => document.querySelector('#question-tools').hidden);
    await page.locator('#search').fill(`${marker}@example.invalid`);
    await page.locator('#search-form button[type=submit]').click();
    await page.locator('#attempts button').first().click();
    await page.locator('#response').waitFor({ state: 'visible' });
    assert.match(await page.locator('#answer-set').innerText(), /Synthetic preserved practice answer/);
    assert.match(await page.locator('#readiness-checks').innerText(), /Disconnect exercised: Not yet confirmed/);
    assert.match(await page.locator('#readiness-checks').innerText(), /Server-confirmed finalization: Observed/);
    outcomes.push('Practice readiness remains incomplete when disconnect/reconnect were never exercised; saved answers and receipt are visible.');

    await page.locator('#recovery-reason').fill('Synthetic verified identity. Test authorized one-use recovery.');
    await page.locator('#recovery-confirm').check();
    await page.locator('#recover').click();
    await page.locator('#recovery-result').waitFor({ state: 'visible' });
    const recoveryURL = (await page.locator('#recovery-result').innerText()).split('\n').find(line => line.startsWith(`${baseURL}/practice#recover=`));
    assert.ok(recoveryURL);
    const recovered = await context.newPage(); await recovered.goto(recoveryURL);
    await recovered.getByRole('heading', { name: 'Your examination is submitted.' }).waitFor();
    const restored = await recovered.evaluate(async () => (await (await fetch('/api/exams/practice/state')).json()).attempt);
    assert.equal(restored.id, first.id); assert.equal(restored.deadlineAt, first.deadlineAt); assert.equal(restored.receipt.id, first.receipt.id);
    await recovered.close();
    outcomes.push('Authorized one-use recovery restores the existing attempt, original deadline and identical server receipt.');

    await page.locator('#recovery-reason').fill('Synthetic verified identity. Practice troubleshooting only.');
    await page.locator('#recovery-confirm').check();
    await page.locator('#practice-reset').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Practice reset authorized'));
    await student.reload();
    await student.getByRole('button', { name: 'Start practice', exact: true }).waitFor();
    const preserved = await page.evaluate(async id => (await (await fetch(`/api/admin/attempts/${id}`)).json()), first.id);
    assert.equal(preserved.receipt.id, first.receipt.id); assert.equal(preserved.answers[0].text, 'Synthetic preserved practice answer for authorized reset testing.');
    outcomes.push('Explicit practice reset revokes access, permits a new practice start and preserves the old answer/receipt.');

    const exams = await page.evaluate(async () => (await (await fetch('/api/admin/exams')).json()).exams);
    const current = exams.find(exam => exam.kind === 'official' && !exam.archived);
    assert.ok(current && ['CLOSED', 'CANCELLED', 'UNCONFIGURED'].includes(current.state), 'Run archive review after the disposable official exam has closed.');
    await page.locator('#exam').selectOption(current.id);
    await page.waitForFunction(() => !document.querySelector('#next-exam').hidden);
    const old = await page.evaluate(async id => (await (await fetch(`/api/admin/exams/${id}`)).json()), current.id);
    await page.locator('#next-exam summary').click();
    await page.locator('#next-exam-label').fill('Synthetic next official examination');
    await page.locator('#next-exam-reason').fill('Synthetic closed examination archive and future setup review.');
    await page.locator('#next-exam-confirm').check();
    await page.locator('#next-exam-create').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('The prior examination is preserved'));
    const fresh = await page.evaluate(async () => {
      const list = (await (await fetch('/api/admin/exams')).json()).exams;
      const current = list.find(exam => exam.kind === 'official' && !exam.archived);
      return { list, current, detail: await (await fetch(`/api/admin/exams/${current.id}`)).json() };
    });
    assert.notEqual(fresh.current.id, current.id);
    assert.equal(fresh.current.state, 'UNCONFIGURED'); assert.equal(fresh.current.student_url, '/official');
    assert.equal(fresh.detail.draft.questions.length, 0); assert.equal(fresh.detail.published, null);
    assert.equal(fresh.list.find(exam => exam.id === current.id).archived, true);
    await page.locator('#exam').selectOption(current.id);
    await page.waitForFunction(() => document.querySelector('#draft-state').textContent === 'Preserved historical examination');
    assert.equal(await page.locator('#question-tools').isVisible(), false);
    assert.equal(await page.locator('#exceptional-controls').isVisible(), false);
    const archived = await page.evaluate(async id => (await (await fetch(`/api/admin/exams/${id}`)).json()), current.id);
    assert.deepEqual(archived.published, old.published);
    await student.goto(`${baseURL}/official`);
    await student.getByRole('heading', { name: 'Test is not available', exact: true }).waitFor();
    outcomes.push('Next exam is created wholly in the dashboard, starts empty at the same official URL, and the previous examination is preserved read-only in history.');
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/admin-archived-preserved.png` });
    assert.deepEqual(errors, []);
    return { passed: true, outcomes, oldExamId: current.id, newExamId: fresh.current.id };
  } finally { await context.close(); }
}

/** CSV preview test is nonpublishing and restores the prior draft after saving. */
export async function runCSVUploadReview(browser, baseURL) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Synthetic CSV upload requires a local disposable server.');
  const context = await browser.newContext(), page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  let original, examId;
  try {
    await page.goto(`${baseURL}/admin/exams`); await page.locator('#desk').waitFor({ state: 'visible' });
    examId = await page.locator('#exam').inputValue();
    original = await page.evaluate(async id => (await (await fetch(`/api/admin/exams/${id}`)).json()), examId);
    await page.locator('#questions details').first().locator('summary').click();
    await page.locator('#question-file').setInputFiles({ name: 'synthetic-questions.csv', mimeType: 'text/csv', buffer: Buffer.from('question_number,question_text,instructions,points\r\n1,"SYNTHETIC CSV: says ""law"", then explains.\r\nA second full paragraph.",Use ALAC.,5\r\n2,"Second synthetic CSV fact pattern.",,\r\n') });
    await page.waitForFunction(() => document.querySelectorAll('.question-item').length === 2);
    assert.equal(await page.locator('#question-0').inputValue(), 'SYNTHETIC CSV: says "law", then explains.\nA second full paragraph.');
    assert.equal(await page.locator('#points-0').inputValue(), '5');
    await page.locator('#save-draft').click();
    await page.waitForFunction(() => !document.querySelector('#save-draft').disabled && document.querySelector('#draft-state').textContent.includes('saved'));
    const saved = await page.evaluate(async id => (await (await fetch(`/api/admin/exams/${id}`)).json()), examId);
    assert.equal(saved.draft.questions.length, 2);
    assert.deepEqual(saved.published, original.published);
    return { passed: true, outcomes: ['Actual CSV file upload preserves quoted commas/quotation marks, multiline text, instructions and points; saving the draft leaves published questions unchanged.'] };
  } finally {
    if (original?.draft?.questions?.length) {
      const restored = await page.evaluate(async ({ id, questions }) => {
        const current = await (await fetch(`/api/admin/exams/${id}`)).json();
        return (await fetch(`/api/admin/exams/${id}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions, expected_version: current.draft.version }) })).ok;
      }, { id: examId, questions: original.draft.questions });
      assert.equal(restored, true, 'Synthetic upload must restore prior draft');
    }
    await context.close();
  }
}

/** UI-only role fixture; verified JWT and write denial have separate backend tests. */
export async function runReadOnlyUIReview(browser, baseURL, { evidenceDir } = {}) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Read-only UI fixture requires a disposable local server.');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  const writes = [];
  try {
    await page.route('**/api/admin/exams', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch(), data = await response.json();
      data.identity = { email: 'synthetic-read-only@example.invalid', role: 'examiner' };
      await route.fulfill({ response, json: data });
    });
    page.on('request', request => { if (request.url().includes('/api/admin/') && request.method() !== 'GET') writes.push(request.method()); });
    await page.goto(`${baseURL}/admin/exams`); await page.locator('#desk').waitFor({ state: 'visible' });
    assert.match(await page.locator('#identity').innerText(), /read only/);
    for (const id of ['question-tools', 'schedule-form', 'exceptional-controls', 'admission-controls', 'next-exam']) assert.equal(await page.locator(`#${id}`).isVisible(), false, `${id} must be hidden from read-only examiner`);
    assert.equal(await page.locator('#export').isEnabled(), true);
    await page.locator('#exam').selectOption('practice');
    await page.waitForFunction(() => document.querySelector('#practice-schedule').hidden === false && !document.querySelector('#desk').inert);
    await page.locator('#attempts button').first().click();
    await page.locator('#response').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.recovery').isVisible(), false);
    assert.equal(await page.locator('#student-report').isEnabled(), true);
    assert.equal(await page.locator('#activity').isVisible(), true);
    assert.deepEqual(writes, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/admin-read-only-mobile.png` });
    return { passed: true, fixture: 'UI identity fixture only; cryptographic authentication and write rejection covered in backend tests.', outcomes: ['Read-only examiner can review responses/events and download reports; all draft, scheduling, recovery, reset, retry and control actions are hidden. No mutation request occurs.'] };
  } finally { await context.close(); }
}

export async function runAdmissionUIReview(browser, baseURL) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Synthetic admission review requires a local disposable server.');
  const staff = await browser.newContext(), examinee = await browser.newContext(), guest = await browser.newContext();
  const admin = await staff.newPage(), student = await examinee.newPage(), visitor = await guest.newPage();
  try {
    await student.goto(`${baseURL}/practice`);
    await student.getByRole('textbox', { name: 'Full name' }).fill('Synthetic admission preservation');
    await student.getByRole('textbox', { name: 'Email address' }).fill(`admission-${Date.now()}@example.invalid`);
    await student.getByRole('checkbox').check();
    await student.getByRole('button', { name: 'Start practice', exact: true }).click();
    const answer = student.getByRole('textbox', { name: /Your answer to question/ });
    await answer.fill('Synthetic answer before admission control.');
    await student.getByText(/Saved to server at/).waitFor();
    const original = await student.evaluate(async () => (await (await fetch('/api/exams/practice/state')).json()).attempt);
    await admin.goto(`${baseURL}/admin/exams`); await admin.locator('#desk').waitFor({ state: 'visible' });
    await admin.locator('#exam').selectOption('practice');
    await admin.waitForFunction(() => !document.querySelector('#practice-schedule').hidden && !document.querySelector('#desk').inert);
    await admin.locator('#admission-controls summary').click();
    const change = async action => {
      await admin.locator('#admission-action').selectOption(action);
      await admin.locator('#admission-reason').fill(`Synthetic explicit ${action} admission review.`);
      await admin.locator('#admission-confirm').check();
      await admin.locator('#admission-save').click();
      await admin.waitForFunction(() => !document.querySelector('#admission-save').disabled && document.querySelector('#notice').textContent.startsWith('Student-link action recorded.'));
    };
    await change('revoke');
    assert.match(await admin.locator('#admission-status').innerText(), /disabled/);
    await visitor.goto(`${baseURL}/practice`);
    await visitor.getByRole('heading', { name: 'This admission link is unavailable', exact: true }).waitFor();
    await answer.fill('Synthetic answer after new registration was revoked.');
    await student.getByText(/Saved to server at/).waitFor();
    let preserved = await student.evaluate(async () => (await (await fetch('/api/exams/practice/state')).json()).attempt);
    assert.equal(preserved.id, original.id); assert.equal(preserved.deadlineAt, original.deadlineAt);
    assert.equal(preserved.answers[0].text, 'Synthetic answer after new registration was revoked.');
    await change('enable');
    await visitor.goto(`${baseURL}/practice`);
    await visitor.getByRole('button', { name: 'Start practice', exact: true }).waitFor();
    await change('rotate');
    const replacement = await admin.locator('#student-link a').getAttribute('href');
    assert.match(replacement, /\/practice\?access=[a-f0-9]+$/);
    await visitor.goto(`${baseURL}/practice`);
    await visitor.getByRole('heading', { name: 'This admission link is unavailable', exact: true }).waitFor();
    await visitor.goto(replacement);
    await visitor.getByRole('button', { name: 'Start practice', exact: true }).waitFor();
    preserved = await student.evaluate(async () => (await (await fetch('/api/exams/practice/state')).json()).attempt);
    assert.equal(preserved.id, original.id); assert.equal(preserved.deadlineAt, original.deadlineAt);
    return { passed: true, outcomes: ['Owner UI revoke/enable/rotate actions require reason and confirmation; old links reject new visitors after rotation, the replacement works, and the existing attempt/answers/deadline remain intact.'] };
  } finally { await Promise.all([staff.close(), examinee.close(), guest.close()]); }
}
