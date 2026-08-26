(function auxiliaryWritingDiagnostics(global) {
  'use strict';

  const SOURCE_TYPES = new Set([
    'phase4_exam_attempt',
    'examination_attempt',
    'legacy_grading_result',
  ]);
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const diagnosticsBySource = new Map();
  const loadStateBySource = new Map();
  const expectedBySource = new Map();
  const ensureRequests = new Map();
  const pendingRecordLoads = new Map();
  const backgroundEnsureQueue = [];
  const queuedEnsureSources = new Set();
  const settledEnsureSources = new Set();
  const attemptedEnsureSources = new Map();
  let backgroundEnsureRunning = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sourceKey(sourceType, sourceId) {
    return `${String(sourceType || '').trim()}:${String(sourceId || '').trim()}`;
  }

  function reference(value) {
    const sourceType = String(value?.sourceType || '').trim();
    const sourceId = String(value?.sourceId || value?.id || '').trim();
    if (!SOURCE_TYPES.has(sourceType) || !UUID_PATTERN.test(sourceId) || value?.localOnly) return null;
    return { sourceType, sourceId };
  }

  function sessionRequest(path, payload) {
    const session = global.DueDiligencePhase2?.getSession?.();
    const workerUrl = global.DueDiligencePhase2Config?.workerUrl;
    if (!session?.access_token || !workerUrl) {
      return Promise.reject(new Error('Sign in to view auxiliary diagnostics.'));
    }
    return fetch(`${workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: JSON.stringify(payload),
    }).then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Auxiliary diagnostics are temporarily unavailable.');
      }
      return data?.result || data?.data || data;
    });
  }

  function dispatchUpdate() {
    global.dispatchEvent(new CustomEvent('duediligence:auxiliary-diagnostics-updated'));
  }

  function storeItems(items) {
    if (!Array.isArray(items)) return;
    const affected = new Set();
    items.forEach((item) => {
      const ref = reference(item);
      if (!ref) return;
      const key = sourceKey(ref.sourceType, ref.sourceId);
      const questions = diagnosticsBySource.get(key) || new Map();
      questions.set(String(item.questionId || ''), Object.freeze({ ...item }));
      diagnosticsBySource.set(key, questions);
      const expected = Number(item.expectedQuestions);
      if (Number.isInteger(expected) && expected > 0 && expected <= 100) {
        expectedBySource.set(key, expected);
      }
      affected.add(key);
    });
    if (affected.size) dispatchUpdate();
  }

  function uniqueReferences(records) {
    const result = [];
    const seen = new Set();
    (Array.isArray(records) ? records : []).forEach((record) => {
      const ref = reference(record);
      if (!ref) return;
      const key = sourceKey(ref.sourceType, ref.sourceId);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(ref);
    });
    return result;
  }

  async function loadForRecords(records) {
    const refs = uniqueReferences(records);
    if (!refs.length) return [];
    refs.forEach((ref) => {
      const key = sourceKey(ref.sourceType, ref.sourceId);
      if (!diagnosticsBySource.has(key)) loadStateBySource.set(key, 'loading');
    });
    dispatchUpdate();
    const loadKey = refs.map((ref) => sourceKey(ref.sourceType, ref.sourceId)).sort().join('|');
    if (pendingRecordLoads.has(loadKey)) return pendingRecordLoads.get(loadKey);
    const request = sessionRequest('/dd2026/auxiliary-diagnostics/records', { records: refs })
      .then((result) => {
        const items = Array.isArray(result?.items) ? result.items : [];
        storeItems(items);
        refs.forEach((ref) => {
          const key = sourceKey(ref.sourceType, ref.sourceId);
          const entries = entriesForReference(ref);
          loadStateBySource.set(key, entries.length ? 'ready' : 'not_assessed');
        });
        dispatchUpdate();
        return items;
      })
      .catch((error) => {
        refs.forEach((ref) => loadStateBySource.set(
          sourceKey(ref.sourceType, ref.sourceId),
          'unavailable',
        ));
        dispatchUpdate();
        throw error;
      })
      .finally(() => pendingRecordLoads.delete(loadKey));
    pendingRecordLoads.set(loadKey, request);
    return request;
  }

  function validPoints(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 5 ? number : null;
  }

  function average(values) {
    const valid = values.map(validPoints).filter((value) => value !== null);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function entriesForReference(ref) {
    const questions = diagnosticsBySource.get(sourceKey(ref.sourceType, ref.sourceId));
    return questions ? [...questions.values()] : [];
  }

  function sourceSummary(ref) {
    const allEntries = entriesForReference(ref);
    const entries = allEntries.filter((item) => item.status === 'completed');
    const expectedQuestions = expectedBySource.get(sourceKey(ref.sourceType, ref.sourceId)) || null;
    const complete = expectedQuestions === null
      ? entries.length > 0 && allEntries.every((item) => item.status === 'completed')
      : entries.length >= expectedQuestions;
    const grammarStrength = average(entries.map((item) => item.grammarStrength?.auxiliaryPoints));
    const issueSpotting = average(entries.map((item) => item.issueSpotting?.auxiliaryPoints));
    return { allEntries, entries, expectedQuestions, complete, grammarStrength, issueSpotting };
  }

  function summaryFor(records) {
    const refs = uniqueReferences(records);
    const allSources = refs.map(sourceSummary);
    const sources = allSources.filter((item) => item.complete);
    const completeEntries = sources.flatMap((item) => item.entries);
    const latestEntries = [...completeEntries].sort((left, right) => (
      new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
    ));
    return {
      grammarStrength: average(sources.map((item) => item.grammarStrength)),
      issueSpotting: average(sources.map((item) => item.issueSpotting)),
      assessedAttempts: sources.length,
      assessedAnswers: completeEntries.length,
      partialAttempts: allSources.filter((item) => item.entries.length && !item.complete).length,
      latestGrammarCoaching: latestEntries.find((item) => item.grammarStrength?.briefCoaching)
        ?.grammarStrength?.briefCoaching || '',
      latestIssueCoaching: latestEntries.find((item) => item.issueSpotting?.briefCoaching)
        ?.issueSpotting?.briefCoaching || '',
      pending: refs.some((ref) => entriesForReference(ref).some((item) => item.status === 'processing')),
      loading: refs.some((ref) => loadStateBySource.get(sourceKey(ref.sourceType, ref.sourceId)) === 'loading'),
      unavailable: refs.length > 0 && refs.every((ref) => (
        loadStateBySource.get(sourceKey(ref.sourceType, ref.sourceId)) === 'unavailable'
      )),
    };
  }

  function analyticsMetricMarkup({ label, value, coaching, slug, descriptionId, emptyLabel }) {
    if (value === null) {
      return `<div class="aux-analytics-metric" data-auxiliary-metric="${slug}">
        <div class="aux-analytics-top"><span>${label}</span><strong>${emptyLabel}</strong></div>
        <div class="aux-analytics-track" aria-hidden="true"><span class="aux-analytics-fill is-empty"></span></div>
      </div>`;
    }
    const width = Math.max(0, Math.min(100, value / 5 * 100));
    return `<div class="aux-analytics-metric" data-auxiliary-metric="${slug}">
      <div class="aux-analytics-top"><span>${label}</span><strong>${value.toFixed(1)}% / 5%</strong></div>
      <div class="aux-analytics-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${value.toFixed(1)}" aria-valuetext="${value.toFixed(1)}% out of 5%" aria-describedby="${descriptionId}">
        <span class="aux-analytics-fill${width === 0 ? ' is-empty' : ''}" style="width:${width}%"></span>
      </div>
      ${coaching ? `<p class="aux-analytics-coaching"><span>Next focus:</span> ${escapeHtml(coaching)}</p>` : ''}
    </div>`;
  }

  function analyticsMarkup(records) {
    const summary = summaryFor(records);
    const descriptionId = 'analytics-auxiliary-description';
    const emptyLabel = summary.loading || summary.pending
      ? 'Preparing…'
      : summary.unavailable
        ? 'Unavailable'
        : 'Not assessed';
    const coverage = summary.assessedAnswers
      ? `${summary.assessedAnswers} assessed answer${summary.assessedAnswers === 1 ? '' : 's'} across ${summary.assessedAttempts} complete attempt${summary.assessedAttempts === 1 ? '' : 's'}. Each complete attempt contributes equally to these averages.${summary.partialAttempts ? ` ${summary.partialAttempts} partial attempt${summary.partialAttempts === 1 ? ' is' : 's are'} excluded.` : ''}`
      : summary.pending
        ? 'Diagnostics are being prepared. Your official Analytics remain available.'
        : 'No auxiliary diagnostics are available yet. Open a graded coaching result to assess these skills.';
    return `<p class="analytics-panel-note aux-analytics-description" id="${descriptionId}">Grammar Strength and Issue Spotting are separate 0–5% auxiliary diagnostics. They do not change your answer score.</p>
      <div class="aux-analytics-grid">
        ${analyticsMetricMarkup({
          label: 'Grammar Strength',
          value: summary.grammarStrength,
          coaching: summary.latestGrammarCoaching,
          slug: 'grammar-strength',
          descriptionId,
          emptyLabel,
        })}
        ${analyticsMetricMarkup({
          label: 'Issue Spotting',
          value: summary.issueSpotting,
          coaching: summary.latestIssueCoaching,
          slug: 'issue-spotting',
          descriptionId,
          emptyLabel,
        })}
      </div>
      <p class="aux-analytics-coverage">${escapeHtml(coverage)}</p>`;
  }

  function resultMetricMarkup(label, value, coaching, slug, state) {
    const emptyLabel = state === 'loading'
      ? 'Preparing…'
      : state === 'unavailable'
        ? 'Unavailable'
        : 'Not assessed';
    return `<div class="aux-result-metric" data-auxiliary-metric="${slug}">
      <div><span>${label}</span><strong>${value === null ? emptyLabel : `${value.toFixed(1)}% / 5%`}</strong></div>
      ${coaching ? `<p>${escapeHtml(coaching)}</p>` : ''}
    </div>`;
  }

  function renderResult(container, ref, state = 'loading') {
    const summary = sourceSummary(ref);
    const hasResults = summary.entries.length > 0;
    const statusCopy = hasResults
      ? summary.complete
        ? `${summary.entries.length} answer${summary.entries.length === 1 ? '' : 's'} assessed on independent 0–5% auxiliary scales.`
        : `${summary.entries.length} of ${summary.expectedQuestions || 'the submitted'} answers assessed. This partial diagnostic does not affect your answer score.`
      : state === 'unavailable'
        ? 'Auxiliary diagnostics unavailable. Your answer score is unaffected.'
      : state === 'not_assessed'
          ? 'There was not enough submitted writing for a reliable auxiliary diagnostic.'
          : 'Preparing the two auxiliary diagnostics. These diagnostics do not affect your answer score.';
    const latest = [...summary.entries].sort((left, right) => (
      new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
    ));
    container.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    container.innerHTML = `<div class="aux-result-head">
        <div><span class="aux-result-kicker">Auxiliary · Non-scoring</span><h4>Auxiliary skill check</h4></div>
      </div>
      <p class="aux-result-disclaimer">These scores are not part of your answer score. They are provided only to help you assess grammar and issue spotting.</p>
      <div class="aux-result-grid">
        ${resultMetricMarkup(
          'Grammar Strength',
          summary.grammarStrength,
          latest.find((item) => item.grammarStrength?.briefCoaching)?.grammarStrength?.briefCoaching || '',
          'grammar-strength',
          state,
        )}
        ${resultMetricMarkup(
          'Issue Spotting',
          summary.issueSpotting,
          latest.find((item) => item.issueSpotting?.briefCoaching)?.issueSpotting?.briefCoaching || '',
          'issue-spotting',
          state,
        )}
      </div>
      <p class="aux-result-status">${escapeHtml(statusCopy)}</p>`;
  }

  async function pollReference(ref, container, remaining = 30) {
    try {
      const ensureResult = await ensure(ref);
      const expected = Number(ensureResult?.expectedQuestions);
      if (Number.isInteger(expected) && expected > 0 && expected <= 100) {
        expectedBySource.set(sourceKey(ref.sourceType, ref.sourceId), expected);
      }
      if (ensureResult?.status === 'not_assessed') {
        renderResult(container, ref, 'not_assessed');
        return;
      }
      await loadForRecords([ref]);
      const summary = sourceSummary(ref);
      if (summary.complete) {
        renderResult(container, ref, 'ready');
        return;
      }
      if (remaining <= 0) {
        renderResult(container, ref, summary.entries.length ? 'partial' : 'unavailable');
        return;
      }
    } catch {
      if (remaining <= 0) {
        renderResult(container, ref, 'unavailable');
        return;
      }
    }
    global.setTimeout(() => pollReference(ref, container, remaining - 1), 3000);
  }

  function ensure(ref) {
    const key = sourceKey(ref.sourceType, ref.sourceId);
    if (ensureRequests.has(key)) return ensureRequests.get(key);
    const request = sessionRequest('/dd2026/auxiliary-diagnostics/ensure', ref)
      .finally(() => ensureRequests.delete(key));
    ensureRequests.set(key, request);
    return request;
  }

  async function pollBackgroundReference(ref, remaining = 12) {
    const key = sourceKey(ref.sourceType, ref.sourceId);
    try {
      await loadForRecords([ref]);
      const summary = sourceSummary(ref);
      if (summary.complete) {
        settledEnsureSources.add(key);
        queuedEnsureSources.delete(key);
        return;
      }
      if (summary.allEntries.some((item) => item.status === 'failed') || remaining <= 0) {
        queuedEnsureSources.delete(key);
        return;
      }
    } catch {
      if (remaining <= 0) {
        queuedEnsureSources.delete(key);
        return;
      }
    }
    global.setTimeout(() => pollBackgroundReference(ref, remaining - 1), 5000);
  }

  async function drainBackgroundEnsureQueue() {
    if (backgroundEnsureRunning) return;
    backgroundEnsureRunning = true;
    while (backgroundEnsureQueue.length) {
      const ref = backgroundEnsureQueue.shift();
      const key = sourceKey(ref.sourceType, ref.sourceId);
      let polling = false;
      try {
        const result = await ensure(ref);
        const expected = Number(result?.expectedQuestions);
        if (Number.isInteger(expected) && expected > 0 && expected <= 100) {
          expectedBySource.set(key, expected);
        }
        if (['ready', 'not_assessed'].includes(result?.status)) {
          settledEnsureSources.add(key);
        }
        if (result?.status === 'processing') {
          polling = true;
          global.setTimeout(() => pollBackgroundReference(ref), 5000);
        } else {
          loadForRecords([ref]).catch(() => undefined);
        }
      } catch {
        loadStateBySource.set(key, 'unavailable');
      } finally {
        if (!polling) queuedEnsureSources.delete(key);
      }
      await new Promise((resolve) => global.setTimeout(resolve, 1200));
    }
    backgroundEnsureRunning = false;
  }

  function ensureForRecords(records) {
    uniqueReferences(records).filter((ref) => {
      const key = sourceKey(ref.sourceType, ref.sourceId);
      const attemptedAt = attemptedEnsureSources.get(key) || 0;
      return !queuedEnsureSources.has(key)
        && !settledEnsureSources.has(key)
        && Date.now() - attemptedAt >= 15 * 60 * 1000
        && !sourceSummary(ref).complete;
    }).slice(0, 8).forEach((ref) => {
      const key = sourceKey(ref.sourceType, ref.sourceId);
      attemptedEnsureSources.set(key, Date.now());
      queuedEnsureSources.add(key);
      backgroundEnsureQueue.push(ref);
    });
    return drainBackgroundEnsureQueue().catch(() => {
      backgroundEnsureRunning = false;
    });
  }

  function mount({ root, sourceType, sourceId }) {
    const ref = reference({ sourceType, sourceId });
    const host = typeof root === 'string' ? document.querySelector(root) : root;
    if (!ref || !host) return null;
    const selector = `[data-auxiliary-diagnostics="${ref.sourceType}:${ref.sourceId}"]`;
    let container = host.querySelector(selector);
    if (!container) {
      container = document.createElement('aside');
      container.className = 'aux-result-card';
      container.dataset.auxiliaryDiagnostics = `${ref.sourceType}:${ref.sourceId}`;
      container.setAttribute('aria-label', 'Auxiliary writing diagnostics');
      const insertionHost = host.querySelector('.dd-verdict-screen')
        || host.querySelector('.dd-subject-editorial')
        || host;
      const actions = insertionHost.querySelector('.dd-exam-actions');
      if (actions?.parentNode) actions.parentNode.insertBefore(container, actions);
      else insertionHost.appendChild(container);
    }
    renderResult(container, ref, 'loading');
    loadForRecords([ref])
      .then(() => {
        if (sourceSummary(ref).complete) {
          renderResult(container, ref, 'ready');
          return null;
        }
        return ensure(ref).then((result) => {
          const expected = Number(result?.expectedQuestions);
          if (Number.isInteger(expected) && expected > 0 && expected <= 100) {
            expectedBySource.set(sourceKey(ref.sourceType, ref.sourceId), expected);
          }
          if (result?.status === 'not_assessed') {
            renderResult(container, ref, 'not_assessed');
            return null;
          }
          return pollReference(ref, container);
        });
      })
      .catch(() => renderResult(container, ref, 'unavailable'));
    return container;
  }

  global.DueDiligenceAuxiliaryDiagnostics = Object.freeze({
    analyticsMarkup,
    ensureForRecords,
    loadForRecords,
    mount,
    summaryFor,
  });
  global.dispatchEvent(new CustomEvent('duediligence:auxiliary-diagnostics-ready'));
})(window);
