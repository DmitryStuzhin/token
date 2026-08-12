const test = require('node:test');
const assert = require('node:assert/strict');

const { htmlToText, normalizeTask } = require('../../scripts/import-kompege-tasks.js');

test('HTML условия КЕГЭ преобразуется в читаемый текст', () => {
  assert.equal(
    htmlToText('<p>Размер равен 2<sup>10</sup>&nbsp;байт.<br>Найдите ответ.</p>'),
    'Размер равен 2^10 байт.\nНайдите ответ.',
  );
});

test('задание КЕГЭ получает устойчивый ID и шкалу сложности Token', () => {
  const task = normalizeTask(
    {
      taskId: 123,
      text: '<p>Условие</p>',
      key: 'А280',
      difficulty: 2,
      createdAt: '2026-01-02T00:00:00.000Z',
      files: [{ name: 'data.txt', url: '/files/data.txt' }],
    },
    7,
  );
  assert.equal(task.id, 'kompege-7-123');
  assert.equal(task.difficulty, 3);
  assert.equal(task.compare, 'ci');
  assert.equal(task.taskType, 'files');
  assert.equal(task.attachments[0].url, 'https://kompege.ru/files/data.txt');
});
