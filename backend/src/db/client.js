import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

let client;
let db;

export function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim();
}

export function getDb() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    const err = new Error('DATABASE_URL is required to connect to PostgreSQL');
    err.status = 503;
    err.code = 'DATABASE_UNAVAILABLE';
    throw err;
  }

  if (!db) {
    client = postgres(databaseUrl, {
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      ssl: 'require'
    });
    db = drizzle(client, { schema });
  }

  return db;
}

export async function closeDb() {
  if (client) await client.end();
  client = undefined;
  db = undefined;
}
