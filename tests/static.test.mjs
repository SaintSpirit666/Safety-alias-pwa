import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('JavaScript приложения и service worker синтаксически валиден', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/);
  assert.doesNotMatch(html, /<style>/);
  new vm.Script(read('app.js'), { filename: 'app.js' });
  new vm.Script(read('content.js'), { filename: 'content.js' });
  new vm.Script(read('event-engine.js'), { filename: 'event-engine.js' });
  new vm.Script(read('sw.js'), { filename: 'sw.js' });
});

test('manifest содержит полный комплект PNG-иконок', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');

  const expected = new Map([
    ['icon-192.png', [192, 192, 'any']],
    ['icon-512.png', [512, 512, 'any']],
    ['icon-maskable-192.png', [192, 192, 'maskable']],
    ['icon-maskable-512.png', [512, 512, 'maskable']],
  ]);

  for (const icon of manifest.icons) {
    const spec = expected.get(icon.src);
    assert.ok(spec, `Неожиданная иконка ${icon.src}`);
    const bytes = fs.readFileSync(path.join(root, icon.src));
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), spec[0]);
    assert.equal(bytes.readUInt32BE(20), spec[1]);
    assert.equal(icon.purpose, spec[2]);
    expected.delete(icon.src);
  }
  assert.equal(expected.size, 0, 'В manifest отсутствуют обязательные иконки');
});

test('локальные ресурсы HTML существуют', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (/^(?:https?:|data:)/.test(ref)) continue;
    assert.ok(fs.existsSync(path.join(root, ref)), `Не найден ресурс ${ref}`);
  }
});

test('набор карточек структурно валиден', () => {
  const content = read('content.js');
  const { CONTENT_META, CATS, DATA } = vm.runInNewContext(`${content};({CONTENT_META,CATS,DATA})`);
  assert.equal(CONTENT_META.approved, true);
  assert.equal(CONTENT_META.cardCount, 600);
  assert.equal(CONTENT_META.categoryCount, 20);
  assert.equal(
    CONTENT_META.sha256,
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, 'cards.csv'), 'utf8').replace(/^\uFEFF/, ''))
      .digest('hex'),
  );
  assert.equal(DATA.length, 600);
  for (const card of DATA) {
    assert.match(card.id, /^SA-\d{3}$/);
    assert.ok(String(card.term).trim());
    assert.ok(CATS[card.category], `Неизвестная категория ${card.category}`);
    assert.ok([1, 2, 3].includes(card.difficulty));
    assert.ok(String(card.humor).trim());
    assert.ok(String(card.hint).trim());
    assert.ok(Array.isArray(card.forbiddenWords));
    assert.equal(typeof card.reviewRequired, 'boolean');
    assert.ok(Object.hasOwn(card, 'definition'));
    assert.ok(Object.hasOwn(card, 'safetyFact'));
    assert.ok(Object.hasOwn(card, 'source'));
    assert.equal(typeof card.reviewStatus, 'string');
  }
  for (const key of Object.keys(CATS)) {
    assert.equal(DATA.filter((card) => card.category === key).length, 30, `Неверное число карточек ${key}`);
  }
  assert.match(read('CONTENT_REVIEW.md'), /УТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ ПРОЕКТА/);
});

test('app shell перечислен в service worker', () => {
  const worker = read('sw.js');
  for (const file of [
    'index.html',
    'styles.css',
    'app.js',
    'content.js',
    'event-engine.js',
    'manifest.webmanifest',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-192.png',
    'icon-maskable-512.png',
    'favicon-32.png',
    'apple-touch-icon.png',
  ]) {
    assert.match(worker, new RegExp(file.replace('.', '\\.')));
  }
});

test('production security policy не допускает inline-код', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.doesNotMatch(html, /style=/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  const headers = read('_headers');
  for (const name of [
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ]) {
    assert.match(headers, new RegExp(name));
  }
});
