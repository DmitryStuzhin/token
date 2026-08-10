const fs = require('node:fs');
const path = require('node:path');

const databaseFile = path.join(__dirname, '..', 'data', 'e2e.db');
for (const suffix of ['', '-shm', '-wal']) {
  const target = databaseFile + suffix;
  if (fs.existsSync(target)) fs.rmSync(target);
}

process.env.NODE_ENV = 'test';
process.env.PORT = '3101';
process.env.TOKEN_DB = databaseFile;
process.env.COOKIE_SECURE = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.TRUST_PROXY = 'true';

require('../server/index.js');
