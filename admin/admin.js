(function dueDiligenceAdmin(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const titles = Object.freeze({
    executive: 'Executive Overview',
    realtime: 'Realtime and Traffic',
    acquisition: 'Acquisition and Conversion',
    users: 'Users and Cohorts',
    learning: 'Learning and Scores',
    subjects: 'Subjects and Question Performance',
    reliability: 'Gemini and Platform Reliability',
    subscriptions: 'Subscriptions, Entitlements, and Discounts',
    support: 'Support and Account Recovery',
    corrections: 'Correction / Better Answer Queue',
    advertiser: 'Advertiser and Investor Reports',
    controls: 'Website Controls and Roadmap',
    security: 'Roles, Security, and Audit',
  });
  const requirements = Object.freeze({
    users: 'analytics_viewer',
    learning: 'learner_analytics_viewer',
    subscriptions: 'subscription_admin',
    support: 'support_admin',
    corrections: 'correction_admin',
    advertiser: 'advertiser_report_viewer',
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
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));

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

  function metric(label, value, comparison = null, formatter = number) {
    return `<div class="metric"><small title="${escapeHtml(label)}">${escapeHtml(label)}</small>
      <strong>${escapeHtml(formatter(value))}</strong>${comparison == null ? '<em>Verified current period</em>' : trend(value, comparison)}</div>`;
  }

  function heading(title, copy, actions = '') {
    return `<header class="section-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>${actions}</header>`;
  }

  function empty(copy) {
    return `<div class="empty">${escapeHtml(copy)}</div>`;
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
          <dl class="definition-list">
            <dt>Support</dt><dd>${number(report.queues?.pending_support)} open cases</dd>
            <dt>Corrections</dt><dd>${number(report.queues?.pending_corrections)} pending editorial reviews</dd>
            <dt>Recovery</dt><dd>${number(report.queues?.open_recovery_cases)} open cases; final transfer disabled</dd>
            <dt>Manual access</dt><dd>${number(report.queues?.active_manual_entitlements)} active entitlements</dd>
          </dl>
        </section>
      </div>
      <section class="panel">
        <h3>Commercial truth</h3>
        <div class="notice">${escapeHtml(report.financial?.paid_subscribers_status || 'Paid subscribers: Not connected — payment integration pending.')}</div>
        <p class="panel-note">Revenue, MRR, ARR, ARPU, paid churn, advertising impressions, clicks, CTR, and sponsorship income remain “No verified data” until connected systems exist.</p>
      </section>`;
  }

  function barList(rows) {
    const maximum = Math.max(1, ...rows.map((row) => Number(row[1]) || 0));
    if (!rows.some((row) => Number(row[1]) > 0)) return empty('No verified events in this period.');
    return `<div class="bar-list">${rows.map(([label, value]) => `
      <div class="bar-row"><span>${escapeHtml(label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (Number(value) || 0) / maximum * 100)}%"></div></div>
        <strong>${number(value)}</strong></div>`).join('')}</div>`;
  }

  function renderRealtime(report) {
    const current = report.current?.traffic || {};
    const previous = report.previous?.traffic || {};
    return `
      ${heading('Validated audience activity', 'Current viewers use the last five minutes of visible-page session heartbeats. Sessions are not page views.')}
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
      ${heading('Acquisition and conversion', 'Sanitized sources and activation steps. A zero denominator is reported as unavailable, never as infinity.')}
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

  function table(headers, rows) {
    if (!rows?.length) return empty('No verified records are available.');
    return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell?.html === true ? cell.value : escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
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
      actionButton('Reveal email', 'reveal_email', user.id),
    ]);
    return `
      ${heading('Users and cohorts', 'Normal administrator views use masked identities. Exact email reveal is reason-required, rate-limited, capability-restricted, and audited.')}
      <div class="table-tools"><input id="user-search" type="search" placeholder="Search display name or school" aria-label="Search users"><button class="secondary-button" id="user-search-button">Search</button><button class="secondary-button" id="exact-email-search" type="button">Find exact email</button></div>
      ${table(['Name', 'Masked email', 'School', 'Enrollment', 'Role', 'Last active', 'Grades', 'Action'], rows)}
      <p class="panel-note">${number(data.total)} registered profile record(s). Cohort retention appears only after maturity and sufficient data.</p>`;
  }

  async function renderLearning(report) {
    const data = await loadOperational('learning');
    const current = report.current?.learning || {};
    return `
      ${heading('Learning and scores', 'Scores remain on the existing 0–5 scale with one-decimal display. Failed, timed-out, blocked, missing, and ungraded requests are excluded from score averages.')}
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
      ${heading('Subjects and question performance', 'Content counts come from the published Website Upload bank; database inventory is shown separately for operational transparency.')}
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
      ${heading('Gemini and platform reliability', 'Service telemetry, not a guaranteed uptime monitor. Provider bodies, prompts, answers, credentials, and stack traces are excluded.')}
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
    const data = await loadOperational('subscriptions');
    const rows = (data.items || []).map((row) => [
      row.display_name || 'Not provided', row.masked_email, row.plan_code,
      { html: true, value: `<span class="status ${row.status === 'active' ? 'ok' : 'warn'}">${escapeHtml(row.status)}</span>` },
      dateTime(row.effective_from), dateTime(row.effective_until),
      actionButton('Adjust', 'entitlement_change', row.user_id, {
        plan_code: row.plan_code, status: row.status, entitlement_action: 'adjust',
      }),
    ]);
    return `
      ${heading('Manual access and future pricing', 'No payment provider is connected. These controls change internal access only and do not charge, refund, or cancel a payment mandate.')}
      <div class="notice"><strong>Paid subscribers: Not connected — payment integration pending.</strong><br>Manual access control — no payment provider is connected.</div>
      ${table(['Student', 'Masked email', 'Plan', 'Status', 'Effective', 'Until', 'Action'], rows)}
      <section class="panel">
        <h3>Draft plan catalog — not active</h3>
        ${table(['Plan', 'Planning price', 'Status'], config.plans.items.map((plan) => [
          plan.name, `₱${number(plan.pricePhp, 2)}`, 'DRAFT / NOT ACTIVE',
        ]))}
      </section>
      <section class="panel"><h3>Discount configuration</h3><p class="panel-note">Draft, active, paused, and expired codes are future checkout configuration or manual entitlement promises only. They are not completed financial discounts or payments.</p></section>`;
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
      ${heading('Support and account recovery', 'Resolve only what is necessary. Support content may contain personal context and is limited to authorized operators.')}
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
        <p class="panel-note">A Support request alone never authorizes transfer. Case management preserves the immutable user UUID, but no final transfer action exists.</p>
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
      ${heading('Editorial correction queue', 'Accept or reject is an editorial decision only. It never modifies live questions or suggested answers automatically.')}
      ${table(['Question', 'Subject', 'Type', 'Proposed correction', 'Explanation', 'Sources', 'Status', 'Action'], rows)}`;
  }

  async function renderAdvertiser(report) {
    const data = await loadOperational('advertiser');
    const traffic = report.current?.traffic || {};
    return `
      ${heading('Aggregate advertiser and investor report', 'Printable, aggregate-only reporting. Actual production metrics are separated from future opportunities and scenario assumptions.',
        '<div class="row-actions"><button id="print-report" type="button">Print / PDF</button><button id="export-report" type="button">Export aggregate CSV</button></div>')}
      <div class="metric-strip">
        ${metric('Page views', traffic.page_views)}
        ${metric('Unique visitors', traffic.unique_visitors)}
        ${metric('Sessions', traffic.sessions)}
        ${metric('Registered profiles', data.total)}
        ${metric('Successful grades', report.current?.learning?.successful_grades)}
        ${metric('Grading success', report.current?.reliability?.success_rate, null, percentage)}
      </div>
      <section class="panel"><h3>Verified school representation</h3>${table(
        ['School grouping', 'Registered profiles'],
        (data.items || []).map((row) => [row.school, row.member_count == null ? 'Suppressed' : number(row.member_count)]),
      )}<p class="panel-note">Groups below five registered profiles are suppressed. No student list is exposed.</p></section>
      <section class="panel"><h3>Financial and advertising systems</h3>${table(
        ['Metric', 'Production status'],
        [
          ['Paid subscribers', 'Not connected'],
          ['Revenue / MRR / ARR / ARPU', 'No verified data'],
          ['Paid churn', 'Not connected'],
          ['Advertising impressions / clicks / CTR', 'Not configured'],
          ['Sponsorship income', 'No verified data'],
        ],
      )}</section>
      <section class="panel"><h3>Planning calculator</h3><div class="notice">Scenario only — not actual performance</div>
        <div class="scenario">
          <label>Monthly visitors<input id="scenario-visitors" type="number" min="0" value="10000"></label>
          <label>Conversion assumption (%)<input id="scenario-rate" type="number" min="0" max="100" step=".1" value="2"></label>
          <label>Average plan assumption (₱)<input id="scenario-price" type="number" min="0" value="249"></label>
        </div><div class="scenario-output" id="scenario-output">Scenario only — not actual performance</div>
      </section>`;
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
      ${heading('Safe website controls', 'Only allowlisted, non-destructive content is accepted. Raw HTML, scripts, SQL, secrets, grading prompts, security settings, and guest-limit values are forbidden.')}
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
      <section class="panel"><h3>Roadmap extension points</h3><p class="panel-note">Prepared, but not active: PayMongo, renewals, coaching scheduling, organizations and Bar Operations cohorts, institution dashboards, ad placements, sponsorship reports, notifications, editorial CMS, experiments, daily rollups, and privacy-aware retention automation.</p></section>`;
  }

  async function renderSecurity() {
    const data = await loadOperational('security');
    return `
      ${heading('Roles, security, and audit', 'Only the Super Admin may grant administrator roles or capabilities. Administrators cannot grant privileges to themselves or create another Super Admin.')}
      <div class="notice">Wally remains the sole verified Super Admin. Additional founders remain awaiting first Google sign-in until genuine Auth UUIDs are verified; no founder email is hardcoded.</div>
      ${table(
        ['Time', 'Action', 'Actor UUID', 'Target type', 'Target', 'Reason'],
        (data.items || []).map((row) => [
          dateTime(row.occurred_at), row.action_type, row.actor_user_id || 'System',
          row.target_resource_type || 'Not available', row.target_resource_id || 'Not available',
          row.reason || 'Not provided',
        ]),
      )}
      <section class="panel"><h3>Capability model</h3><p class="panel-note">analytics_viewer · learner_analytics_viewer · support_admin · correction_admin · subscription_admin · account_recovery_admin · advertiser_report_viewer · role_admin</p></section>`;
  }

  async function renderSection(section) {
    state.section = section;
    $('#section-title').textContent = titles[section];
    $$('#admin-nav button').forEach((button) => button.setAttribute(
      'aria-current',
      button.dataset.section === section ? 'page' : 'false',
    ));
    $('#sidebar').classList.remove('open');
    $('#menu-button').setAttribute('aria-expanded', 'false');
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
      else if (section === 'support') html = await renderSupport();
      else if (section === 'corrections') html = await renderCorrections();
      else if (section === 'advertiser') html = await renderAdvertiser(report);
      else if (section === 'controls') html = await renderControls();
      else if (section === 'security') html = await renderSecurity();
      $('#dashboard-view').innerHTML = html;
      bindDynamic();
    } catch (error) {
      $('#dashboard-view').innerHTML = heading('Dashboard unavailable', error.message || 'Administrator data could not be loaded.')
        + empty('No production data was changed. Refresh after connectivity or authorization is restored.');
    }
  }

  function actionField(label, id, value = '', type = 'text') {
    return `<label class="field">${escapeHtml(label)}<input id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"></label>`;
  }

  function openAction(action, targetId, payload) {
    state.action = { action, targetId: targetId || null, payload: { ...(payload || {}) } };
    let fields = '';
    let title = 'Confirm action';
    let warning = 'This operation is transactional, reason-required, and recorded in the administrator audit log.';
    if (action === 'support_update') {
      title = 'Update support case';
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
    } else if (action === 'website_control_update') {
      title = 'Update allowlisted website control';
      fields = `${actionField('Control key', 'action-control', payload.control_key)}
        <label class="field">JSON value<textarea id="action-value" maxlength="8000">${escapeHtml(JSON.stringify(payload.value || {}, null, 2))}</textarea></label>
        <label class="field"><span><input id="action-published" type="checkbox"${payload.is_published ? ' checked' : ''}> Publish this value</span></label>`;
      warning = 'Raw HTML, scripts, SQL, secrets, grading controls, and destructive settings are rejected.';
    } else if (action === 'reveal_email') {
      title = 'Reveal exact account email';
      warning = 'Exact email access is capability-restricted, rate-limited, reason-required, and audited.';
    } else if (action === 'find_email') {
      title = 'Find account by exact email';
      fields = actionField('Exact email', 'action-email', '', 'email');
      warning = 'Exact email search is server-side, capability-restricted, rate-limited, reason-required, and audited.';
    }
    $('#action-title').textContent = title;
    $('#action-fields').innerHTML = fields;
    $('#action-warning').textContent = warning;
    $('#action-reason').value = '';
    $('#action-dialog').showModal();
  }

  async function confirmAction(event) {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') {
      $('#action-dialog').close();
      return;
    }
    if (!state.action) return;
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
    } else if (action === 'website_control_update') {
      payload.control_key = $('#action-control').value;
      try { payload.value = JSON.parse($('#action-value').value); } catch {
        toast('Control value must be valid JSON.');
        return;
      }
      payload.is_published = $('#action-published').checked;
    }
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
          ? `Match: ${response.data.display_name || 'Unnamed account'} (${response.data.masked_email})`
          : 'No account matched that exact email.');
      } else {
        await api('/admin/action', {
          action,
          targetId: state.action.targetId,
          payload,
          reason,
          requestKey: uuidKey(),
        });
        toast('Audited action completed.');
      }
      $('#action-dialog').close();
      state.operational.clear();
      await renderSection(state.section);
    } catch (error) {
      toast(error.message || 'Action failed without changing production data.');
    } finally {
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
    if (!config?.features?.adminDashboard || !global.supabase?.createClient) {
      deny('The protected dashboard is not configured.');
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
    state.report = null;
    state.operational.clear();
    await renderSection(state.section);
  });
  $('#menu-button')?.addEventListener('click', () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#menu-button').setAttribute('aria-expanded', String(open));
  });
  $('#admin-signout')?.addEventListener('click', async () => {
    await state.client?.auth.signOut();
    location.replace('../');
  });
  $('#action-form')?.addEventListener('submit', confirmAction);

  initialize().catch(() => deny('The dashboard could not be initialized. No production data was changed.'));
})(window);
