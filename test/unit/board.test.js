const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { LessonBoards, wins, sanitize, MAX_ELEMENTS } = require('../../server/board.js');

const element = (id, version, nonce = 1, extra = {}) => ({
  id, type: 'freedraw', version, versionNonce: nonce, ...extra,
});

function fakeRepository(initial = []) {
  const saved = [];
  return {
    saved,
    async loadBoard() { return initial; },
    async saveBoard(lessonId, elements) { saved.push({ lessonId, elements }); },
  };
}

test('merge keeps the higher version and breaks ties by nonce', () => {
  assert.equal(wins(element('a', 2), element('a', 1)), true);
  assert.equal(wins(element('a', 1), element('a', 2)), false);
  assert.equal(wins(element('a', 3, 20), element('a', 3, 10)), true);
  assert.equal(wins(element('a', 3, 10), element('a', 3, 20)), false);
  // Одинаковые элементы не «выигрывают» друг у друга, иначе получится эхо.
  assert.equal(wins(element('a', 3, 10), element('a', 3, 10)), false);
  assert.equal(wins(element('a', 1), null), true);
});

test('rubbish from the browser never reaches the scene', () => {
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({ type: 'freedraw' }), null, 'без id');
  assert.equal(sanitize({ id: 'a' }), null, 'без типа');
  assert.equal(sanitize({ id: 'x'.repeat(101), type: 'freedraw' }), null, 'слишком длинный id');
  assert.equal(
    sanitize({ id: 'a', type: 'freedraw', points: new Array(4001).fill([0, 0]) }),
    null,
    'кривая с абсурдным числом точек',
  );
  assert.ok(sanitize(element('a', 1)));
});

test('only elements that actually changed are relayed', async () => {
  const boards = new LessonBoards(fakeRepository());
  const first = await boards.apply('lesson', [element('a', 1), element('b', 1)]);
  assert.deepEqual(first.map(item => item.id), ['a', 'b']);

  // Повтор той же версии рассылать нельзя: это бесконечное эхо между клиентами.
  assert.deepEqual(await boards.apply('lesson', [element('a', 1)]), []);
  // Устаревшая правка проигрывает и тоже не рассылается.
  assert.deepEqual(await boards.apply('lesson', [element('a', 1, 0)]), []);

  const updated = await boards.apply('lesson', [element('a', 2)]);
  assert.deepEqual(updated.map(item => item.version), [2]);
  assert.equal((await boards.elements('lesson')).length, 2);
});

test('a stale update cannot resurrect an element deleted by the other side', async () => {
  const boards = new LessonBoards(fakeRepository());
  await boards.apply('lesson', [element('a', 5)]);
  await boards.apply('lesson', [element('a', 6, 1, { isDeleted: true })]);
  assert.deepEqual(await boards.apply('lesson', [element('a', 4)]), []);
  const [stored] = await boards.elements('lesson');
  assert.equal(stored.isDeleted, true);
});

test('the scene has a ceiling, but existing elements stay editable', async () => {
  const boards = new LessonBoards(fakeRepository());
  const many = Array.from({ length: MAX_ELEMENTS }, (_, index) => element(`e${index}`, 1));
  for (let start = 0; start < many.length; start += 400) {
    await boards.apply('lesson', many.slice(start, start + 400));
  }
  assert.equal((await boards.elements('lesson')).length, MAX_ELEMENTS);
  assert.deepEqual(await boards.apply('lesson', [element('overflow', 1)]), [], 'новые не влезают');
  assert.equal((await boards.apply('lesson', [element('e0', 2)])).length, 1, 'старые правятся');
});

test('the scene is restored from storage and written back once released', async () => {
  const repository = fakeRepository([element('saved', 3)]);
  const boards = new LessonBoards(repository);
  assert.deepEqual((await boards.elements('lesson')).map(item => item.id), ['saved']);
  await boards.apply('lesson', [element('fresh', 1)]);
  await boards.release('lesson');
  assert.equal(repository.saved.length, 1);
  assert.deepEqual(repository.saved[0].elements.map(item => item.id), ['saved', 'fresh']);
});
