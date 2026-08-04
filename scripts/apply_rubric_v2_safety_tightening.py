from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "worker" / "examiner-core.mjs"
RUBRIC_TEST = ROOT / "worker" / "rubric-v2.test.mjs"
INDEX_TEST = ROOT / "worker" / "index.test.mjs"
BENCHMARK = ROOT / "scripts" / "run-private-beta-grading-benchmark.mjs"
RUBRIC_DOC = ROOT / "docs" / "grading" / "bar-aligned-holistic-v2.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


core = CORE.read_text(encoding="utf-8")
core = replace_once(
    core,
    r'''  if (/^\s*(?:enumerate|list|name)\b/.test(question)) return 'enumeration';
  if (/^\s*(?:distinguish|differentiate|compare|contrast)\b/.test(question)) return 'distinction';
  if (/^\s*(?:define|what is meant by|give the meaning of)\b/.test(question)) return 'definition';
''',
    r'''  if (/^\s*(?:what\s+(?:is|are)\s+the\s+differences?\b|how\s+(?:does|do)\b[\s\S]{0,120}\bdiffer\b)/.test(question)) return 'distinction';
  if (/^\s*(?:distinguish|differentiate|compare|contrast)\b/.test(question)) return 'distinction';
  if (/^\s*(?:what\s+(?:are|is)\s+the\s+(?:[a-z-]+\s+){0,3}(?:elements?|requisites?|requirements?|grounds?|instances?|exceptions?|kinds?|types?|classes?|modes?|effects?|rights?|duties?)\b)/.test(question)) return 'enumeration';
  if (/^\s*(?:enumerate|list|name)\b/.test(question)) return 'enumeration';
  if (/^\s*(?:define|what is meant by|give the meaning of|what is the legal meaning of)\b/.test(question)) return 'definition';
''',
    "question-type inference",
)

