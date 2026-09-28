import { useMemo, useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Search, ShieldCheck, UserCheck, UserX, VenetianMask, Wallet, Building2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { requireAdmin } from '@/lib/guards';
import { useAdminUsers, useCostCenters, useDeactivateUser, useImpersonate, useReactivateUser, type AdminUser } from '@/lib/queries';
import { fmtCostCenter, fmtDate, fmtDateTime, fmtMoney, fmtPercent } from '@/lib/format';
import { PageHeader, Toolbar } from '@/components/ui/page';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Field, Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WithTooltip } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/StatusBadge';
import { BudgetDialog, CostCenterAdminDialog, RoleDialog } from '@/components/admin/UserDialogs';
import { BUDGET_WARN_THRESHOLD } from '@api-selfservice/shared';

export const Route = createFileRoute('/_app/admin/users')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: AdminUsersPage,
});

const ALL = '__all__';
const PAGE_SIZE = 25;

function AdminUsersPage() {
  const { t } = useTranslation();
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [costCenterId, setCostCenterId] = useState(ALL);
  const [includeDeactivated, setIncludeDeactivated] = useState(false);
  const [page, setPage] = useState(1);
  const users = useAdminUsers({ q: q || undefined, costCenterId: costCenterId === ALL ? undefined : costCenterId, includeDeactivated, page, pageSize: PAGE_SIZE });
  const ccs = useCostCenters({ pageSize: 200 });
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const impersonate = useImpersonate();

  const [roleUser, setRoleUser] = useState<AdminUser | null>(null);
  const [ccAdminUser, setCcAdminUser] = useState<AdminUser | null>(null);
  const [budgetUser, setBudgetUser] = useState<AdminUser | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<AdminUser | null>(null);
  const [impersonateUser, setImpersonateUser] = useState<AdminUser | null>(null);

  const ccOptions = useMemo(
    () => [{ value: ALL, label: t('common.all') }, ...(ccs.data?.items ?? []).map((c) => ({ value: c.id, label: `${fmtCostCenter(c.number)} · ${c.name}` }))],
    [ccs.data, t],
  );

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(qInput.trim());
    setPage(1);
  };

  const onDeactivate = async () => {
    if (!deactivateUser) return;
    const res = await deactivate.mutateAsync(deactivateUser.id).catch(() => null);
    if (res) {
      toast.success(t('users.deactivated'));
      setDeactivateUser(null);
    }
  };

  const onImpersonate = async () => {
    if (!impersonateUser) return;
    const res = await impersonate.mutateAsync(impersonateUser.id).catch(() => null);
    if (res) {
      toast.success(t('users.impersonateStarted', { name: impersonateUser.name }));
      setImpersonateUser(null);
      // Every cached response belongs to the admin; reload as the impersonated user.
      qc.clear();
      await navigate({ to: '/' });
      await router.invalidate();
    }
  };

  const onReactivate = async (u: AdminUser) => {
    const res = await reactivate.mutateAsync(u.id).catch(() => null);
    if (res) toast.success(t('users.reactivated'));
  };

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        header: t('common.name'),
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium" data-testid="user-row-name">
              {row.original.name}
            </div>
            <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
          </div>
        ),
      },
      {
        header: t('common.role'),
        accessorKey: 'role',
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={row.original.role === 'admin' ? 'default' : 'secondary'}>{t(`roles.${row.original.role}`)}</Badge>
            {row.original.roleFromIdp ? (
              <WithTooltip text={t('users.roleFromIdp')}>
                <ShieldCheck className="size-4 text-muted-foreground" />
              </WithTooltip>
            ) : null}
            {row.original.managedCostCenters.length ? (
              <WithTooltip text={row.original.managedCostCenters.map((c) => fmtCostCenter(c.number)).join(', ')}>
                <Badge variant="outline">
                  {t('roles.cost_center_admin')} ({row.original.managedCostCenters.length})
                </Badge>
              </WithTooltip>
            ) : null}
          </div>
        ),
      },
      {
        header: t('common.costCenter'),
        accessorKey: 'costCenter',
        cell: ({ row }) => (
          <span title={row.original.costCenter.name} className="tabular-nums" data-testid="user-cost-center">
            {fmtCostCenter(row.original.costCenter.number)}
          </span>
        ),
      },
      {
        header: t('common.budget'),
        accessorKey: 'budget',
        cell: ({ row }) =>
          row.original.budget ? (
            <span className="whitespace-nowrap tabular-nums" data-testid="user-budget">
              {fmtMoney(row.original.budget.amount)} <span className="text-xs text-muted-foreground">/ {t(`period.${row.original.budget.period}`)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">–</span>
          ),
        meta: { className: 'text-right' },
      },
      {
        header: t('common.spend'),
        accessorKey: 'spendCurrentPeriod',
        cell: ({ row }) => {
          const u = row.original.budget ? row.original.spendCurrentPeriod / row.original.budget.amount : null;
          return (
            <span className={`whitespace-nowrap tabular-nums ${u !== null && u >= 1 ? 'text-destructive font-medium' : u !== null && u >= BUDGET_WARN_THRESHOLD ? 'font-medium text-warning' : ''}`}>
              {fmtMoney(row.original.spendCurrentPeriod, { precise: true })}
              {u !== null ? <span className="ml-1 text-xs">({fmtPercent(u)})</span> : null}
            </span>
          );
        },
        meta: { className: 'text-right' },
      },
      { header: t('users.keyCount'), accessorKey: 'keyCount', meta: { className: 'text-right tabular-nums' } },
      {
        header: t('common.status'),
        accessorKey: 'status',
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <StatusBadge status={row.original.status} testId="user-status" />
            {row.original.deletedAt ? (
              <span className="text-muted-foreground text-xs">
                {fmtDate(row.original.deletedAt)} · {t(`users.deletedReason.${row.original.deletedReason ?? 'admin'}`)}
              </span>
            ) : null}
          </div>
        ),
      },
      { header: t('users.lastLogin'), accessorKey: 'lastLoginAt', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDateTime(row.original.lastLoginAt)}</span> },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => {
          const u = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" data-testid="btn-user-actions" aria-label={t('common.actions')}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRoleUser(u)} disabled={u.status === 'deactivated'} data-testid="btn-set-role">
                  <ShieldCheck />
                  {t('users.setRole')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCcAdminUser(u)} disabled={u.status === 'deactivated'} data-testid="btn-set-cost-center-admin">
                  <Building2 />
                  {t('users.costCenterAdminOf')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setBudgetUser(u)} disabled={u.status === 'deactivated'} data-testid="btn-assign-budget">
                  <Wallet />
                  {t('users.assignBudget')}
                </DropdownMenuItem>
                {me.impersonationEnabled ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setImpersonateUser(u)} disabled={u.status === 'deactivated' || u.id === me.id} data-testid="btn-impersonate-user">
                      <VenetianMask />
                      {t('users.impersonate')}
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                {u.status === 'deactivated' ? (
                  <DropdownMenuItem onSelect={() => onReactivate(u)} data-testid="btn-reactivate-user">
                    <UserCheck />
                    {t('users.reactivate')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setDeactivateUser(u)} variant="destructive" data-testid="btn-deactivate-user">
                    <UserX />
                    {t('users.deactivate')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        meta: { className: 'text-right' },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, me.id, me.impersonationEnabled],
  );

  return (
    <div data-testid="page-admin-users">
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} />
      <Toolbar>
        <form onSubmit={onSearch} className="flex items-end gap-1">
          <Field label={t('common.search')} htmlFor="u-q">
            <Input id="u-q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t('users.searchPlaceholder')} className="w-56" data-testid="input-user-search" />
          </Field>
          <Button type="submit" variant="outline" size="icon" aria-label={t('common.search')} data-testid="btn-user-search">
            <Search />
          </Button>
        </form>
        <Field label={t('common.costCenter')} htmlFor="u-cc">
          <SimpleSelect
            id="u-cc"
            value={costCenterId}
            onValueChange={(v) => {
              setCostCenterId(v);
              setPage(1);
            }}
            options={ccOptions}
            className="w-64"
            testId="input-user-cost-center"
          />
        </Field>
        <div className="flex h-9 items-center gap-2">
          <Switch
            id="u-deact"
            checked={includeDeactivated}
            onCheckedChange={(v) => {
              setIncludeDeactivated(v);
              setPage(1);
            }}
            data-testid="switch-include-deactivated"
          />
          <Label htmlFor="u-deact">{t('users.includeDeactivated')}</Label>
        </div>
      </Toolbar>
      <DataTable columns={columns} data={users.data?.items ?? []} isLoading={users.isLoading} testId="table-users" rowClassName={(u) => (u.status === 'deactivated' ? 'opacity-60' : undefined)} getRowId={(u) => u.id} />
      <div className="mt-3">
        <Pagination page={page} pageSize={PAGE_SIZE} total={users.data?.total ?? 0} onPageChange={setPage} />
      </div>

      <RoleDialog user={roleUser} onClose={() => setRoleUser(null)} />
      <CostCenterAdminDialog user={ccAdminUser} onClose={() => setCcAdminUser(null)} />
      <BudgetDialog user={budgetUser} onClose={() => setBudgetUser(null)} />
      <ConfirmDialog
        open={!!deactivateUser}
        onOpenChange={(o) => !o && setDeactivateUser(null)}
        title={t('users.deactivate')}
        description={t('users.deactivateConfirm', { name: deactivateUser?.name ?? '' })}
        confirmLabel={t('users.deactivate')}
        destructive
        loading={deactivate.isPending}
        onConfirm={onDeactivate}
        testId="dialog-deactivate-user"
      />
      <ConfirmDialog
        open={!!impersonateUser}
        onOpenChange={(o) => !o && setImpersonateUser(null)}
        title={t('users.impersonate')}
        description={t('users.impersonateConfirm', { name: impersonateUser?.name ?? '' })}
        confirmLabel={t('users.impersonate')}
        loading={impersonate.isPending}
        onConfirm={onImpersonate}
        testId="dialog-impersonate-user"
      />
    </div>
  );
}
