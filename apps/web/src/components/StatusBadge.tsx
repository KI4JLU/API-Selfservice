import { useTranslation } from 'react-i18next';
import { Archive, Ban, CircleCheck, CircleX, Clock, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type Look = { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon?: React.ComponentType<{ className?: string }>; iconClass?: string };

const looks: Record<string, Look> = {
  active: { variant: 'outline', icon: CircleCheck, iconClass: 'text-green-600 dark:text-green-500' },
  approved: { variant: 'outline', icon: CircleCheck, iconClass: 'text-green-600 dark:text-green-500' },
  sent: { variant: 'outline', icon: CircleCheck, iconClass: 'text-green-600 dark:text-green-500' },
  success: { variant: 'outline', icon: CircleCheck, iconClass: 'text-green-600 dark:text-green-500' },
  pending: { variant: 'outline', icon: Clock, iconClass: 'text-amber-600 dark:text-amber-500' },
  expired: { variant: 'outline', icon: Clock, iconClass: 'text-amber-600 dark:text-amber-500' },
  skipped: { variant: 'secondary' },
  blocked: { variant: 'destructive', icon: Ban },
  rejected: { variant: 'destructive', icon: CircleX },
  failed: { variant: 'destructive', icon: CircleX },
  failure: { variant: 'destructive', icon: CircleX },
  deactivated: { variant: 'destructive', icon: Ban },
  deleted: { variant: 'secondary', icon: Trash2 },
  archived: { variant: 'secondary', icon: Archive },
};

export function StatusBadge({ status, testId }: { status: string; testId?: string }) {
  const { t } = useTranslation();
  const look = looks[status] ?? { variant: 'secondary' as const };
  const Icon = look.icon;
  return (
    <Badge variant={look.variant} data-testid={testId} data-status={status}>
      {Icon ? <Icon className={look.iconClass} /> : null}
      {t(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: 'free' | 'paid' }) {
  const { t } = useTranslation();
  return <Badge variant={tier === 'free' ? 'secondary' : 'default'}>{t(`tier.${tier}`)}</Badge>;
}
