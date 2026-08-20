import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const defaultRenovationBaseline = '474ca979193b520b91641e47a08a5dab68931ea4';
const renovationBaseline = process.env.RENOVATION_BASE_REF || defaultRenovationBaseline;
const ownedTestPrefix = 'scripts/renovation-20260820/';

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

function nulSeparatedPaths(output) {
  return output
    .split('\0')
    .map((value) => value.trim().replaceAll('\\', '/'))
    .filter(Boolean);
}

function isDedicatedExaminationRoomPath(file) {
  return /(?:^|\/)[^/]*(?:examination[-_ ]room|exam[-_ ]room)[^/]*(?:\/|$)/i.test(file)
    || /(?:^|\/)worker\/exam-results-(?:workbook|pdf)(?:\.[^/]+)?$/i.test(file)
    || /(?:^|\/)content\/[^/]+\/exam-room-schema\.json$/i.test(file);
}

test('this renovation branch leaves dedicated Examination Room files untouched', () => {
  git(['rev-parse', '--verify', `${renovationBaseline}^{commit}`]);
  const trackedChanges = nulSeparatedPaths(git([
    'diff',
    '--name-only',
    '--diff-filter=ACDMRTUXB',
    '-z',
    renovationBaseline,
    '--',
  ]));
  const untrackedChanges = nulSeparatedPaths(git([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]));
  const changedPaths = [...new Set([...trackedChanges, ...untrackedChanges])]
    .filter((file) => !file.startsWith(ownedTestPrefix));
  const examinationRoomChanges = changedPaths.filter(isDedicatedExaminationRoomPath);

  assert.deepEqual(
    examinationRoomChanges,
    [],
    [
      `dedicated Examination Room files changed relative to ${renovationBaseline}.`,
      'Shared shell files are intentionally not classified by this focused guard.',
      ...examinationRoomChanges,
    ].join('\n'),
  );
});
