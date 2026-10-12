import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Reads KEY=VALUE pairs from the repo .env without touching process.env (process.env wins). */
function readDotEnv(): Record<string, string> {
  const file = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') || val.startsWith("'")) val = val.slice(1, val.indexOf(val[0]!, 1));
    else if (val.includes(' #')) val = val.slice(0, val.indexOf(' #')).trim();
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

const dotenv = readDotEnv();
const get = (k: string) => process.env[k] ?? dotenv[k] ?? '';

export const LITELLM_BASE_URL = get('LITELLM_BASE_URL').replace(/\/+$/, '');
export const LITELLM_API_KEY = get('LITELLM_API_KEY');
/** Optional: chat model with a price used for the real-spend cases; otherwise the cheapest priced chat model is picked. */
export const LIVE_MODEL = get('E2E_LIVE_MODEL');
export const MAILPIT_URL = (get('MAILPIT_URL') || 'http://localhost:8025').replace(/\/+$/, '');
export const API_URL = 'http://localhost:3030';
export const ORIGIN = 'http://localhost:5173';

/** Run id in every e-mail, cost center name and key alias, so runs never collide and leftovers are easy to find. */
export const RUN = `e2e-live-${randomUUID().slice(0, 8)}`;
