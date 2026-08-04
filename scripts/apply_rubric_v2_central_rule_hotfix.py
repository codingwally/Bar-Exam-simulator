from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "worker" / "examiner-core.mjs"
TEST = ROOT / "worker" / "rubric-v2.test.mjs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


core = CORE.read_text(encoding="utf-8")
core = replace_once(
    core,
    r'''  const explicitWrongRuleFinding = /(?:incorrect|wrong|irrelevant|unrelated|inapplicable)\s+(?:legal\s+basis|article|section|rule|statute|doctrine|authority)|(?:legal\s+basis|article|section|rule|statute|doctrine|authority)[\s\S]{0,80}(?:incorrect|wrong|irrelevant|unrelated|inapplicable)/i.test(examinerFindings);
''',
    r'''  const explicitWrongRuleFinding = [
    cleanText(assessment?.rationale, 2_000),
    ...examinerErrors,
  ].filter(Boolean).some((finding) => {
    const statesWrongRule = /(?:incorrect|wrong|irrelevant|unrelated|inapplicable)\s+(?:legal\s+basis|article|section|rule|statute|doctrine|authority)|(?:legal\s+basis|article|section|rule|statute|doctrine|authority)[\s\S]{0,80}(?:incorrect|wrong|irrelevant|unrelated|inapplicable)/i.test(finding);
    const negatesWrongRule = /\b(?:not|no|isn't|is not|wasn't|was not|doesn't|does not|didn't|did not)\s+(?!only\b)(?:materially\s+)?(?:incorrect|wrong|irrelevant|unrelated|inapplicable)\b/i.test(finding);
    return statesWrongRule && !negatesWrongRule;
  });
''',
    "negation-aware explicit wrong-rule detector",
)
core = replace_once(
    core,
    r'''  const centralRuleInsufficiencyFinding = /(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)[\s\S]{0,120}(?:overly simplistic|legally insufficient|faulty|misstat(?:ed|es)|rests? (?:only|solely)|rel(?:y|ies|ying) (?:only|solely|merely)|based (?:only|solely|purely))/i.test(examinerFindings)
    || /(?:no correct legal basis|faulty intent-only reasoning)/i.test(examinerFindings);
  const rubricShowsCentralRuleFailure = Number(assessment?.rubricBreakdown?.legalBasis) <= 2
    && Number(assessment?.rubricBreakdown?.application) <= 2;
''',
    r'''  const centralRuleInsufficiencyFinding = /(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)[\s\S]{0,140}(?:overly simplistic|oversimplified|legally insufficient|faulty|misstat(?:ed|es)|rests? (?:only|solely)|rel(?:y|ies|ying) (?:only|solely|merely)|based (?:only|solely|purely))/i.test(examinerFindings)
    || /(?:overly simplistic|oversimplified|legally insufficient|faulty|misstat(?:ed|es))[\s\S]{0,100}(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)/i.test(examinerFindings)
    || /rel(?:y|ies|ied|ying)\s+on[\s\S]{0,140}\b(?:alone|only|solely|merely)\b[\s\S]{0,120}\b(?:instead of|rather than|without)\b/i.test(examinerFindings)
    || /(?:no correct legal basis|faulty intent-only reasoning|bad intent alone)/i.test(examinerFindings);
  const rubricShowsCentralRuleFailure = Number(assessment?.rubricBreakdown?.legalBasis) <= 2.5
    && Number(assessment?.rubricBreakdown?.application) <= 2.5;
''',
    "central-rule detector and threshold",
)
CORE.write_text(core, encoding="utf-8")

test_text = TEST.read_text(encoding="utf-8")
old_test = r'''test('a correct conclusion resting solely on a legally insufficient central rule is capped at 1.5', () => {
  const answer = 'Yes. A person with bad intent is criminally liable even when no property is taken. Harry wanted to steal money and opened the wallet, so bad intent alone makes him liable for an impossible crime.';
  const result = applyDeterministicScoreCap(assessment(3, {
    rationale: 'The legal basis is overly simplistic, relying merely on bad intent rather than the controlling elements of an impossible crime.',
    errors: ['The answer uses faulty intent-only reasoning.'],
    rubricBreakdown: {
      responsiveness: 5,
      legalBasis: 2,
      application: 2,
      conclusion: 4,
      questionType: 'problem',
      applicationRequired: true,
    },
  }), answer, {
    question: 'Is Harry liable for an impossible crime after opening an empty electronic wallet intending to steal?',
    suggestedAnswer: 'Yes. The intended offense against property failed because accomplishment was inherently impossible, and the means were inadequate or ineffectual.',
    legalBasis: 'Revised Penal Code, Article 4(2).',
    verified: true,
  });
  assert.equal(result.score, 1.5);
  assert.equal(result.appliedScoreCeiling.code, 'materially_wrong_rule');
});
'''
new_test = r'''test('a correct conclusion resting solely on a legally insufficient central rule is capped at 1.5', () => {
  const answer = 'Yes. A person with bad intent is criminally liable even when no property is taken. Harry wanted to steal money and opened the wallet, so bad intent alone makes him liable for an impossible crime.';
  const result = applyDeterministicScoreCap(assessment(3, {
    rationale: "The student correctly answers 'Yes' but provides an oversimplified legal basis ('bad intent alone') without addressing the controlling elements of an impossible crime.",
    errors: [
      "Relies on 'bad intent alone' as the legal basis instead of legal impossibility or Article 4(2) of the RPC.",
      'Omits the core doctrine of factual impossibility where accomplishment is inherently impossible.',
    ],
    rubricBreakdown: {
      responsiveness: 5,
      legalBasis: 2,
      application: 2.5,
      conclusion: 4,
      questionType: 'problem',
      applicationRequired: true,
    },
  }), answer, {
    question: 'Is Harry liable for an impossible crime after opening an empty electronic wallet intending to steal?',
    suggestedAnswer: 'Yes. The intended offense against property failed because accomplishment was inherently impossible, and the means were inadequate or ineffectual.',
    legalBasis: 'Revised Penal Code, Article 4(2).',
    verified: true,
  });
  assert.equal(result.score, 1.5);
  assert.equal(result.appliedScoreCeiling.code, 'materially_wrong_rule');
});

test('low component scores alone do not create a central-rule ceiling without an explicit substantive finding', () => {
  const answer = 'Yes. An impossible crime may arise where the intended offense cannot be accomplished. The wallet was empty, so no money could be taken.';
  const result = applyDeterministicScoreCap(assessment(2.5, {
    rationale: 'The answer identifies the doctrine but would benefit from a more complete statement of its elements.',
    errors: ['The rule is incomplete but not materially wrong.'],
    rubricBreakdown: {
      responsiveness: 4,
      legalBasis: 2.5,
      application: 2.5,
      conclusion: 3,
      questionType: 'problem',
      applicationRequired: true,
    },
  }), answer, {
    question: 'Is Harry liable for an impossible crime after opening an empty electronic wallet intending to steal?',
    suggestedAnswer: 'Yes. The intended offense against property failed because accomplishment was inherently impossible, and the means were inadequate or ineffectual.',
    legalBasis: 'Revised Penal Code, Article 4(2).',
    verified: true,
  });
  assert.equal(result.score, 2.5);
  assert.equal(result.appliedScoreCeiling, null);
});
'''
test_text = replace_once(test_text, old_test, new_test, "central-rule regression test")
TEST.write_text(test_text, encoding="utf-8")

print("Applied the rubric-v2 central-rule hotfix and exact stochastic-failure regression coverage.")
