import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { getDb, closeDb } from '../src/db/client.js';
import { newsScripts } from '../src/db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultSeedPath = path.resolve(__dirname, '../data/news_scripts.seed.json');
const seedPath = path.resolve(process.cwd(), process.argv[2] || defaultSeedPath);

function toNullableString(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function normalizeSeedItem(item, index) {
  const requiredFields = ['title', 'summary', 'type', 'scriptText', 'year'];
  for (const field of requiredFields) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      throw new Error(`seed item at index ${index} is missing required field: ${field}`);
    }
  }

  const year = Number(item.year);
  if (!Number.isInteger(year) || year < 1) {
    throw new Error(`seed item at index ${index} has invalid year: ${item.year}`);
  }

  const month = item.month === undefined || item.month === null || item.month === '' ? null : Number(item.month);
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new Error(`seed item at index ${index} has invalid month: ${item.month}`);
  }

  const date = item.date ? new Date(item.date) : null;
  if (date && Number.isNaN(date.getTime())) {
    throw new Error(`seed item at index ${index} has invalid date: ${item.date}`);
  }

  return {
    ...(item.id ? { id: String(item.id) } : {}),
    title: String(item.title),
    summary: String(item.summary),
    type: String(item.type),
    scriptText: String(item.scriptText),
    date,
    year,
    month,
    category: toNullableString(item.category),
    source: toNullableString(item.source),
    sourceUrl: toNullableString(item.sourceUrl),
    isPublished: item.isPublished ?? true
  };
}

async function main() {
  const raw = await fs.readFile(seedPath, 'utf8');
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : parsed.newsScripts;
  if (!Array.isArray(items)) {
    throw new Error('seed file must contain an array or an object with newsScripts array');
  }

  const values = items.map(normalizeSeedItem);
  if (!values.length) {
    console.log('No news scripts to seed.');
    return;
  }

  const db = getDb();
  await db.insert(newsScripts)
    .values(values)
    .onConflictDoUpdate({
      target: newsScripts.id,
      set: {
        title: sql`excluded.title`,
        summary: sql`excluded.summary`,
        type: sql`excluded.type`,
        scriptText: sql`excluded.script_text`,
        date: sql`excluded.date`,
        year: sql`excluded.year`,
        month: sql`excluded.month`,
        category: sql`excluded.category`,
        source: sql`excluded.source`,
        sourceUrl: sql`excluded.source_url`,
        isPublished: sql`excluded.is_published`,
        updatedAt: new Date()
      }
    });

  console.log(`Seeded ${values.length} news scripts from ${seedPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
