const fixture = Object.freeze({
  tutor: Object.freeze({
    name: 'Тестовый Репетитор',
    email: 'tutor@example.test',
    password: 'test-password',
    role: 'tutor',
    subjects: ['inf'],
    yearsExp: 5,
    rate: 3000,
  }),
  student: Object.freeze({
    name: 'Тестовый Ученик',
    email: 'student@example.test',
    password: 'test-password',
    role: 'student',
    grade: 11,
    school: 'Тестовая школа',
  }),
  secondStudent: Object.freeze({
    name: 'Второй Ученик',
    email: 'student-two@example.test',
    password: 'test-password',
    role: 'student',
    grade: 10,
    school: 'Другая школа',
  }),
  parentStub: Object.freeze({
    name: 'Тестовый Родитель',
    email: 'parent@example.test',
    password: 'test-password',
    role: 'parent',
    enabled: false,
  }),
  group: Object.freeze({
    subjectId: 'inf',
    title: 'Тестовая группа',
    level: 'профиль',
    schedule: 'Вт, Чт 18:00',
    capacity: 8,
  }),
  individualRelationship: Object.freeze({
    kind: 'enrollment',
    subjectId: 'inf',
    maxUses: 1,
  }),
  lesson: Object.freeze({
    durationMin: 60,
    startsInMs: 60_000,
  }),
  taskSelection: Object.freeze({
    subjectId: 'inf',
    autoCheck: true,
  }),
});

function withUniqueEmail(user, prefix = 'test') {
  const local = user.email.split('@')[0];
  return { ...user, email: `${local}-${prefix}-${Date.now()}@example.test` };
}

module.exports = { fixture, withUniqueEmail };