core = replace_once(
    core,
    r'''  const examinerFindings = [
    assessment?.rationale,
    assessment?.legalExplanation,
    ...(Array.isArray(assessment?.errors) ? assessment.errors : []),
  ].map((value) => cleanText(value, 2_000)).filter(Boolean).join(' ');
  const unverifiedAuthorityFinding = /\b(?:unverified|not verified|could not verify|unable to verify|verification unavailable)\b/i.test(examinerFindings)
    || assessment?.authorityStatus === 'unverified';
  const confirmedFabricationFinding = assessment?.authorityStatus === 'confirmed_fabricated'
    || (!unverifiedAuthorityFinding && /(?:false|fabricated|invented|non-?existent)\s+(?:case|citation|authority)|(?:case|citation|authority)\s+(?:is\s+)?(?:false|fabricated|invented|non-?existent)/i.test(examinerFindings));
  const materiallyWrongRuleFinding = assessment?.authorityStatus === 'materially_incorrect_or_irrelevant'
    || /(?:incorrect|wrong|irrelevant|unrelated|inapplicable)\s+(?:legal\s+basis|article|section|rule|statute|doctrine|authority)|(?:legal\s+basis|article|section|rule|statute|doctrine|authority)[\s\S]{0,80}(?:incorrect|wrong|irrelevant|unrelated|inapplicable)/i.test(examinerFindings);

  if (assessment?.scoreCeilingCode === 'major_central_gap') {
''',
    r'''  const examinerErrors = (Array.isArray(assessment?.errors) ? assessment.errors : [])
    .map((value) => cleanText(value, 2_000))
    .filter(Boolean);
  const examinerFindings = [
    assessment?.rationale,
    assessment?.legalExplanation,
    ...examinerErrors,
  ].map((value) => cleanText(value, 2_000)).filter(Boolean).join(' ');
  const normalizedStudentAnswer = cleanText(studentAnswer, MAX_ANSWER_LENGTH);
  const explicitlyDisclaimedTestAuthority = /\btest[-\s]?only\b/i.test(normalizedStudentAnswer)
    && /\b(?:case|citation|authority|g\.?\s*r\.?\s*(?:no\.)?)\b/i.test(normalizedStudentAnswer);
  const unverifiedAuthorityFinding = /\b(?:unverified|not verified|could not verify|unable to verify|verification unavailable)\b/i.test(examinerFindings)
    || assessment?.authorityStatus === 'unverified';
  const confirmedFabricationFinding = explicitlyDisclaimedTestAuthority
    || assessment?.authorityStatus === 'confirmed_fabricated'
    || (!unverifiedAuthorityFinding && /(?:false|fabricated|invented|non-?existent)\s+(?:case|citation|authority)|(?:case|citation|authority)\s+(?:is\s+)?(?:false|fabricated|invented|non-?existent)/i.test(examinerFindings));
  const centralRequirementGapFinding = examinerErrors.some((finding) => (
    /(?:omit(?:ted|s)?|fail(?:ed|s)? to (?:state|mention|address|analy[sz]e|include|apply))[\s\S]{0,140}\b(?:majority|material (?:element|exception|qualification|requirement)|essential (?:element|exception|qualification|requirement)|controlling requirement|constitutional requirement|statutory requirement|procedural prerequisite|condition precedent|exception|qualification|voting threshold|outcome-determinative (?:element|exception|qualification|requirement|threshold|standard|prerequisite))\b/i.test(finding)
  ));
  const explicitWrongRuleFinding = /(?:incorrect|wrong|irrelevant|unrelated|inapplicable)\s+(?:legal\s+basis|article|section|rule|statute|doctrine|authority)|(?:legal\s+basis|article|section|rule|statute|doctrine|authority)[\s\S]{0,80}(?:incorrect|wrong|irrelevant|unrelated|inapplicable)/i.test(examinerFindings);
  const centralRuleInsufficiencyFinding = /(?:legal\s+basis|governing\s+rule|doctrine|legal\s+reasoning)[\s\S]{0,120}(?:overly simplistic|legally insufficient|faulty|misstat(?:ed|es)|rests? (?:only|solely)|rel(?:y|ies|ying) (?:only|solely|merely)|based (?:only|solely|purely))/i.test(examinerFindings)
    || /(?:no correct legal basis|faulty intent-only reasoning)/i.test(examinerFindings);
  const rubricShowsCentralRuleFailure = Number(assessment?.rubricBreakdown?.legalBasis) <= 2
    && Number(assessment?.rubricBreakdown?.application) <= 2;
  const materiallyWrongRuleFinding = assessment?.authorityStatus === 'materially_incorrect_or_irrelevant'
    || explicitWrongRuleFinding
    || (rubricShowsCentralRuleFailure && centralRuleInsufficiencyFinding);
  const effectiveAuthorityStatus = confirmedFabricationFinding
    ? 'confirmed_fabricated'
    : assessment?.authorityStatus;

  if (assessment?.scoreCeilingCode === 'major_central_gap' || centralRequirementGapFinding) {
''',
    "deterministic safety findings",
)

core = replace_once(
    core,
    r'''      performanceLabel: performanceLabelForScore(score),
      appliedScoreCeiling,
''',
    r'''      performanceLabel: performanceLabelForScore(score),
      authorityStatus: effectiveAuthorityStatus,
      appliedScoreCeiling,
''',
    "unchanged-score authority status",
)
core = replace_once(
    core,
    r'''    performanceLabel: performanceLabelForScore(score),
    errors,
    appliedScoreCeiling,
''',
    r'''    performanceLabel: performanceLabelForScore(score),
    authorityStatus: effectiveAuthorityStatus,
    errors,
    appliedScoreCeiling,
''',
    "changed-score authority status",
)

