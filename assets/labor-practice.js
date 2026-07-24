/*
 * Closed-loop Labor Law practice client.
 *
 * This layer deliberately wraps the legacy static trainer instead of replacing it.
 * It uses only the public Supabase Edge Function endpoint; Google Sheets and OpenAI
 * credentials, canonical answer keys, and feedback records stay server-side.
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
    facets: { barYears: [], topics: [], difficulties: [] },
    filters: { barYear: '', topic: '', difficulty: '' },
    requestInFlight: null,
    message: '',
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

  function friendlyError(code) {
    const messages = {
      SERVICE_CONFIGURATION_REQUIRED: 'The Labor Law editorial service is not configured yet. No fallback answer key is being used.',
      CANONICAL_CONTENT_UNAVAILABLE: 'The approved Labor Law catalog is temporarily unavailable. Your draft remains saved on this device.',
      QUESTION_PENDING_EDITORIAL_COMPLETION: 'That item is not publication-ready and cannot be shown to learners.',
      EVALUATOR_UNAVAILABLE: 'The concept-match evaluator is temporarily unavailable. Your draft remains saved; no score was issued.',
      ANSWER_NEEDS_MORE_CONTENT: 'Please provide a substantive answer before requesting a concept match.',
      QUESTION_VERSION_MISMATCH: 'This question changed while you were answering. Refresh the catalog and review the current version.',
      INVALID_FEEDBACK: 'Please complete the required feedback details before submitting.',
      ORIGIN_NOT_ALLOWED: 'This site origin is not approved for the secure Labor Law service.',
    };
    return messages[code] || 'The secure Labor Law service could not complete that request. Your draft remains saved.';
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

  function setLaborQuestions(publicQuestions) {
    BAR_QUESTIONS[LABOR_SUBJECT] = publicQuestions.map((question) => ({
      id: question.questionId,
      questionId: question.questionId,
      databaseVersion: question.databaseVersion,
      text: question.essayQuestion,
      model: '',
      caseLaw: '',
      topic: question.topic,
      barYear: question.barYear,
      questionNumber: question.questionNumber,
      difficulty: question.difficulty,
      sourceUrl: question.sourceUrl,
      preview: Boolean(question.preview),
      curatedLabor: true,
    }));
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
    return `
      <div class="labor-filter-bar" aria-label="Labor Law question filters">
        <div class="labor-filter-field"><label for="labor-year-filter">Bar year</label><select id="labor-year-filter">${selectOptions(state.facets.barYears, state.filters.barYear, 'years')}</select></div>
        <div class="labor-filter-field"><label for="labor-topic-filter">Topic</label><select id="labor-topic-filter">${selectOptions(state.facets.topics, state.filters.topic, 'topics')}</select></div>
        <div class="labor-filter-field"><label for="labor-difficulty-filter">Difficulty</label><select id="labor-difficulty-filter">${selectOptions(state.facets.difficulties, state.filters.difficulty, 'difficulties')}</select></div>
        <button class="btn-tool" type="button" id="labor-reset-filter">Reset filters</button>
      </div>
      <div class="labor-meta">Curated source record · ${escapeText(question.questionId)} · Version ${escapeText(question.databaseVersion)} · ${escapeText(question.barYear)} Bar · ${escapeText(question.topic)} · ${escapeText(question.difficulty)}${question.preview ? '<span class="labor-chip">Editorial preview</span>' : ''}</div>`;
  }

  function bindLaborControls() {
    const apply = () => {
      state.filters = {
        barYear: document.getElementById('labor-year-filter')?.value || '',
        topic: document.getElementById('labor-topic-filter')?.value || '',
        difficulty: document.getElementById('labor-difficulty-filter')?.value || '',
      };
      currentIdx = 0;
      loadCatalog();
    };
    ['labor-year-filter', 'labor-topic-filter', 'labor-difficulty-filter'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('change', apply);
    });
    const reset = document.getElementById('labor-reset-filter');
    if (reset) reset.addEventListener('click', () => {
      state.filters = { barYear: '', topic: '', difficulty: '' };
      currentIdx = 0;
      loadCatalog();
    });
  }

  function renderServiceState() {
    const main = document.getElementById('main');
    if (!main) return;
    const pending = state.status === 'loading';
    const empty = state.status === 'empty';
    const title = pending ? 'Loading the approved Labor Law catalog' : empty ? 'No approved Labor Law questions match these filters' : 'Labor Law practice is protected';
    const description = pending
      ? 'Only question records marked publication-ready by the editorial team may be loaded.'
      : empty
        ? 'Adjust or reset the filters. Unapproved and incomplete records remain unavailable by design.'
        : (state.message || 'The curated answer key is not available, so the platform will not substitute a generated or legacy model answer.');
    main.innerHTML = `<div class="labor-service-card"><div class="eyebrow">Closed-loop legal content</div><h3>${escapeText(title)}</h3><p>${escapeText(description)}</p>${pending ? '<div class="loading">Checking the editorial catalog…</div>' : '<button class="btn-primary" type="button" id="labor-retry">Retry secure catalog</button>'}</div>`;
    document.getElementById('labor-retry')?.addEventListener('click', () => loadCatalog(true));
  }

  function installLaborDecorations() {
    const question = currentQuestion();
    if (!isCuratedLaborQuestion(question)) return;
    const toolbar = document.querySelector('#main .toolbar');
    if (toolbar && !document.getElementById('labor-year-filter')) toolbar.insertAdjacentHTML('afterend', laborControlsMarkup(question));
    bindLaborControls();
    const card = document.querySelector('#main .paper-card .q-text')?.closest('.paper-card');
    if (card && !card.querySelector('.labor-meta')) card.insertAdjacentHTML('beforeend', `<div class="labor-meta">Official source: <a href="${escapeText(question.sourceUrl)}" target="_blank" rel="noopener noreferrer">open editorial source record</a></div>`);
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
    const draft = readDraft(question);
    userAnswers[key] = draft;
    original.renderMainWrite();
    installLaborDecorations();
  }

  async function loadCatalog(force = false) {
    if (state.requestInFlight && !force) return state.requestInFlight;
    state.status = 'loading';
    state.message = '';
    renderServiceState();
    const request = callService({ action: 'list_questions', filters: state.filters })
      .then((payload) => {
        state.questions = Array.isArray(payload.questions) ? payload.questions : [];
        state.facets = payload.facets || state.facets;
        setLaborQuestions(state.questions);
        state.status = state.questions.length ? 'ready' : 'empty';
        if (payload.stale && typeof window.toast === 'function') window.toast('Using the last validated editorial catalog while the source refreshes.', 'warn');
        renderLaborMain();
      })
      .catch((error) => {
        state.status = 'error';
        state.message = friendlyError(error?.message);
        renderServiceState();
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

  function listMarkup(items, emptyText) {
    return items.length ? `<ul>${items.map((item) => `<li>${escapeText(item)}</li>`).join('')}</ul>` : `<p>${escapeText(emptyText)}</p>`;
  }

  function componentMarkup(label, component) {
    return `<div class="issue ${component.score >= component.maxScore * 0.75 ? 'full' : component.score >= component.maxScore * 0.4 ? 'partial' : 'missed'}"><div class="issue-head"><span>${escapeText(label)}</span><span class="pts">${Number(component.score)} / ${Number(component.maxScore)} pts</span></div><div class="note">${escapeText(component.explanation)}</div></div>`;
  }

  function renderLaborResultHTML(key) {
    const result = submissionResults[key];
    if (!result?.laborEvaluation || !result?.canonical) return '';
    const evaluation = result.laborEvaluation;
    const canonical = result.canonical;
    const grammar = evaluation.grammarReview;
    const corrections = grammar.corrections.map((item) => `<div class="grammar-correction"><b>${escapeText(item.original || 'Original')}</b> → <b>${escapeText(item.corrected || 'Suggested')}</b><br>${escapeText(item.explanation || '')}</div>`).join('');
    return `
      <div class="paper-card" style="background:#fcfaf5; border-color:var(--ink);">
        <div class="labor-result-head"><div class="labor-score-orb"><b>${Number(evaluation.experimentalScore)}</b><span>of 100</span></div><div class="labor-result-copy"><h3>${escapeText(evaluation.scoreLabel)}</h3><p>Experimental Concept-Match Score · compared only against the approved Labor Law record, version ${escapeText(result.laborVersion)}.</p></div></div>
        <div class="labor-notice">This is an educational concept-match signal, not an official Bar grade. ${evaluation.requiresHumanReview ? 'A human editorial review is recommended because the record has an identified evaluation limitation.' : 'Review the canonical record and your reasoning before relying on this feedback.'}</div>
        <div class="panel-title">Concept-match rubric · exact numeric sum = ${Number(evaluation.experimentalScore)} / 100</div>
        ${componentMarkup('Issue recognition', evaluation.issueRecognition)}
        ${componentMarkup('Governing rule or doctrine', evaluation.governingRule)}
        ${componentMarkup('Factual application', evaluation.factualApplication)}
        ${componentMarkup('Legally compatible conclusion', evaluation.conclusion)}
        <div class="labor-concept-grid"><section class="labor-concept-list good"><h4>Concepts matched</h4>${listMarkup(evaluation.conceptsMatched, 'No specific concepts were identified as matched.')}</section><section class="labor-concept-list warn"><h4>Concepts to develop</h4>${listMarkup(evaluation.conceptsMissing, 'No missing concepts were identified.')}</section><section class="labor-concept-list danger"><h4>Material contradictions</h4>${listMarkup(evaluation.materialContradictions, 'No material contradiction was identified.')}</section></div>
        <div class="remarks"><strong>Educational feedback:</strong> ${escapeText(evaluation.conciseFeedback)}</div>
        <section class="grammar-review"><h4>American English Writing Review</h4><p class="no-deduction">Grammar and clarity feedback is separate from legal scoring. <strong>No point deduction was made.</strong></p>${corrections ? `<div>${corrections}</div>` : ''}${grammar.clarityNotes.length ? `<div class="labor-concept-list" style="margin-top:12px;"><h4>Clarity notes</h4>${listMarkup(grammar.clarityNotes, '')}</div>` : ''}<div class="grammar-corrected-answer">${escapeText(grammar.correctedAnswerAmericanEnglish)}</div></section>
        <section class="labor-canonical"><div class="panel-title">Approved canonical learning record</div><div class="legal-detail"><b>Suggested answer</b>${escapeText(canonical.suggestedAnswer)}</div><div class="legal-detail"><b>Legal basis / provision</b>${escapeText(canonical.legalBasis)}</div><div class="legal-detail"><b>Controlling doctrine</b>${escapeText(canonical.controllingDoctrine)}</div><div class="legal-detail"><b>Jurisprudence</b>${escapeText(canonical.jurisprudence)}${canonical.citation ? ` · ${escapeText(canonical.citation)}` : ''}</div><div class="labor-meta">Question ${escapeText(result.laborQuestionId)} · Version ${escapeText(result.laborVersion)} · <a href="${escapeText(canonical.sourceUrl)}" target="_blank" rel="noopener noreferrer">open source record</a></div></section>
        <div class="fb-bar"><span class="fb-label">Help improve this reviewed content</span><button class="fb-btn" onclick="rateModel('up')">Helpful</button><button class="fb-btn" onclick="rateModel('down')">Flag for review</button><button class="fb-btn suggest" onclick="openSuggest()">Suggest Correction</button></div>
        <button class="btn-next" onclick="submitAndNext()">Continue to Next Item →</button>
      </div>`;
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
    if (button) { button.disabled = true; button.textContent = 'Comparing approved concepts…'; }
    try {
      const payload = await callService({ action: 'evaluate', questionId: question.questionId, studentAnswer });
      const evaluation = validateClientEvaluation(payload.evaluation, question);
      const score = Number(evaluation.experimentalScore);
      const result = {
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
        laborEvaluation: evaluation,
        canonical: payload.canonical,
      };
      submissionResults[key] = result;
      historyLog.unshift(result);
      window.logAttempt?.(result);
      clearDraft(question);
      const resultArea = document.getElementById('evaluation-result-area');
      if (resultArea) resultArea.innerHTML = renderLaborResultHTML(key);
      resultArea?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      window.toast?.(friendlyError(error?.message), 'warn');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Evaluate & Grade Essay'; }
    }
  }

  async function submitLaborFeedback(feedbackType, extras = {}) {
    const question = currentQuestion();
    if (!isCuratedLaborQuestion(question)) return false;
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
    } catch (error) {
      window.toast?.(friendlyError(error?.message), 'warn');
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
    BAR_QUESTIONS[LABOR_SUBJECT] = [];
    renderSubjectTabs();
    loadCatalog();
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
    if (isCuratedLaborQuestion(question)) clearDraft(question);
    return original.submitAndNext();
  };

  renderResultHTML = (function preserveAndRouteLaborResult(originalRenderResult) {
    return function renderResultWithLabor(key) {
      const result = submissionResults[key];
      if (result?.laborEvaluation) return renderLaborResultHTML(key);
      return originalRenderResult(key);
    };
  }(window.renderResultHTML));

  rateModel = async function rateModelWithLabor(direction) {
    if (!isCuratedLaborQuestion()) return original.rateModel(direction);
    const accepted = await submitLaborFeedback(direction === 'up' ? 'ENDORSEMENT' : 'FLAG');
    if (accepted) window.toast?.(direction === 'up' ? 'Thank you. Your endorsement is queued for the editorial team.' : 'Flag recorded for editorial review. The canonical answer remains unchanged until reviewed.', direction === 'up' ? 'ok' : 'warn');
  };

  openSuggest = function openSuggestWithLabor() {
    if (!isCuratedLaborQuestion()) return original.openSuggest();
    const question = currentQuestion();
    const result = submissionResults[legacyKey()];
    if (!result?.canonical) {
      window.toast?.('Evaluate the approved record before suggesting a correction.', 'warn');
      return;
    }
    document.getElementById('suggest-qid').textContent = `Refining: ${question.questionId} · canonical version ${question.databaseVersion}`;
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
    if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) {
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
    window.toast?.('Suggested correction sent to the private editorial review queue. It cannot change the canonical answer until approved and versioned.', 'ok');
  };

  document.addEventListener('DOMContentLoaded', () => {
    configureSuggestionModal();
    if (currentSubj === LABOR_SUBJECT) loadCatalog();
  });
}());
