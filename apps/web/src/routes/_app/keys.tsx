import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { useDeleteKey, useExtendKey, useKeys, type ApiKey, type CreatedApiKey } from '@/lib/queries';
import { fmtCostCenter, fmtDate, fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WithTooltip } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/StatusBadge';
import { CreateKeyDialog } from '@/components/keys/CreateKeyDialog';
import { KeySecretDialog } from '@/components/keys/KeySecretDialog';

export const Route = createFileRoute('/_app/keys')({
  component: KeysPage,
});

function KeysPage() {
  const { t } = useTranslation();
  const { me } = Route.useRouteContext();
  const keys = useKeys();
  const extend = useExtendKey();
  const del = useDeleteKey();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [toDelete, setToDelete] = useState<ApiKey | null>(null);

  const onExtend = async (k: ApiKey) => {
    const res = await extend.mutateAsync(k.id).catch(() => null);
    if (res) toast.success(t('keys.extended', { date: fmtDate(res.expiresAt) }), { testId: 'toast-key-extended' });
  };

  const onDelete = async () => {
    if (!toDelete) return;
    const ok = await del.mutateAsync(toDelete.id).catch(() => null);
    if (ok) {
      toast.success(t('keys.deleted'));
      setToDelete(null);
    }
  };

  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      { header: t('keys.name'), accessorKey: 'name', cell: ({ row }) => <span className="font-medium" data-testid="key-name">{row.original.name}</span> },
      { header: t('keys.key'), accessorKey: 'maskedKey', cell: ({ row }) => <code className="font-mono text-xs">{row.original.maskedKey}</code> },
      {
        header: t('common.costCenter'),
        accessorKey: 'costCenter',
        cell: ({ row }) => (
          <span title={row.original.costCenter.name}>
            <span className="tabular-nums">{fmtCostCenter(row.original.costCenter.number)}</span>
            <span className="ml-1 hidden text-xs text-muted-foreground xl:inline">{row.original.costCenter.name}</span>
          </span>
        ),
      },
      {
        header: t('keys.models'),
        accessorKey: 'models',
        cell: ({ row }) => (
          <div className="flex max-w-xs flex-wrap gap-1">
            {row.original.models.slice(0, 3).map((m) => (
              <Badge key={m} variant="secondary" className="font-mono">
                {m}
              </Badge>
            ))}
            {row.original.models.length > 3 ? (
              <WithTooltip text={row.original.models.slice(3).join(', ')}>
                <Badge variant="outline">+{row.original.models.length - 3}</Badge>
              </WithTooltip>
            ) : null}
          </div>
        ),
      },
      { header: t('common.budget'), accessorKey: 'budget', cell: ({ row }) => (row.original.budget === null ? t('common.unlimited') : fmtMoney(row.original.budget)), meta: { className: 'text-right tabular-nums' } },
      { header: t('common.spend'), accessorKey: 'spend', cell: ({ row }) => fmtMoney(row.original.spend, { precise: true }), meta: { className: 'text-right tabular-nums' } },
      { header: t('common.status'), accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} testId="key-status" /> },
      { header: t('common.createdAt'), accessorKey: 'createdAt', cell: ({ row }) => fmtDate(row.original.createdAt), meta: { className: 'whitespace-nowrap' } },
      { header: t('keys.expiresAt'), accessorKey: 'expiresAt', cell: ({ row }) => fmtDate(row.original.expiresAt), meta: { className: 'whitespace-nowrap' } },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <WithTooltip text={t('keys.extendHint')}>
              <Button variant="outline" size="sm" onClick={() => onExtend(row.original)} disabled={extend.isPending || row.original.status === 'deleted'} data-testid="btn-extend-key">
                <RefreshCw />
                <span className="hidden sm:inline">{t('keys.extend')}</span>
              </Button>
            </WithTooltip>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setToDelete(row.original)} disabled={row.original.status === 'deleted'} data-testid="btn-delete-key">
              <Trash2 />
              <span className="hidden sm:inline">{t('keys.delete')}</span>
            </Button>
          </div>
        ),
        meta: { className: 'text-right' },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, extend.isPending],
  );

  return (
    <div data-testid="page-keys">
      <PageHeader
        title={t('keys.title')}
        subtitle={t('keys.subtitle')}
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="btn-create-key">
            <Plus />
            {t('keys.create')}
          </Button>
        }
      />
      <DataTable columns={columns} data={keys.data?.items ?? []} isLoading={keys.isLoading} testId="table-keys" emptyText={t('keys.empty')} />

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} me={me} onCreated={setCreated} />
      <KeySecretDialog created={created} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('keys.delete')}
        description={t('keys.deleteConfirm', { name: toDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        loading={del.isPending}
        onConfirm={onDelete}
        testId="dialog-delete-key"
      />
    </div>
  );
}
