(function dueDiligenceAdmin(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const subscriptionActions = global.DueDiligenceSubscriptionActions;
  const titles = Object.freeze({
    executive: 'Chambers',
    realtime: 'Live Activity',
    acquisition: 'Visitors & Sign-ups',
    users: 'Students',
    learning: 'Performance',
    subjects: 'Question Bank',
    reliability: 'AI Grading Health',
    subscriptions: 'Retainer Management',
    payments: 'Payment Review',
    refunds: 'Refunds',
    support: 'Support Requests',
    corrections: 'Answer Corrections',
    partnerships: 'Partnerships',
    controls: 'Website Settings',
    security: 'Access & Activity Log',
    forum: 'Quorum Moderation & Analytics',
    examinations: 'Examination Management',
    answer_exports: 'Answer Exports',
  });
  const requirements = Object.freeze({
    users: 'learner_analytics_viewer',
    learning: 'learner_analytics_viewer',
    subscriptions: 'subscription_admin',
    payments: 'subscription_admin',
    refunds: 'subscription_admin',
    support: 'support_admin',
    corrections: 'correction_admin',
    partnerships: 'advertiser_report_viewer',
    controls: 'role_admin',
    security: 'role_admin',
    answer_exports: 'learner_analytics_viewer',
  });
  const state = {
    client: null,
    session: null,
    authorization: null,
    report: null,
    section: 'executive',
    operational: new Map(),
    action: null,
    actionInFlight: false,
    subscriptionRows: new Map(),
    premiumStatus: 'all',
    examinationData: null,
    userSearch: '',
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function maskOperationalIdentifier(value, prefix = '') {
    const text = String(value || '').trim();
    if (!text) return prefix || 'Not available';
    if (!UUID_PATTERN.test(text)) return text;
    return `${prefix ? `${prefix} · ` : ''}${text.slice(0, 8)}…${text.slice(-4)}`;
  }

  function humanizeAuditValue(value) {
    const text = String(value || '').trim().replace(/^phase4_/, '').replace(/_/g, ' ');
    if (!text) return 'Not available';
    return text.replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function auditTargetLabel(row) {
    const target = String(row?.target_resource_id || '').trim();
    if (!target) return 'Not available';
    if (row?.target_resource_type === 'phase4_admin_section' && titles[target]) return titles[target];
    return maskOperationalIdentifier(target);
  }

  function toast(message) {
    const node = $('#admin-toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.classList.remove('show'), 3500);
  }

  function has(capability) {
    return state.authorization?.role === 'super_admin'
      || state.authorization?.capabilities?.includes(capability);
  }

  function uuidKey() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  function number(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return 'Not available';
    return Number(value).toLocaleString('en-PH', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function percentage(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return 'Not available';
    return `${(Number(value) * 100).toFixed(digits)}%`;
  }

  function dateTime(value) {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not available';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function trend(current, previous) {
    const now = Number(current);
    const before = Number(previous);
    if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) {
      return '<em>Comparison unavailable</em>';
    }
    const change = ((now - before) / before) * 100;
    const className = change >= 0 ? 'up' : 'down';
    const prefix = change >= 0 ? '+' : '';
    return `<em class="${className}">${prefix}${change.toFixed(1)}% vs prior period</em>`;
  }

  function insightData(label, value, options = {}) {
    return escapeHtml(JSON.stringify({
      label,
      value,
      copy: options.copy || 'Verified aggregate for the currently selected reporting period.',
      source: options.source || 'Due Diligence production analytics aggregate',
    }));
  }

  function metric(label, value, comparison = null, formatter = number, options = {}) {
    const displayValue = formatter(value);
    return `<button type="button" class="metric" data-insight="${insightData(label, displayValue, options)}"
      aria-label="View details for ${escapeHtml(label)}: ${escapeHtml(displayValue)}">
      <small title="${escapeHtml(label)}">${escapeHtml(label)}</small>
      <strong>${escapeHtml(displayValue)}</strong>${comparison == null ? '<em>Verified current period</em>' : trend(value, comparison)}
      <span class="metric-cue">View verified detail</span></button>`;
  }

  function heading(title, copy, actions = '') {
    return `<header class="section-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>${actions}</header>`;
  }

  function empty(copy) {
    return `<div class="empty">${escapeHtml(copy)}</div>`;
  }

  function queueLink(label, copy, section) {
    return `<button type="button" class="queue-link" data-admin-section="${escapeHtml(section)}">
      <strong>${escapeHtml(label)}</strong><span>${escapeHtml(copy)}</span><span aria-hidden="true">View queue</span>
    </button>`;
  }

  function reportingWindow() {
    const days = Number($('#date-range').value || 30);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const previousTo = new Date(from);
    const previousFrom = new Date(previousTo.getTime() - days * 86_400_000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: previousTo.toISOString(),
    };
  }

  async function api(path, body = {}) {
    const token = state.session?.access_token;
    if (!token) throw new Error('Administrator sign-in is required.');
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Request-ID': uuidKey(),
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'Administrator request failed.');
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  async function loadReport(force = false) {
    if (state.report && !force) return state.report;
    $('#dashboard-view').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    const payload = await api('/admin/dashboard', reportingWindow());
    state.report = payload.report;
    const meta = state.report.meta || {};
    $('#freshness b').textContent = meta.data_collection_start
      ? `Updated ${dateTime(meta.generated_at)}`
      : 'No verified analytics events yet';
    $('#system-banner').textContent = meta.data_collection_start
      ? `Data available since ${dateTime(meta.data_collection_start)}. Times shown in Asia/Manila.`
      : 'Analytics collection has no verified events yet. Historical figures are not fabricated.';
    return state.report;
  }

  async function loadOperational(section, force = false, search = null) {
    const key = `${section}:${search || ''}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/data', { section, search, limit: 100, offset: 0 });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadUserDirectory(force = false, search = state.userSearch) {
    const normalizedSearch = String(search || '').trim();
    const key = `directory:${normalizedSearch}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/user-directory', {
      search: normalizedSearch,
      limit: 100,
      offset: 0,
      requestKey: uuidKey(),
    });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadPhase4Operational(section, force = false, search = null) {
    const premiumStatus = section === 'access' ? state.premiumStatus : 'all';
    const key = `phase4:${section}:${search || ''}:${premiumStatus}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/phase4-data', {
      section,
      search: search || '',
      limit: 100,
      offset: 0,
      premiumStatus,
    });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  async function loadForumModeration(force = false) {
    const window = reportingWindow();
    const key = `quorum:${window.from}:${window.to}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const [queue, analytics] = await Promise.all([
      api('/admin/quorum', {
        operation: 'queue',
        payload: { status: 'pending' },
      }),
      api('/admin/quorum', {
        operation: 'analytics',
        payload: { from: window.from, to: window.to },
      }),
    ]);
    const data = { queue: queue.data, analytics: analytics.data };
    state.operational.set(key, data);
    return data;
  }

  function renderExecutive(report) {
    const current = report.current || {};
    const previous = report.previous || {};
    const traffic = current.traffic || {};
    const priorTraffic = previous.traffic || {};
    const funnel = current.funnel || {};
    const learning = current.learning || {};
    const reliability = current.reliability || {};
    const engagement = report.engagement || report.engagementOverview || {};
    const betaAllAccess = report.betaAllAccess || {};
    const betaEnabled = betaAllAccess.enabled === true;
    const founderAuthorized = ['founder_admin', 'super_admin'].includes(state.authorization?.role);
    return `
      ${heading('Operating position', 'Verified acquisition, engagement, learning, and service indicators for the selected period.')}
      <div class="metric-strip">
        ${metric('Current viewers', report.realtime?.current_viewers)}
        ${metric('Page views', traffic.page_views, priorTraffic.page_views)}
        ${metric('Unique visitors', traffic.unique_visitors, priorTraffic.unique_visitors)}
        ${metric('Registrations', funnel.registrations, previous.funnel?.registrations)}
        ${metric('Successful grades', learning.successful_grades, previous.learning?.successful_grades)}
        ${metric('Grading success rate', reliability.success_rate, previous.reliability?.success_rate, percentage)}
      </div>
      <div class="metric-strip">
        ${metric('Accounts signed in', engagement.signedInAccounts, null, number, {
          copy: 'All-time count of non-anonymous accounts with a recorded successful sign-in.',
          source: 'Supabase Auth account records',
        })}
        ${metric('Users who answered', engagement.usersWithAnswers, null, number, {
          copy: 'All-time count of users with at least one persisted non-blank answer.',
          source: 'Persisted practice and formal-examination answers',
        })}
        ${metric('Questions answered', engagement.questionsAnswered, null, number, {
          copy: 'All persisted non-blank practice and formal-examination answers.',
          source: 'Persisted practice and formal-examination answers',
        })}
        ${metric('Practice answers', engagement.practiceQuestionsAnswered)}
        ${metric('Formal exam answers', engagement.examinationQuestionsAnswered)}
        <button type="button" class="metric" data-admin-section="users">
          <small>Student details</small><strong>View</strong><em>Exact emails and per-user counts</em>
          <span class="metric-cue">Open Students</span>
        </button>
      </div>
      <section class="panel">
        <h3>Beta All Access</h3>
        <div class="notice ${betaEnabled ? '' : 'danger'}">
          <strong>${betaEnabled ? 'Enabled for all current and future signed-in users.' : 'Disabled — legacy per-account access rules are active.'}</strong>
          ${betaEnabled
            ? ' Access has no automatic per-user expiration while this protected setting remains enabled.'
            : ' Re-enable only after reviewing the effect on every learner.'}
        </div>
        <dl class="definition-list">
          <dt>Coverage</dt><dd>${escapeHtml(betaAllAccess.scope || 'Not available')}</dd>
          <dt>Automatic expiry</dt><dd>${betaEnabled ? 'None' : 'Legacy rules apply'}</dd>
          <dt>Signed-in accounts covered</dt><dd>${escapeHtml(number(betaAllAccess.signedInAccountCount ?? engagement.signedInAccounts))}</dd>
          <dt>Legal requirement</dt><dd>Current Beta Terms and Privacy Notice must still be accepted.</dd>
          <dt>Terms summary</dt><dd>Free through at least August 15, 2026 and may continue until developers determine beta testing is sufficient.</dd>
          <dt>Last changed</dt><dd>${escapeHtml(dateTime(betaAllAccess.updatedAt))}</dd>
        </dl>
        ${founderAuthorized ? `<div class="dialog-actions">
          ${actionButton(
            betaEnabled ? 'Disable Beta All Access' : 'Enable Beta All Access',
            'global_beta_change',
            'global_beta_all_access',
            { currentEnabled: betaEnabled, enabled: !betaEnabled },
          ).value}
        </div>` : ''}
      </section>
      <div class="work-grid">
        <section class="panel">
          <h3>Activation funnel</h3>
          ${barList([
            ['Eligible guest sessions', funnel.eligible_guest_sessions],
            ['First successful grade', funnel.guest_first_successful_grade],
            ['Third successful guest grade', funnel.guest_third_successful_grade],
            ['Limit reached', funnel.limit_reached],
            ['Sign-in started', funnel.sign_in_started],
            ['Sign-in completed', funnel.sign_in_completed],
            ['Onboarding completed', funnel.onboarding_completed],
          ])}
        </section>
        <section class="panel">
          <h3>Action queue</h3>
          <div class="queue-grid">
            ${queueLink('Support', `${number(report.queues?.pending_support)} open cases`, 'support')}
            ${queueLink('Corrections', `${number(report.queues?.pending_corrections)} pending editorial reviews`, 'corrections')}
            ${queueLink('Recovery', `${number(report.queues?.open_recovery_cases)} open cases; final transfer disabled`, 'support')}
            ${queueLink('Manual access', `${number(report.queues?.active_manual_entitlements)} active entitlements`, 'subscriptions')}
          </div>
        </section>
      </div>
      <section class="panel">
        <h3>Commercial truth</h3>
        <div class="notice">${escapeHtml(report.financial?.paid_subscribers_status || 'Paid subscribers: Not connected — payment integration pending.')}</div>
        <p class="panel-note">Revenue, MRR, ARR, ARPU, and paid churn remain “No verified data” until verified financial records exist.</p>
      </section>`;
  }

  function barList(rows) {
    const maximum = Math.max(1, ...rows.map((row) => Number(row[1]) || 0));
    if (!rows.some((row) => Number(row[1]) > 0)) return empty('No verified events in this period.');
    return `<div class="bar-list">${rows.map(([label, value]) => `
      <button type="button" class="bar-row" data-insight="${insightData(label, number(value), {
    copy: 'Verified event count for this step in the selected reporting period.',
    source: 'Due Diligence production event aggregate',
  })}"><span>${escapeHtml(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, (Number(value) || 0) / maximum * 100)}%"></span></span>
        <strong>${number(value)}</strong></button>`).join('')}</div>`;
  }

  function renderRealtime(report) {
    const current = report.current?.traffic || {};
    const previous = report.previous?.traffic || {};
    return `
      ${heading('Live Activity', 'Current viewers use the last five minutes of visible-page session heartbeats. Sessions are not page views.')}
      <div class="metric-strip">
        ${metric('Current viewers', report.realtime?.current_viewers)}
        ${metric('Sessions', current.sessions, previous.sessions)}
        ${metric('Average daily views', current.average_daily_views, previous.average_daily_views, (v) => number(v, 1))}
        ${metric('Average daily visitors', current.average_daily_unique_visitors, previous.average_daily_unique_visitors, (v) => number(v, 1))}
        ${metric('DAU / MAU', current.dau_mau_ratio, previous.dau_mau_ratio, percentage)}
        ${metric('WAU / MAU', current.wau_mau_ratio, previous.wau_mau_ratio, percentage)}
      </div>
      <div class="work-grid">
        <section class="panel"><h3>Authenticated versus guest</h3>${barList([
          ['Authenticated sessions', current.authenticated_sessions],
          ['Guest sessions', current.guest_sessions],
        ])}</section>
        <section class="panel"><h3>Device category</h3>${barList((report.devices || []).map((row) => [row.category, row.sessions]))}</section>
      </div>
      <section class="panel"><h3>Methodology</h3><p class="panel-note">Page views are validated page-view events. Unique visitors use privacy-safe first-party visitor IDs, with signed-in sessions deduplicated by user UUID. Median abandoned-session duration is capped at four hours. No raw IP, full user agent, answer, prompt, draft, email, token, or secret is stored.</p></section>`;
  }

  function renderAcquisition(report) {
    const funnel = report.current?.funnel || {};
    const retention = report.current?.retention || {};
    const retentionRows = ['d1', 'd7', 'd30'].map((horizon) => {
      const value = retention[horizon] || {};
      return [
        horizon.toUpperCase(),
        value.eligible_cohort == null ? 'Not available' : number(value.eligible_cohort),
        value.retained == null ? 'Not available' : number(value.retained),
        value.rate == null
          ? (value.matured ? 'Not available — insufficient sample' : 'Not available — cohort not mature')
          : percentage(value.rate),
      ];
    });
    return `
      ${heading('Visitors & Sign-ups', 'Sanitized sources and activation steps. A zero denominator is reported as unavailable, never as infinity.')}
      <div class="work-grid">
        <section class="panel"><h3>Source and medium</h3>${table(
          ['Source', 'Medium', 'Sessions'],
          (report.acquisition || []).map((row) => [row.source, row.medium, number(row.sessions)]),
        )}</section>
        <section class="panel"><h3>Guest-to-registration funnel</h3>${barList([
          ['Sign-in prompted', funnel.sign_in_prompted],
          ['Sign-in started', funnel.sign_in_started],
          ['Sign-in completed', funnel.sign_in_completed],
          ['Registrations', funnel.registrations],
          ['Onboarding completed', funnel.onboarding_completed],
        ])}</section>
      </div>
      <section class="panel"><h3>Conversion quality</h3>
        <div class="metric-strip">
          ${metric('Prompt-to-registration', funnel.registration_conversion_rate, null, percentage)}
          ${metric('Onboarding completion', funnel.onboarding_completion_rate, null, percentage)}
          ${metric('Guest activation', funnel.guest_activation_rate, null, percentage)}
        </div>
      </section>
      <section class="panel"><h3>Retention maturity</h3>
        ${table(['Cohort horizon', 'Eligible cohort', 'Retained', 'Verified rate'], retentionRows)}
        <p class="panel-note">D1, D7, and D30 require a fully elapsed cohort and at least five eligible privacy-safe identities. Immature or undersized cohorts are never labeled failed retention.</p>
      </section>`;
  }

  function cellText(cell) {
    if (cell == null || cell === '') return 'Not available';
    if (Array.isArray(cell)) return cell.map(cellText).join(', ');
    if (typeof cell === 'object') {
      try { return JSON.stringify(cell); } catch { return 'Structured record'; }
    }
    return String(cell);
  }

  function table(headers, rows) {
    if (!rows?.length) return empty('No verified records are available.');
    return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index] || `Column ${index + 1}`)}">${cell?.html === true ? cell.value : escapeHtml(cellText(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function actionButton(label, action, target, payload = {}) {
    return {
      html: true,
      value: `<span class="row-actions"><button type="button" data-admin-action="${escapeHtml(action)}" data-target="${escapeHtml(target || '')}" data-payload="${escapeHtml(JSON.stringify(payload))}">${escapeHtml(label)}</button></span>`,
    };
  }

  async function renderUsers() {
    const data = await loadUserDirectory();
    const founderAuthorized = ['founder_admin', 'super_admin'].includes(state.authorization?.role);
    const rows = (data.items || []).map((user) => [
      user.display_name || 'Not provided',
      user.email,
      user.school || 'Not provided',
      dateTime(user.last_sign_in_at),
      number(user.practice_answered_count),
      number(user.examination_answered_count),
      number(user.answered_question_count),
      dateTime(user.last_answered_at),
      {
        html: true,
        value: `<div class="row-actions">
          ${founderAuthorized
            ? actionButton('Download Q&A', 'user_response_export', user.id, {
              displayName: user.display_name || 'Not provided',
            }).value
            : ''}
          ${state.authorization?.role === 'super_admin' && user.role !== 'super_admin'
            ? actionButton('Change role', 'role_change', user.id, { role: user.role }).value
            : ''}
        </div>`,
      },
    ]);
    return `
      ${heading('Students', 'Authorized administrators can view exact Docket emails. Directory access and downloads are capability-restricted, rate-limited, and audited.')}
      <div class="table-tools"><input id="user-search" type="search" value="${escapeHtml(state.userSearch)}" placeholder="Search name, school, or email" aria-label="Search users"><button class="secondary-button" id="user-search-button">Search</button><button class="secondary-button" id="user-directory-export" type="button">Download Students CSV</button></div>
      ${table(['Name', 'Email', 'School', 'Last sign-in', 'Practice answers', 'Formal answers', 'Total answered', 'Last answered', 'Action'], rows)}
      <p class="panel-note">Showing ${number((data.items || []).length)} of ${number(data.total)} registered user account(s). The CSV opens directly in Google Sheets and includes all matching records, up to the secure export limit.</p>
      ${founderAuthorized ? `<section class="panel">
        <h3>Email the Students directory to a founder</h3>
        <p class="panel-note">Manual only. The recipient is selected from the approved founder list; the exact email address is resolved securely by the Worker and is not stored in the page.</p>
        <form class="exam-admin-form" id="user-directory-email-form">
          <label>Founder personal email
            <select id="user-directory-email-recipient" required>
              <option value="">Select founder…</option>
              <option value="wally">Wally</option>
              <option value="gilmar">Gilmar</option>
              <option value="ice">Ice</option>
              <option value="emrico">Emrico</option>
            </select>
          </label>
          <label>Audit reason<textarea id="user-directory-email-reason" minlength="5" maxlength="1000" required></textarea></label>
          <label class="check-row"><input id="user-directory-email-confirm" type="checkbox" required> I am authorized to send this exact-email directory to the selected founder.</label>
          <button class="secondary-button" type="submit">Email Students CSV</button>
        </form>
      </section>` : ''}`;
  }

  function renderAnswerExports(report) {
    const engagement = report.engagement || report.engagementOverview || {};
    return `
      ${heading('Answer Exports', 'Founder-only download of persisted student answer history. This reporting tool does not change questions, grading, suggested answers, model answers, or simulator behavior.')}
      <div class="metric-strip">
        ${metric('Users who answered', engagement.usersWithAnswers)}
        ${metric('Questions answered', engagement.questionsAnswered)}
        ${metric('Practice answers', engagement.practiceQuestionsAnswered)}
        ${metric('Formal exam answers', engagement.examinationQuestionsAnswered)}
      </div>
      <section class="panel">
        <h3>Download complete answer history</h3>
        <p class="panel-note">The Google Sheets-compatible CSV includes, where the source record stores them: exact user email, question text, submitted answer, grade or score, grading feedback, suggested answer, model answer, subject and examination context, record type, and timestamps. A missing source field is exported as unavailable; it is never invented.</p>
        <form class="exam-admin-form" id="answer-history-export-form">
          <div class="panel-grid">
            <label>From date (optional)<input id="answer-history-from" type="date"></label>
            <label>Through date (optional, inclusive)<input id="answer-history-to" type="date"></label>
          </div>
          <label>Audit reason<textarea id="answer-history-reason" minlength="5" maxlength="1000" required></textarea></label>
          <label class="check-row"><input id="answer-history-confirm" type="checkbox" required> I am authorized to download private student work and will store it securely.</label>
          <button class="primary-button" type="submit">Download all answer records</button>
        </form>
      </section>
      <section class="panel">
        <h3>Export definitions</h3>
        ${table(['Field', 'Meaning'], [
          ['Question', 'The stored question text linked to the answer record.'],
          ['Student answer', 'The learner’s persisted non-blank submission.'],
          ['Grade and feedback', 'Stored result only; unavailable when no assessment was completed.'],
          ['Suggested answer', 'Stored suggested-answer material where that grading path persisted it.'],
          ['Model answer', 'Stored model answer where the applicable source record contains or links one.'],
        ])}
      </section>`;
  }

  async function renderLearning(report) {
    const data = await loadOperational('learning');
    const current = report.current?.learning || {};
    return `
      ${heading('Performance', 'Scores remain on the existing 0–5 scale with one-decimal display. Failed, timed-out, blocked, missing, and ungraded requests are excluded from score averages.')}
      <div class="metric-strip">
        ${metric('Attempt average', current.attempt_average, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Mastery average', current.mastery_average, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Median score', current.median_score, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Score sample', current.sample_size)}
        ${metric('Latest-answer sample', current.mastery_sample_size)}
        ${metric('Repeated-question improvement', current.average_improvement, null, (v) => v == null ? 'Not available' : `${Number(v) >= 0 ? '+' : ''}${number(v, 1)}`)}
        ${metric('Questions viewed', current.questions_viewed)}
        ${metric('Successful grades', current.successful_grades)}
        ${metric('Learners with grades', data.total)}
      </div>
      ${table(
        ['Learner', 'Masked email', 'School', 'Attempt average', 'Attempts', 'Unique questions', 'Latest'],
        (data.items || []).map((row) => [
          row.display_name, row.masked_email, row.school || 'Not provided',
          `${number(row.attempt_average, 1)} / 5`, number(row.successful_attempts),
          number(row.unique_questions), dateTime(row.last_attempt_at),
        ]),
      )}
      <p class="panel-note">Mastery uses the latest successful score per privacy-safe learner and unique question. Improvement compares first and latest successful attempts only for repeated questions; sample sizes remain visible.</p>`;
  }

  function renderSubjects(report) {
    return `
      ${heading('Question Bank', 'Content counts come from the published Website Upload bank; database inventory is shown separately for operational transparency.')}
      <div class="metric-strip">
        ${metric('Published subjects', report.inventory?.public_subjects)}
        ${metric('Published questions', report.inventory?.public_question_bank)}
        ${metric('Database subjects', report.inventory?.database_subjects)}
        ${metric('Database questions', report.inventory?.database_questions)}
      </div>
      ${table(
        ['Subject', 'Views', 'Grading starts', 'Successful', 'Failures', 'Average', 'Reliability'],
        (report.subjects || []).map((row) => [
          row.subject, number(row.question_views), number(row.grading_starts),
          number(row.successful_grades), number(row.failures),
          row.attempt_average == null ? 'Not available' : `${number(row.attempt_average, 1)} / 5`,
          row.low_sample ? 'Low sample — directional only' : `n=${number(row.sample_size)}`,
        ]),
      )}
      <p class="panel-note">Question difficulty and correction-rate labels require at least five successful score samples and remain directional until a stricter editorial threshold is approved. Corrections never alter the live bank automatically.</p>`;
  }

  function renderReliability(report) {
    const reliability = report.current?.reliability || {};
    return `
      ${heading('AI Grading Health', 'Service telemetry, not a guaranteed uptime monitor. Provider bodies, prompts, answers, credentials, and stack traces are excluded.')}
      <div class="metric-strip">
        ${metric('Grading starts', reliability.grading_started)}
        ${metric('Successes', reliability.grading_success)}
        ${metric('Failures', reliability.grading_failure)}
        ${metric('Timeouts', reliability.grading_timeout)}
        ${metric('P50 latency', reliability.p50_latency_ms, null, (v) => v == null ? 'Not available' : `${number(v)} ms`)}
        ${metric('P95 latency', reliability.p95_latency_ms, null, (v) => v == null ? 'Not available' : `${number(v)} ms`)}
      </div>
      ${table(
        ['Model', 'Successful grades', 'Failures', 'P95 latency'],
        (report.models || []).map((row) => [
          row.model, number(row.successful_grades), number(row.failures),
          row.p95_latency_ms == null ? 'Not available' : `${number(row.p95_latency_ms)} ms`,
        ]),
      )}
      <div class="notice">AI monetary cost: Not configured. No estimate is shown until an approved provider-pricing configuration exists.</div>
      <p class="panel-note">Last successful grade: ${escapeHtml(dateTime(reliability.last_successful_grade))}</p>`;
  }

  async function renderSubscriptions(report) {
    const data = await loadPhase4Operational('access');
    const premium = data.premiumSummary || {};
    const betaAllAccess = report.betaAllAccess || {};
    const globalBetaEnabled = betaAllAccess.enabled === true;
    state.subscriptionRows.clear();
    const rows = (data.items || []).map((row) => {
      state.subscriptionRows.set(row.user_id, Object.freeze({ ...row }));
      return [
        row.display_name || 'Not provided',
        row.role,
        globalBetaEnabled ? 'Not applicable — global access' : row.trial_expires_at ? dateTime(row.trial_expires_at) : 'Not started',
        globalBetaEnabled ? 'Covered globally — no expiration' : row.free_beta_enabled ? `Enabled${row.free_beta_expires_at ? ` until ${dateTime(row.free_beta_expires_at)}` : ' — no expiration'}` : 'Disabled',
        row.plan_code || 'None',
        row.subscription_source === 'complimentary'
          ? 'Complimentary Beta'
          : row.subscription_source === 'manual_payment'
            ? 'Paid'
            : row.subscription_source || 'Not available',
        { html: true, value: `<span class="status ${row.subscription_status === 'active' ? 'ok' : 'warn'}">${escapeHtml(row.subscription_status || 'none')}</span>` },
        row.expires_at ? dateTime(row.expires_at) : 'Not available',
        {
          html: true,
          value: `<div class="row-actions" data-subscription-actions-for="${escapeHtml(row.user_id)}" aria-label="Retainer actions for ${escapeHtml(row.display_name || row.user_id)}"></div>`,
        },
      ];
    });
    return `
      ${heading('Retainer Management', 'Founder actions are immediate, reason-required, transactional, and audited. Manual payments never renew automatically.')}
      <div class="notice ${globalBetaEnabled ? '' : 'danger'}"><strong>Beta All Access is ${globalBetaEnabled ? 'enabled' : 'disabled'}.</strong> ${globalBetaEnabled
        ? 'Every current and future signed-in user is covered with no automatic per-user expiration. Legacy rows below are retained only as fallback records.'
        : 'The legacy per-user trial, Free Beta, and Retainer rules below currently determine access.'}</div>
      <div class="notice danger"><strong>Access-impacting action.</strong> Verify the student, plan, dates, and reason before confirming.</div>
      <div class="metric-strip">
        ${metric('Premium active', premium.active)}
        ${metric('Premium pending', premium.pending)}
        ${metric('Premium expired', premium.expired)}
        ${metric('Premium suspended', premium.suspended)}
        ${metric('Premium revoked', premium.revoked)}
        ${metric('Premium beta', premium.beta)}
      </div>
      <div class="table-tools">
        <label>Premium status
          <select id="premium-status-filter">
            ${['all','active','pending','expired','suspended','revoked','beta'].map((status) => `
              <option value="${status}"${state.premiumStatus === status ? ' selected' : ''}>
                ${status === 'all' ? 'All users' : status}
              </option>`).join('')}
          </select>
        </label>
      </div>
      ${table(['Student', 'Role', 'Legacy trial', 'Legacy per-user beta', 'Plan', 'Source', 'Retainer status', 'Expires', 'Actions'], rows)}
      <section class="panel">
        <h3>Production plan catalog</h3>
        ${table(['Plan', 'Planning price', 'Status'], config.plans.items.map((plan) => [
          plan.name, `₱${number(plan.pricePhp, 2)}`,
          plan.previewStatus === 'disabled' ? 'Unavailable' : 'Active · manual verification',
        ]))}
      </section>
      <section class="panel"><h3>Refund policy</h3><p class="panel-note">Five-calendar-day cancellations suggest an 80% refund. Later requests use unused time and documented consumption. A verified 20-day continuous outage supports prorated refund or equivalent extension. All decisions require Founder documentation.</p></section>`;
  }

  async function renderPayments() {
    const data = await loadPhase4Operational('payments');
    return `
      ${heading('Payment Review', 'Review GCash and MariBank requests. Private proofs open through five-minute signed links and every view is audited.')}
      <div class="notice danger"><strong>Money and access warning.</strong> Approval activates the exact selected plan. Premium requires an explicit expiration. Confirm channel, amount, reference, date, proof, and access end date before proceeding.</div>
      ${table(
        ['Student', 'Plan', 'Amount', 'Channel', 'Date', 'Reference', 'Status', 'Submitted', 'Actions'],
        (data.items || []).map((row) => [
          row.display_name || 'Not provided', row.plan_code,
          `₱${number(row.trusted_amount_php,2)}`, row.payment_method,
          row.payment_date, row.transaction_reference,
          { html: true, value: `<span class="status ${row.status === 'approved' ? 'ok' : row.status === 'rejected' ? 'danger' : 'warn'}">${escapeHtml(row.status)}</span>` },
          dateTime(row.submitted_at),
          {
            html: true,
            value: `<div class="row-actions">
              ${actionButton('Review', 'payment_review', row.id, {
                status: row.status,
                planCode: row.plan_code,
              }).value}
              ${actionButton('View private proof', 'view_payment_proof', row.id, {}).value}
            </div>`,
          },
        ]),
      )}`;
  }

  async function renderRefunds() {
    const data = await loadPhase4Operational('refunds');
    return `
      ${heading('Refunds', 'Apply the published Philippine-peso policy, document consumption and outage evidence, and preserve statutory remedies.')}
      ${table(
        ['Student', 'Paid', 'Suggested', 'Approved', 'Status', 'Calculation', 'Submitted', 'Action'],
        (data.items || []).map((row) => [
          row.display_name || row.user_id, `₱${number(row.paid_amount_php,2)}`,
          `₱${number(row.suggested_refund_php,2)}`,
          row.approved_refund_php == null ? 'Pending decision' : `₱${number(row.approved_refund_php,2)}`,
          row.status, row.calculation_note, dateTime(row.submitted_at),
          actionButton('Review', 'refund_review', row.id, {
            status: row.status,
            suggestedRefundPhp: row.suggested_refund_php,
            approvedRefundPhp: row.approved_refund_php,
          }),
        ]),
      )}`;
  }

  async function renderSupport() {
    const [support, recovery] = await Promise.all([
      loadOperational('support'),
      has('account_recovery_admin') ? loadOperational('recovery') : Promise.resolve({ items: [], total: 0 }),
    ]);
    const supportRows = (support.items || []).map((row) => [
      row.category, row.message, row.priority,
      { html: true, value: `<span class="status ${row.overdue_24h ? 'danger' : 'warn'}">${escapeHtml(row.status)}</span>` },
      dateTime(row.created_at), row.overdue_24h ? 'Overdue' : 'Within target',
      actionButton('Update', 'support_update', row.id, { status: row.status, priority: row.priority }),
    ]);
    return `
      ${heading('Support Requests', 'Resolve only what is necessary. Support content may contain personal context and is limited to authorized operators.')}
      <div class="notice"><strong>Public recovery copy:</strong> Contact Support. We respond within 24 hours.</div>
      ${table(['Category', 'Message', 'Priority', 'Status', 'Created', '24-hour target', 'Action'], supportRows)}
      <section class="panel">
        <h3>Recovery cases</h3>
        <div class="notice danger">Final identity transfer is disabled. Current Supabase same-UUID Google identity handoff has not been proven safe.</div>
        ${table(
          ['Case', 'User UUID', 'Status', 'Updated', 'Transfer'],
          (recovery.items || []).map((row) => [
            row.id, row.user_id, row.status, dateTime(row.updated_at), 'Disabled',
          ]),
        )}
        <p class="panel-note">A Support request alone never authorizes transfer. Case management preserves the immutable user account, but no final transfer action exists.</p>
      </section>`;
  }

  async function renderCorrections() {
    const data = await loadOperational('corrections');
    const rows = (data.items || []).map((row) => [
      row.question_bank_id, row.subject, row.correction_type,
      row.proposed_correction, row.explanation,
      {
        html: true,
        value: (row.source_urls || []).map((url) => {
          try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) return '';
            return `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">Source</a>`;
          } catch { return ''; }
        }).join(' · ') || 'None supplied',
      },
      row.status,
      actionButton('Review', 'correction_review', row.id, { status: row.status }),
    ]);
    return `
      ${heading('Answer Corrections', 'Accept or reject is an editorial decision only. It never modifies live questions or suggested answers automatically.')}
      ${table(['Question', 'Subject', 'Type', 'Proposed correction', 'Explanation', 'Sources', 'Status', 'Action'], rows)}`;
  }

  async function renderPartnerships() {
    const data = await loadPhase4Operational('partnerships');
    return `
      ${heading('Partnerships', 'Native institutional, academic, content, technology, and media inquiries. Contact details are operationally sensitive and access is audited.')}
      ${table(
        ['Type','Contact','Email','Organization','Message','Verified','Status','Assignee','Created','Action'],
        (data.items || []).map((row) => [
          row.inquiry_type, row.contact_name, row.contact_email,
          row.organization || 'Not provided', row.message,
          row.contact_verified ? 'Yes' : 'No', row.status,
          row.assignee_user_id || 'Unassigned', dateTime(row.created_at),
          actionButton('Update', 'partnership_update', row.id, {
            status: row.status,
            contactVerified: row.contact_verified,
            assigneeUserId: row.assignee_user_id,
          }),
        ]),
      )}`;
  }

  async function renderControls() {
    const data = await loadOperational('controls');
    const allowed = [
      ['announcement_text', 'Announcement text'],
      ['beta_label', 'Beta label'],
      ['support_availability_message', 'Support availability message'],
      ['pricing_section_visible', 'Pricing-section visibility'],
      ['promotional_content_visible', 'Approved promotional content visibility'],
      ['future_feature_status', 'Future-feature status'],
    ];
    return `
      ${heading('Website Settings', 'Only allowlisted, non-destructive content is accepted. Raw HTML, scripts, SQL, secrets, grading prompts, security settings, and guest-limit values are forbidden.')}
      ${table(
        ['Control', 'Current value', 'Published', 'Updated', 'Action'],
        allowed.map(([key, label]) => {
          const item = (data.items || []).find((row) => row.control_key === key);
          return [
            label, item ? JSON.stringify(item.value) : 'Not configured',
            item?.is_published ? 'Yes' : 'No', dateTime(item?.updated_at),
            actionButton('Configure', 'website_control_update', '', {
              control_key: key,
              value: item?.value || {},
              is_published: Boolean(item?.is_published),
            }),
          ];
        }),
      )}
      <section class="panel"><h3>Roadmap extension points</h3><p class="panel-note">Prepared, but not active: automated payment providers, renewals, coaching scheduling, organizations and Bar Operations cohorts, institution dashboards, notifications, editorial CMS, experiments, daily rollups, and privacy-aware retention automation.</p></section>`;
  }

  async function renderSecurity() {
    const data = await loadOperational('security');
    return `
      ${heading('Access & Activity Log', 'Only the Super Admin may grant administrator roles or capabilities. Administrators cannot grant privileges to themselves or create another Super Admin.')}
      <div class="notice">Wally remains the sole Super Admin. Founder Admin assignments use verified account identities; no founder email is hardcoded in authorization logic.</div>
      ${table(
        ['Time', 'Action', 'Actor', 'Record type', 'Record', 'Reason'],
        (data.items || []).map((row) => [
          dateTime(row.occurred_at), humanizeAuditValue(row.action_type),
          row.actor_user_id ? maskOperationalIdentifier(row.actor_user_id, 'Administrator') : 'System',
          humanizeAuditValue(row.target_resource_type), auditTargetLabel(row),
          row.reason || 'Not provided',
        ]),
      )}
      <section class="panel"><h3>Capability model</h3><p class="panel-note">Founder and Super Admins receive full operational access. Limited Admin accounts receive only explicitly assigned, revocable capabilities.</p></section>`;
  }

  function forumActionButtons(row) {
    const actions = [];
    const addAction = (label, action, target, payload = {}) => {
      const control = actionButton(label, action, target, payload).value;
      actions.push(control.replace(/^<span class="row-actions">|<\/span>$/g, ''));
    };
    if (row.contentStatus === 'visible') {
      addAction('Hide', 'forum_hide_content', row.id);
    } else {
      addAction('Restore', 'forum_restore_content', row.id);
    }
    if (row.contentStatus !== 'removed') {
      addAction('Remove', 'forum_remove_content', row.id);
    }
    if (row.status === 'pending') {
      addAction('Dismiss report', 'forum_dismiss_report', row.id);
    }
    addAction('Restrict author', 'forum_restrict_user', row.id, {
      durationHours: 24,
    });
    return { html: true, value: `<span class="row-actions">${actions.join('')}</span>` };
  }

  async function renderForumModeration() {
    const data = await loadForumModeration();
    const reportRows = (data.reports || []).map((row) => [
      dateTime(row.createdAt),
      row.targetType,
      row.category,
      row.explanation || 'No explanation supplied',
      row.content || 'Content is unavailable',
      `${row.author?.displayName || 'Due Diligence Member'}${row.author?.school ? ` · ${row.author.school}` : ''}`,
      row.contentStatus || 'Unavailable',
      row.status,
      forumActionButtons(row),
    ]);
    const restrictionRows = (data.restrictions || []).map((row) => [
      `${row.displayName || 'Due Diligence Member'}${row.school ? ` · ${row.school}` : ''}`,
      row.reason,
      dateTime(row.restrictedUntil),
      actionButton('Remove restriction', 'forum_remove_restriction', row.id),
    ]);
    return `
      ${heading('Quorum Moderation', 'Founder and Super Admin review only. Reports never reveal the reporting member, and moderation never changes subscriptions or examination records.')}
      <div class="notice"><strong>Quorum safeguards:</strong> Plain-text publishing, source-link validation, persistent rate limits, duplicate throttling, private reporting, posting restrictions, and audited moderation are active.</div>
      <section class="panel">
        <h3>Reported posts and comments</h3>
        ${table(
          ['Reported', 'Type', 'Category', 'Explanation', 'Content', 'Author', 'Content state', 'Report state', 'Actions'],
          reportRows,
        )}
      </section>
      <section class="panel">
        <h3>Active posting restrictions</h3>
        ${table(['Member', 'Reason', 'Restricted until', 'Action'], restrictionRows)}
      </section>`;
  }

  function quorumModerationActions(row) {
    const actions = [];
    const add = (label, action, target, payload = {}) => {
      const html = actionButton(label, action, target, payload).value;
      actions.push(html.replace(/^<span class="row-actions">|<\/span>$/g, ''));
    };
    const suffix = row.targetType === 'entry'
      ? 'entry'
      : row.targetType === 'comment' ? 'comment' : 'circle';
    if (['visible', 'active'].includes(row.contentStatus)) {
      add('Hide', `quorum_hide_${suffix}`, row.targetId);
    } else {
      add('Restore', `quorum_restore_${suffix}`, row.targetId);
    }
    if (row.contentStatus !== 'removed') add('Remove', `quorum_remove_${suffix}`, row.targetId);
    if (row.targetType === 'entry') {
      add(
        row.commentsLocked ? 'Unlock comments' : 'Lock comments',
        row.commentsLocked ? 'quorum_unlock_comments' : 'quorum_lock_comments',
        row.targetId,
      );
      add('Citation checked', 'quorum_set_indicator', row.targetId, {
        indicator: 'citation_checked',
        enabled: true,
      });
      add('Community correction', 'quorum_set_indicator', row.targetId, {
        indicator: 'community_correction',
        enabled: true,
      });
      add('Moderator reviewed', 'quorum_set_indicator', row.targetId, {
        indicator: 'moderator_reviewed',
        enabled: true,
      });
    }
    if (row.status === 'pending') add('Dismiss report', 'quorum_dismiss_report', row.reportId);
    if (row.author?.memberId) {
      add('Restrict author', 'quorum_restrict_user', row.author.memberId, { durationHours: 24 });
      add(
        row.author.verifiedAcademicIdentity ? 'Remove verified identity' : 'Verify academic identity',
        row.author.verifiedAcademicIdentity ? 'quorum_unverify_profile' : 'quorum_verify_profile',
        row.author.memberId,
      );
    }
    return { html: true, value: `<span class="row-actions">${actions.join('')}</span>` };
  }

  async function renderQuorumModeration() {
    const data = await loadForumModeration();
    const queue = data.queue || {};
    const analytics = data.analytics || {};
    const values = analytics.metrics || {};
    const definitions = analytics.definitions || {};
    const metricSource = `Quorum production records; server-generated ${dateTime(analytics.lastUpdatedAt)}`;
    const reportRows = (queue.reports || []).map((row) => [
      dateTime(row.createdAt),
      row.targetType,
      row.category,
      row.explanation || 'No explanation supplied',
      row.content || 'Content is unavailable',
      `${row.author?.displayName || 'Due Diligence Member'}${row.author?.school ? ` · ${row.author.school}` : ''}`,
      row.contentStatus || 'Unavailable',
      row.status,
      quorumModerationActions(row),
    ]);
    const announcementRows = (queue.announcements || []).map((row) => [
      dateTime(row.createdAt),
      row.subject || 'Not classified',
      row.body,
      row.sourceUrl
        ? { html: true, value: `<a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">Review source</a>` }
        : 'No source supplied',
      row.author?.displayName || 'Due Diligence Member',
      {
        html: true,
        value: `<span class="row-actions">
          ${actionButton('Approve', 'quorum_approve_announcement', row.entryId).value}
          ${actionButton('Reject', 'quorum_reject_announcement', row.entryId).value}
        </span>`,
      },
    ]);
    const restrictionRows = (queue.restrictions || []).map((row) => [
      `${row.member?.displayName || 'Due Diligence Member'}${row.member?.school ? ` · ${row.member.school}` : ''}`,
      row.reason,
      dateTime(row.restrictedUntil),
      actionButton('Remove restriction', 'quorum_remove_restriction', row.restrictionId),
    ]);
    return `
      ${heading('Quorum Moderation & Analytics', 'Founder and Super Admin review only. Reporter identity remains private, and moderation never changes subscriptions or examination records.')}
      <div class="notice"><strong>Truthful reporting window:</strong> ${escapeHtml(dateTime(analytics.from))} to ${escapeHtml(dateTime(analytics.to))}. Last updated ${escapeHtml(dateTime(analytics.lastUpdatedAt))}. Every metric opens its definition and source.</div>
      <div class="metric-strip">
        ${metric('Active Quorum users', values.activeUsers, null, number, { copy: definitions.activeUsers, source: metricSource })}
        ${metric('Entries created', values.entries, null, number, { copy: definitions.entries, source: metricSource })}
        ${metric('Comments & replies', values.commentsReplies, null, number, { copy: definitions.commentsReplies, source: metricSource })}
        ${metric('Helpful reactions', values.helpful, null, number, { copy: definitions.helpful, source: metricSource })}
        ${metric('Internal citations', values.citations, null, number, { copy: definitions.citations, source: metricSource })}
        ${metric('Saved authorities', values.saves, null, number, { copy: definitions.saves, source: metricSource })}
        ${metric('Study Circles', values.circles, null, number, { copy: definitions.circles, source: metricSource })}
        ${metric('Reports', values.reports, null, number, { copy: definitions.reports, source: metricSource })}
        ${metric('Moderation actions', values.moderationActions, null, number, { copy: definitions.moderationActions, source: metricSource })}
        ${metric('Unanswered questions', values.unansweredQuestions, null, number, { copy: definitions.unansweredQuestions, source: metricSource })}
        ${metric('Practice conversions', values.practiceConversions, null, number, { copy: definitions.practiceConversions, source: metricSource })}
        ${metric('Failed Quorum API requests', values.failedRequests, null, number, { copy: definitions.failedRequests, source: metricSource })}
      </div>
      <div class="work-grid">
        <section class="panel"><h3>Activity by subject</h3>
          ${(analytics.bySubject || []).length
            ? barList(analytics.bySubject.map((row) => [row.label, row.count]))
            : empty('No data yet for this reporting window.')}
        </section>
        <section class="panel"><h3>Activity by entry type</h3>
          ${(analytics.byEntryType || []).length
            ? barList(analytics.byEntryType.map((row) => [humanizeAuditValue(row.label), row.count]))
            : empty('No data yet for this reporting window.')}
        </section>
      </div>
      <section class="panel">
        <h3>Private moderation queue</h3>
        ${table(
          ['Reported', 'Type', 'Category', 'Explanation', 'Content', 'Author', 'Content state', 'Report state', 'Actions'],
          reportRows,
        )}
      </section>
      <section class="panel">
        <h3>Pending school and Bar announcements</h3>
        ${table(['Submitted', 'Subject', 'Announcement', 'Source', 'Author', 'Actions'], announcementRows)}
      </section>
      <section class="panel">
        <h3>Active posting restrictions</h3>
        ${table(['Member', 'Reason', 'Restricted until', 'Action'], restrictionRows)}
      </section>
      <section class="panel">
        <h3>Recent Quorum activity</h3>
        ${table(
          ['Time', 'Type', 'Record', 'Activity'],
          (analytics.recentActivity || []).map((row) => [
            dateTime(row.occurredAt),
            row.type,
            row.entryId || row.commentId || 'Not available',
            row.label,
          ]),
        )}
      </section>`;
  }

  async function examinationAdmin(operation, payload = {}) {
    const response = await api('/admin/examinations', { operation, ...payload });
    return response.data;
  }

  function examinationReason(form) {
    const reason = String(new FormData(form).get('reason') || '').trim();
    if (reason.length < 5) throw new Error('Provide an audit reason of at least five characters.');
    return reason;
  }

  function examinationOptions(items, valueKey, labelBuilder) {
    return (items || []).map((item) => `<option value="${escapeHtml(item[valueKey])}">
      ${escapeHtml(labelBuilder(item))}
    </option>`).join('');
  }

  async function renderExaminations(force = false) {
    if (!state.examinationData || force) {
      const [dashboard, audit] = await Promise.all([
        examinationAdmin('dashboard'),
        examinationAdmin('audit', { limit: 50, offset: 0 }),
      ]);
      state.examinationData = { ...dashboard, audit: audit.items || [] };
    }
    const data = state.examinationData;
    const definitions = data.definitions || [];
    const versions = data.versions || [];
    const draftVersions = versions.filter((version) => version.status === 'draft');
    const questions = data.approvedQuestions || [];
    const inventory = data.questionInventory || [];
    const recentAttempts = data.recentAttempts || [];
    const assignments = data.examinerAssignments || [];
    const definitionOptions = examinationOptions(
      definitions.filter((exam) => exam.status !== 'closed'),
      'examId',
      (exam) => `${exam.title} · ${exam.status}`,
    );
    const draftOptions = examinationOptions(
      draftVersions,
      'versionId',
      (version) => `${definitions.find((exam) => exam.examId === version.examId)?.title || version.examId} · ${version.label}`,
    );

    return `${heading(
      'Examination Management',
      'Create immutable versions, publish only approved question snapshots, control beta access, and monitor genuine attempts.',
      '<button class="secondary-button" type="button" data-exam-admin-refresh>Refresh examination data</button>',
    )}
      <div class="metric-grid">
        ${metric('Examination definitions', definitions.length)}
        ${metric('Approved source questions', questions.length)}
        ${metric('Queued AI jobs', data.gradingQueue?.queued || 0)}
        ${metric('Pending human reviews', data.gradingQueue?.humanPending || 0)}
      </div>

      <section class="panel">
        <h3>Publication inventory</h3>
        ${inventory.length ? table(
          ['Subject', 'Approved', 'Pending', 'Total'],
          inventory.map((row) => [row.subject, row.approved, row.pending, row.total]),
        ) : empty('No examination-source questions have been imported.')}
        <p class="panel-note">A complete production Midterm or Final requires twenty unique approved questions. Controlled tests remain visibly labeled and may use fewer.</p>
      </section>

      <div class="panel-grid">
        <section class="panel">
          <h3>Create examination definition</h3>
          <form class="exam-admin-form" data-exam-admin-form="create_exam">
            <label>Title<input name="title" minlength="3" maxlength="180" required></label>
            <label>Track<select name="track"><option value="per_subject">Subject Matter</option><option value="bar_feels">Bar Feels</option></select></label>
            <label>Kind<select name="assessmentKind"><option value="midterm">Midterm</option><option value="final">Final</option><option value="curated">Curated</option><option value="system_test">System test</option></select></label>
            <label>Subject<input name="subject" maxlength="120"></label>
            <label>Year level<input name="yearLevel" type="number" min="1" max="4"></label>
            <label class="check-row"><input name="testOnly" type="checkbox" checked> Controlled system test</label>
            <label>Audit reason<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit">Create draft definition</button>
          </form>
        </section>

        <section class="panel">
          <h3>Create immutable version</h3>
          <form class="exam-admin-form" data-exam-admin-form="create_version">
            <label>Examination<select name="examId" required><option value="">Select…</option>${definitionOptions}</select></label>
            <label>Version label<input name="label" value="Controlled beta v1" required></label>
            <label>Duration in minutes<input name="durationMinutes" type="number" min="1" max="240" value="60" required></label>
            <label>Timer mode<select name="timerMode"><option value="strict">Strict Scrutiny</option><option value="selfPaced">Quantum Meruit</option><option value="none">Summary Judgment</option></select></label>
            <label>Grading route<select name="gradingRoute"><option value="either">AI or Human</option><option value="ai">AI Assessment</option><option value="human">Human Examiner</option><option value="provisional">Provisional only</option></select></label>
            <label>Answer release<select name="answerReleaseRule"><option value="after_ai">After AI finalization</option><option value="after_human">After human finalization</option><option value="manual">Manual</option></select></label>
            <label>Instructions<textarea name="instructions" maxlength="8000">Answer every item using ALAC. Review all answers before final submission.</textarea></label>
            <label>Syllabus topics, one per line<textarea name="syllabus" maxlength="4000"></textarea></label>
            <label>Audit reason<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit" ${definitionOptions ? '' : 'disabled'}>Create version</button>
          </form>
        </section>
      </div>

      <section class="panel">
        <h3>Attach approved questions and publish</h3>
        <form class="exam-admin-form exam-admin-question-form" data-exam-admin-form="set_questions">
          <label>Draft version<select name="versionId" required><option value="">Select…</option>${draftOptions}</select></label>
          <label>Approved questions
            <select name="questionIds" multiple size="10" required>
              ${questions.map((question) => `<option value="${escapeHtml(question.questionId)}"
                data-subject="${escapeHtml(question.subject)}">${escapeHtml(`${question.sourceQuestionId} · ${question.subject} · ${question.topic || 'Topic not specified'}`)}</option>`).join('')}
            </select>
          </label>
          <p class="panel-note">Order follows the selected option order. Hold Ctrl or Command to select multiple unique questions.</p>
          <label>Audit reason<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
          <div class="dialog-actions">
            <button class="secondary-button" type="submit" ${draftOptions ? '' : 'disabled'}>Save question order</button>
            <button class="primary-button" type="button" data-exam-admin-publish ${draftOptions ? '' : 'disabled'}>Publish selected draft</button>
          </div>
        </form>
      </section>

      <div class="panel-grid">
        <section class="panel">
          <h3>Availability and lifecycle</h3>
          ${definitions.length ? table(
            ['Examination', 'Track', 'Version', 'Attempts', 'Actions'],
            definitions.map((exam) => [
              `${exam.title}${exam.testOnly ? ' · TEST' : ''}`,
              `${exam.track} / ${exam.assessmentKind}`,
              exam.version ? `${exam.version.label} · ${exam.version.questionCount} questions` : 'No active version',
              `${exam.attemptCounts?.active || 0} active · ${exam.attemptCounts?.submitted || 0} submitted`,
              { html: true, value: `<div class="admin-inline-actions">
                <button type="button" data-exam-lifecycle="set_availability" data-exam-id="${escapeHtml(exam.examId)}">Availability</button>
                <button type="button" data-exam-lifecycle="unpublish_exam" data-exam-id="${escapeHtml(exam.examId)}" ${exam.status !== 'published' ? 'disabled' : ''}>Unpublish</button>
                <button type="button" data-exam-lifecycle="close_exam" data-exam-id="${escapeHtml(exam.examId)}" ${exam.status === 'closed' ? 'disabled' : ''}>Close</button>
              </div>` },
            ]),
            true,
          ) : empty('No examination definitions exist.')}
        </section>
        <section class="panel">
          <h3>Allowlisted beta access</h3>
          <form class="exam-admin-form" data-exam-admin-form="set_beta_access">
            <label>Authenticated user UUID<input name="userId" pattern="[0-9a-fA-F-]{36}" required></label>
            <label class="check-row"><input name="enabled" type="checkbox" checked> Enable examination beta</label>
            <label>Expires at (optional)<input name="expiresAt" type="datetime-local"></label>
            <label>Audit reason<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit">Update beta access</button>
          </form>
          <hr>
          <form class="exam-admin-form" data-exam-admin-form="set_participant">
            <label>Published version<select name="versionId" required><option value="">Select…</option>${examinationOptions(versions.filter((version) => version.status === 'published'), 'versionId', (version) => version.label)}</select></label>
            <label>User UUID<input name="userId" pattern="[0-9a-fA-F-]{36}" required></label>
            <label class="check-row"><input name="enabled" type="checkbox" checked> Permit this participant</label>
            <label>Audit reason<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="secondary-button" type="submit">Update participant</button>
          </form>
        </section>
      </div>

      <section class="panel">
        <h3>Recent genuine attempts and grading state</h3>
        ${recentAttempts.length ? table(
          ['Started', 'Examination', 'Student', 'Status', 'Grading', 'Model answer'],
          recentAttempts.map((attempt) => [
            dateTime(attempt.startedAt),
            `${attempt.title}${attempt.subject ? ` · ${attempt.subject}` : ''}`,
            maskOperationalIdentifier(attempt.userId, 'Student'),
            attempt.status,
            attempt.gradingStatus,
            { html: true, value: `<button type="button" data-exam-release="${escapeHtml(attempt.attemptId)}"
              ${!['submitted', 'expired'].includes(attempt.status) ? 'disabled' : ''}>Release</button>` },
          ]),
          true,
        ) : empty('No examination attempts have been created.')}
      </section>

      <section class="panel">
        <h3>Human examiner assignments</h3>
        ${assignments.length ? table(
          ['Created', 'Assignment', 'Attempt', 'Status', 'Invitation', 'Expires'],
          assignments.map((item) => [
            dateTime(item.createdAt),
            maskOperationalIdentifier(item.assignmentId),
            maskOperationalIdentifier(item.attemptId),
            item.status,
            item.invitationStatus,
            dateTime(item.expiresAt),
          ]),
        ) : empty('No human examiner assignments exist.')}
      </section>

      <section class="panel">
        <h3>Examination audit history</h3>
        ${(data.audit || []).length ? table(
          ['Time', 'Action', 'Resource', 'Reason'],
          data.audit.map((item) => [
            dateTime(item.createdAt),
            item.action,
            `${item.resourceType} · ${maskOperationalIdentifier(item.resourceId)}`,
            item.reason,
          ]),
        ) : empty('No examination administration actions have been recorded.')}
      </section>`;
  }

  async function submitExaminationAdminForm(form) {
    const operation = form.dataset.examAdminForm;
    const values = Object.fromEntries(new FormData(form));
    const reason = examinationReason(form);
    const payload = { operation, reason, requestKey: uuidKey() };
    if (operation === 'create_exam') {
      Object.assign(payload, {
        title: values.title,
        track: values.track,
        assessmentKind: values.assessmentKind,
        subject: values.subject,
        yearLevel: values.yearLevel || null,
        testOnly: form.elements.testOnly.checked,
      });
    } else if (operation === 'create_version') {
      Object.assign(payload, {
        examId: values.examId,
        label: values.label,
        durationSeconds: Number(values.durationMinutes) * 60,
        timerMode: values.timerMode,
        gradingRoute: values.gradingRoute,
        answerReleaseRule: values.answerReleaseRule,
        instructions: values.instructions,
        syllabus: String(values.syllabus || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      });
    } else if (operation === 'set_questions') {
      Object.assign(payload, {
        versionId: values.versionId,
        questionIds: [...form.elements.questionIds.selectedOptions].map((option) => option.value),
      });
    } else if (operation === 'set_beta_access') {
      Object.assign(payload, {
        userId: values.userId,
        enabled: form.elements.enabled.checked,
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
      });
    } else if (operation === 'set_participant') {
      Object.assign(payload, {
        versionId: values.versionId,
        userId: values.userId,
        enabled: form.elements.enabled.checked,
      });
    }
    await examinationAdmin(operation, payload);
    state.examinationData = null;
    toast('Audited examination action completed.');
    await renderSection('examinations');
  }

  function bindExaminationAdmin() {
    $$('[data-exam-admin-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await submitExaminationAdminForm(form);
      } catch (error) {
        toast(error.message || 'The examination action could not be completed.');
        button.disabled = false;
      }
    }));
    $('[data-exam-admin-refresh]')?.addEventListener('click', async () => {
      state.examinationData = null;
      await renderSection('examinations');
    });
    $('[data-exam-admin-publish]')?.addEventListener('click', async () => {
      const form = $('[data-exam-admin-form="set_questions"]');
      const versionId = form?.elements.versionId.value;
      const reason = form?.elements.reason.value.trim();
      if (!versionId || reason.length < 5) {
        toast('Select a draft and provide an audit reason before publishing.');
        return;
      }
      if (!global.confirm('Publish this immutable examination version? Active attempts will use this exact snapshot.')) return;
      try {
        await examinationAdmin('publish_version', {
          operation: 'publish_version',
          versionId,
          reason,
          requestKey: uuidKey(),
        });
        state.examinationData = null;
        toast('Examination version published.');
        await renderSection('examinations');
      } catch (error) { toast(error.message); }
    });
    $$('[data-exam-lifecycle]').forEach((button) => button.addEventListener('click', async () => {
      const operation = button.dataset.examLifecycle;
      const label = operation.replaceAll('_', ' ');
      const reason = global.prompt(`Reason for ${label}:`, '');
      if (!reason || reason.trim().length < 5) return toast('A five-character audit reason is required.');
      const payload = {
        operation,
        examId: button.dataset.examId,
        reason: reason.trim(),
        requestKey: uuidKey(),
      };
      if (operation === 'set_availability') {
        const availableFrom = global.prompt('Available from (ISO date/time; blank means immediately):', '') || '';
        const availableUntil = global.prompt('Available until (ISO date/time; blank means no end):', '') || '';
        payload.availableFrom = availableFrom ? new Date(availableFrom).toISOString() : null;
        payload.availableUntil = availableUntil ? new Date(availableUntil).toISOString() : null;
      } else if (!global.confirm(`Confirm ${label}? This access-impacting change is audited.`)) return;
      try {
        await examinationAdmin(operation, payload);
        state.examinationData = null;
        toast(`Examination ${label} completed.`);
        await renderSection('examinations');
      } catch (error) { toast(error.message); }
    }));
    $$('[data-exam-release]').forEach((button) => button.addEventListener('click', async () => {
      const reason = global.prompt('Reason for releasing the stored model answers:', '');
      if (!reason || reason.trim().length < 5) return toast('A five-character audit reason is required.');
      if (!global.confirm('Release model answers to this attempt now? This cannot be hidden from the examinee afterward.')) return;
      try {
        await examinationAdmin('release_model_answers', {
          operation: 'release_model_answers',
          attemptId: button.dataset.examRelease,
          reason: reason.trim(),
          requestKey: uuidKey(),
        });
        state.examinationData = null;
        toast('Model answers released. Email status remains provider-confirmed only.');
        await renderSection('examinations');
      } catch (error) { toast(error.message); }
    }));
  }

  async function renderSection(section) {
    state.section = section;
    $('#section-title').textContent = titles[section];
    $$('#admin-nav button').forEach((button) => button.setAttribute(
      'aria-current',
      button.dataset.section === section ? 'page' : 'false',
    ));
    setSidebarOpen(false);
    $('#dashboard-view').setAttribute('aria-busy', 'true');
    $('#dashboard-view').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const report = await loadReport();
      let html;
      if (section === 'executive') html = renderExecutive(report);
      else if (section === 'realtime') html = renderRealtime(report);
      else if (section === 'acquisition') html = renderAcquisition(report);
      else if (section === 'users') html = await renderUsers();
      else if (section === 'learning') html = await renderLearning(report);
      else if (section === 'subjects') html = renderSubjects(report);
      else if (section === 'reliability') html = renderReliability(report);
      else if (section === 'subscriptions') html = await renderSubscriptions(report);
      else if (section === 'payments') html = await renderPayments();
      else if (section === 'refunds') html = await renderRefunds();
      else if (section === 'support') html = await renderSupport();
      else if (section === 'corrections') html = await renderCorrections();
      else if (section === 'partnerships') html = await renderPartnerships();
      else if (section === 'controls') html = await renderControls();
      else if (section === 'security') html = await renderSecurity();
      else if (section === 'forum') html = await renderQuorumModeration();
      else if (section === 'examinations') html = await renderExaminations();
      else if (section === 'answer_exports') html = renderAnswerExports(report);
      $('#dashboard-view').innerHTML = html;
      bindDynamic();
      if (section === 'examinations') bindExaminationAdmin();
    } catch (error) {
      $('#dashboard-view').innerHTML = heading('Chambers unavailable', error.message || 'Administrator data could not be loaded.')
        + empty('No production data was changed. Refresh after connectivity or authorization is restored.');
    } finally {
      $('#dashboard-view').removeAttribute('aria-busy');
    }
  }

  function actionField(label, id, value = '', type = 'text') {
    return `<label class="field">${escapeHtml(label)}<input id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"></label>`;
  }

  function localDateTimeValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function isoFromLocalInput(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function accessActionPayload(row, descriptor) {
    return {
      operation: descriptor.operation,
      controlLabel: descriptor.label,
      displayName: row.display_name || 'Not provided',
      userId: row.user_id,
      subscriptionId: row.subscription_id || null,
      planCode: row.plan_code || null,
      status: row.subscription_status || null,
      source: row.subscription_source || null,
      startsAt: row.starts_at || null,
      expiresAt: row.expires_at || null,
      freeBetaEnabled: Boolean(row.free_beta_enabled),
      freeBetaExpiresAt: row.free_beta_expires_at || null,
    };
  }

  function mountSubscriptionActions() {
    $$('[data-subscription-actions-for]').forEach((mount) => {
      mount.replaceChildren();
      const row = state.subscriptionRows.get(mount.dataset.subscriptionActionsFor);
      const descriptors = subscriptionActions?.actionsForSubscription(
        row,
        state.authorization?.role,
      ) || [];
      if (!descriptors.length) {
        mount.textContent = 'No permitted actions';
        return;
      }
      const menu = document.createElement('details');
      menu.className = 'action-menu';
      const summary = document.createElement('summary');
      summary.textContent = 'Actions';
      summary.setAttribute(
        'aria-label',
        `Actions for ${row?.display_name || row?.user_id || 'student'}`,
      );
      const popover = document.createElement('div');
      popover.className = 'action-menu-popover';
      popover.setAttribute('role', 'menu');
      for (const descriptor of descriptors) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = descriptor.label;
        button.dataset.tone = descriptor.tone;
        button.setAttribute('role', 'menuitem');
        button.addEventListener('click', () => {
          menu.open = false;
          openAction(
            descriptor.action,
            row.user_id,
            accessActionPayload(row, descriptor),
          );
        });
        popover.append(button);
      }
      menu.append(summary, popover);
      mount.append(menu);
    });
  }

  function appendInputField(container, labelText, id, options = {}) {
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.id = id;
    input.type = options.type || 'text';
    input.value = options.value || '';
    if (options.min != null) input.min = String(options.min);
    if (options.max != null) input.max = String(options.max);
    if (options.required) input.required = true;
    if (options.placeholder) input.placeholder = options.placeholder;
    label.append(input);
    container.append(label);
    return input;
  }

  function selectedPlan() {
    return document.querySelector('input[name="subscription-plan"]:checked')?.value || '';
  }

  function planDisplayName(planCode) {
    return config.plans.items.find((plan) => plan.id === planCode)?.name || planCode || 'No plan';
  }

  function proposedAccessDescription(action, payload) {
    const operation = payload.operation;
    if (action === 'free_beta_change') {
      return payload.enabled ? 'Enable Free Beta access' : 'Disable Free Beta access';
    }
    if (action === 'discount_assign') {
      const code = $('#action-discount-code')?.value?.trim().toUpperCase();
      return code ? `Apply verified discount code ${code}` : 'Apply a verified active discount code';
    }
    if (action === 'subscription_audit_view') return 'View this student’s immutable access history';
    if (['activate', 'complimentary', 'replace_plan'].includes(operation)) {
      const plan = selectedPlan() || payload.planCode || 'standard';
      const verb = operation === 'activate' ? 'Activate'
        : operation === 'complimentary' ? 'Grant complimentary'
          : 'Change plan to';
      return `${verb} ${planDisplayName(plan)}`
        + `${plan === 'premium'
          ? ` · expires ${$('#action-expires')?.value || 'on the required selected date'}`
          : ' · trusted 30-day catalog terms'}`;
    }
    if (operation === 'pause') return 'Suspend the active Retainer';
    if (operation === 'resume') return 'Resume the suspended Retainer';
    if (operation === 'cancel') return 'Revoke the current Retainer';
    if (operation === 'expire') return 'Expire the current Retainer immediately';
    if (operation === 'restore') {
      return `Restore access until ${$('#action-expires')?.value || 'the required selected date'}`;
    }
    if (operation === 'extend') {
      return `Extend access by ${$('#action-days')?.value || 30} day(s)`;
    }
    if (operation === 'set_start_date') {
      return `Change start date to ${$('#action-starts')?.value || 'the selected date'}`;
    }
    if (operation === 'set_expiration_date') {
      return `Change expiration date to ${$('#action-expires')?.value || 'the selected date'}`;
    }
    return 'Apply the selected access change';
  }

  function updateActionContext() {
    if (!state.action || !subscriptionActions?.isAccessAction(state.action.action)) return;
    const payload = state.action.payload;
    $('#action-target').textContent = `${payload.displayName || 'Not provided'} · ${payload.userId || state.action.targetId}`;
    $('#action-current').textContent = `${planDisplayName(payload.planCode)} · ${payload.status || 'no Retainer'}`
      + `${payload.expiresAt ? ` · expires ${dateTime(payload.expiresAt)}` : ''}`;
    $('#action-proposed').textContent = proposedAccessDescription(state.action.action, payload);
  }

  function appendPlanOptions(container, payload) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'plan-options';
    const legend = document.createElement('legend');
    legend.textContent = 'Select the trusted plan';
    fieldset.append(legend);
    const plans = subscriptionActions?.availablePlans(config.plans) || [];
    const preferred = plans.some((plan) => plan.id === payload.planCode && !plan.disabled)
      ? payload.planCode : 'standard';
    for (const plan of plans) {
      const label = document.createElement('label');
      label.className = `plan-option${plan.disabled ? ' disabled' : ''}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'subscription-plan';
      input.value = plan.id;
      input.disabled = plan.disabled;
      input.checked = !plan.disabled && plan.id === preferred;
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = plan.name;
      const details = document.createElement('small');
      details.textContent = plan.disabled
        ? `${plan.statusLabel}. ${plan.note}`
        : plan.durationDays
          ? `${plan.durationDays} days · catalog-controlled access`
          : 'Explicit expiration required · Bar Feels included';
      copy.append(name, details);
      const price = document.createElement('strong');
      price.className = 'plan-price';
      price.textContent = `₱${number(plan.pricePhp, 2)}`;
      label.append(input, copy, price);
      fieldset.append(label);
      input.addEventListener('change', updateActionContext);
    }
    container.append(fieldset);
  }

  function buildAccessActionFields(action, payload) {
    const container = $('#action-fields');
    container.replaceChildren();
    if (action === 'subscription_change') {
      if (['activate', 'complimentary', 'replace_plan'].includes(payload.operation)) {
        appendPlanOptions(container, payload);
        const input = appendInputField(
          container,
          'Expiration for Premium (required when Premium is selected)',
          'action-expires',
          {
            type: 'datetime-local',
            value: localDateTimeValue(payload.expiresAt),
          },
        );
        input.addEventListener('input', updateActionContext);
      } else if (payload.operation === 'extend') {
        const input = appendInputField(container, 'Extension in calendar days', 'action-days', {
          type: 'number', value: '30', min: 1, max: 366, required: true,
        });
        input.addEventListener('input', updateActionContext);
      } else if (payload.operation === 'set_start_date') {
        const input = appendInputField(container, 'New Retainer start date and time', 'action-starts', {
          type: 'datetime-local', value: localDateTimeValue(payload.startsAt), required: true,
        });
        input.addEventListener('input', updateActionContext);
      } else if (['set_expiration_date', 'restore'].includes(payload.operation)) {
        const input = appendInputField(container, 'New Retainer expiration date and time', 'action-expires', {
          type: 'datetime-local', value: localDateTimeValue(payload.expiresAt), required: true,
        });
        input.addEventListener('input', updateActionContext);
      }
    } else if (action === 'free_beta_change') {
      payload.enabled = payload.operation === 'enable';
      if (payload.enabled) {
        appendInputField(container, 'Optional Free Beta expiration', 'action-expires', {
          type: 'datetime-local', value: localDateTimeValue(payload.freeBetaExpiresAt),
        }).addEventListener('input', updateActionContext);
      }
    } else if (action === 'discount_assign') {
      appendInputField(container, 'Active discount code', 'action-discount-code', {
        required: true, placeholder: 'Example: FOUNDING25',
      }).addEventListener('input', updateActionContext);
    }
  }

  function renderAuditHistory(result, payload) {
    const container = $('#audit-history');
    container.replaceChildren();
    $('#audit-target').textContent = `${payload.displayName || 'Not provided'} · ${payload.userId}`;
    const entries = [
      ...(result?.subscriptionHistory || []).map((entry) => ({
        title: `Retainer · ${entry.action}`,
        time: entry.occurredAt,
        copy: `${entry.planCode || 'No plan'} · ${entry.status || 'unknown'} · ${entry.reason || 'No reason recorded'}`,
      })),
      ...(result?.freeBetaHistory || []).map((entry) => ({
        title: `Free Beta · ${entry.enabled ? 'enabled' : 'disabled'}`,
        time: entry.occurredAt,
        copy: entry.reason || 'No reason recorded',
      })),
      ...(result?.discountHistory || []).map((entry) => ({
        title: `Discount · ${entry.code || 'Unknown code'}`,
        time: entry.occurredAt,
        copy: entry.reason || 'No reason recorded',
      })),
      ...(result?.auditHistory || []).map((entry) => ({
        title: `Administrator audit · ${entry.actionType}`,
        time: entry.occurredAt,
        copy: entry.reason || 'No reason recorded',
      })),
    ].sort((left, right) => new Date(right.time || 0) - new Date(left.time || 0));
    if (!entries.length) {
      const emptyState = document.createElement('p');
      emptyState.className = 'empty';
      emptyState.textContent = 'No access changes have been recorded for this student.';
      container.append(emptyState);
    }
    for (const entry of entries) {
      const article = document.createElement('article');
      article.className = 'audit-entry';
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const copy = document.createElement('span');
      copy.textContent = `${dateTime(entry.time)} · ${entry.copy}`;
      article.append(title, copy);
      container.append(article);
    }
    $('#audit-dialog').showModal();
  }

  function openInsight(button) {
    let detail = {};
    try { detail = JSON.parse(button.dataset.insight || '{}'); } catch { detail = {}; }
    $('#insight-title').textContent = detail.label || 'Verified metric detail';
    $('#insight-value').textContent = detail.value || 'Not available';
    $('#insight-copy').textContent = detail.copy
      || 'Verified aggregate for the currently selected reporting period.';
    $('#insight-source').textContent = detail.source
      || 'Due Diligence production analytics aggregate';
    const window = reportingWindow();
    $('#insight-window').textContent = `${dateTime(window.from)} to ${dateTime(window.to)}`;
    $('#insight-generated').textContent = dateTime(state.report?.meta?.generated_at);
    $('#insight-dialog').showModal();
  }

  function closeInsight() {
    const dialog = $('#insight-dialog');
    if (dialog?.open) dialog.close('cancel');
  }

  function setSidebarOpen(open) {
    const sidebar = $('#sidebar');
    const scrim = $('#sidebar-scrim');
    sidebar?.classList.toggle('open', open);
    $('#menu-button')?.setAttribute('aria-expanded', String(open));
    if (scrim) scrim.hidden = !open;
    document.body.classList.toggle('admin-nav-open', open);
  }

  function cancelActionDialog(options = {}) {
    const dialog = $('#action-dialog');
    if (!dialog?.open) {
      state.action = null;
      return;
    }
    const consumeHistory = options.consumeHistory !== false;
    const historyArmed = history.state?.dueDiligenceAdminAction === true;
    dialog.close('cancel');
    state.action = null;
    state.actionInFlight = false;
    const confirm = $('#action-confirm');
    if (confirm) confirm.disabled = false;
    if (consumeHistory && historyArmed) history.back();
  }

  function openAction(action, targetId, payload) {
    state.action = { action, targetId: targetId || null, payload: { ...(payload || {}) } };
    state.actionInFlight = false;
    let fields = '';
    let title = 'Confirm action';
    let warning = 'This operation is transactional, reason-required, and recorded in the administrator audit log.';
    if (action === 'support_update') {
      title = 'Update Support request';
      fields = `<label class="field">Status<select id="action-status">${['pending','in_progress','waiting_for_student','resolved','closed'].map((value) => `<option${payload.status === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label class="field">Priority<select id="action-priority">${['low','normal','high','urgent'].map((value) => `<option${payload.priority === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label class="field">Internal note<textarea id="action-note" maxlength="4000"></textarea></label>`;
    } else if (action === 'correction_review') {
      title = 'Record editorial decision';
      fields = `<label class="field">Status<select id="action-status">${['pending','accepted','rejected'].map((value) => `<option${payload.status === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label class="field">Reviewer note<textarea id="action-note" maxlength="4000"></textarea></label>`;
      warning = 'Accept or reject records an editorial decision only. The live question bank will not change.';
    } else if (action === 'entitlement_change') {
      title = 'Adjust manual entitlement';
      fields = `${actionField('Plan code', 'action-plan', payload.plan_code)}
        <label class="field">Status<select id="action-status">${['active','paused','canceled','expired'].map((value) => `<option${payload.status === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        ${actionField('Effective until (optional ISO date)', 'action-until')}`;
      warning = 'This action changes the student’s access and may affect future billing records. Confirm the requested change and effective dates before continuing.';
    } else if (action === 'payment_review') {
      title = 'Review manual payment';
      fields = `<label class="field">Decision<select id="action-status">
        <option value="needs_information">Needs information</option>
        <option value="approved">Approve and activate selected plan</option>
        <option value="rejected">Reject</option>
      </select></label>
      ${payload.planCode === 'premium'
        ? actionField('Premium expiration date and time', 'action-expires', '', 'datetime-local')
        : ''}`;
      warning = payload.planCode === 'premium'
        ? 'Approval is immediate and requires an explicit Premium expiration. Verify amount, channel, reference, date, private proof, and end date before confirming.'
        : 'Approval is immediate: it activates the exact selected plan for its trusted catalog duration. Verify amount, channel, reference, date, and private proof before confirming.';
    } else if (action === 'view_payment_proof') {
      title = 'Open private payment proof';
      warning = 'This sensitive read creates an audit record and opens a private proof through a five-minute signed link. Do not download or redistribute it unnecessarily.';
    } else if (action === 'refund_review') {
      title = 'Review refund request';
      fields = `<label class="field">Decision<select id="action-status">
        <option value="needs_information">Needs information</option>
        <option value="approved">Approve amount</option>
        <option value="rejected">Reject</option>
        ${payload.status === 'approved' ? '<option value="paid">Mark paid</option>' : ''}
      </select></label>
      ${actionField('Approved refund in PHP', 'action-refund-amount', payload.approvedRefundPhp ?? payload.suggestedRefundPhp ?? '', 'number')}`;
      warning = 'Confirm the verified paid amount, timing, consumption, outage evidence, and statutory rights. Mark paid only after funds were actually returned.';
    } else if (action === 'subscription_change') {
      const titlesByOperation = {
        activate: 'Activate Retainer',
        complimentary: 'Grant complimentary access',
        pause: 'Pause Retainer',
        resume: 'Resume Retainer',
        cancel: 'Revoke Retainer',
        expire: 'Expire Retainer',
        restore: 'Restore Retainer',
        extend: 'Extend Retainer',
        replace_plan: 'Change plan',
        set_start_date: 'Change Retainer start date',
        set_expiration_date: 'Change Retainer expiration date',
      };
      title = payload.controlLabel === 'Change Plan'
        ? 'Change plan'
        : titlesByOperation[payload.operation] || 'Manage Retainer';
      warning = payload.operation === 'complimentary'
        ? 'This immediately grants access without recording a payment. Confirm the student, trusted plan, and reason.'
        : 'This immediately changes access. Confirm the student, current status, proposed value, and reason before continuing.';
    } else if (action === 'free_beta_change') {
      title = payload.operation === 'enable' ? 'Enable Free Beta access' : 'Disable Free Beta access';
      warning = 'Free Beta unlocks all current digital features without payment. It creates no coaching or future Premium rights.';
    } else if (action === 'discount_assign') {
      title = 'Apply verified discount';
      warning = 'Only an active server-verified code can be assigned. The browser cannot choose a discount value or trusted plan price.';
    } else if (action === 'subscription_audit_view') {
      title = 'View Retainer audit history';
      warning = 'This sensitive read is reason-required and creates its own immutable audit record.';
    } else if (action === 'partnership_update') {
      title = 'Update partnership inquiry';
      fields = `<label class="field">Status<select id="action-status">${['new','reviewing','awaiting_reply','qualified','closed'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label class="field"><span><input id="action-contact-verified" type="checkbox"${payload.contactVerified ? ' checked' : ''}> Contact ownership verified</span></label>
        ${actionField('Assignee user UUID (optional)', 'action-assignee', payload.assigneeUserId || '')}`;
      warning = 'Contact verification means ownership was actually checked; do not mark it based only on valid email formatting.';
    } else if (action === 'role_change') {
      title = 'Change administrator role';
      fields = `<label class="field">Role<select id="action-role">
        ${['student','admin','founder_admin'].map((value) => `<option value="${value}"${payload.role === value ? ' selected' : ''}>${value}</option>`).join('')}
      </select></label>`;
      warning = 'Only the Super Admin may perform this action. Self-promotion, self-demotion, and creation of another Super Admin are prohibited.';
    } else if (action === 'website_control_update') {
      title = 'Update allowlisted website control';
      fields = `${actionField('Control key', 'action-control', payload.control_key)}
        <label class="field">JSON value<textarea id="action-value" maxlength="8000">${escapeHtml(JSON.stringify(payload.value || {}, null, 2))}</textarea></label>
        <label class="field"><span><input id="action-published" type="checkbox"${payload.is_published ? ' checked' : ''}> Publish this value</span></label>`;
      warning = 'Raw HTML, scripts, SQL, secrets, grading controls, and destructive settings are rejected.';
    } else if (action === 'reveal_email') {
      title = 'Reveal exact Docket email';
      warning = 'Exact email access is capability-restricted, rate-limited, reason-required, and audited.';
    } else if (action === 'find_email') {
      title = 'Find Docket by exact email';
      fields = actionField('Exact email', 'action-email', '', 'email');
      warning = 'Exact email search is server-side, capability-restricted, rate-limited, reason-required, and audited.';
    } else if (action === 'user_response_export') {
      const today = new Date();
      const from = new Date(today.getTime() - (365 * 86_400_000));
      fields = `${actionField('From date', 'action-export-from', from.toISOString().slice(0, 10), 'date')}
        ${actionField('Through date (inclusive)', 'action-export-to', today.toISOString().slice(0, 10), 'date')}`;
      title = 'Download private questions and answers';
      warning = 'This founder-only export contains private student work. Download only for an authorized purpose, store it securely, and do not redistribute it. The reason and export scope are audited.';
    } else if (action === 'global_beta_change') {
      title = payload.enabled ? 'Enable Beta All Access' : 'Disable Beta All Access';
      warning = payload.enabled
        ? 'This immediately gives all current and future signed-in users access to every current beta feature, subject to current legal acceptance and security restrictions.'
        : 'This immediately removes the platform-wide entitlement from every user and restores legacy trial, per-user beta, and Retainer rules. Confirm the operational impact before continuing.';
    } else if (action.startsWith('quorum_')) {
      const quorumAction = action.slice('quorum_'.length);
      const quorumTitles = {
        approve_announcement: 'Approve Quorum announcement',
        reject_announcement: 'Reject Quorum announcement',
        hide_entry: 'Hide Quorum entry',
        restore_entry: 'Restore Quorum entry',
        remove_entry: 'Remove Quorum entry',
        hide_comment: 'Hide Quorum comment',
        restore_comment: 'Restore Quorum comment',
        remove_comment: 'Remove Quorum comment',
        hide_circle: 'Hide Study Circle',
        restore_circle: 'Restore Study Circle',
        remove_circle: 'Remove Study Circle',
        lock_comments: 'Lock comments',
        unlock_comments: 'Unlock comments',
        dismiss_report: 'Dismiss Quorum report',
        restrict_user: 'Restrict Quorum publishing',
        remove_restriction: 'Remove Quorum restriction',
        verify_profile: 'Approve Verified Academic Identity',
        unverify_profile: 'Remove Verified Academic Identity',
        set_indicator: 'Apply credibility indicator',
      };
      title = quorumTitles[quorumAction] || 'Moderate Quorum';
      if (quorumAction === 'restrict_user') {
        fields = `<label class="field">Restriction period<select id="action-duration">
          <option value="1">1 hour</option>
          <option value="24" selected>24 hours</option>
          <option value="72">3 days</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
          <option value="8760">365 days</option>
        </select></label>`;
      }
      warning = ['restrict_user', 'remove_restriction'].includes(quorumAction)
        ? 'This changes only the member’s ability to publish in Quorum. Examination, subscription, and payment access remain unchanged.'
        : 'This consequential Quorum action is reason-required, server-authorized, and recorded in the administrator audit log.';
    } else if (action.startsWith('forum_')) {
      const forumAction = action.slice('forum_'.length);
      const forumTitles = {
        hide_content: 'Hide reported forum content',
        restore_content: 'Restore reported forum content',
        remove_content: 'Remove reported forum content',
        dismiss_report: 'Dismiss forum report',
        restrict_user: 'Restrict forum publishing',
        remove_restriction: 'Remove forum publishing restriction',
      };
      title = forumTitles[forumAction] || 'Moderate legacy community record';
      if (forumAction === 'restrict_user') {
        fields = `<label class="field">Restriction period<select id="action-duration">
          <option value="1">1 hour</option>
          <option value="24" selected>24 hours</option>
          <option value="72">3 days</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
          <option value="8760">365 days</option>
        </select></label>`;
      }
      warning = forumAction === 'restrict_user' || forumAction === 'remove_restriction'
        ? 'This changes only the member’s legacy community publishing state. It does not change examination, subscription, or payment access.'
        : 'This changes the visibility or review state of user-generated forum content and is recorded in the administrator audit log.';
    }
    $('#action-title').textContent = title;
    const isAccessAction = Boolean(subscriptionActions?.isAccessAction(action));
    const isHighRiskPayment = action === 'payment_review';
    const isSensitiveExport = action === 'user_response_export';
    const isGlobalBetaAction = action === 'global_beta_change';
    const isForumAction = action.startsWith('forum_') || action.startsWith('quorum_');
    if (isAccessAction) buildAccessActionFields(action, state.action.payload);
    else $('#action-fields').innerHTML = fields;
    $('#action-context').hidden = !isAccessAction;
    $('#action-confirmation').hidden = !(isAccessAction || isForumAction || isHighRiskPayment || isSensitiveExport || isGlobalBetaAction);
    $('#action-confirmation-copy').textContent = isGlobalBetaAction
      ? `I understand this will ${payload.enabled ? 'grant Beta All Access to' : 'remove Beta All Access from'} all current and future signed-in users and that the change is immediate and audited.`
      : isSensitiveExport
      ? 'I am authorized to access this student work and will handle the downloaded file securely. I understand this export is audited.'
      : isForumAction
        ? 'I have verified the report or target content and the proposed moderation action. I understand this action is immediate and audited.'
        : 'I have verified the target, current access, and proposed change. I understand this action is immediate and audited.';
    $('#action-confirm-risk').checked = false;
    $('#action-confirm').textContent = action === 'subscription_audit_view'
      ? 'View audited history'
      : isSensitiveExport
        ? 'Download audited export'
        : isForumAction ? 'Confirm moderation action' : 'Confirm audited action';
    $('#action-warning').textContent = warning;
    $('#action-reason').value = '';
    if (isAccessAction) updateActionContext();
    $('#action-dialog').showModal();
    if (history.state?.dueDiligenceAdminAction !== true) {
      history.pushState(
        { ...(history.state || {}), dueDiligenceAdminAction: true },
        '',
        location.href,
      );
    }
  }

  async function confirmAction(event) {
    event.preventDefault();
    if (!state.action || state.actionInFlight) return;
    const accessAction = Boolean(subscriptionActions?.isAccessAction(state.action.action));
    const forumAction = state.action.action.startsWith('forum_')
      || state.action.action.startsWith('quorum_');
    const highRiskPayment = state.action.action === 'payment_review';
    const sensitiveExport = state.action.action === 'user_response_export';
    const globalBetaAction = state.action.action === 'global_beta_change';
    if ((accessAction || forumAction || highRiskPayment || sensitiveExport || globalBetaAction) && !$('#action-confirm-risk').checked) {
      toast(forumAction
        ? 'Confirm that you verified the report and moderation action.'
        : globalBetaAction
          ? 'Confirm that you understand the platform-wide access impact.'
        : sensitiveExport
          ? 'Confirm that you are authorized to download this private student work.'
          : 'Confirm that you verified the target and proposed access change.');
      return;
    }
    const reason = $('#action-reason').value.trim();
    if (reason.length < 5) {
      toast('Enter a reason of at least five characters.');
      return;
    }
    const action = state.action.action;
    const payload = { ...state.action.payload };
    if (action === 'support_update') {
      payload.status = $('#action-status').value;
      payload.priority = $('#action-priority').value;
      payload.internal_note = $('#action-note').value.trim();
    } else if (action === 'correction_review') {
      payload.status = $('#action-status').value;
      payload.reviewer_note = $('#action-note').value.trim();
    } else if (action === 'entitlement_change') {
      payload.plan_code = $('#action-plan').value.trim();
      payload.status = $('#action-status').value;
      payload.effective_until = $('#action-until').value.trim() || null;
      payload.entitlement_action = payload.status === 'paused' ? 'pause'
        : payload.status === 'canceled' ? 'cancel'
          : payload.status === 'expired' ? 'expire' : 'adjust';
    } else if (action === 'payment_review') {
      payload.status = $('#action-status').value;
      if (payload.status === 'approved' && payload.planCode === 'premium') {
        payload.expiresAt = isoFromLocalInput($('#action-expires')?.value);
        if (!payload.expiresAt) {
          toast('Select a future Premium expiration before approval.');
          return;
        }
      }
    } else if (action === 'refund_review') {
      payload.status = $('#action-status').value;
      payload.approvedRefundPhp = Number($('#action-refund-amount').value);
    } else if (action === 'subscription_change') {
      if (['activate', 'complimentary', 'replace_plan'].includes(payload.operation)) {
        payload.planCode = selectedPlan();
        if (!payload.planCode) {
          toast('Select an available plan.');
          return;
        }
        if (payload.planCode === 'premium') {
          payload.expiresAt = isoFromLocalInput($('#action-expires')?.value);
          if (!payload.expiresAt) {
            toast('Select a future Premium expiration.');
            return;
          }
        } else {
          payload.expiresAt = null;
        }
      }
      if (payload.operation === 'extend') {
        payload.durationDays = Number($('#action-days').value);
      } else if (payload.operation === 'set_start_date') {
        payload.startsAt = isoFromLocalInput($('#action-starts').value);
        if (!payload.startsAt) {
          toast('Select a valid Retainer start date.');
          return;
        }
      } else if (['set_expiration_date', 'restore'].includes(payload.operation)) {
        payload.expiresAt = isoFromLocalInput($('#action-expires').value);
        if (!payload.expiresAt) {
          toast('Select a valid Retainer expiration date.');
          return;
        }
      }
    } else if (action === 'free_beta_change') {
      payload.enabled = payload.operation === 'enable';
      payload.expiresAt = payload.enabled
        ? isoFromLocalInput($('#action-expires')?.value) : null;
    } else if (action === 'discount_assign') {
      payload.code = $('#action-discount-code').value.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(payload.code)) {
        toast('Enter a valid active discount code.');
        return;
      }
    } else if (action === 'partnership_update') {
      payload.status = $('#action-status').value;
      payload.contactVerified = $('#action-contact-verified').checked;
      payload.assigneeUserId = $('#action-assignee').value.trim() || null;
    } else if (action === 'role_change') {
      payload.role = $('#action-role').value;
    } else if (action === 'website_control_update') {
      payload.control_key = $('#action-control').value;
      try { payload.value = JSON.parse($('#action-value').value); } catch {
        toast('Control value must be valid JSON.');
        return;
      }
      payload.is_published = $('#action-published').checked;
    } else if (action === 'forum_restrict_user' || action === 'quorum_restrict_user') {
      payload.durationHours = Number($('#action-duration').value);
    }
    state.action.requestKey ||= uuidKey();
    state.actionInFlight = true;
    $('#action-confirm').disabled = true;
    try {
      if (action === 'reveal_email') {
        const response = await api('/admin/reveal-email', {
          targetUserId: state.action.targetId,
          reason,
        });
        toast(`Authorized email: ${response.data.email}`);
      } else if (action === 'find_email') {
        const response = await api('/admin/find-email', {
          email: $('#action-email').value.trim(),
          reason,
        });
        toast(response.data.found
          ? `Match: ${response.data.display_name || 'Unnamed Docket'} (${response.data.masked_email})`
          : 'No Docket matched that exact email.');
      } else if (action === 'user_response_export') {
        const fromValue = $('#action-export-from').value;
        const toValue = $('#action-export-to').value;
        const from = new Date(`${fromValue}T00:00:00.000Z`);
        const through = new Date(`${toValue}T00:00:00.000Z`);
        const to = new Date(through.getTime() + 86_400_000);
        if (!fromValue || !toValue || !Number.isFinite(from.getTime())
            || !Number.isFinite(to.getTime()) || from >= to
            || to - from > 366 * 86_400_000) {
          toast('Select a valid date range of no more than 365 inclusive days.');
          return;
        }
        const response = await fetch(`${config.workerUrl}/admin/user-responses/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.session.access_token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({
            targetUserId: state.action.targetId,
            reason,
            requestKey: state.action.requestKey,
            from: from.toISOString(),
            to: to.toISOString(),
          }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The private Q&A export could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `due-diligence-user-${state.action.targetId}-questions-answers.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('Audited private Q&A export downloaded.');
      } else if (action === 'global_beta_change') {
        await api('/admin/global-beta/change', {
          enabled: payload.enabled === true,
          reason,
          requestKey: state.action.requestKey,
          confirmed: true,
        });
        state.report = null;
        toast(`Beta All Access ${payload.enabled ? 'enabled' : 'disabled'} for all signed-in users.`);
      } else if (action === 'view_payment_proof') {
        const response = await api('/admin/payment-proof', {
          paymentRequestId: state.action.targetId,
          reason,
        });
        const link = document.createElement('a');
        link.href = response.proof.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
        toast('Private proof opened in a five-minute authorized view.');
      } else if (action.startsWith('quorum_')) {
        const quorumAction = action.slice('quorum_'.length);
        const actionPayload = {
          action: quorumAction,
          reason,
          requestId: state.action.requestKey,
        };
        if (quorumAction === 'dismiss_report') {
          actionPayload.reportId = state.action.targetId;
        } else if (quorumAction === 'remove_restriction') {
          actionPayload.restrictionId = state.action.targetId;
        } else if (['restrict_user', 'verify_profile', 'unverify_profile'].includes(quorumAction)) {
          actionPayload.memberId = state.action.targetId;
        } else {
          actionPayload.targetId = state.action.targetId;
        }
        if (quorumAction === 'restrict_user') {
          actionPayload.durationHours = payload.durationHours;
        }
        if (quorumAction === 'set_indicator') {
          actionPayload.indicator = payload.indicator;
          actionPayload.enabled = payload.enabled;
        }
        await api('/admin/quorum', {
          operation: 'action',
          payload: actionPayload,
        });
        toast('Audited Quorum moderation action completed.');
      } else if (action.startsWith('forum_')) {
        await api('/admin/forum/action', {
          action: action.slice('forum_'.length),
          targetId: state.action.targetId,
          reason,
          durationHours: payload.durationHours || null,
          requestId: state.action.requestKey,
        });
        toast('Audited legacy community moderation action completed.');
      } else {
        const phase4Actions = new Set([
          'payment_review','refund_review','subscription_change',
          'free_beta_change','partnership_update','provider_incident_clear',
          'role_change','discount_assign','subscription_audit_view',
        ]);
        const actionRequest = {
          action,
          targetId: state.action.targetId,
          payload,
          reason,
          requestKey: state.action.requestKey,
        };
        let response;
        if (phase4Actions.has(action)) {
          response = await api('/admin/phase4-action', actionRequest);
        } else response = await api('/admin/action', actionRequest);
        if (action === 'subscription_audit_view') {
          renderAuditHistory(response.data, payload);
          toast('Audited access history loaded.');
        } else {
          toast('Audited access action completed and the row was refreshed.');
        }
      }
      cancelActionDialog();
      state.operational.clear();
      await renderSection(state.section);
    } catch (error) {
      toast(error.message || 'Action failed without changing production data.');
    } finally {
      state.actionInFlight = false;
      $('#action-confirm').disabled = false;
    }
  }

  function updateScenario() {
    const visitors = Math.max(0, Number($('#scenario-visitors')?.value) || 0);
    const rate = Math.min(100, Math.max(0, Number($('#scenario-rate')?.value) || 0));
    const price = Math.max(0, Number($('#scenario-price')?.value) || 0);
    const assumedCustomers = Math.round(visitors * rate / 100);
    $('#scenario-output').textContent = `Scenario only — not actual performance: ${number(assumedCustomers)} assumed customers × ₱${number(price, 2)} = ₱${number(assumedCustomers * price, 2)} hypothetical monthly value.`;
  }

  function bindDynamic() {
    mountSubscriptionActions();
    $('#premium-status-filter')?.addEventListener('change', async (event) => {
      state.premiumStatus = event.currentTarget.value;
      state.operational.clear();
      await renderSection('subscriptions');
    });
    $$('[data-insight]').forEach((button) => button.addEventListener('click', () => openInsight(button)));
    $$('[data-admin-section]').forEach((button) => button.addEventListener('click', () => {
      const section = button.dataset.adminSection;
      if (titles[section]) renderSection(section);
    }));
    $$('[data-admin-action]').forEach((button) => button.addEventListener('click', () => {
      let payload = {};
      try { payload = JSON.parse(button.dataset.payload || '{}'); } catch { payload = {}; }
      openAction(button.dataset.adminAction, button.dataset.target, payload);
    }));
    $('#user-search-button')?.addEventListener('click', async () => {
      const search = $('#user-search').value.trim();
      $('#dashboard-view').innerHTML = '<div class="skeleton"></div>';
      try {
        state.userSearch = search;
        await loadUserDirectory(true, search);
        await renderSection('users');
      } catch (error) { toast(error.message); }
    });
    $('#user-directory-export')?.addEventListener('click', async () => {
      try {
        const response = await fetch(`${config.workerUrl}/admin/user-directory/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.session.access_token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({ search: state.userSearch, requestKey: uuidKey() }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The Students directory export could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-students.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('Audited Students directory downloaded for Google Sheets.');
      } catch (error) { toast(error.message); }
    });
    $('#user-directory-email-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const recipientKey = $('#user-directory-email-recipient')?.value || '';
      const reason = $('#user-directory-email-reason')?.value?.trim() || '';
      const confirmed = $('#user-directory-email-confirm')?.checked === true;
      if (!recipientKey || reason.length < 5 || !confirmed) {
        toast('Select a founder, provide an audit reason, and confirm authorization.');
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await api('/admin/user-directory/email', {
          search: state.userSearch,
          recipientKey,
          reason,
          requestKey: uuidKey(),
          confirmed: true,
        });
        toast(result.delivery?.status === 'sent'
          ? 'Students CSV sent to the selected founder.'
          : `Email delivery status: ${result.delivery?.status || 'not confirmed'}.`);
        form.reset();
      } catch (error) {
        toast(error.message || 'The Students directory email could not be sent.');
      } finally {
        button.disabled = false;
      }
    });
    $('#answer-history-export-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const reason = $('#answer-history-reason')?.value?.trim() || '';
      const confirmed = $('#answer-history-confirm')?.checked === true;
      const fromValue = $('#answer-history-from')?.value || '';
      const toValue = $('#answer-history-to')?.value || '';
      if (reason.length < 5 || !confirmed) {
        toast('Provide an audit reason and confirm authorization for private student work.');
        return;
      }
      if (Boolean(fromValue) !== Boolean(toValue)) {
        toast('Choose both dates or leave both blank to export the complete history.');
        return;
      }
      const from = fromValue ? new Date(`${fromValue}T00:00:00.000Z`) : null;
      const through = toValue ? new Date(`${toValue}T00:00:00.000Z`) : null;
      const to = through ? new Date(through.getTime() + 86_400_000) : null;
      if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))
          || (from && to && from >= to)) {
        toast('Select a valid answer-history date range.');
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const response = await fetch(`${config.workerUrl}/admin/answer-history/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.session.access_token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({
            from: from?.toISOString() || null,
            to: to?.toISOString() || null,
            reason,
            requestKey: uuidKey(),
            confirmed: true,
          }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The complete answer-history export could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-all-answer-history.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('Audited answer-history CSV downloaded for Google Sheets.');
      } catch (error) {
        toast(error.message || 'The complete answer-history export could not be created.');
      } finally {
        button.disabled = false;
      }
    });
    $('#print-report')?.addEventListener('click', () => global.print());
    $('#export-report')?.addEventListener('click', async () => {
      try {
        const response = await fetch(`${config.workerUrl}/admin/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.session.access_token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify(reportingWindow()),
        });
        if (!response.ok) throw new Error('Aggregate export could not be created.');
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-aggregate-report.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch (error) { toast(error.message); }
    });
    ['scenario-visitors', 'scenario-rate', 'scenario-price'].forEach((id) => {
      $(`#${id}`)?.addEventListener('input', updateScenario);
    });
    if ($('#scenario-output')) updateScenario();
  }

  function applyNavigationAuthorization() {
    $$('#admin-nav button').forEach((button) => {
      const needed = requirements[button.dataset.section];
      const founderOnly = ['forum', 'examinations', 'answer_exports'].includes(button.dataset.section);
      const founderAuthorized = ['founder_admin', 'super_admin'].includes(
        state.authorization?.role,
      );
      button.hidden = founderOnly
        ? !founderAuthorized
        : Boolean(needed && !has(needed));
    });
  }

  function deny(message) {
    $('#gate-title').textContent = 'Administrator access unavailable';
    $('#gate-copy').textContent = message;
    $('#gate-spinner').hidden = true;
    $('#gate-action').hidden = false;
  }

  async function initialize() {
    if (!config?.features?.adminDashboard
        || !global.supabase?.createClient
        || !subscriptionActions?.actionsForSubscription) {
      deny('Protected Chambers is not configured.');
      return;
    }
    state.client = global.supabase.createClient(config.supabase.url, config.supabase.publishableKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        storage: global.sessionStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    const { data, error } = await state.client.auth.getSession();
    if (error || !data?.session?.access_token) {
      deny('Sign in through Due Diligence with a verified administrator account, then return here.');
      return;
    }
    state.session = data.session;
    try {
      const payload = await api('/admin/session');
      state.authorization = payload;
    } catch (error) {
      deny(error.message || 'This account is not authorized for administration.');
      return;
    }
    $('#admin-gate').hidden = true;
    $('#admin-shell').hidden = false;
    applyNavigationAuthorization();
    await loadReport(true);
    await renderSection('executive');
  }

  $('#admin-nav')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-section]');
    if (button && !button.hidden) renderSection(button.dataset.section);
  });
  $('#date-range')?.addEventListener('change', async () => {
    state.report = null;
    state.operational.clear();
    await renderSection(state.section);
  });
  $('#refresh-dashboard')?.addEventListener('click', async () => {
    const button = $('#refresh-dashboard');
    button.disabled = true;
    button.textContent = 'Refreshing…';
    state.report = null;
    state.operational.clear();
    try {
      await renderSection(state.section);
    } finally {
      button.disabled = false;
      button.textContent = 'Refresh';
    }
  });
  $('#menu-button')?.addEventListener('click', () => {
    setSidebarOpen(!$('#sidebar').classList.contains('open'));
  });
  $('#sidebar-scrim')?.addEventListener('click', () => setSidebarOpen(false));
  $('#admin-signout')?.addEventListener('click', async () => {
    await state.client?.auth.signOut();
    global.DueDiligencePrivateBeta?.clear?.();
    location.replace('../');
  });
  $('#action-form')?.addEventListener('submit', confirmAction);
  $('#action-dialog-close')?.addEventListener('click', () => cancelActionDialog());
  $('#action-dialog-cancel')?.addEventListener('click', () => cancelActionDialog());
  $('#action-dialog')?.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelActionDialog();
  });
  $('#action-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) cancelActionDialog();
  });
  $('#insight-dialog-close')?.addEventListener('click', closeInsight);
  $('#insight-dialog-dismiss')?.addEventListener('click', closeInsight);
  $('#insight-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeInsight();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#sidebar')?.classList.contains('open')) {
      setSidebarOpen(false);
    }
  });
  global.addEventListener('popstate', () => {
    if ($('#action-dialog')?.open) cancelActionDialog({ consumeHistory: false });
  });

  initialize().catch(() => deny('Chambers could not be initialized. No production data was changed.'));
})(window);
