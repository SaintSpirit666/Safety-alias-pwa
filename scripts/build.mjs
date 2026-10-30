import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const files = [
  'index.html',
  'styles.css',
  'app.js',
  'content.js',
  'event-engine.js',
  'sw.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-maskable.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'favicon-32.png',
  'apple-touch-icon.png',
  '_headers',
];

if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error(`Небезопасный путь сборки: ${output}`);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log(`Production-сборка: ${files.length} файлов в ${output}`);
