import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';

const number = Number(process.argv[2]);
if (!Number.isInteger(number) || number < 1 || number > 27) {
  console.error('Использование: node scripts/export-kompege.js <номер 1..27>');
  process.exit(1);
}

const endpoint = `https://kompege.ru/api/v1/task/number/${number}`;
const response = await fetch(endpoint, {
  headers: { accept: 'application/json', 'user-agent': 'Token task exporter/0.1' },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`КомпЕГЭ вернул HTTP ${response.status}`);
const source = await response.json();
if (!Array.isArray(source)) throw new Error('Источник вернул данные неизвестного формата');

function plainText(html) {
  const safe = sanitizeHtml(String(html || ''), {
    allowedTags: ['p','br','b','strong','i','em','u','s','sub','sup','ul','ol','li','table','thead','tbody','tr','th','td','blockquote','code','pre'],
    allowedAttributes: {},
  });
  const $ = cheerio.load(safe);
  $('br').replaceWith('\n');
  $('p,li,tr,blockquote,pre').each((_, element) => $(element).append('\n'));
  return $('body').text().replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

const tasks = source.map(item => {
  const answer = item.hide ? '' : String(item.key ?? '').trim();
  const numeric = /^[-+]?\d+(?:[.,]\d+)?$/.test(answer);
  return {
    id: `kompege-${item.taskId}`,
    subjectId: 'inf',
    number: item.number,
    topicId: number === 5 ? 't-num' : undefined,
    title: item.comment?.trim() || `КомпЕГЭ №${item.taskId}`,
    statement: plainText(item.text),
    answer,
    answerType: numeric ? 'number' : 'string',
    compare: 'exact',
    autoCheck: Boolean(answer),
    difficulty: Math.max(1, Math.min(3, Number(item.difficulty) || 2)),
    source: 'kompege',
    sourceId: String(item.taskId),
    sourceUrl: `https://kompege.ru/task?id=${item.taskId}`,
  };
});

const ids = new Set();
for (const task of tasks) {
  if (ids.has(task.id)) throw new Error(`Повторный id ${task.id}`);
  ids.add(task.id);
  if (!task.statement) throw new Error(`Пустое условие ${task.id}`);
}

await mkdir('data/imports', { recursive: true });
const target = path.resolve(`data/imports/kompege-task-${number}.json`);
await writeFile(target, JSON.stringify(tasks, null, 2) + '\n');
console.log(JSON.stringify({ target, count: tasks.length, endpoint }));
