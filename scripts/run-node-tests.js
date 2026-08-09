const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const outputDir = path.join(__dirname, '..', 'test-results');
fs.mkdirSync(outputDir, { recursive: true });
const rootDir = path.join(__dirname, '..');
const testFiles = ['test/unit', 'test/integration'].flatMap(directory =>
  fs.readdirSync(path.join(rootDir, directory))
    .filter(file => file.endsWith('.test.js') || file.endsWith('.test.ts'))
    .sort()
    .map(file => path.join(directory, file)));

const result = spawnSync(process.execPath, [
  '--import',
  'tsx',
  '--test',
  '--test-concurrency=1',
  '--test-reporter=junit',
  `--test-reporter-destination=${path.join(outputDir, 'node-junit.xml')}`,
  ...testFiles,
], { cwd: rootDir, stdio: 'inherit' });

process.exitCode = result.status == null ? 1 : result.status;
