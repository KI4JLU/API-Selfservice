import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from './schema.js';

export * from './schema.js';
export { sql, eq, and, or, ne, gte, lt, lte, gt, inArray, isNull, isNotNull, desc, asc, like, ilike, count, sum } from 'drizzle-orm';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDb(connectionString: string, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  // numeric -> number
  pg.types.setTypeParser(1700, (v) => Number(v));
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
