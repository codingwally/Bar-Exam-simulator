import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const FORECAST_URL = new URL('content/duediligence-2026/bar-forecast.json', ROOT);
const UNITS_URL = new URL('content/duediligence-2026/syllabus-units.json', ROOT);
const QUESTION_BANK_URL = new URL('content/question-bank/website-upload.json', ROOT);
const MANIFEST_URL = new URL('content/question-bank/verbatim-source-manifest.json', ROOT);
const DOCTRINES_URL = new URL('content/duediligence-2026/doctrines.json', ROOT);
const ANCHORS_URL = new URL('content/duediligence-2026/anchor-cases.json', ROOT);

const SYLLABUS_URL = 'https://sc.judiciary.gov.ph/wp-content/uploads/2025/10/2026-BAR-Bar-Bulletin-No.-1-October-16-2025.pdf';
const LEB_URL = 'https://leb.gov.ph/wp-content/uploads/2021/07/LEBMO-No.-24.pdf';
const CUTOFF = '2025-06-30';
const REVISION_DATE = '2026-09-02';
const SOURCE_VERSION = '2026.3';
const EDITORIAL_STANDARD = '2025_BAR_ONE_QUESTION_ONE_DOCTRINE_ALAC_YES_NO_REASONED_CONCLUSION';
const OFFICIAL_SOURCE_HOSTS = new Set([
  'elibrary.judiciary.gov.ph',
  'sc.judiciary.gov.ph',
  'www.un.org',
  'un.org',
  'bir-cdn.bir.gov.ph',
  'bir.gov.ph',
  'www.bir.gov.ph',
]);
const USER_UPLOAD_SOURCE_HOSTS = new Set([
  'www.scribd.com',
  'scribd.com',
  'www.studocu.com',
  'studocu.com',
  'www.facebook.com',
  'facebook.com',
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
]);
const CONSTITUTION_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/3/353';
const CIVIL_CODE_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/53360';
const FAMILY_CODE_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/5/95173';
const CORPORATION_CODE_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/86463';
const INSURANCE_CODE_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/58852';
const LABOR_CODE_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/26/25306';
const RPC_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/28/20426';
const RULES_ELIB = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/11/369';
const AUTHORITY_DATE_OVERRIDES = Object.freeze({
  'bp26-lab-q204': '2019-02-07',
  'bp26-rem-practical-verification': '2019-10-15',
  'bp26-rem-practical-information': '2000-12-01',
});
const SYLLABUS_UNIT_OVERRIDES = Object.freeze({
  // Classify by the doctrine actually tested: drug-sale entrapment is a
  // special-law application, while absorption is expressly a Book I concept.
  'bp26-crim-q273': 'CRIM-III',
  'bp26-crim-q289': 'CRIM-II',
});

const SUBJECTS = Object.freeze([
  'Political and Public International Law',
  'Commercial and Taxation Laws',
  'Civil Law and Land Titles and Deeds',
  'Labor Law and Social Legislation',
  'Criminal Law',
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises',
]);

const SUBJECT_BASE = Object.freeze(Object.fromEntries(SUBJECTS.map((subject, index) => [subject, index * 20])));
const EDITORIAL_PREFIX = Object.freeze({
  [SUBJECTS[0]]: 'POL',
  [SUBJECTS[1]]: 'COM-TAX',
  [SUBJECTS[2]]: 'CIV',
  [SUBJECTS[3]]: 'LAB',
  [SUBJECTS[4]]: 'CRIM',
  [SUBJECTS[5]]: 'REM-ETH',
});

// The arrays correspond to the reviewed 2026.3 source ranks before this revision.
// Once written, each row retains its syllabus_unit_id across deterministic reruns.
const INITIAL_UNIT_ASSIGNMENTS = Object.freeze({
  [SUBJECTS[0]]: Object.freeze([
    'POL-II', 'POL-XII', 'POL-III', 'POL-VII', 'POL-VIII',
    'POL-XIII', 'POL-IX', 'POL-XI', 'POL-VI', 'POL-V',
    'POL-VIII', 'POL-XIII', 'POL-XIV', 'POL-XIV', 'POL-IV',
    'POL-VIII', 'POL-I', 'POL-XIV', 'POL-X', 'POL-V',
  ]),
  [SUBJECTS[1]]: Object.freeze([
    'COM-IV', 'COM-I', 'COM-VIII', 'COM-V', 'COM-VIII',
    'COM-VIII', 'COM-I', 'COM-VIII', 'COM-II', 'COM-VIII',
    'COM-VIII', 'COM-IV', 'COM-VIII', 'COM-VIII', 'COM-VIII',
    'COM-VI', 'COM-III', 'COM-I', 'COM-VI', 'COM-I',
  ]),
  [SUBJECTS[2]]: Object.freeze([
    'CIV-VIII', 'CIV-IX', 'CIV-II', 'CIV-VI', 'CIV-V',
    'CIV-III', 'CIV-III', 'CIV-IV', 'CIV-V', 'CIV-VII',
    'CIV-VIII', 'CIV-I', 'CIV-XI', 'CIV-IX', 'CIV-VI',
    'CIV-VII', 'CIV-VII', 'CIV-X', 'CIV-VIII', 'CIV-XII',
  ]),
  [SUBJECTS[3]]: Object.freeze([
    'LAB-IV', 'LAB-V', 'LAB-VI', 'LAB-VII', 'LAB-VI',
    'LAB-VI', 'LAB-III', 'LAB-II', 'LAB-V', 'LAB-VI',
    'LAB-II', 'LAB-IV', 'LAB-III', 'LAB-VIII', 'LAB-I',
    'LAB-IV', 'LAB-V', 'LAB-VII', 'LAB-V', 'LAB-VIII',
  ]),
  [SUBJECTS[4]]: Object.freeze([
    'CRIM-III', 'CRIM-III', 'CRIM-III', 'CRIM-III', 'CRIM-II',
    'CRIM-II', 'CRIM-III', 'CRIM-II', 'CRIM-I', 'CRIM-I',
    'CRIM-II', 'CRIM-III', 'CRIM-III', 'CRIM-II', 'CRIM-III',
    'CRIM-III', 'CRIM-III', 'CRIM-II', 'CRIM-II', 'CRIM-III',
  ]),
  [SUBJECTS[5]]: Object.freeze([
    'REM-III', 'REM-III', 'REM-VII', 'REM-VII', 'REM-IX',
    'REM-I', 'REM-IX', 'REM-V', 'REM-IV', 'REM-VIII',
    'REM-VI', 'REM-VI', 'REM-III', 'REM-VII', 'REM-X',
    'REM-IX', 'REM-VIII', 'REM-VIII', 'REM-II', 'REM-X',
  ]),
});

const DEFAULT_ELIB_BY_SUBJECT = Object.freeze({
  [SUBJECTS[0]]: CONSTITUTION_ELIB,
  [SUBJECTS[1]]: CORPORATION_CODE_ELIB,
  [SUBJECTS[2]]: CIVIL_CODE_ELIB,
  [SUBJECTS[3]]: LABOR_CODE_ELIB,
  [SUBJECTS[4]]: RPC_ELIB,
  [SUBJECTS[5]]: RULES_ELIB,
});

const DEFAULT_ELIB_BY_UNIT = Object.freeze({
  'COM-II': INSURANCE_CODE_ELIB,
  'CIV-II': FAMILY_CODE_ELIB,
  'CIV-III': FAMILY_CODE_ELIB,
  'CIV-IV': FAMILY_CODE_ELIB,
  'REM-IX': 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69271',
});

function urlsFrom(value) {
  return String(value ?? '').match(/https:\/\/[^\s)\]}>,]+/gu)?.map((url) => url.replace(/[.,;:]$/u, '')) || [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstElibraryUrl(...values) {
  return unique(values.flatMap(urlsFrom)).find((url) => /^https:\/\/elibrary\.judiciary\.gov\.ph\//iu.test(url)) || '';
}

function sourceHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.hostname.toLowerCase()
      : '';
  } catch {
    return '';
  }
}

function isOfficialSourceUrl(value) {
  return OFFICIAL_SOURCE_HOSTS.has(sourceHost(value));
}

