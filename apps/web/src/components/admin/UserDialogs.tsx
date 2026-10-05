import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ROLES, type BudgetPeriod, type Role } from '@api-selfservice/shared';
import { useCostCenters, useSetBudget, useSetCostCenterAdmin, useSetRole, type AdminUser } from '@/lib/queries';
import { fmtCostCenter, toDateInput } from '@/lib/format';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner } from '@/components/ui/page';
import { BudgetFields, periodDates } from '@/components/cost-centers/CostCenterEditDialog';

function Header({ title, user }: { title: string; user: AdminUser | null }) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{user ? `${user.name} · ${user.email}` : ''}</DialogDescription>
    </DialogHeader>
  );
}

export function RoleDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { t } = useTranslation();
  const setRole = useSetRole();
  const [role, setRoleValue] = useState<Role>('user');
  useEffect(() => {
    if (user) setRoleValue(user.role);
  }, [user]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const res = await setRole.mutateAsync({ id: user.id, role }).catch(() => null);
    if (res) {
      toast.success(t('users.roleSaved'));
      onClose();
    }
  };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-set-role">
        <form onSubmit={submit} className="grid gap-4">
          <Header title={t('users.setRole')} user={user} />
          {user?.roleFromIdp ? <Banner variant="info">{t('users.roleFromIdp')}</Banner> : null}
          <Field label={t('common.role')} htmlFor="u-role">
            <SimpleSelect
              id="u-role"
              value={role}
              onValueChange={(v) => setRoleValue(v as Role)}
              options={ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
              disabled={user?.roleFromIdp}
              testId="input-role"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={setRole.isPending} disabled={user?.roleFromIdp} data-testid="btn-save-role">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CostCenterAdminDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { t } = useTranslation();
  const ccs = useCostCenters({ status: 'approved', pageSize: 200 }, !!user);
  const save = useSetCostCenterAdmin();
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (user) setSelected(user.managedCostCenters.map((c) => c.id));
  }, [user]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const res = await save.mutateAsync({ id: user.id, costCenterIds: selected }).catch(() => null);
    if (res) {
      toast.success(t('users.costCenterAdminSaved'));
      onClose();
    }
  };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-cost-center-admin">
        <form onSubmit={submit} className="grid gap-4">
          <Header title={t('users.costCenterAdminOf')} user={user} />
          <p className="text-sm text-muted-foreground">{t('users.costCenterAdminHint')}</p>
          <div className="rounded-md border" data-testid="list-cost-center-admin">
            {ccs.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : (
              (ccs.data?.items ?? []).map((c) => (
                <label key={c.id} className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0">
                  <Checkbox
                    checked={selected.includes(c.id)}
                    onCheckedChange={(v) => setSelected((s) => (v === true ? [...s, c.id] : s.filter((x) => x !== c.id)))}
                    data-testid={`cc-admin-${c.number}`}
                  />
                  <span className="font-mono">{fmtCostCenter(c.number)}</span>
                  <span className="truncate">{c.name}</span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending} data-testid="btn-save-cost-center-admin">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BudgetDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { t } = useTranslation();
  const save = useSetBudget();
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  useEffect(() => {
    if (!user) return;
    setAmount(user.budget ? String(user.budget.amount) : '');
    setPeriod(user.budget?.period ?? 'monthly');
    setStart(toDateInput(user.budget?.periodStart));
    setEnd(toDateInput(user.budget?.periodEnd));
  }, [user]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const res = await save.mutateAsync({ id: user.id, body: { amount: Number(amount), period, ...periodDates(period, start, end) } }).catch(() => undefined);
    if (res !== undefined) {
      toast.success(t('users.budgetSaved'), { testId: 'toast-budget-saved' });
      onClose();
    }
  };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-assign-budget">
        <form onSubmit={submit} className="grid gap-4">
          <Header title={t('users.assignBudget')} user={user} />
          <BudgetFields
            amount={amount}
            setAmount={setAmount}
            period={period}
            setPeriod={setPeriod}
            start={start}
            setStart={setStart}
            end={end}
            setEnd={setEnd}
            amountLabel={t('users.budgetAmount')}
            required
            idPrefix="u"
          />
          <p className="text-xs text-muted-foreground">{t('users.budgetHint')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending} data-testid="btn-save-budget">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
