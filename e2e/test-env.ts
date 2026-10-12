import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads KEY=VALUE pairs from a repo-root env file (e.g. .env.test) into process.env without overriding
 * values that are already set. Runs in the Playwright process, so the web servers and tests inherit them.
 */
export function loadEnvFile(name: string) {
  const file = path.join(__dirname, '..', name);
  if (!fs.existsSync(file)) throw new Error(`${name} not found in the repo root`);
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') || val.startsWith("'")) val = val.slice(1, val.indexOf(val[0]!, 1));
    else if (val.includes(' #')) val = val.slice(0, val.indexOf(' #')).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