function isApprovedLegalBasisSourceUrl(value) {
  const url = String(value ?? '').trim();
  if (/^https:\/\/elibrary\.judiciary\.gov\.ph\//iu.test(url)) return true;
  return /^https:\/\/(?:www\.)?un\.org\/depts\/los\/convention_agreements\/texts\/unclos\/part12\.htm$/iu.test(url);
}

function isUserUploadSourceUrl(value) {
  return USER_UPLOAD_SOURCE_HOSTS.has(sourceHost(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function slug(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
}

function lowerInitial(value) {
  const text = String(value ?? '').trim();
  return text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

function reasonedConclusion(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/^(?:therefore|thus|hence|wherefore)\s*,?\s*/iu, '');
  return `Thus, ${lowerInitial(cleaned)}`;
}

function parseAlac(answer) {
  const normalized = String(answer ?? '').replace(/\r/gu, '').trim();
  const match = normalized.match(
    /^\s*Answer\s*:\s*([\s\S]*?)\n+\s*Legal Basis\s*:\s*([\s\S]*?)\n+\s*Application\s*:\s*([\s\S]*?)\n+\s*Conclusion\s*:\s*([\s\S]*?)\s*$/iu,
  );
  if (!match) throw new Error('A replacement source lacks a parseable ALAC answer.');
  return { answer: match[1].trim(), legalBasis: match[2].trim(), application: match[3].trim(), conclusion: match[4].trim() };
}

function normalizedAlac({ sourceAnswer, answerLead, legalBasis, application, conclusion }) {
  if (!/^(?:Yes|No)\./u.test(answerLead)) throw new Error(`Answer lead must begin Yes or No: ${answerLead}`);
  const parsed = parseAlac(sourceAnswer);
  return [
    `Answer: ${answerLead}`,
    `Legal Basis: ${legalBasis || parsed.legalBasis}`,
    `Application: ${application || parsed.application}`,
    `Conclusion: ${reasonedConclusion(conclusion || parsed.conclusion)}`,
  ].join('\n\n');
}

function citationDate(citation) {
  const monthFirst = [...String(citation ?? '').matchAll(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(19\d{2}|20\d{2})/giu,
  )].map((match) => `${match[1]} ${match[2]}, ${match[3]}`);
  const dayFirst = [...String(citation ?? '').matchAll(
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(19\d{2}|20\d{2})/giu,
  )].map((match) => `${match[2]} ${match[1]}, ${match[3]}`);
  const dates = [...monthFirst, ...dayFirst].map((value) => {
    const parsed = new Date(`${value} UTC`);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }).filter(Boolean).filter((date) => date <= new Date(`${CUTOFF}T23:59:59Z`));
  if (!dates.length) return null;
  const latest = new Date(Math.max(...dates.map(Number)));
  return latest.toISOString().slice(0, 10);
}

function rowSourceLinks(record) {
  return unique([
    ...urlsFrom(record['Legal Basis / Provision']),
    ...urlsFrom(record['Source URL']),
    SYLLABUS_URL,
  ]);
}

function bankReplacement(record, overrides) {
  if (!record) throw new Error(`Missing Q&A replacement ${overrides.sourceQuestionId}.`);
  const links = overrides.sourceLinks
    ? unique([...overrides.sourceLinks, SYLLABUS_URL])
    : rowSourceLinks(record);
  const elibrary = overrides.primarySourceUrl
    || firstElibraryUrl(record['Legal Basis / Provision'], record['Source URL']);
  if (!elibrary) throw new Error(`${record['Question ID']}: replacement lacks an E-Library source.`);
  const suggestedAnswer = normalizedAlac({
    sourceAnswer: record['Suggested Answer'],
    answerLead: overrides.answerLead,
    legalBasis: overrides.legalBasis,
    application: overrides.application,
    conclusion: overrides.conclusion,
  });
  const parsed = parseAlac(suggestedAnswer);
  const citation = overrides.citation || record['Citation / G.R. No.'].trim();
  const authorityDate = overrides.authorityDate || citationDate(citation);
  return {
    title: overrides.title,
    prompt: overrides.prompt,
    suggested_answer: suggestedAnswer,
    legal_basis: parsed.legalBasis,
    controlling_doctrine: overrides.controllingDoctrine || record['Controlling Doctrine'].trim(),
    jurisprudence: overrides.jurisprudence || record['Jurisprudence / Case'].trim(),
    citation,
    difficulty: overrides.difficulty || record.Difficulty || 'Intermediate',
    question_origin: /^DDQB-2026-/u.test(record['Question ID'])
      ? 'ORIGINAL_ALAC_PRACTICE_FROM_DD_BANK'
      : 'TRANSFORMED_OFFICIAL_FREQUENCY_DRILL',
    source_question_id: record['Question ID'],
    source_editorial_status: record['Editorial Status'],
    source_publication_ready: record['Publication Ready?'],
    source_last_reviewed: record['Last Reviewed'] || REVISION_DATE,
    source_editorial_note: record.Notes,
    primary_source_url: elibrary,
    legal_basis_source_url: overrides.legalBasisSourceUrl || elibrary,
    primary_source_tier: overrides.primarySourceTier || 'OFFICIAL_SUPREME_COURT',
    source_links: links,
    authority_year: authorityDate ? Number(authorityDate.slice(0, 4)) : null,
    authority_date: authorityDate,
    syllabus_leaf: overrides.syllabusLeaf,
    doctrine_id: overrides.doctrineId || null,
    anchor_case_id: overrides.anchorCaseId || null,
    query_terms: overrides.queryTerms,
  };
}

function manualReplacement(overrides) {
  const sourceLinks = unique([...overrides.sourceLinks, overrides.legalBasisSourceUrl, SYLLABUS_URL]);
  return {
    title: overrides.title,
    prompt: overrides.prompt,
    suggested_answer: [
      `Answer: ${overrides.answerLead}`,
      `Legal Basis: ${overrides.legalBasis}`,
      `Application: ${overrides.application}`,
      `Conclusion: ${reasonedConclusion(overrides.conclusion)}`,
    ].join('\n\n'),
    legal_basis: overrides.legalBasis,
    controlling_doctrine: overrides.controllingDoctrine,
    jurisprudence: overrides.jurisprudence,
    citation: overrides.citation,
    difficulty: overrides.difficulty || 'Intermediate',
    question_origin: 'ORIGINAL_SYLLABUS_PREDICTION',
    source_question_id: null,
    source_editorial_status: 'Approved',
    source_publication_ready: 'Yes',
    source_last_reviewed: REVISION_DATE,
    source_editorial_note: 'Approved for verification; not yet verified. Original syllabus-balanced prediction item; AI-prepared beta requiring continuing owner and legal-editorial review.',
    primary_source_url: overrides.primarySourceUrl,
    legal_basis_source_url: overrides.legalBasisSourceUrl,
    primary_source_tier: overrides.primarySourceTier || 'OFFICIAL_SUPREME_COURT',
    source_links: sourceLinks,
    authority_year: Number(overrides.authorityDate.slice(0, 4)),
    authority_date: overrides.authorityDate,
    syllabus_leaf: overrides.syllabusLeaf,
    doctrine_id: overrides.doctrineId || null,
    anchor_case_id: overrides.anchorCaseId || null,
    query_terms: overrides.queryTerms,
    educator_signal: overrides.educatorSignal || null,
  };
}

function replacementSpecs(bankById) {
  const fromBank = (sourceQuestionId, overrides) => bankReplacement(
    bankById.get(sourceQuestionId),
    { ...overrides, sourceQuestionId },
  );
  return new Map(Object.entries({
    'bp26-pol-chair-03': manualReplacement({
      title: 'Coastal-State Enforcement Against Dumping in the EEZ',
      prompt: 'A foreign vessel is caught dumping toxic hospital waste twenty nautical miles from Palawan. Its officers argue that the Philippines has no enforcement authority merely because the ship was beyond the twelve-nautical-mile territorial sea. Does that location alone immunize the dumping from lawful Philippine enforcement?',
      answerLead: 'No. The location alone does not immunize dumping within the Philippine exclusive economic zone.',
      legalBasis: 'UNCLOS Articles 210(5) and 216(1)(a) recognize the coastal State\'s right to permit, regulate, control, and enforce applicable laws against dumping within its territorial sea, exclusive economic zone, or continental shelf. Article 33 is not the source of punishment for dumping at twenty nautical miles; enforcement must rest on UNCLOS Part XII, applicable international standards, and Philippine implementing law.',
      application: 'Twenty nautical miles is beyond the territorial sea but remains within the Philippine exclusive economic zone. Philippine authorities may therefore enforce valid anti-dumping measures under the Part XII framework, although they must identify and comply with the applicable domestic law and UNCLOS safeguards rather than rely on contiguous-zone jurisdiction alone.',
      conclusion: 'the vessel\'s position beyond twelve nautical miles does not by itself defeat lawful Philippine enforcement against the dumping.',
      controllingDoctrine: 'Dumping within a coastal State\'s exclusive economic zone is governed by UNCLOS Part XII: the coastal State may regulate and enforce applicable anti-dumping laws there, but Article 33 alone is not a general grant of criminal jurisdiction over environmental offenses.',
      jurisprudence: 'Magallona v. Ermita; United Nations Convention on the Law of the Sea',
      citation: 'G.R. No. 187167, August 16, 2011; UNCLOS, Articles 210 and 216',
      authorityDate: '2011-08-16',
      primarySourceUrl: 'https://www.un.org/depts/los/convention_agreements/texts/unclos/part12.htm',
      legalBasisSourceUrl: 'https://www.un.org/depts/los/convention_agreements/texts/unclos/part12.htm',
      primarySourceTier: 'OFFICIAL_UN_TREATY_TEXT',
      sourceLinks: [
        'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/29267',
        'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/23187',
      ],
      syllabusLeaf: 'Maritime zones and coastal-State enforcement against marine dumping',
      doctrineId: 'DOC-POL-004',
      anchorCaseId: 'AC26-POL-10',
      queryTerms: ['law of the sea', 'exclusive economic zone', 'marine pollution dumping'],
    }),
    'bp26-pol-chair-01': fromBank('POLI-2024-Q05', {
      title: 'Naturalization of a Recognized Refugee Without Reciprocity',
      prompt: 'Nadir, a recognized refugee, has lived in the Philippines for twelve years and possesses every statutory qualification for naturalization. His country of origin does not grant reciprocal naturalization rights to Filipinos. Does the absence of reciprocity automatically bar Nadir\'s petition?',
      answerLead: 'No. Reciprocity does not automatically bar a qualified recognized refugee.',
      application: 'Nadir is a recognized refugee and has been found otherwise qualified. Requiring reciprocity from the State from which he fled would defeat the facilitated protective framework.',
      conclusion: 'the lack of reciprocity does not bar Nadir\'s naturalization petition.',
      syllabusLeaf: 'Naturalization of refugees and reciprocity',
      queryTerms: ['citizenship', 'naturalization', 'refugee reciprocity'],
    }),
    'bp26-pol-chair-05': fromBank('POLI-2023-Q06', {
      title: 'CSC Discipline for Civil-Service Examination Impersonation',
      prompt: 'A police applicant arranges for another person to take a promotional examination in his name. He argues that Republic Act No. 8551 transferred police-examination administration to NAPOLCOM and therefore removed all CSC authority over the fraud. Did that transfer divest the CSC of disciplinary jurisdiction over the civil-service examination anomaly?',
      answerLead: 'No. The transfer did not remove the CSC\'s disciplinary authority over civil-service examination fraud.',
      application: 'NAPOLCOM may administer the police examination, but impersonation and dishonesty remain civil-service offenses within the CSC\'s constitutional personnel jurisdiction.',
      conclusion: 'the CSC may investigate and discipline the applicant for the examination fraud.',
      syllabusLeaf: 'Civil Service Commission jurisdiction and merit-system integrity',
      queryTerms: ['civil service commission', 'constitutional commission', 'examination anomaly'],
    }),
    'bp26-pol-q085': manualReplacement({
      title: 'Regalian Doctrine and Unclassified Reclaimed Land',
      prompt: 'A private developer reclaims part of Manila Bay under a service contract, then claims ownership by long possession even though no law or presidential act classified the reclaimed area as alienable land of the public domain. May the developer acquire ownership by prescription?',
      answerLead: 'No. The developer cannot acquire unclassified reclaimed land by prescription.',
      legalBasis: 'Under Article XII, Section 2 of the Constitution and the Regalian doctrine, lands of the public domain and natural resources belong to the State. Reclaimed land remains inalienable unless the State, through a positive act authorized by law, classifies and disposes of it as alienable land.',
      application: 'The developer performed reclamation only under a service contract and identifies no positive act classifying or conveying the reclaimed area. Long occupation cannot convert inalienable State property into private land.',
      conclusion: 'the reclaimed area remains State property and cannot be acquired by prescription.',
      controllingDoctrine: 'Reclaimed and other public lands remain owned by the State until a positive act lawfully classifies and disposes of them as alienable; prescription does not run against inalienable public land.',
      jurisprudence: 'Chavez v. Public Estates Authority',
      citation: 'G.R. No. 133250, July 9, 2002',
      authorityDate: '2002-07-09',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/51884',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/51884',
      sourceLinks: [CONSTITUTION_ELIB],
      syllabusLeaf: 'Regalian doctrine and alienability of reclaimed land',
      doctrineId: 'DOC-POL-001',
      anchorCaseId: 'AC26-POL-04',
      queryTerms: ['regalian doctrine', 'reclaimed land', 'national patrimony'],
    }),
    'bp26-pol-q070': fromBank('POLI-2023-Q14', {
      title: 'Reelection Does Not Condon Administrative Misconduct',
      prompt: 'A mayor is reelected in May 2019 and later faces an Ombudsman charge for misconduct committed during the immediately preceding term. The reelection occurred after the Supreme Court\'s abandonment of the condonation doctrine became final on April 12, 2016. Does reelection automatically erase the mayor\'s administrative liability?',
      answerLead: 'No. Reelection does not automatically erase administrative liability after abandonment of the condonation doctrine.',
      application: 'The alleged misconduct and reelection occurred after the Court prospectively abandoned condonation. A renewed electoral mandate therefore did not extinguish the mayor\'s accountability as a public trustee.',
      conclusion: 'the Ombudsman case may proceed despite the mayor\'s reelection.',
      syllabusLeaf: 'Accountability of public officers and abandonment of condonation',
      anchorCaseId: 'AC26-POL-06',
      queryTerms: ['public officer accountability', 'condonation doctrine', 'reelection misconduct'],
    }),
    'bp26-pol-q064': manualReplacement({
      title: 'Presidential Supervision Cannot Replace Lawful Local Discretion',
      prompt: 'A province lawfully chooses community clinics as the priority for its discretionary local development fund. Without identifying any legal violation, a cabinet secretary orders the province to substitute a national road project because it is the administration\'s preferred policy. May presidential general supervision be used to replace the province\'s lawful policy judgment?',
      answerLead: 'No. General supervision cannot be used as control over lawful local discretion.',
      legalBasis: 'Article X of the Constitution protects local autonomy while giving the President general supervision over local governments. Supervision ensures that local acts conform to law; control, by contrast, substitutes the superior\'s judgment for that of the local authority.',
      application: 'The province acted within its lawful discretion and no illegality was identified. The cabinet secretary seeks only to replace the province\'s policy preference with the national administration\'s preference.',
      conclusion: 'the directive exceeds general supervision and intrudes on protected local autonomy.',
      controllingDoctrine: 'Presidential supervision over local governments ensures legality but does not authorize substitution of national executive judgment for a lawful exercise of local discretion.',
      jurisprudence: 'Pimentel, Jr. v. Aguirre',
      citation: 'G.R. No. 132988, July 19, 2000',
      authorityDate: '2000-07-19',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/22/36971',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/22/36971',
      sourceLinks: [CONSTITUTION_ELIB],
      syllabusLeaf: 'Local autonomy and presidential general supervision',
      doctrineId: 'DOC-POL-009',
      queryTerms: ['local autonomy', 'general supervision', 'local government control'],
    }),
    'bp26-pol-q073': fromBank('POLI-2022-Q06', {
      title: 'Senate Treaty Concurrence Through a Resolution',
      prompt: 'The President ratifies a regional defense treaty and transmits it to the Senate. At least two-thirds of all senators concur through a formally adopted resolution rather than a bill. Is the concurrence invalid merely because it was expressed by resolution?',
      answerLead: 'No. Senate treaty concurrence need not be enacted as a bill.',
      application: 'The Senate is performing the distinct constitutional act of concurring in a presidential treaty ratification, not legislating a statute. A resolution validly records that single-chamber consent when the required vote is met.',
      conclusion: 'the concurrence is not invalid merely because the Senate used a resolution.',
      syllabusLeaf: 'Treaty ratification and Senate concurrence',
      doctrineId: 'DOC-POL-014',
      anchorCaseId: 'AC26-POL-09',
      queryTerms: ['treaty concurrence', 'senate resolution', 'pacta sunt servanda'],
    }),

    'bp26-comtax-chair-05': manualReplacement({
      title: 'Collective Control in a Tax-Free Property-for-Shares Exchange',
      prompt: 'Two related transferors exchange property solely for shares of Newco. Immediately after the exchange, they collectively own more than fifty-one percent of Newco\'s voting shares, although one transferor\'s individual ownership percentage decreased. Does that individual decrease alone defeat nonrecognition under Section 40(C)(2) of the National Internal Revenue Code?',
      answerLead: 'No. An individual decrease alone does not defeat nonrecognition when the qualifying transferors collectively satisfy statutory control and all other requisites are met.',
      legalBasis: 'Section 40(C)(2) of the National Internal Revenue Code defers recognition when property is transferred to a corporation solely for shares and, as a result, the transferor or transferors acting together gain control of the corporation. Commissioner of Internal Revenue v. Filinvest Development Corporation treats the statutory control test collectively for the qualifying transferors and does not require each transferor to increase an individual percentage.',
      application: 'The exchange was solely for Newco shares, and the two qualifying transferors together held more than fifty-one percent of the voting power immediately afterward. The decrease in one transferor\'s separate percentage does not negate the group\'s statutory control.',
      conclusion: 'the exchange may qualify for nonrecognition if the remaining statutory requisites are proved.',
      controllingDoctrine: 'For a property-for-shares exchange, the statutory control requirement may be met collectively by the qualifying transferors; a decrease in one transferor\'s individual percentage does not by itself defeat nonrecognition.',
      jurisprudence: 'Commissioner of Internal Revenue v. Filinvest Development Corporation',
      citation: 'G.R. Nos. 163653 and 167689, July 19, 2011, En Banc, 669 Phil. 323',
      authorityDate: '2011-07-19',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/31906',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/31906',
      sourceLinks: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/93191'],
      syllabusLeaf: 'Income-tax nonrecognition and collective control in property-for-shares exchanges',
      queryTerms: ['income tax nonrecognition', 'property for shares', 'collective control'],
    }),
    'bp26-comtax-q114': manualReplacement({
      title: 'Zero-Rated Export Sale Does Not Alone Prove a VAT Refund',
      prompt: 'A VAT-registered exporter proves that its output sale is zero-rated, but purchase invoices offered for the related input-tax refund omit essential VAT information required by the post-April 2024 invoicing rules. Is zero-rated status alone sufficient to establish the refund?',
      answerLead: 'No. Zero-rated output status alone does not establish a refund of inadequately substantiated input VAT.',
      legalBasis: 'Republic Act No. 11976 separates the validity of a zero-rated output transaction from proof of creditable input tax. Under Section 113(D), as amended, noncritical invoice omissions generally do not defeat input-tax credit, but omission of specified essential information identified by law and the implementing guidance prevents the affected invoice from substantiating the claimed input tax.',
      application: 'The exporter may prove that its output sale qualifies for zero-rating, but the refund is a separate statutory claim requiring proof of the attributable input tax. Invoices missing the VAT amount or the registered name and taxpayer identification number required by the post-April 2024 rules cannot establish those affected input-tax amounts.',
      conclusion: 'the zero-rated sale does not by itself prove the amount refundable, and only properly substantiated input tax may be credited or refunded.',
      controllingDoctrine: 'Zero-rating of an output sale and substantiation of an input-VAT refund are separate inquiries; specified essential invoice omissions under the Ease of Paying Taxes Act remain fatal to the affected input-tax claim.',
      jurisprudence: 'Ease of Paying Taxes Act; Revenue Memorandum Circular No. 77-2024',
      citation: 'Republic Act No. 11976, Section 113(D), January 5, 2024; RMC No. 77-2024',
      authorityDate: '2024-01-05',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/96948',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/96948',
      sourceLinks: ['https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf'],
      syllabusLeaf: 'VAT zero-rating and substantiation of input-tax refunds',
      queryTerms: ['VAT zero-rated', 'input tax refund', 'invoice substantiation'],
    }),
    'bp26-comtax-q125': fromBank('DDQB-2026-Q374', {
      title: 'Worldwide Gross Estate and Revocable Insurance Designation',
      prompt: 'A Filipino citizen domiciled in Cebu dies owning local property, a Singapore bank account, and life insurance payable to his estate under a revocable designation. Must the executor include those interests in the statutory gross-estate inquiry before deductions?',
      answerLead: 'Yes. The interests enter the gross-estate inquiry subject to statutory exclusions and deductions.',
      legalBasis: 'Section 85(A) of the National Internal Revenue Code includes in a citizen or resident decedent\'s gross estate property interests wherever situated. Section 85(E) includes life-insurance proceeds receivable by the executor, administrator, or estate, as well as proceeds payable to another beneficiary under a revocable designation.',
      application: 'The decedent owned the local property and Singapore account at death. The policy was payable to his estate, and revocability does not exclude it from the statutory starting point.',
      conclusion: 'the executor must include the identified interests in the gross-estate inquiry before claiming authorized exclusions and deductions.',
      controllingDoctrine: 'For a citizen or resident decedent, the gross-estate inquiry reaches property interests wherever situated and includes life-insurance proceeds payable to the estate or under a revocable beneficiary designation.',
      jurisprudence: 'National Internal Revenue Code of 1997',
      citation: 'Republic Act No. 8424, Section 85(A) and (E), December 11, 1997',
      authorityDate: '1997-12-11',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/3896',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/3896',
      sourceLinks: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/3896', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/80559'],
      syllabusLeaf: 'Estate-tax situs, gross estate, and life-insurance proceeds',
      queryTerms: ['estate tax', 'gross estate', 'life insurance proceeds'],
    }),
    'bp26-comtax-q131': fromBank('DDQB-2026-Q392', {
      title: 'Local Road-Impact Charge on Petroleum Products',
      prompt: 'A municipality imposes a road-impact charge measured solely by every liter of petroleum delivered within its territory, whether or not municipal roads are used. Is the ordinance valid merely because the exaction is labeled a charge rather than a tax on petroleum products?',
      answerLead: 'No. The label does not avoid the statutory limitation on local taxation of petroleum products.',
      application: 'The municipality calculates liability exclusively from liters of fuel, not from road use, regulatory cost, or a distinct taxable privilege. The product itself is therefore the object and measure of the imposition.',
      conclusion: 'the ordinance is ultra vires and the petroleum charge must be cancelled.',
      syllabusLeaf: 'Common limitations on local taxing powers',
      queryTerms: ['local taxation', 'petroleum products', 'local taxing power'],
    }),
    'bp26-comtax-q105': fromBank('DDQB-2026-Q399', {
      title: 'Mandatory Reconsideration Before CTA En Banc Review',
      prompt: 'A taxpayer adversely affected by an amended CTA Division decision files directly with the CTA En Banc without first seeking reconsideration or new trial from the Division. May the En Banc entertain the petition merely because it was filed within fifteen days?',
      answerLead: 'No. A timely motion before the CTA Division is an indispensable prerequisite to En Banc review.',
      application: 'The taxpayer was adversely affected by the amended decision but never asked the Division to revisit that disposition. Filing the En Banc petition within fifteen days cannot cure omission of the mandatory prior motion.',
      conclusion: 'the CTA En Banc must dismiss the premature petition for failure to perfect the statutory appeal.',
      syllabusLeaf: 'CTA Division reconsideration and En Banc appellate jurisdiction',
      queryTerms: ['CTA En Banc', 'motion for reconsideration', 'tax judicial remedies'],
    }),

    'bp26-civ-q351': fromBank('CIV-2025-Q08', {
      title: 'Annulment Does Not Automatically Alter a Child\'s Civil Status',
      prompt: 'A child is born during a validly subsisting marriage. The husband later obtains an annulment after a private DNA test, but no timely action to impugn legitimacy is brought. Does the child remain legitimate notwithstanding the annulment decree?',
      answerLead: 'Yes. The child remains legitimate unless legitimacy is successfully impugned in the manner and period fixed by law.',
      application: 'The child was born during the subsisting marriage and before the annulment judgment. Annulment and a private DNA test do not substitute for the exclusive, timely action required to impugn legitimacy.',
      conclusion: 'the child\'s civil status remains legitimate on the stated facts.',
      syllabusLeaf: 'Civil-register status and exclusive action to impugn legitimacy',
      queryTerms: ['civil register', 'legitimacy', 'impugning legitimacy'],
    }),
    'bp26-civ-q159': fromBank('DDQB-2026-Q152', {
      title: 'Unproved Foreign Law and Processual Presumption',
      prompt: 'A Philippine-centered construction contract selects Singapore law, but the party invoking a foreign rule submits only counsel\'s memorandum and no competent proof of that law. May the unproved foreign rule displace Philippine law?',
      answerLead: 'No. Unproved foreign law cannot displace Philippine law on the present record.',
      syllabusLeaf: 'Conflict of laws, party autonomy, and processual presumption',
      doctrineId: 'DOC-CIV-007',
      queryTerms: ['conflict of laws', 'unproved foreign law', 'processual presumption'],
    }),
    'bp26-civ-q165': fromBank('DDQB-2026-Q153', {
      title: 'Bank Mortgagee Faced With Visible Adverse Possession',
      prompt: 'A bank accepts titled land as collateral despite finding another family openly occupying, cultivating, and claiming it under an earlier deed, then makes no further inquiry. May the bank invoke innocent-mortgagee status solely because the certificate of title appeared clean?',
      answerLead: 'No. Visible adverse possession required further inquiry, especially from a bank.',
      application: 'The occupants\' visible home, cultivation, and express ownership claim contradicted the registered owner\'s apparent title. The bank ignored information readily capable of verification.',
      conclusion: 'the bank cannot invoke innocent-mortgagee protection solely from the clean certificate; the visible adverse possession and ownership claim required further inquiry.',
      syllabusLeaf: 'Torrens title, mortgagee good faith, and duty of inquiry',
      doctrineId: 'DOC-CIV-019',
      anchorCaseId: 'AC26-CIV-10',
      queryTerms: ['torrens system', 'innocent mortgagee', 'duty of inquiry'],
    }),
    'bp26-civ-q164': fromBank('DDQB-2026-Q154', {
      title: 'Preterition Annuls the Institution of Voluntary Heirs',
      prompt: 'A testator institutes two siblings as universal heirs but completely omits a living legitimate child who received no advance and was neither unworthy nor disinherited. Does the child\'s preterition annul the siblings\' institution, subject to valid non-inofficious devises?',
      answerLead: 'Yes. Complete omission of the direct compulsory heir produces preterition and annuls the institution of heirs.',
      application: 'The living legitimate child is a direct compulsory heir who received nothing by will or advance. The omission was complete, not merely an insufficient provision.',
      conclusion: 'the universal institution fails and succession proceeds accordingly, subject to any valid non-inofficious devises or legacies.',
      syllabusLeaf: 'Testamentary succession and preterition',
      anchorCaseId: 'AC26-CIV-05',
      queryTerms: ['succession', 'preterition', 'compulsory heir'],
    }),
    'bp26-civ-q151': fromBank('CIV-2025-Q11', {
      title: 'Disinheritance Requires an Exclusive Statutory Cause',
      prompt: 'A parent\'s will disinherits a child solely because the child married a person whom the parent considered irresponsible and disrespectful. Is the disinheritance valid without facts bringing the child\'s own conduct within an exclusive statutory cause?',
      answerLead: 'No. Disinheritance is invalid without a cause expressly and exclusively provided by law.',
      application: 'Disapproval of the child\'s spouse and the spouse\'s behavior are not, without more, statutory acts of the child under Article 919. Strict compliance cannot be replaced by a generalized family grievance.',
      conclusion: 'the disinheritance is ineffective and the child may protect the legitime.',
      syllabusLeaf: 'Disinheritance of children and exclusive statutory causes',
      queryTerms: ['succession', 'disinheritance', 'statutory cause'],
    }),
    'bp26-civ-q160': fromBank('DDQB-2026-Q155', {
      title: 'Solutio Indebiti for a Mistaken Vendor Payment',
      prompt: 'A college mistakenly pays a supplier that had no contract, invoice, or receivable, and the supplier keeps the money after demand. Must the supplier return the payment under solutio indebiti rather than force the college to rely only on residual unjust enrichment?',
      answerLead: 'Yes. Solutio indebiti directly governs the mistaken payment.',
      legalBasis: 'Article 2154 of the Civil Code provides that when something is received despite no right to demand it and it was unduly delivered through mistake, the obligation to return it arises. Siga-an v. Villanueva applies solutio indebiti when payment was made by mistake despite the recipient\'s lack of right.',
      application: 'The college paid the supplier despite the absence of any contract, invoice, or receivable. Because the supplier had no right to demand the money and delivery occurred by mistake, Article 2154\'s specific quasi-contract applies.',
      conclusion: 'the supplier must return the mistaken payment under solutio indebiti.',
      controllingDoctrine: 'Solutio indebiti applies when something is received without a right to demand it and is unduly delivered through mistake; the recipient must return it.',
      jurisprudence: 'Siga-an v. Villanueva',
      citation: 'G.R. No. 173227, January 20, 2009, 596 Phil. 760',
      authorityDate: '2009-01-20',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/assets/pdf/philrep_ebooks/Volume_596.pdf',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/assets/pdf/philrep_ebooks/Volume_596.pdf',
      sourceLinks: [CIVIL_CODE_ELIB],
      syllabusLeaf: 'Solutio indebiti and residual unjust enrichment',
      doctrineId: 'DOC-CIV-013',
      queryTerms: ['solutio indebiti', 'mistaken payment', 'unjust enrichment'],
    }),
    'bp26-civ-q163': fromBank('CIV-2023-Q20', {
      title: 'Temperate Damages When Funeral Loss Is Certain but Unproved',
      prompt: 'A victim\'s heirs unquestionably incurred funeral expenses but cannot prove their exact amount with competent receipts. May the court award reasonable temperate damages instead of denying all pecuniary recovery?',
      answerLead: 'Yes. Temperate damages may be awarded when pecuniary loss is certain but its exact amount cannot be proved.',
      application: 'The death necessarily caused funeral or burial expense, although the heirs cannot establish an exact actual-damages figure. Article 2224 permits a reasonable temperate award for that certain but unquantified loss.',
      conclusion: 'the court may award temperate damages in lieu of unproved actual funeral expenses.',
      syllabusLeaf: 'Temperate damages for certain but unquantified pecuniary loss',
      queryTerms: ['temperate damages', 'funeral expenses', 'unproved pecuniary loss'],
    }),

    'bp26-lab-q036': fromBank('DDQB-2026-Q214', {
      title: 'Solidary Liability in Overseas Recruitment',
      prompt: 'A licensed local agency deploys a worker to a foreign principal under an approved contract, after which the principal unlawfully dismisses her and withholds salary. Are the agency and foreign principal solidarily liable despite their private agreement assigning all worker liabilities abroad?',
      answerLead: 'Yes. The local agency and foreign principal are solidarily liable for the covered overseas-employment claims.',
      application: 'The worker\'s unpaid wages and illegal termination arise directly from the approved deployment contract. The local agency participated in the deployment and cannot contract away the statutory guarantee against the worker.',
      conclusion: 'the worker may recover the lawful award from either or both obligors, without prejudice to their internal reimbursement rights.',
      syllabusLeaf: 'Overseas recruitment and solidary liability',
      queryTerms: ['overseas recruitment', 'solidary liability', 'migrant worker'],
    }),
    'bp26-lab-q037': manualReplacement({
      title: 'Court of Appeals Review of an NLRC Decision',
      prompt: 'An employer claims that the NLRC gravely abused its discretion and files a Rule 65 petition directly with the Supreme Court. Is direct resort to the Supreme Court the proper initial mode of judicial review?',
      answerLead: 'No. The Rule 65 petition must be filed initially in the Court of Appeals.',
      legalBasis: 'St. Martin Funeral Home v. NLRC harmonized the Labor Code with the Judiciary Reorganization Act and held that NLRC decisions are reviewed through certiorari under Rule 65 in the Court of Appeals. Supreme Court review ordinarily follows through Rule 45.',
      application: 'The employer challenges an NLRC decision for grave abuse, so its initial judicial remedy is a Rule 65 petition in the Court of Appeals, not a direct special civil action in the Supreme Court.',
      conclusion: 'the direct Supreme Court filing is improper and the challenge belongs initially in the Court of Appeals.',
      controllingDoctrine: 'Judicial review of an NLRC decision for grave abuse of discretion is initiated by a Rule 65 petition in the Court of Appeals, with later Supreme Court review ordinarily under Rule 45.',
      jurisprudence: 'St. Martin Funeral Home v. National Labor Relations Commission',
      citation: 'G.R. No. 130866, September 16, 1998',
      authorityDate: '1998-09-16',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/36394',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/36394',
      sourceLinks: [LABOR_CODE_ELIB],
      syllabusLeaf: 'Judicial review of NLRC decisions',
      anchorCaseId: 'AC26-LAB-08',
      queryTerms: ['NLRC judicial review', 'St Martin', 'Rule 65 labor'],
    }),
    'bp26-lab-q200': manualReplacement({
      title: 'Compensable Short Rest Periods Under a CBA',
      prompt: 'A CBA expressly includes two short breaks in the normal paid workday, and records show workers were repeatedly recalled during them. Should those breaks be treated as compensable working time despite electronic clock-outs?',
      answerLead: 'Yes. Contractually integrated or employer-controlled short breaks are compensable working time.',
      legalBasis: 'Bonpack Corporation v. Nagkakaisang Manggagawa sa Bonpack-SUPER enforced a collective bargaining agreement that integrated a thirty-minute meal break and two fifteen-minute coffee breaks into the normal eight-hour workday. Short rest periods deliberately included in paid working time remain compensable, while a genuinely uninterrupted one-hour meal period may be treated differently.',
      application: 'The CBA expressly included the two short breaks in the paid workday, and the recall records independently show that employees remained subject to the employer\'s demands. Electronic clock-out labels cannot override the parties\' agreement and the actual control exercised during the breaks.',
      conclusion: 'the short breaks must be counted as compensable working time on the stated facts.',
      controllingDoctrine: 'Short meal or rest periods expressly integrated by a CBA into the normal workday are compensable; payroll labels cannot displace the governing agreement and actual employer control.',
      jurisprudence: 'Bonpack Corporation v. Nagkakaisang Manggagawa sa Bonpack-SUPER',
      citation: 'G.R. No. 230041, December 5, 2022',
      authorityDate: '2022-12-05',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68642',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68642',
      sourceLinks: [LABOR_CODE_ELIB],
      syllabusLeaf: 'Hours worked and compensable rest periods',
      queryTerms: ['rest periods', 'hours worked', 'compensable break'],
    }),
    'bp26-lab-q202': manualReplacement({
      title: 'Labor-Tribunal Jurisdiction Over an Employment Training Bond',
      prompt: 'An employer sues in the Regional Trial Court to collect an employment training bond triggered by the employee\'s resignation before the agreed minimum service period. Does the regular court have jurisdiction merely because the employer frames the claim as a breach of contract?',
      answerLead: 'No. The employment-bond claim is inseparably intertwined with the employer-employee relationship and belongs to the labor tribunals.',
      legalBasis: 'Article 224 of the Labor Code gives Labor Arbiters original and exclusive jurisdiction over covered claims arising from employer-employee relations. Comscentre Phils., Inc. v. Rocio holds that an employment bond triggered by premature resignation and reimbursement of employment training expenses has a reasonable causal connection to that relationship and should not be split from the labor controversy.',
      application: 'The employer\'s cause of action arose only because the employee resigned before completing the service period fixed in the employment contract, and the claimed amount reimburses employment-related training expenses. Calling the claim contractual does not remove its inseparable labor connection.',
      conclusion: 'the Regional Trial Court lacks jurisdiction and the employment-bond claim belongs to the Labor Arbiter.',
      controllingDoctrine: 'An employer\'s employment-bond claim falls within labor jurisdiction when premature resignation and employment-related training expenses inseparably connect the claim to the employer-employee relationship.',
      jurisprudence: 'Comscentre Phils., Inc. v. Rocio',
      citation: 'G.R. No. 222212, January 22, 2020, 869 Phil. 147',
      authorityDate: '2020-01-22',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/66004',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/66004',
      sourceLinks: [LABOR_CODE_ELIB],
      syllabusLeaf: 'Labor Arbiter jurisdiction and reasonable causal connection',
      queryTerms: ['labor arbiter jurisdiction', 'training bond', 'reasonable causal connection'],
    }),

    'bp26-crim-q275': manualReplacement({
      title: 'Extraterritorial Application to an Official Consular Offense',
      prompt: 'While posted abroad, a Philippine consular officer deliberately falsifies an official consular certification in exchange for payment while performing consular functions. Does the foreign location alone place the offense beyond the application of the Revised Penal Code?',
      answerLead: 'No. The Revised Penal Code applies extraterritorially to a Philippine public officer who commits an offense in the exercise of official functions.',
      legalBasis: 'Article 2(4) of the Revised Penal Code applies the Code outside Philippine jurisdiction to public officers or employees who commit an offense in the exercise of their functions. This is a statutory exception to the territoriality principle and must be applied only when the official-function nexus is established.',
      application: 'The consular officer is a Philippine public officer, and the falsified certification was produced while performing official consular duties. The stipulated offense therefore falls within Article 2(4) even though the physical act occurred abroad.',
      conclusion: 'the foreign location does not by itself prevent application of the Revised Penal Code.',
      controllingDoctrine: 'The Revised Penal Code is generally territorial, but Article 2(4) applies it extraterritorially to offenses committed by Philippine public officers or employees in the exercise of their official functions.',
      jurisprudence: 'Revised Penal Code of the Philippines',
      citation: 'Act No. 3815, Article 2(4), December 8, 1930',
      authorityDate: '1930-12-08',
      primarySourceUrl: RPC_ELIB,
      legalBasisSourceUrl: RPC_ELIB,
      sourceLinks: [],
      syllabusLeaf: 'Territoriality and the official-function exception under Article 2(4)',
      queryTerms: ['territoriality', 'extraterritorial jurisdiction', 'public officer official functions'],
    }),
    'bp26-crim-q273': manualReplacement({
      title: 'Illegal Sale of Dangerous Drugs — Transaction and Corpus Delicti',
      prompt: 'An undercover officer and Dario agree on one thousand pesos for a sachet of shabu. The officer hands over marked money, and Dario delivers the sachet. The seized sachet is immediately marked, its identity and integrity are preserved through an unbroken chain of custody, and it is presented in court as methamphetamine hydrochloride. Do the proved exchange and preserved corpus delicti satisfy the essential elements of illegal sale under Section 5 of Republic Act No. 9165?',
      answerLead: 'Yes. The proved exchange and preserved corpus delicti satisfy the essential elements of illegal sale.',
      legalBasis: 'Section 5 of Republic Act No. 9165 penalizes the unauthorized sale of dangerous drugs. People v. Macatingag states that the prosecution must prove the identities of the buyer and seller, the object and consideration, delivery of the thing sold, and payment, together with presentation of the corpus delicti in court.',
      application: 'The officer and Dario were identified as buyer and seller, the sachet and agreed price supplied the object and consideration, and delivery occurred in exchange for marked money. The stipulated marking and unbroken custody preserved the drug\'s identity through its presentation in court.',
      conclusion: 'the prosecution has established the elements of illegal sale on the stated facts, subject to proof of guilt beyond reasonable doubt.',
      controllingDoctrine: 'Illegal sale of dangerous drugs requires proof of the buyer and seller, the object and consideration, delivery and payment, and presentation of the preserved corpus delicti.',
      jurisprudence: 'People of the Philippines v. Macatingag',
      citation: 'G.R. No. 181037, January 19, 2009, 596 Phil. 376',
      authorityDate: '2009-01-19',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/assets/pdf/philrep_ebooks/Volume_596.pdf',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/assets/pdf/philrep_ebooks/Volume_596.pdf',
      sourceLinks: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/48516'],
      syllabusLeaf: 'Illegal sale of dangerous drugs: transaction elements and corpus delicti',
      queryTerms: ['illegal sale dangerous drugs', 'Section 5 Republic Act 9165', 'corpus delicti'],
    }),
    'bp26-crim-q249': manualReplacement({
      title: 'Natural Consequences and Proximate Cause Under Article 4',
      prompt: 'During an intentional unlawful assault, Diego chases the victim onto an elevated footbridge. The victim reasonably flees, falls, and dies; no independent event intervenes. Is Diego criminally liable for the death even though he intended only to injure?',
      answerLead: 'Yes. Diego is liable for the natural and proximate consequence of his intentional felony.',
      legalBasis: 'Article 4 of the Revised Penal Code makes one who commits an intentional felony liable for all its natural and logical consequences. Talampas v. People requires a causal chain unbroken by an efficient intervening cause.',
      application: 'The fatal fall was a foreseeable and immediate response to Diego\'s unlawful pursuit. Because no independent superseding cause broke the chain, the resulting death is attributable to the original felony.',
      conclusion: 'the offender answers for the death notwithstanding that the resulting harm exceeded his specific intent.',
      controllingDoctrine: 'An offender is liable for the natural and logical consequences of an intentional felony unless an efficient intervening cause breaks the causal chain.',
      jurisprudence: 'Talampas v. People',
      citation: 'G.R. No. 180219, November 23, 2011',
      authorityDate: '2011-11-23',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/32587',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/32587',
      sourceLinks: [RPC_ELIB],
      syllabusLeaf: 'Proximate cause and natural consequences under Article 4',
      doctrineId: 'DOC-CRIM-009',
      queryTerms: ['proximate cause', 'Article 4', 'natural consequences felony'],
    }),
    'bp26-crim-q289': manualReplacement({
      title: 'Absorption of Common Crimes Committed in Furtherance of Rebellion',
      prompt: 'During an armed uprising, rebels burn a police outpost and seize its firearms solely to advance their political objective, with no independent private motive. May the prosecution complex separate arson and robbery charges with rebellion?',
      answerLead: 'No. Common crimes committed solely in furtherance of rebellion are absorbed in the political offense.',
      legalBasis: 'Enrile v. Salazar reaffirmed the Hernandez doctrine that killings, property offenses, and other common crimes committed as necessary means or incidents of rebellion are absorbed in simple rebellion, absent an independent criminal purpose.',
      application: 'The burning and taking were alleged only as means to advance the uprising. With no independent private objective, those acts form part of the single political offense rather than separate complexed crimes.',
      conclusion: 'the prosecution should charge rebellion, with the furthering acts absorbed on the stated facts.',
      controllingDoctrine: 'Common crimes committed in furtherance of rebellion and without an independent criminal purpose are absorbed in rebellion rather than complexed under Article 48.',
      jurisprudence: 'Enrile v. Salazar',
      citation: 'G.R. Nos. 92163 and 92164, June 5, 1990',
      authorityDate: '1990-06-05',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/assets/dtSearch/dtSearch_system_files/dtisapi6.dll?DocId=32282&Index=%2A4aeb4dbdcceeda9b59b85ae3fb22cec0&cmd=getdoc',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/assets/dtSearch/dtSearch_system_files/dtisapi6.dll?DocId=32282&Index=%2A4aeb4dbdcceeda9b59b85ae3fb22cec0&cmd=getdoc',
      sourceLinks: [RPC_ELIB],
      syllabusLeaf: 'Rebellion and absorption of common crimes',
      anchorCaseId: 'AC26-CRI-06',
      queryTerms: ['rebellion', 'political offense', 'absorption common crimes'],
    }),
    'bp26-crim-q246': manualReplacement({
      title: 'Death of the Accused Pending Appeal',
      prompt: 'An accused dies while the conviction is still under appeal and before final judgment. Must the criminal case and civil liability based solely on the offense be extinguished, without prejudice to independently sourced civil claims?',
      answerLead: 'Yes. Death before final judgment extinguishes criminal liability and civil liability ex delicto.',
      legalBasis: 'Article 89(1) of the Revised Penal Code extinguishes criminal liability by death before final judgment. People v. Brillantes, applying People v. Bayotas, holds that death pending appeal also extinguishes civil liability based solely on the offense, while a civil claim based on another source of obligation may survive in the proper separate action.',
      application: 'Because the conviction remained on appeal, it had not become final when the accused died. No criminal penalty may be imposed, while a civil claim based on another source of obligation may proceed separately if legally available.',
      conclusion: 'the appeal and criminal case must be dismissed, subject to the stated civil-law qualification.',
      controllingDoctrine: 'Death of the accused pending appeal extinguishes criminal liability and civil liability ex delicto, without prejudice to a proper civil claim based on another source of obligation.',
      jurisprudence: 'People v. Brillantes',
      citation: 'G.R. No. 190610, April 25, 2012, 686 Phil. 1089',
      authorityDate: '2012-04-25',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/54733',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/54733',
      sourceLinks: [RPC_ELIB],
      syllabusLeaf: 'Extinction of criminal liability by death before final judgment',
      queryTerms: ['death pending appeal', 'extinction criminal liability', 'civil liability ex delicto'],
    }),
    'bp26-crim-q258': manualReplacement({
      title: 'Falsification of a Public Document Without Proven Pecuniary Loss',
      prompt: 'A private contractor alters a signed municipal occupancy permit to add a nonexistent approval and presents it to obtain authority to open a building. Is proof of actual pecuniary damage indispensable to prosecution for falsification of the public document under Articles 171 and 172?',
      answerLead: 'No. Actual pecuniary damage is not indispensable when the falsified instrument is a public document.',
      legalBasis: 'Articles 171 and 172 of the Revised Penal Code punish a private individual who commits a statutory mode of falsification in a public, official, or commercial document. Liwanag v. People explains that falsification of a public document protects public faith and does not require intent to gain or intent to injure a third person.',
      application: 'The signed municipal permit is a public document, and the contractor materially inserted a false official approval before using it. The injury lies in corruption of the document\'s public authenticity even without quantified monetary loss.',
      conclusion: 'the absence of proven pecuniary damage does not defeat the falsification charge.',
      controllingDoctrine: 'Falsification of a public document by a private individual protects public faith, so actual pecuniary damage is not an indispensable element when a statutory mode of falsification is proved.',
      jurisprudence: 'C/Insp. Ruben Liwanag, Sr. v. People',
      citation: 'G.R. No. 205260, July 29, 2019',
      authorityDate: '2019-07-29',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/65564',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/65564',
      sourceLinks: [RPC_ELIB],
      syllabusLeaf: 'Falsification of public documents by a private individual',
      queryTerms: ['falsification public document', 'public faith', 'Articles 171 172'],
    }),

    'bp26-rem-chair-06': manualReplacement({
      title: 'Relaxation of Procedure to Reach a Trial on the Merits',
      prompt: 'A party does not personally attend pretrial, but authorized counsel is only late, promptly explains the delay, moves to reinstate the complaint, and shows written authority to represent the client. The adverse party receives the motion, opposes it, and identifies no material prejudice from a trial on the merits. May the court relax the procedural rules in these exceptional circumstances?',
      answerLead: 'Yes. The court may relax the procedural rules when their purpose has been served and strict dismissal would frustrate substantial justice without prejudicing the adverse party.',
      legalBasis: 'Vette Industrial Sales Co., Inc. v. Cheng teaches that procedural rules are tools for attaining justice and may be relaxed when rigid application would cause a manifest failure or miscarriage of justice. A court should consider a valid explanation, substantial compliance, notice and opportunity to oppose, the absence of prejudice, and the preference for adjudication on the merits.',
      application: 'Counsel did not abandon the pretrial but arrived late, promptly explained, held written authority to represent the client, and sought reinstatement through a motion the adverse party was able to contest. A merits hearing would not deprive the adverse party of due process or create identified prejudice.',
      conclusion: 'the court may reinstate the complaint and resolve the controversy on its merits.',
      controllingDoctrine: 'Procedural rules may be relaxed in exceptional circumstances when there is a reasonable explanation or substantial compliance, the adverse party has notice and suffers no material prejudice, and strict application would defeat substantial justice.',
      jurisprudence: 'Vette Industrial Sales Co., Inc. v. Cheng',
      citation: 'G.R. Nos. 170232 and 170301, December 5, 2006',
      authorityDate: '2006-12-05',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/40511',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/40511',
      sourceLinks: [RULES_ELIB],
      syllabusLeaf: 'Construction and relaxation of procedural rules',
      doctrineId: 'DOC-REMETH-010',
      queryTerms: ['liberal construction procedural rules', 'relaxation rules', 'procedural deadline'],
    }),
    'bp26-rem-q457': fromBank('DDQB-2026-Q311', {
      title: 'Certiorari Is Not a Substitute for Appeal',
      prompt: 'A trial court makes a reasoned interlocutory evidentiary ruling within its jurisdiction, and the alleged legal error can be reviewed on ordinary appeal after judgment. May a party use Rule 65 certiorari as a substitute without showing grave abuse or an inadequate appellate remedy?',
      answerLead: 'No. Certiorari cannot replace an adequate appeal for a mere error of judgment.',
      application: 'The trial court acted within its jurisdiction, heard the parties, and made a reasoned ruling. Disagreement with legal correctness does not establish grave abuse, and ordinary appeal remains adequate.',
      conclusion: 'certiorari under Rule 65 cannot substitute for the available appeal.',
      syllabusLeaf: 'Certiorari, grave abuse, and adequate remedy by appeal',
      anchorCaseId: 'AC26-REM-04',
      queryTerms: ['certiorari', 'grave abuse', 'substitute for appeal'],
    }),
    'bp26-rem-q025': manualReplacement({
      title: 'Writ of Kalikasan for Environmental Harm Across Two Provinces',
      prompt: 'After allegedly violating its tailings-containment permit and unlawfully failing to maintain the impoundment, a mining operator allows a leak to contaminate a connected river system used by communities in two provinces, threatening drinking water, farms, and fisheries. Residents submit scientific sampling and sworn accounts linking the unlawful acts and omissions to the leak. May they seek a writ of kalikasan based on the alleged magnitude and geographic reach of the environmental harm?',
      answerLead: 'Yes. The allegations fall within the protective scope of the writ of kalikasan.',
      legalBasis: 'Rule 7 of the Rules of Procedure for Environmental Cases makes the writ available for an unlawful act or omission involving environmental damage of such magnitude as to prejudice life, health, or property of inhabitants in two or more cities or provinces. The constitutional right to a balanced and healthful ecology informs the remedy.',
      application: 'The petition alleges unlawful permit violations and failure to maintain containment, links them through scientific samples and sworn accounts to contamination crossing provincial boundaries, and identifies threats to life, health, and property in multiple communities. Those allegations supply each threshold element, subject to proof on the merits.',
      conclusion: 'the residents may invoke the writ because the pleaded environmental harm has the required magnitude and territorial reach.',
      controllingDoctrine: 'A writ of kalikasan addresses unlawful environmental harm whose magnitude prejudices or threatens life, health, or property of inhabitants in at least two cities or provinces.',
      jurisprudence: 'Mayor Tomas R. Osmeña v. Garganera',
      citation: 'G.R. No. 231164, March 20, 2018',
      authorityDate: '2018-03-20',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/assets/pdf/philrep/2018/G.R.%20No.%20231164.pdf',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/assets/pdf/philrep/2018/G.R.%20No.%20231164.pdf',
      sourceLinks: ['https://sc.judiciary.gov.ph/rules-of-procedure-for-environmental-cases/', CONSTITUTION_ELIB],
      syllabusLeaf: 'Writ of kalikasan and magnitude of environmental damage',
      queryTerms: ['writ of kalikasan', 'environmental damage', 'balanced and healthful ecology'],
      educatorSignal: {
        name: 'Atty. Josephus B. Jimenez',
        role: 'public legal educator and columnist',
        source_url: 'https://www.philstar.com/the-freeman/opinion/2026/01/26/2503593/osmea-v-garganera-garbage-management',
        signal: 'Publicly highlighted environmental accountability and writ-of-kalikasan relevance; used only as a capped topic signal, never as controlling law.',
        examinable_authority: false,
      },
    }),
    'bp26-rem-q296': manualReplacement({
      title: 'Dispatcher\'s Out-of-Court Statement Offered for Its Truth',
      prompt: 'A passenger sues a bus company after a collision. To prove defective brakes, the passenger calls a bystander who says the dispatcher told him before the trip that the brakes had failed inspection. The dispatcher does not testify, and no hearsay exclusion or exception is established. Is the bystander\'s testimony admissible to prove that the brakes were defective?',
      answerLead: 'No. The dispatcher\'s out-of-court assertion is inadmissible hearsay when offered for its truth.',
      legalBasis: 'Under Rule 130, hearsay is an out-of-court statement offered to prove the truth of what it asserts and is inadmissible unless a rule excludes it from hearsay or supplies an exception. A nontruth purpose must be genuinely relevant and cannot be used as a pretext.',
      application: 'The bystander has no personal knowledge of the brake condition. The passenger offers the dispatcher\'s statement precisely to prove defective brakes, and the facts establish no applicable exclusion or exception.',
      conclusion: 'the testimony must be excluded when offered to prove the asserted brake defect.',
      controllingDoctrine: 'An out-of-court statement offered to prove the truth of its assertion is hearsay and is inadmissible unless an exclusion or exception applies.',
      jurisprudence: 'Ruiz v. People',
      citation: 'G.R. No. 244692, October 9, 2024',
      authorityDate: '2024-10-09',
      primarySourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69714',
      legalBasisSourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69714',
      sourceLinks: ['https://sc.judiciary.gov.ph/2019-amendments-to-the-1989-revised-rules-on-evidence/', RULES_ELIB],
      syllabusLeaf: 'Hearsay definition and truth-of-the-assertion purpose',
      doctrineId: 'DOC-REMETH-017',
      queryTerms: ['hearsay', 'out of court statement', 'truth of assertion'],
    }),
  }));
}

function removeReplacementLineage(row) {
  const next = { ...row };
  for (const field of [
    'chair_case_id', 'chair_alignment_case_id', 'source_editorial_status',
    'source_publication_ready', 'source_last_reviewed', 'source_editorial_note',
    'chair_authorship_evidence', 'educator_signal', 'anchor_case_id', 'doctrine_id', 'query_terms',
  ]) delete next[field];
  return next;
}

function disciplineForUnit(unit) {
  return unit.question_bank_subject;
}

function recordText(record) {
  return [
    record.Topic,
    record['Essay Question'],
    record['Controlling Doctrine'],
    record['Jurisprudence / Case'],
  ].join(' ').toLowerCase();
}

function termMatches(text, term) {
  const words = String(term).toLowerCase().split(/\s+/u).filter(Boolean);
  return words.length > 0 && words.every((word) => text.includes(word));
}

function weightedPresence(years, weights) {
  const denominator = [...weights.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...new Set(years)].reduce((sum, year) => sum + (weights.get(year) || 0), 0) / denominator;
}

function historicalModel({ units, certifiedRecords, bankById }) {
  const sourceRows = certifiedRecords
    .map((entry) => ({ entry, record: bankById.get(entry.questionId) }))
    .filter(({ record }) => record && record['Bar Year'] !== '2026');
  const byDiscipline = new Map();
  for (const pair of sourceRows) {
    const discipline = pair.record.Subject;
    const rows = byDiscipline.get(discipline) || [];
    rows.push(pair);
    byDiscipline.set(discipline, rows);
  }

  const unitEvidence = new Map();
  for (const unit of units) {
    const discipline = disciplineForUnit(unit);
    const rows = byDiscipline.get(discipline) || [];
    const years = [...new Set(rows.map(({ entry }) => Number(entry.barYear)))].sort();
    const weights = new Map(years.map((year) => [year, 1]));
    const byYearTotals = new Map(years.map((year) => [year, rows.filter(({ entry }) => Number(entry.barYear) === year).length]));
    const matches = rows.filter(({ record }) => unit.historical_terms.some((term) => termMatches(recordText(record), term)));
    const weightedShare = years.reduce((sum, year) => {
      const count = matches.filter(({ entry }) => Number(entry.barYear) === year).length;
      return sum + (weights.get(year) || 0) * (count / Math.max(1, byYearTotals.get(year)));
    }, 0) / Math.max(1, [...weights.values()].reduce((sum, value) => sum + value, 0));
    unitEvidence.set(unit.id, { discipline, rows, years, weights, matches, weightedShare });
  }

  const maxShareBySubject = new Map();
  for (const unit of units) {
    const evidence = unitEvidence.get(unit.id);
    maxShareBySubject.set(unit.subject, Math.max(maxShareBySubject.get(unit.subject) || 0, evidence.weightedShare));
  }
  return { byDiscipline, unitEvidence, maxShareBySubject };
}

function scoreRow({ row, unit, historical, maxLebBySubject, authorityRecencyPercentile }) {
  const unitEvidence = historical.unitEvidence.get(unit.id);
  const queryTerms = unique(row.query_terms || row.historical_evidence?.query_terms || [row.syllabus_leaf]);
  const doctrineMatches = unitEvidence.rows.filter(({ record }) => queryTerms.some((term) => termMatches(recordText(record), term)));
  const doctrinePresence = weightedPresence(
    doctrineMatches.map(({ entry }) => Number(entry.barYear)),
    unitEvidence.weights,
  );
  const maxShare = historical.maxShareBySubject.get(row.subject) || 1;
  const unitShareIndex = Math.min(1, unitEvidence.weightedShare / maxShare);
  const historicalRaw = (0.75 * unitShareIndex) + (0.25 * doctrinePresence);
  const lebRaw = Number(unit.leb_prior_weight) / maxLebBySubject.get(row.subject);
  const syllabusRaw = Number(unit.syllabus_centrality);
  const caseBasedAuthority = /\bG\.R\.\s*(?:Nos?\.)?/iu.test(row.citation || '');
  const cutoffJurisprudenceRaw = caseBasedAuthority
    ? 0.5 + (0.5 * authorityRecencyPercentile)
    : 1;
  const contemporaryText = `${row.title} ${row.prompt} ${row.syllabus_leaf}`;
  const contemporaryRaw = /\b(?:artificial intelligence|AI|algorithm|digital|electronic|cyber|social media|online|data|technology|environment|climate|drone|platform)\b/iu.test(contemporaryText)
    ? 1
    : 0;
  const educatorSourceCount = unique([
    ...(row.educator_sources || []),
    row.educator_signal?.source_url,
  ]).length;
  const educatorRaw = Math.min(1, educatorSourceCount / 2);
  const rawScores = {
    historical_frequency: Number(historicalRaw.toFixed(6)),
    leb_curriculum_prior: Number(lebRaw.toFixed(6)),
    official_syllabus_centrality: Number(syllabusRaw.toFixed(6)),
    cutoff_compliant_jurisprudence: Number(cutoffJurisprudenceRaw.toFixed(6)),
    contemporary_or_technology_relevance: contemporaryRaw,
    attributable_educator_signal: educatorRaw,
  };
  const weights = {
    historical_frequency: 35,
    leb_curriculum_prior: 25,
    official_syllabus_centrality: 20,
    cutoff_compliant_jurisprudence: 10,
    contemporary_or_technology_relevance: 5,
    attributable_educator_signal: 5,
  };
  const breakdown = Object.fromEntries(Object.entries(rawScores).map(([component, raw]) => [
    component,
    Number((raw * weights[component]).toFixed(6)),
  ]));
  const unroundedScore = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    predictionScore: Number(unroundedScore.toFixed(1)),
    unroundedScore: Number(unroundedScore.toFixed(6)),
    rawScores,
    breakdown,
    historicalEvidence: {
      corpus_total: 318,
      discipline_sample_size: unitEvidence.rows.length,
      included_years: unitEvidence.years,
      unit_matched_question_count: unitEvidence.matches.length,
      unit_matched_years: unique(unitEvidence.matches.map(({ entry }) => Number(entry.barYear))).sort(),
      doctrine_matched_question_count: doctrineMatches.length,
      doctrine_matched_years: unique(doctrineMatches.map(({ entry }) => Number(entry.barYear))).sort(),
      matched_question_ids: unique([
        ...unitEvidence.matches.map(({ entry }) => entry.questionId),
        ...doctrineMatches.map(({ entry }) => entry.questionId),
      ]).sort(),
      subject_year_denominators: Object.fromEntries(unitEvidence.years.map((year) => [
        year,
        unitEvidence.rows.filter(({ entry }) => Number(entry.barYear) === year).length,
      ])),
      unit_yearly_shares: Object.fromEntries(unitEvidence.years.map((year) => {
        const denominator = unitEvidence.rows.filter(({ entry }) => Number(entry.barYear) === year).length;
        const numerator = unitEvidence.matches.filter(({ entry }) => Number(entry.barYear) === year).length;
        return [year, Number((numerator / Math.max(1, denominator)).toFixed(6))];
      })),
      equal_year_weighting: true,
      query_terms: queryTerms,
      within_subject_year_normalized: true,
    },
  };
}

function knownReferences(row, doctrines, anchors) {
  const doctrine = row.doctrine_id
    ? doctrines.find((candidate) => candidate.id === row.doctrine_id)
    : doctrines.find((candidate) => {
      const docket = String(candidate.citation).match(/(?:G\.R\.\s*(?:Nos?\.)?\s*)[^,]+/iu)?.[0];
      return docket && String(row.citation).includes(docket.replace(/\s+/gu, ' '));
    });
  const anchor = row.anchor_case_id
    ? anchors.find((candidate) => candidate.id === row.anchor_case_id)
    : anchors.find((candidate) => row.citation.includes(candidate.gr_number));
  return {
    doctrineId: doctrine?.id || null,
    anchorCaseId: anchor?.id || null,
  };
}

function authorityRecencyPercentiles(rows) {
  const result = new Map();
  for (const subject of SUBJECTS) {
    const caseRows = rows.filter((row) => (
      row.subject === subject && /\bG\.R\.\s*(?:Nos?\.)?/iu.test(row.citation || '')
    ));
    const dates = unique(caseRows.map((row) => row.authority_date)).sort();
    for (const row of caseRows) {
      const index = dates.indexOf(row.authority_date);
      result.set(row.id, dates.length <= 1 ? 1 : index / (dates.length - 1));
    }
  }
  return result;
}

function applyReplacement(base, replacement) {
  const preservedSupersedes = unique([
    ...(base.supersedes_question_ids || []),
    base.source_question_id,
    replacement.source_question_id,
  ]);
  return {
    ...removeReplacementLineage(base),
    ...replacement,
    supersedes_question_ids: preservedSupersedes,
  };
}

async function main() {
  const [forecast, unitsSource, bankSource, manifest, doctrinesSource, anchorsSource] = await Promise.all([
    readFile(FORECAST_URL, 'utf8').then(JSON.parse),
    readFile(UNITS_URL, 'utf8').then(JSON.parse),
    readFile(QUESTION_BANK_URL, 'utf8').then(JSON.parse),
    readFile(MANIFEST_URL, 'utf8').then(JSON.parse),
    readFile(DOCTRINES_URL, 'utf8').then(JSON.parse),
    readFile(ANCHORS_URL, 'utf8').then(JSON.parse),
  ]);
  const units = unitsSource.rows;
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const bankById = new Map(bankSource.records.map((record) => [record['Question ID'], record]));
  const replacements = replacementSpecs(bankById);
  const certifiedRecords = manifest.records.filter((record) => record.status === 'source-certified');
  if (certifiedRecords.length !== 318) throw new Error(`Expected 318 certified historical records; found ${certifiedRecords.length}.`);
  const historical = historicalModel({ units, certifiedRecords, bankById });
  const maxLebBySubject = new Map(SUBJECTS.map((subject) => [
    subject,
    Math.max(...units.filter((unit) => unit.subject === subject).map((unit) => Number(unit.leb_prior_weight))),
  ]));

  const revised = [];
  for (const baseRow of forecast.rows) {
    const originalRank = Number(baseRow.rank_within_subject);
    const assignment = SYLLABUS_UNIT_OVERRIDES[baseRow.id]
      || baseRow.syllabus_unit_id
      || INITIAL_UNIT_ASSIGNMENTS[baseRow.subject]?.[originalRank - 1];
    const unit = unitById.get(assignment);
    if (!unit) throw new Error(`${baseRow.id}: missing syllabus unit ${assignment}.`);
    const questionBankId = baseRow.question_bank_id
      || `FCT-2026-Q${String(SUBJECT_BASE[baseRow.subject] + originalRank).padStart(3, '0')}`;
    let row = replacements.has(baseRow.id)
      ? applyReplacement(baseRow, replacements.get(baseRow.id))
      : {
        ...baseRow,
        supersedes_question_ids: unique([
          ...(baseRow.supersedes_question_ids || []),
          baseRow.source_question_id,
        ]),
      };
    const leaf = row.syllabus_leaf || String(row.syllabus_topic)
      .replace(/^[IVX]+\.\s*/u, '')
      .replace(/^[^—-]+[—-]\s*/u, '')
      .trim();
    const explicitLegalBasisSourceUrl = String(row.legal_basis_source_url || '').trim();
    const legalBasisSourceUrl = isApprovedLegalBasisSourceUrl(explicitLegalBasisSourceUrl)
      ? explicitLegalBasisSourceUrl
      : firstElibraryUrl(
        row.primary_source_url,
        row.source_links,
      ) || DEFAULT_ELIB_BY_UNIT[unit.id] || DEFAULT_ELIB_BY_SUBJECT[row.subject];
    const references = knownReferences(row, doctrinesSource.rows, anchorsSource.rows);
    const authorityDate = row.authority_date
      || AUTHORITY_DATE_OVERRIDES[row.id]
      || citationDate(row.citation);
    row = {
      ...row,
      syllabus_unit_id: unit.id,
      syllabus_unit: unit.heading,
      syllabus_leaf: leaf,
      syllabus_path: `${unit.roman}. ${unit.heading} > ${leaf}`,
      syllabus_topic: `${unit.heading} — ${leaf}`,
      leb_course_basis: unit.leb_course_basis,
      leb_prior_weight: unit.leb_prior_weight,
      doctrine_id: row.doctrine_id || references.doctrineId,
      doctrine_key: `doctrine:${sha256(row.controlling_doctrine).slice(0, 20)}`,
      concept_ids: unique([unit.id, `concept:${slug(leaf).slice(0, 64)}`]),
      case_ids: unique([row.chair_case_id, row.anchor_case_id || references.anchorCaseId]),
      authority_key: `authority:${sha256(`${row.jurisprudence}\0${row.citation}`).slice(0, 20)}`,
      question_bank_id: questionBankId,
      question_bank_subject: unit.question_bank_subject,
      legal_basis_source_url: legalBasisSourceUrl,
      source_links: unique([...(row.source_links || []), legalBasisSourceUrl, SYLLABUS_URL])
        .filter((url) => !isUserUploadSourceUrl(url)),
      authority_date: authorityDate,
      authority_year: authorityDate ? Number(authorityDate.slice(0, 4)) : Number(row.authority_year || 0),
      prediction_model_version: '2026.2-syllabus-constrained',
      examinable_cutoff: CUTOFF,
      syllabus_url: SYLLABUS_URL,
      researched_on: REVISION_DATE,
      editorially_revised_on: REVISION_DATE,
      editorial_standard: EDITORIAL_STANDARD,
      status: 'AI_PREPARED_BETA',
      version: SOURCE_VERSION,
      publication_readiness: 'HUMAN_LEGAL_REVIEW_REQUIRED',
    };
    if (row.authority_date && row.authority_date > CUTOFF) {
      throw new Error(`${row.id}: authority date ${row.authority_date} exceeds cutoff ${CUTOFF}.`);
    }
    row.controlling_doctrine_id = row.doctrine_id || row.doctrine_key;
    row.model_version = row.prediction_model_version;
    row.primary_authority_id = row.authority_key;
    row.educator_sources = row.educator_signal?.source_url ? [row.educator_signal.source_url] : [];
    row.official_source_urls = unique([
      row.primary_source_url,
      row.legal_basis_source_url,
      ...(row.source_links || []),
    ]).filter(isOfficialSourceUrl);
    row.cutoff_result = 'PASS_ON_OR_BEFORE_2025-06-30';
    row.legal_review_status = 'HUMAN_LEGAL_REVIEW_REQUIRED';
    delete row.query_terms;
    revised.push(row);
  }

  const recencyPercentiles = authorityRecencyPercentiles(revised);
  for (const row of revised) {
    const unit = unitById.get(row.syllabus_unit_id);
    const score = scoreRow({
      row,
      unit,
      historical,
      maxLebBySubject,
      authorityRecencyPercentile: recencyPercentiles.get(row.id) ?? 1,
    });
    row.prediction_score = score.predictionScore;
    row.prediction_score_unrounded = score.unroundedScore;
    row.final_score = score.predictionScore;
    row.component_raw_scores = score.rawScores;
    row.component_weighted_scores = score.breakdown;
    row.score_breakdown = score.breakdown;
    row.historical_evidence = score.historicalEvidence;
    row.historical_question_ids = score.historicalEvidence.matched_question_ids;
    row.historical_subject_year_denominators = score.historicalEvidence.subject_year_denominators;
    row.historical_yearly_shares = score.historicalEvidence.unit_yearly_shares;
    row.tie_break_evidence = {
      official_primary_source: /^https:\/\/elibrary\.judiciary\.gov\.ph\//u.test(row.primary_source_url || ''),
      historical_year_coverage: score.historicalEvidence.included_years.length,
      authority_date: row.authority_date || null,
      final_fallback: row.question_bank_id,
    };
    row.scoring_note = 'Comparative, within-subject training-priority index under hard syllabus quotas; not a probability or guarantee that the item will appear.';
    row.prediction_rationale = [
      `Official 2026 syllabus allocation: ${unit.target_questions} of 20 for ${unit.heading}.`,
      `Historical evidence was normalized only within ${unit.question_bank_subject} across its certified included years.`,
      `The score combines historical family share, the LEB curriculum prior, syllabus centrality, cutoff-compliant authority, contemporary relevance, and only attributable public educator signals.`,
    ].join(' ');
  }

  const grouped = new Map(SUBJECTS.map((subject) => [subject, []]));
  for (const row of revised) grouped.get(row.subject).push(row);
  const ranked = [];
  for (const subject of SUBJECTS) {
    const rows = grouped.get(subject).sort((left, right) => (
      right.prediction_score_unrounded - left.prediction_score_unrounded
      || Number(right.tie_break_evidence.official_primary_source) - Number(left.tie_break_evidence.official_primary_source)
      || right.tie_break_evidence.historical_year_coverage - left.tie_break_evidence.historical_year_coverage
      || String(right.tie_break_evidence.authority_date).localeCompare(String(left.tie_break_evidence.authority_date))
      || left.question_bank_id.localeCompare(right.question_bank_id)
    ));
    rows.forEach((row, index) => {
      row.rank_within_subject = index + 1;
      row.editorial_ref = `${EDITORIAL_PREFIX[subject]}-${String(index + 1).padStart(2, '0')}`;
      ranked.push(row);
    });
  }

  const subjectCounts = Object.fromEntries(SUBJECTS.map((subject) => [
    subject,
    ranked.filter((row) => row.subject === subject).length,
  ]));
  const sourceSha256 = sha256(stableJson(ranked));
  const payload = {
    source: {
      ...forecast.source,
      methodology_version: '2026.2-syllabus-constrained',
      generated_on: REVISION_DATE,
      official_syllabus_url: SYLLABUS_URL,
      leb_curriculum_url: LEB_URL,
      examinable_cutoff: CUTOFF,
      historical_corpus_count: 318,
      scoring_weights: {
        historical_frequency: 35,
        leb_curriculum_prior: 25,
        official_syllabus_centrality: 20,
        cutoff_compliant_jurisprudence: 10,
        contemporary_or_technology_relevance: 5,
        attributable_educator_signal: 5,
      },
      allocation_source: 'content/duediligence-2026/syllabus-units.json',
      methodology_source: 'content/duediligence-2026/bar-forecast-methodology.json',
      question_bank_projection: 'scripts/project-bar-forecast-to-question-bank.mjs',
      disclaimer: 'Syllabus-constrained training priorities only. Scores are comparative within-subject indices, not probabilities, leaks, or guarantees of Bar coverage.',
      editorial_revision_standard: '2025 Bar questionnaire style; one yes-or-no question; one controlling doctrine; responsive ALAC; reasoned Conclusion led by Thus, Hence, or Wherefore',
      editorial_review_count: 120,
      question_replacement_count: replacements.size,
      editorial_revision_date: REVISION_DATE,
      version: SOURCE_VERSION,
      source_sha256: sourceSha256,
    },
    count: ranked.length,
    subject_counts: subjectCounts,
    source_sha256: sourceSha256,
    rows: ranked,
  };
  await writeFile(FORECAST_URL, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    rows: ranked.length,
    replacements: replacements.size,
    sourceSha256,
    questionBankIds: new Set(ranked.map((row) => row.question_bank_id)).size,
    supersededQuestionIds: new Set(ranked.flatMap((row) => row.supersedes_question_ids)).size,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
