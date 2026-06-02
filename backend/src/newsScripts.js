import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { parseNewsScriptFilters } from './newsScriptFilters.js';

export { parseNewsScriptFilters };

export function buildNewsScriptWhere(newsScripts, filters = {}) {
  const conditions = [eq(newsScripts.isPublished, true)];
  if (filters.year !== undefined) conditions.push(eq(newsScripts.year, filters.year));
  if (filters.month !== undefined) conditions.push(eq(newsScripts.month, filters.month));
  if (filters.category !== undefined) conditions.push(eq(newsScripts.category, filters.category));
  return and(...conditions);
}

export function toNewsScriptResponse(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    type: row.type,
    scriptText: row.scriptText,
    date: row.date ? row.date.toISOString() : null,
    year: row.year,
    month: row.month,
    category: row.category,
    source: row.source,
    sourceUrl: row.sourceUrl,
    isPublished: row.isPublished,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listNewsScripts(db, newsScripts, filters = {}) {
  const rows = await db
    .select()
    .from(newsScripts)
    .where(buildNewsScriptWhere(newsScripts, filters))
    .orderBy(desc(newsScripts.year), desc(newsScripts.month), desc(newsScripts.date), asc(newsScripts.title));

  return rows.map(toNewsScriptResponse);
}

export async function getRandomNewsScript(db, newsScripts, filters = {}) {
  const rows = await db
    .select()
    .from(newsScripts)
    .where(buildNewsScriptWhere(newsScripts, filters))
    .orderBy(sql`random()`)
    .limit(1);

  return rows[0] ? toNewsScriptResponse(rows[0]) : null;
}
