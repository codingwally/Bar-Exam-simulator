(function examinationRoomAdministration(global) {
  'use strict';

  const api = global.ExaminationRoomV1Api;
  const state = {
    access: null,
    data: null,
    root: null,
    toast: () => {},
    refresh: async () => {},
    institutionId: null,
    loadRequest: 0,
    issuedKey: null,
    issuedExamId: null,
    issuedInstitutionId: null,
    busy: false,
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[character]));
  }

  function formatDateTime(value) {
    if (!value) return 'Not scheduled';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not scheduled';
    return new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    }).format(date);
  }

  function statusLabel(value) {
    return String(value || 'draft').replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function recoverableError(error, retryOperation) {
    const message = error?.message || 'Examination Room administration could not complete that action.';
    const recovery = error?.recovery || 'No examination data was changed. Check the connection and try again.';
    return `<div class="exam-admin-error" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i><div><strong>${escapeHtml(message)}</strong><p>${escapeHtml(recovery)}</p></div>${retryOperation ? `<button class="secondary-button" type="button" data-exam-admin-retry="${escapeHtml(retryOperation)}">Try again</button>` : ''}</div>`;
  }

  function metric(label, value, help, icon) {
    return `<article class="exam-admin-metric"><i class="ph ${escapeHtml(icon)}" aria-hidden="true"></i><span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><em>${escapeHtml(help)}</em></span></article>`;
  }

  function examRow(exam) {
    const examId = exam.id || exam.examId;
    const activation = exam.activation || null;
    const canActivate = ['awaiting_activation', 'published'].includes(exam.status) && !activation;
    const canRevoke = activation && ['active', 'open', 'scheduled'].includes(activation.status);
    return `<tr data-exam-admin-row="${escapeHtml(examId)}">
      <td><strong>${escapeHtml(exam.title || 'Untitled examination')}</strong><small>${escapeHtml(exam.subject || 'Subject not set')}</small></td>
      <td>${escapeHtml(exam.professorName || exam.ownerName || 'Authorized professor')}</td>
      <td>${escapeHtml(formatDateTime(exam.startsAt || activation?.opensAt))}</td>
      <td>${escapeHtml(String(exam.questionCount ?? 0))}</td>
      <td>${escapeHtml(String(exam.rosterCount ?? 0))}</td>
      <td><span class="exam-admin-status ${escapeHtml(exam.status || 'draft')}">${escapeHtml(statusLabel(exam.status))}</span>${activation?.keyHint ? `<small>${escapeHtml(activation.keyHint)}</small>` : ''}</td>
      <td><div class="exam-admin-actions">
        ${canActivate ? `<button class="primary-button" type="button" data-exam-admin-action="activate_exam" data-exam-id="${escapeHtml(examId)}">Issue room key</button>` : ''}
        ${activation ? `<button class="secondary-button" type="button" data-exam-admin-action="email_key" data-exam-id="${escapeHtml(examId)}">Email professor</button>` : ''}
        ${canRevoke ? `<button class="exam-admin-danger" type="button" data-exam-admin-action="revoke_key" data-exam-id="${escapeHtml(examId)}">Revoke key</button>` : ''}
        <button class="secondary-button" type="button" data-exam-admin-action="create_snapshot" data-exam-id="${escapeHtml(examId)}">Recovery snapshot</button>
      </div></td>
    </tr>`;
  }

  function keyPanel() {
    if (!state.issuedKey || state.issuedInstitutionId !== state.institutionId) return '';
    return `<section class="exam-admin-key-panel" aria-labelledby="exam-admin-key-title">
      <div><p class="eyebrow">Shown once</p><h3 id="exam-admin-key-title">Room key issued</h3><p>Send this key only to the assigned professor through the approved school channel. The professor remains required to sign in.</p></div>
      <label><span>Room key</span><input id="exam-admin-issued-key" value="${escapeHtml(state.issuedKey)}" readonly></label>
      <div class="exam-admin-key-actions"><button class="primary-button" type="button" data-exam-admin-copy-key><i class="ph ph-copy" aria-hidden="true"></i>Copy key</button><button class="secondary-button" type="button" data-exam-admin-action="email_key" data-exam-id="${escapeHtml(state.issuedExamId)}"><i class="ph ph-envelope-simple" aria-hidden="true"></i>Replace & email key</button><button class="secondary-button" type="button" data-exam-admin-dismiss-key>Hide key</button></div>
      <p class="exam-admin-key-warning"><i class="ph ph-shield-warning" aria-hidden="true"></i>The plaintext key is not retained in the admin page after it is hidden or refreshed. Issue a replacement if it is lost.</p>
    </section>`;
  }

  function activeAdminInstitutions(access = state.access) {
    return (Array.isArray(access?.institutions) ? access.institutions : [])
      .filter((institution) => institution.active && institution.staffRole === 'admin');
  }

  function institutionOptions() {
    return activeAdminInstitutions().map((institution) => `<option value="${escapeHtml(institution.institutionId)}"${institution.institutionId === state.institutionId ? ' selected' : ''}>${escapeHtml(institution.institutionName || institution.institutionCode || institution.institutionId)}</option>`).join('');
  }

  function institutionForm(buttonLabel = 'Create school workspace') {
    return `<form class="exam-admin-role-form exam-admin-bootstrap-form" data-exam-admin-bootstrap-form>
      <label><span>Law school name</span><input name="institutionName" minlength="2" maxlength="240" autocomplete="organization" placeholder="e.g., Sample University College of Law" required></label>
      <label><span>Short school code</span><input name="institutionCode" minlength="2" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,63}" placeholder="e.g., sample-law" required><small>Letters, numbers, periods, dashes, and underscores only.</small></label>
      <button class="primary-button" type="submit"><i class="ph ph-buildings" aria-hidden="true"></i>${escapeHtml(buttonLabel)}</button>
      <div class="exam-admin-form-status" role="status" aria-live="polite"></div>
    </form>`;
  }

  function bootstrapContent(access) {
    const institutions = Array.isArray(access?.institutions) ? access.institutions : [];
    return `<div class="exam-admin-page exam-admin-bootstrap">
      <header class="section-head"><div><p class="eyebrow">Protected setup</p><h2>Open the first Examination Room workspace</h2><p>Create the law-school boundary first. You become its initial institution administrator; a versioned privacy notice is created with it. Then assign professors by the exact email they used to sign in.</p></div></header>
      <section class="panel exam-admin-bootstrap-panel"><div class="exam-admin-bootstrap-copy"><i class="ph ph-shield-check" aria-hidden="true"></i><div><h3>No active school assignment</h3><p>Your platform Role admin authority is verified, but an Examination Room school assignment is still required. Professor is saved as the user's profile role; protected school access begins only after administrator activation.</p></div></div>${institutionForm()}</section>
      ${institutions.length ? `<section class="panel"><header class="exam-admin-panel-head"><div><h3>Existing school workspaces</h3><p>Another active institution administrator must assign you before you can manage one of these workspaces.</p></div></header><div class="exam-admin-existing-schools">${institutions.map((institution) => `<article><strong>${escapeHtml(institution.institutionName)}</strong><small>${escapeHtml(institution.institutionCode)}</small><span>${escapeHtml(String(institution.professorCount || 0))} professors · ${escapeHtml(String(institution.adminCount || 0))} admins</span></article>`).join('')}</div></section>` : ''}
      <section class="exam-admin-truth"><i class="ph ph-info" aria-hidden="true"></i><div><strong>Professor role plus school activation.</strong><p>Selecting Professor saves that account role and displays the Professor card. Only this protected workflow activates access to a school's examinations and student records.</p></div></section>
    </div>`;
  }

  function staffRows(staff = []) {
    if (!staff.length) return '<div class="empty">No staff assignments are available. Assign the first professor using the verified sign-in email.</div>';
    return `<div class="exam-admin-professors">${staff.map((member) => `<article>
      <span class="exam-admin-avatar"><i class="ph ${member.staffRole === 'admin' ? 'ph-shield-check' : 'ph-chalkboard-teacher'}" aria-hidden="true"></i></span>
      <div><strong>${escapeHtml(member.displayName || (member.staffRole === 'admin' ? 'Institution administrator' : 'Professor'))}</strong><small>${escapeHtml(member.email || 'Email not available')} · ${escapeHtml(statusLabel(member.staffRole))}</small></div>
      <div class="exam-admin-staff-state"><span class="exam-admin-status ${member.status === 'active' ? 'active' : 'revoked'}">${escapeHtml(statusLabel(member.status))}</span>${member.status === 'active' && !member.isCurrentAdministrator ? `<button class="exam-admin-danger" type="button" data-exam-admin-revoke-staff="${escapeHtml(member.membershipId)}" data-exam-admin-staff-name="${escapeHtml(member.displayName || member.email || 'this account')}">Revoke</button>` : ''}</div>
    </article>`).join('')}</div>`;
  }

  function roleAssignmentForm() {
    return `<form class="exam-admin-role-form" data-exam-admin-role-form>
      <label><span>Verified sign-in email</span><input name="email" type="email" maxlength="320" autocomplete="email" placeholder="professor@lawschool.edu.ph" required><small>The user must sign in to Due Diligence once before assignment.</small></label>
      <label><span>Display name</span><input name="displayName" maxlength="240" autocomplete="name" placeholder="Prof. Full Name"></label>
      <label><span>Access</span><select name="staffRole" required><option value="professor">Professor</option><option value="admin">Institution admin</option></select><small>Institution admin also requires an existing protected platform Role admin.</small></label>
      <label class="exam-admin-role-reason"><span>Reason</span><input name="reason" minlength="5" maxlength="1000" value="Assigned by the law school for examination administration." required></label>
      <button class="primary-button" type="submit"><i class="ph ph-user-plus" aria-hidden="true"></i>Assign access</button>
      <div class="exam-admin-form-status" role="status" aria-live="polite"></div>
    </form>`;
  }

  function professorRequestRows(requests = []) {
    if (!requests.length) return '<div class="empty">No Professor signup requests are waiting for this law school.</div>';
    return `<div class="exam-admin-professor-requests">${requests.map((request) => `<article>
      <span class="exam-admin-avatar"><i class="ph ph-chalkboard-teacher" aria-hidden="true"></i></span>
      <div><strong>${escapeHtml(request.displayName || 'Professor applicant')}</strong><small>${escapeHtml(request.email || 'Email unavailable')} · ${escapeHtml(request.schoolName || request.schoolId || 'School not set')}</small><em>Requested ${escapeHtml(formatDateTime(request.requestedAt))}</em></div>
      <div class="exam-admin-request-actions"><button class="primary-button" type="button" data-exam-admin-approve-professor="${escapeHtml(request.requestId)}" data-exam-admin-request-email="${escapeHtml(request.email)}" data-exam-admin-request-name="${escapeHtml(request.displayName || '')}">Approve Professor</button><button class="exam-admin-danger" type="button" data-exam-admin-reject-professor="${escapeHtml(request.requestId)}" data-exam-admin-request-name="${escapeHtml(request.displayName || request.email || 'this request')}">Reject</button></div>
    </article>`).join('')}</div>`;
  }

  function snapshotRows(snapshots = []) {
    if (!snapshots.length) return '<div class="empty">No recovery snapshots have been created yet.</div>';
    return `<ol class="exam-admin-snapshots">${snapshots.map((snapshot) => `<li><i class="ph ph-database" aria-hidden="true"></i><span><strong>${escapeHtml(statusLabel(snapshot.type || snapshot.scope))}</strong><small>${escapeHtml(formatDateTime(snapshot.at || snapshot.createdAt))}</small></span><span>${snapshot.answerRevisionCount != null ? `${escapeHtml(snapshot.answerRevisionCount)} answer revisions` : 'Immutable checkpoint'}</span></li>`).join('')}</ol>`;
  }

  function professorTestHref() {
    const params = new URLSearchParams();
    params.set(api?.demoEnabled?.() ? 'demo' : 'live', '1');
    if (state.institutionId) params.set('institution', state.institutionId);
    return `../examination-room/?${params.toString()}`;
  }

  function renderContent(data) {
    const counts = data.counts || {};
    const exams = Array.isArray(data.exams) ? data.exams : [];
    const staff = Array.isArray(data.staff) ? data.staff : [];
    const professorRequests = Array.isArray(data.professorRequests) ? data.professorRequests : [];
    const currentInstitution = data.institution || activeAdminInstitutions().find((item) => item.institutionId === state.institutionId) || {};
    return `<div class="exam-admin-page">
      <header class="section-head exam-admin-section-head"><div><p class="eyebrow">${escapeHtml(currentInstitution.name || currentInstitution.institutionName || 'Law-school workspace')}</p><h2>Examination Room operations</h2><p>Assign verified professors, review immutable published versions, issue or revoke room keys, monitor lifecycle state, and create independent recovery checkpoints.</p></div><div class="exam-admin-head-actions">${activeAdminInstitutions().length > 1 ? `<label><span>Law school</span><select data-exam-admin-institution>${institutionOptions()}</select></label>` : ''}<a class="secondary-button" href="${escapeHtml(professorTestHref())}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out" aria-hidden="true"></i>Open professor test</a></div></header>
      <div class="exam-admin-metrics">${metric('Awaiting activation', String(counts.awaitingActivation ?? 0), 'Published by professors', 'ph-hourglass-medium')}${metric('Open rooms', String(counts.open ?? 0), 'Currently accepting students', 'ph-door-open')}${metric('Ready to grade', String(counts.grading ?? 0), 'Closed rooms', 'ph-seal-check')}${metric('Submissions', String(counts.submissions ?? 0), 'Receipts issued', 'ph-files')}</div>
      ${keyPanel()}
      <section class="panel exam-admin-queue"><header class="exam-admin-panel-head"><div><h3>Activation queue</h3><p>Only immutable published versions can receive a room key.</p></div><button class="secondary-button" type="button" data-exam-admin-refresh><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>Refresh queue</button></header><div class="table-wrap"><table><thead><tr><th>Examination</th><th>Professor</th><th>Start</th><th>Questions</th><th>Roster</th><th>Status</th><th>Actions</th></tr></thead><tbody>${exams.length ? exams.map(examRow).join('') : '<tr><td colspan="7"><div class="empty">No professor-published examinations are waiting. Nothing needs administrator action.</div></td></tr>'}</tbody></table></div></section>
      <section class="panel exam-admin-role-panel"><header class="exam-admin-panel-head"><div><h3>Professor signup requests</h3><p>Professor is already saved as each applicant's account role. Approve only the correct person for this law school; approval opens protected school data.</p></div></header>${professorRequestRows(professorRequests)}</section>
      <section class="panel exam-admin-role-panel"><header class="exam-admin-panel-head"><div><h3>Verified staff access</h3><p>Use the exact sign-in email for a Professor who already selected Professor in Profile, or for another protected Institution admin.</p></div></header>${roleAssignmentForm()}${staffRows(staff)}</section>
      <div class="exam-admin-grid"><section class="panel"><header class="exam-admin-panel-head"><div><h3>Recovery checkpoints</h3><p>Independent snapshots support restoration and reconciliation without exposing room keys.</p></div></header>${snapshotRows(data.snapshots)}</section><section class="panel exam-admin-new-school"><header class="exam-admin-panel-head"><div><h3>Create another school workspace</h3><p>Use a separate boundary only when another law school will operate its own exams and staff directory.</p></div></header><details><summary>Create a separate workspace</summary>${institutionForm('Create separate workspace')}</details></section></div>
      <section class="exam-admin-truth"><i class="ph ph-info" aria-hidden="true"></i><div><strong>Browser integrity signals are not lockdown.</strong><p>Fullscreen, focus, camera, microphone, and disconnection events require authorized human review. A browser cannot prevent operating-system app switching or prove misconduct.</p></div></section>
    </div>`;
  }

  async function load(requestToken = state.loadRequest) {
    if (!api) throw new Error('The Examination Room administration module is unavailable.');
    const access = await api.adminQuery('access');
    if (requestToken !== state.loadRequest) return null;
    state.access = access;
    const assignments = activeAdminInstitutions(access);
    if (!assignments.some((item) => item.institutionId === state.institutionId)) state.institutionId = assignments[0]?.institutionId || null;
    if (!state.institutionId) { state.data = null; return bootstrapContent(access); }
    const [overview, directory] = await Promise.all([
      api.adminQuery('overview', { institutionId: state.institutionId }),
      api.adminQuery('staff_directory', { institutionId: state.institutionId }),
    ]);
    if (requestToken !== state.loadRequest) return null;
    state.data = { ...overview, ...directory, access };
    return renderContent(state.data);
  }

  async function render() {
    const requestToken = ++state.loadRequest;
    try { return await load(requestToken); }
    catch (error) { return `<div class="exam-admin-page">${recoverableError(error, 'refresh')}</div>`; }
  }

  async function refreshIntoRoot(message = '') {
    if (!state.root) return;
    const requestToken = ++state.loadRequest;
    state.root.setAttribute('aria-busy', 'true');
    try {
      const html = await load(requestToken);
      if (requestToken !== state.loadRequest || html == null) return;
      state.root.innerHTML = html;
      if (message) state.toast(message);
    } catch (error) {
      if (requestToken === state.loadRequest) state.root.innerHTML = `<div class="exam-admin-page">${recoverableError(error, 'refresh')}</div>`;
    } finally {
      if (requestToken === state.loadRequest) state.root.removeAttribute('aria-busy');
    }
  }

  async function runAction(operation, examId, button) {
    if (state.busy) return;
    if (operation === 'revoke_key' && !global.confirm('Revoke the current room key? Students and the professor will need a newly issued key before the room can reopen. Existing answers and submissions are preserved.')) return;
    if (operation === 'email_key' && !global.confirm('Issue a replacement key and email it to the professor? The prior unused key will stop working. The new key will also be shown once so you can recover if email delivery is unavailable.')) return;
    state.busy = true;
    const original = button?.innerHTML;
    if (button) { button.disabled = true; button.innerHTML = '<i class="ph ph-spinner-gap" aria-hidden="true"></i>Working…'; }
    try {
      const result = await api.adminCommand(operation, { examId, institutionId: state.institutionId }, api.requestId());
      if (operation === 'activate_exam') { state.issuedKey = result.roomKey; state.issuedExamId = examId; state.issuedInstitutionId = state.institutionId; state.toast('Room key issued. Copy it now or send it to the professor.'); }
      else if (operation === 'email_key') {
        state.issuedKey = result.roomKey;
        state.issuedExamId = examId;
        state.issuedInstitutionId = state.institutionId;
        state.toast(['sent', 'demo_delivered'].includes(result.deliveryStatus) ? 'A replacement key was issued and sent. The new key is shown once below.' : 'Email is unavailable. The replacement key is shown once below; copy it now.');
      }
      else if (operation === 'revoke_key') { state.issuedKey = null; state.issuedExamId = null; state.issuedInstitutionId = null; state.toast('Room key revoked. Student answers and submissions were not changed.'); }
      else if (operation === 'create_snapshot') state.toast('Recovery snapshot created and recorded.');
      state.busy = false;
      await refreshIntoRoot();
    } catch (error) {
      state.root.querySelector('.exam-admin-error')?.remove();
      state.root.insertAdjacentHTML('afterbegin', recoverableError(error, `${operation}:${examId}`));
    } finally {
      state.busy = false;
      if (button?.isConnected) { button.disabled = false; button.innerHTML = original; }
    }
  }

  async function runBootstrap(form) {
    if (state.busy) return;
    const values = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.exam-admin-form-status');
    state.busy = true; button.disabled = true; status.textContent = 'Creating the protected school workspace…';
    try {
      const result = await api.adminCommand('bootstrap_institution', { institutionName: values.get('institutionName'), institutionCode: values.get('institutionCode') }, api.requestId());
      state.issuedKey = null; state.issuedExamId = null; state.issuedInstitutionId = null;
      state.institutionId = result.institution?.id || null;
      state.busy = false;
      await refreshIntoRoot('School workspace created. You can now assign professors by verified email.');
    } catch (error) {
      status.textContent = `${error.message || 'The school workspace could not be created.'} ${error.recovery || 'Review the fields and try again.'}`;
    } finally { state.busy = false; if (button.isConnected) button.disabled = false; }
  }

  async function runRoleAssignment(form) {
    if (state.busy || !state.institutionId) return;
    const values = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.exam-admin-form-status');
    state.busy = true; button.disabled = true; status.textContent = 'Checking the signed-in account and assigning access…';
    try {
      await api.adminCommand('assign_staff', { institutionId: state.institutionId, email: values.get('email'), displayName: values.get('displayName'), staffRole: values.get('staffRole'), reason: values.get('reason') }, api.requestId());
      form.reset();
      state.busy = false;
      await refreshIntoRoot('Verified staff access assigned. The Professor door will now recognize that account.');
    } catch (error) {
      status.textContent = `${error.message || 'Staff access could not be assigned.'} ${error.recovery || 'Review the account email and try again.'}`;
    } finally { state.busy = false; if (button.isConnected) button.disabled = false; }
  }

  async function approveProfessorRequest(button) {
    if (state.busy || !state.institutionId) return;
    const email = button.dataset.examAdminRequestEmail || '';
    const displayName = button.dataset.examAdminRequestName || '';
    if (!global.confirm(`Approve ${displayName || email} as a Professor for this law school? This opens protected examination and student records for that account.`)) return;
    state.busy = true; button.disabled = true;
    try {
      await api.adminCommand('assign_staff', {
        institutionId: state.institutionId,
        email,
        displayName,
        staffRole: 'professor',
        reason: 'Approved from the verified Professor signup request queue for this law school.',
      }, api.requestId());
      state.busy = false;
      await refreshIntoRoot('Professor request approved. The Professor card can now open this school workspace.');
    } catch (error) { state.root.insertAdjacentHTML('afterbegin', recoverableError(error, 'refresh')); }
    finally { state.busy = false; if (button.isConnected) button.disabled = false; }
  }

  async function rejectProfessorRequest(button) {
    if (state.busy || !state.institutionId) return;
    const name = button.dataset.examAdminRequestName || 'this Professor request';
    if (!global.confirm(`Reject ${name}? The account keeps its Professor profile role but will not receive this school's protected access.`)) return;
    state.busy = true; button.disabled = true;
    try {
      await api.adminCommand('reject_professor_request', {
        institutionId: state.institutionId,
        requestId: button.dataset.examAdminRejectProfessor,
        reason: `Professor signup request rejected by an institution administrator for ${name}.`,
      }, api.requestId());
      state.busy = false;
      await refreshIntoRoot('Professor request rejected. No protected school access was granted.');
    } catch (error) { state.root.insertAdjacentHTML('afterbegin', recoverableError(error, 'refresh')); }
    finally { state.busy = false; if (button.isConnected) button.disabled = false; }
  }

  async function revokeStaff(button) {
    if (state.busy || !state.institutionId) return;
    const name = button.dataset.examAdminStaffName || 'this account';
    if (!global.confirm(`Revoke Examination Room access for ${name}? Existing exams, answers, grades, and audit history remain preserved.`)) return;
    state.busy = true; button.disabled = true;
    try {
      await api.adminCommand('revoke_staff', { institutionId: state.institutionId, membershipId: button.dataset.examAdminRevokeStaff, reason: `Access revoked by an institution administrator for ${name}.` }, api.requestId());
      state.busy = false;
      await refreshIntoRoot('Staff access revoked. Existing examination records were preserved.');
    } catch (error) { state.root.insertAdjacentHTML('afterbegin', recoverableError(error, 'refresh')); }
    finally { state.busy = false; if (button.isConnected) button.disabled = false; }
  }

  async function copyIssuedKey() {
    if (!state.issuedKey) return;
    try { await navigator.clipboard.writeText(state.issuedKey); state.toast('Room key copied. Send it only through the approved school channel.'); }
    catch { state.root.querySelector('#exam-admin-issued-key')?.select(); state.toast('Copy the selected key. Your browser did not permit automatic clipboard access.'); }
  }

  function bind({ root, toast, refresh }) {
    state.root = root;
    state.toast = typeof toast === 'function' ? toast : state.toast;
    state.refresh = typeof refresh === 'function' ? refresh : state.refresh;
    if (!root || root.dataset.examinationRoomBound === 'true') return;
    root.dataset.examinationRoomBound = 'true';
    root.addEventListener('submit', async (event) => {
      if (event.target.matches('[data-exam-admin-bootstrap-form]')) { event.preventDefault(); await runBootstrap(event.target); }
      else if (event.target.matches('[data-exam-admin-role-form]')) { event.preventDefault(); await runRoleAssignment(event.target); }
    });
    root.addEventListener('change', async (event) => {
      if (!event.target.matches('[data-exam-admin-institution]')) return;
      state.issuedKey = null; state.issuedExamId = null; state.issuedInstitutionId = null;
      state.institutionId = event.target.value;
      await refreshIntoRoot('Law-school workspace changed.');
    });
    root.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-exam-admin-action]');
      if (action) { await runAction(action.dataset.examAdminAction, action.dataset.examId, action); return; }
      const revoke = event.target.closest('[data-exam-admin-revoke-staff]');
      if (revoke) { await revokeStaff(revoke); return; }
      const approveProfessor = event.target.closest('[data-exam-admin-approve-professor]');
      if (approveProfessor) { await approveProfessorRequest(approveProfessor); return; }
      const rejectProfessor = event.target.closest('[data-exam-admin-reject-professor]');
      if (rejectProfessor) { await rejectProfessorRequest(rejectProfessor); return; }
      if (event.target.closest('[data-exam-admin-copy-key]')) { await copyIssuedKey(); return; }
      if (event.target.closest('[data-exam-admin-dismiss-key]')) { state.issuedKey = null; state.issuedExamId = null; state.issuedInstitutionId = null; root.innerHTML = renderContent(state.data || {}); state.toast('The plaintext key is hidden. Issue a replacement if it was not recorded securely.'); return; }
      if (event.target.closest('[data-exam-admin-refresh]')) { await refreshIntoRoot('Examination Room operations refreshed.'); return; }
      const retry = event.target.closest('[data-exam-admin-retry]');
      if (retry) { const [operation, examId] = retry.dataset.examAdminRetry.split(':'); if (operation === 'refresh') await refreshIntoRoot('Examination Room operations refreshed.'); else await runAction(operation, examId, retry); }
    });
  }

  global.DueDiligenceExaminationRoomAdmin = Object.freeze({ render, bind });
})(window);
