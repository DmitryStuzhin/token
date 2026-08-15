const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-conflicts-'));
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.TOKEN_DB = path.join(dir, 'db.sqlite');

const { db } = require('../../server/db.js');
const {
  SqlitePlatformRepository,
} = require('../../modules/platform/infrastructure/sqlite-platform-repository.js');

const repository = new SqlitePlatformRepository();
const START = new Date('2026-09-01T10:00:00.000Z').toISOString();

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function lesson(id, startsAt, durationMin = 60) {
  db.prepare(
    `INSERT INTO lessons (id,subject_id,tutor_id,enrollment_id,starts_at,duration_min,status)
     VALUES (?,'inf','tutor-1','enr-1',?,?,'planned')`,
  ).run(id, startsAt, durationMin);
}

test('an overlapping lesson is detected, a touching one is not', async () => {
  lesson('l1', START, 60);

  // Ровно то же время. Именно этот случай молча проходил: конец интервала
  // считался через datetime() и в строковом сравнении всегда проигрывал ISO.
  assert.ok(await repository.lessonConflicts('tutor-1', START, 60, []), 'полное совпадение');

  const inside = new Date(Date.parse(START) + 30 * 60000).toISOString();
  assert.ok(await repository.lessonConflicts('tutor-1', inside, 60, []), 'частичное наложение');

  const before = new Date(Date.parse(START) - 30 * 60000).toISOString();
  assert.ok(await repository.lessonConflicts('tutor-1', before, 60, []), 'наложение слева');

  // Встык — не конфликт: занятие начинается ровно когда предыдущее кончилось.
  const touching = new Date(Date.parse(START) + 60 * 60000).toISOString();
  assert.equal(await repository.lessonConflicts('tutor-1', touching, 60, []), null, 'встык');

  const far = new Date(Date.parse(START) + 4 * 3600000).toISOString();
  assert.equal(await repository.lessonConflicts('tutor-1', far, 60, []), null, 'в другое время');

  // Чужое расписание не мешает.
  assert.equal(await repository.lessonConflicts('tutor-2', START, 60, []), null, 'другой репетитор');

  // Перенос самого занятия не должен конфликтовать сам с собой.
  assert.equal(
    await repository.lessonConflicts('tutor-1', START, 60, [], 'l1'),
    null,
    'исключение по id',
  );
});
