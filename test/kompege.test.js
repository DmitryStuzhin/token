import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTask, parseExternalId } from '../server/kompege.js';

test('parseExternalId accepts an id and a canonical URL', () => {
  assert.equal(parseExternalId('23570'), '23570');
  assert.equal(parseExternalId('https://kompege.ru/task?id=2395'), '2395');
  assert.throws(() => parseExternalId('https://example.com/task?id=1'));
});

test('normalizeTask sanitizes markup and discovers assets', () => {
  const task = normalizeTask({
    taskId: 42, number: 26, comment: 'Проверка', difficulty: 2, key: '10 20',
    text: '<p>Условие<script>alert(1)</script><img src="/img/a.png"></p>',
    files: [{ url: '/files/26.txt', name: '26.txt' }],
  });
  assert.equal(task.externalId, '42');
  assert.equal(task.examNumber, 26);
  assert.equal(task.compareMode, 'set');
  assert.equal(task.assets.length, 2);
  assert.doesNotMatch(task.statementHtml, /script/);
  assert.match(task.statementHtml, /https:\/\/kompege\.ru\/img\/a\.png/);
  assert.equal(task.contentHash.length, 64);
});
