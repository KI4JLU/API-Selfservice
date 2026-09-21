import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { isApiError } from '@/lib/api';
import { meQuery } from '@/lib/queries';
import { AppShell } from '@/components/layout/AppShell';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      return { me };
    } catch (e) {
      if (isApiError(e) && (e.status === 401 || e.status === 403)) {
        throw redirect({ to: '/login', search: { redirect: location.pathname !== '/login' ? location.href : undefined } });
      }
      throw e;
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
