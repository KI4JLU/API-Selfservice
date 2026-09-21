import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Minimal .env loader: KEY=VALUE, quotes, inline comments. Never overrides existing process.env. */
export function loadDotEnv(startDir = process.cwd()) {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (val.startsWith('"') || val.startsWith("'")) {
          const q = val[0]!;
          const end = val.indexOf(q, 1);
          val = end > 0 ? val.slice(1, end) : val.slice(1);
        } else {
          const hash = val.indexOf(' #');
          if (hash >= 0) val = val.slice(0, hash).trim();
          if (val.startsWith('#')) val = '';
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
      return file;
    }
    dir = path.dirname(dir);
  }
  return null;
}
