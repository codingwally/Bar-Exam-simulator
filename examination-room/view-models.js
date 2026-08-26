(function examinationRoomV1ViewModels(root, factory) {
  'use strict';

  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  if (root) root.ExaminationRoomV1ViewModels = Object.freeze(helpers);
})(typeof globalThis === 'object' ? globalThis : this, function createExaminationRoomV1ViewModels() {
  'use strict';

  function text(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value);
  }

  function questionType(value) {
    return text(value, 'essay').trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  function optionValue(option, index) {
    if (typeof option === 'string') {
      return { id: `option-${index + 1}`, label: option };
    }
    return {
      id: text(option?.id ?? option?.key ?? option?.value, `option-${index + 1}`),
      label: text(option?.label ?? option?.text ?? option?.value, `Option ${index + 1}`),
    };
  }

  function normalizeStudentQuestion(question, index = 0) {
    const source = question && typeof question === 'object' ? question : {};
    const number = Number(source.number ?? source.questionNumber ?? index + 1) || index + 1;
    const type = questionType(source.type ?? source.questionKind);
    const rawOptions = Array.isArray(source.options)
      ? source.options
      : Array.isArray(source.choices)
        ? source.choices
        : [];
    return {
      id: text(source.id ?? source.key ?? source.questionKey, `q-${number}`),
      number,
      type,
      title: text(source.title, `Question ${number}`),
      prompt: text(source.prompt),
      instructions: text(source.instructions),
      required: source.required !== false,
      maxWords: source.maxWords ?? source.wordLimit ?? null,
      maxLength: source.maxLength ?? null,
      options: type === 'multiple_choice' ? rawOptions.map(optionValue) : [],
    };
  }

  function professorAnswerLabel(question, rawAnswer) {
    if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') {
      return 'No saved answer was found for this question.';
    }
    if (Array.isArray(rawAnswer)) {
      return rawAnswer.map((answer) => professorAnswerLabel(question, answer)).join(', ');
    }
    if (questionType(question?.type ?? question?.questionKind) !== 'multiple_choice') {
      return typeof rawAnswer === 'string' ? rawAnswer : JSON.stringify(rawAnswer);
    }

    const options = (Array.isArray(question?.options)
      ? question.options
      : Array.isArray(question?.choices)
        ? question.choices
        : []).map(optionValue);
    const answerId = text(
      rawAnswer && typeof rawAnswer === 'object'
        ? rawAnswer.id ?? rawAnswer.key ?? rawAnswer.value
        : rawAnswer,
    );
    const exact = options.find((option) => option.id === answerId || option.label === answerId);
    if (exact) return exact.label;

    const numbered = /^(?:option|choice)[-_ ]?(\d+)$/i.exec(answerId);
    if (numbered) {
      const option = options[Number(numbered[1]) - 1];
      if (option) return option.label;
    }
    return answerId;
  }

  function revisionTime(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function scoreEntries(result) {
    if (Array.isArray(result?.questionResults)) return result.questionResults;
    if (Array.isArray(result?.scores)) return result.scores;
    if (Array.isArray(result?.grades)) {
      return result.grades.flatMap((grade, gradeIndex) => {
        const scores = grade?.scores ?? grade?.manifest?.scores ?? grade?.gradingManifest?.scores;
        if (!Array.isArray(scores)) return [grade];
        return scores.map((score) => ({
          ...score,
          revision: score.revision ?? grade.revision ?? gradeIndex + 1,
          gradedAt: score.gradedAt ?? grade.gradedAt ?? grade.at,
        }));
      });
    }
    if (Array.isArray(result?.gradingRevisions)) {
      return result.gradingRevisions.flatMap((grade, gradeIndex) => {
        const scores = grade?.scores ?? grade?.manifest?.scores ?? grade?.gradingManifest?.scores;
        return Array.isArray(scores)
          ? scores.map((score) => ({ ...score, revision: score.revision ?? grade.revision ?? gradeIndex + 1 }))
          : [grade];
      });
    }
    if (Array.isArray(result?.gradingRevision?.scores)) return result.gradingRevision.scores;
    if (Array.isArray(result?.grade?.scores)) return result.grade.scores;
    return [];
  }

  function buildStudentResultView(result) {
    const source = result && typeof result === 'object' ? result : {};
    const release = source.release ?? source.resultRelease ?? null;
    const released = source.released === true
      || source.status === 'released'
      || source.resultStatus === 'released'
      || Boolean(release)
      || Boolean(source.releaseId);
    const checkedAt = text(source.checkedAt ?? source.serverTime, new Date().toISOString());
    if (!released) {
      return {
        released: false,
        status: 'awaiting_grade',
        checkedAt,
        releasedAt: null,
        totalScore: null,
        totalPossible: null,
        questions: [],
      };
    }

    const examQuestions = Array.isArray(source.exam?.questions)
      ? source.exam.questions
      : Array.isArray(source.questions)
        ? source.questions
        : [];
    const questionMeta = examQuestions.map((question, index) => ({
      id: text(question?.id ?? question?.key ?? question?.questionKey, ''),
      number: Number(question?.number ?? question?.questionNumber ?? index + 1) || index + 1,
      maxPoints: Number(question?.points ?? question?.maxPoints ?? 0) || 0,
    }));
    const latest = new Map();
    scoreEntries(source).forEach((score, index) => {
      const number = Number(score?.questionNumber ?? 0) || null;
      const id = text(score?.questionId ?? score?.questionKey, '');
      const key = id || (number ? `number:${number}` : `entry:${index}`);
      const previous = latest.get(key);
      const revision = Number(score?.revision ?? index + 1) || index + 1;
      if (!previous
        || revision > previous.revision
        || (revision === previous.revision && revisionTime(score?.at ?? score?.gradedAt) >= previous.time)) {
        latest.set(key, { score, revision, time: revisionTime(score?.at ?? score?.gradedAt) });
      }
    });

    const questions = questionMeta.length
      ? questionMeta.map((question) => {
        const selected = latest.get(question.id) || latest.get(`number:${question.number}`);
        const score = selected?.score || {};
        return {
          questionId: question.id,
          questionNumber: question.number,
          pointsAwarded: Number(score.points ?? score.pointsAwarded ?? 0) || 0,
          maxPoints: Number(score.maxPoints ?? question.maxPoints ?? 0) || 0,
          feedback: text(score.feedback).trim(),
        };
      })
      : [...latest.values()].map(({ score }, index) => ({
        questionId: text(score.questionId ?? score.questionKey, ''),
        questionNumber: Number(score.questionNumber ?? index + 1) || index + 1,
        pointsAwarded: Number(score.points ?? score.pointsAwarded ?? 0) || 0,
        maxPoints: Number(score.maxPoints ?? 0) || 0,
        feedback: text(score.feedback).trim(),
      })).sort((left, right) => left.questionNumber - right.questionNumber);
    const calculatedScore = questions.reduce((total, question) => total + question.pointsAwarded, 0);
    const calculatedPossible = questions.reduce((total, question) => total + question.maxPoints, 0);
    return {
      released: true,
      status: 'released',
      checkedAt,
      releasedAt: text(
        source.releasedAt ?? release?.releasedAt ?? release?.at,
        checkedAt,
      ),
      totalScore: Number(source.totalScore ?? source.totalPointsAwarded ?? calculatedScore) || 0,
      totalPossible: Number(source.totalPossible ?? source.totalPoints ?? calculatedPossible) || 0,
      questions,
    };
  }

  return Object.freeze({
    normalizeStudentQuestion,
    professorAnswerLabel,
    buildStudentResultView,
  });
});
