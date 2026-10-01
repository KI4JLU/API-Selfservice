import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppEnv, Deps } from './context.js';
import { createAuth, type Auth } from './auth/auth.js';
import { onError } from './middleware/error.js';
import { sessionMiddleware } from './middleware/session.js';
import { csrfMiddleware } from './middleware/csrf.js';
import { meRoutes } from './routes/me.js';
import { costCenterRoutes } from './routes/cost-centers.js';
import { keyRoutes } from './routes/keys.js';
import { keyTestRoutes } from './routes/key-test.js';
import { providerRoutes } from './routes/providers.js';
import { adminRoutes } from './routes/admin.js';
import { reportRoutes } from './routes/reports.js';

export interface App {
  app: OpenAPIHono<AppEnv>;
  auth: Auth;
}

export function createApp(deps: Deps): App {
  const auth = createAuth(deps);
  const app = new OpenAPIHono<AppEnv>();

  app.onError(onError);
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('requestId', c.req.header('x-request-id') ?? randomUUID());
    await next();
    c.header('x-request-id', c.get('requestId'));
  });
  if (deps.env.NODE_ENV !== 'test') app.use('*', honoLogger((msg) => deps.log.info(msg)));
  app.use(
    '/api/*',
    cors({
      origin: [deps.env.APP_URL, deps.env.API_URL],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
    }),
  );

  // Public
  app.get('/health', async (c) => {
    const ll = await deps.litellm.health();
    return c.json({ ok: true, litellm: ll.ok, mode: deps.litellm.mode, time: deps.now().toISOString() });
  });
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Security chain for /api/v1: session -> csrf -> (roles/scope per route) -> handler
  const v1 = new OpenAPIHono<AppEnv>();
  v1.use('*', sessionMiddleware(auth));
  v1.use('*', csrfMiddleware([deps.env.APP_URL, deps.env.API_URL]));
  v1.route('/', meRoutes);
  v1.route('/', costCenterRoutes);
  v1.route('/', keyRoutes);
  v1.route('/', keyTestRoutes);
  v1.route('/', providerRoutes);
  v1.route('/', adminRoutes);
  v1.route('/', reportRoutes);

  app.route('/api/v1', v1);

  // OpenAPI + docs
  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'API-Selfservice API', version: '1.0.0', description: 'Self-service portal for LiteLLM. All /api/v1 routes require a session cookie.' },
    servers: [{ url: '/' }],
  });
  app.get('/api/docs', Scalar({ url: '/api/openapi.json', theme: 'default' }));

  // Production: serve the built web app (copied to apps/api/public in the Docker image) with SPA fallback.
  const publicDir = process.env.WEB_DIST ?? path.resolve(process.cwd(), 'apps/api/public');
  if (deps.env.NODE_ENV === 'production' && existsSync(publicDir)) {
    const root = path.relative(process.cwd(), publicDir) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('/*', serveStatic({ root, path: 'index.html' }));
  } else {
    // No static web app here (dev): a small landing page instead of a bare 404 on "/".
    app.get('/', (c) =>
      c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>API-Selfservice API</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}code{background:#eee;padding:.1em .3em;border-radius:3px}</style>
</head><body>
<h1>API-Selfservice API</h1>
<p>This is the API server only. The web app runs separately.</p>
<ul>
<li><a href="${deps.env.APP_URL}/login">Web app</a> (<code>${deps.env.APP_URL}</code>)</li>
<li><a href="/api/docs">API docs</a></li>
<li><a href="/health">Health</a></li>
</ul>
</body></html>`),
    );
  }

  return { app, auth };
}
