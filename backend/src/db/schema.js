import { randomBytes } from 'node:crypto';

import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

function createCuid() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(16).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `c${timestamp}${random}`.slice(0, 32);
}

export const newsScripts = pgTable('news_scripts', {
  id: text('id').primaryKey().$defaultFn(createCuid),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  type: text('type').notNull(),
  scriptText: text('script_text').notNull(),
  date: timestamp('date', { withTimezone: true }),
  year: integer('year').notNull(),
  month: integer('month'),
  category: text('category'),
  source: text('source'),
  sourceUrl: text('source_url'),
  isPublished: boolean('is_published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date())
}, (table) => ({
  yearIdx: index('news_scripts_year_idx').on(table.year),
  yearMonthIdx: index('news_scripts_year_month_idx').on(table.year, table.month),
  categoryIdx: index('news_scripts_category_idx').on(table.category),
  yearCategoryIdx: index('news_scripts_year_category_idx').on(table.year, table.category),
  yearMonthCategoryIdx: index('news_scripts_year_month_category_idx').on(table.year, table.month, table.category)
}));
