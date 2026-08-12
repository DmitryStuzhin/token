const fs = require('fs');
const path = require('path');

const Domain = require('../shared/domain.js');

const DEFAULT_BASE_URL = 'https://kompege.ru/api/v1';

function decodeHtml(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '…',
    laquo: '«',
    le: '≤',
    lt: '<',
    mdash: '—',
    middot: '·',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    raquo: '»',
    times: '×',
  };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const hex = entity[1].toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function htmlToText(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<\/div\s*>/gi, '\n')
      .replace(/<\/tr\s*>/gi, '\n')
      .replace(/<\/td\s*>/gi, '\t')
      .replace(/<sup\b[^>]*>/gi, '^')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAttachment(file) {
  if (!file || !file.url) return null;
  const url = new URL(String(file.url), 'https://kompege.ru').href;
  return {
    name: String(file.name || path.basename(new URL(url).pathname) || 'Файл к заданию'),
    url,
    kind: 'file',
  };
}

function normalizeTask(sourceTask, number) {
  const answer = String(sourceTask.key || '').trim();
  const numeric = /^-?\d+(?:[.,]\d+)?$/.test(answer);
  return {
    id: `kompege-${number}-${sourceTask.taskId}`,
    subjectId: 'inf',
    number,
    title: `Задание КЕГЭ №${sourceTask.taskId}`,
    statement: htmlToText(sourceTask.text),
    answer,
    answerType: numeric ? 'number' : 'string',
    compare: numeric ? 'numeric' : 'ci',
    tolerance: 0,
    autoCheck: Boolean(answer),
    difficulty: Math.max(1, Math.min(3, Number(sourceTask.difficulty || 0) + 1)),
    source: 'kompege',
    publishedAt: sourceTask.createdAt || new Date().toISOString(),
    taskType: Array.isArray(sourceTask.files) && sourceTask.files.length ? 'files' : 'answer',
    attachments: (sourceTask.files || []).map(normalizeAttachment).filter(Boolean),
  };
}

async function fetchTasks(number, baseUrl = DEFAULT_BASE_URL) {
  const response = await fetch(`${baseUrl}/task/number/${encodeURIComponent(number)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Token task importer/1.0' },
  });
  if (!response.ok) throw new Error(`КЕГЭ вернул HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error('КЕГЭ вернул неожиданный формат данных');
  return body;
}

function partOf(subjectId, number) {
  const subject = Domain.subjects.find((item) => item.id === subjectId);
  return subject?.exam.parts.find((part) => part.number === Number(number)) || null;
}

async function createRepository() {
  const { loadConfig } = require('../server/config.js');
  const config = loadConfig();
  if (config.databaseDriver === 'postgres') {
    const { createContainer } = require('../modules/composition.ts');
    const {
      PostgresPlatformRepository,
    } = require('../modules/platform/infrastructure/postgres-platform-repository.js');
    const services = createContainer(config);
    return { repository: new PostgresPlatformRepository(services.pool), close: services.close };
  }
  const {
    SqlitePlatformRepository,
  } = require('../modules/platform/infrastructure/sqlite-platform-repository.js');
  return { repository: new SqlitePlatformRepository(), close: async () => {} };
}

async function importTasks(tasks, batchSize = 25) {
  const { repository, close } = await createRepository();
  try {
    const missing = [];
    for (const task of tasks) {
      if (!(await repository.taskExists(task.id))) missing.push(task);
    }
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      await repository.insertTasks(missing.slice(offset, offset + batchSize), partOf);
    }
    return { imported: missing.length, skipped: tasks.length - missing.length };
  } finally {
    await close();
  }
}

function parseArgs(argv) {
  const numberIndex = argv.indexOf('--number');
  const outputIndex = argv.indexOf('--output');
  return {
    number: Number(numberIndex >= 0 ? argv[numberIndex + 1] : 7),
    output: outputIndex >= 0 ? argv[outputIndex + 1] : null,
    write: argv.includes('--write'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(options.number) || options.number < 1 || options.number > 27) {
    throw new Error('--number должен быть целым числом от 1 до 27');
  }
  const raw = await fetchTasks(options.number);
  const tasks = raw.map((task) => normalizeTask(task, options.number));
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error('КЕГЭ вернул повторяющиеся ID');
  if (tasks.some((task) => !task.statement))
    throw new Error('После очистки осталось пустое условие');

  if (options.output) {
    const target = path.resolve(options.output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(tasks, null, 2)}\n`);
  }

  const summary = {
    fetched: tasks.length,
    autoCheck: tasks.filter((task) => task.autoCheck).length,
    manualCheck: tasks.filter((task) => !task.autoCheck).length,
    attachments: tasks.reduce((sum, task) => sum + task.attachments.length, 0),
  };
  if (options.write) Object.assign(summary, await importTasks(tasks));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  decodeHtml,
  htmlToText,
  normalizeAttachment,
  normalizeTask,
  fetchTasks,
  importTasks,
};
