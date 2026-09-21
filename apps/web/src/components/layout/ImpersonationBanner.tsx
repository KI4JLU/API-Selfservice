import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { VenetianMask } from 'lucide-react';
import { toast } from 'sonner';
import type { Me } from '@/lib/queries';
import { useStopImpersonation } from '@/lib/queries';
import { Button } from '@/components/ui/button';

/** Shown while an admin acts as another user (debugging); ends the impersonation on the current session. */
export function ImpersonationBanner({ me }: { me: Me }) {
  const { t } = useTranslation();
  const stop = useStopImpersonation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  if (!me.impersonatedBy) return null;

  const onStop = async () => {
    const res = await stop.mutateAsync().catch(() => null);
    if (!res) return;
    toast.success(t('impersonation.stopped'));
    // Cached responses belong to the impersonated user; reload as the admin.
    qc.clear();
    await navigate({ to: '/admin/users' });
    await router.invalidate();
  };

  return (
    <div className="bg-destructive text-white" role="status" data-testid="impersonation-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm lg:px-6">
        <VenetianMask className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate" data-testid="impersonation-user" data-user-email={me.email}>
          {t('impersonation.banner', { name: me.name, email: me.email })}
        </span>
        <Button size="sm" variant="outline" className="h-7 border-current bg-transparent text-white hover:bg-white/15 hover:text-white" onClick={onStop} disabled={stop.isPending} data-testid="btn-stop-impersonation">
          {t('impersonation.stop')}
        </Button>
      </div>
    </div>
  );
}
