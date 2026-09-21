import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ basePath: '/api/auth' });

export function signInWithKeycloak(callbackURL: string = window.location.origin) {
  return authClient.signIn.social({ provider: 'keycloak', callbackURL });
}

export async function signOut() {
  await authClient.signOut();
}

export async function devLogin(input: { email: string; name?: string; admin?: boolean }) {
  const post = () =>
    fetch('/api/auth/dev-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  let res = await post();
  if (res.status >= 500) {
    // Known API quirk: the first dev-login for a brand-new e-mail can fail with 500 after the user was created; retry once.
    await new Promise((r) => setTimeout(r, 300));
    res = await post();
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { message?: string };
      msg = j.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
}
