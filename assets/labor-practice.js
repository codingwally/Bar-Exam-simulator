/*
 * Labor Law curated-practice client.
 *
 * This wrapper preserves the established trainer while allowing a server-backed
 * question bank to refresh safely. A catalogue refresh must never remove a
 * question that a student can already practise with.
 */
(function laborPracticeClient() {
  'use strict';

  const LABOR_SUBJECT = 'Labor Law';
  const DRAFT_PREFIX = 'dd_labor_draft_v1:';
  const REQUEST_TIMEOUT_MS = 30000;
  const componentLimits = Object.freeze({
    issueRecognition: 20,
    governingRule: 30,
    factualApplication: 30,
    conclusion: 20,
  });
  const state = {
    status: 'idle',
    questions: [],
    fallbackQuestions: [],
    facets: { barYears: [], topics: [], difficulties: [] },
    filters: { barYear: '', topic: '', difficulty: '' },
    requestInFlight: null,
    catalogNotice: '',
    catalogSource: 'local',
  };

  const original = {
    switchSubject: window.switchSubject,
    renderMainWrite: window.renderMainWrite,
    evaluateAnswer: window.evaluateAnswer,
    handleInput: window.handleInput,
    loadQuestion: window.loadQuestion,
    submitAndNext: window.submitAndNext,
    rateModel: window.rateModel,
    openSuggest: window.openSuggest,
    submitSuggestion: window.submitSuggestion,
  };

  const existingLaborQuestions = Array.isArray(BAR_QUESTIONS?.[LABOR_SUBJECT])
    ? BAR_QUESTIONS[LABOR_SUBJECT].map((question) => ({ ...question }))
    : [];

  function escapeText(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  }

  function currentQuestion() {
    const list = BAR_QUESTIONS?.[LABOR_SUBJECT] || [];
    return list[currentIdx] || null;
  }

  function isCuratedLaborQuestion(question = currentQuestion()) {
    return currentSubj === LABOR_SUBJECT && Boolean(question?.curatedLabor);
  }

  function legacyKey() {
    return `${currentSubj}-${currentIdx}`;
  }

  function draftKey(question) {
    return `${DRAFT_PREFIX}${question.questionId}:${question.databaseVersion}`;
  }

  function readDraft(question) {
    try { return localStorage.getItem(draftKey(question)) || ''; } catch { return ''; }
  }

  function writeDraft(question, answer) {
    try { localStorage.setItem(draftKey(question), answer); } catch { /* Storage is optional. */ }
  }

  function clearDraft(question) {
    try { localStorage.removeItem(draftKey(question)); } catch { /* Storage is optional. */ }
  }

  function endpoint() {
    return window.DueDiligenceLaborConfig?.endpoint || '';
  }

  function remoteCatalogEnabled() {
    return window.DueDiligenceLaborConfig?.remoteCatalogEnabled === true;
  }

  function validHttps(value) {
    return /^https:\/\//i.test(String(value || '').trim());
  }

  function friendlyError(code) {
    const messages = {
      SERVICE_CONFIGURATION_REQUIRED: 'We could not refresh the question bank. You can continue using the latest available questions.',
      CANONICAL_CONTENT_UNAVAILABLE: 'We could not refresh the question bank. You can continue using the latest available questions.',
      QUESTION_PENDING_EDITORIAL_COMPLETION: 'This question is not available for student practice yet.',
      EVALUATOR_UNAVAILABLE: 'Your answer and draft are saved. Automated feedback is temporarily unavailable, but you may still review the suggested answer and continue practicing.',
      ANSWER_NEEDS_MORE_CONTENT: 'Please provide a substantive answer before requesting feedback.',
      QUESTION_VERSION_MISMATCH: 'This question was updated while you were answering. Your draft is still saved; please try again.',
      INVALID_FEEDBACK: 'Please complete the required feedback details before submitting.',
      ORIGIN_NOT_ALLOWED: 'Automated feedback is temporarily unavailable. Your draft is still saved on this device.',
    };
    return messages[code] || 'We could not refresh the question bank. You can continue using the latest available questions.';
  }

  async function callService(payload) {
    if (!endpoint()) throw new Error('SERVICE_CONFIGURATION_REQUIRED');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'CANONICAL_CONTENT_UNAVAILABLE');
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('CANONICAL_CONTENT_UNAVAILABLE');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function localQuestion(question, index, source) {
    const questionId = String(question.questionId || question.id || `LABOR-LOCAL-${index + 1}`).trim();
    const essayQuestion = String(question.essayQuestion || question.text || '').trim();
    const suggestedAnswer = String(question.suggestedAnswer || question.model || '').trim();
    if (!questionId || !essayQuestion || !suggestedAnswer) return null;
    return {
      ...question,
      id: questionId,
      questionId,
      databaseVersion: String(question.databaseVersion || question.lastUpdated || 'local-availability-v1'),
      text: essayQuestion,
      essayQuestion,
      model: suggestedAnswer,
      suggestedAnswer,
      legalBasis: String(question.legalBasis || ''),
      controllingDoctrine: String(question.controllingDoctrine || ''),
      jurisprudence: String(question.jurisprudence || question.caseLaw || ''),
      citation: String(question.citation || ''),
      sourceAttribution: String(question.sourceAttribution || ''),
      sourceUrl: validHttps(question.sourceUrl) ? question.sourceUrl : '',
      topic: String(question.topic || 'Labor Law'),
      barYear: question.barYear || '',
      questionNumber: String(question.questionNumber || index + 1),
      subpart: String(question.subpart || ''),
      difficulty: String(question.difficulty || ''),
      lastUpdated: String(question.lastUpdated || ''),
      localCatalog: true,
      catalogSource: source,
      curatedLabor: true,
    };
  }

  function configuredSnapshot() {
    const snapshot = window.DueDiligenceLaborSnapshot;
    const records = Array.isArray(snapshot) ? snapshot : Array.isArray(snapshot?.questions) ? snapshot.questions : [];
    return records.map((question, index) => localQuestion(question, index, 'sheet-snapshot')).filter(Boolean);
  }

  function buildAvailabilityFallback() {
    const snapshot = configuredSnapshot();
    const records = snapshot.length ? snapshot : existingLaborQuestions
      .map((question, index) => localQuestion(question, index, 'last-available-catalog'))
      .filter(Boolean);
    const seen = new Set();
    return records.filter((question) => {
      if (seen.has(question.questionId)) return false;
      seen.add(question.questionId);
      return true;
    });
  }

  function sortQuestions(questions) {
    return [...questions].sort((left, right) => {
      const leftYear = Number(left.barYear) || Number.MAX_SAFE_INTEGER;
      const rightYear = Number(right.barYear) || Number.MAX_SAFE_INTEGER;
      return leftYear - rightYear
        || String(left.questionNumber || '').localeCompare(String(right.questionNumber || ''), undefined, { numeric: true })
        || String(left.subpart || '').localeCompare(String(right.subpart || ''), undefined, { numeric: true })
        || String(left.questionId).localeCompare(String(right.questionId));
    });
  }

  function filterQuestions(questions) {
    const { barYear, topic, difficulty } = state.filters;
    return questions.filter((question) => (!barYear || String(question.barYear) === String(barYear))
      && (!topic || String(question.topic).toLowerCase() === String(topic).toLowerCase())
      && (!difficulty || String(question.difficulty).toLowerCase() === String(difficulty).toLowerCase()));
  }

  function facetsFor(questions) {
    const values = (key) => [...new Set(questions.map((question) => String(question[key] || '')).filter(Boolean))];
    return {
      barYears: values('barYear').sort((left, right) => Number(left) - Number(right)),
      topics: values('topic').sort((left, right) => left.localeCompare(right)),
      difficulties: values('difficulty').sort((left, right) => left.localeCompare(right)),
    };
  }

  function setLaborQuestions(questions, source) {
    const records = sortQuestions(questions).map((question, index) => ({
      ...question,
      id: question.questionId,
      text: question.essayQuestion || question.text,
      model: question.localCatalog ? question.suggestedAnswer || question.model || '' : '',
      caseLaw: question.jurisprudence || question.caseLaw || '',
      curatedLabor: true,
      localCatalog: Boolean(question.localCatalog),
      catalogSource: source,
      questionNumber: String(question.questionNumber || index + 1),
      subpart: String(question.subpart || ''),
    }));
    BAR_QUESTIONS[LABOR_SUBJECT] = records;
    state.questions = records;
    state.status = records.length ? 'ready' : 'empty';
    state.catalogSource = source;
  }

  function useAvailabilityFallback(notice = '') {
    state.fallbackQuestions = state.fallbackQuestions.length ? state.fallbackQuestions : buildAvailabilityFallback();
    state.facets = facetsFor(state.fallbackQuestions);
    setLaborQuestions(filterQuestions(state.fallbackQuestions), 'local');
    state.catalogNotice = notice;
  }

  function resetQuestionIndexIfNeeded() {
    const questions = BAR_QUESTIONS[LABOR_SUBJECT] || [];
    if (!questions.length) {
      currentIdx = 0;
      return;
    }
    currentIdx = Math.max(0, Math.min(currentIdx, questions.length - 1));
  }

  function selectOptions(values, selected, label) {
    return [`<option value="">All ${escapeText(label)}</option>`]
      .concat(values.map((value) => `<option value="${escapeText(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeText(value)}</option>`))
      .join('');
  }

  function laborControlsMarkup(question) {
    const subpart = question.subpart ? ` · Part ${escapeText(question.subpart)}` : '';
    return `
      <section class="labor-intro" aria-label="Labor Law practice introduction">
        <div><div class="eyebrow">Curated question bank</div><h2>Labor Law Mock Bar Exam</h2><p>Practice with curated Philippine Bar Exam questions and receive concept-based feedback on your answers.</p></div>
        <button class="btn-primary" type="button" id="labor-start-practice">Start Practice</button>
      </section>
      ${state.catalogNotice ? `<div class="labor-notice" role="status">${escapeText(state.catalogNotice)}</div>` : ''}
      <div class="labor-filter-bar" aria-label="Labor Law question filters">
        <div class="labor-filter-field"><label for="labor-year-filter">Bar year</label><select id="labor-year-filter">${selectOptions(state.facets.barYears, state.filters.barYear, 'years')}</select></div>
        <div class="labor-filter-field"><label for="labor-topic-filter">Topic</label><select id="labor-topic-filter">${selectOptions(state.facets.topics, state.filters.topic, 'topics')}</select></div>
        <div class="labor-filter-field"><label for="labor-difficulty-filter">Difficulty</label><select id="labor-difficulty-filter">${selectOptions(state.facets.difficulties, state.filters.difficulty, 'difficulties')}</select></div>
        <button class="btn-tool" type="button" id="labor-reset-filter">Reset filters</button>
      </div>
      <div class="labor-meta">Question ${escapeText(question.questionId)}${question.barYear ? ` · ${escapeText(question.barYear)} Bar` : ''} · No. ${escapeText(question.questionNumber)}${subpart}${question.topic ? ` · ${escapeText(question.topic)}` : ''}</div>`;
  }

  function bindLaborControls() {
    const apply = () => {
      state.filters = {
        barYear: document.getElementById('labor-year-filter')?.value || '',
        topic: document.getElementById('labor-topic-filter')?.value || '',
        difficulty: document.getElementById('labor-difficulty-filter')?.value || '',
      };
      currentIdx = 0;
      useAvailabilityFallback(state.catalogNotice);
      renderLaborMain();
      if (remoteCatalogEnabled()) loadCatalog();
    };
    ['labor-year-filter', 'labor-topic-filter', 'labor-difficulty-filter'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('change', apply);
    });
    const reset = document.getElementById('labor-reset-filter');
    if (reset) reset.addEventListener('click', () => {
      state.filters = { barYear: '', topic: '', difficulty: '' };
      currentIdx = 0;
      useAvailabilityFallback();
      renderLaborMain();
      if (remoteCatalogEnabled()) loadCatalog();
    });
    document.getElementById('labor-start-practice')?.addEventListener('click', () => {
      document.getElementById('answer-box')?.focus();
    });
  }

  function renderServiceState() {
    const main = document.getElementById('main');
    if (!main) return;
    const pending = state.status === 'loading';
    const empty = state.status === 'empty';
    const title = empty ? 'No Labor Law questions match these filters' : 'Labor Law Mock Bar Exam';
    const description = empty
      ? 'Reset the filters to return to the available practice questions.'
      : 'Practice with curated Philippine Bar Exam questions and receive concept-based feedback on your answers.';
    main.innerHTML = `<div class="labor-service-card"><div class="eyebrow">Curated question bank</div><h3>${escapeText(title)}</h3><p>${escapeText(description)}</p>${pending ? '<div class="loading">Loading Labor Law questions…</div>' : '<button class="btn-primary" type="button" id="labor-retry">Try Again</button>'}</div>`;
    document.getElementById('labor-retry')?.addEventListener('click', () => {
      useAvailabilityFallback();
      renderLaborMain();
      if (remoteCatalogEnabled()) loadCatalog(true);
    });
  }

  function installLaborDecorations() {
    const question = currentQuestion();
    if (!isCuratedLaborQuestion(question)) return;
    const toolbar = document.querySelector('#main .toolbar');
    if (toolbar && !document.getElementById('labor-year-filter')) toolbar.insertAdjacentHTML('beforebegin', laborControlsMarkup(question));
    bindLaborControls();
    const card = document.querySelector('#main .paper-card .q-text')?.closest('.paper-card');
    if (card && !card.querySelector('.labor-source') && (question.sourceAttribution || validHttps(question.sourceUrl))) {
      const link = validHttps(question.sourceUrl) ? ` <a href="${escapeText(question.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>` : '';
      card.insertAdjacentHTML('beforeend', `<div class="labor-meta labor-source">${escapeText(question.sourceAttribution || 'Source information')}${link}</div>`);
    }
  }

  function renderLaborMain() {
    if (state.status !== 'ready') {
      renderServiceState();
      return;
    }
    resetQuestionIndexIfNeeded();
    const question = currentQuestion();
    if (!question) {
      state.status = 'empty';
      renderServiceState();
      return;
    }
    const key = legacyKey();
    const savedResult = submissionResults[key];
    if (savedResult && savedResult.laborQuestionId !== question.questionId) delete submissionResults[key];
    userAnswers[key] = readDraft(question);
    original.renderMainWrite();
    installLaborDecorations();
  }

  async function loadCatalog(force = false) {
    if (!remoteCatalogEnabled()) {
      useAvailabilityFallback();
      if (currentSubj === LABOR_SUBJECT) renderLaborMain();
      return;
    }
    if (state.requestInFlight && !force) return state.requestInFlight;
    const request = callService({ action: 'list_questions', filters: state.filters })
      .then((payload) => {
        const records = Array.isArray(payload.questions) ? payload.questions : [];
        if (!records.length) throw new Error('CANONICAL_CONTENT_UNAVAILABLE');
        state.facets = payload.facets || facetsFor(records);
        setLaborQuestions(records, 'remote');
        state.catalogNotice = payload.stale ? 'We could not refresh the question bank. You can continue using the latest available questions.' : '';
        if (currentSubj === LABOR_SUBJECT) renderLaborMain();
      })
      .catch(() => {
        useAvailabilityFallback('We could not refresh the question bank. You can continue using the latest available questions.');
        if (currentSubj === LABOR_SUBJECT) renderLaborMain();
      })
      .finally(() => { state.requestInFlight = null; });
    state.requestInFlight = request;
    return request;
  }

  function clientComponent(value, name, maximum) {
    if (!value || typeof value !== 'object' || Number(value.maxScore) !== maximum || typeof value.explanation !== 'string') throw new Error(`Invalid ${name} score.`);
    const score = Number(value.score);
    if (!Number.isFinite(score)) throw new Error(`Invalid ${name} score.`);
    return { score: Math.max(0, Math.min(maximum, Math.round(score))), maxScore: maximum, explanation: value.explanation };
  }

  function validateClientEvaluation(raw, question) {
    if (!raw || raw.questionId !== question.questionId || raw.databaseVersion !== question.databaseVersion) throw new Error('QUESTION_VERSION_MISMATCH');
    const issueRecognition = clientComponent(raw.issueRecognition, 'issue recognition', componentLimits.issueRecognition);
    const governingRule = clientComponent(raw.governingRule, 'governing rule', componentLimits.governingRule);
    const factualApplication = clientComponent(raw.factualApplication, 'factual application', componentLimits.factualApplication);
    const conclusion = clientComponent(raw.conclusion, 'conclusion', componentLimits.conclusion);
    const total = Number(issueRecognition.score) + Number(governingRule.score) + Number(factualApplication.score) + Number(conclusion.score);
    if (Number(raw.experimentalScore) !== total) throw new Error('EVALUATOR_UNAVAILABLE');
    const grammarReview = raw.grammarReview;
    if (!grammarReview || grammarReview.affectedScore !== false || typeof grammarReview.correctedAnswerAmericanEnglish !== 'string') throw new Error('EVALUATOR_UNAVAILABLE');
    const shortList = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 12) : [];
    return {
      questionId: question.questionId,
      databaseVersion: question.databaseVersion,
      experimentalScore: total,
      scoreLabel: String(raw.scoreLabel || 'Concept Match'),
      issueRecognition,
      governingRule,
      factualApplication,
      conclusion,
      conceptsMatched: shortList(raw.conceptsMatched),
      conceptsMissing: shortList(raw.conceptsMissing),
      materialContradictions: shortList(raw.materialContradictions),
      conciseFeedback: String(raw.conciseFeedback || ''),
      grammarReview: {
        correctedAnswerAmericanEnglish: grammarReview.correctedAnswerAmericanEnglish,
        corrections: Array.isArray(grammarReview.corrections) ? grammarReview.corrections.slice(0, 12) : [],
        clarityNotes: shortList(grammarReview.clarityNotes),
        affectedScore: false,
      },
      requiresHumanReview: Boolean(raw.requiresHumanReview),
    };
  }

  function canonicalForQuestion(question) {
    const snapshotMatch = state.fallbackQuestions.find((candidate) => candidate.questionId === question?.questionId);
    const record = String(question?.suggestedAnswer || question?.model || '').trim() ? question : snapshotMatch;
    const suggestedAnswer = String(record?.suggestedAnswer || record?.model || '').trim();
    if (!suggestedAnswer) return null;
    return {
      suggestedAnswer,
      legalBasis: String(record.legalBasis || ''),
      controllingDoctrine: String(record.controllingDoctrine || ''),
      jurisprudence: String(record.jurisprudence || record.caseLaw || ''),
      citation: String(record.citation || ''),
      sourceUrl: validHttps(record.sourceUrl) ? record.sourceUrl : '',
      sourceAttribution: String(record.sourceAttribution || ''),
    };
  }

  function listMarkup(items, emptyText) {
    return items.length ? `<ul>${items.map((item) => `<li>${escapeText(item)}</li>`).join('')}</ul>` : `<p>${escapeText(emptyText)}</p>`;
  }

  function componentMarkup(label, component) {
    return `<div class="issue ${component.score >= component.maxScore * 0.75 ? 'full' : component.score >= component.maxScore * 0.4 ? 'partial' : 'missed'}"><div class="issue-head"><span>${escapeText(label)}</span><span class="pts">${Number(component.score)} / ${Number(component.maxScore)} pts</span></div><div class="note">${escapeText(component.explanation)}</div></div>`;
  }

  function canonicalMarkup(canonical, result) {
    const source = canonical.sourceAttribution ? `<div class="legal-detail"><b>Source information</b>${escapeText(canonical.sourceAttribution)}</div>` : '';
    const sourceLink = validHttps(canonical.sourceUrl) ? ` · <a href="${escapeText(canonical.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>` : '';
    return `<section class="labor-canonical"><div class="panel-title">Suggested answer</div><div class="legal-detail">${escapeText(canonical.suggestedAnswer)}</div>${canonical.legalBasis ? `<div class="legal-detail"><b>Legal basis / provision</b>${escapeText(canonical.legalBasis)}</div>` : ''}${canonical.controllingDoctrine ? `<div class="legal-detail"><b>Controlling doctrine</b>${escapeText(canonical.controllingDoctrine)}</div>` : ''}${canonical.jurisprudence ? `<div class="legal-detail"><b>Jurisprudence</b>${escapeText(canonical.jurisprudence)}${canonical.citation ? ` · ${escapeText(canonical.citation)}` : ''}</div>` : ''}${source}<div class="labor-meta">Question ${escapeText(result.laborQuestionId)} · ${escapeText(result.laborVersion || 'Current record')}${sourceLink}</div></section>`;
  }

  function renderUnavailableEvaluation(result) {
    return `<div class="paper-card" style="background:#fcfaf5; border-color:var(--ink);"><div class="labor-notice"><strong>Automated feedback is temporarily unavailable.</strong> Your answer and draft are saved. You may still review the suggested answer and continue practicing.</div><section class="labor-student-answer"><div class="panel-title">Student answer</div><div class="suggested">${escapeText(result.studentAnswer)}</div></section><section class="grammar-review"><h4>American English Writing Review</h4><p class="no-deduction">Grammar feedback is temporarily unavailable. It never changes the substantive legal score.</p></section>${canonicalMarkup(result.canonical, result)}<div class="fb-bar"><button class="fb-btn" onclick="evaluateAnswer()">Try Again</button></div><button class="btn-next" onclick="submitAndNext()">Continue to Next Item →</button></div>`;
  }

  function renderLaborResultHTML(key) {
    const result = submissionResults[key];
    if (!result?.canonical) return '';
    if (result.evaluationUnavailable) return renderUnavailableEvaluation(result);
    if (!result.laborEvaluation) return '';
    const evaluation = result.laborEvaluation;
    const canonical = result.canonical;
    const grammar = evaluation.grammarReview;
    const corrections = grammar.corrections.map((item) => `<div class="grammar-correction"><b>${escapeText(item.original || 'Original')}</b> → <b>${escapeText(item.corrected || 'Suggested')}</b><br>${escapeText(item.explanation || '')}</div>`).join('');
    return `
      <div class="paper-card" style="background:#fcfaf5; border-color:var(--ink);">
        <div class="labor-result-head"><div class="labor-score-orb"><b>${Number(evaluation.experimentalScore)}</b><span>of 100</span></div><div class="labor-result-copy"><h3>${escapeText(evaluation.scoreLabel)}</h3><p>Concept-based feedback for this Labor Law practice question.</p></div></div>
        <div class="labor-notice">This is an educational concept-based assessment, not an official Bar grade. ${evaluation.requiresHumanReview ? 'A human editorial review is recommended for this result.' : 'Review the suggested answer and your reasoning before relying on this feedback.'}</div>
        <section class="labor-student-answer"><div class="panel-title">Student answer</div><div class="suggested">${escapeText(result.studentAnswer)}</div></section>
        <div class="panel-title">Score breakdown · ${Number(evaluation.experimentalScore)} / 100</div>
        ${componentMarkup('Issue spotting', evaluation.issueRecognition)}
        ${componentMarkup('Applicable law or rule', evaluation.governingRule)}
        ${componentMarkup('Application and reasoning', evaluation.factualApplication)}
        ${componentMarkup('Conclusion', evaluation.conclusion)}
        <div class="labor-concept-grid"><section class="labor-concept-list good"><h4>Strengths</h4>${listMarkup(evaluation.conceptsMatched, 'No specific strengths were identified.')}</section><section class="labor-concept-list warn"><h4>Concepts to develop</h4>${listMarkup(evaluation.conceptsMissing, 'No missing concepts were identified.')}</section><section class="labor-concept-list danger"><h4>Material contradictions</h4>${listMarkup(evaluation.materialContradictions, 'No material contradiction was identified.')}</section></div>
        <div class="remarks"><strong>Educational feedback:</strong> ${escapeText(evaluation.conciseFeedback)}</div>
        <section class="grammar-review"><h4>American English Writing Review</h4><p class="no-deduction">Grammar and clarity feedback is separate from legal scoring. <strong>No point deduction was made.</strong></p>${corrections ? `<div>${corrections}</div>` : ''}${grammar.clarityNotes.length ? `<div class="labor-concept-list" style="margin-top:12px;"><h4>Clarity notes</h4>${listMarkup(grammar.clarityNotes, '')}</div>` : ''}<div class="grammar-corrected-answer">${escapeText(grammar.correctedAnswerAmericanEnglish)}</div></section>
        ${canonicalMarkup(canonical, result)}
        <div class="fb-bar"><span class="fb-label">Help improve this reviewed content</span><button class="fb-btn" onclick="rateModel('up')">Helpful</button><button class="fb-btn" onclick="rateModel('down')">Flag for review</button><button class="fb-btn suggest" onclick="openSuggest()">Suggest Correction</button></div>
        <button class="btn-next" onclick="submitAndNext()">Continue to Next Item →</button>
      </div>`;
  }

  function saveResult(key, result) {
    const previous = submissionResults[key];
    submissionResults[key] = result;
    if (!previous) {
      historyLog.unshift(result);
      window.logAttempt?.(result);
    }
    const resultArea = document.getElementById('evaluation-result-area');
    if (resultArea) resultArea.innerHTML = renderLaborResultHTML(key);
    resultArea?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showEvaluationUnavailable(key, question, studentAnswer) {
    const canonical = canonicalForQuestion(question);
    if (!canonical) {
      window.toast?.('Your answer and draft are saved. Automated feedback is temporarily unavailable.', 'warn');
      return;
    }
    saveResult(key, {
      score: null,
      passed: false,
      timeSpent: Math.max(0, Math.round((Date.now() - questionStartTs) / 1000)),
      timestamp: new Date().toLocaleString(),
      subject: LABOR_SUBJECT,
      qId: question.questionId,
      laborQuestionId: question.questionId,
      laborVersion: question.databaseVersion,
      studentAnswer,
      canonical,
      evaluationUnavailable: true,
    });
    window.toast?.(friendlyError('EVALUATOR_UNAVAILABLE'), 'warn');
  }

  async function evaluateLaborAnswer() {
    const question = currentQuestion();
    if (!isCuratedLaborQuestion(question)) return original.evaluateAnswer();
    const key = legacyKey();
    const studentAnswer = String(userAnswers[key] || '').trim();
    if (studentAnswer.length < 15) {
      window.toast?.(friendlyError('ANSWER_NEEDS_MORE_CONTENT'), 'warn');
      return;
    }
    writeDraft(question, studentAnswer);
    const button = document.getElementById('submit-btn');
    if (button) { button.disabled = true; button.textContent = 'Reviewing legal concepts…'; }
    if (!remoteCatalogEnabled()) {
      showEvaluationUnavailable(key, question, studentAnswer);
      if (button) { button.disabled = false; button.textContent = 'Evaluate & Grade Essay'; }
      return;
    }
    try {
      const payload = await callService({ action: 'evaluate', questionId: question.questionId, studentAnswer });
      const evaluation = validateClientEvaluation(payload.evaluation, question);
      const canonical = payload.canonical || canonicalForQuestion(question);
      if (!canonical?.suggestedAnswer) throw new Error('EVALUATOR_UNAVAILABLE');
      const score = Number(evaluation.experimentalScore);
      saveResult(key, {
        score,
        passed: score >= 75,
        answerScore: Number(evaluation.issueRecognition.score),
        legalScore: Number(evaluation.governingRule.score),
        appScore: Number(evaluation.factualApplication.score),
        conclusionScore: Number(evaluation.conclusion.score),
        timeSpent: Math.max(0, Math.round((Date.now() - questionStartTs) / 1000)),
        timestamp: new Date().toLocaleString(),
        subject: LABOR_SUBJECT,
        qId: question.questionId,
        laborQuestionId: question.questionId,
        laborVersion: question.databaseVersion,
        studentAnswer,
        laborEvaluation: evaluation,
        canonical,
      });
    } catch {
      showEvaluationUnavailable(key, question, studentAnswer);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Evaluate & Grade Essay'; }
    }
  }

  async function submitLaborFeedback(feedbackType, extras = {}) {
    const question = currentQuestion();
    if (!isCuratedLaborQuestion(question) || !remoteCatalogEnabled()) return false;
    const result = submissionResults[legacyKey()];
    try {
      await callService({
        action: 'submit_feedback',
        questionId: question.questionId,
        databaseVersion: question.databaseVersion,
        feedbackType,
        submissionId: `${question.questionId}:${question.databaseVersion}:${result?.timestamp || 'ungraded'}`,
        evaluationResult: result?.laborEvaluation || null,
        ...extras,
      });
      return true;
    } catch {
      window.toast?.('We could not send that feedback right now. Please try again later.', 'warn');
      return false;
    }
  }

  function configureSuggestionModal() {
    const laborFields = document.querySelector('[data-labor-feedback-fields]');
    if (laborFields) laborFields.hidden = !isCuratedLaborQuestion();
  }

  switchSubject = function switchSubjectWithLabor(subj) {
    if (subj !== LABOR_SUBJECT) return original.switchSubject(subj);
    currentSubj = LABOR_SUBJECT;
    currentIdx = 0;
    useAvailabilityFallback();
    renderSubjectTabs();
    renderLaborMain();
    if (remoteCatalogEnabled()) loadCatalog();
  };

  renderMainWrite = function renderMainWriteWithLabor() {
    if (currentSubj === LABOR_SUBJECT) return renderLaborMain();
    return original.renderMainWrite();
  };

  evaluateAnswer = function evaluateAnswerWithLabor() {
    if (isCuratedLaborQuestion()) return evaluateLaborAnswer();
    return original.evaluateAnswer();
  };

  handleInput = function handleInputWithLabor(element) {
    const result = original.handleInput(element);
    const question = currentQuestion();
    if (isCuratedLaborQuestion(question)) writeDraft(question, element.value);
    return result;
  };

  loadQuestion = function loadQuestionWithLabor(index) {
    const current = currentQuestion();
    const answerBox = document.getElementById('answer-box');
    if (isCuratedLaborQuestion(current) && answerBox) writeDraft(current, answerBox.value);
    return original.loadQuestion(index);
  };

  submitAndNext = function submitAndNextWithLabor() {
    const question = currentQuestion();
    if (isCuratedLaborQuestion(question)) {
      clearDraft(question);
      userAnswers[legacyKey()] = '';
    }
    return original.submitAndNext();
  };

  renderResultHTML = (function preserveAndRouteLaborResult(originalRenderResult) {
    return function renderResultWithLabor(key) {
      const result = submissionResults[key];
      if (result?.laborEvaluation || result?.evaluationUnavailable) return renderLaborResultHTML(key);
      return originalRenderResult(key);
    };
  }(window.renderResultHTML));

  rateModel = async function rateModelWithLabor(direction) {
    if (!isCuratedLaborQuestion()) return original.rateModel(direction);
    const accepted = await submitLaborFeedback(direction === 'up' ? 'ENDORSEMENT' : 'FLAG');
    if (accepted) window.toast?.(direction === 'up' ? 'Thank you. Your endorsement is queued for editorial review.' : 'Flag recorded for editorial review.', direction === 'up' ? 'ok' : 'warn');
  };

  openSuggest = function openSuggestWithLabor() {
    if (!isCuratedLaborQuestion()) return original.openSuggest();
    const question = currentQuestion();
    const result = submissionResults[legacyKey()];
    if (!result?.canonical) {
      window.toast?.('Review the suggested answer before suggesting a correction.', 'warn');
      return;
    }
    document.getElementById('suggest-qid').textContent = `Refining: ${question.questionId} · question version ${question.databaseVersion}`;
    document.getElementById('suggest-orig').textContent = result.canonical.suggestedAnswer;
    configureSuggestionModal();
    window.openModal('suggest-modal');
  };

  submitSuggestion = async function submitSuggestionWithLabor() {
    if (!isCuratedLaborQuestion()) return original.submitSuggestion();
    const answer = (document.getElementById('suggest-text')?.value || '').trim();
    const legalBasis = (document.getElementById('suggest-legal-basis')?.value || '').trim();
    const jurisprudence = (document.getElementById('suggest-jurisprudence')?.value || '').trim();
    const sourceUrl = (document.getElementById('suggest-source-url')?.value || '').trim();
    const explanation = (document.getElementById('suggest-explanation')?.value || '').trim();
    const contributor = (document.getElementById('suggest-email')?.value || '').trim();
    if (answer.length < 5 || explanation.length < 5) {
      window.toast?.('Add a proposed answer and a short editorial explanation.', 'warn');
      return;
    }
    if (sourceUrl && !validHttps(sourceUrl)) {
      window.toast?.('Provide a full HTTPS source link, or leave it blank for editorial research.', 'warn');
      return;
    }
    const accepted = await submitLaborFeedback('SUGGESTED_CORRECTION', {
      suggestedAnswer: answer,
      supportingLegalBasis: legalBasis,
      supportingJurisprudence: jurisprudence,
      sourceUrl,
      explanation,
      contributor,
    });
    if (!accepted) return;
    ['suggest-text', 'suggest-legal-basis', 'suggest-jurisprudence', 'suggest-source-url', 'suggest-explanation', 'suggest-email'].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.value = '';
    });
    window.closeModal('suggest-modal');
    window.toast?.('Suggested correction sent for editorial review.', 'ok');
  };

  document.addEventListener('DOMContentLoaded', () => {
    state.fallbackQuestions = buildAvailabilityFallback();
    useAvailabilityFallback();
    configureSuggestionModal();
    if (currentSubj === LABOR_SUBJECT) {
      renderLaborMain();
      if (remoteCatalogEnabled()) loadCatalog();
    }
  });
}());
