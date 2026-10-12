import { LITELLM_API_KEY, LITELLM_BASE_URL, MAILPIT_URL } from './env';
import { mailpitReachable } from './mailpit';

/** Fails fast before any test touches LiteLLM when the live prerequisites are missing. */
export default async function globalSetup() {
  if (!LITELLM_BASE_URL || !LITELLM_API_KEY) throw new Error('LITELLM_BASE_URL and LITELLM_API_KEY (master key) must be set in .env');
  const res = await fetch(`${LITELLM_BASE_URL}/key/info`, { headers: { Authorization: `Bearer ${LITELLM_API_KEY}` } }).catch((e: Error) => e);
  if (res instanceof Error) throw new Error(`LiteLLM not reachable at ${LITELLM_BASE_URL}: ${res.message}`);
  if (res.status === 401 || res.status === 403) throw new Error('LITELLM_API_KEY is not accepted by LiteLLM');
  if (!(await mailpitReachable())) throw new Error(`Mailpit not reachable at ${MAILPIT_URL}; run docker compose up -d mailpit`);
}