core = replace_once(
    core,
    r'''- Recognize legally defensible alternative answers when supported by controlling law. Do not require word-for-word alignment with the stored suggested answer.

PERFORMANCE BANDS:
''',
    r'''- Recognize legally defensible alternative answers when supported by controlling law. Do not require word-for-word alignment with the stored suggested answer.
- Distinguish citation precision from substantive completeness. Exact references are optional, but essential elements, exceptions, qualifications, voting thresholds, standards, and procedural prerequisites are legal substance.
- A correct conclusion reached only through a materially wrong or legally insufficient governing rule does not earn substantial credit.

PERFORMANCE BANDS:
''',
    "prompt substance safeguards",
)
core = replace_once(
    core,
    r'''- Use authorityStatus="confirmed_fabricated" only when reliable evidence establishes that the asserted authority is invented or nonexistent. Then use scoreCeilingCode="confirmed_fabricated_authority".
- Use authorityStatus="materially_incorrect_or_irrelevant" and scoreCeilingCode="materially_wrong_rule" only when the answer depends on a materially wrong or irrelevant governing rule.
''',
    r'''- Use authorityStatus="confirmed_fabricated" only when reliable evidence establishes that the asserted authority is invented or nonexistent. Then use scoreCeilingCode="confirmed_fabricated_authority".
- If the student expressly invokes an authority while identifying it as test-only, fabricated, invented, or nonexistent, that self-disclaimer is reliable confirmation; do not downgrade it to minor imprecision.
- Use authorityStatus="materially_incorrect_or_irrelevant" and scoreCeilingCode="materially_wrong_rule" when the answer depends on a materially wrong or irrelevant governing rule, even when the ultimate conclusion happens to be correct.
''',
    "prompt authority safeguards",
)
core = replace_once(
    core,
    r'''- Use scoreCeilingCode="major_central_gap" only when a central issue or controlling legal point is materially omitted or incorrect but meaningful legal analysis remains; maximum 3.5.
''',
    r'''- Use scoreCeilingCode="major_central_gap" when a central issue or controlling legal point is materially omitted or incorrect but meaningful legal analysis remains; maximum 3.5. This includes omission of an outcome-determinative element, exception, qualification, majority-vote requirement, threshold, standard, or procedural prerequisite.
''',
    "prompt central-gap safeguard",
)
core = replace_once(
    core,
    r'''3. Assess the four components using the indicative weights.
4. Select the holistic performance band and final score based on legal merit, not literal arithmetic alone.
5. Classify authority reliability and select a narrow scoreCeilingCode, ordinarily "none".
6. Return rubricBreakdown scores from 0.0 to 5.0 for responsiveness, legalBasis, application, and conclusion. These explain the holistic judgment; they do not replace it.
''',
    r'''3. Assess the four components using the indicative weights.
4. Compare the student's stated rule with the stored controlling legal basis. Do not treat a broad principle as complete when the stored key shows that a specific element, exception, qualification, voting threshold, standard, or prerequisite decides the result.
5. Select the holistic performance band and final score based on legal merit, not literal arithmetic alone.
6. Classify authority reliability and select a narrow scoreCeilingCode, ordinarily "none".
7. Return rubricBreakdown scores from 0.0 to 5.0 for responsiveness, legalBasis, application, and conclusion. These explain the holistic judgment; they do not replace it.
''',
    "prompt scoring process",
)
CORE.write_text(core, encoding="utf-8")

index_test = INDEX_TEST.read_text(encoding="utf-8")
index_test = replace_once(index_test, "} );\n\n", "});\n\n", "test formatting")
INDEX_TEST.write_text(index_test, encoding="utf-8")

