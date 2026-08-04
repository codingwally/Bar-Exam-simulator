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
    r'''  const explicitlyDisclaimedTestAuthority = /\btest[-\s]?only\b/i.test(normalizedStudentAnswer)
    && /\b(?:case|citation|authority|g\.?\s*r\.?\s*(?:no\.)?)\b/i.test(normalizedStudentAnswer);
''',
    r'''  const explicitlyDisclaimedTestAuthority = /\btest[-\s]?only\b/i.test(normalizedStudentAnswer)
    && /\b(?:case|citation|authority|g\.?\s*r\.?\s*(?:no\.)?)\b/i.test(normalizedStudentAnswer);
  const studentAffirmativelyReliesOnIntentAlone = /\b(?:bad|criminal|evil|wrongful)\s+intent\s+alone\s+(?:makes?|renders?|establishes?|creates?|suffices?\s+to|is\s+sufficient\s+to)\b/i.test(normalizedStudentAnswer)
    && !/\b(?:not true that|incorrect that|wrong to say that|does not|doesn't|cannot|can't|is not|isn't|never)\b[\s\S]{0,80}\b(?:bad|criminal|evil|wrongful)\s+intent\s+alone\b/i.test(normalizedStudentAnswer);
''',
    "affirmative intent-only student rule",
)
core = replace_once(
    core,
    r'''  const centralRuleInsufficiencyFinding = /(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)[\s\S]{0,140}(?:overly simplistic|oversimplified|legally insufficient|faulty|misstat(?:ed|es)|rests? (?:only|solely)|rel(?:y|ies|ying) (?:only|solely|merely)|based (?:only|solely|purely))/i.test(examinerFindings)
    || /(?:overly simplistic|oversimplified|legally insufficient|faulty|misstat(?:ed|es))[\s\S]{0,100}(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)/i.test(examinerFindings)
    || /rel(?:y|ies|ied|ying)\s+on[\s\S]{0,140}\b(?:alone|only|solely|merely)\b[\s\S]{0,120}\b(?:instead of|rather than|without)\b/i.test(examinerFindings)
    || /(?:no correct legal basis|faulty intent-only reasoning|bad intent alone)/i.test(examinerFindings);
''',
    r'''  const centralRuleInsufficiencyFinding = /(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)[\s\S]{0,140}(?:overly simplistic|oversimplified|extremely superficial|superficial|legally insufficient|faulty|misstat(?:ed|es)|rests? (?:only|solely)|rel(?:y|ies|ying) (?:only|solely|merely)|based (?:only|solely|purely)|amounts? to mere)/i.test(examinerFindings)
    || /(?:overly simplistic|oversimplified|extremely superficial|superficial|legally insufficient|faulty|misstat(?:ed|es))[\s\S]{0,100}(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)/i.test(examinerFindings)
    || /rel(?:y|ies|ied|ying)\s+on[\s\S]{0,140}\b(?:alone|only|solely|merely)\b[\s\S]{0,120}\b(?:instead of|rather than|without)\b/i.test(examinerFindings)
    || /rel(?:y|ies|ied|ying)\s+on[\s\S]{0,80}\b(?:simplistic|superficial|mere)\b[\s\S]{0,80}\b(?:bad|criminal|evil|wrongful)\s+intent\b[\s\S]{0,120}\b(?:instead of|rather than|without)\b/i.test(examinerFindings)
    || /(?:legal\s+basis|governing\s+rule|legal\s+reasoning)[\s\S]{0,120}\b(?:mere|only|solely)\s+(?:bad|criminal|evil|wrongful)\s+intent\b[\s\S]{0,120}\b(?:instead of|rather than|without)\b/i.test(examinerFindings)
    || /(?:no correct legal basis|faulty intent-only reasoning|bad intent alone)/i.test(examinerFindings);
''',
    "semantic intent-only insufficiency findings",
)
core = replace_once(
    core,
    r'''  const materiallyWrongRuleFinding = assessment?.authorityStatus === 'materially_incorrect_or_irrelevant'
    || explicitWrongRuleFinding
    || (rubricShowsCentralRuleFailure && centralRuleInsufficiencyFinding);
''',
    r'''  const materiallyWrongRuleFinding = assessment?.authorityStatus === 'materially_incorrect_or_irrelevant'
    || explicitWrongRuleFinding
    || (rubricShowsCentralRuleFailure && (
      centralRuleInsufficiencyFinding
      || studentAffirmativelyReliesOnIntentAlone
    ));
''',
    "materially wrong rule combination",
)
CORE.write_text(core, encoding="utf-8")

test_text = TEST.read_text(encoding="utf-8")
new_tests = r'''

test('superficial mere-intent wording from the stochastic benchmark still triggers the 1.5 ceiling', () => {
  const answer = [
    'Answer: Yes. Harry is liable for an impossible crime.',
    'Legal Basis: A person who acts with bad intent is criminally liable even when no property is actually taken.',
    "Application: Harry wanted to steal Taylor's money and secretly opened her electronic wallet, showing bad intent.",
    'Conclusion: Therefore, his bad intent alone makes him liable for an impossible crime.',
  ].join('\n\n');
  const result = applyDeterministicScoreCap(assessment(3, {
    rationale: 'The student correctly concludes that Harry is liable for an impossible crime, but the legal basis is extremely superficial and amounts to mere bad intent rather than stating Article 4(2) of the Revised Penal Code or addressing factual impossibility. The application is also skeletal, lacking any connection to the electronic wallet or the inherent factual impossibility of stealing from an empty account.',
    errors: [
      'Fails to cite or explain Article 4(2) of the Revised Penal Code governing impossible crimes.',
      'Relies on a simplistic notion of "bad intent" rather than analyzing factual impossibility.',
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

test('a statement rejecting intent-only liability is not treated as affirmative reliance on intent alone', () => {
  const answer = 'No. Bad intent alone does not make a person criminally liable. The prosecution must establish every element of the offense under the controlling law.';
  const result = applyDeterministicScoreCap(assessment(2.5, {
    rationale: 'The answer correctly rejects intent-only liability but gives an incomplete statement of the governing elements.',
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
    question: 'Does bad intent alone create criminal liability?',
    suggestedAnswer: 'No. Criminal liability requires the elements of the offense or another statutory basis; intent alone is insufficient.',
    legalBasis: 'Revised Penal Code.',
    verified: true,
  });
  assert.equal(result.score, 2.5);
  assert.equal(result.appliedScoreCeiling, null);
});
'''
test_text = replace_once(
    test_text,
    "\ntest('validated results preserve the auditable rubric breakdown and weighted reference', () => {",
    new_tests + "\ntest('validated results preserve the auditable rubric breakdown and weighted reference', () => {",
    "stochastic intent-only regression coverage",
)
TEST.write_text(test_text, encoding="utf-8")

print("Applied the narrow intent-only safeguard and stochastic regression coverage.")
