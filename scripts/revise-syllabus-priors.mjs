import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_URL = new URL('../content/duediligence-2026/syllabus-units.json', import.meta.url);

const course = (name, units) => ({ course: name, units });
const constitutional = Object.freeze([
  course('Constitutional Law I', 4),
  course('Constitutional Law II', 3),
]);

const mapping = Object.freeze({
  'POL-I': constitutional,
  'POL-II': constitutional,
  'POL-III': constitutional,
  'POL-IV': constitutional,
  'POL-V': constitutional,
  'POL-VI': constitutional,
  'POL-VII': constitutional,
  'POL-VIII': constitutional,
  'POL-IX': constitutional,
  'POL-X': [course('Administrative Law and Law on Public Officers', 2)],
  'POL-XI': [course('Administrative Law and Law on Public Officers', 2)],
  'POL-XII': [course('Election Laws', 1)],
  'POL-XIII': [course('Laws on Local Government', 2)],
  'POL-XIV': [course('Public International Law', 3)],

  'COM-I': [course('Corporation and Basic Securities Law', 3), course('Agency, Trust and Partnership Law', 2)],
  'COM-II': [course('Commercial Laws I', 3)],
  'COM-III': [course('Commercial Laws I', 3)],
  'COM-IV': [course('Commercial Laws I', 3)],
  'COM-V': [course('Commercial Laws I', 3)],
  'COM-VI': [course('Commercial Laws I', 3)],
  'COM-VIII': [course('Basic Taxation Law', 3)],

  'CIV-I': [course('Statutory Construction', 2)],
  'CIV-II': [course('Persons and Family Law', 3)],
  'CIV-III': [course('Persons and Family Law', 3)],
  'CIV-IV': [course('Persons and Family Law', 3)],
  'CIV-V': [course('Property and Land Law', 4)],
  'CIV-VI': [course('Property and Land Law', 4)],
  'CIV-VII': [course('Basic Succession Law', 2)],
  'CIV-VIII': [course('Obligations and Contracts', 5)],
  'CIV-IX': [course('Agency, Trust and Partnership Law', 2)],
  'CIV-X': [course('Obligations and Contracts', 5)],
  'CIV-XI': [course('Obligations and Contracts', 5)],
  'CIV-XII': [course('Obligations and Contracts', 5)],

  'LAB-I': [course('Labor Law and Social Legislation', 4)],
  'LAB-II': [course('Labor Law and Social Legislation', 4)],
  'LAB-III': [course('Labor Law and Social Legislation', 4)],
  'LAB-IV': [course('Labor Law and Social Legislation', 4)],
  'LAB-V': [course('Labor Law and Social Legislation', 4)],
  'LAB-VI': [course('Labor Law and Social Legislation', 4)],
  'LAB-VII': [course('Labor Law and Social Legislation', 4)],
  'LAB-VIII': [course('Labor Law and Social Legislation', 4)],

  'CRIM-I': [course('Criminal Law I', 3)],
  'CRIM-II': [course('Criminal Law I', 3)],
  'CRIM-III': [course('Criminal Law II', 4)],

  'REM-I': [course('Civil Procedure I', 3)],
  'REM-II': [course('Civil Procedure I', 3)],
  'REM-III': [course('Civil Procedure I', 3), course('Civil Procedure II', 3)],
  'REM-IV': [course('Civil Procedure II', 3)],
  'REM-V': [course('Civil Procedure II', 3)],
  'REM-VI': [course('Special Rules and Proceedings', 3)],
  'REM-VII': [course('Criminal Procedure', 3)],
  'REM-VIII': [course('Evidence', 3)],
  'REM-IX': [course('Basic Legal and Judicial Ethics', 3)],
  'REM-X': [course('Clinical Legal Education', 2)],
});

const source = JSON.parse(await readFile(SOURCE_URL, 'utf8'));
const ids = source.rows.map((row) => row.id);
const missing = ids.filter((id) => !mapping[id]);
const stale = Object.keys(mapping).filter((id) => !ids.includes(id));
if (missing.length || stale.length) {
  throw new Error(`LEB mapping mismatch. Missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'}.`);
}

source.rows = source.rows.map((row) => {
  const lebCourseBasis = mapping[row.id];
  return {
    ...row,
    leb_course_basis: lebCourseBasis,
    leb_prior_weight: lebCourseBasis.reduce((sum, entry) => sum + entry.units, 0),
    syllabus_centrality: 1,
  };
});

await writeFile(SOURCE_URL, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, units: source.rows.length }, null, 2));
