#!/usr/bin/env node
/**
 * Set up the API-Selfservice realm in Keycloak as described in docs/keycloak.md.
 *
 * Reads .env (KEYCLOAK_*, APP_URL, API_URL) and the admin credentials from
 * KC_ADMIN_USER / KC_ADMIN_PASS (environment or .env). Idempotent: existing
 * objects are updated or left alone.
 *
 * Usage:
 *   node scripts/keycloak-setup.mts [--env .env] [--admin-client] [--write-env]
 *                                  [--extra-app-url URL]... [--extra-api-url URL]...
 *
 * Runs on Node 22+ without a build step (type stripping). No dependencies.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

type Json = Record<string, unknown>;

const TEST_USERS: Array<{ username: string; admin: boolean; affiliation: string }> = [
  { username: 'admin-test', admin: true, affiliation: 'staff' },
  { username: 'user-test', admin: false, affiliation: 'member' },
  { username: 'ext-test', admin: false, affiliation: 'affiliate' },
];

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function log(msg: string) {
  console.log(`  ${msg}`);
}

/** Same rules as apps/api/src/dotenv.ts: KEY=VALUE, quotes, inline comments. */
function readEnv(file: string): Record<string, string> {
  const values: Record<string, string> = {};
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
    values[key] = val;
  }
  return values;
}

function writeEnvValue(file: string, key: string, value: string) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(file, lines.join('\n'));
}

function parseArgs(argv: string[]) {
  const args = { env: '.env', adminClient: false, writeEnv: false, extraAppUrls: [] as string[], extraApiUrls: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    const next = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === '--env') args.env = next();
    else if (a === '--admin-client') args.adminClient = true;
    else if (a === '--write-env') args.writeEnv = true;
    else if (a === '--extra-app-url') args.extraAppUrls.push(next());
    else if (a === '--extra-api-url') args.extraApiUrls.push(next());
    else if (a === '-h' || a === '--help') {
      console.log('usage: node scripts/keycloak-setup.mts [--env .env] [--admin-client] [--write-env] [--extra-app-url URL]... [--extra-api-url URL]...');
      process.exit(0);
    } else fail(`unknown argument ${a}`);
  }
  return args;
}

