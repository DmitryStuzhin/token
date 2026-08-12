const test = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../../modules/identity/application/access-policy.js');

test('role × resource × action matrix is deny-by-default', () => {
  assert.equal(Policy.roleAllows('student', 'attempt', 'update_own'), true);
  assert.equal(Policy.roleAllows('student', 'attempt', 'review_owned'), false);
  assert.equal(Policy.roleAllows('tutor', 'lesson', 'update_owned'), true);
  assert.equal(Policy.roleAllows('parent', 'lesson', 'update_owned'), false);
  assert.equal(Policy.roleAllows('unknown', 'user', 'manage'), false);
});

test('object policies isolate attempts and tutor-owned resources', async () => {
  assert.equal(Policy.ownAttempt('student-a', { student_id: 'student-a' }), true);
  assert.equal(Policy.ownAttempt('student-a', { student_id: 'student-b' }), false);
  assert.equal(Policy.owns('tutor-a', { tutor_id: 'tutor-a' }, 'tutor_id'), true);
  assert.equal(Policy.owns('tutor-a', { tutor_id: 'tutor-b' }, 'tutor_id'), false);
  const repository = {
    async findOwnedLesson(tutorId, lessonId) {
      return tutorId === 'tutor-a' && lessonId === 'lesson-a' ? { id: lessonId } : null;
    },
    async tutorOwnsStudent(tutorId, studentId) {
      return tutorId === 'tutor-a' && studentId === 'student-a';
    },
  };
  assert.equal((await Policy.ownedLesson(repository, 'tutor-a', 'lesson-a')).id, 'lesson-a');
  assert.equal(await Policy.ownedLesson(repository, 'tutor-b', 'lesson-a'), null);
  assert.equal(await Policy.ownedStudent(repository, 'tutor-a', 'student-a'), true);
  assert.equal(await Policy.ownedStudent(repository, 'tutor-a', 'student-b'), false);
});
