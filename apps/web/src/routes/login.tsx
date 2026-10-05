import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { meQuery } from '@/lib/queries';
import { devLogin, signInWithKeycloak } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LanguageSwitch, ThemeToggle } from '@/components/layout/HeaderControls';

const searchSchema = z.object({ redirect: z.string().optional(), error: z.string().optional() });

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.fetchQuery(meQuery);
      throw redirect({ to: '/' });
    } catch (e) {
      if (e && typeof e === 'object' && 'to' in e) throw e;
      // not signed in -> stay on login
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const [busy, setBusy] = useState(false);

  const onKeycloak = async () => {
    setBusy(true);
    try {
      const target = search.redirect ? new URL(search.redirect, window.location.origin).toString() : window.location.origin;
      // The Better Auth client reports API errors (e.g. PROVIDER_NOT_FOUND) in `error` instead of throwing.
      const { error } = await signInWithKeycloak(target);
      if (error) {
        toast.error(t('auth.loginFailed'));
        setBusy(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="bg-muted/40 flex min-h-screen flex-col">
      <div className="flex items-center justify-end gap-2 p-4">
        <LanguageSwitch />
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="bg-primary text-primary-foreground mb-2 flex size-12 items-center justify-center justify-self-center rounded-xl">
              <KeyRound className="size-6" />
            </div>
            <CardTitle className="text-2xl">{t('app.name')}</CardTitle>
            <CardDescription>{t('app.tagline')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">{t('auth.loginTitle')}</h2>
              <p className="text-muted-foreground text-sm">{t('auth.loginText')}</p>
              {search.error ? <p className="text-destructive text-sm">{t('auth.loginFailed')}</p> : null}
              <Button size="lg" onClick={onKeycloak} loading={busy} data-testid="btn-login-keycloak">
                <LogIn />
                {t('auth.loginButton')}
              </Button>
            </div>
            {import.meta.env.DEV ? <DevLoginForm /> : null}
          </CardContent>
        </Card>
      </div>
      <div className="text-muted-foreground p-4 text-center text-xs" data-testid="app-version">
        v{__APP_VERSION__}
      </div>
    </div>
  );
}

function DevLoginForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await devLogin({ email, name: name || undefined, admin });
      await qc.invalidateQueries();
      const to = search.redirect && search.redirect.startsWith('/') ? search.redirect : '/';
      await navigate({ to, replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-dashed p-4" data-testid="form-dev-login">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{t('auth.devLogin')}</div>
      <Field label={t('common.email')} htmlFor="dev-email" required>
        <Input id="dev-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-dev-email" autoComplete="off" />
      </Field>
      <Field label={t('common.name')} htmlFor="dev-name">
        <Input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-dev-name" autoComplete="off" />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id="dev-admin" checked={admin} onCheckedChange={(v) => setAdmin(v === true)} data-testid="checkbox-dev-admin" />
        <Label htmlFor="dev-admin">{t('roles.admin')}</Label>
      </div>
      <Button type="submit" variant="secondary" loading={busy} data-testid="btn-dev-login">
        {t('auth.devLoginButton')}
      </Button>
    </form>
  );
}
