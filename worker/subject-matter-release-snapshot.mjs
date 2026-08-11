import part01 from './subject-matter-release-snapshot/part-01.json' with { type: 'json' };
import part02 from './subject-matter-release-snapshot/part-02.json' with { type: 'json' };
import part03 from './subject-matter-release-snapshot/part-03.json' with { type: 'json' };
import part04 from './subject-matter-release-snapshot/part-04.json' with { type: 'json' };
import part05 from './subject-matter-release-snapshot/part-05.json' with { type: 'json' };
import part06 from './subject-matter-release-snapshot/part-06.json' with { type: 'json' };
import part07 from './subject-matter-release-snapshot/part-07.json' with { type: 'json' };
import part08 from './subject-matter-release-snapshot/part-08.json' with { type: 'json' };
import part09 from './subject-matter-release-snapshot/part-09.json' with { type: 'json' };

export const SUBJECT_MATTER_RELEASE_VALUES = Object.freeze([
  ...part01,
  ...part02,
  ...part03,
  ...part04,
  ...part05,
  ...part06,
  ...part07,
  ...part08,
  ...part09,
]);

export const SUBJECT_MATTER_RELEASE_SNAPSHOT = Object.freeze({
  spreadsheetId: '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A',
  sheet: 'LEB Y1-Y2 Exam Bank',
  range: 'A1:U1623',
  rowsIncludingHeader: SUBJECT_MATTER_RELEASE_VALUES.length,
  capturedAt: '2026-08-11',
  csvSha256: '7565DA182003B2AD5E202FEAE7D424C245ECA93E7D362C566D241A6E4C6A30E7',
});
