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
    support: 'Co-Counsel Requests',
    corrections: 'Answer Corrections',
    partnerships: 'Joint Ventures',
    controls: 'Website Settings',
    security: 'Access & Activity Log',
  });
  const requirements = Object.freeze({
    users: 'analytics_viewer',
    learning: 'learner_analytics_viewer',
    subscriptions: 'subscription_admin',
    payments: 'subscription_admin',
    refunds: 'subscription_admin',
    support: 'support_admin',
    corrections: 'correction_admin',
    partnerships: 'advertiser_report_viewer',
    controls: 'role_admin',
    security: 'role_admin',
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

  async function loadPhase4Operational(section, force = false, search = null) {
    const key = `phase4:${section}:${search || ''}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/phase4-data', {
      section,
      search: search || '',
      limit: 100,
      offset: 0,
    });
    state.operational.set(key, payload.data);
    return payload.data;
  }

  function renderExecutive(report) {
    const current = report.current || {};
    const previous = report.previous || {};
    const traffic = current.traffic || {};
    const priorTraffic = previous.traffic || {};
    const funnel = current.funnel || {};
    const learning = current.learning || {};
    const reliability = current.reliability || {};
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
            ${queueLink('Co-Counsel', `${number(report.queues?.pending_support)} open cases`, 'support')}
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
    const data = await loadOperational('users');
    const rows = (data.items || []).map((user) => [
      user.display_name || 'Not provided',
      user.masked_email,
      user.school || 'Not provided',
      user.enrollment_status || 'Not provided',
      user.role,
      dateTime(user.last_active_at),
      number(user.successful_grade_count),
      {
        html: true,
        value: `<div class="row-actions">
          ${actionButton('Reveal email', 'reveal_email', user.id).value}
          ${state.authorization?.role === 'super_admin' && user.role !== 'super_admin'
            ? actionButton('Change role', 'role_change', user.id, { role: user.role }).value
            : ''}
        </div>`,
      },
    ]);
    return `
      ${heading('Students', 'Normal administrator views use masked identities. Exact email reveal is reason-required, rate-limited, capability-restricted, and audited.')}
      <div class="table-tools"><input id="user-search" type="search" placeholder="Search display name or school" aria-label="Search users"><button class="secondary-button" id="user-search-button">Search</button><button class="secondary-button" id="exact-email-search" type="button">Find exact email</button></div>
      ${table(['Name', 'Masked email', 'School', 'Enrollment', 'Role', 'Last active', 'Grades', 'Action'], rows)}
      <p class="panel-note">${number(data.total)} registered profile record(s). Cohort retention appears only after maturity and sufficient data.</p>`;
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
    state.subscriptionRows.clear();
    const rows = (data.items || []).map((row) => {
      state.subscriptionRows.set(row.user_id, Object.freeze({ ...row }));
      return [
        row.display_name || 'Not provided',
        row.role,
        row.trial_expires_at ? dateTime(row.trial_expires_at) : 'Not started',
        `${number(row.successful_grades)} used · ${number(row.free_grades_remaining)} remaining`,
        row.free_beta_enabled ? `Enabled${row.free_beta_expires_at ? ` until ${dateTime(row.free_beta_expires_at)}` : ''}` : 'Disabled',
        row.plan_code || 'None',
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
      <div class="notice danger"><strong>Access-impacting action.</strong> Verify the student, plan, dates, and reason before confirming.</div>
      ${table(['Student', 'Role', 'Trial expires', 'Lifetime grades', 'Free Beta', 'Plan', 'Retainer status', 'Expires', 'Actions'], rows)}
      <section class="panel">
        <h3>Production plan catalog</h3>
        ${table(['Plan', 'Planning price', 'Status'], config.plans.items.map((plan) => [
          plan.name, `₱${number(plan.pricePhp, 2)}`,
          plan.previewStatus === 'disabled' ? 'Held in Abeyance' : 'Active · manual verification',
        ]))}
      </section>
      <section class="panel"><h3>Refund policy</h3><p class="panel-note">Five-calendar-day cancellations suggest an 80% refund. Later requests use unused time and documented consumption. A verified 20-day continuous outage supports prorated refund or equivalent extension. All decisions require Founder documentation.</p></section>`;
  }

  async function renderPayments() {
    const data = await loadPhase4Operational('payments');
    return `
      ${heading('Payment Review', 'Review GCash and MariBank requests. Private proofs open through five-minute signed links and every view is audited.')}
      <div class="notice danger"><strong>Money and access warning.</strong> Approval activates the exact selected 30-day plan. Confirm channel, amount, reference, date, and proof before proceeding.</div>
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
              ${actionButton('Review', 'payment_review', row.id, { status: row.status }).value}
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
      ${heading('Co-Counsel Requests', 'Resolve only what is necessary. Co-Counsel content may contain personal context and is limited to authorized operators.')}
      <div class="notice"><strong>Public recovery copy:</strong> Contact Co-Counsel. We respond within 24 hours.</div>
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
        <p class="panel-note">A Co-Counsel request alone never authorizes transfer. Case management preserves the immutable user UUID, but no final transfer action exists.</p>
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
      ${heading('Joint Ventures', 'Native institutional, academic, content, technology, and media inquiries. Contact details are operationally sensitive and access is audited.')}
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
      ['support_availability_message', 'Co-Counsel availability message'],
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
      $('#dashboard-view').innerHTML = html;
      bindDynamic();
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
      return `${verb} ${planDisplayName(plan)} · trusted 30-day catalog terms`;
    }
    if (operation === 'pause') return 'Pause the active Retainer';
    if (operation === 'resume') return 'Resume the paused Retainer';
    if (operation === 'cancel') return 'Cancel the current Retainer';
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
        : `${plan.durationDays} days · catalog-controlled access`;
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
      } else if (payload.operation === 'set_expiration_date') {
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
      title = 'Update Co-Counsel request';
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
        <option value="approved">Approve and activate exact 30-day plan</option>
        <option value="rejected">Reject</option>
      </select></label>`;
      warning = 'Approval is immediate: it activates the exact selected plan for 30 calendar days. Verify amount, channel, reference, date, and private proof before confirming.';
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
        cancel: 'Cancel Retainer',
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
    }
    $('#action-title').textContent = title;
    const isAccessAction = Boolean(subscriptionActions?.isAccessAction(action));
    if (isAccessAction) buildAccessActionFields(action, state.action.payload);
    else $('#action-fields').innerHTML = fields;
    $('#action-context').hidden = !isAccessAction;
    $('#action-confirmation').hidden = !isAccessAction;
    $('#action-confirm-risk').checked = false;
    $('#action-confirm').textContent = action === 'subscription_audit_view'
      ? 'View audited history' : 'Confirm audited action';
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
    if (accessAction && !$('#action-confirm-risk').checked) {
      toast('Confirm that you verified the target and proposed access change.');
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
    } else if (action === 'refund_review') {
      payload.status = $('#action-status').value;
      payload.approvedRefundPhp = Number($('#action-refund-amount').value);
    } else if (action === 'subscription_change') {
      if (['activate', 'complimentary', 'replace_plan'].includes(payload.operation)) {
        payload.planCode = selectedPlan();
        if (!payload.planCode || payload.planCode === 'premium') {
          toast('Select an available plan. Premium remains held in abeyance.');
          return;
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
      } else if (payload.operation === 'set_expiration_date') {
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
        const data = await loadOperational('users', true, search);
        state.operational.set('users:', data);
        await renderSection('users');
      } catch (error) { toast(error.message); }
    });
    $('#exact-email-search')?.addEventListener('click', () => openAction('find_email', null, {}));
    $('#print-report')?.addEventListener('click', () => global.print());
    $('#export-report')?.addEventListener('click', async () => {
      try {
        const response = await fetch(`${config.workerUrl}/admin/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.session.access_token}`,
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
      button.hidden = Boolean(needed && !has(needed));
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
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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
