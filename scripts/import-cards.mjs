import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'cards.csv');
const outputPath = path.join(root, 'content.js');
const required = [
  'id',
  'term',
  'category',
  'category_name',
  'emoji',
  'difficulty',
  'humor',
  'hint',
  'forbidden_words',
  'review_required',
];

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV содержит незакрытую кавычку');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const source = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');
const rows = parseCsv(source);
const headers = rows.shift();
for (const field of required) {
  if (!headers.includes(field)) throw new Error(`В CSV отсутствует поле ${field}`);
}

const records = rows
  .filter((row) => row.some(Boolean))
  .map((row, rowIndex) => {
    if (row.length !== headers.length) {
      throw new Error(`Строка ${rowIndex + 2}: ожидалось ${headers.length} полей, получено ${row.length}`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, row[index].trim()]));
  });

const ids = new Set();
const terms = new Set();
const categories = {};
const cards = records.map((record, index) => {
  const rowNumber = index + 2;
  for (const field of required.filter((name) => !['forbidden_words'].includes(name))) {
    if (!record[field]) throw new Error(`Строка ${rowNumber}: поле ${field} пустое`);
  }
  if (ids.has(record.id)) throw new Error(`Дублирующийся id: ${record.id}`);
  const normalizedTerm = record.term.toLocaleLowerCase('ru');
  if (terms.has(normalizedTerm)) throw new Error(`Дублирующийся термин: ${record.term}`);
  ids.add(record.id);
  terms.add(normalizedTerm);

  const difficulty = Number(record.difficulty);
  if (![1, 2, 3].includes(difficulty)) {
    throw new Error(`Строка ${rowNumber}: difficulty должен быть 1, 2 или 3`);
  }

  let forbiddenWords;
  try {
    forbiddenWords = JSON.parse(record.forbidden_words || '[]');
  } catch {
    throw new Error(`Строка ${rowNumber}: forbidden_words должен быть JSON-массивом`);
  }
  if (!Array.isArray(forbiddenWords) || forbiddenWords.some((word) => typeof word !== 'string')) {
    throw new Error(`Строка ${rowNumber}: forbidden_words должен содержать только строки`);
  }

  const reviewValue = record.review_required.toLowerCase();
  if (!['true', 'false'].includes(reviewValue)) {
    throw new Error(`Строка ${rowNumber}: review_required должен быть True или False`);
  }

  const existingCategory = categories[record.category];
  const categoryValue = [record.emoji, record.category_name];
  if (existingCategory && JSON.stringify(existingCategory) !== JSON.stringify(categoryValue)) {
    throw new Error(`Строка ${rowNumber}: конфликт описания категории ${record.category}`);
  }
  categories[record.category] = categoryValue;

  const definition = record.definition?.trim() || null;
  const safetyFact = record.safety_fact?.trim() || null;
  const sourceReference = record.source?.trim() || null;
  const reviewStatus = record.review_status?.trim().toLowerCase() || 'pending';
  if (!['pending', 'approved', 'review_required', 'rejected', 'draft'].includes(reviewStatus)) {
    throw new Error(`Строка ${rowNumber}: неизвестный review_status ${reviewStatus}`);
  }

  return {
    id: record.id,
    term: record.term,
    category: record.category,
    difficulty,
    humor: record.humor,
    hint: record.hint,
    forbiddenWords,
    reviewRequired: reviewValue === 'true',
    definition,
    safetyFact,
    source: sourceReference,
    reviewStatus,
  };
});

const hash = crypto.createHash('sha256').update(source).digest('hex');
const meta = {
  version: `cards-v2-2026-10-30-${hash.slice(0, 12)}`,
  source: 'cards.csv',
  sha256: hash,
  approved: true,
  approvedAt: '2026-10-30',
  cardCount: cards.length,
  categoryCount: Object.keys(categories).length,
};

const output = [
  `const CONTENT_META=${JSON.stringify(meta, null, 2)};`,
  `const CATS=${JSON.stringify(categories, null, 2)};`,
  `const DATA=${JSON.stringify(cards, null, 2)};`,
  '',
].join('\n');
fs.writeFileSync(outputPath, output);
console.log(`Импортировано ${cards.length} карточек в ${Object.keys(categories).length} категориях`);
console.log(`Версия: ${meta.version}`);
