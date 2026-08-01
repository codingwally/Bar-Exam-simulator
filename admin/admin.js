(function dueDiligenceAdmin(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const subscriptionActions = global.DueDiligenceSubscriptionActions;
  const titles = Object.freeze({
    executive: 'Overview',
    realtime: 'Live Activity',
    acquisition: 'Sign-ups',
    users: 'Users',
    learning: 'Learning Performance',
    subjects: 'Question Bank',
    reliability: 'Grading Health',
    subscriptions: 'Subscriptions',
    payments: 'Payments',
    refunds: 'Refunds',
    support: 'Support',
    corrections: 'Answer Corrections',
    partnerships: 'Partnerships',
    controls: 'Website Settings',
    security: 'Security & Activity Log',
    forum: 'Quorum',
    examinations: 'Exams',
    answer_exports: 'Answers',
  });
  const requirements = Object.freeze({
    realtime: 'learner_analytics_viewer',
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
    userOffset: 0,
    subscriptionSearch: '',
    subscriptionOffset: 0,
    liveActivity: null,
    answerHistory: null,
    answerSearch: '',
    answerType: 'all',
    answerOffset: 0,
    quorumPosts: null,
    quorumPostSearch: '',
    quorumPostStatus: 'all',
    quorumPostOffset: 0,
    subscriptionExportRows: [],
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

  function sectionAllowed(section) {
    if (!titles[section]) return false;
    const founderOnly = ['forum', 'examinations', 'answer_exports'].includes(section);
    const founderAuthorized = ['founder_admin', 'super_admin'].includes(
      state.authorization?.role,
    );
    if (founderOnly && !founderAuthorized) return false;
    if (section === 'subscriptions'
        && (!has('subscription_admin') || !has('learner_analytics_viewer'))) {
      return false;
    }
    const needed = requirements[section];
    return !needed || has(needed);
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
      copy: options.copy || 'Verified total for the selected reporting period.',
      source: options.source || 'Due Diligence website records',
    }));
  }

  function metric(label, value, comparison = null, formatter = number, options = {}) {
    const displayValue = formatter(value);
    const destination = options.section && sectionAllowed(options.section)
      ? `data-admin-section="${escapeHtml(options.section)}"`
      : `data-insight="${insightData(label, displayValue, options)}"`;
    const status = comparison == null
      ? `<em>${escapeHtml(options.subtext || '')}</em>`
      : trend(value, comparison);
    return `<button type="button" class="metric" ${destination}
      aria-label="${escapeHtml(options.section && sectionAllowed(options.section) ? 'Open' : 'Explain')} ${escapeHtml(label)}: ${escapeHtml(displayValue)}">
      <small title="${escapeHtml(label)}">${escapeHtml(label)}</small>
      <strong>${escapeHtml(displayValue)}</strong>${status}
      <span class="metric-cue">${escapeHtml(options.cue || (options.section && sectionAllowed(options.section) ? 'Open details' : 'How this is counted'))}</span></button>`;
  }

  function summaryMetric(label, value, subtext = '') {
    return `<div class="metric static-metric">
      <small title="${escapeHtml(label)}">${escapeHtml(label)}</small>
      <strong>${escapeHtml(value == null ? 'Not available' : value)}</strong>
      ${subtext ? `<em>${escapeHtml(subtext)}</em>` : ''}
    </div>`;
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

  async function loadUserDirectory(
    force = false,
    search = state.userSearch,
    offset = state.userOffset,
  ) {
    const normalizedSearch = String(search || '').trim();
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const key = `directory:${normalizedSearch}:${normalizedOffset}`;
    if (!force && state.operational.has(key)) return state.operational.get(key);
    const payload = await api('/admin/user-directory', {
      search: normalizedSearch,
      limit: 100,
      offset: normalizedOffset,
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

  async function loadLiveActivity(force = false) {
    if (state.liveActivity && !force) return state.liveActivity;
    const payload = await api('/admin/live-activity', {
      limit: 100,
      requestKey: uuidKey(),
    });
    state.liveActivity = payload.data;
    return state.liveActivity;
  }

  async function loadAnswerHistory(force = false) {
    const key = `answers:${state.answerSearch}:${state.answerType}:${state.answerOffset}`;
    if (!force && state.operational.has(key)) {
      state.answerHistory = state.operational.get(key);
      return state.answerHistory;
    }
    const payload = await api('/admin/answer-history', {
      targetUserId: null,
      from: null,
      to: null,
      search: state.answerSearch || null,
      recordSource: state.answerType,
      limit: 100,
      offset: state.answerOffset,
    });
    state.answerHistory = payload.data;
    state.operational.set(key, state.answerHistory);
    return state.answerHistory;
  }

  function currentAnswerHistoryItems() {
    return Array.isArray(state.answerHistory?.items) ? state.answerHistory.items : [];
  }

  async function loadQuorumPosts(force = false) {
    if (state.quorumPosts && !force) return state.quorumPosts;
    const payload = await api('/admin/quorum/posts', {
      search: state.quorumPostSearch,
      status: state.quorumPostStatus,
      limit: 100,
      offset: state.quorumPostOffset,
      requestKey: uuidKey(),
    });
    state.quorumPosts = payload.data;
    return state.quorumPosts;
  }

  function compactText(value, emptyCopy = 'Not available') {
    const text = String(value || '').trim();
    return text || emptyCopy;
  }

  function detailCell(value, label = 'View') {
    const text = compactText(value);
    return {
      html: true,
      value: `<details class="record-detail"><summary>${escapeHtml(label)}</summary><div>${escapeHtml(text)}</div></details>`,
    };
  }

  function csvCell(value) {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCsv(filename, headers, rows) {
    const csv = `\uFEFF${[headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  }

  function visibleCellText(cell) {
    const copy = cell.cloneNode(true);
    copy.querySelectorAll('button, input, select, textarea').forEach((node) => node.remove());
    return String(copy.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function downloadCurrentSection() {
    const view = $('#dashboard-view');
    if (!view) return;
    const rangeControl = $('#reporting-range');
    const rows = [
      ['Page', titles[state.section] || 'Admin'],
      ['Downloaded', new Date().toISOString()],
      [rangeControl?.hidden ? 'Scope' : 'Date range', rangeControl?.hidden
        ? 'All records shown for the current filters'
        : ($('#date-range')?.selectedOptions?.[0]?.textContent || 'Current view')],
      [],
    ];

    view.querySelectorAll('.metric').forEach((item) => {
      rows.push([
        'Summary',
        item.querySelector('small')?.textContent?.trim() || 'Measure',
        item.querySelector('strong')?.textContent?.trim() || 'Not available',
        item.querySelector('em')?.textContent?.trim() || '',
      ]);
    });

    view.querySelectorAll('table').forEach((dataTable, index) => {
      const panel = dataTable.closest('.panel');
      const name = panel?.querySelector('h3')?.textContent?.trim() || `Table ${index + 1}`;
      rows.push([], [name]);
      rows.push([...dataTable.querySelectorAll('thead th')].map(visibleCellText));
      dataTable.querySelectorAll('tbody tr').forEach((row) => {
        rows.push([...row.querySelectorAll('td')].map(visibleCellText));
      });
    });

    view.querySelectorAll('.bar-row, .queue-link').forEach((item) => {
      const parts = [...item.children].map(visibleCellText).filter(Boolean);
      if (parts.length) rows.push(['Page detail', ...parts]);
    });

    view.querySelectorAll('.definition-list').forEach((list) => {
      const terms = [...list.querySelectorAll('dt')];
      terms.forEach((term) => {
        rows.push(['Page detail', visibleCellText(term), visibleCellText(term.nextElementSibling)]);
      });
    });

    view.querySelectorAll('.notice, .panel-note').forEach((note) => {
      const copy = visibleCellText(note);
      if (copy) rows.push(['Note', copy]);
    });

    if (rows.length === 4) {
      rows.push(['Page summary', String(view.textContent || '').replace(/\s+/g, ' ').trim()]);
    }
    const filenameSection = String(titles[state.section] || 'admin')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadCsv(`due-diligence-${filenameSection || 'admin'}-current-page.csv`, rows[0], rows.slice(1));
    toast('Current page data downloaded for Google Sheets. Use the page-specific download for the complete record set.');
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
    const betaKnown = typeof betaAllAccess.enabled === 'boolean';
    const betaEnabled = betaAllAccess.enabled === true;
    const founderAuthorized = ['founder_admin', 'super_admin'].includes(state.authorization?.role);
    return `
      ${heading('Overview', 'The people, answers, access, and service facts needed to manage the beta.')}
      <div class="metric-strip executive-metrics">
        ${metric('Recent signed-in activity', engagement.activeSignedInLast5Minutes, null, number, {
          section: 'realtime', subtext: 'Last 5 minutes · approximate', cue: 'Review activity totals',
        })}
        ${metric('Signed-in accounts', engagement.signedInAccounts, null, number, {
          section: 'users', subtext: 'All time', cue: 'Open user list',
        })}
        ${metric('Users who answered', engagement.usersWithAnswers, null, number, {
          section: 'answer_exports', subtext: 'All time', cue: 'See answer records',
        })}
        ${metric('Questions answered', engagement.questionsAnswered, null, number, {
          section: 'answer_exports', subtext: 'Practice and formal exams', cue: 'See answer records',
        })}
        ${metric('Open Quorum reports', engagement.openQuorumReports, null, number, {
          section: 'forum', subtext: 'Needs review', cue: 'Open Quorum',
        })}
        ${metric('Grading success rate', reliability.success_rate, previous.reliability?.success_rate, percentage, {
          section: 'reliability', cue: 'Open grading health',
        })}
      </div>
      <section class="panel">
        <h3>Beta All Access</h3>
        <div class="notice ${betaKnown && !betaEnabled ? 'danger' : ''}">
          <strong>${!betaKnown ? 'Status could not be confirmed.' : betaEnabled ? 'Enabled for all current and future signed-in users.' : 'Disabled — older per-account access rules are active.'}</strong>
          ${!betaKnown
            ? ' Refresh before making any access decision.'
            : betaEnabled
            ? ' Access has no automatic per-user expiration while this protected setting remains enabled.'
            : ' Re-enable only after reviewing the effect on every user.'}
        </div>
        <dl class="definition-list">
          <dt>Who has access</dt><dd>${!betaKnown ? 'Not confirmed' : betaEnabled ? 'All current and future signed-in users who accepted the current terms' : 'Older per-account rules apply'}</dd>
          <dt>Automatic expiry</dt><dd>${!betaKnown ? 'Not confirmed' : betaEnabled ? 'None' : 'Older rules apply'}</dd>
          <dt>Accounts with Beta All Access</dt><dd>${escapeHtml(!betaKnown ? 'Not confirmed' : betaEnabled ? number(betaAllAccess.signedInAccountCount ?? engagement.signedInAccounts) : '0')}</dd>
          <dt>Required before access</dt><dd>Users must accept the current Beta Terms and Privacy Notice.</dd>
          <dt>Access setting</dt><dd>${!betaKnown ? 'Not confirmed' : betaEnabled ? 'Remains active until an authorized founder turns it off.' : 'Currently off.'}</dd>
          <dt>Public beta terms</dt><dd>Free through at least August 15, 2026 and may continue while the developers determine that beta testing is still needed.</dd>
          <dt>Last changed</dt><dd>${escapeHtml(dateTime(betaAllAccess.updatedAt))}</dd>
        </dl>
        ${founderAuthorized && betaKnown ? `<div class="dialog-actions">
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
          <h3>Reach and engagement</h3>
          ${table(['Measure', 'Current period', 'Previous period'], [
            ['Page views', number(traffic.page_views), number(priorTraffic.page_views)],
            ['Unique visitors', number(traffic.unique_visitors), number(priorTraffic.unique_visitors)],
            ['Registrations', number(funnel.registrations), number(previous.funnel?.registrations)],
            ['Successful grades', number(learning.successful_grades), number(previous.learning?.successful_grades)],
          ])}
        </section>
        <section class="panel">
          <h3>Action queue</h3>
          <div class="queue-grid">
            ${queueLink('Support', `${number(report.queues?.pending_support)} open cases`, 'support')}
            ${queueLink('Corrections', `${number(report.queues?.pending_corrections)} pending editorial reviews`, 'corrections')}
            ${queueLink('Account help', `${number(report.queues?.open_recovery_cases)} open cases; final transfer disabled`, 'support')}
            ${queueLink('Subscriptions', `${number(report.queues?.active_manual_entitlements)} subscriptions added by Admin`, 'subscriptions')}
          </div>
        </section>
      </div>
      <section class="panel">
        <h3>Business reporting</h3>
        <div class="notice">${escapeHtml(report.financial?.paid_subscribers_status || 'Paid subscribers: Not connected — payment integration pending.')}</div>
        <p class="panel-note">Revenue, monthly and annual recurring revenue, average revenue per user, and cancellations remain unavailable until verified financial records are connected.</p>
      </section>`;
  }

  function barList(rows) {
    const maximum = Math.max(1, ...rows.map((row) => Number(row[1]) || 0));
    if (!rows.some((row) => Number(row[1]) > 0)) return empty('No verified events in this period.');
    return `<div class="bar-list">${rows.map(([label, value]) => `
      <button type="button" class="bar-row" data-insight="${insightData(label, number(value), {
    copy: 'Verified event count for this step in the selected reporting period.',
    source: 'Due Diligence website records',
  })}"><span>${escapeHtml(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, (Number(value) || 0) / maximum * 100)}%"></span></span>
        <strong>${number(value)}</strong></button>`).join('')}</div>`;
  }

  async function renderRealtime(report) {
    const activity = await loadLiveActivity();
    const current = report.current?.traffic || {};
    const previous = report.previous?.traffic || {};
    return `
      ${heading('Live Activity', 'Approximate activity totals for recent signed-in sessions. Exact online names are withheld because the current session records cannot reliably identify a person after sign-out or an account switch.')}
      <div class="metric-strip">
        ${metric('Active sessions · 5 minutes', activity.activeSignedInLast5Minutes, null, number, {
          subtext: 'Approximate · not exact people online',
        })}
        ${metric('Active sessions · 30 minutes', activity.activeSignedInLast30Minutes, null, number, {
          subtext: 'Approximate · may include stale sessions',
        })}
        ${metric('Sessions', current.sessions, previous.sessions)}
        ${metric('Average daily views', current.average_daily_views, previous.average_daily_views, (v) => number(v, 1))}
        ${metric('Average daily visitors', current.average_daily_unique_visitors, previous.average_daily_unique_visitors, (v) => number(v, 1))}
        ${metric('Daily users as % of monthly users', current.dau_mau_ratio, previous.dau_mau_ratio, percentage)}
        ${metric('Weekly users as % of monthly users', current.wau_mau_ratio, previous.wau_mau_ratio, percentage)}
      </div>
      <section class="panel">
        <div class="panel-title-row"><div><h3>Recent activity summary</h3><p class="panel-note">Use these totals for broad demand monitoring only. The Admin does not label a named user as online until sign-in, sign-out, and account switching can be matched reliably.</p></div><button class="secondary-button" id="download-live-activity" type="button">Download summary</button></div>
        ${table(['Measure', 'Value', 'Meaning'], [
          ['Activity in the last 5 minutes', number(activity.activeSignedInLast5Minutes), 'Approximate signed-in-session records'],
          ['Activity in the last 30 minutes', number(activity.activeSignedInLast30Minutes), 'Approximate signed-in-session records'],
        ])}
      </section>
      <div class="work-grid">
        <section class="panel"><h3>Signed-in and guest sessions</h3>${barList([
          ['Signed-in sessions', current.authenticated_sessions],
          ['Guest sessions', current.guest_sessions],
        ])}</section>
        <section class="panel"><h3>Device category</h3>${barList((report.devices || []).map((row) => [row.category, row.sessions]))}</section>
      </div>
      <section class="panel"><h3>How this is counted</h3><p class="panel-note">Activity is based on periodic visible-page updates. Existing records may continue after sign-out or be reused after an account switch, so this page intentionally shows totals rather than named people. Private answers, tokens, prompts, IP addresses, and full browser identifiers are not shown here.</p></section>`;
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
      ${heading('Visitors & Sign-ups', 'See where visitors came from and how they moved from sign-in to registration. Rates appear only when enough data exists.')}
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
      <section class="panel"><h3>Return visits</h3>
        ${table(['Time since sign-up', 'Users old enough to measure', 'Returned', 'Return rate'], retentionRows)}
        <p class="panel-note">One-day, seven-day, and 30-day return rates appear only after the full period has passed and at least five users can be measured.</p>
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
      user.subscription_category || 'Regular',
      user.effective_access || 'Not available',
      dateTime(user.last_sign_in_at),
      number(user.answered_question_count),
      `${number(user.practice_answered_count)} practice · ${number(user.examination_answered_count)} formal`,
      user.average_score == null
        ? 'Not available'
        : `${number(user.average_score, 1)} average · ${number(user.latest_score, 1)} latest`,
      {
        html: true,
        value: `<div class="row-actions">
          ${founderAuthorized
            ? `<button type="button" data-view-user-answers data-user-email="${escapeHtml(user.email || '')}">View answers</button>`
            : ''}
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
    const pageStart = Number(data.offset ?? state.userOffset) + (rows.length ? 1 : 0);
    const pageEnd = Number(data.offset ?? state.userOffset) + rows.length;
    const canGoBack = state.userOffset > 0;
    const canGoForward = pageEnd < Number(data.total || 0);
    return `
      ${heading('Users', 'Search exact names and email addresses, review access and answer activity, or download the current user list for Google Sheets.')}
      <div class="table-tools"><input id="user-search" type="search" value="${escapeHtml(state.userSearch)}" placeholder="Search name, school, or email" aria-label="Search users"><button class="secondary-button" id="user-search-button">Search</button><button class="secondary-button" id="user-directory-export" type="button">Download user list</button></div>
      ${table(['Name', 'Email', 'Subscription', 'Access', 'Last sign-in', 'Questions answered', 'Answer types', 'Score', 'Actions'], rows)}
      <div class="pagination-bar">
        <p class="panel-note">Showing ${number(pageStart)}–${number(pageEnd)} of ${number(data.total)} matching account(s).</p>
        <div class="row-actions">
          <button class="secondary-button" id="users-previous" type="button"${canGoBack ? '' : ' disabled'}>Previous</button>
          <button class="secondary-button" id="users-next" type="button"${canGoForward ? '' : ' disabled'}>Next</button>
        </div>
      </div>
      ${founderAuthorized ? `<section class="panel">
        <h3>Email the user list to a founder</h3>
        <p class="panel-note">Choose an approved founder. The file includes exact email addresses and is recorded in the activity log.</p>
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
          <label>Reason for sending<textarea id="user-directory-email-reason" minlength="5" maxlength="1000" required></textarea></label>
          <label class="check-row"><input id="user-directory-email-confirm" type="checkbox" required> I am authorized to send this user list to the selected founder.</label>
          <button class="secondary-button" type="submit">Email user list</button>
        </form>
      </section>` : ''}`;
  }

  async function renderAnswerExports(report) {
    const engagement = report.engagement || report.engagementOverview || {};
    const data = await loadAnswerHistory();
    const filteredItems = currentAnswerHistoryItems();
    const pageStart = Number(data.offset ?? state.answerOffset) + (filteredItems.length ? 1 : 0);
    const pageEnd = Number(data.offset ?? state.answerOffset) + filteredItems.length;
    const rows = filteredItems.map((item) => [
      item.userDisplayName || 'Not provided',
      item.userEmail || 'Not available',
      item.subscriptionCategory || 'Not available',
      item.recordSource === 'formal_exam' ? 'Formal exam' : 'Practice',
      item.subject || item.examTitle || 'Not available',
      detailCell(item.questionText, 'View question'),
      detailCell(item.submittedAnswer, 'View answer'),
      item.score == null ? 'Not graded' : number(item.score, 1),
      detailCell(item.suggestedAnswer, 'View suggested answer'),
      detailCell(item.modelAnswer, 'View model answer'),
      dateTime(item.submittedAt || item.answerSavedAt || item.completedAt),
    ]);
    return `
      ${heading('Answers', 'See exactly who answered, what they answered, and the stored score, suggested answer, and model answer. This page does not change simulator content or grading.')}
      <div class="metric-strip">
        ${summaryMetric('Users who answered', number(engagement.usersWithAnswers), 'All time')}
        ${summaryMetric('Questions answered', number(engagement.questionsAnswered), 'All time')}
        ${summaryMetric('Practice answers', number(engagement.practiceQuestionsAnswered), 'All time')}
        ${summaryMetric('Formal exam answers', number(engagement.examinationQuestionsAnswered), 'All time')}
      </div>
      <section class="panel">
        <div class="panel-title-row"><div><h3>Answer records</h3><p class="panel-note">Showing ${number(pageStart)}–${number(pageEnd)} of ${number(data.total)} matching answer record(s). “Not available” means that the source record does not contain that field.</p></div><button class="secondary-button" id="download-answer-view" type="button">Download this page</button></div>
        <div class="table-tools">
          <input id="answer-search" type="search" value="${escapeHtml(state.answerSearch)}" placeholder="Search name, email, question, or subject" aria-label="Search answer records">
          <select id="answer-type" aria-label="Filter answer type">
            <option value="all"${state.answerType === 'all' ? ' selected' : ''}>All answer types</option>
            <option value="practice"${state.answerType === 'practice' ? ' selected' : ''}>Practice</option>
            <option value="formal_exam"${state.answerType === 'formal_exam' ? ' selected' : ''}>Formal exam</option>
          </select>
          <button class="secondary-button" id="answer-filter-button" type="button">Apply filter</button>
        </div>
        <p class="panel-note">Formal-exam questions and model answers come from the version saved with that exam. Older practice attempts did not save an exact copy of the question or suggested answer, so those fields are shown as unavailable instead of being guessed from today’s Question Bank.</p>
        ${table(['Name', 'Email', 'Subscription', 'Type', 'Subject or exam', 'Question', 'Student answer', 'Score', 'Suggested answer', 'Model answer', 'Submitted'], rows)}
        <div class="pagination-bar">
          <p class="panel-note">Up to 100 records per page.</p>
          <div class="row-actions">
            <button class="secondary-button" id="answers-previous" type="button"${state.answerOffset > 0 ? '' : ' disabled'}>Previous</button>
            <button class="secondary-button" id="answers-next" type="button"${data.hasMore ? '' : ' disabled'}>Next</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <h3>Download complete answer history</h3>
        <p class="panel-note">The Google Sheets-compatible file includes exact names and emails plus all stored answer, score, feedback, suggested-answer, and model-answer fields.</p>
        <form class="exam-admin-form" id="answer-history-export-form">
          <div class="panel-grid">
            <label>From date (optional)<input id="answer-history-from" type="date"></label>
            <label>Through date (optional, inclusive)<input id="answer-history-to" type="date"></label>
          </div>
          <label>Reason for downloading<textarea id="answer-history-reason" minlength="5" maxlength="1000" required></textarea></label>
          <label class="check-row"><input id="answer-history-confirm" type="checkbox" required> I am authorized to download private student work and will store it securely.</label>
          <button class="primary-button" type="submit">Download all answer records</button>
        </form>
      </section>`;
  }

  async function renderLearning(report) {
    const [learningData, data] = await Promise.all([
      loadOperational('learning'),
      loadUserDirectory(false, '', 0),
    ]);
    const current = report.current?.learning || {};
    return `
      ${heading('Learning Performance', 'Scores use the simulator’s 0–5 scale and one decimal place. Failed, timed-out, blocked, missing, and ungraded requests are not included in averages.')}
      <div class="metric-strip">
        ${metric('Attempt average', current.attempt_average, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Mastery average', current.mastery_average, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Median score', current.median_score, null, (v) => v == null ? 'Not available' : `${number(v, 1)} / 5`)}
        ${metric('Score sample', current.sample_size)}
        ${metric('Latest-answer sample', current.mastery_sample_size)}
        ${metric('Repeated-question improvement', current.average_improvement, null, (v) => v == null ? 'Not available' : `${Number(v) >= 0 ? '+' : ''}${number(v, 1)}`)}
        ${metric('Questions viewed', current.questions_viewed)}
        ${metric('Successful grades', current.successful_grades)}
        ${metric('Users with grades', learningData.total)}
      </div>
      ${table(
        ['Name', 'Email', 'Subscription', 'Average score', 'Questions answered', 'Latest score', 'Last sign-in'],
        (data.items || []).map((row) => [
          row.display_name || 'Not provided', row.email || 'Not available',
          row.subscription_category || 'Regular',
          row.average_score == null ? 'Not available' : `${number(row.average_score, 1)} / 5`,
          number(row.answered_question_count),
          row.latest_score == null ? 'Not available' : `${number(row.latest_score, 1)} / 5`,
          dateTime(row.last_sign_in_at),
        ]),
      )}
      <p class="panel-note">This summary shows up to 100 accounts. Use Users for the complete searchable and downloadable list, or Answers for each stored question, response, score, suggested answer, and model answer. Mastery uses the latest successful score for each user and question.</p>`;
  }

  function renderSubjects(report) {
    return `
      ${heading('Question Bank', 'Content counts come from the published Question Bank. The stored count helps Admins confirm that the website is using the expected records.')}
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
          row.low_sample ? 'Too few grades for a firm result' : `Based on ${number(row.sample_size)} grades`,
        ]),
      )}
      <p class="panel-note">Early results appear only after five successful grades and should not be treated as final. Corrections never change the live Question Bank automatically.</p>`;
  }

  function renderReliability(report) {
    const reliability = report.current?.reliability || {};
    return `
      ${heading('AI Grading Health', 'Recent grading service records. This is not a guaranteed uptime monitor, and private answers, prompts, passwords, and internal error details are not shown.')}
      <div class="metric-strip">
        ${metric('Grading starts', reliability.grading_started)}
        ${metric('Successes', reliability.grading_success)}
        ${metric('Failures', reliability.grading_failure)}
        ${metric('Timeouts', reliability.grading_timeout)}
        ${metric('Typical grading time', reliability.p50_latency_ms, null, (v) => v == null ? 'Not available' : `${number(v)} ms`)}
        ${metric('Grading time for the slowest 5%', reliability.p95_latency_ms, null, (v) => v == null ? 'Not available' : `${number(v)} ms`)}
      </div>
      ${table(
        ['Grading system', 'Successful grades', 'Failures', 'Slowest 5% grading time'],
        (report.models || []).map((row) => [
          row.model, number(row.successful_grades), number(row.failures),
          row.p95_latency_ms == null ? 'Not available' : `${number(row.p95_latency_ms)} ms`,
        ]),
      )}
      <div class="notice">AI grading cost is not yet connected, so no estimate is shown.</div>
      <p class="panel-note">Last successful grade: ${escapeHtml(dateTime(reliability.last_successful_grade))}</p>`;
  }

  async function renderSubscriptions(report) {
    const directory = await loadUserDirectory(
      false,
      state.subscriptionSearch,
      state.subscriptionOffset,
    );
    const betaAllAccess = report.betaAllAccess || {};
    const globalBetaKnown = typeof betaAllAccess.enabled === 'boolean';
    const globalBetaEnabled = betaAllAccess.enabled === true;
    const subscriptionCounts = report.engagement?.subscriptionCounts
      || report.engagementOverview?.subscriptionCounts
      || {};
    state.subscriptionRows.clear();
    const accounts = directory.items || [];
    state.subscriptionExportRows = accounts;
    const rows = accounts.map((account) => {
      const actionRow = Object.freeze({
        user_id: account.id,
        display_name: account.display_name,
        subscription_id: account.subscription_id || null,
        plan_code: account.subscription_plan || null,
        subscription_status: account.subscription_status || null,
        subscription_source: account.subscription_source || null,
        starts_at: account.subscription_starts_at || null,
        expires_at: account.subscription_expires_at || null,
        trial_expires_at: account.trial_expires_at || null,
        free_beta_enabled: Boolean(account.free_beta_enabled),
        free_beta_expires_at: account.free_beta_expires_at || null,
      });
      state.subscriptionRows.set(account.id, actionRow);
      return [
        account.display_name || 'Not provided',
        account.email || 'Not available',
        account.subscription_category || 'Regular',
        account.subscription_plan ? humanizeAuditValue(account.subscription_plan) : 'None',
        account.subscription_status ? humanizeAuditValue(account.subscription_status) : 'None',
        globalBetaEnabled ? 'Beta All Access' : account.effective_access || 'No active subscription',
        dateTime(account.last_sign_in_at),
        number(account.answered_question_count),
        globalBetaEnabled ? 'No automatic expiry' : dateTime(account.subscription_expires_at),
        {
          html: true,
          value: `<div class="row-actions" data-subscription-actions-for="${escapeHtml(account.id)}" aria-label="Subscription actions for ${escapeHtml(account.display_name || account.email || account.id)}"></div>`,
        },
      ];
    });
    const pageStart = Number(directory.offset ?? state.subscriptionOffset) + (rows.length ? 1 : 0);
    const pageEnd = Number(directory.offset ?? state.subscriptionOffset) + rows.length;
    const canGoBack = state.subscriptionOffset > 0;
    const canGoForward = pageEnd < Number(directory.total || 0);
    return `
      ${heading('Subscriptions', 'See every account’s access and plan in plain language. Subscription changes require a reason and are recorded.')}
      <div class="notice ${globalBetaKnown && !globalBetaEnabled ? 'danger' : ''}"><strong>Beta All Access is ${!globalBetaKnown ? 'not confirmed' : globalBetaEnabled ? 'enabled' : 'disabled'}.</strong> ${!globalBetaKnown
        ? 'Refresh before making any access decision.'
        : globalBetaEnabled
        ? 'Every current and future signed-in user can use all beta features with no automatic per-user expiry while this setting remains on.'
        : 'Per-user subscription and fallback access records currently determine access.'}</div>
      <div class="metric-strip">
        ${summaryMetric('Admin & Staff', number(subscriptionCounts['Admin & Staff'] || 0))}
        ${summaryMetric('Beta Tester', number(subscriptionCounts['Beta Tester'] || 0))}
        ${summaryMetric('Regular', number(subscriptionCounts.Regular || 0))}
        ${summaryMetric('Premium', number(subscriptionCounts.Premium || 0))}
      </div>
      <div class="table-tools">
        <input id="subscription-search" type="search" value="${escapeHtml(state.subscriptionSearch)}" placeholder="Search name, school, or email" aria-label="Search subscriptions">
        <button class="secondary-button" id="subscription-search-button" type="button">Search</button>
        <button class="secondary-button" id="download-subscriptions" type="button">Download subscriptions</button>
      </div>
      ${table(['Name', 'Email', 'Category', 'Plan', 'Status', 'Current access', 'Last sign-in', 'Questions answered', 'Expires', 'Actions'], rows)}
      <div class="pagination-bar">
        <p class="panel-note">Showing ${number(pageStart)}–${number(pageEnd)} of ${number(directory.total)} matching account(s).</p>
        <div class="row-actions">
          <button class="secondary-button" id="subscriptions-previous" type="button"${canGoBack ? '' : ' disabled'}>Previous</button>
          <button class="secondary-button" id="subscriptions-next" type="button"${canGoForward ? '' : ' disabled'}>Next</button>
        </div>
      </div>
      <details class="panel record-detail">
        <summary>Show older access records</summary>
        <p class="panel-note">These older trial and per-user beta records are kept so access can be restored safely if Beta All Access is turned off.</p>
        ${table(
          ['Name', 'Older trial end date', 'Per-user beta', 'Source', 'Older subscription status'],
          accounts.map((account) => [
            account.display_name || 'Not provided',
            dateTime(account.trial_expires_at),
            account.free_beta_enabled ? `Enabled${account.free_beta_expires_at ? ` until ${dateTime(account.free_beta_expires_at)}` : ''}` : 'Disabled',
            account.subscription_source || 'Not available',
            account.subscription_status ? humanizeAuditValue(account.subscription_status) : 'None',
          ]),
        )}
      </details>
      <section class="panel">
        <h3>Available plans</h3>
        ${table(['Plan', 'Planning price', 'Status'], config.plans.items.map((plan) => [
          plan.name, `₱${number(plan.pricePhp, 2)}`,
          plan.previewStatus === 'disabled' ? 'Unavailable' : 'Active · manual verification',
        ]))}
      </section>
      <section class="panel"><h3>Refund policy</h3><p class="panel-note">Five-calendar-day cancellations suggest an 80% refund. Later requests use unused time and documented consumption. A verified 20-day continuous outage supports a prorated refund or equivalent extension. Founder documentation is required.</p></section>`;
  }

  async function renderPayments() {
    const data = await loadPhase4Operational('payments');
    return `
      ${heading('Payments', 'Review GCash and MariBank requests. Private proofs open for five minutes, and every view is recorded in the activity log.')}
      <div class="notice danger"><strong>Money and access warning.</strong> Approval activates the exact selected plan. Premium requires an explicit expiration. Confirm channel, amount, reference, date, proof, and access end date before proceeding.</div>
      ${table(
        ['Student', 'Plan', 'Amount', 'Channel', 'Date', 'Reference', 'Status', 'Submitted', 'Actions'],
        (data.items || []).map((row) => [
          row.display_name || 'Not provided', humanizeAuditValue(row.plan_code),
          `₱${number(row.trusted_amount_php,2)}`, row.payment_method,
          row.payment_date, row.transaction_reference,
          { html: true, value: `<span class="status ${row.status === 'approved' ? 'ok' : row.status === 'rejected' ? 'danger' : 'warn'}">${escapeHtml(humanizeAuditValue(row.status))}</span>` },
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
      ${heading('Refunds', 'Apply the published Philippine-peso policy and record payment, usage, and outage details before deciding.')}
      ${table(
        ['Student', 'Paid', 'Suggested', 'Approved', 'Status', 'Calculation', 'Submitted', 'Action'],
        (data.items || []).map((row) => [
          row.display_name || row.user_id, `₱${number(row.paid_amount_php,2)}`,
          `₱${number(row.suggested_refund_php,2)}`,
          row.approved_refund_php == null ? 'Pending decision' : `₱${number(row.approved_refund_php,2)}`,
          humanizeAuditValue(row.status), row.calculation_note, dateTime(row.submitted_at),
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
      humanizeAuditValue(row.category), row.message, humanizeAuditValue(row.priority),
      { html: true, value: `<span class="status ${row.overdue_24h ? 'danger' : 'warn'}">${escapeHtml(humanizeAuditValue(row.status))}</span>` },
      dateTime(row.created_at), row.overdue_24h ? 'Overdue' : 'Within target',
      actionButton('Update', 'support_update', row.id, { status: row.status, priority: row.priority }),
    ]);
    return `
      ${heading('Support', 'Resolve only what is necessary. Support messages may contain personal information and are limited to approved administrators.')}
      <div class="notice"><strong>Public recovery copy:</strong> Contact Support. We respond within 24 hours.</div>
      ${table(['Category', 'Message', 'Priority', 'Status', 'Created', '24-hour target', 'Action'], supportRows)}
      <section class="panel">
        <h3>Account help cases</h3>
        <div class="notice danger">Final account transfer is disabled because the current Google sign-in handoff has not been proven safe.</div>
        ${table(
          ['Case', 'Account ID', 'Status', 'Updated', 'Transfer'],
          (recovery.items || []).map((row) => [
            row.id, row.user_id, humanizeAuditValue(row.status), dateTime(row.updated_at), 'Disabled',
          ]),
        )}
        <p class="panel-note">A Support request alone never authorizes an account transfer. The original user account is preserved, and no final transfer action is available.</p>
      </section>`;
  }

  async function renderCorrections() {
    const data = await loadOperational('corrections');
    const rows = (data.items || []).map((row) => [
      row.question_bank_id, row.subject, humanizeAuditValue(row.correction_type),
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
      humanizeAuditValue(row.status),
      actionButton('Review', 'correction_review', row.id, { status: row.status }),
    ]);
    return `
      ${heading('Answer Corrections', 'Accept or reject is an editorial decision only. It never modifies live questions or suggested answers automatically.')}
      ${table(['Question', 'Subject', 'Type', 'Proposed correction', 'Explanation', 'Sources', 'Status', 'Action'], rows)}`;
  }

  async function renderPartnerships() {
    const data = await loadPhase4Operational('partnerships');
    return `
      ${heading('Partnerships', 'Review institutional, academic, content, technology, and media inquiries. Contact details are private, and access is recorded in the activity log.')}
      ${table(
        ['Type','Contact','Email','Organization','Message','Verified','Status','Assignee','Created','Action'],
        (data.items || []).map((row) => [
          humanizeAuditValue(row.inquiry_type), row.contact_name, row.contact_email,
          row.organization || 'Not provided', row.message,
          row.contact_verified ? 'Yes' : 'No', humanizeAuditValue(row.status),
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
      ${heading('Website Settings', 'Only the settings shown below can be changed here. Code, passwords, grading instructions, security settings, and free-use limits cannot be edited here.')}
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
      <details class="panel record-detail"><summary>Future Admin tools</summary><p class="panel-note">Prepared, but not active: automated payments, renewals, coaching schedules, organizations, institution dashboards, notifications, content publishing, experiments, daily summaries, and return-visit reporting.</p></details>`;
  }

  async function renderSecurity() {
    const data = await loadOperational('security');
    return `
      ${heading('Security & Activity Log', 'Only the Super Admin may choose who can use each Admin area. Admins cannot give themselves more access or create another Super Admin.')}
      <div class="notice">Wally remains the sole Super Admin. Founder Admin access is assigned to verified accounts; an email address written into website code does not grant founder access.</div>
      ${table(
        ['Time', 'Action', 'Actor', 'Record type', 'Record', 'Reason'],
        (data.items || []).map((row) => [
          dateTime(row.occurred_at), humanizeAuditValue(row.action_type),
          row.actor_user_id ? maskOperationalIdentifier(row.actor_user_id, 'Administrator') : 'System',
          humanizeAuditValue(row.target_resource_type), auditTargetLabel(row),
          row.reason || 'Not provided',
        ]),
      )}
      <section class="panel"><h3>Admin permissions</h3><p class="panel-note">Founder and Super Admins receive full access to this dashboard. Other Admin accounts receive only the specific permissions assigned to them, and those permissions can be removed.</p></section>`;
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
      ${heading('Quorum', 'Founder and Super Admin review only. Reports never reveal the reporting member, and post management never changes subscriptions or examination records.')}
      <div class="notice"><strong>Quorum safeguards:</strong> Plain-text publishing, source-link checks, rate limits, duplicate controls, private reporting, posting restrictions, and recorded moderation are active.</div>
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

  function quorumPostActions(row) {
    if (row.content_status === 'deleted_by_author') {
      return { html: true, value: '<span class="status">Deleted by author</span>' };
    }
    const actions = [];
    const add = (label, action, payload = {}) => {
      actions.push(actionButton(label, action, row.entry_id, payload).value);
    };
    if (row.content_status === 'visible') add('Hide', 'quorum_hide_entry');
    if (['hidden', 'removed'].includes(row.content_status)) add('Restore', 'quorum_restore_entry');
    if (row.content_status !== 'removed') add('Remove', 'quorum_remove_entry');
    if (!['removed'].includes(row.content_status)) {
      add(row.comments_locked ? 'Unlock comments' : 'Lock comments',
        row.comments_locked ? 'quorum_unlock_comments' : 'quorum_lock_comments');
    }
    return { html: true, value: `<div class="row-actions">${actions.join('')}</div>` };
  }

  async function renderQuorumModeration() {
    const [data, posts] = await Promise.all([
      loadForumModeration(),
      loadQuorumPosts(),
    ]);
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
    const postRows = (posts.items || []).map((row) => [
      dateTime(row.created_at),
      row.author_name || 'Not provided',
      row.author_email || 'Not available',
      row.entry_type || 'Post',
      row.subject || row.category || 'General',
      detailCell(row.body, 'View post'),
      row.content_status || 'Not available',
      number(row.comment_count),
      number(row.report_count),
      quorumPostActions(row),
    ]);
    const postStart = Number(posts.offset || 0) + (postRows.length ? 1 : 0);
    const postEnd = Number(posts.offset || 0) + postRows.length;
    return `
      ${heading('Quorum', 'Review every post, see the author’s exact email, and remove content when necessary. A member can still delete their own post.')}
      <section class="panel">
        <div class="panel-title-row"><div><h3>All Quorum posts</h3><p class="panel-note">Showing ${number(postStart)}–${number(postEnd)} of ${number(posts.total)} post(s). Admin actions are recorded.</p></div><button class="secondary-button" id="download-quorum-posts" type="button">Download all matching posts</button></div>
        <div class="table-tools">
          <input id="quorum-post-search" type="search" value="${escapeHtml(state.quorumPostSearch)}" placeholder="Search post, name, or email" aria-label="Search Quorum posts">
          <select id="quorum-post-status" aria-label="Filter Quorum posts">
            ${['all', 'visible', 'hidden', 'removed', 'deleted_by_author'].map((status) => `<option value="${status}"${state.quorumPostStatus === status ? ' selected' : ''}>${status === 'all' ? 'All posts' : humanizeAuditValue(status)}</option>`).join('')}
          </select>
          <button class="secondary-button" id="quorum-post-filter" type="button">Apply filter</button>
        </div>
        ${table(['Posted', 'Name', 'Email', 'Type', 'Topic', 'Post', 'Status', 'Comments', 'Reports', 'Actions'], postRows)}
        <div class="pagination-bar"><span></span><div class="row-actions">
          <button class="secondary-button" id="quorum-post-previous" type="button"${state.quorumPostOffset > 0 ? '' : ' disabled'}>Previous</button>
          <button class="secondary-button" id="quorum-post-next" type="button"${posts.hasMore ? '' : ' disabled'}>Next</button>
        </div></div>
      </section>
      <div class="notice"><strong>Reporting period:</strong> ${escapeHtml(dateTime(analytics.from))} to ${escapeHtml(dateTime(analytics.to))}. Updated ${escapeHtml(dateTime(analytics.lastUpdatedAt))}.</div>
      <div class="metric-strip">
        ${metric('Active Quorum users', values.activeUsers, null, number, { copy: definitions.activeUsers, source: metricSource })}
        ${metric('Posts created', values.entries, null, number, { copy: definitions.entries, source: metricSource })}
        ${metric('Comments & replies', values.commentsReplies, null, number, { copy: definitions.commentsReplies, source: metricSource })}
        ${metric('Affirm reactions', values.helpful, null, number, { copy: definitions.helpful, source: metricSource })}
        ${metric('Disseminations', values.citations, null, number, { copy: definitions.citations, source: metricSource })}
        ${metric('Saved authorities', values.saves, null, number, { copy: definitions.saves, source: metricSource })}
        ${metric('Study Circles', values.circles, null, number, { copy: definitions.circles, source: metricSource })}
        ${metric('Reports', values.reports, null, number, { copy: definitions.reports, source: metricSource })}
        ${metric('Moderation actions', values.moderationActions, null, number, { copy: definitions.moderationActions, source: metricSource })}
        ${metric('Unanswered questions', values.unansweredQuestions, null, number, { copy: definitions.unansweredQuestions, source: metricSource })}
        ${metric('Practice conversions', values.practiceConversions, null, number, { copy: definitions.practiceConversions, source: metricSource })}
        ${metric('Quorum loading or posting errors', values.failedRequests, null, number, { copy: definitions.failedRequests, source: metricSource })}
      </div>
      <div class="work-grid">
        <section class="panel"><h3>Activity by subject</h3>
          ${(analytics.bySubject || []).length
            ? barList(analytics.bySubject.map((row) => [row.label, row.count]))
            : empty('No data yet for this reporting window.')}
        </section>
        <section class="panel"><h3>Posts by type</h3>
          ${(analytics.byEntryType || []).length
            ? barList(analytics.byEntryType.map((row) => [humanizeAuditValue(row.label), row.count]))
            : empty('No data yet for this reporting window.')}
        </section>
      </div>
      <section class="panel">
        <h3>Reported posts and comments</h3>
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
    if (reason.length < 5) throw new Error('Provide a reason of at least five characters.');
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
      'Exams',
      'Create locked exam versions, publish approved questions, control access, and monitor real attempts.',
      '<button class="secondary-button" type="button" data-exam-admin-refresh>Refresh exam data</button>',
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
          <h3>Create exam</h3>
          <form class="exam-admin-form" data-exam-admin-form="create_exam">
            <label>Title<input name="title" minlength="3" maxlength="180" required></label>
            <label>Area<select name="track"><option value="per_subject">Subject Matter</option><option value="bar_feels">Bar Feels</option></select></label>
            <label>Exam type<select name="assessmentKind"><option value="midterm">Midterm</option><option value="final">Final</option><option value="curated">Curated</option><option value="system_test">System test</option></select></label>
            <label>Subject<input name="subject" maxlength="120"></label>
            <label>Year level<input name="yearLevel" type="number" min="1" max="4"></label>
            <label class="check-row"><input name="testOnly" type="checkbox" checked> Controlled system test</label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit">Create draft exam</button>
          </form>
        </section>

        <section class="panel">
          <h3>Create locked exam version</h3>
          <form class="exam-admin-form" data-exam-admin-form="create_version">
            <label>Examination<select name="examId" required><option value="">Select…</option>${definitionOptions}</select></label>
            <label>Version label<input name="label" value="Controlled beta v1" required></label>
            <label>Duration in minutes<input name="durationMinutes" type="number" min="1" max="240" value="60" required></label>
            <label>Timer mode<select name="timerMode"><option value="strict">Strict Scrutiny</option><option value="selfPaced">Quantum Meruit</option><option value="none">Summary Judgment</option></select></label>
            <label>Grading route<select name="gradingRoute"><option value="either">AI or Human</option><option value="ai">AI Assessment</option><option value="human">Human Examiner</option><option value="provisional">Provisional only</option></select></label>
            <label>Answer release<select name="answerReleaseRule"><option value="after_ai">After AI finalization</option><option value="after_human">After human finalization</option><option value="manual">Manual</option></select></label>
            <label>Instructions<textarea name="instructions" maxlength="8000">Answer every item using ALAC. Review all answers before final submission.</textarea></label>
            <label>Syllabus topics, one per line<textarea name="syllabus" maxlength="4000"></textarea></label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit" ${definitionOptions ? '' : 'disabled'}>Create version</button>
          </form>
        </section>
      </div>

      <section class="panel">
        <h3>Attach approved questions and publish</h3>
        <form class="exam-admin-form exam-admin-question-form" data-exam-admin-form="set_questions">
          <label>Draft version<select name="versionId" required><option value="">Select…</option>${draftOptions}</select></label>
          <fieldset class="question-picker">
            <legend>Approved questions</legend>
            <div class="question-picker-list">
              ${questions.map((question) => `<label class="check-row"><input type="checkbox" name="questionIds" value="${escapeHtml(question.questionId)}">
                <span>${escapeHtml(`${question.sourceQuestionId} · ${question.subject} · ${question.topic || 'Topic not specified'}`)}</span></label>`).join('')}
            </div>
          </fieldset>
          <p class="panel-note">Tap or click each question to include it. The saved order follows the list shown above.</p>
          <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
          <div class="dialog-actions">
            <button class="secondary-button" type="submit" ${draftOptions ? '' : 'disabled'}>Save question order</button>
            <button class="primary-button" type="button" data-exam-admin-publish ${draftOptions ? '' : 'disabled'}>Publish selected draft</button>
          </div>
        </form>
      </section>

      <div class="panel-grid">
        <section class="panel">
          <h3>Availability and status</h3>
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
          <h3>Exam access by user</h3>
          <form class="exam-admin-form" data-exam-admin-form="set_beta_access">
            <label>Account ID<input name="userId" pattern="[0-9a-fA-F-]{36}" required></label>
            <label class="check-row"><input name="enabled" type="checkbox" checked> Enable examination beta</label>
            <label>Expires at (optional)<input name="expiresAt" type="datetime-local"></label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="primary-button" type="submit">Update beta access</button>
          </form>
          <hr>
          <form class="exam-admin-form" data-exam-admin-form="set_participant">
            <label>Published version<select name="versionId" required><option value="">Select…</option>${examinationOptions(versions.filter((version) => version.status === 'published'), 'versionId', (version) => version.label)}</select></label>
            <label>Account ID<input name="userId" pattern="[0-9a-fA-F-]{36}" required></label>
            <label class="check-row"><input name="enabled" type="checkbox" checked> Permit this participant</label>
            <label>Reason for this change<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label>
            <button class="secondary-button" type="submit">Update participant</button>
          </form>
        </section>
      </div>

      <section class="panel">
        <h3>Recent exam attempts and grading status</h3>
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
        <h3>Exam activity history</h3>
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
      const questionIds = new FormData(form).getAll('questionIds').map(String);
      if (!questionIds.length) throw new Error('Choose at least one approved question.');
      Object.assign(payload, {
        versionId: values.versionId,
        questionIds,
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
    toast('Exam change completed and recorded.');
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
        toast('Select a draft and provide a reason before publishing.');
        return;
      }
      if (!global.confirm('Publish this locked exam version? Active attempts will use this exact saved version.')) return;
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
      if (!reason || reason.trim().length < 5) return toast('A reason of at least five characters is required.');
      const payload = {
        operation,
        examId: button.dataset.examId,
        reason: reason.trim(),
        requestKey: uuidKey(),
      };
      if (operation === 'set_availability') {
        const availableFrom = global.prompt('Start date and time (for example, 2026-08-15 09:00; leave blank to start now):', '') || '';
        const availableUntil = global.prompt('End date and time (for example, 2026-08-15 12:00; leave blank for no end):', '') || '';
        payload.availableFrom = availableFrom ? new Date(availableFrom).toISOString() : null;
        payload.availableUntil = availableUntil ? new Date(availableUntil).toISOString() : null;
      } else if (!global.confirm(`Confirm ${label}? This access change is recorded in the activity log.`)) return;
      try {
        await examinationAdmin(operation, payload);
        state.examinationData = null;
        toast(`Examination ${label} completed.`);
        await renderSection('examinations');
      } catch (error) { toast(error.message); }
    }));
    $$('[data-exam-release]').forEach((button) => button.addEventListener('click', async () => {
      const reason = global.prompt('Reason for releasing the stored model answers:', '');
      if (!reason || reason.trim().length < 5) return toast('A reason of at least five characters is required.');
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
    if (!sectionAllowed(section)) {
      toast('Your administrator role does not have access to that section.');
      return;
    }
    state.section = section;
    $('#section-title').textContent = titles[section];
    const rangeControl = $('#reporting-range');
    if (rangeControl) {
      rangeControl.hidden = !['executive', 'realtime', 'acquisition', 'learning', 'subjects', 'reliability', 'forum'].includes(section);
    }
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
      else if (section === 'realtime') html = await renderRealtime(report);
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
      else if (section === 'answer_exports') html = await renderAnswerExports(report);
      $('#dashboard-view').innerHTML = html;
      bindDynamic();
      if (section === 'examinations') bindExaminationAdmin();
    } catch (error) {
      $('#dashboard-view').innerHTML = heading('Admin dashboard unavailable', error.message || 'Admin data could not be loaded.')
        + empty('Nothing was changed. Refresh after the connection or account permission is restored.');
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
    if (action === 'subscription_audit_view') return 'View this student’s recorded access history';
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
    if (operation === 'pause') return 'Suspend the active Subscription';
    if (operation === 'resume') return 'Resume the suspended Subscription';
    if (operation === 'cancel') return 'Revoke the current Subscription';
    if (operation === 'expire') return 'Expire the current Subscription immediately';
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
    $('#action-current').textContent = `${planDisplayName(payload.planCode)} · ${payload.status || 'no Subscription'}`
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
        const input = appendInputField(container, 'New Subscription start date and time', 'action-starts', {
          type: 'datetime-local', value: localDateTimeValue(payload.startsAt), required: true,
        });
        input.addEventListener('input', updateActionContext);
      } else if (['set_expiration_date', 'restore'].includes(payload.operation)) {
        const input = appendInputField(container, 'New Subscription expiration date and time', 'action-expires', {
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
        title: `Subscription · ${entry.action}`,
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
    const isMobile = global.matchMedia?.('(max-width: 820px)')?.matches === true;
    const wasOpen = sidebar?.classList.contains('open') === true;
    sidebar?.classList.toggle('open', open);
    $('#menu-button')?.setAttribute('aria-expanded', String(open));
    if (sidebar) {
      sidebar.inert = isMobile && !open;
      sidebar.setAttribute('aria-hidden', String(isMobile && !open));
    }
    if (scrim) scrim.hidden = !open;
    document.body.classList.toggle('admin-nav-open', isMobile && open);
    if (isMobile && open && !wasOpen) {
      global.setTimeout(() => sidebar?.querySelector('button[aria-current="page"]:not([hidden]), button:not([hidden])')?.focus(), 0);
    } else if (isMobile && !open && wasOpen) {
      $('#menu-button')?.focus();
    }
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
    let warning = 'This change requires a reason and will be recorded in Admin activity.';
    if (action === 'support_update') {
      title = 'Update Support request';
      fields = `<label class="field">Status<select id="action-status">${['pending','in_progress','waiting_for_student','resolved','closed'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        <label class="field">Priority<select id="action-priority">${['low','normal','high','urgent'].map((value) => `<option${payload.priority === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label class="field">Internal note<textarea id="action-note" maxlength="4000"></textarea></label>`;
    } else if (action === 'correction_review') {
      title = 'Record editorial decision';
      fields = `<label class="field">Status<select id="action-status">${['pending','accepted','rejected'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        <label class="field">Reviewer note<textarea id="action-note" maxlength="4000"></textarea></label>`;
      warning = 'Accept or reject records an editorial decision only. The live question bank will not change.';
    } else if (action === 'entitlement_change') {
      title = 'Adjust manual access';
      fields = `${actionField('Plan code', 'action-plan', payload.plan_code)}
        <label class="field">Status<select id="action-status">${['active','paused','canceled','expired'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        ${actionField('End date (optional)', 'action-until', '', 'date')}`;
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
      warning = 'Opening this private proof is recorded. The secure link lasts five minutes. Do not download or share it unless necessary.';
    } else if (action === 'refund_review') {
      title = 'Review refund request';
      fields = `<label class="field">Decision<select id="action-status">
        <option value="needs_information">Needs information</option>
        <option value="approved">Approve amount</option>
        <option value="rejected">Reject</option>
        ${payload.status === 'approved' ? '<option value="paid">Mark paid</option>' : ''}
      </select></label>
      ${actionField('Approved refund in PHP', 'action-refund-amount', payload.approvedRefundPhp ?? payload.suggestedRefundPhp ?? '', 'number')}`;
      warning = 'Check the paid amount, payment date, usage, and any outage record. Mark paid only after the money was actually returned.';
    } else if (action === 'subscription_change') {
      const titlesByOperation = {
        activate: 'Activate Subscription',
        complimentary: 'Grant complimentary access',
        pause: 'Pause Subscription',
        resume: 'Resume Subscription',
        cancel: 'Revoke Subscription',
        expire: 'Expire Subscription',
        restore: 'Restore Subscription',
        extend: 'Extend Subscription',
        replace_plan: 'Change plan',
        set_start_date: 'Change Subscription start date',
        set_expiration_date: 'Change Subscription expiration date',
      };
      title = payload.controlLabel === 'Change Plan'
        ? 'Change plan'
        : titlesByOperation[payload.operation] || 'Manage Subscription';
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
      title = 'View Subscription activity history';
      warning = 'Viewing this private history requires a reason and is recorded in Admin activity.';
    } else if (action === 'partnership_update') {
      title = 'Update partnership inquiry';
      fields = `<label class="field">Status<select id="action-status">${['new','reviewing','awaiting_reply','qualified','closed'].map((value) => `<option value="${value}"${payload.status === value ? ' selected' : ''}>${humanizeAuditValue(value)}</option>`).join('')}</select></label>
        <label class="field"><span><input id="action-contact-verified" type="checkbox"${payload.contactVerified ? ' checked' : ''}> Contact ownership verified</span></label>
        ${actionField('Assignee account ID (optional)', 'action-assignee', payload.assigneeUserId || '')}`;
      warning = 'Contact verification means ownership was actually checked; do not mark it based only on valid email formatting.';
    } else if (action === 'role_change') {
      title = 'Change administrator role';
      fields = `<label class="field">Role<select id="action-role">
        ${[['student', 'User'], ['admin', 'Admin & Staff'], ['founder_admin', 'Founder Admin']].map(([value, label]) => `<option value="${value}"${payload.role === value ? ' selected' : ''}>${label}</option>`).join('')}
      </select></label>`;
      warning = 'Only the Super Admin may perform this action. Self-promotion, self-demotion, and creation of another Super Admin are prohibited.';
    } else if (action === 'website_control_update') {
      title = 'Update website setting';
      fields = `${actionField('Setting name', 'action-control', payload.control_key)}
        <label class="field">Setting value<textarea id="action-value" maxlength="8000">${escapeHtml(JSON.stringify(payload.value || {}, null, 2))}</textarea></label>
        <label class="field"><span><input id="action-published" type="checkbox"${payload.is_published ? ' checked' : ''}> Make this setting active</span></label>`;
      warning = 'Only approved website settings can be changed here. Code, passwords, grading rules, and unsafe changes are blocked.';
    } else if (action === 'reveal_email') {
      title = 'Reveal exact Docket email';
      warning = 'Exact email access is limited to approved administrators, requires a reason, and is recorded.';
    } else if (action === 'find_email') {
      title = 'Find Docket by exact email';
      fields = actionField('Exact email', 'action-email', '', 'email');
      warning = 'Exact email search is limited to approved administrators, requires a reason, and is recorded.';
    } else if (action === 'user_response_export') {
      const today = new Date();
      const from = new Date(today.getTime() - (365 * 86_400_000));
      fields = `${actionField('From date', 'action-export-from', from.toISOString().slice(0, 10), 'date')}
        ${actionField('Through date (inclusive)', 'action-export-to', today.toISOString().slice(0, 10), 'date')}`;
      title = 'Download private questions and answers';
      warning = 'This founder-only download contains private student work. Use it only for an approved purpose, store it securely, and do not redistribute it. The reason and file scope are recorded.';
    } else if (action === 'global_beta_change') {
      title = payload.enabled ? 'Enable Beta All Access' : 'Disable Beta All Access';
      warning = payload.enabled
        ? 'This immediately gives all current and future signed-in users access to every current beta feature, subject to current legal acceptance and security restrictions.'
        : 'This immediately removes Beta All Access from every user and restores the older per-user access rules. Confirm the effect before continuing.';
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
        : 'This Quorum action requires a reason and is recorded in Admin activity.';
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
        : 'This changes a Quorum post’s visibility or review status and is recorded in Admin activity.';
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
      ? `I understand this will ${payload.enabled ? 'grant Beta All Access to' : 'remove Beta All Access from'} all current and future signed-in users and that the immediate change is recorded.`
      : isSensitiveExport
      ? 'I am authorized to access this student work and will handle the downloaded file securely. I understand this download is recorded.'
      : isForumAction
        ? 'I checked the report or content and the proposed moderation action. I understand this immediate action is recorded.'
        : 'I checked the user, current access, and proposed change. I understand this immediate action is recorded.';
    $('#action-confirm-risk').checked = false;
    $('#action-confirm').textContent = action === 'subscription_audit_view'
      ? 'View activity history'
      : isSensitiveExport
        ? 'Download answer records'
        : isForumAction ? 'Confirm moderation action' : 'Confirm action';
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
          toast('Select a valid Subscription start date.');
          return;
        }
      } else if (['set_expiration_date', 'restore'].includes(payload.operation)) {
        payload.expiresAt = isoFromLocalInput($('#action-expires').value);
        if (!payload.expiresAt) {
          toast('Select a valid Subscription expiration date.');
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
        toast('Private questions-and-answers file downloaded and recorded.');
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
        toast('Quorum moderation action completed and recorded.');
      } else if (action.startsWith('forum_')) {
        await api('/admin/forum/action', {
          action: action.slice('forum_'.length),
          targetId: state.action.targetId,
          reason,
          durationHours: payload.durationHours || null,
          requestId: state.action.requestKey,
        });
        toast('Community moderation action completed and recorded.');
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
          toast('Access history loaded and recorded.');
        } else {
          toast('Access change completed, recorded, and refreshed.');
        }
      }
      cancelActionDialog();
      state.operational.clear();
      if (action.startsWith('quorum_')) state.quorumPosts = null;
      if (['subscription_change', 'free_beta_change', 'global_beta_change'].includes(action)) {
        state.report = null;
      }
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
      if (sectionAllowed(section)) renderSection(section);
      else toast('Your administrator role does not have access to that section.');
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
        state.userOffset = 0;
        await loadUserDirectory(true, search);
        await renderSection('users');
      } catch (error) { toast(error.message); }
    });
    $('#users-previous')?.addEventListener('click', async () => {
      state.userOffset = Math.max(0, state.userOffset - 100);
      await renderSection('users');
    });
    $('#users-next')?.addEventListener('click', async () => {
      state.userOffset += 100;
      await renderSection('users');
    });
    $$('[data-view-user-answers]').forEach((button) => button.addEventListener('click', async () => {
      state.answerSearch = button.dataset.userEmail || '';
      state.answerType = 'all';
      state.answerOffset = 0;
      state.answerHistory = null;
      await renderSection('answer_exports');
    }));
    $('#download-live-activity')?.addEventListener('click', () => {
      downloadCsv('due-diligence-activity-summary.csv', [
        'Measure', 'Value', 'Meaning', 'Generated at',
      ], [
        ['Activity in the last 5 minutes', state.liveActivity?.activeSignedInLast5Minutes, 'Approximate signed-in-session records; not exact people online', state.liveActivity?.generatedAt],
        ['Activity in the last 30 minutes', state.liveActivity?.activeSignedInLast30Minutes, 'Approximate signed-in-session records; may include stale sessions', state.liveActivity?.generatedAt],
      ]);
      toast('Activity summary downloaded for Google Sheets.');
    });
    $('#answer-filter-button')?.addEventListener('click', async () => {
      state.answerSearch = $('#answer-search')?.value?.trim() || '';
      state.answerType = $('#answer-type')?.value || 'all';
      state.answerOffset = 0;
      state.answerHistory = null;
      await renderSection('answer_exports');
    });
    $('#answers-previous')?.addEventListener('click', async () => {
      state.answerOffset = Math.max(0, state.answerOffset - 100);
      state.answerHistory = null;
      await renderSection('answer_exports');
    });
    $('#answers-next')?.addEventListener('click', async () => {
      state.answerOffset += 100;
      state.answerHistory = null;
      await renderSection('answer_exports');
    });
    $('#download-answer-view')?.addEventListener('click', () => {
      const rows = currentAnswerHistoryItems().map((item) => [
        item.userDisplayName,
        item.userEmail,
        item.subscriptionCategory,
        item.recordSource,
        item.subject,
        item.examTitle,
        item.questionText,
        item.questionTextSource,
        item.questionTextStatus,
        item.submittedAnswer,
        item.score,
        item.feedbackText,
        item.suggestedAnswer,
        item.suggestedAnswerSource,
        item.suggestedAnswerStatus,
        item.modelAnswer,
        item.modelAnswerSource,
        item.modelAnswerStatus,
        item.submittedAt || item.answerSavedAt || item.completedAt,
      ]);
      downloadCsv('due-diligence-answer-records-current-view.csv', [
        'Name', 'Email', 'Subscription', 'Answer type', 'Subject', 'Exam', 'Question',
        'Question source', 'Question availability', 'Student answer', 'Score', 'Feedback',
        'Suggested answer', 'Suggested answer source', 'Suggested answer availability',
        'Model answer', 'Model answer source', 'Model answer availability', 'Submitted',
      ], rows);
      toast('Current answer view downloaded for Google Sheets.');
    });
    $('#subscription-search-button')?.addEventListener('click', async () => {
      state.subscriptionSearch = $('#subscription-search')?.value?.trim() || '';
      state.subscriptionOffset = 0;
      await renderSection('subscriptions');
    });
    $('#subscriptions-previous')?.addEventListener('click', async () => {
      state.subscriptionOffset = Math.max(0, state.subscriptionOffset - 100);
      await renderSection('subscriptions');
    });
    $('#subscriptions-next')?.addEventListener('click', async () => {
      state.subscriptionOffset += 100;
      await renderSection('subscriptions');
    });
    $('#download-subscriptions')?.addEventListener('click', async () => {
      try {
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/subscriptions/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({ search: state.subscriptionSearch, requestKey: uuidKey() }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The subscription list could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-subscriptions.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
        toast('Subscriptions downloaded for Google Sheets.');
      } catch (error) { toast(error.message); }
    });
    $('#quorum-post-filter')?.addEventListener('click', async () => {
      state.quorumPostSearch = $('#quorum-post-search')?.value?.trim() || '';
      state.quorumPostStatus = $('#quorum-post-status')?.value || 'all';
      state.quorumPostOffset = 0;
      state.quorumPosts = null;
      await renderSection('forum');
    });
    $('#quorum-post-previous')?.addEventListener('click', async () => {
      state.quorumPostOffset = Math.max(0, state.quorumPostOffset - 100);
      state.quorumPosts = null;
      await renderSection('forum');
    });
    $('#quorum-post-next')?.addEventListener('click', async () => {
      state.quorumPostOffset += 100;
      state.quorumPosts = null;
      await renderSection('forum');
    });
    $('#download-quorum-posts')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const items = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const payload = await api('/admin/quorum/posts', {
            search: state.quorumPostSearch,
            status: state.quorumPostStatus,
            limit: 100,
            offset,
            requestKey: uuidKey(),
          });
          const page = Array.isArray(payload.data?.items) ? payload.data.items : [];
          items.push(...page);
          hasMore = payload.data?.hasMore === true;
          offset += page.length;
          if (hasMore && (items.length >= 5000 || page.length === 0)) {
            throw new Error('More than 5,000 Quorum posts match. Narrow the search or status before downloading.');
          }
        }
        const rows = items.map((row) => [
          row.created_at,
          row.author_name,
          row.author_email,
          row.entry_type,
          row.subject || row.category,
          row.body,
          row.content_status,
          row.comment_count,
          row.report_count,
        ]);
        downloadCsv('due-diligence-quorum-posts.csv', [
          'Posted', 'Name', 'Email', 'Type', 'Topic', 'Post', 'Status', 'Comments', 'Reports',
        ], rows);
        toast('All matching Quorum posts downloaded for Google Sheets.');
      } catch (error) {
        toast(error.message || 'The Quorum post file could not be created.');
      } finally {
        button.disabled = false;
      }
    });
    $('#user-directory-export')?.addEventListener('click', async () => {
      try {
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/user-directory/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify({ search: state.userSearch, requestKey: uuidKey() }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          throw new Error(problem?.error?.message || 'The user list could not be created.');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'due-diligence-users.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('User list downloaded for Google Sheets.');
      } catch (error) { toast(error.message); }
    });
    $('#user-directory-email-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const recipientKey = $('#user-directory-email-recipient')?.value || '';
      const reason = $('#user-directory-email-reason')?.value?.trim() || '';
      const confirmed = $('#user-directory-email-confirm')?.checked === true;
      if (!recipientKey || reason.length < 5 || !confirmed) {
        toast('Select a founder, provide a reason, and confirm that you are allowed to send the list.');
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
          ? 'User list sent to the selected founder.'
          : `Email delivery status: ${result.delivery?.status || 'not confirmed'}.`);
        form.reset();
      } catch (error) {
        toast(error.message || 'The user list could not be sent.');
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
        toast('Provide a reason and confirm that you are allowed to download private student work.');
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
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/answer-history/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
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
        toast('Answer-history file downloaded for Google Sheets and recorded.');
      } catch (error) {
        toast(error.message || 'The complete answer-history export could not be created.');
      } finally {
        button.disabled = false;
      }
    });
    $('#print-report')?.addEventListener('click', () => global.print());
    $('#export-report')?.addEventListener('click', async () => {
      try {
        const token = state.session?.access_token;
        if (!token) throw new Error('Administrator sign-in is required.');
        const response = await fetch(`${config.workerUrl}/admin/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: JSON.stringify(reportingWindow()),
        });
        if (!response.ok) throw new Error('Dashboard summary could not be created.');
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
      button.hidden = !sectionAllowed(button.dataset.section);
    });
  }

  function deny(message) {
    $('#admin-gate').hidden = false;
    $('#admin-shell').hidden = true;
    $('#gate-title').textContent = 'Administrator access unavailable';
    $('#gate-copy').textContent = message;
    $('#gate-spinner').hidden = true;
    $('#gate-action').hidden = false;
  }

  async function initialize() {
    if (!config?.features?.adminDashboard
        || !global.supabase?.createClient
        || !subscriptionActions?.actionsForSubscription) {
      deny('The Admin dashboard is not configured.');
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
    state.client.auth.onAuthStateChange((event, session) => {
      state.session = session || null;
      if (event === 'SIGNED_OUT' && !$('#admin-shell').hidden) {
        deny('Your administrator session ended. Sign in again through Due Diligence, then return here.');
      }
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
    if (button && !button.hidden && sectionAllowed(button.dataset.section)) {
      renderSection(button.dataset.section);
    }
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
    state.liveActivity = null;
    state.answerHistory = null;
    state.quorumPosts = null;
    try {
      await renderSection(state.section);
    } finally {
      button.disabled = false;
      button.textContent = 'Refresh';
    }
  });
  $('#download-current-section')?.addEventListener('click', downloadCurrentSection);
  $('#menu-button')?.addEventListener('click', () => {
    setSidebarOpen(!$('#sidebar').classList.contains('open'));
  });
  $('#sidebar-scrim')?.addEventListener('click', () => setSidebarOpen(false));
  global.matchMedia?.('(max-width: 820px)')?.addEventListener?.('change', () => setSidebarOpen(false));
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

  initialize().catch(() => deny('The Admin dashboard could not open. Nothing was changed.'));
})(window);
