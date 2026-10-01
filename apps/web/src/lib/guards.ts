import { redirect } from '@tanstack/react-router';
import { toast } from 'sonner';
import i18n from './i18n';
import type { Me } from './queries';

export function requireAdmin(me: Me) {
  if (me.role !== 'admin') {
    toast.error(i18n.t('errors.FORBIDDEN'));
    throw redirect({ to: '/' });
  }
}

export function requireCostCenterAdmin(me: Me) {
  if (me.managedCostCenters.length === 0) {
    toast.error(i18n.t('errors.FORBIDDEN'));
    throw redirect({ to: '/' });
  }
}