class Keycloak {
  private token = '';
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }

  async login(adminRealm: string, user: string, password: string) {
    const res = await fetch(`${this.base}/realms/${adminRealm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: user, password }),
    });
    if (!res.ok) fail(`admin login failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    this.token = ((await res.json()) as { access_token: string }).access_token;
  }

  async call<T = unknown>(method: string, path: string, body?: unknown, ok404 = false): Promise<T | null> {
    const res = await fetch(`${this.base}/admin${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404 && ok404) return null;
    if (!res.ok) fail(`${method} ${path} failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  get<T = unknown>(path: string, ok404 = false) {
    return this.call<T>('GET', path, undefined, ok404);
  }
  post(path: string, body: unknown) {
    return this.call('POST', path, body);
  }
  put(path: string, body: unknown) {
    return this.call('PUT', path, body);
  }
}

type Named = { id: string; name: string };
type Client = { id: string; clientId: string; attributes?: Record<string, string> };

async function ensureRealm(kc: Keycloak, realm: string) {
  if (await kc.get(`/realms/${realm}`, true)) {
    log(`realm ${realm}: exists`);
  } else {
    await kc.post('/realms', { realm, enabled: true });
    log(`realm ${realm}: created`);
  }
}

async function findClient(kc: Keycloak, realm: string, clientId: string) {
  const hits = await kc.get<Client[]>(`/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`);
  return hits?.[0] ?? null;
}

async function upsertClient(kc: Keycloak, realm: string, rep: Json & { clientId: string }): Promise<string> {
  const existing = await findClient(kc, realm, rep.clientId);
  if (existing) {
    rep.attributes = { ...existing.attributes, ...(rep.attributes as Json | undefined) };
    await kc.put(`/realms/${realm}/clients/${existing.id}`, rep);
    log(`client ${rep.clientId}: updated`);
    return existing.id;
  }
  await kc.post(`/realms/${realm}/clients`, rep);
  log(`client ${rep.clientId}: created`);
  return (await findClient(kc, realm, rep.clientId))!.id;
}

function ensureClient(kc: Keycloak, realm: string, clientId: string, redirectUris: string[], postLogout: string[], webOrigins: string[]) {
  return upsertClient(kc, realm, {
    clientId,
    protocol: 'openid-connect',
    enabled: true,
    publicClient: false,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris,
    webOrigins,
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': postLogout.join('##'),
    },
  });
}

async function ensureMapper(kc: Keycloak, realm: string, cid: string, rep: Json & { name: string }) {
  const base = `/realms/${realm}/clients/${cid}/protocol-mappers/models`;
  const existing = (await kc.get<Named[]>(base)) ?? [];
  const found = existing.find((m) => m.name === rep.name);
  if (found) {
    await kc.put(`${base}/${found.id}`, { ...rep, id: found.id });
    log(`mapper ${rep.name}: updated`);
  } else {
    await kc.post(base, rep);
    log(`mapper ${rep.name}: created`);
  }
}

async function ensureGroup(kc: Keycloak, realm: string, name: string): Promise<string> {
  const find = async () =>
    ((await kc.get<Named[]>(`/realms/${realm}/groups?search=${encodeURIComponent(name)}`)) ?? []).find((g) => g.name === name);
  const existing = await find();
  if (existing) {
    log(`group ${name}: exists`);
    return existing.id;
  }
  await kc.post(`/realms/${realm}/groups`, { name });
  log(`group ${name}: created`);
  return (await find())!.id;
}

async function ensureProfileAttribute(kc: Keycloak, realm: string, name: string) {
  const profile = await kc.get<{ attributes?: Array<Json & { name: string }> }>(`/realms/${realm}/users/profile`, true);
  if (!profile) {
    log(`user profile API not available, skipping attribute ${name} (Keycloak < 24?)`);
    return;
  }
  if (profile.attributes?.some((a) => a.name === name)) {
    log(`attribute ${name}: exists`);
    return;
  }
  profile.attributes = [
    ...(profile.attributes ?? []),
    { name, displayName: name, multivalued: true, permissions: { view: ['admin', 'user'], edit: ['admin'] } },
  ];
  await kc.put(`/realms/${realm}/users/profile`, profile);
  log(`attribute ${name}: created`);
}

async function ensureUser(kc: Keycloak, realm: string, username: string, password: string, resetPassword: boolean, attr: string, affiliation: string, groupId: string | null) {
  const find = async () => (await kc.get<Named[]>(`/realms/${realm}/users?username=${username}&exact=true`))?.[0];
  const rep: Json = {
    username,
    enabled: true,
    email: `${username}@example.org`,
    emailVerified: true,
    firstName: username.split('-')[0]!.replace(/^./, (c) => c.toUpperCase()),
    lastName: 'Test',
    attributes: { [attr]: [affiliation] },
  };
  let uid: string;
  const existing = await find();
  if (existing) {
    uid = existing.id;
    await kc.put(`/realms/${realm}/users/${uid}`, rep);
    if (resetPassword) await kc.put(`/realms/${realm}/users/${uid}/reset-password`, { type: 'password', value: password, temporary: false });
    log(`user ${username}: updated${resetPassword ? ', password reset' : ''}`);
  } else {
    rep.credentials = [{ type: 'password', value: password, temporary: false }];
    await kc.post(`/realms/${realm}/users`, rep);
    uid = (await find())!.id;
    log(`user ${username}: created`);
  }
  if (groupId) await kc.put(`/realms/${realm}/users/${uid}/groups/${groupId}`, undefined);
}

async function ensureAdminClient(kc: Keycloak, realm: string, clientId: string): Promise<string> {
  const cid = await upsertClient(kc, realm, {
    clientId,
    protocol: 'openid-connect',
    enabled: true,
    publicClient: false,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
  });
  const saUser = (await kc.get<Named>(`/realms/${realm}/clients/${cid}/service-account-user`))!.id;
  const rm = (await findClient(kc, realm, 'realm-management'))!.id;
  const roles = [];
  for (const r of ['view-users', 'query-groups']) roles.push(await kc.get(`/realms/${realm}/clients/${rm}/roles/${r}`));
  await kc.post(`/realms/${realm}/users/${saUser}/role-mappings/clients/${rm}`, roles);
  log(`client ${clientId}: roles view-users, query-groups assigned`);
  return cid;
}

async function clientSecret(kc: Keycloak, realm: string, cid: string) {
  return (await kc.get<{ value: string }>(`/realms/${realm}/clients/${cid}/client-secret`))!.value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnv(args.env);
  const cfg = (key: string, fallback = '') => process.env[key] || env[key] || fallback;

  const m = /^(https?:\/\/.+?)\/realms\/([^/]+)\/?$/.exec(cfg('KEYCLOAK_ISSUER'));
  if (!m) fail('KEYCLOAK_ISSUER must look like https://host/realms/<realm>');
  const [, base, realm] = m as unknown as [string, string, string];
  const adminUser = cfg('KC_ADMIN_USER');
  const adminPass = cfg('KC_ADMIN_PASS');
  if (!adminUser || !adminPass) fail('set KC_ADMIN_USER and KC_ADMIN_PASS (environment or .env)');

  const clientId = cfg('KEYCLOAK_CLIENT_ID', 'api-selfservice');
  const adminGroup = cfg('KEYCLOAK_ADMIN_GROUP', 'LiteLLMAdmin');
  const groupsClaim = cfg('KEYCLOAK_GROUPS_CLAIM', 'groups');
  const affClaim = cfg('KEYCLOAK_AFFILIATION_CLAIM', 'eduPersonAffiliation');
  const adminClientId = cfg('KEYCLOAK_ADMIN_CLIENT_ID', 'api-selfservice-admin');
  const testPassFixed = cfg('KC_TEST_USER_PASS');
  const testPass = testPassFixed || randomBytes(12).toString('base64url');

  const strip = (u: string) => u.replace(/\/+$/, '');
  const appUrls = [cfg('APP_URL', 'http://localhost:5173'), ...args.extraAppUrls].map(strip);
  const apiUrls = [cfg('API_URL', 'http://localhost:3030'), ...args.extraApiUrls].map(strip);
  const redirectUris = apiUrls.map((u) => `${u}/api/auth/callback/keycloak`);
  // Better Auth sends post_logout_redirect_uri with a trailing slash (`${APP_URL}/`); Keycloak matches exactly unless wildcarded.
  const postLogoutUris = appUrls.map((u) => `${u}/*`);

  console.log(`Keycloak ${base}, realm ${realm}`);
  const kc = new Keycloak(base);
  await kc.login(cfg('KC_ADMIN_REALM', 'master'), adminUser, adminPass);

  await ensureRealm(kc, realm);
  const cid = await ensureClient(kc, realm, clientId, redirectUris, postLogoutUris, appUrls);
  const groupId = await ensureGroup(kc, realm, adminGroup);
  await ensureMapper(kc, realm, cid, {
    name: groupsClaim,
    protocol: 'openid-connect',
    protocolMapper: 'oidc-group-membership-mapper',
    config: {
      'claim.name': groupsClaim,
      'full.path': 'false',
      'id.token.claim': 'true',
      'access.token.claim': 'true',
      'userinfo.token.claim': 'true',
    },
  });
  await ensureProfileAttribute(kc, realm, affClaim);
  await ensureMapper(kc, realm, cid, {
    name: affClaim,
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-attribute-mapper',
    config: {
      'user.attribute': affClaim,
      'claim.name': affClaim,
      'jsonType.label': 'String',
      multivalued: 'true',
      'id.token.claim': 'true',
      'access.token.claim': 'true',
      'userinfo.token.claim': 'true',
    },
  });
  for (const u of TEST_USERS) {
    await ensureUser(kc, realm, u.username, testPass, Boolean(testPassFixed), affClaim, u.affiliation, u.admin ? groupId : null);
  }

  const secret = await clientSecret(kc, realm, cid);
  let adminSecret: string | null = null;
  if (args.adminClient) {
    adminSecret = await clientSecret(kc, realm, await ensureAdminClient(kc, realm, adminClientId));
  }

  const disc = (await (await fetch(`${base}/realms/${realm}/.well-known/openid-configuration`)).json()) as Json;
  const missing = ['authorization_endpoint', 'token_endpoint', 'end_session_endpoint'].filter((k) => !(k in disc));
  const pkce = (disc.code_challenge_methods_supported as string[] | undefined)?.includes('S256');
  if (missing.length || !pkce) fail(`discovery check failed, missing: ${missing.length ? missing.join(', ') : 'S256'}`);
  log('discovery endpoint: ok');

  if (args.writeEnv) {
    writeEnvValue(args.env, 'KEYCLOAK_CLIENT_SECRET', secret);
    if (adminSecret) {
      writeEnvValue(args.env, 'KEYCLOAK_ADMIN_CLIENT_ID', adminClientId);
      writeEnvValue(args.env, 'KEYCLOAK_ADMIN_CLIENT_SECRET', adminSecret);
    }
    log(`secrets written to ${args.env}`);
  } else {
    console.log(`\nKEYCLOAK_CLIENT_SECRET=${secret}`);
    if (adminSecret) {
      console.log(`KEYCLOAK_ADMIN_CLIENT_ID=${adminClientId}`);
      console.log(`KEYCLOAK_ADMIN_CLIENT_SECRET=${adminSecret}`);
    }
  }
  console.log(`\nTest users ${TEST_USERS.map((u) => u.username).join(', ')}, password: ${testPassFixed ? '<KC_TEST_USER_PASS from .env>' : testPass}`);
  console.log('Remove KC_ADMIN_USER / KC_ADMIN_PASS from .env when done.');
}

main().catch((err) => fail(String(err)));
