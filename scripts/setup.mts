#!/usr/bin/env node
/**
 * Local development setup: .env, dependencies, Postgres + Mailpit in Docker,
 * migrations and base seed. Idempotent, safe to re-run.
 *
 *   pnpm setup:dev            # set up / update  (= node scripts/setup.mts, Node >= 22)
 *   pnpm setup:dev --reset    # drop the DB_SCHEMA schema first (asks for confirmation)
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('usage: pnpm setup:dev [--reset]\n  --reset  drop the DB_SCHEMA schema and all its data before migrating');
  process.exit(0);
}
const reset = args.includes('--reset');
const unknown = args.filter((a) => a !== '--reset');
if (unknown.length) fail(`unknown option: ${unknown.join(' ')}`);

const step = (title: string) => console.log(`\n\x1b[1m==> ${title}\x1b[0m`);
function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
/** Run a command, inherit output, abort the setup on failure. */
function run(cmd: string, cmdArgs: string[], opts: SpawnSyncOptions = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${r.status})`);
}
const ok = (cmd: string, cmdArgs: string[]) => spawnSync(cmd, cmdArgs, { stdio: 'ignore' }).status === 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const psql = ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'litelite', '-d', 'litellm', '-v', 'ON_ERROR_STOP=1'];
const pgIsReady = ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'litelite', '-d', 'litellm'];

// ---- 1. .env -------------------------------------------------------------
step('.env');
if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('created .env from .env.example');
  console.log('NOTE: for local development set LITELLM_MODE=mock and DEV_LOGIN_ENABLED=true in .env');
} else {
  console.log('.env exists');
}
process.loadEnvFile('.env'); // Node >= 22: handles quotes and inline comments, does not override existing env
const databaseUrl = process.env.DATABASE_URL ?? fail('DATABASE_URL missing in .env');
const schema = (process.env.DB_SCHEMA ||= 'litelite');
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) fail(`invalid DB_SCHEMA: ${schema}`);
console.log(`DATABASE_URL=${databaseUrl.replace(/\/\/[^@]*@/, '//***@')}`);
console.log(`DB_SCHEMA=${schema}`);

// ---- 2. dependencies -----------------------------------------------------
step('pnpm install');
run('pnpm', ['install']);

// ---- 3. docker: postgres + mailpit ---------------------------------------
step('docker compose up -d postgres mailpit');
if (!ok('docker', ['info'])) fail('Docker is not running');
run('docker', ['compose', 'up', '-d', 'postgres', 'mailpit']);
process.stdout.write('waiting for postgres');
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = ok('docker', pgIsReady);
  if (!ready) {
    process.stdout.write('.');
    await sleep(1000);
  }
}
console.log(ready ? ' ok' : '');
if (!ready) fail('postgres did not become ready');

// ---- 4. optional reset ---------------------------------------------------
if (reset) {
  step(`reset schema "${schema}"`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Drop schema "${schema}" and all its data? [y/N] `)).trim().toLowerCase();
  rl.close();
  if (!['y', 'yes'].includes(answer)) fail('aborted');
  run('docker', [...psql, '-c', `DROP SCHEMA IF EXISTS "${schema}" CASCADE`]);
}

// ---- 5. migrations + seed ------------------------------------------------
step(`pnpm db:migrate (schema ${schema})`);
run('pnpm', ['db:migrate']);
step('pnpm db:seed');
run('pnpm', ['db:seed']);

// ---- done ----------------------------------------------------------------
step('done');
console.log(`Postgres : ${databaseUrl.replace(/.*@/, '')}  schema "${schema}"
Mailpit  : http://localhost:8025
Next     : pnpm dev   (API http://localhost:3030, Web http://localhost:5173)
Tests    : pnpm test  (uses schema litelite_test on the same Postgres)`);
