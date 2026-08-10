(function () {
  'use strict';

  var activeView = 'roles';
  var reviewQuestions = {
    1: { points: 10, prompt: 'State the best evidence rule and explain two recognized exceptions. Apply the rule to a photocopy offered to prove the contents of a signed agreement.' },
    2: { points: 15, prompt: 'Discuss whether the out-of-court statement is admissible when it is offered to prove notice rather than the truth of the matter asserted.' },
    3: { points: 10, prompt: 'May a witness refresh recollection using a writing not admitted in evidence? Explain the safeguards available to the adverse party.' },
    4: { points: 10, prompt: 'Distinguish judicial admissions from extrajudicial admissions and state the consequence of each.' },
    5: { points: 15, prompt: 'Analyze the authentication foundation required for an electronic message offered as evidence.' },
    6: { points: 15, prompt: 'Explain the requirements and limits of the business-records exception.' },
    7: { points: 15, prompt: 'Discuss the admissibility of character evidence in the stated civil and criminal settings.' },
    8: { points: 10, prompt: 'State the burden of proof and burden of evidence, then explain how each may shift during trial.' }
  };
  var studentQuestions = {
    1: reviewQuestions[1],
    2: reviewQuestions[2],
    3: reviewQuestions[3],
    4: reviewQuestions[4],
    5: reviewQuestions[5],
    6: reviewQuestions[6],
    7: reviewQuestions[7],
    8: reviewQuestions[8]
  };
  var studentAnswers = {
    1: 'Under the original document rule, an original writing is generally required when its contents are the subject of inquiry. A duplicate or secondary evidence may be admitted when the original has been lost or destroyed without bad faith, or when the original is in the custody of the adverse party who fails to produce it after reasonable notice.',
    2: 'The statement is offered to show that notice was given, not to prove the truth of its contents. It may therefore be independently relevant, subject to authentication and the court\'s assessment of its actual purpose.',
    3: 'Yes. A witness may use a writing to refresh present recollection, subject to the court\'s control. The adverse party may inspect the writing, cross-examine the witness about it, and introduce relevant portions when allowed by the Rules.',
    4: '',
    5: '',
    6: '',
    7: '',
    8: ''
  };
  var flaggedQuestions = new Set([3]);
  var activeStudentQuestion = 1;
  var saveTimer = 0;
  var dialogAction = null;
  var gradingQuestions = {
    1: {
      prompt: reviewQuestions[1].prompt,
      answer: studentAnswers[1],
      score: '7.5',
      comment: 'The governing rule is correctly identified. Tighten the foundation for secondary evidence and connect each exception to the facts.'
    },
    2: {
      prompt: reviewQuestions[2].prompt,
      answer: studentAnswers[2],
      score: '11',
      comment: 'Good purpose analysis. State more clearly that relevance and authentication remain separate requirements.'
    },
    3: {
      prompt: reviewQuestions[3].prompt,
      answer: studentAnswers[3],
      score: '8',
      comment: 'Correct answer with the principal safeguards. Add the distinction between refreshed recollection and recorded recollection.'
    }
  };

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function setPressed(buttons, active) {
    buttons.forEach(function (button) {
      var selected = button === active;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function announce(message) {
    var statusByView = {
      'professor-authoring': '#qa-authoring-status',
      beadle: '#qa-beadle-status',
      student: '#qa-student-status',
      'professor-after': '#qa-professor-status',
      admin: '#qa-admin-status'
    };
    var status = one(statusByView[activeView] || '#qa-student-status');
    if (status) {
      status.textContent = '';
      window.requestAnimationFrame(function () { status.textContent = message; });
    }
  }

  function showView(viewName, shouldFocus) {
    var target = one('[data-view-panel="' + viewName + '"]');
    if (!target) return;
    activeView = viewName;
    all('[data-view-panel]').forEach(function (panel) {
      panel.hidden = panel !== target;
    });
    var viewTitles = {
      roles: 'Choose a role',
      'professor-authoring': 'Professor',
      beadle: 'Beadle',
      student: 'Student',
      'professor-after': 'Professor — Monitor and grade',
      admin: 'Admin'
    };
    document.title = 'Examination Room 2.0 — ' + (viewTitles[viewName] || 'Local visual QA');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (shouldFocus !== false) {
      var heading = one('h1', target);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }

  function showState(group, state, shouldFocus) {
    var target = one('[data-state-panel="' + group + ':' + state + '"]');
    if (!target) return;
    all('[data-state-panel^="' + group + ':"]').forEach(function (panel) {
      panel.hidden = panel !== target;
    });
    var buttons = all('[data-state-group="' + group + '"]');
    var activeButton = one('[data-state-group="' + group + '"][data-state="' + state + '"]');
    if (activeButton) setPressed(buttons, activeButton);
    if (shouldFocus) {
      var heading = one('h2, h3', target);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }

  function tabKeyHandler(event, selector, attribute) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    var tabs = all(selector);
    var index = tabs.indexOf(event.currentTarget);
    if (index < 0) return;
    event.preventDefault();
    var targetIndex;
    if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = tabs.length - 1;
    else if (event.key === 'ArrowLeft') targetIndex = (index - 1 + tabs.length) % tabs.length;
    else targetIndex = (index + 1) % tabs.length;
    var target = tabs[targetIndex];
    target.focus();
    if (attribute === 'view') showView(target.dataset.view, false);
    else showState(target.dataset.stateGroup, target.dataset.state, false);
  }

  function openDemoDialog(message, action) {
    var dialog = one('#qa-dialog');
    var continueButton = one('#qa-dialog-continue');
    one('#qa-dialog-message').textContent = message;
    dialogAction = action && typeof action.run === 'function' ? action.run : null;
    continueButton.hidden = !dialogAction;
    continueButton.textContent = action?.label || 'Continue';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function updateReviewQuestion(ordinal) {
    var question = reviewQuestions[ordinal];
    if (!question) return;
    all('[data-review-question]').forEach(function (button) {
      button.classList.toggle('is-active', Number(button.dataset.reviewQuestion) === ordinal);
    });
    one('#qa-review-ordinal').textContent = String(ordinal);
    one('#qa-review-prompt').value = question.prompt;
    one('#qa-review-points').value = String(question.points);
  }

  function studentWordCount(text) {
    var normalized = text.trim();
    return normalized ? normalized.split(/\s+/u).length : 0;
  }

  function updateStudentCounts() {
    var answered = Object.keys(studentAnswers).filter(function (key) { return studentAnswers[key].trim(); }).length;
    one('#qa-answered-count').textContent = answered + ' of 8 answered';
    one('#qa-flagged-count').textContent = flaggedQuestions.size + ' flagged for review';
  }

  function persistVisibleAnswer() {
    var editor = one('#qa-student-answer');
    if (!editor) return;
    studentAnswers[activeStudentQuestion] = editor.value;
    var navigatorButton = one('[data-student-question="' + activeStudentQuestion + '"]');
    if (navigatorButton) navigatorButton.classList.toggle('is-saved', Boolean(editor.value.trim()));
    updateStudentCounts();
  }

  function renderStudentQuestion(ordinal) {
    persistVisibleAnswer();
    activeStudentQuestion = Math.min(8, Math.max(1, ordinal));
    var question = studentQuestions[activeStudentQuestion];
    all('[data-student-question]').forEach(function (button) {
      button.classList.toggle('is-active', Number(button.dataset.studentQuestion) === activeStudentQuestion);
      button.classList.toggle('is-flagged', flaggedQuestions.has(Number(button.dataset.studentQuestion)));
      button.classList.toggle('is-saved', Boolean(studentAnswers[Number(button.dataset.studentQuestion)].trim()));
    });
    one('#qa-student-ordinal').textContent = String(activeStudentQuestion);
    one('#qa-student-points').textContent = String(question.points);
    one('#qa-student-prompt').textContent = question.prompt;
    one('#qa-student-answer').value = studentAnswers[activeStudentQuestion];
    one('#qa-prev-question').disabled = activeStudentQuestion === 1;
    one('#qa-next-question').disabled = activeStudentQuestion === 8;
    one('#qa-flag-question').textContent = flaggedQuestions.has(activeStudentQuestion) ? 'Remove review flag' : 'Flag for review';
    updateStudentEditorCounts();
  }

  function updateStudentEditorCounts() {
    var editor = one('#qa-student-answer');
    if (!editor) return;
    one('#qa-word-count').textContent = studentWordCount(editor.value) + ' words';
    one('#qa-character-count').textContent = Array.from(editor.value).length.toLocaleString() + ' / 20,000 characters';
  }

  function renderGradeQuestion(ordinal) {
    var question = gradingQuestions[ordinal];
    if (!question) return;
    one('#qa-grade-ordinal').textContent = String(ordinal);
    one('#qa-grade-prompt').textContent = question.prompt;
    one('#qa-grade-answer').textContent = question.answer;
    one('#qa-grade-score').value = question.score;
    one('#qa-grade-comment').value = question.comment;
    one('#qa-grade-question').value = String(ordinal);
  }

  function syncAccessCodePreview() {
    var required = Boolean(one('#qa-access-code-required')?.checked);
    var summary = one('#qa-access-summary');
    var result = one('#qa-student-code-result');
    if (summary) {
      summary.textContent = required
        ? 'Signed-in student on the class list, plus a separate Professor-issued exam access code'
        : 'Signed-in students on the class list; no separate exam access code will be issued';
    }
    if (result) {
      result.innerHTML = required
        ? '<div class="dd26-label">Required student access code</div><p class="dd26-raw-key qa-code">EVID-8K3J-7M2Q</p><small>Shown once in this synthetic publication result.</small>'
        : '<div class="dd26-label">Student entry</div><p><strong>No separate exam code issued.</strong></p><small>Each student must still sign in and be on the class list.</small>';
    }
  }

  all('[data-open-view]').forEach(function (button) {
    button.addEventListener('click', function () { showView(button.dataset.openView, true); });
  });

  one('[data-student-entry]').addEventListener('click', function () {
    openDemoDialog(
      'Student sign-in is required before the examination page opens. This local preview can continue only as a signed-in demo student.',
      { label: 'Sign in and continue (demo)', run: function () { showView('student', true); } }
    );
  });

  all('[data-state-group]').forEach(function (button) {
    button.addEventListener('click', function () { showState(button.dataset.stateGroup, button.dataset.state, true); });
    button.addEventListener('keydown', function (event) {
      tabKeyHandler(event, '[data-state-group="' + button.dataset.stateGroup + '"]', 'state');
    });
  });

  all('[data-authoring-next]').forEach(function (button) {
    button.addEventListener('click', function () { showState('authoring', button.dataset.authoringNext, true); });
  });

  all('[data-student-next]').forEach(function (button) {
    button.addEventListener('click', function () { showState('student', button.dataset.studentNext, true); });
  });

  all('[data-demo-toast]').forEach(function (button) {
    button.addEventListener('click', function () {
      openDemoDialog(button.dataset.demoToast);
      announce(button.dataset.demoToast);
    });
  });

  one('#qa-dialog-continue').addEventListener('click', function () {
    var action = dialogAction;
    dialogAction = null;
    one('#qa-dialog').close();
    if (action) action();
  });
  one('#qa-dialog-close').addEventListener('click', function () {
    dialogAction = null;
    one('#qa-dialog').close();
  });
  one('#qa-dialog').addEventListener('click', function (event) {
    if (event.target === event.currentTarget) {
      dialogAction = null;
      event.currentTarget.close();
    }
  });

  all('[data-review-question]').forEach(function (button) {
    button.addEventListener('click', function () { updateReviewQuestion(Number(button.dataset.reviewQuestion)); });
  });

  one('#qa-review-confirm').addEventListener('change', function (event) {
    one('#qa-rules-button').disabled = !event.target.checked;
    announce(event.target.checked ? 'Question review confirmed.' : 'Question review confirmation removed.');
  });

  one('#qa-question-count').addEventListener('input', function (event) {
    var value = Math.min(200, Math.max(1, Number(event.target.value) || 1));
    one('#qa-review-count').textContent = String(value);
  });

  one('#qa-publish-confirm').addEventListener('change', function (event) {
    one('#qa-publish-button').disabled = !event.target.checked;
  });

  one('#qa-access-code-required').addEventListener('change', function () {
    syncAccessCodePreview();
    announce(one('#qa-access-code-required').checked
      ? 'Separate student access code enabled in synthetic QA.'
      : 'Roster-only student entry selected in synthetic QA.');
  });

  one('#qa-publish-button').addEventListener('click', function (event) {
    one('#qa-published-result').hidden = false;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Published in synthetic QA';
    announce('Synthetic version 1 published. One-time keys are visible.');
    one('#qa-published-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  all('[data-resolve-roster]').forEach(function (button) {
    button.addEventListener('click', function () {
      var row = button.closest('tr');
      var status = one('.dd26-status', row);
      status.textContent = 'Resolved';
      status.classList.remove('qa-swatch-danger');
      status.classList.add('qa-swatch-success');
      button.textContent = 'Reviewed';
      button.disabled = true;
      announce('Synthetic roster row marked resolved.');
    });
  });

  one('#qa-student-ack').addEventListener('change', function (event) {
    one('#qa-start-exam').disabled = !event.target.checked;
  });

  one('#qa-start-exam').addEventListener('click', function () {
    showState('student', 'workspace', true);
    announce('Synthetic attempt started.');
  });

  all('[data-student-question]').forEach(function (button) {
    button.addEventListener('click', function () { renderStudentQuestion(Number(button.dataset.studentQuestion)); });
  });

  one('#qa-prev-question').addEventListener('click', function () { renderStudentQuestion(activeStudentQuestion - 1); });
  one('#qa-next-question').addEventListener('click', function () { renderStudentQuestion(activeStudentQuestion + 1); });
  one('#qa-flag-question').addEventListener('click', function () {
    if (flaggedQuestions.has(activeStudentQuestion)) flaggedQuestions.delete(activeStudentQuestion);
    else flaggedQuestions.add(activeStudentQuestion);
    renderStudentQuestion(activeStudentQuestion);
    announce(flaggedQuestions.has(activeStudentQuestion) ? 'Question flagged for review.' : 'Review flag removed.');
  });

  one('#qa-student-answer').addEventListener('input', function () {
    persistVisibleAnswer();
    updateStudentEditorCounts();
    var state = one('#qa-save-state');
    state.textContent = 'Saved locally; synchronizing…';
    state.classList.remove('is-saved');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      state.textContent = 'Saved locally and on server';
      state.classList.add('is-saved');
      announce('Answer synchronized in synthetic QA.');
    }, 650);
  });

  ['copy', 'cut', 'paste'].forEach(function (eventName) {
    one('#qa-student-answer').addEventListener(eventName, function (event) {
      event.preventDefault();
      var message = 'Copy, cut, and paste are blocked while the monitored examination is open.';
      openDemoDialog(message);
      announce(message);
    });
  });

  one('[data-simulate-reconnect]').addEventListener('click', function () {
    showState('student', 'workspace', true);
    one('#qa-save-state').textContent = 'Queued operations synchronized';
    one('#qa-save-state').classList.add('is-saved');
    announce('Synthetic connection restored; queued operations synchronized in order.');
  });

  all('[data-resolve-conflict]').forEach(function (button) {
    button.addEventListener('click', function () {
      showState('student', 'workspace', true);
      announce(button.dataset.resolveConflict === 'local' ? 'Local revision queued for retry.' : 'Server revision accepted.');
    });
  });

  one('#qa-submit-ack').addEventListener('change', function (event) {
    one('#qa-submit-button').disabled = !event.target.checked;
  });

  one('#qa-submit-button').addEventListener('click', function () {
    showState('student', 'pending', true);
    announce('Synthetic submission intent preserved; no receipt issued yet.');
  });

  one('#qa-grade-candidate').addEventListener('change', function (event) {
    one('#qa-grade-candidate-label').textContent = event.target.value;
    announce('Synthetic grading student changed to ' + event.target.value + '.');
  });

  one('#qa-grade-question').addEventListener('change', function (event) {
    renderGradeQuestion(Number(event.target.value));
  });

  one('[data-reopen-cancel]').addEventListener('click', function () {
    showState('professor-after', 'monitor', true);
  });

  one('[data-next-grade]').addEventListener('click', function () {
    var current = Number(one('#qa-grade-question').value);
    renderGradeQuestion(current === 3 ? 1 : current + 1);
    announce('Moved to the next synthetic grading item.');
  });

  showView('roles', false);
  showState('authoring', 'upload', false);
  showState('beadle', 'roster', false);
  showState('student', 'preflight', false);
  showState('professor-after', 'monitor', false);
  showState('admin', 'health', false);
  syncAccessCodePreview();
  renderStudentQuestion(1);
  renderGradeQuestion(1);
}());
