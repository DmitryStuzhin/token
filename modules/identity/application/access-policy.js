const ACCESS_MATRIX = Object.freeze({
  student: Object.freeze({
    attempt: ['create', 'read_own', 'update_own', 'submit_own'],
    invite: ['read', 'accept'],
    lesson: ['read_member'],
    profile: ['read_own', 'update_own'],
  }),
  tutor: Object.freeze({
    assignment: ['create_owned'],
    attempt: ['read_owned', 'coach_owned', 'review_owned'],
    group: ['create', 'read_owned', 'update_owned'],
    invite: ['create_owned', 'read_owned', 'revoke_owned'],
    lesson: ['create_owned', 'read_owned', 'update_owned'],
    profile: ['read_own', 'update_own'],
    task: ['import'],
  }),
  parent: Object.freeze({ profile: ['read_own'], student: ['read_linked'] }),
  admin: Object.freeze({ security: ['read', 'manage'], user: ['read', 'manage'] }),
});

function roleAllows(role, resource, action) {
  return ACCESS_MATRIX[role]?.[resource]?.includes(action) === true;
}

function owns(actorId, row, ownerColumn) {
  return Boolean(actorId && row && row[ownerColumn] === actorId);
}

function ownAttempt(studentId, attempt) {
  return owns(studentId, attempt, 'student_id');
}

async function ownedStudent(repository, tutorId, studentId) {
  return Boolean(tutorId && studentId && (await repository.tutorOwnsStudent(tutorId, studentId)));
}

async function ownedLesson(repository, tutorId, lessonId) {
  if (!roleAllows('tutor', 'lesson', 'update_owned')) return null;
  return repository.findOwnedLesson(tutorId, lessonId);
}

module.exports = { ACCESS_MATRIX, roleAllows, owns, ownAttempt, ownedStudent, ownedLesson };
