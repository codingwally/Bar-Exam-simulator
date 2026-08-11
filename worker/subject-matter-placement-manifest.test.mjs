import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUBJECT_MATTER_COURSES,
  SUBJECT_MATTER_EXPECTED,
  SUBJECT_MATTER_PLACEMENTS,
  SUBJECT_MATTER_PLACEMENT_MANIFEST_SHA256,
} from './subject-matter-placement-manifest.mjs';

test('the authoritative Subject Matter placement contract is exact', () => {
  assert.match(SUBJECT_MATTER_PLACEMENT_MANIFEST_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(SUBJECT_MATTER_COURSES.length, SUBJECT_MATTER_EXPECTED.courses);
  assert.equal(SUBJECT_MATTER_PLACEMENTS.length, SUBJECT_MATTER_EXPECTED.placements);
  assert.equal(SUBJECT_MATTER_COURSES.filter((course) => course.classification === 'major').length, 35);
  assert.equal(SUBJECT_MATTER_COURSES.filter((course) => course.classification === 'minor').length, 7);
});

test('every course has its exact reviewed slot and difficulty allocation', () => {
  const slotKeys = new Set();
  for (const course of SUBJECT_MATTER_COURSES) {
    const placements = SUBJECT_MATTER_PLACEMENTS.filter((row) => row[0] === course.code);
    assert.equal(placements.length, course.target, course.code);
    assert.equal(new Set(placements.map((row) => row[1])).size, course.target, course.code);
    assert.equal(new Set(placements.map((row) => row[2])).size, course.target, course.code);
    for (const [difficulty, expected] of Object.entries(course.difficulty)) {
      assert.equal(
        placements.filter((row) => row[4] === difficulty).length,
        expected,
        `${course.code}/${difficulty}`,
      );
    }
    for (const placement of placements) {
      assert.equal(slotKeys.has(`${placement[0]}:${placement[1]}`), false);
      slotKeys.add(`${placement[0]}:${placement[1]}`);
    }
  }
});

test('direct and integration reuse is bounded and intentional', () => {
  const direct = SUBJECT_MATTER_PLACEMENTS.filter((row) => row[5] === 'direct');
  const integration = SUBJECT_MATTER_PLACEMENTS.filter((row) => row[5] === 'integration');
  const uses = new Map();
  SUBJECT_MATTER_PLACEMENTS.forEach((row) => uses.set(row[2], [...(uses.get(row[2]) || []), row]));
  assert.equal(direct.length, 1490);
  assert.equal(integration.length, 400);
  assert.equal(uses.size, 1490);
  assert.equal([...uses.values()].filter((rows) => rows.length === 2).length, 400);
  assert.equal(Math.max(...[...uses.values()].map((rows) => rows.length)), 2);
  for (const rows of uses.values()) {
    assert.equal(rows.filter((row) => row[5] === 'direct').length, 1);
    assert.equal(rows.filter((row) => row[5] === 'integration').length, rows.length - 1);
  }
  assert.deepEqual(
    [...new Set(integration.map((row) => row[0]))].sort(),
    ['JD202', 'JD307', 'JD403', 'JD507', 'JD606', 'JD705', 'JD802', 'JD902'],
  );
});
