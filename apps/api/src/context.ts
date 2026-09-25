import type { Db } from '@api-selfservice/db';
import type { EffectiveRole } from '@api-selfservice/shared';
import type { Env } from './env.js';
import type { LiteLLMAdapter } from './litellm/types.js';
import type { Mailer } from './mail/mailer.js';
import type { Logger } from './logger.js';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  roleFromIdp: boolean;
  locale: 'de' | 'en';
  costCenterId: string | null;
  effectiveRole: EffectiveRole;
  managedCostCenterIds: string[];
}

export interface Deps {
  env: Env;
  db: Db;
  litellm: LiteLLMAdapter;
  mailer: Mailer;
  log: Logger;
  now: () => Date;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    user: CurrentUser;
    /** The signed-in admin while `user` is an impersonated user; unset otherwise. */
    impersonator?: CurrentUser;
    sessionId: string;
    requestId: string;
  };
};
