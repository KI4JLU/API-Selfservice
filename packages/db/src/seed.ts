import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb, costCenters, type Db } from './index.js';

export const DEFAULT_COST_CENTER_NUMBER = '11111111';

/** Idempotent: ensures the default cost center exists. */
export async function seedBase(db: Db) {
  const existing = await db.query.costCenters.findFirst({ where: eq(costCenters.number, DEFAULT_COST_CENTER_NUMBER) });
  if (!existing) {
    await db.insert(costCenters).values({
      number: DEFAULT_COST_CENTER_NUMBER,
      name: 'Default (kostenfreie Provider)',
      ownerName: 'System',
      ownerEmail: 'noreply@litelite.invalid',
      status: 'approved',
      isDefault: true,
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const { db, close } = createDb(url, { max: 2 });
  seedBase(db)
    .then(() => close())
    .then(() => console.log('seeded'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
