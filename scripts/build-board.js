/**
 * Сборка доски занятия. Отдельный шаг, потому что весь остальной фронтенд
 * Token — ванильный и обходится без сборки; бандлер заведён ровно под редактор.
 *
 * Результат складывается в public/vendor и не коммитится: это артефакт,
 * который обязан пересобираться и в CI, и при сборке образа.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'vendor');
const fonts = path.join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

execFileSync(
  path.join(root, 'node_modules', '.bin', 'esbuild'),
  [
    'board/entry.jsx',
    '--bundle',
    '--minify',
    '--format=esm',
    '--splitting',
    '--target=es2020',
    '--conditions=production',
    '--define:process.env.NODE_ENV="production"',
    `--outdir=${out}`,
    '--loader:.woff2=file',
    '--loader:.png=file',
    '--asset-names=assets/[name]-[hash]',
    '--chunk-names=chunks/[name]-[hash]',
    '--public-path=/vendor',
  ],
  { cwd: root, stdio: 'inherit' },
);

// Шрифты обязаны отдаваться со своего origin: под font-src 'self' CDN закрыт.
fs.cpSync(fonts, path.join(out, 'fonts'), { recursive: true });

const size = value => `${(value / 1024 / 1024).toFixed(1)} МБ`;
const total = fs
  .readdirSync(out, { recursive: true })
  .map(name => path.join(out, String(name)))
  .filter(file => fs.statSync(file).isFile())
  .reduce((sum, file) => sum + fs.statSync(file).size, 0);
console.log(`доска собрана: ${out} (${size(total)})`);
