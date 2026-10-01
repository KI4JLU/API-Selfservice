import { useMemo, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Archive, Pencil, Plus, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { COST_CENTER_STATUS } from '@api-selfservice/shared';
import { requireAdmin } from '@/lib/guards';
import { useApproveRequest, useArchiveCostCenter, useCostCenterRequests, useCostCenters, useRejectRequest, type CostCenter, type CostCenterRequest } from '@/lib/queries';
import { fmtCostCenter, fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { PageHeader, Toolbar } from '@/components/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WithTooltip } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/StatusBadge';
import { CostCenterEditDialog } from '@/components/cost-centers/CostCenterEditDialog';
import { CostCenterCreateDialog } from '@/components/admin/CostCenterCreateDialog';

export const Route = createFileRoute('/_app/admin/cost-centers')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: AdminCostCentersPage,
});

const ALL = '__all__';
const PAGE_SIZE = 25;

function AdminCostCentersPage() {
  const { t } = useTranslation();
  const pending = useCostCenterRequests({ status: 'pending', pageSize: 1 });
  return (
    <div data-testid="page-admin-cost-centers">
      <PageHeader title={t('costCenters.title')} subtitle={t('costCenters.adminSubtitle')} />
      <Tabs defaultValue="lookup">
        <TabsList>
          <TabsTrigger value="lookup" data-testid="tab-lookup">
            {t('costCenters.lookup')}
          </TabsTrigger>
          <TabsTrigger value="requests" data-testid="tab-requests">
            {t('costCenters.requests')}
            {pending.data?.total ? (
              <Badge variant="secondary" className="ml-1">
                {pending.data.total}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lookup">
          <LookupTab />
        </TabsContent>
        <TabsContent value="requests">
          <RequestsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LookupTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(ALL);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useCostCenters({ status: status === ALL ? undefined : status, q: q || undefined, page, pageSize: PAGE_SIZE });
  const archive = useArchiveCostCenter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [archiving, setArchiving] = useState<CostCenter | null>(null);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(qInput.trim());
    setPage(1);
  };

  const onArchive = async () => {
    if (!archiving) return;
    const res = await archive.mutateAsync(archiving.id).catch(() => null);
    if (res) {
      toast.success(t('costCenters.archived'));
      setArchiving(null);
    }
  };

  const columns = useMemo<ColumnDef<CostCenter>[]>(
    () => [
      { header: t('costCenters.number'), accessorKey: 'number', cell: ({ row }) => <span className="font-mono tabular-nums">{fmtCostCenter(row.original.number)}</span> },
      {
        header: t('costCenters.name'),
        accessorKey: 'name',
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="font-medium" data-testid="cc-row-name">
              {row.original.name}
            </span>
            {row.original.isDefault ? <Badge variant="secondary">{t('costCenters.default')}</Badge> : null}
          </span>
        ),
      },
      {
        header: t('costCenters.owner'),
        accessorKey: 'ownerName',
        cell: ({ row }) => (
          <div>
            <div>{row.original.ownerName}</div>
            <div className="text-xs text-muted-foreground">{row.original.ownerEmail}</div>
          </div>
        ),
      },
      {
        header: t('costCenters.maxBudget'),
        accessorKey: 'maxBudget',
        cell: ({ row }) =>
          row.original.maxBudget === null ? (
            <span className="text-muted-foreground">{t('common.unlimited')}</span>
          ) : (
            <span className="whitespace-nowrap tabular-nums">
              {fmtMoney(row.original.maxBudget)} <span className="text-xs text-muted-foreground">/ {t(`period.${row.original.budgetPeriod ?? 'monthly'}`)}</span>
            </span>
          ),
        meta: { className: 'text-right' },
      },
      { header: t('common.spend'), accessorKey: 'spendCurrentPeriod', cell: ({ row }) => fmtMoney(row.original.spendCurrentPeriod, { precise: true }), meta: { className: 'text-right tabular-nums' } },
      {
        header: t('common.status'),
        accessorKey: 'status',
        cell: ({ row }) => (
          <div className="flex gap-1">
            <StatusBadge status={row.original.status} testId="cc-status" />
            {row.original.blocked ? <StatusBadge status="blocked" /> : null}
          </div>
        ),
      },
      { header: t('common.createdAt'), accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.createdAt)}</span> },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => {
          const c = row.original;
          const locked = c.isDefault;
          return (
            <div className="flex justify-end gap-1">
              <WithTooltip text={locked ? t('errors.COST_CENTER_DEFAULT_IMMUTABLE') : undefined}>
                <Button variant="outline" size="sm" disabled={locked || c.status === 'archived'} onClick={() => setEditing(c)} data-testid="btn-edit-cost-center">
                  <Pencil />
                  <span className="hidden sm:inline">{t('common.edit')}</span>
                </Button>
              </WithTooltip>
              <WithTooltip text={locked ? t('errors.COST_CENTER_DEFAULT_IMMUTABLE') : undefined}>
                <Button variant="ghost" size="sm" disabled={locked || c.status === 'archived'} onClick={() => setArchiving(c)} data-testid="btn-archive-cost-center">
                  <Archive />
                  <span className="hidden sm:inline">{t('costCenters.archive')}</span>
                </Button>
              </WithTooltip>
            </div>
          );
        },
        meta: { className: 'text-right' },
      },
    ],
    [t],
  );

  return (
    <div>
      <Toolbar className="justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <form onSubmit={onSearch} className="flex items-end gap-1">
            <Field label={t('common.search')} htmlFor="cc-q">
              <Input id="cc-q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t('costCenters.searchPlaceholder')} className="w-56" data-testid="input-cc-search" />
            </Field>
            <Button type="submit" variant="outline" size="icon" aria-label={t('common.search')}>
              <Search />
            </Button>
          </form>
          <Field label={t('common.status')} htmlFor="cc-status">
            <SimpleSelect
              id="cc-status"
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[{ value: ALL, label: t('common.all') }, ...COST_CENTER_STATUS.map((s) => ({ value: s, label: t(`status.${s}`) }))]}
              className="w-40"
              testId="input-cc-status"
            />
          </Field>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="btn-create-cost-center">
          <Plus />
          {t('costCenters.create')}
        </Button>
      </Toolbar>
      <DataTable columns={columns} data={list.data?.items ?? []} isLoading={list.isLoading} testId="table-cost-centers" getRowId={(c) => c.id} />
      <div className="mt-3">
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPageChange={setPage} />
      </div>
      <CostCenterCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CostCenterEditDialog costCenter={editing} onClose={() => setEditing(null)} full />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t('costCenters.archive')}
        description={t('costCenters.archiveConfirm', { name: archiving?.name ?? '' })}
        confirmLabel={t('costCenters.archive')}
        destructive
        loading={archive.isPending}
        onConfirm={onArchive}
        testId="dialog-archive-cost-center"
      />
    </div>
  );
}

function RequestsTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const list = useCostCenterRequests({ status: 'pending', page, pageSize: PAGE_SIZE });
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const [rejecting, setRejecting] = useState<CostCenterRequest | null>(null);
  const [reason, setReason] = useState('');

  const onApprove = async (r: CostCenterRequest) => {
    const res = await approve.mutateAsync(r.id).catch(() => null);
    if (res) toast.success(t('costCenters.approved', { number: fmtCostCenter(r.costCenter.number) }), { testId: 'toast-cost-center-approved' });
  };

  const onReject = async () => {
    if (!rejecting || !reason.trim()) return;
    const res = await reject.mutateAsync({ id: rejecting.id, reason: reason.trim() }).catch(() => null);
    if (res) {
      toast.success(t('costCenters.rejected', { number: fmtCostCenter(rejecting.costCenter.number) }));
      setRejecting(null);
      setReason('');
    }
  };

  const columns = useMemo<ColumnDef<CostCenterRequest>[]>(
    () => [
      {
        header: t('costCenters.users'),
        accessorKey: 'user',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.user.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.user.email}</div>
          </div>
        ),
      },
      { header: t('costCenters.number'), id: 'number', cell: ({ row }) => <span className="font-mono tabular-nums" data-testid="request-number">{fmtCostCenter(row.original.costCenter.number)}</span> },
      { header: t('costCenters.name'), id: 'name', cell: ({ row }) => row.original.costCenter.name },
      {
        header: t('costCenters.owner'),
        id: 'owner',
        cell: ({ row }) => (
          <div>
            <div>{row.original.costCenter.ownerName}</div>
            <div className="text-xs text-muted-foreground">{row.original.costCenter.ownerEmail}</div>
          </div>
        ),
      },
      { header: t('common.createdAt'), accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.createdAt)}</span> },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={() => onApprove(row.original)} loading={approve.isPending && approve.variables === row.original.id} data-testid="btn-approve-request">
              <ThumbsUp />
              {t('costCenters.approve')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRejecting(row.original)} data-testid="btn-reject-request">
              <ThumbsDown />
              {t('costCenters.reject')}
            </Button>
          </div>
        ),
        meta: { className: 'text-right' },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, approve.isPending, approve.variables],
  );

  return (
    <div>
      <DataTable columns={columns} data={list.data?.items ?? []} isLoading={list.isLoading} testId="table-cost-center-requests" emptyText={t('costCenters.noRequests')} getRowId={(r) => r.id} />
      <div className="mt-3">
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPageChange={setPage} />
      </div>
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => {
          if (!o) {
            setRejecting(null);
            setReason('');
          }
        }}
        title={t('costCenters.reject')}
        description={rejecting ? `${fmtCostCenter(rejecting.costCenter.number)} · ${rejecting.costCenter.name} · ${rejecting.user.name}` : ''}
        confirmLabel={t('costCenters.reject')}
        destructive
        loading={reject.isPending}
        onConfirm={onReject}
        testId="dialog-reject-request"
      >
        <Field label={t('costCenters.rejectReason')} htmlFor="reject-reason" required>
          <Textarea id="reject-reason" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} data-testid="input-reject-reason" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