rubric_test = RUBRIC_TEST.read_text(encoding="utf-8")
rubric_test = replace_once(
    rubric_test,
    "  assert.match(prompt, /legally defensible alternative answers/i);\n",
    "  assert.match(prompt, /legally defensible alternative answers/i);\n"
    "  assert.match(prompt, /essential elements, exceptions, qualifications, voting thresholds/i);\n"
    "  assert.match(prompt, /correct conclusion reached only through a materially wrong/i);\n"
    "  assert.match(prompt, /self-disclaimer is reliable confirmation/i);\n",
    "prompt assertions",
)
additional_tests = r'''

test('common distinction and enumeration phrasing does not invent factual application', () => {
  const distinction = { question: 'What is the difference between mala in se and mala prohibita?' };
  const enumeration = { question: 'What are the essential elements of a valid contract?' };
  assert.equal(inferQuestionType(distinction), 'distinction');
  assert.equal(applicationRequiredForQuestion(distinction), false);
  assert.equal(inferQuestionType(enumeration), 'enumeration');
  assert.equal(applicationRequiredForQuestion(enumeration), false);
});

test('an expressly test-only nonexistent authority is deterministically treated as confirmed fabrication', () => {
  const answer = 'No. Double insurance requires the same insured person, subject, interest, and risk. The same rule was supposedly announced in the explicitly test-only and nonexistent case of Santos v. Omega Assurance, G.R. No. TEST-ONLY-000. Here, the insured interests differ. Therefore, there is no double insurance.';
  const result = applyDeterministicScoreCap(assessment(4.5, {
    authorityStatus: 'minor_imprecision',
    scoreCeilingCode: 'none',
    errors: ['The answer includes an unverified or nonexistent test-case citation.'],
  }), answer, {
    question: 'Do the two policies constitute double insurance?',
    suggestedAnswer: 'No. Double insurance requires identity of the insured person, subject matter, interest, and risk. The insured interests differ.',
    legalBasis: 'Insurance Code, Section 95.',
    verified: true,
  });
  assert.equal(result.score, 2.5);
  assert.equal(result.authorityStatus, 'confirmed_fabricated');
  assert.equal(result.appliedScoreCeiling.code, 'confirmed_fabricated_authority');
});

test('an omitted outcome-determinative majority requirement triggers the 3.5 central-gap ceiling', () => {
  const answer = 'No. Congress, not the President acting alone, grants tax exemptions. The President issued the exemption by proclamation, so the proclamation is unconstitutional.';
  const result = applyDeterministicScoreCap(assessment(4.5, {
    errors: ['Failed to mention the requirement for a majority of all members of Congress for tax exemption laws.'],
  }), answer, {
    question: 'May the President grant tax exemptions through a proclamation supported only by a congressional resolution?',
    suggestedAnswer: 'No. A tax exemption law requires the concurrence of a majority of all members of Congress, and a presidential proclamation cannot substitute for that law.',
    legalBasis: '1987 Constitution, Article VI, Section 28(4).',
    verified: true,
  });
  assert.equal(result.score, 3.5);
  assert.equal(result.appliedScoreCeiling.code, 'major_central_gap');
});

test('a correct conclusion resting solely on a legally insufficient central rule is capped at 1.5', () => {
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
rubric_test = replace_once(
    rubric_test,
    "\ntest('validated results preserve the auditable rubric breakdown and weighted reference', () => {",
    additional_tests + "\ntest('validated results preserve the auditable rubric breakdown and weighted reference', () => {",
    "focused safety tests",
)
RUBRIC_TEST.write_text(rubric_test, encoding="utf-8")

benchmark = BENCHMARK.read_text(encoding="utf-8")
benchmark = replace_once(
    benchmark,
    "const MAX_PROVIDER_ATTEMPTS = 2;",
    "const MAX_PROVIDER_ATTEMPTS = 3;",
    "benchmark provider attempts",
)
BENCHMARK.write_text(benchmark, encoding="utf-8")

rubric_doc = RUBRIC_DOC.read_text(encoding="utf-8")
rubric_doc = replace_once(
    rubric_doc,
    "Exact article, section, case, or docket citations are not required when the controlling doctrine is accurately stated and meaningfully applied. A generic phrase such as “under the law” is insufficient unless the governing rule is actually stated. An unverified authority is not deemed fabricated. Only a confirmed fabricated authority receives the 2.5 ceiling.\n",
    "Exact article, section, case, or docket citations are not required when the controlling doctrine is accurately stated and meaningfully applied. Essential elements, exceptions, qualifications, voting thresholds, standards, and procedural prerequisites remain substantive requirements. A generic phrase such as “under the law” is insufficient unless the governing rule is actually stated. An unverified authority is not deemed fabricated. An authority expressly invoked while identified by the student as test-only, fabricated, invented, or nonexistent is treated as confirmed fabrication. Only confirmed fabrication receives the 2.5 ceiling.\n",
    "rubric citation policy",
)
rubric_doc = replace_once(
    rubric_doc,
    "- Materially wrong central governing rule: 1.5\n",
    "- Materially wrong or legally insufficient central governing rule, even when the conclusion happens to be correct: 1.5\n",
    "rubric wrong-rule ceiling",
)
RUBRIC_DOC.write_text(rubric_doc, encoding="utf-8")

print("Applied rubric v2 safety tightening and benchmark retry hardening.")
