import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

// The neon-http driver makes a plain HTTP request per query instead of
// holding a TCP connection open — this is what makes it safe to use from
// Vercel serverless functions, where every invocation is a fresh process.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });
