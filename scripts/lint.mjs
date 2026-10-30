import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textFiles = [
  'index.html',
  'styles.css',
  'content.js',
  'event-engine.js',
  'app.js',
  'sw.js',
  'manifest.webmanifest',
  'package.json',
  'README.md',
  'CONTENT_REVIEW.md',
  '_headers',
];

for (const file of textFiles) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(!content.includes('\r'), `${file}: используйте LF`);
  assert.ok(!/[ \t]+$/m.test(content), `${file}: пробелы в конце строки`);
  assert.ok(content.endsWith('\n'), `${file}: нет перевода строки в конце`);
}

for (const file of ['app.js', 'content.js', 'event-engine.js', 'sw.js']) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
console.log('Lint: ошибок не найдено');
